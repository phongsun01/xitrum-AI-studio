use crate::db::{chrono_now, Database};
use crate::errors::AppError;
use crate::executors::audio::AudioPipeline;
use crate::executors::rembg::RembgEngine;
use crate::models::{TaskItem, TaskKind, TaskStatus};
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

                        tokio::spawn(async move {
                            run_task(task, db_ref, app_ref, rembg_ref, token).await;
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
        }
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
}

async fn run_task(
    task: TaskItem,
    db: Arc<Database>,
    app: tauri::AppHandle,
    rembg: Option<Arc<RembgEngine>>,
    token: CancellationToken,
) {
    let task_id = task.id.clone();
    tracing::info!("Executing task: {} ({:?})", task_id, task.kind);
    let _ = db.update_task_status(&task_id, TaskStatus::Running, 10, None, None);

    match task.kind {
        TaskKind::WhisperStt => {
            if let Some(input_audio) = task.input_path {
                let pipeline = AudioPipeline::new(app);
                let output_dir = "D:\\XitrumAI_Outputs";
                let _ = std::fs::create_dir_all(output_dir);

                let db_prog = Arc::clone(&db);
                let tid_prog = task_id.clone();

                let res = pipeline
                    .process_stt(
                        &input_audio,
                        output_dir,
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
            for p in [30, 60, 90, 100] {
                tokio::select! {
                    _ = token.cancelled() => {
                        let _ = db.update_task_status(&task_id, TaskStatus::Cancelled, p, None, Some("Cancelled by user"));
                        return;
                    }
                    _ = tokio::time::sleep(tokio::time::Duration::from_millis(800)) => {
                        let _ = db.update_task_status(&task_id, TaskStatus::Running, p, None, None);
                    }
                }
            }
            let short_id = &task_id[..8.min(task_id.len())];
            let output_video = format!("D:\\XitrumAI_Outputs\\muse_{}.mp4", short_id);
            let _ = db.update_task_status(&task_id, TaskStatus::Success, 100, Some(&output_video), None);
        }

        _ => {}
    }
}
