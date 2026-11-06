use crate::db::{chrono_now, Database};
use crate::errors::AppError;
use crate::executors::audio::AudioPipeline;
use crate::executors::muse_runner::MuseRunner;
use crate::executors::rembg::RembgEngine;
use crate::models::{AudioJobItem, AudioSegmentItem, TaskItem, TaskKind, TaskStatus};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub enum QueueAction {
    Enqueue(TaskItem),
    Cancel(String),
}

pub struct QueueManager {
    db: Arc<Database>,
    app_handle: tauri::AppHandle,
    tx: mpsc::Sender<QueueAction>,
    pub cancel_tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
    rembg_engine: Option<Arc<RembgEngine>>,
    muse_runner: Arc<Mutex<MuseRunner>>,
}

impl QueueManager {
    pub fn new(db: Arc<Database>, app_handle: tauri::AppHandle) -> Self {
        let (tx, mut rx) = mpsc::channel::<QueueAction>(100);
        let cancel_tokens = Arc::new(Mutex::new(HashMap::<String, CancellationToken>::new()));

        let db_worker = Arc::clone(&db);
        let tokens_worker = Arc::clone(&cancel_tokens);
        let app_worker = app_handle.clone();

        let model_path = "D:\\Antigravity\\REA\\project-docs\\poc-phase0\\poc_rembg\\u2netp.onnx";
        let rembg_engine = if std::path::Path::new(model_path).exists() {
            RembgEngine::new(model_path).ok().map(Arc::new)
        } else {
            None
        };

        let rembg_worker = rembg_engine.clone();
        let muse_runner = Arc::new(Mutex::new(MuseRunner::new()));
        let muse_worker = Arc::clone(&muse_runner);

        tokio::spawn(async move {
            tracing::info!("Queue actor started");
            while let Some(action) = rx.recv().await {
                match action {
                    QueueAction::Enqueue(task) => {
                        let token = CancellationToken::new();
                        {
                            let mut map = tokens_worker.lock().await;
                            map.insert(task.id.clone(), token.clone());
                        }

                        let db_ref = Arc::clone(&db_worker);
                        let _tokens_cleanup = Arc::clone(&tokens_worker);
                        let app_ref = app_worker.clone();
                        let rembg_ref = rembg_worker.clone();
                        let muse_ref = Arc::clone(&muse_worker);

                        tokio::spawn(async move {
                            run_task(task, db_ref, app_ref, rembg_ref, muse_ref, token).await;
                        });
                    }
                    QueueAction::Cancel(task_id) => {
                        let map = tokens_worker.lock().await;
                        if let Some(token) = map.get(&task_id) {
                            token.cancel();
                            tracing::info!("Cancellation signal sent for task: {}", task_id);
                        }
                    }
                }
            }
        });

        Self {
            db,
            app_handle,
            tx,
            cancel_tokens,
            rembg_engine,
            muse_runner,
        }
    }

    pub async fn check_muse_session(&self, user_data_dir: Option<String>) -> Result<(bool, String), AppError> {
        let mut runner = self.muse_runner.lock().await;
        runner
            .check_session(user_data_dir)
            .await
            .map_err(|e| AppError::Other(e.to_string()))
    }

    pub async fn enqueue(
        &self,
        kind: TaskKind,
        prompt: Option<String>,
        ratio: Option<String>,
        input_path: Option<String>,
    ) -> Result<TaskItem, AppError> {
        let now = chrono_now();
        let task = TaskItem {
            id: Uuid::new_v4().to_string(),
            kind,
            status: TaskStatus::Queued,
            prompt,
            ratio,
            input_path,
            output_path: None,
            progress: 0,
            error_msg: None,
            created_at: now,
            updated_at: now,
        };

        self.db.insert_task(&task)?;
        self.tx
            .send(QueueAction::Enqueue(task.clone()))
            .await
            .map_err(|e| AppError::Queue(e.to_string()))?;

        Ok(task)
    }

    pub async fn cancel(&self, task_id: &str) -> Result<(), AppError> {
        self.db.update_task_status(
            task_id,
            TaskStatus::Cancelled,
            0,
            None,
            Some("Người dùng đã hủy tác vụ"),
        )?;

        self.tx
            .send(QueueAction::Cancel(task_id.to_string()))
            .await
            .map_err(|e| AppError::Queue(e.to_string()))?;

        Ok(())
    }

    pub async fn re_enqueue(&self, mut task: TaskItem) -> Result<TaskItem, AppError> {
        let now = chrono_now();
        task.status = TaskStatus::Queued;
        task.progress = 0;
        task.error_msg = None;
        task.updated_at = now;

        self.db.update_task_status(&task.id, TaskStatus::Queued, 0, None, None)?;

        self.tx
            .send(QueueAction::Enqueue(task.clone()))
            .await
            .map_err(|e| AppError::Queue(e.to_string()))?;

        Ok(task)
    }
}

