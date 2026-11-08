use crate::db::{chrono_now, Database};
use crate::errors::AppError;
use crate::executors::audio::AudioPipeline;
use crate::executors::muse_adapter::MuseAdapter;
use crate::executors::muse_runner::MuseRunner;
use crate::executors::provider::{ProviderRegistry, ProviderTaskParams};
use crate::executors::rembg::RembgEngine;
use crate::models::{AccountItem, AudioJobItem, AudioSegmentItem, TaskItem, TaskKind, TaskStatus};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex, Semaphore};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub enum QueueAction {
    Enqueue(String), // Chỉ truyền task_id để đảm bảo actor đọc lại bản mới nhất từ SQLite
    Cancel(String),
}

pub struct QueueManager {
    db: Arc<Database>,
    #[allow(dead_code)]
    app_handle: tauri::AppHandle,
    tx: mpsc::Sender<QueueAction>,
    pub cancel_tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
    #[allow(dead_code)]
    rembg_engine: Option<Arc<RembgEngine>>,
    pub provider_registry: Arc<ProviderRegistry>,
    pub account_semaphores: Arc<Mutex<HashMap<String, Arc<Semaphore>>>>,
    pub muse_semaphore: Arc<Semaphore>,
    pub local_semaphore: Arc<Semaphore>,
}