async fn run_task(
    task: TaskItem,
    db: Arc<Database>,
    app: tauri::AppHandle,
    rembg: Option<Arc<RembgEngine>>,
    muse_runner: Arc<Mutex<MuseRunner>>,
    token: CancellationToken,
) {
    let task_id = task.id.clone();
    tracing::info!("Executing task: {} ({:?})", task_id, task.kind);
    let _ = db.update_task_status(&task_id, TaskStatus::Running, 10, None, None);

    match task.kind {
        TaskKind::WhisperStt => {
            if let Some(input_audio) = task.input_path {
                let pipeline = AudioPipeline::new(app);
                let config = db.get_config().unwrap_or_default();
                let output_dir = &config.output_dir;
                let _ = std::fs::create_dir_all(output_dir);

                let db_prog = Arc::clone(&db);
                let tid_prog = task_id.clone();

                let res = pipeline
                    .process_stt(
                        &input_audio,
                        output_dir,
                        Some(&config.whisper_model),
                        move |p| {
                            let _ = db_prog.update_task_status(&tid_prog, TaskStatus::Running, p, None, None);
                        },
                        &token,
                    )
                    .await;

                match res {
                    Ok(out_json) => {
                        let out_str = out_json.to_string_lossy().to_string();
                        let _ = db.update_task_status(&task_id, TaskStatus::Success, 100, Some(&out_str), None);

                        // Tự động phân rã vào bảng audio_jobs & audio_segments (F7)
                        let job_id = task_id.clone();
                        let job = AudioJobItem {
                            id: job_id.clone(),
                            audio_path: input_audio.clone(),
                            status: "ready".into(),
                            created_at: chrono_now(),
                        };
                        let _ = db.create_audio_job(&job);

                        if let Ok(content) = std::fs::read_to_string(&out_json) {
                            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&content) {
                                if let Some(trans_arr) = json_val.get("transcription").and_then(|t| t.as_array()) {
                                    let mut segments = Vec::new();
                                    for (idx, item) in trans_arr.iter().enumerate() {
                                        let text = item.get("text").and_then(|t| t.as_str()).unwrap_or("").trim().to_string();
                                        let from_ms = item.get("offsets").and_then(|o| o.get("from")).and_then(|f| f.as_i64()).unwrap_or(0);
                                        let to_ms = item.get("offsets").and_then(|o| o.get("to")).and_then(|t| t.as_i64()).unwrap_or(0);

                                        if !text.is_empty() {
                                            segments.push(AudioSegmentItem {
                                                id: format!("{}_{}", job_id, idx),
                                                job_id: job_id.clone(),
                                                seq: idx as i32,
                                                start_ms: from_ms,
                                                end_ms: to_ms,
                                                text,
                                                prompt: None,
                                                ref_image_path: None,
                                                queue_task_id: None,
                                                output_video_path: None,
                                                approval: None,
                                            });
                                        }
                                    }
                                    let _ = db.insert_audio_segments(&segments);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let err_str = e.to_string();
                        tracing::error!("WhisperStt error: {}", err_str);
                        let _ = db.update_task_status(&task_id, TaskStatus::Failed, 0, None, Some(&err_str));
                    }
                }
            } else {
                let _ = db.update_task_status(&task_id, TaskStatus::Failed, 0, None, Some("Thiếu file audio đầu vào"));
            }
        }

        TaskKind::Rembg => {
            if let Some(engine) = rembg {
                if let Some(input_img) = task.input_path {
                    let output_dir = "D:\\XitrumAI_Outputs";
                    let _ = std::fs::create_dir_all(output_dir);
                    let short_id = &task_id[..8.min(task_id.len())];
                    let out_path = format!("{}\\rembg_{}.png", output_dir, short_id);

                    let res = tokio::task::spawn_blocking(move || {
                        engine.remove_background(&input_img, &out_path).map(|_| out_path)
                    })
                    .await;

                    match res {
                        Ok(Ok(out_file)) => {
                            let _ = db.update_task_status(&task_id, TaskStatus::Success, 100, Some(&out_file), None);
                        }
                        Ok(Err(e)) => {
                            let _ = db.update_task_status(&task_id, TaskStatus::Failed, 0, None, Some(&e.to_string()));
                        }
                        Err(e) => {
                            let _ = db.update_task_status(&task_id, TaskStatus::Failed, 0, None, Some(&e.to_string()));
                        }
                    }
                }
            } else {
                let _ = db.update_task_status(&task_id, TaskStatus::Failed, 0, None, Some("Chưa nạp model Rembg ONNX"));
            }
        }

        TaskKind::MuseVideo | TaskKind::MuseImage => {
            let prompt = task.prompt.clone().unwrap_or_default();
            if prompt.trim().is_empty() {
                let _ = db.update_task_status(&task_id, TaskStatus::Failed, 0, None, Some("Thiếu prompt mô tả"));
                return;
            }

            let config = db.get_config().unwrap_or_default();
            let output_dir = config.output_dir.clone();
            let chrome_profile = config.chrome_profile_dir.clone();
            let kind_str = match task.kind {
                TaskKind::MuseImage => "muse_image",
                _ => "muse_video",
            };

            let ratio_str = task.ratio.as_deref().unwrap_or(&config.default_ratio);
            let input_ref = task.input_path.as_deref();

            let db_prog = Arc::clone(&db);
            let tid_prog = task_id.clone();

            let mut runner = muse_runner.lock().await;
            let res = runner
                .execute_task(
                    &task_id,
                    kind_str,
                    &prompt,
                    Some(ratio_str),
                    input_ref,
                    &output_dir,
                    Some(&chrome_profile),
                    move |p, msg| {
                        let _ = db_prog.update_task_status(
                            &tid_prog,
                            TaskStatus::Running,
                            p,
                            None,
                            msg.as_deref(),
                        );
                    },
                    &token,
                )
                .await;

            match res {
                Ok(out_file) => {
                    let out_str = out_file.to_string_lossy().to_string();
                    let _ = db.update_task_status(&task_id, TaskStatus::Success, 100, Some(&out_str), None);
                    // Tự động liên kết video hoàn thành vào audio_segments nếu task này bắt nguồn từ timeline
                    let _ = db.update_segment_by_task_id(&task_id, &out_str);
                }
                Err(e) => {
                    let err_str = e.to_string();
                    tracing::error!("Muse execution failed: {}", err_str);
                    let _ = db.update_task_status(&task_id, TaskStatus::Failed, 0, None, Some(&err_str));
                }
            }
        }

        _ => {}
    }
}