impl QueueManager {
    pub fn new(db: Arc<Database>, app_handle: tauri::AppHandle) -> Self {
        let (tx, mut rx) = mpsc::channel::<QueueAction>(100);
        let cancel_tokens = Arc::new(Mutex::new(HashMap::<String, CancellationToken>::new()));

        let cfg = db.get_config().unwrap_or_default();
        let muse_semaphore = Arc::new(Semaphore::new(cfg.max_parallel_muse.max(1)));
        let local_semaphore = Arc::new(Semaphore::new(cfg.max_parallel_local.max(1)));

        let db_worker = Arc::clone(&db);
        let tokens_worker = Arc::clone(&cancel_tokens);
        let app_worker = app_handle.clone();
        let muse_sem_worker = Arc::clone(&muse_semaphore);
        let local_sem_worker = Arc::clone(&local_semaphore);

        // Khởi tạo ProviderRegistry và đăng ký MuseAdapter ban đầu (G3)
        let provider_registry = Arc::new(ProviderRegistry::new());
        let muse_runner = Arc::new(Mutex::new(MuseRunner::with_app_handle(app_handle.clone())));
        let muse_adapter = Arc::new(MuseAdapter::new(muse_runner, Arc::clone(&db)));
        {
            let reg = Arc::clone(&provider_registry);
            tokio::spawn(async move {
                reg.register(muse_adapter).await;
            });
        }

        let account_semaphores: Arc<Mutex<HashMap<String, Arc<Semaphore>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let acc_sems_worker = Arc::clone(&account_semaphores);
        let registry_worker = Arc::clone(&provider_registry);

        // Định vị model Rembg qua PathResolver hỗ trợ cả app đã đóng gói và dev
        let resolved_rembg_path = crate::paths::PathResolver::resolve_rembg_model(&app_handle);

        let rembg_engine = if let Some(path) = resolved_rembg_path {
            RembgEngine::new(path.to_string_lossy().as_ref()).ok().map(Arc::new)
        } else {
            None
        };

        let rembg_worker = rembg_engine.clone();
        let tx_sender = tx.clone();
        let db_startup = Arc::clone(&db);

        tokio::spawn(async move {
            tracing::info!("Queue actor started with Multi-Lane Semaphores (ID-based, durable)");
            while let Some(action) = rx.recv().await {
                match action {
                    QueueAction::Enqueue(task_id) => {
                        let token = CancellationToken::new();
                        {
                            let mut map = tokens_worker.lock().await;
                            map.insert(task_id.clone(), token.clone());
                        }

                        let db_ref = Arc::clone(&db_worker);
                        let app_ref = app_worker.clone();
                        let rembg_ref = rembg_worker.clone();
                        let registry_ref = Arc::clone(&registry_worker);
                        let acc_sems_ref = Arc::clone(&acc_sems_worker);
                        let muse_sem = Arc::clone(&muse_sem_worker);
                        let local_sem = Arc::clone(&local_sem_worker);

                        tokio::spawn(async move {
                            // 1. Đọc lại task từ SQLite ngay trước khi thực thi để nhận các chỉnh sửa/hủy mới nhất
                            let task = match db_ref.get_task(&task_id) {
                                Ok(t) => t,
                                Err(e) => {
                                    tracing::warn!("Task {} not found in DB before permit: {}", task_id, e);
                                    return;
                                }
                            };

                            // Nếu task đã bị hủy trong DB trước khi được xử lý thì dừng lại
                            if task.status == TaskStatus::Cancelled {
                                tracing::info!("Task {} was cancelled in DB, skipping execution", task_id);
                                return;
                            }

                            // 2. Chờ lấy semaphore tương ứng, hỗ trợ nhận tín hiệu cancel ngay khi đang chờ permit
                            match task.kind {
                                TaskKind::MuseVideo | TaskKind::MuseImage => {
                                    // Kiểm tra account isolation (G3):
                                    // Lấy account cụ thể hoặc account mặc định của provider
                                    let account = if let Some(ref aid) = task.account_id {
                                        db_ref.get_account(aid).ok().flatten()
                                    } else {
                                        db_ref.list_accounts(Some("muse")).ok().and_then(|list| list.into_iter().next())
                                    };

                                    let acc_sem = if let Some(ref acc) = account {
                                        let mut map = acc_sems_ref.lock().await;
                                        map.entry(acc.id.clone())
                                            .or_insert_with(|| Arc::new(Semaphore::new(acc.max_concurrency.max(1))))
                                            .clone()
                                    } else {
                                        muse_sem
                                    };

                                    tokio::select! {
                                        _ = token.cancelled() => {
                                            tracing::info!("Task {} cancelled while waiting for provider/account semaphore", task_id);
                                            let _ = db_ref.update_task_status(&task_id, TaskStatus::Cancelled, 0, None, Some("Hủy khi đang chờ luồng"));
                                        }
                                        permit = acc_sem.acquire() => {
                                            let _permit = permit;
                                            run_task(task_id, db_ref, app_ref, rembg_ref, registry_ref, account, token).await;
                                        }
                                    }
                                }
                                _ => {
                                    tokio::select! {
                                        _ = token.cancelled() => {
                                            tracing::info!("Task {} cancelled while waiting for local semaphore", task_id);
                                            let _ = db_ref.update_task_status(&task_id, TaskStatus::Cancelled, 0, None, Some("Hủy khi đang chờ luồng"));
                                        }
                                        permit = local_sem.acquire() => {
                                            let _permit = permit;
                                            run_task(task_id, db_ref, app_ref, rembg_ref, registry_ref, None, token).await;
                                        }
                                    }
                                }
                            }
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

        // Tự động nạp lại các task pending/queued từ SQLite khi ứng dụng khởi động (Durable Queue Recovery)
        let tx_recovery = tx_sender.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
            if let Ok(pending) = db_startup.list_pending_tasks() {
                if !pending.is_empty() {
                    tracing::info!("Recovering {} pending task(s) from database into queue...", pending.len());
                    for task in pending {
                        let _ = tx_recovery.send(QueueAction::Enqueue(task.id)).await;
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
            provider_registry,
            account_semaphores,
            muse_semaphore,
            local_semaphore,
        }
    }

    pub fn get_lane_status(&self) -> serde_json::Value {
        serde_json::json!({
            "muse_available_slots": self.muse_semaphore.available_permits(),
            "local_available_slots": self.local_semaphore.available_permits(),
        })
    }

    pub async fn check_muse_session(
        &self,
        user_data_dir: Option<String>,
        _chrome_path: Option<String>,
        _proxy: Option<crate::executors::muse_runner::ProxyConfig>,
    ) -> Result<(bool, String), AppError> {
        let adapter = self.provider_registry.get("muse").await.ok_or_else(|| {
            AppError::NotFound("Muse provider adapter not registered".to_string())
        })?;
        let dummy_account = AccountItem {
            id: "default_muse".into(),
            provider: "muse".into(),
            name: "Default Muse".into(),
            profile_path: user_data_dir,
            proxy_id: None,
            readiness: "ready".into(),
            cooldown_until: None,
            max_concurrency: 1,
            last_checked_at: None,
            created_at: 0,
        };
        adapter.check_session(&dummy_account).await
    }

    pub async fn enqueue(
        &self,
        kind: TaskKind,
        prompt: Option<String>,
        ratio: Option<String>,
        input_path: Option<String>,
    ) -> Result<TaskItem, AppError> {
        self.enqueue_advanced(kind, prompt, ratio, input_path, None, None, None, false).await
    }

    pub async fn enqueue_advanced(
        &self,
        kind: TaskKind,
        prompt: Option<String>,
        ratio: Option<String>,
        input_path: Option<String>,
        provider: Option<String>,
        requested_model: Option<String>,
        scene_revision: Option<i64>,
        force_new_generation: bool,
    ) -> Result<TaskItem, AppError> {
        self.enqueue_with_account(
            kind,
            prompt,
            ratio,
            input_path,
            provider,
            requested_model,
            scene_revision,
            None,
            force_new_generation,
        )
        .await
    }

    pub async fn enqueue_with_account(
        &self,
        kind: TaskKind,
        prompt: Option<String>,
        ratio: Option<String>,
        input_path: Option<String>,
        provider: Option<String>,
        requested_model: Option<String>,
        scene_revision: Option<i64>,
        account_id: Option<String>,
        force_new_generation: bool,
    ) -> Result<TaskItem, AppError> {
        let prov = provider.unwrap_or_else(|| "muse".to_string());
        let pr = prompt.as_deref().unwrap_or("");
        let rat = ratio.as_deref();

        // Kiểm tra account nếu có để đảm bảo thuộc đúng provider
        if let Some(ref aid) = account_id {
            if let Ok(Some(acc)) = self.db.get_account(aid) {
                if acc.provider != prov {
                    return Err(AppError::Validation(format!(
                        "Tài khoản '{}' thuộc provider '{}', không thể dùng cho provider '{}'",
                        aid, acc.provider, prov
                    )));
                }
            }
        }

        // Kiểm tra Capability Matrix trước khi dispatch
        if let Some(adapter) = self.provider_registry.get(&prov).await {
            let task_kind_str = match kind {
                TaskKind::MuseImage => "text_to_image",
                _ => "text_to_video",
            };
            let params = ProviderTaskParams {
                task_id: "validation_probe".into(),
                kind: task_kind_str.into(),
                prompt: pr.into(),
                ratio: ratio.clone(),
                input_path: input_path.clone(),
                output_dir: String::new(),
                model: requested_model.clone(),
                duration_sec: None,
            };
            adapter.validate_task_params(&params)?;
        }

        // Tính generation key duy nhất
        let gen_key = crate::dedup::compute_generation_key(
            &prov,
            requested_model.as_deref(),
            pr,
            rat,
            scene_revision,
            input_path.as_deref(),
        );

        // Chống dispatch trùng (Idempotent Check):
        // Nếu không yêu cầu tạo biến thể mới (force_new_generation = false)
        // và đã có task tương ứng đang queued hoặc running hoặc thành công, trả lại task đó thay vì submit đúp.
        if !force_new_generation {
            if let Ok(Some(existing_task)) = self.db.find_task_by_generation_key(&gen_key) {
                if matches!(existing_task.status, TaskStatus::Queued | TaskStatus::Running | TaskStatus::Success) {
                    tracing::info!("Found existing task with identical generation key: {} ({:?}). Avoiding duplicate submit.", existing_task.id, existing_task.status);
                    return Ok(existing_task);
                }
            }
        }

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
            provider: Some(prov),
            connection_mode: Some("muse_web".to_string()),
            requested_model,
            observed_model: None,
            generation_key: Some(gen_key),
            scene_revision: Some(scene_revision.unwrap_or(1)),
            account_id,
        };

        self.db.insert_task(&task)?;
        self.tx
            .send(QueueAction::Enqueue(task.id.clone()))
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
            .send(QueueAction::Enqueue(task.id.clone()))
            .await
            .map_err(|e| AppError::Queue(e.to_string()))?;

        Ok(task)
    }
}

async fn run_task(
    task_id: String,
    db: Arc<Database>,
    app: tauri::AppHandle,
    rembg: Option<Arc<RembgEngine>>,
    provider_registry: Arc<ProviderRegistry>,
    account: Option<AccountItem>,
    token: CancellationToken,
) {
    // Đọc lại task mới nhất từ DB
    let task = match db.get_task(&task_id) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Cannot run task {}: {}", task_id, e);
            return;
        }
    };

    // Kiểm tra terminal state: nếu đã hủy hoặc thành công thì không chạy lại
    if matches!(task.status, TaskStatus::Cancelled | TaskStatus::Success) {
        tracing::info!("Task {} is in terminal state ({:?}), skipping", task_id, task.status);
        return;
    }

    let attempt_num = db.get_latest_task_attempt(&task_id)
        .ok()
        .flatten()
        .map(|a| a.attempt_num + 1)
        .unwrap_or(1);

    let attempt_id = Uuid::new_v4().to_string();
    let start_time = chrono_now();

    // Ghi attempt phase: dispatching
    let _ = db.record_task_attempt(&crate::models::TaskAttemptItem {
        id: attempt_id.clone(),
        task_id: task_id.clone(),
        attempt_num,
        phase: "dispatching".into(),
        remote_job_id: None,
        session_id: account.as_ref().map(|a| a.id.clone()),
        error_code: None,
        error_msg: None,
        started_at: start_time,
        finished_at: None,
    });

    tracing::info!("Executing task: {} (kind: {:?}, attempt: {})", task_id, task.kind, attempt_num);
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
                        let finish_now = chrono_now();

                        let _ = db.record_task_attempt(&crate::models::TaskAttemptItem {
                            id: attempt_id.clone(),
                            task_id: task_id.clone(),
                            attempt_num,
                            phase: "completed".into(),
                            remote_job_id: None,
                            session_id: None,
                            error_code: None,
                            error_msg: None,
                            started_at: start_time,
                            finished_at: Some(finish_now),
                        });

                        // Stale attempt check
                        if let Ok(current_task) = db.get_task(&task_id) {
                            if current_task.status == TaskStatus::Cancelled {
                                tracing::warn!("Task {} finished but was marked cancelled. Ignoring result.", task_id);
                                return;
                            }
                        }

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
                        let finish_now = chrono_now();
                        let is_cancelled = err_str.contains("Cancelled") || token.is_cancelled();
                        let phase = if is_cancelled { "cancelled" } else { "failed" };

                        let _ = db.record_task_attempt(&crate::models::TaskAttemptItem {
                            id: attempt_id.clone(),
                            task_id: task_id.clone(),
                            attempt_num,
                            phase: phase.into(),
                            remote_job_id: None,
                            session_id: None,
                            error_code: if is_cancelled { Some("USER_CANCELLED".into()) } else { Some("EXECUTION_ERROR".into()) },
                            error_msg: Some(err_str.clone()),
                            started_at: start_time,
                            finished_at: Some(finish_now),
                        });

                        tracing::error!("WhisperStt error: {}", err_str);
                        let final_status = if is_cancelled { TaskStatus::Cancelled } else { TaskStatus::Failed };
                        let _ = db.update_task_status(&task_id, final_status, 0, None, Some(&err_str));
                    }
                }
            } else {
                let _ = db.update_task_status(&task_id, TaskStatus::Failed, 0, None, Some("Thiếu file audio đầu vào"));
            }
        }

        TaskKind::Rembg => {
            if let Some(engine) = rembg {
                if let Some(input_img) = task.input_path {
                    let config = db.get_config().unwrap_or_default();
                    let output_dir = config.output_dir;
                    let _ = std::fs::create_dir_all(&output_dir);
                    let short_id = &task_id[..8.min(task_id.len())];
                    let out_path = format!("{}\\rembg_{}.png", output_dir, short_id);

                    let res = tokio::task::spawn_blocking(move || {
                        engine.remove_background(&input_img, &out_path).map(|_| out_path)
                    })
                    .await;

                    match res {
                        Ok(Ok(out_file)) => {
                            let finish_now = chrono_now();
                            let _ = db.record_task_attempt(&crate::models::TaskAttemptItem {
                                id: attempt_id.clone(),
                                task_id: task_id.clone(),
                                attempt_num,
                                phase: "completed".into(),
                                remote_job_id: None,
                                session_id: None,
                                error_code: None,
                                error_msg: None,
                                started_at: start_time,
                                finished_at: Some(finish_now),
                            });

                            // Stale attempt check
                            if let Ok(current_task) = db.get_task(&task_id) {
                                if current_task.status == TaskStatus::Cancelled {
                                    tracing::warn!("Task {} finished Rembg but was marked cancelled. Ignoring result.", task_id);
                                    return;
                                }
                            }

                            let _ = db.update_task_status(&task_id, TaskStatus::Success, 100, Some(&out_file), None);
                        }
                        Ok(Err(e)) => {
                            let finish_now = chrono_now();
                            let err_str = e.to_string();
                            let _ = db.record_task_attempt(&crate::models::TaskAttemptItem {
                                id: attempt_id.clone(),
                                task_id: task_id.clone(),
                                attempt_num,
                                phase: "failed".into(),
                                remote_job_id: None,
                                session_id: None,
                                error_code: Some("REMBG_ERROR".into()),
                                error_msg: Some(err_str.clone()),
                                started_at: start_time,
                                finished_at: Some(finish_now),
                            });
                            let _ = db.update_task_status(&task_id, TaskStatus::Failed, 0, None, Some(&err_str));
                        }
                        Err(e) => {
                            let finish_now = chrono_now();
                            let err_str = e.to_string();
                            let _ = db.record_task_attempt(&crate::models::TaskAttemptItem {
                                id: attempt_id.clone(),
                                task_id: task_id.clone(),
                                attempt_num,
                                phase: "failed".into(),
                                remote_job_id: None,
                                session_id: None,
                                error_code: Some("PANIC_OR_JOIN_ERROR".into()),
                                error_msg: Some(err_str.clone()),
                                started_at: start_time,
                                finished_at: Some(finish_now),
                            });
                            let _ = db.update_task_status(&task_id, TaskStatus::Failed, 0, None, Some(&err_str));
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

            let prov_name = task.provider.as_deref().unwrap_or("muse");
            let adapter = match provider_registry.get(prov_name).await {
                Some(a) => a,
                None => {
                    let err = format!("Provider '{}' không tìm thấy adapter", prov_name);
                    let _ = db.update_task_status(&task_id, TaskStatus::Failed, 0, None, Some(&err));
                    return;
                }
            };

            let config = db.get_config().unwrap_or_default();
            let output_dir = config.output_dir.clone();

            // Nếu task chưa có account gán sẵn, dùng account truyền vào hoặc tạo fallback account từ config
            let current_account = account.unwrap_or_else(|| {
                AccountItem {
                    id: "default_fallback".into(),
                    provider: prov_name.into(),
                    name: "Default Profile".into(),
                    profile_path: Some(config.chrome_profile_dir.clone()),
                    proxy_id: config.active_proxy_id,
                    readiness: "ready".into(),
                    cooldown_until: None,
                    max_concurrency: 1,
                    last_checked_at: None,
                    created_at: 0,
                }
            });

            let kind_str = match task.kind {
                TaskKind::MuseImage => "text_to_image",
                _ => "text_to_video",
            };

            let params = ProviderTaskParams {
                task_id: task_id.clone(),
                kind: kind_str.into(),
                prompt,
                ratio: task.ratio.clone().or_else(|| Some(config.default_ratio)),
                input_path: task.input_path.clone(),
                output_dir,
                model: task.requested_model.clone(),
                duration_sec: None,
            };

            let db_prog = Arc::clone(&db);
            let tid_prog = task_id.clone();
            let progress_cb = Box::new(move |p, msg: Option<String>| {
                let _ = db_prog.update_task_status(
                    &tid_prog,
                    TaskStatus::Running,
                    p,
                    None,
                    msg.as_deref(),
                );
            });

            let res = adapter
                .execute_task(&current_account, &params, progress_cb, &token)
                .await;

            match res {
                Ok(task_result) => {
                    let out_str = task_result.output_file.to_string_lossy().to_string();
                    let finish_now = chrono_now();

                    // Cập nhật attempt: completed
                    let _ = db.record_task_attempt(&crate::models::TaskAttemptItem {
                        id: attempt_id.clone(),
                        task_id: task_id.clone(),
                        attempt_num,
                        phase: "completed".into(),
                        remote_job_id: task_result.remote_job_id,
                        session_id: task_result.session_id,
                        error_code: None,
                        error_msg: task_result.verification_notes,
                        started_at: start_time,
                        finished_at: Some(finish_now),
                    });

                    // Kiểm tra xem trong lúc chạy, task có bị hủy hoặc có revision mới không (stale attempt check)
                    if let Ok(current_task) = db.get_task(&task_id) {
                        if current_task.status == TaskStatus::Cancelled {
                            tracing::warn!("Task {} finished running but was marked cancelled. Ignoring result to avoid overwrite.", task_id);
                            return;
                        }
                    }

                    let _ = db.update_task_status(&task_id, TaskStatus::Success, 100, Some(&out_str), None);
                    // Tự động liên kết video hoàn thành vào audio_segments nếu task này bắt nguồn từ timeline
                    let _ = db.update_segment_by_task_id(&task_id, &out_str);
                    // Tự động liên kết video hoàn thành vào script_scenes nếu task này bắt nguồn từ kịch bản Mốc 4
                    let _ = db.update_script_scene_by_task_id(&task_id, &out_str);
                }
                Err(e) => {
                    let err_str = e.to_string();
                    let finish_now = chrono_now();

                    let is_cancelled = err_str.contains("Cancelled");
                    let phase = if is_cancelled { "cancelled" } else { "failed" };

                    // Cập nhật attempt: failed hoặc cancelled
                    let _ = db.record_task_attempt(&crate::models::TaskAttemptItem {
                        id: attempt_id.clone(),
                        task_id: task_id.clone(),
                        attempt_num,
                        phase: phase.into(),
                        remote_job_id: None,
                        session_id: Some(current_account.id.clone()),
                        error_code: if is_cancelled { Some("USER_CANCELLED".into()) } else { Some("EXECUTION_ERROR".into()) },
                        error_msg: Some(err_str.clone()),
                        started_at: start_time,
                        finished_at: Some(finish_now),
                    });

                    tracing::error!("Provider execution failed: {}", err_str);
                    let final_status = if is_cancelled { TaskStatus::Cancelled } else { TaskStatus::Failed };
                    let _ = db.update_task_status(&task_id, final_status, 0, None, Some(&err_str));
                }
            }
        }

        _ => {
            // Task kind chưa có executor: fail rõ ràng theo tiêu chí G1
            let err = format!("Tác vụ loại {:?} chưa được cấu hình executor", task.kind);
            tracing::warn!("{}", err);
            let _ = db.update_task_status(&task_id, TaskStatus::Failed, 0, None, Some(&err));
        }
    }
}
