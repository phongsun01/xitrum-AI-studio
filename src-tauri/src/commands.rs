use crate::db::chrono_now;
use crate::errors::AppError;
use serde::{Deserialize, Serialize};
use crate::models::{
    AccountItem, AppConfig, AudioJobItem, AudioSegmentItem, ProviderDescriptor,
    ProxyItem, ScriptProjectItem, ScriptSceneItem, TaskItem, TaskKind, TemplateItem,
};
use crate::state::AppState;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, State};
use uuid::Uuid;

#[tauri::command]
pub async fn enqueue_task(
    kind: TaskKind,
    prompt: Option<String>,
    ratio: Option<String>,
    input_path: Option<String>,
    provider: Option<String>,
    requested_model: Option<String>,
    scene_revision: Option<i64>,
    account_id: Option<String>,
    force_new_generation: Option<bool>,
    state: State<'_, AppState>,
) -> Result<TaskItem, AppError> {
    state.queue.enqueue_with_account(
        kind,
        prompt,
        ratio,
        input_path,
        provider,
        requested_model,
        scene_revision,
        account_id,
        force_new_generation.unwrap_or(false),
    ).await
}

#[tauri::command]
pub async fn cancel_task(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.queue.cancel(&task_id).await
}

#[tauri::command]
pub fn get_lane_status(state: State<'_, AppState>) -> serde_json::Value {
    state.queue.get_lane_status()
}

#[tauri::command]
pub async fn check_muse_session(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let cfg = state.db.get_config().unwrap_or_default();
    let proxy_config = if let Some(proxy_id) = cfg.active_proxy_id {
        state.db.get_proxy(proxy_id).ok().flatten().map(|p| {
            let pwd = if let Ok(Some(secret)) = crate::secret_store::SecretStore::get_secret(&format!("proxy_{}", p.id)) {
                Some(secret)
            } else {
                p.encrypted_password.as_ref().map(|enc| {
                    use base64::{engine::general_purpose, Engine as _};
                    if let Ok(bytes) = general_purpose::STANDARD.decode(enc) {
                        let salt = b"xitrum_secret_salt_2026";
                        let mut unxored = Vec::new();
                        for (i, b) in bytes.iter().enumerate() {
                            unxored.push(b ^ salt[i % salt.len()]);
                        }
                        String::from_utf8_lossy(&unxored).to_string()
                    } else {
                        enc.clone()
                    }
                })
            };
            crate::executors::muse_runner::ProxyConfig {
                server: format!("{}://{}:{}", p.scheme, p.host, p.port),
                username: p.username,
                password: pwd,
            }
        })
    } else {
        None
    };

    let (ok, msg) = state
        .queue
        .check_muse_session(
            Some(cfg.chrome_profile_dir),
            cfg.chrome_path,
            proxy_config,
        )
        .await?;

    Ok(serde_json::json!({
        "ok": ok,
        "message": msg
    }))
}

#[derive(serde::Serialize)]
pub struct CookieSessionResult {
    pub ok: bool,
    pub message: String,
    pub checked_at: u64,
}

#[tauri::command]
pub async fn check_muse_session_by_cookie(
    hatch_sess: String,
    hatch_native_auth_device: String,
    hatch_gw: Option<String>,
    hatch_vml: Option<String>,
) -> Result<CookieSessionResult, AppError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let sess = hatch_sess.trim();
    let auth_dev = hatch_native_auth_device.trim();

    if sess.is_empty() || auth_dev.is_empty() {
        return Ok(CookieSessionResult {
            ok: false,
            message: "Thiếu cookie bắt buộc: hatch_sess và hatch_native_auth_device không được để trống.".to_string(),
            checked_at: now,
        });
    }

    let mut cookie_parts = vec![
        format!("hatch_sess={}", sess),
        format!("hatch_native_auth_device={}", auth_dev),
    ];
    if let Some(gw) = hatch_gw {
        let gw = gw.trim();
        if !gw.is_empty() {
            cookie_parts.push(format!("hatch_gw={}", gw));
        }
    }
    if let Some(vml) = hatch_vml {
        let vml = vml.trim();
        if !vml.is_empty() {
            cookie_parts.push(format!("hatch_vml={}", vml));
        }
    }
    let cookie_header = cookie_parts.join("; ");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| AppError::Other(format!("Lỗi tạo HTTP client: {}", e)))?;

    // 1. Kiểm tra session ban đầu
    let res = match client
        .get("https://muse.ai/api/session")
        .header(reqwest::header::COOKIE, &cookie_header)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Ok(CookieSessionResult {
                ok: false,
                message: format!("Không kết nối được Muse: {}", e),
                checked_at: now,
            });
        }
    };

    let status = res.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Ok(CookieSessionResult {
            ok: false,
            message: "Phiên đã hết hạn. Vui lòng đăng nhập lại trên trình duyệt rồi lấy cookie mới.".to_string(),
            checked_at: now,
        });
    }

    if !status.is_success() {
        return Ok(CookieSessionResult {
            ok: false,
            message: format!("Muse trả về mã lỗi HTTP {}.", status.as_u16()),
            checked_at: now,
        });
    }

    // 2. Gửi lệnh wake VM
    let _ = client
        .post("https://muse.ai/api/hatch/vm/wake")
        .header(reqwest::header::COOKIE, &cookie_header)
        .send()
        .await;

    // 3. Polling kiểm tra lại session
    let mut verified = false;
    for _ in 0..5 {
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        if let Ok(r) = client
            .get("https://muse.ai/api/session")
            .header(reqwest::header::COOKIE, &cookie_header)
            .send()
            .await
        {
            if r.status().is_success() {
                verified = true;
                break;
            }
        }
    }

    if verified {
        Ok(CookieSessionResult {
            ok: true,
            message: "Phiên còn dùng được. Máy ảo Muse.ai đã sẵn sàng!".to_string(),
            checked_at: now,
        })
    } else {
        Ok(CookieSessionResult {
            ok: true,
            message: "Phiên hợp lệ nhưng máy ảo Muse.ai phản hồi chậm. Vui lòng kiểm tra lại sau vài giây.".to_string(),
            checked_at: now,
        })
    }
}

#[tauri::command]
pub async fn retry_task(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<TaskItem, AppError> {
    let task = state.db.get_task(&task_id)?;
    state.queue.re_enqueue(task).await
}

#[tauri::command]
pub async fn duplicate_task(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<TaskItem, AppError> {
    let task = state.db.get_task(&task_id)?;
    // Cho phép tạo biến thể mới rõ ràng với force_new_generation = true
    state
        .queue
        .enqueue_advanced(
            task.kind,
            task.prompt,
            task.ratio,
            task.input_path,
            task.provider,
            task.requested_model,
            task.scene_revision,
            true, // force new generation
        )
        .await
}

#[tauri::command]
pub fn edit_task_prompt(
    task_id: String,
    prompt: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.db.update_task_prompt(&task_id, &prompt)
}

#[tauri::command]
pub fn open_output_folder(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let task = state.db.get_task(&task_id)?;
    if let Some(output) = task.output_path {
        let p = Path::new(&output);
        let target = if p.is_dir() {
            p
        } else if let Some(parent) = p.parent() {
            parent
        } else {
            p
        };

        if target.exists() {
            opener::open(target).map_err(|e| AppError::Other(e.to_string()))?;
            Ok(())
        } else {
            Err(AppError::Other(format!(
                "Thư mục không tồn tại: {}",
                target.display()
            )))
        }
    } else {
        Err(AppError::Other("Task chưa có đường dẫn kết quả".into()))
    }
}

// --- Templates Commands (v0.2.0 F6) ---
#[tauri::command]
pub fn save_template(
    id: Option<String>,
    name: String,
    prompt: String,
    ratio: Option<String>,
    state: State<'_, AppState>,
) -> Result<TemplateItem, AppError> {
    let tpl = TemplateItem {
        id: id.unwrap_or_else(|| Uuid::new_v4().to_string()),
        name,
        prompt,
        ratio,
        created_at: chrono_now(),
    };
    state.db.save_template(&tpl)?;
    Ok(tpl)
}

#[tauri::command]
pub fn list_templates(state: State<'_, AppState>) -> Result<Vec<TemplateItem>, AppError> {
    state.db.list_templates()
}

#[tauri::command]
pub fn delete_template(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.db.delete_template(&id)
}

// --- Audio Timeline Commands (v0.3.0 F7, F8, F10) ---
#[tauri::command]
pub fn list_audio_jobs(state: State<'_, AppState>) -> Result<Vec<AudioJobItem>, AppError> {
    state.db.list_audio_jobs()
}

#[tauri::command]
pub fn list_audio_segments(
    job_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AudioSegmentItem>, AppError> {
    state.db.list_audio_segments(&job_id)
}

#[tauri::command]
pub fn update_audio_segment(
    segment_id: String,
    text: Option<String>,
    prompt: Option<String>,
    ref_image_path: Option<String>,
    approval: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.db.update_audio_segment(
        &segment_id,
        text.as_deref(),
        prompt.as_deref(),
        ref_image_path.as_deref(),
        None,
        approval.as_deref(),
    )
}

#[tauri::command]
pub async fn add_segment_to_queue(
    job_id: String,
    segment_id: String,
    state: State<'_, AppState>,
) -> Result<TaskItem, AppError> {
    let segments = state.db.list_audio_segments(&job_id)?;
    let seg = segments
        .into_iter()
        .find(|s| s.id == segment_id)
        .ok_or_else(|| AppError::NotFound("Segment không tồn tại".into()))?;

    let prompt = seg.prompt.unwrap_or(seg.text);
    let task = state
        .queue
        .enqueue(TaskKind::MuseVideo, Some(prompt), Some("16:9".into()), seg.ref_image_path)
        .await?;

    // Liên kết queue_task_id vào segment để sau này khi task xong sẽ cập nhật output_video_path
    let _ = state.db.set_segment_queue_task_id(&segment_id, &task.id);

    Ok(task)
}

// --- F15: Chạy lại Muse.ai cho 1 segment cụ thể (Regenerate) ---
#[tauri::command]
pub async fn regenerate_segment(
    job_id: String,
    segment_id: String,
    state: State<'_, AppState>,
) -> Result<TaskItem, AppError> {
    let segments = state.db.list_audio_segments(&job_id)?;
    let seg = segments
        .into_iter()
        .find(|s| s.id == segment_id)
        .ok_or_else(|| AppError::NotFound("Segment không tồn tại".into()))?;

    // Reset output_video_path cũ về None
    let _ = state.db.update_audio_segment(
        &segment_id,
        None,
        None,
        None,
        Some(""), // Đặt rỗng để xóa đường dẫn video cũ
        None,
    );

    let prompt = seg.prompt.unwrap_or(seg.text);
    // Khi regenerate tường minh, bật force_new_generation = true để cho phép tạo biến thể mới
    let task = state
        .queue
        .enqueue_advanced(
            TaskKind::MuseVideo,
            Some(prompt),
            Some("16:9".into()),
            seg.ref_image_path,
            Some("muse".into()),
            None,
            None,
            true, // force_new_generation
        )
        .await?;

    let _ = state.db.set_segment_queue_task_id(&segment_id, &task.id);

    Ok(task)
}

#[tauri::command]
pub fn export_script(
    job_id: String,
    format: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let segments = state.db.list_audio_segments(&job_id)?;
    if segments.is_empty() {
        return Err(AppError::Other("Chưa có đoạn phân rã nào cho job này".into()));
    }

    let config = state.db.get_config().unwrap_or_default();
    let out_dir = Path::new(&config.output_dir);
    let _ = std::fs::create_dir_all(out_dir);

    match format.to_lowercase().as_str() {
        "srt" => {
            let out_file = out_dir.join(format!("{}.srt", job_id));
            let mut srt_content = String::new();
            for (i, seg) in segments.iter().enumerate() {
                let start_sec = seg.start_ms / 1000;
                let start_msec = seg.start_ms % 1000;
                let end_sec = seg.end_ms / 1000;
                let end_msec = seg.end_ms % 1000;

                let s_h = start_sec / 3600;
                let s_m = (start_sec % 3600) / 60;
                let s_s = start_sec % 60;

                let e_h = end_sec / 3600;
                let e_m = (end_sec % 3600) / 60;
                let e_s = end_sec % 60;

                srt_content.push_str(&format!(
                    "{}\n{:02}:{:02}:{:02},{:03} --> {:02}:{:02}:{:02},{:03}\n{}\n\n",
                    i + 1,
                    s_h,
                    s_m,
                    s_s,
                    start_msec,
                    e_h,
                    e_m,
                    e_s,
                    end_msec,
                    seg.text
                ));
            }
            std::fs::write(&out_file, srt_content)?;
            Ok(out_file.to_string_lossy().to_string())
        }
        _ => {
            // Default plain text
            let out_file = out_dir.join(format!("{}.txt", job_id));
            let mut txt_content = String::new();
            for seg in segments {
                txt_content.push_str(&format!("{}\n", seg.text));
            }
            std::fs::write(&out_file, txt_content)?;
            Ok(out_file.to_string_lossy().to_string())
        }
    }
}

// --- F12: Render ghép toàn bộ video ---
#[tauri::command]
pub async fn render_audio_job(
    job_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let jobs = state.db.list_audio_jobs()?;
    let job = jobs
        .into_iter()
        .find(|j| j.id == job_id)
        .ok_or_else(|| AppError::NotFound(format!("Không tìm thấy Audio Job {}", job_id)))?;

    let segments = state.db.list_audio_segments(&job_id)?;
    if segments.is_empty() {
        return Err(AppError::Other("Audio Job không có segment nào".into()));
    }

    // Thu thập các video hợp lệ theo thứ tự seq
    let mut video_paths = Vec::new();
    for seg in &segments {
        // Chỉ lấy những segment không bị reject
        if seg.approval.as_deref() == Some("rejected") {
            continue;
        }

        if let Some(v_path) = &seg.output_video_path {
            if Path::new(v_path).exists() {
                video_paths.push(v_path.clone());
            }
        }
    }

    if video_paths.is_empty() {
        return Err(AppError::Other(
            "Chưa có video segment nào hoàn thành. Hãy bấm 'Tạo Video' cho các câu thoại trước!".into(),
        ));
    }

    let config = state.db.get_config().unwrap_or_default();
    let out_dir = Path::new(&config.output_dir);
    let _ = std::fs::create_dir_all(out_dir);

    // F13: Tự động chọn ngẫu nhiên 1 file nhạc nền từ thư mục music_dir (nếu được cấu hình)
    let mut selected_music_path: Option<String> = None;
    if let Some(music_dir) = &config.music_dir {
        let m_dir = Path::new(music_dir);
        if m_dir.exists() && m_dir.is_dir() {
            let mut audio_files = Vec::new();
            if let Ok(entries) = std::fs::read_dir(m_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                            let ext_lower = ext.to_lowercase();
                            if matches!(ext_lower.as_str(), "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg") {
                                audio_files.push(path.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }

            if !audio_files.is_empty() {
                // Pick ngẫu nhiên dựa trên timestamp
                let idx = (chrono_now() as usize) % audio_files.len();
                selected_music_path = Some(audio_files[idx].clone());
                tracing::info!("Selected background music: {:?}", selected_music_path);
            }
        }
    }

    let short_id = &job_id[..8.min(job_id.len())];
    let final_output = out_dir.join(format!("final_render_{}.mp4", short_id));
    let final_output_str = final_output.to_string_lossy().to_string();

    let pipeline = crate::executors::audio::AudioPipeline::new(app_handle);
    let cancel_token = tokio_util::sync::CancellationToken::new();

    let res = pipeline
        .render_video_concat(
            &video_paths,
            &job.audio_path,
            selected_music_path.as_deref(),
            Some(config.music_volume),
            &final_output_str,
            &cancel_token,
        )
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;

    let _ = state.db.update_audio_job_status(&job_id, "completed");

    Ok(res.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_tasks(state: State<'_, AppState>) -> Result<Vec<TaskItem>, AppError> {
    state.db.list_tasks()
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppConfig, AppError> {
    state.db.get_config()
}

#[tauri::command]
pub fn save_settings(
    config: AppConfig,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.db.save_config(&config)
}

// ==========================================
// SCRIPTS & CHARACTER BIBLE COMMANDS (Mốc 1)
// ==========================================

#[tauri::command]
pub fn save_script_project(
    script: ScriptProjectItem,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.db.save_script_project(&script)
}

#[tauri::command]
pub fn get_script_project(
    script_id: String,
    state: State<'_, AppState>,
) -> Result<Option<ScriptProjectItem>, AppError> {
    state.db.get_script_project(&script_id)
}

#[tauri::command]
pub fn list_script_projects(
    state: State<'_, AppState>,
) -> Result<Vec<ScriptProjectItem>, AppError> {
    state.db.list_script_projects()
}

#[tauri::command]
pub fn update_script_scene(
    scene: ScriptSceneItem,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.db.update_script_scene(&scene)
}

#[tauri::command]
pub fn update_character_ref_image(
    character_id: String,
    ref_image_path: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.db.update_character_ref_image(&character_id, &ref_image_path)
}

#[tauri::command]
pub fn delete_script_project(
    script_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.db.delete_script_project(&script_id)
}

// ==========================================
// VIENEU-TTS COMMANDS (Mốc 2)
// ==========================================

#[tauri::command]
pub async fn list_tts_voices() -> Result<Vec<crate::executors::tts::VoiceInfo>, AppError> {
    let pipeline = crate::executors::tts::TtsPipeline::new();
    pipeline.list_voices().await.map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn generate_scene_tts(
    scene_id: String,
    text: String,
    voice_id: String,
    speed: Option<f32>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let config = state.db.get_config().unwrap_or_default();
    let out_dir = std::path::PathBuf::from(&config.output_dir).join("tts_voices");
    let _ = std::fs::create_dir_all(&out_dir);

    let output_file = out_dir.join(format!("tts_{}.wav", scene_id));
    let pipeline = crate::executors::tts::TtsPipeline::new();

    let (audio_path, duration_sec) = pipeline
        .synthesize(&scene_id, &text, &voice_id, &output_file, speed.unwrap_or(1.0))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;

    // Cập nhật duration_sec và audio_path vào scene trong DB
    {
        let conn = state.db.conn();
        let _ = conn.execute(
            "UPDATE script_scenes SET audio_path = ?1, duration_sec = ?2 WHERE id = ?3",
            rusqlite::params![audio_path, duration_sec, scene_id],
        );
    }

    Ok(serde_json::json!({
        "audio_path": audio_path,
        "duration_sec": duration_sec
    }))
}

#[tauri::command]
pub async fn preview_tts_voice(
    voice_id: String,
    text: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let config = state.db.get_config().unwrap_or_default();
    let out_dir = std::path::PathBuf::from(&config.output_dir).join("tts_previews");
    let _ = std::fs::create_dir_all(&out_dir);

    let output_file = out_dir.join(format!("preview_{}.wav", voice_id));
    let sample_text = text.unwrap_or_else(|| {
        "Xin chào, đây là giọng đọc thử nghiệm của hệ thống Xí Trùm AI Studio.".to_string()
    });

    let pipeline = crate::executors::tts::TtsPipeline::new();
    let (path, _) = pipeline
        .synthesize("preview", &sample_text, &voice_id, &output_file, 1.0)
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;

    Ok(path)
}

#[tauri::command]
pub async fn generate_whiteboard_srt_tts(
    srt_path: String,
    voice_id: String,
    auto_timing: Option<bool>,
    scene_cue_ranges: Option<Vec<[usize; 2]>>,
    speech_config: Option<serde_json::Value>,
    cues: Option<Vec<serde_json::Value>>,
    _state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let srt_p = std::path::Path::new(&srt_path);
    if !srt_p.exists() {
        return Err(AppError::Other(format!("File SRT không tồn tại: {}", srt_path)));
    }

    // Đặt file audio cùng thư mục với SRT hoặc trong output_dir
    let parent = srt_p.parent().unwrap_or(std::path::Path::new("."));
    let stem = srt_p.file_stem().and_then(|s| s.to_str()).unwrap_or("whiteboard_master");
    let output_file = parent.join(format!("{}_{}_{}.wav", stem, voice_id.replace(' ', "_"), uuid::Uuid::new_v4()));

    let pipeline = crate::executors::tts::TtsPipeline::new();
    pipeline
        .synthesize_srt("whiteboard_srt_tts", srt_p, &voice_id, &output_file,
                        auto_timing.unwrap_or(false), scene_cue_ranges.unwrap_or_default(),
                        speech_config, cues)
        .await
        .map_err(|e| AppError::Other(e.to_string()))
}

// ==========================================
// PROXIES COMMANDS (Mốc 3)
// ==========================================

#[tauri::command]
pub async fn add_proxies(
    text: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let mut added = 0;
    let mut invalid = 0;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Hỗ trợ parse các định dạng:
        // 1. host:port
        // 2. host:port:username:password
        // 3. scheme://username:password@host:port
        // 4. scheme://host:port
        let (scheme, host, port, username, password) = if trimmed.contains("://") {
            if let Ok(url) = url::Url::parse(trimmed) {
                let s = url.scheme().to_string();
                let h = url.host_str().unwrap_or("").to_string();
                let p = url.port().unwrap_or(80) as i32;
                let u = if !url.username().is_empty() {
                    Some(url.username().to_string())
                } else {
                    None
                };
                let pwd = url.password().map(|p| p.to_string());
                (s, h, p, u, pwd)
            } else {
                invalid += 1;
                continue;
            }
        } else {
            let parts: Vec<&str> = trimmed.split(':').collect();
            if parts.len() == 2 {
                let h = parts[0].to_string();
                if let Ok(p) = parts[1].parse::<i32>() {
                    ("http".to_string(), h, p, None, None)
                } else {
                    invalid += 1;
                    continue;
                }
            } else if parts.len() == 4 {
                let h = parts[0].to_string();
                if let Ok(p) = parts[1].parse::<i32>() {
                    let u = Some(parts[2].to_string());
                    let pwd = Some(parts[3].to_string());
                    ("http".to_string(), h, p, u, pwd)
                } else {
                    invalid += 1;
                    continue;
                }
            } else {
                invalid += 1;
                continue;
            }
        };

        if host.is_empty() || port <= 0 {
            invalid += 1;
            continue;
        }

        let raw_masked = if let Some(ref u) = username {
            format!("{}:{}:{}:***", host, port, u)
        } else {
            format!("{}:{}", host, port)
        };

        // Mã hóa mật khẩu an toàn thay vì lưu plain text
        let encrypted_pass = password.as_ref().map(|p| {
            // Base64 xor obfuscation + salt (bảo vệ khỏi nhìn trộm plain text trong SQLite)
            use base64::{engine::general_purpose, Engine as _};
            let salt = b"xitrum_secret_salt_2026";
            let mut xored = Vec::new();
            for (i, b) in p.as_bytes().iter().enumerate() {
                xored.push(b ^ salt[i % salt.len()]);
            }
            general_purpose::STANDARD.encode(xored)
        });

        let name = format!("Proxy {}:{}", host, port);
        if let Ok(inserted_id) = state.db.insert_proxy(
            Some(&name),
            &raw_masked,
            &scheme,
            &host,
            port,
            username.as_deref(),
            encrypted_pass.as_deref(),
        ) {
            // Lưu mật khẩu vào kho bí mật OS Keychain / DPAPI
            if let Some(ref pwd) = password {
                if let Ok(()) = crate::secret_store::SecretStore::set_secret(&format!("proxy_{}", inserted_id), pwd) {
                    // Xóa mật khẩu XOR cũ trong SQLite sau khi đã lưu thành công vào OS Keychain/DPAPI
                    let _ = state.db.conn().execute(
                        "UPDATE proxies SET encrypted_password = NULL WHERE id = ?1",
                        rusqlite::params![inserted_id],
                    );
                }
            }
            added += 1;
        }
    }

    Ok(serde_json::json!({
        "added": added,
        "invalid": invalid
    }))
}

#[tauri::command]
pub fn list_proxies(state: State<'_, AppState>) -> Result<Vec<ProxyItem>, AppError> {
    state.db.list_proxies()
}

#[tauri::command]
pub async fn test_proxy(
    proxy_id: i64,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let proxy = state
        .db
        .get_proxy(proxy_id)?
        .ok_or_else(|| AppError::Other("Proxy không tồn tại".into()))?;

    let _ = state.db.update_proxy_status(proxy_id, "checking", None, None);

    let start = std::time::Instant::now();
    let proxy_url_str = if let Some(ref u) = proxy.username {
        // Ưu tiên lấy mật khẩu an toàn từ kho bí mật OS
        let pass = if let Ok(Some(secret)) = crate::secret_store::SecretStore::get_secret(&format!("proxy_{}", proxy_id)) {
            secret
        } else {
            proxy.encrypted_password.as_ref().map(|enc| {
                use base64::{engine::general_purpose, Engine as _};
                if let Ok(bytes) = general_purpose::STANDARD.decode(enc) {
                    let salt = b"xitrum_secret_salt_2026";
                    let mut unxored = Vec::new();
                    for (i, b) in bytes.iter().enumerate() {
                        unxored.push(b ^ salt[i % salt.len()]);
                    }
                    String::from_utf8_lossy(&unxored).to_string()
                } else {
                    enc.clone()
                }
            }).unwrap_or_default()
        };
        format!("{}://{}:{}@{}:{}", proxy.scheme, u, pass, proxy.host, proxy.port)
    } else {
        format!("{}://{}:{}", proxy.scheme, proxy.host, proxy.port)
    };

    let client_builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8));

    let client = match reqwest::Proxy::all(&proxy_url_str) {
        Ok(p) => client_builder.proxy(p).build().map_err(|e| AppError::Other(e.to_string()))?,
        Err(e) => {
            let _ = state.db.update_proxy_status(proxy_id, "dead", None, None);
            return Ok(serde_json::json!({
                "ok": false,
                "error": e.to_string()
            }));
        }
    };

    // Kiểm tra IP public qua api.ipify.org
    match client.get("https://api.ipify.org?format=json").send().await {
        Ok(resp) => {
            let latency = start.elapsed().as_millis() as i32;
            if resp.status().is_success() {
                let body: serde_json::Value = resp.json().await.unwrap_or_default();
                let ip = body.get("ip").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let _ = state.db.update_proxy_status(proxy_id, "ok", Some(&ip), Some(latency));
                Ok(serde_json::json!({
                    "ok": true,
                    "ip": ip,
                    "latency_ms": latency
                }))
            } else {
                let _ = state.db.update_proxy_status(proxy_id, "dead", None, None);
                Ok(serde_json::json!({
                    "ok": false,
                    "error": format!("HTTP Status: {}", resp.status())
                }))
            }
        }
        Err(e) => {
            let _ = state.db.update_proxy_status(proxy_id, "dead", None, None);
            Ok(serde_json::json!({
                "ok": false,
                "error": e.to_string()
            }))
        }
    }
}

#[tauri::command]
pub fn delete_proxy(proxy_id: i64, state: State<'_, AppState>) -> Result<(), AppError> {
    state.db.delete_proxy(proxy_id)
}

#[tauri::command]
pub fn delete_dead_proxies(state: State<'_, AppState>) -> Result<usize, AppError> {
    state.db.delete_dead_proxies()
}

// ==========================================
// MỐC 4: NỐI KỊCH BẢN VÀO HÀNG ĐỢI TASK (QUEUE)
// ==========================================

#[tauri::command]
pub async fn dispatch_script_to_queue(
    script_id: String,
    provider: Option<String>,
    account_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let script = state
        .db
        .get_script_project(&script_id)?
        .ok_or_else(|| AppError::Other("Không tìm thấy dự án kịch bản".into()))?;

    // Tạo map tra cứu nhân vật: name -> (description, ref_image_path, identity_lock_en)
    let char_map: std::collections::HashMap<String, (String, Option<String>, Option<String>)> = script
        .characters
        .iter()
        .map(|c| (c.name.trim().to_lowercase(), (c.description.clone(), c.ref_image_path.clone(), c.identity_lock_en.clone())))
        .collect();

    // Tạo map tra cứu sản phẩm: id -> product_lock_en
    let prod_map: std::collections::HashMap<String, Option<String>> = script
        .products
        .iter()
        .map(|p| (p.id.clone(), p.product_lock_en.clone()))
        .collect();

    let mut queued_count = 0;
    let mut task_ids = Vec::new();

    for scene in &script.scenes {
        // Kết hợp prompt: video_prompt (hoặc visual_prompt nếu video_prompt trống)
        let mut final_prompt = if !scene.video_prompt.trim().is_empty() {
            scene.video_prompt.trim().to_string()
        } else {
            scene.visual_prompt.trim().to_string()
        };

        // Xác định ảnh tham chiếu khuôn mặt (ưu tiên từ scene, sau đó từ Character Bible)
        let mut char_ref_img = scene.ref_image_path.clone();

        let mut scene_char_lock: Option<String> = None;
        if let Some(ref char_name) = scene.character {
            let key = char_name.trim().to_lowercase();
            if let Some((desc, char_img, char_lock)) = char_map.get(&key) {
                if !desc.trim().is_empty() && !final_prompt.contains(desc) {
                    final_prompt = format!("{}, Character: {}", final_prompt, desc);
                }
                if char_ref_img.is_none() && char_img.is_some() {
                    char_ref_img = char_img.clone();
                }
                if let Some(l) = char_lock {
                    if !l.trim().is_empty() {
                        scene_char_lock = Some(l.trim().to_string());
                    }
                }
            }
        }

        // Phase 2: Ráp camera moves và visual style
        let mut camera_style_parts: Vec<&str> = Vec::new();
        for m in &scene.camera_moves {
            let phrase = match m.as_str() {
                "drone" => "aerial drone shot",
                "slow_motion" => "slow motion",
                "dolly_in" => "dolly in",
                "pan" => "panning shot",
                "orbit" => "orbit shot",
                "tracking" => "tracking shot",
                "handheld" => "handheld",
                "timelapse" => "time-lapse",
                "static" => "static shot",
                "crane" => "crane shot",
                _ => "",
            };
            if !phrase.is_empty() && !final_prompt.to_lowercase().contains(phrase) {
                camera_style_parts.push(phrase);
            }
        }

        if let Some(ref st) = scene.style {
            let style_phrase = match st.as_str() {
                "cinematic" => "cinematic, film grain",
                "documentary" => "documentary, realistic",
                "commercial" => "high-end commercial",
                "anime" => "2D anime style",
                "vintage" => "vintage film",
                "dreamy" => "dreamy, soft light",
                "noir" => "black and white noir",
                _ => "",
            };
            if !style_phrase.is_empty() && !final_prompt.to_lowercase().contains(style_phrase) {
                camera_style_parts.push(style_phrase);
            }
        }

        if !camera_style_parts.is_empty() {
            final_prompt = format!("{}, {}", final_prompt, camera_style_parts.join(", "));
        }

        // Phase 3: Dán câu khóa (Prompt Lock Descriptors)
        if let Some(ref lock_str) = scene_char_lock {
            if !final_prompt.contains(lock_str) {
                final_prompt = format!("{}\n\nCharacter — keep exactly the same in every scene:\n{}", final_prompt, lock_str);
            }
        }

        if let Some(ref p_id) = scene.product_id {
            if let Some(Some(ref prod_lock)) = prod_map.get(p_id) {
                if !prod_lock.trim().is_empty() && !final_prompt.contains(prod_lock.trim()) {
                    final_prompt = format!("{}\n\nProduct — keep exactly the same in every scene:\n{}", final_prompt, prod_lock.trim());
                }
            }
        }

        if let Some(ref env_lock) = script.environment_lock_en {
            if !env_lock.trim().is_empty() && !final_prompt.contains(env_lock.trim()) {
                final_prompt = format!("{}\n\nSetting — keep exactly the same in every scene:\n{}", final_prompt, env_lock.trim());
            }
        }

        // Tạo task trong queue (idempotent: chống spam đúp khi click liên tiếp)
        let task = state
            .queue
            .enqueue_with_account(
                TaskKind::MuseVideo,
                Some(final_prompt),
                Some(script.ratio.clone()),
                char_ref_img,
                provider.clone().or_else(|| Some("muse".into())),
                None,
                Some(1),
                account_id.clone(),
                false, // không gửi trùng nếu đã có cùng generation key
            )
            .await?;

        // Ghi nhận queue_task_id vào scene
        state
            .db
            .update_script_scene_task(&scene.id, &task.id)?;

        task_ids.push(task.id);
        queued_count += 1;
    }

    // Đánh dấu trạng thái kịch bản là queued
    state.db.update_script_status(&script.id, "queued")?;

    Ok(serde_json::json!({
        "ok": true,
        "script_id": script.id,
        "queued_count": queued_count,
        "task_ids": task_ids,
    }))
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct AnalyzeImageResult {
    pub ok: bool,
    pub descriptor: Option<String>,
    pub message: String,
}

#[tauri::command]
pub async fn analyze_image(
    image_path: String,
    kind: String, // "character", "product", "environment"
    gemini_api_key: Option<String>,
) -> Result<AnalyzeImageResult, AppError> {
    // Ưu tiên đọc key từ OS Secret Store (Keychain/DPAPI); nếu không có thì dùng param từ request
    let key = if let Ok(Some(secret)) = crate::secret_store::SecretStore::get_secret("gemini_api_key") {
        secret
    } else {
        gemini_api_key.unwrap_or_default().trim().to_string()
    };

    if key.is_empty() {
        return Ok(AnalyzeImageResult {
            ok: false,
            descriptor: None,
            message: "Chưa cấu hình Gemini API Key trong Kho bảo mật hệ điều hành. Hãy lưu API key trong Cài Đặt.".to_string(),
        });
    }

    let p = std::path::Path::new(&image_path);
    if !p.exists() {
        return Ok(AnalyzeImageResult {
            ok: false,
            descriptor: None,
            message: format!("Không tìm thấy file ảnh: {}", image_path),
        });
    }

    let img_bytes = tokio::fs::read(&image_path)
        .await
        .map_err(|e| AppError::Other(format!("Không đọc được ảnh: {}", e)))?;

    use base64::{engine::general_purpose, Engine as _};
    let b64 = general_purpose::STANDARD.encode(&img_bytes);

    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    let mime_type = match ext.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/jpeg",
    };

    let prompt_instruction = match kind.as_str() {
        "character" => "You are an expert AI vision analyst for video generation consistency. Analyze the human character in this image. Write exactly ONE concise, comprehensive English sentence describing the character to lock their visual identity across scenes. Include apparent age, gender, facial traits, hair color/style, skin tone, clothing items/colors, and expression. Do NOT guess or hallucinate unseen details. If a detail is unclear, omit it or state 'not clear'. Output ONLY valid JSON: {\"identity_lock_en\": \"<description sentence>\"}.",
        "product" => "You are an expert AI vision analyst for commercial video generation consistency. Analyze the product in this image. Write exactly ONE concise, comprehensive English sentence describing the product to lock its packaging, color, shape, materials, visible labels/text, and key visual features across scenes. Do NOT hallucinate unseen text or claims. Output ONLY valid JSON: {\"product_lock_en\": \"<description sentence>\"}.",
        _ => "You are an expert AI vision analyst for video generation consistency. Analyze the environment/setting in this image. Write exactly ONE concise English sentence describing the background room, lighting setup, color palette, and key props to lock the scene consistency. Output ONLY valid JSON: {\"environment_lock_en\": \"<description sentence>\"}.",
    };

    let payload = serde_json::json!({
        "contents": [{
            "parts": [
                { "text": prompt_instruction },
                {
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": b64
                    }
                }
            ]
        }],
        "generationConfig": {
            "temperature": 0.2,
            "response_mime_type": "application/json"
        }
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Other(format!("Lỗi tạo HTTP client: {}", e)))?;

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}",
        key
    );

    let resp = match client.post(&url).json(&payload).send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(AnalyzeImageResult {
                ok: false,
                descriptor: None,
                message: format!("Không kết nối được Gemini API: {}", e),
            });
        }
    };

    if !resp.status().is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        return Ok(AnalyzeImageResult {
            ok: false,
            descriptor: None,
            message: format!("Gemini API trả về lỗi: {}", err_body),
        });
    }

    let json_resp: serde_json::Value = resp.json().await.map_err(|e| AppError::Other(e.to_string()))?;
    let text_content = json_resp
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let parsed_desc: serde_json::Value = serde_json::from_str(text_content).unwrap_or_default();
    let lock_key = match kind.as_str() {
        "character" => "identity_lock_en",
        "product" => "product_lock_en",
        _ => "environment_lock_en",
    };

    let descriptor = parsed_desc.get(lock_key).and_then(|v| v.as_str()).map(|s| s.trim().to_string());

    if let Some(desc) = descriptor {
        if !desc.is_empty() {
            return Ok(AnalyzeImageResult {
                ok: true,
                descriptor: Some(desc),
                message: "Phân tích và tạo câu khóa thành công!".to_string(),
            });
        }
    }

    Ok(AnalyzeImageResult {
        ok: false,
        descriptor: None,
        message: "Gemini trả về kết quả nhưng không có trường khóa hợp lệ. Vui lòng thử lại hoặc nhập tay.".to_string(),
    })
}

// ==========================================
// MỐC 5: HẬU KỲ HOÀN CHỈNH (FFMPEG MERGE & POST-PRODUCTION)
// ==========================================


#[tauri::command]
pub async fn render_script_postproduction(
    script_id: String,
    burn_subtitles: bool,
    mode: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    use tauri_plugin_shell::ShellExt;
    use crate::render_planner::{RenderPlanner, RenderPlanItem};

    let script = state
        .db
        .get_script_project(&script_id)?
        .ok_or_else(|| AppError::Other("Không tìm thấy dự án kịch bản".into()))?;

    if script.scenes.is_empty() {
        return Err(AppError::Other("Kịch bản không có phân cảnh nào để ghép".into()));
    }

    let render_mode = mode.unwrap_or_else(|| "preview".to_string());

    let config = state.db.get_config().unwrap_or_default();
    let out_dir = Path::new(&config.output_dir);
    if !out_dir.exists() {
        let _ = std::fs::create_dir_all(out_dir);
    }

    let temp_dir = std::env::temp_dir();
    let unique_id = uuid::Uuid::new_v4().to_string();
    let short_id = &unique_id[..8];

    // 1. Chuyển đổi scenes sang RenderPlanItems để tính toán timeline integer ms
    let mut plan_items = Vec::new();
    for (idx, scene) in script.scenes.iter().enumerate() {
        plan_items.push(RenderPlanItem {
            scene_index: idx,
            scene_id: scene.id.clone(),
            video_path: scene.video_path.as_ref().map(PathBuf::from),
            audio_path: scene.audio_path.as_ref().map(PathBuf::from),
            configured_duration_ms: (scene.duration_sec.max(2.0) * 1000.0) as u64,
            narration: scene.narration.clone(),
        });
    }

    // 2. Tạo RenderManifest bằng RenderPlanner (chuẩn hóa mốc thời gian ms, kiểm tra clip thiếu)
    let manifest = RenderPlanner::create_render_plan(
        &app_handle,
        &script.id,
        &render_mode,
        &script.ratio,
        &plan_items,
    )
    .await
    .map_err(|e| AppError::Other(e))?;

    let mut temp_files_to_clean: Vec<PathBuf> = Vec::new();

    // 3. Chuẩn hóa từng clip video theo chuẩn: scale/pad SAR 1:1, fps=30, yuv420p, freeze frame nếu ngắn
    let mut normalized_video_clips: Vec<String> = Vec::new();
    for (idx, sc) in manifest.scenes.iter().enumerate() {
        let norm_v_path = temp_dir.join(format!("norm_video_{}_{}.mp4", short_id, idx));
        let norm_v_str = norm_v_path.to_string_lossy().to_string();
        temp_files_to_clean.push(norm_v_path.clone());

        let norm_args = RenderPlanner::build_video_normalization_args(
            sc.source_video_path.as_deref(),
            sc.target_duration_ms,
            sc.video_duration_ms,
            manifest.canvas_width,
            manifest.canvas_height,
            idx,
            &norm_v_str,
        );
        let arg_refs: Vec<&str> = norm_args.iter().map(|s| s.as_str()).collect();

        let norm_res = app_handle
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| AppError::Other(format!("FFmpeg error: {e}")))?
            .args(arg_refs)
            .output()
            .await
            .map_err(|e| AppError::Other(format!("Lỗi chuẩn hóa video cảnh {}: {e}", idx + 1)))?;

        if !norm_res.status.success() {
            let err = String::from_utf8_lossy(&norm_res.stderr);
            return Err(AppError::Other(format!("Normalize video cảnh {} thất bại: {err}", idx + 1)));
        }

        normalized_video_clips.push(norm_v_str);
    }

    // 4. Ghép toàn bộ video clips đã chuẩn hóa (bảo đảm đồng nhất frame rate, size, SAR)
    let concat_v_list_file = temp_dir.join(format!("concat_v_list_{}.txt", short_id));
    let mut concat_v_txt = String::new();
    for clip in &normalized_video_clips {
        concat_v_txt.push_str(&format!("file '{}'\n", clip.replace('\\', "/")));
    }
    std::fs::write(&concat_v_list_file, &concat_v_txt)
        .map_err(|e| AppError::Other(format!("Lỗi ghi file danh sách video concat: {e}")))?;
    temp_files_to_clean.push(concat_v_list_file.clone());

    let raw_concat_video = temp_dir.join(format!("raw_video_{}.mp4", short_id));
    let raw_concat_video_str = raw_concat_video.to_string_lossy().to_string();
    temp_files_to_clean.push(raw_concat_video.clone());

    let concat_output = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| AppError::Other(format!("FFmpeg error: {e}")))?
        .args([
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", &concat_v_list_file.to_string_lossy(),
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-r", "30",
            &raw_concat_video_str,
        ])
        .output()
        .await
        .map_err(|e| AppError::Other(format!("Lỗi ghép video scenes: {e}")))?;

    if !concat_output.status.success() {
        let err = String::from_utf8_lossy(&concat_output.stderr);
        return Err(AppError::Other(format!("Concat video failed: {err}")));
    }

    // 5. Chuẩn hóa và ghép từng clip audio (resample 44100Hz, stereo, pad đuôi)
    let mut normalized_audio_clips: Vec<String> = Vec::new();
    let mut has_any_real_tts = false;
    for (idx, sc) in manifest.scenes.iter().enumerate() {
        let norm_a_path = temp_dir.join(format!("norm_audio_{}_{}.wav", short_id, idx));
        let norm_a_str = norm_a_path.to_string_lossy().to_string();
        temp_files_to_clean.push(norm_a_path.clone());

        if sc.source_audio_path.is_some() {
            has_any_real_tts = true;
        }

        let a_args = RenderPlanner::build_audio_normalization_args(
            sc.source_audio_path.as_deref(),
            sc.target_duration_ms,
            &norm_a_str,
        );
        let a_refs: Vec<&str> = a_args.iter().map(|s| s.as_str()).collect();

        let a_res = app_handle
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| AppError::Other(format!("FFmpeg error: {e}")))?
            .args(a_refs)
            .output()
            .await
            .map_err(|e| AppError::Other(format!("Lỗi chuẩn hóa âm thanh cảnh {}: {e}", idx + 1)))?;

        if !a_res.status.success() {
            let err = String::from_utf8_lossy(&a_res.stderr);
            return Err(AppError::Other(format!("Normalize audio cảnh {} thất bại: {err}", idx + 1)));
        }

        normalized_audio_clips.push(norm_a_str);
    }

    let concat_a_list_file = temp_dir.join(format!("concat_a_list_{}.txt", short_id));
    let mut concat_a_txt = String::new();
    for a_clip in &normalized_audio_clips {
        concat_a_txt.push_str(&format!("file '{}'\n", a_clip.replace('\\', "/")));
    }
    std::fs::write(&concat_a_list_file, &concat_a_txt)
        .map_err(|e| AppError::Other(format!("Lỗi ghi file danh sách audio concat: {e}")))?;
    temp_files_to_clean.push(concat_a_list_file.clone());

    let full_tts_audio = temp_dir.join(format!("full_tts_{}.wav", short_id));
    let full_tts_audio_str = full_tts_audio.to_string_lossy().to_string();
    temp_files_to_clean.push(full_tts_audio.clone());

    let a_concat_res = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| AppError::Other(format!("FFmpeg error: {e}")))?
        .args([
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", &concat_a_list_file.to_string_lossy(),
            "-c:a", "pcm_s16le",
            &full_tts_audio_str,
        ])
        .output()
        .await
        .map_err(|e| AppError::Other(format!("Lỗi ghép nối track âm thanh: {e}")))?;

    if !a_concat_res.status.success() {
        let err = String::from_utf8_lossy(&a_concat_res.stderr);
        return Err(AppError::Other(format!("Concat audio failed: {err}")));
    }

    // 6. Sinh phụ đề SRT chính xác 100% từ RenderManifest timeline
    let srt_content = RenderPlanner::generate_srt_from_manifest(&manifest);
    let srt_file = out_dir.join(format!("{}_{}.srt", script.title.replace(' ', "_"), short_id));
    let srt_file_str = srt_file.to_string_lossy().to_string();
    std::fs::write(&srt_file, srt_content)
        .map_err(|e| AppError::Other(format!("Lỗi lưu file phụ đề SRT: {e}")))?;

    // 7. Kiểm tra BGM
    let mut selected_music_path: Option<String> = None;
    if let Some(ref music_dir) = config.music_dir {
        let dir_p = Path::new(music_dir);
        if dir_p.is_dir() {
            if let Ok(entries) = std::fs::read_dir(dir_p) {
                let mut valid_tracks: Vec<PathBuf> = Vec::new();
                for entry in entries.flatten() {
                    let p = entry.path();
                    if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                        let ext_lower = ext.to_lowercase();
                        if ext_lower == "mp3" || ext_lower == "wav" || ext_lower == "m4a" {
                            valid_tracks.push(p);
                        }
                    }
                }
                valid_tracks.sort();
                if let Some(first_track) = valid_tracks.first() {
                    selected_music_path = Some(first_track.to_string_lossy().to_string());
                }
            }
        }
    }

    // 8. Xuất video hoàn chỉnh
    let safe_title = script.title.replace(|c: char| !c.is_alphanumeric() && c != '_' && c != '-', "_");
    let final_mp4 = out_dir.join(format!("{}_{}.mp4", safe_title, short_id));
    let final_mp4_str = final_mp4.to_string_lossy().to_string();

    let mut final_args: Vec<String> = vec![
        "-y".into(),
        "-i".into(),
        raw_concat_video_str.clone(),
        "-i".into(),
        full_tts_audio_str.clone(),
    ];

    let has_bgm = selected_music_path.is_some();
    if let Some(ref bgm) = selected_music_path {
        final_args.push("-stream_loop".into());
        final_args.push("-1".into());
        final_args.push("-i".into());
        final_args.push(bgm.clone());
    }

    let mut filter_complex = String::new();
    let vol = config.music_volume.clamp(0.01, 1.0);

    if has_bgm {
        filter_complex.push_str(&format!(
            "[2:a]volume={:.2}[bgm_pre];[1:a]asplit=2[voice_main][voice_side];[bgm_pre][voice_side]sidechaincompress=threshold=0.125:ratio=4:attack=50:release=1000[bgm_ducked];[voice_main][bgm_ducked]amix=inputs=2:duration=first:dropout_transition=2[aout]",
            vol
        ));
    } else {
        filter_complex.push_str("[1:a]anull[aout]");
    }

    let srt_escaped = srt_file_str.replace('\\', "/").replace(':', "\\:");
    let mut video_map = "0:v:0".to_string();
    if burn_subtitles {
        filter_complex.push_str(&format!(";[0:v]subtitles='{}':force_style='FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2'[vout]", srt_escaped));
        video_map = "[vout]".to_string();
    }

    final_args.push("-filter_complex".into());
    final_args.push(filter_complex);
    final_args.push("-map".into());
    final_args.push(video_map);
    final_args.push("-map".into());
    final_args.push("[aout]".into());

    final_args.push("-c:v".into());
    final_args.push("libx264".into());
    final_args.push("-pix_fmt".into());
    final_args.push("yuv420p".into());
    final_args.push("-c:a".into());
    final_args.push("aac".into());
    final_args.push("-b:a".into());
    final_args.push("192k".into());
    final_args.push("-shortest".into());
    final_args.push(final_mp4_str.clone());

    let final_arg_refs: Vec<&str> = final_args.iter().map(|s| s.as_str()).collect();

    let render_res = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| AppError::Other(format!("FFmpeg error: {e}")))?
        .args(final_arg_refs)
        .output()
        .await
        .map_err(|e| AppError::Other(format!("Lỗi xuất video hoàn chỉnh: {e}")))?;

    if !render_res.status.success() {
        let err = String::from_utf8_lossy(&render_res.stderr);
        // Luôn dọn file tạm khi gặp lỗi
        for p in &temp_files_to_clean {
            let _ = std::fs::remove_file(p);
        }
        return Err(AppError::Other(format!("FFmpeg render failed: {err}")));
    }

    // Dọn file tạm sau khi thành công
    for p in &temp_files_to_clean {
        let _ = std::fs::remove_file(p);
    }

    // Cập nhật trạng thái kịch bản thành "done"
    state.db.update_script_status(&script.id, "done")?;

    Ok(serde_json::json!({
        "ok": true,
        "video_path": final_mp4_str,
        "srt_path": srt_file_str,
        "has_tts": has_any_real_tts,
        "has_bgm": has_bgm,
        "burned_subtitles": burn_subtitles,
        "mode": manifest.mode,
        "total_duration_ms": manifest.total_duration_ms,
        "placeholder_count": manifest.placeholder_count,
        "warnings": manifest.warnings,
    }))
}



// ==========================================
// G3: KHUNG PROVIDER & ACCOUNT MANAGEMENT
// ==========================================

#[tauri::command]
pub async fn list_provider_descriptors(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderDescriptor>, AppError> {
    Ok(state.queue.provider_registry.list_descriptors().await)
}

#[tauri::command]
pub fn list_accounts(
    provider: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<AccountItem>, AppError> {
    state.db.list_accounts(provider.as_deref())
}

#[tauri::command]
pub fn save_account(
    account: AccountItem,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // Nếu account đã tồn tại thì update, ngược lại insert
    if let Ok(Some(_existing)) = state.db.get_account(&account.id) {
        state.db.update_account(&account)?;
    } else {
        state.db.insert_account(&account)?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_account(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.db.delete_account(&id)
}

#[tauri::command]
pub async fn check_account_session(
    id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let account = state
        .db
        .get_account(&id)?
        .ok_or_else(|| AppError::NotFound(format!("Không tìm thấy tài khoản '{}'", id)))?;

    let adapter = state
        .queue
        .provider_registry
        .get(&account.provider)
        .await
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "Không tìm thấy adapter cho provider '{}'",
                account.provider
            ))
        })?;

    let (ok, msg) = adapter.check_session(&account).await?;
    let now = chrono_now();

    // Cập nhật trạng thái và thời điểm kiểm tra của account
    let mut updated_acc = account.clone();
    updated_acc.readiness = if ok { "ready".to_string() } else { "login_required".to_string() };
    updated_acc.last_checked_at = Some(now);
    let _ = state.db.update_account(&updated_acc);

    Ok(serde_json::json!({
        "ok": ok,
        "message": msg,
        "account_id": id,
        "readiness": updated_acc.readiness,
        "checked_at": now
    }))
}

// ==========================================
// WHITEBOARD ANIMATION COMMANDS (F16)
// ==========================================

/// Chạy tác vụ Python chặn (có thể kéo dài nhiều phút) trên luồng blocking riêng, không giữ
/// luồng async của Tauri.
async fn whiteboard_blocking<T, F>(f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> anyhow::Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(format!("Luồng Whiteboard bị lỗi: {}", e)))?
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn parse_whiteboard_srt(
    srt_path: String,
    exact_cues: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let wb = Arc::clone(&state.whiteboard);
    let exact = exact_cues.unwrap_or(false);
    whiteboard_blocking(move || wb.parse_srt(srt_path, exact)).await
}

#[tauri::command]
pub async fn inspect_whiteboard_wb_import(
    srt_path: String,
    wb_json_path: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let wb = Arc::clone(&state.whiteboard);
    whiteboard_blocking(move || wb.inspect_wb_import(srt_path, wb_json_path)).await
}

#[tauri::command]
pub async fn generate_whiteboard_annotation(
    image_path: String,
    scene_id: Option<String>,
    story_basis: Option<String>,
    duration_ms: Option<i64>,
    cues: Option<Vec<serde_json::Value>>,
    output_path: Option<String>,
    overwrite: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let wb = Arc::clone(&state.whiteboard);
    whiteboard_blocking(move || {
        wb.generate_annotation(
            image_path,
            scene_id.unwrap_or_else(|| "scene-01".to_string()),
            story_basis.unwrap_or_default(),
            duration_ms.unwrap_or(10000),
            cues.unwrap_or_default(),
            output_path,
            overwrite.unwrap_or(false),
        )
    })
    .await
}

/// Phân tích phong cách ảnh (W3)
#[tauri::command]
pub async fn analyze_whiteboard_image(
    image_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let wb = Arc::clone(&state.whiteboard);
    whiteboard_blocking(move || wb.analyze_image_style(image_path)).await
}

/// Sự kiện `whiteboard-progress`: `{ type:"progress", task_id, percent (0-100), message }`.
#[tauri::command]
pub async fn render_whiteboard_scene(
    image_path: String,
    annotation_path: String,
    output_path: String,
    fps: Option<i32>,
    paper_color: Option<String>,
    hand_path: Option<String>,
    audio_path: Option<String>,
    ink_path: Option<String>,
    color_fill: Option<String>,
    ink_weight: Option<f64>,
    color_weight: Option<f64>,
    duration_ms: Option<i64>,
    subject_first: Option<bool>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let wb = Arc::clone(&state.whiteboard);
    whiteboard_blocking(move || {
        wb.render_scene(
            image_path,
            annotation_path,
            output_path,
            fps.unwrap_or(30),
            paper_color.unwrap_or_else(|| "#F5EBD7".to_string()),
            hand_path,
            audio_path,
            ink_path,
            color_fill,
            ink_weight,
            color_weight,
            duration_ms,
            subject_first,
            &|p| {
                let _ = app.emit("whiteboard-progress", p.clone());
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn render_whiteboard_preview(
    image_path: String,
    annotation_path: String,
    output_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let wb = Arc::clone(&state.whiteboard);
    whiteboard_blocking(move || {
        wb.render_preview(image_path, annotation_path, output_path)
    })
    .await
}

#[tauri::command]
pub async fn merge_whiteboard_scenes(
    video_paths: Vec<String>,
    output_path: String,
    master_audio_path: Option<String>,
    page_turn_ms: Option<u32>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let wb = Arc::clone(&state.whiteboard);
    whiteboard_blocking(move || {
        wb.merge_scenes(video_paths, output_path, master_audio_path, None, page_turn_ms, &|p| {
            let _ = app.emit("whiteboard-progress", p.clone());
        })
    })
    .await
}

/// Dừng thao tác Whiteboard đang chạy (render, ghép, cài môi trường). Runner được khởi động lại ở lần gọi sau.
#[tauri::command]
pub async fn cancel_whiteboard(state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    state.whiteboard.cancel();
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WhiteboardSceneItem {
    pub id: String,
    pub order: i32,
    pub revision: i32,
    #[serde(rename = "imagePath")]
    pub image_path: String,
    #[serde(rename = "annotationPath")]
    pub annotation_path: String,
    #[serde(rename = "timelineStartMs")]
    pub timeline_start_ms: i64,
    #[serde(rename = "timelineEndMs")]
    pub timeline_end_ms: i64,
    #[serde(rename = "durationMs")]
    pub duration_ms: i64,
    #[serde(rename = "speechEndMs", default, skip_serializing_if = "Option::is_none")]
    pub speech_end_ms: Option<i64>,
    #[serde(default)]
    pub cues: Vec<serde_json::Value>,
    pub status: String,
    #[serde(rename = "audioPath", skip_serializing_if = "Option::is_none")]
    pub audio_path: Option<String>,
    #[serde(rename = "outputPath", skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(rename = "imageType", skip_serializing_if = "Option::is_none")]
    pub image_type: Option<String>,
    #[serde(rename = "inkPath", skip_serializing_if = "Option::is_none")]
    pub ink_path: Option<String>,
    #[serde(rename = "colorFill", skip_serializing_if = "Option::is_none")]
    pub color_fill: Option<String>,
    #[serde(rename = "inkWeight", skip_serializing_if = "Option::is_none")]
    pub ink_weight: Option<f64>,
    #[serde(rename = "colorWeight", skip_serializing_if = "Option::is_none")]
    pub color_weight: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(rename = "randomSeed", default)]
    pub random_seed: Option<u32>,
    #[serde(rename = "styleMode", default)]
    pub style_mode: Option<String>,
    #[serde(rename = "subjectFirst", default)]
    pub subject_first: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elements: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhiteboardThumbnailDraft {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_choice: Option<String>,
    pub title: String,
    pub image_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhiteboardThumbnail {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_choice: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typography_version: Option<u32>,
    pub title: String,
    pub image_path: String,
    pub pen_type: String,
    pub png_data_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aspect_ratio: Option<String>,
}

fn thumbnail_png(thumbnail: &WhiteboardThumbnail) -> anyhow::Result<String> {
    use base64::{engine::general_purpose, Engine as _};
    let is_imported = thumbnail.mode.as_deref() == Some("imported");
    if !is_imported {
        anyhow::ensure!(!thumbnail.title.trim().is_empty(), "Thumbnail thiếu tiêu đề");
    }
    let encoded = thumbnail.png_data_url.strip_prefix("data:image/png;base64,")
        .ok_or_else(|| anyhow::anyhow!("Thumbnail phải là PNG"))?;
    anyhow::ensure!(encoded.len() <= 24 * 1024 * 1024, "Thumbnail quá lớn");
    let bytes = general_purpose::STANDARD.decode(encoded)?;
    let reader = image::ImageReader::new(std::io::Cursor::new(&bytes)).with_guessed_format()?;
    let is_png = reader.format() == Some(image::ImageFormat::Png);
    let dims = reader.into_dimensions()?;
    anyhow::ensure!(
        is_png && (dims == (1280, 720) || dims == (720, 1280)),
        "Thumbnail phải là PNG kích thước 1280×720 (16:9) hoặc 720×1280 (9:16)"
    );
    Ok(encoded.to_string())
}

/// Read local cover/scene images through IPC rather than relying on asset:// canvas CORS.
#[tauri::command]
pub async fn read_whiteboard_cover_image(image_path: String, app: tauri::AppHandle) -> Result<String, AppError> {
    whiteboard_blocking(move || {
        use base64::{engine::general_purpose, Engine as _};
        let mut path = PathBuf::from(&image_path);
        if !path.is_absolute() {
            anyhow::ensure!(path.components().count() == 1, "Tên asset bút không hợp lệ");
            let runner = crate::paths::PathResolver::resolve_whiteboard_runner(&app)
                .ok_or_else(|| anyhow::anyhow!("Không tìm thấy tài nguyên whiteboard"))?;
            path = runner.parent().unwrap().join("assets").join(path);
        }
        anyhow::ensure!(std::fs::metadata(&path)?.len() <= 32 * 1024 * 1024, "Ảnh bìa vượt 32 MB");
        let mut reader = image::ImageReader::open(&path)?.with_guessed_format()?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(16384);
        limits.max_image_height = Some(16384);
        limits.max_alloc = Some(256 * 1024 * 1024);
        reader.limits(limits);
        let image = reader.decode()?.thumbnail(1600, 1600);
        let mut png = std::io::Cursor::new(Vec::new());
        image.write_to(&mut png, image::ImageFormat::Png)?;
        Ok(format!("data:image/png;base64,{}", general_purpose::STANDARD.encode(png.into_inner())))
    }).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhiteboardFolderImageItem {
    pub path: String,
    pub filename: String,
    pub stem: String,
    pub extension: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aspect_ratio: Option<String>,
    pub file_size: u64,
    pub fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhiteboardSceneImageMapping {
    pub scene_index: usize,
    pub scene_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_image_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_image: Option<WhiteboardFolderImageItem>,
    pub candidate_images: Vec<WhiteboardFolderImageItem>,
    pub status: String, // "ready" | "missing" | "duplicate" | "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhiteboardFolderScanResult {
    pub folder_path: String,
    pub total_files_scanned: usize,
    pub matched_scenes_count: usize,
    pub mappings: Vec<WhiteboardSceneImageMapping>,
    pub thumbnail_candidates: Vec<WhiteboardFolderImageItem>,
    pub excess_images: Vec<WhiteboardFolderImageItem>,
    pub ignored_files: Vec<String>,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn scan_whiteboard_folder_images(
    folder_path: String,
    scenes_count: usize,
    scene_ids: Vec<String>,
    current_image_paths: Option<Vec<Option<String>>>,
) -> Result<WhiteboardFolderScanResult, AppError> {
    whiteboard_blocking(move || {
        use std::path::Path;
        let p = Path::new(&folder_path);
        anyhow::ensure!(p.is_dir(), "Đường dẫn không phải thư mục: {}", folder_path);

        let errors = Vec::new();
        let mut ignored_files = Vec::new();
        let mut thumbnail_candidates = Vec::new();
        let mut excess_images = Vec::new();
        let mut numbered_images: std::collections::BTreeMap<usize, Vec<WhiteboardFolderImageItem>> = std::collections::BTreeMap::new();
        let mut total_files = 0;

        let entries = std::fs::read_dir(p)?;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            total_files += 1;
            let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let ext = path.extension().unwrap_or_default().to_string_lossy().to_lowercase();
            let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
            let stem_lower = stem.to_lowercase();

            if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp") {
                ignored_files.push(filename);
                continue;
            }

            let file_size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let mut width = None;
            let mut height = None;
            let mut aspect_ratio = None;
            let mut item_error = None;

            match image::ImageReader::open(&path)
                .map_err(|e| anyhow::anyhow!(e))
                .and_then(|r| r.with_guessed_format().map_err(|e| anyhow::anyhow!(e)))
                .and_then(|r| r.into_dimensions().map_err(|e| anyhow::anyhow!(e)))
            {
                Ok((w, h)) => {
                    width = Some(w);
                    height = Some(h);
                    let ar = if h > w { "9:16" } else { "16:9" };
                    aspect_ratio = Some(ar.to_string());
                }
                Err(e) => {
                    item_error = Some(format!("Không thể đọc kích thước ảnh: {e}"));
                }
            }

            let fingerprint = if file_size <= 64 * 1024 * 1024 {
                use sha2::{Digest, Sha256};
                std::fs::read(&path).map(|b| format!("{:x}", Sha256::digest(&b))).unwrap_or_default()
            } else {
                format!("size-{}", file_size)
            };

            let item = WhiteboardFolderImageItem {
                path: path.to_string_lossy().to_string(),
                filename: filename.clone(),
                stem: stem.clone(),
                extension: ext.clone(),
                width,
                height,
                aspect_ratio,
                file_size,
                fingerprint,
                error: item_error,
            };

            if stem_lower == "thumb" || stem_lower == "thumbnail" || stem_lower == "cover"
                || stem_lower.starts_with("thumb-") || stem_lower.starts_with("thumb_")
                || stem_lower.starts_with("thumbnail-") || stem_lower.starts_with("thumbnail_") {
                thumbnail_candidates.push(item);
                continue;
            }

            if !stem.is_empty() && stem.chars().all(|c| c.is_ascii_digit()) {
                if let Ok(num) = stem.parse::<usize>() {
                    if num > 0 {
                        if num <= scenes_count {
                            numbered_images.entry(num).or_default().push(item);
                        } else {
                            excess_images.push(item);
                        }
                        continue;
                    }
                }
            }

            ignored_files.push(filename);
        }

        let mut mappings = Vec::new();
        let mut matched_count = 0;
        let curr_paths = current_image_paths.unwrap_or_default();

        for i in 1..=scenes_count {
            let scene_id = scene_ids.get(i - 1).cloned().unwrap_or_else(|| format!("scene-{:02}", i));
            let current_image_path = curr_paths.get(i - 1).and_then(|opt| opt.clone());

            let candidates = numbered_images.remove(&i).unwrap_or_default();
            let (status, matched, error) = if candidates.is_empty() {
                ("missing".to_string(), None, None)
            } else if candidates.len() == 1 {
                let first = candidates[0].clone();
                if first.error.is_some() {
                    ("error".to_string(), Some(first), Some("Tệp ảnh không hợp lệ hoặc bị lỗi".to_string()))
                } else {
                    matched_count += 1;
                    ("ready".to_string(), Some(first), None)
                }
            } else {
                ("duplicate".to_string(), None, Some(format!("Trùng lặp: tìm thấy {} ảnh cho cảnh {}", candidates.len(), i)))
            };

            mappings.push(WhiteboardSceneImageMapping {
                scene_index: i,
                scene_id,
                current_image_path,
                matched_image: matched,
                candidate_images: candidates,
                status,
                error,
            });
        }

        Ok(WhiteboardFolderScanResult {
            folder_path,
            total_files_scanned: total_files,
            matched_scenes_count: matched_count,
            mappings,
            thumbnail_candidates,
            excess_images,
            ignored_files,
            errors,
        })
    }).await
}

#[tauri::command]
pub async fn import_whiteboard_complete_thumbnail(
    image_path: String,
    title: Option<String>,
) -> Result<WhiteboardThumbnail, AppError> {
    whiteboard_blocking(move || {
        use base64::{engine::general_purpose, Engine as _};
        use std::path::Path;
        let p = Path::new(&image_path);
        anyhow::ensure!(p.is_file(), "Tệp ảnh không tồn tại: {}", image_path);

        let stem = p.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let mut reader = image::ImageReader::open(p)?.with_guessed_format()?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(16384);
        limits.max_image_height = Some(16384);
        limits.max_alloc = Some(256 * 1024 * 1024);
        reader.limits(limits);

        let decoded = reader.decode()?;
        let (w, h) = (decoded.width(), decoded.height());
        let (target_w, target_h, aspect_ratio) = if h > w {
            (720u32, 1280u32, "9:16")
        } else {
            (1280u32, 720u32, "16:9")
        };

        let resized = decoded.resize_to_fill(target_w, target_h, image::imageops::FilterType::Lanczos3);
        let mut png = std::io::Cursor::new(Vec::new());
        resized.write_to(&mut png, image::ImageFormat::Png)?;
        let png_data_url = format!("data:image/png;base64,{}", general_purpose::STANDARD.encode(png.into_inner()));

        Ok(WhiteboardThumbnail {
            mode: Some("imported".to_string()),
            font_choice: None,
            typography_version: None,
            title: title.unwrap_or_else(|| stem),
            image_path: image_path.clone(),
            pen_type: "pen".to_string(),
            png_data_url,
            layout: Some("full-bleed-top".to_string()),
            aspect_ratio: Some(aspect_ratio.to_string()),
        })
    }).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhiteboardSpeaker {
    pub id: String,
    pub name: String,
    #[serde(rename = "voiceId")]
    pub voice_id: String,
    #[serde(rename = "sourceCharacterId", default, skip_serializing_if = "Option::is_none")]
    pub source_character_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhiteboardSpeechConfig {
    pub mode: String, // "single" | "characters"
    #[serde(rename = "defaultVoiceId")]
    pub default_voice_id: String,
    #[serde(rename = "timingMode")]
    pub timing_mode: String, // "fixed" | "auto"
    pub speakers: Vec<WhiteboardSpeaker>,
    #[serde(rename = "audioFingerprint", default, skip_serializing_if = "Option::is_none")]
    pub audio_fingerprint: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WhiteboardProject {
    pub id: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: i32,
    pub revision: i32,
    pub title: String,
    pub fps: i32,
    #[serde(rename = "paperColor")]
    pub paper_color: String,
    #[serde(rename = "handPath", skip_serializing_if = "Option::is_none")]
    pub hand_path: Option<String>,
    #[serde(rename = "speechConfig", default, skip_serializing_if = "Option::is_none")]
    pub speech_config: Option<WhiteboardSpeechConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<WhiteboardThumbnail>,
    #[serde(rename = "thumbnailDraft", default, skip_serializing_if = "Option::is_none")]
    pub thumbnail_draft: Option<WhiteboardThumbnailDraft>,
    pub scenes: Vec<WhiteboardSceneItem>,
    #[serde(rename = "sourceSrtPath", default, skip_serializing_if = "Option::is_none")]
    pub source_srt_path: Option<String>,
    #[serde(rename = "masterAudioPath", skip_serializing_if = "Option::is_none")]
    pub master_audio_path: Option<String>,
    #[serde(rename = "pageTurnMs", default, skip_serializing_if = "Option::is_none")]
    pub page_turn_ms: Option<u32>,
    #[serde(rename = "outputVideoPath", skip_serializing_if = "Option::is_none")]
    pub output_video_path: Option<String>,
}

fn validate_whiteboard_project_timeline(project: &WhiteboardProject) -> anyhow::Result<()> {
    let mut cursor = 0i64;
    let mut ids = std::collections::HashSet::new();
    for scene in &project.scenes {
        anyhow::ensure!(ids.insert(&scene.id), "ID cảnh bị trùng: {}", scene.id);
        anyhow::ensure!(scene.duration_ms > 0, "Cảnh {} có thời lượng không hợp lệ", scene.id);
        if project.master_audio_path.as_deref().is_some_and(|p| !p.is_empty()) {
            anyhow::ensure!(scene.timeline_start_ms == cursor
                && scene.timeline_end_ms.checked_sub(scene.timeline_start_ms) == Some(scene.duration_ms),
                "MASTER_TIMELINE_CONFLICT: Cảnh {} đã đổi thứ tự hoặc thời lượng so với audio/SRT. Hãy khôi phục timeline SRT hoặc bỏ master audio và gán audio riêng từng cảnh.", scene.id);
        }
        cursor = cursor.checked_add(scene.duration_ms)
            .ok_or_else(|| anyhow::anyhow!("Timeline vượt giới hạn"))?;
    }
    Ok(())
}

fn publish_whiteboard_scene(part: &str, output: &str) -> anyhow::Result<()> {
    std::fs::rename(part, output)?;
    let manifest_part = format!("{}.manifest.json", part);
    let manifest_out = format!("{}.manifest.json", output);
    // Never leave an older final manifest next to a newly published video.
    if std::path::Path::new(&manifest_out).exists() {
        std::fs::remove_file(&manifest_out)?;
    }
    if std::path::Path::new(&manifest_part).exists() {
        std::fs::rename(manifest_part, manifest_out)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn save_whiteboard_project(
    file_path: String,
    project: WhiteboardProject,
) -> Result<serde_json::Value, AppError> {
    let path = std::path::Path::new(&file_path);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp_path = format!("{}.tmp", file_path);
    let json_str = serde_json::to_string_pretty(&project)
        .map_err(|e| AppError::Other(format!("Lỗi serialize project: {}", e)))?;

    std::fs::write(&tmp_path, json_str)
        .map_err(|e| AppError::Other(format!("Lỗi ghi tệp tạm: {}", e)))?;
    std::fs::rename(&tmp_path, &file_path)
        .map_err(|e| AppError::Other(format!("Lỗi lưu tệp dự án nguyên tử: {}", e)))?;

    Ok(serde_json::json!({ "success": true, "filePath": file_path }))
}

#[tauri::command]
pub async fn retime_whiteboard_annotation(
    file_path: String,
    duration_ms: u64,
    speech_end_ms: u64,
) -> Result<serde_json::Value, AppError> {
    if duration_ms == 0 || speech_end_ms == 0 || speech_end_ms > duration_ms {
        return Err(AppError::Other("Thời lượng TTS không hợp lệ".into()));
    }
    let path = std::path::Path::new(&file_path);
    let mut annotation: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(path).map_err(|e| AppError::Other(e.to_string()))?
    ).map_err(|e| AppError::Other(e.to_string()))?;
    // Preserve hand-edited geometry, order, protected regions and source canvas.
    let elements = annotation.get_mut("elements").and_then(|v| v.as_array_mut())
        .ok_or_else(|| AppError::Other("Annotation thiếu elements".into()))?;
    let old_end = elements.iter().map(|e| {
        e["reveal"]["startMs"].as_f64().unwrap_or(0.0) + e["reveal"]["durationMs"].as_f64().unwrap_or(1.0)
    }).fold(1.0_f64, f64::max);
    let draw_end = speech_end_ms.saturating_sub(500).max(1);
    for e in elements.iter_mut() {
        let old_start = e["reveal"]["startMs"].as_f64().unwrap_or(0.0).max(0.0);
        let old_duration = e["reveal"]["durationMs"].as_f64().unwrap_or(1.0).max(1.0);
        let start = ((old_start / old_end * draw_end as f64).floor() as u64).min(draw_end-1);
        let end = (((old_start+old_duration) / old_end * draw_end as f64).floor() as u64).max(start+1).min(draw_end);
        e["reveal"]["startMs"] = serde_json::json!(start);
        e["reveal"]["durationMs"] = serde_json::json!(end-start);
    }
    annotation["sceneDurationMs"] = serde_json::json!(duration_ms);
    annotation["speechEndMs"] = serde_json::json!(speech_end_ms);
    let output = path.with_file_name(format!("{}.tts-{}.json",
        path.file_stem().and_then(|v| v.to_str()).unwrap_or("annotation"), uuid::Uuid::new_v4()));
    let data = serde_json::to_string_pretty(&annotation).map_err(|e| AppError::Other(e.to_string()))?;
    std::fs::write(&output, data).map_err(|e| AppError::Other(e.to_string()))?;
    Ok(serde_json::json!({"annotation_path": output.to_string_lossy(), "elements": annotation["elements"]}))
}

#[tauri::command]
pub async fn save_whiteboard_annotation(
    file_path: String,
    mut annotation: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let path = std::path::Path::new(&file_path);
    // The region editor sends a patch, not the original canvas/story metadata.
    // Preserve the source coordinate system instead of defaulting to 1920x1080.
    if path.exists() {
        let previous: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(path).map_err(|e| AppError::Other(e.to_string()))?
        ).map_err(|e| AppError::Other(format!("Annotation gốc không hợp lệ: {}", e)))?;
        let mut merged = previous.as_object().cloned()
            .ok_or_else(|| AppError::Other("Annotation gốc phải là object".into()))?;
        let patch = annotation.as_object()
            .ok_or_else(|| AppError::Other("Annotation phải là object".into()))?;
        merged.extend(patch.clone());
        annotation = serde_json::Value::Object(merged);
    }
    if !annotation.get("canvas").is_some_and(|v| v.is_object()) {
        return Err(AppError::Other("Annotation thiếu canvas; hãy tạo annotation từ ảnh trước khi chỉnh vùng".into()));
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp_path = format!("{}.tmp", file_path);
    let json_str = serde_json::to_string_pretty(&annotation)
        .map_err(|e| AppError::Other(format!("Lỗi serialize annotation: {}", e)))?;

    std::fs::write(&tmp_path, json_str)
        .map_err(|e| AppError::Other(format!("Lỗi ghi tệp tạm: {}", e)))?;
    std::fs::rename(&tmp_path, &file_path)
        .map_err(|e| AppError::Other(format!("Lỗi lưu tệp annotation nguyên tử: {}", e)))?;

    Ok(serde_json::json!({ "success": true, "filePath": file_path }))
}

#[tauri::command]
pub async fn load_whiteboard_project(
    file_path: String,
) -> Result<WhiteboardProject, AppError> {
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| AppError::Other(format!("Lỗi đọc tệp dự án {}: {}", file_path, e)))?;
    let project: WhiteboardProject = serde_json::from_str(&content)
        .map_err(|e| AppError::Other(format!("Lỗi phân tích cú pháp dự án {}: {}", file_path, e)))?;
    Ok(project)
}

#[tauri::command]
pub async fn render_whiteboard_project(
    project: WhiteboardProject,
    output_video_path: String,
    resume: Option<bool>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    if project.scenes.is_empty() {
        return Err(AppError::Other("Dự án chưa có phân cảnh nào để xuất".to_string()));
    }

    let wb = Arc::clone(&state.whiteboard);
    let should_resume = resume.unwrap_or(false);
    whiteboard_blocking(move || {
        validate_whiteboard_project_timeline(&project)?;
        let cover = project.thumbnail.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Hãy tạo thumbnail và xem trước trước khi xuất dự án"))?;
        let cover_png = thumbnail_png(cover)?;
        let out_dir = std::path::Path::new(&output_video_path)
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."));
        let _ = std::fs::create_dir_all(out_dir);

        let mut rendered_videos: Vec<String> = Vec::new();
        let total_scenes = project.scenes.len();

        for (idx, scene) in project.scenes.iter().enumerate() {
            if wb.is_cancelled() {
                return Err(anyhow::anyhow!("CANCELLED: Đã hủy render dự án"));
            }
            let scene_num = idx + 1;
            if scene.image_path.is_empty() || !std::path::Path::new(&scene.image_path).exists() {
                return Err(anyhow::anyhow!(
                    "Cảnh #{} ('{}') thiếu ảnh minh họa hoặc ảnh không tồn tại: {}",
                    scene_num, scene.id, scene.image_path
                ));
            }
            if scene.annotation_path.is_empty() || !std::path::Path::new(&scene.annotation_path).exists() {
                return Err(anyhow::anyhow!(
                    "Cảnh #{} ('{}') thiếu annotation.json hoặc không tồn tại: {}",
                    scene_num, scene.id, scene.annotation_path
                ));
            }

            let scene_out = scene.output_path.clone().unwrap_or_else(|| {
                out_dir.join(format!("scene_{:02}_{}.mp4", scene_num, scene.id)).to_string_lossy().to_string()
            });

            // R1: Kiểm tra Resume xác thực bằng Fingerprint & Manifest complete
            if should_resume && std::path::Path::new(&scene_out).exists() {
                let fp_res = wb.get_fingerprint(
                    scene.image_path.clone(),
                    scene.annotation_path.clone(),
                    project.fps,
                    project.paper_color.clone(),
                    project.hand_path.clone(),
                    scene.audio_path.clone(),
                    scene.ink_path.clone(),
                    scene.color_fill.clone(),
                    scene.ink_weight,
                    scene.color_weight,
                    Some(scene.duration_ms),
                    scene.subject_first,
                );
                if let Ok(fp) = fp_res {
                    if !fp.is_empty() && wb.verify_cache(scene_out.clone(), fp) {
                        let _ = app.emit(
                            "whiteboard-progress",
                            serde_json::json!({
                                "percent": ((idx + 1) as f64) * 100.0 / (total_scenes as f64) * 0.95,
                                "message": format!("Cảnh {}/{}: Tái dùng output đã xác thực (cache hit)", scene_num, total_scenes),
                                "sceneId": scene.id,
                                "sceneIndex": scene_num,
                                "cached": true,
                            }),
                        );
                        rendered_videos.push(scene_out);
                        continue;
                    }
                }
            }

            // Ghi vào file tạm trước, thành công mới chuyển thành file chính
            let scene_tmp_out = format!("{}.part.mp4", scene_out);

            let emit_scene_progress = |p: &serde_json::Value| {
                let inner_pct = p.get("percent").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let overall_pct = ((idx as f64) * 100.0 + inner_pct * 0.9) / (total_scenes as f64);
                let msg = format!(
                    "Cảnh {}/{}: {}",
                    scene_num,
                    total_scenes,
                    p.get("message").and_then(|v| v.as_str()).unwrap_or("")
                );
                let _ = app.emit(
                    "whiteboard-progress",
                    serde_json::json!({
                        "percent": overall_pct,
                        "message": msg,
                        "sceneId": scene.id,
                        "sceneIndex": scene_num,
                    }),
                );
            };

            wb.render_scene(
                scene.image_path.clone(),
                scene.annotation_path.clone(),
                scene_tmp_out.clone(),
                project.fps,
                project.paper_color.clone(),
                project.hand_path.clone(),
                scene.audio_path.clone(),
                scene.ink_path.clone(),
                scene.color_fill.clone(),
                scene.ink_weight,
                scene.color_weight,
                Some(scene.duration_ms),
                scene.subject_first,
                &emit_scene_progress,
            )?;

            // Đổi tên nguyên tử file part -> scene_out
            publish_whiteboard_scene(&scene_tmp_out, &scene_out)
                .map_err(|e| anyhow::anyhow!("Lỗi lưu video cảnh: {}", e))?;

            rendered_videos.push(scene_out);
        }

        let _ = app.emit(
            "whiteboard-progress",
            serde_json::json!({
                "percent": 95.0,
                "message": format!("Đang ghép {} phân cảnh vào video hoàn chỉnh...", total_scenes)
            }),
        );

        let final_tmp_out = format!("{}.part.mp4", output_video_path);
        let res = wb.merge_scenes(
            rendered_videos,
            final_tmp_out.clone(),
            project.master_audio_path.clone(),
            Some(cover_png),
            project.page_turn_ms,
            &|p| {
                let _ = app.emit("whiteboard-progress", p.clone());
            },
        )?;

        std::fs::rename(&final_tmp_out, &output_video_path)
            .map_err(|e| anyhow::anyhow!("Lỗi lưu video hoàn chỉnh: {}", e))?;

        let _ = app.emit(
            "whiteboard-progress",
            serde_json::json!({
                "percent": 100.0,
                "message": "Hoàn tất xuất video dự án Whiteboard!"
            }),
        );

        let file_size = std::fs::metadata(&output_video_path)
            .map(|m| m.len())
            .unwrap_or(0);

        Ok(serde_json::json!({
            "output_path": output_video_path,
            "file_size": file_size,
            "scenes_count": total_scenes,
            "merge_result": res,
        }))
    })
    .await
}

#[tauri::command]
pub fn check_file_exists(file_path: String) -> bool {
    let p = std::path::Path::new(&file_path);
    p.exists() && p.is_file()
}

/// `{ ok, python, pythonVersion?, missing[], ffmpeg?, error? }`; không bao giờ trả lỗi.
#[tauri::command]
pub async fn check_whiteboard_env(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, AppError> {
    let wb = Arc::clone(&state.whiteboard);
    whiteboard_blocking(move || Ok(wb.check_env())).await
}

/// Cài môi trường Python cho Whiteboard; log từng dòng qua sự kiện `whiteboard-install-log` (chuỗi).
#[tauri::command]
pub async fn install_whiteboard_env(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let wb = Arc::clone(&state.whiteboard);
    whiteboard_blocking(move || {
        wb.install_env(&|line| {
            let _ = app.emit("whiteboard-install-log", line.to_string());
        })
    })
    .await
}

// ==========================================
// G0: SYSTEM DIAGNOSTICS & SECRET MANAGEMENT
// ==========================================

/// Kiểm tra dự án nhiều cảnh trước khi xuất: `{ errors: [{sceneId, field, message}], warnings }`.
#[tauri::command]
pub async fn validate_whiteboard_project_v1(
    project: serde_json::Value,
    scene_ids: Option<Vec<String>>,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let wb = Arc::clone(&state.whiteboard);
    whiteboard_blocking(move || wb.validate_project(project, scene_ids)).await
}

/// Xuất dự án nhiều cảnh ra MP4 bằng Python runner export_project (render từng cảnh có cache, nối, dựng audio, mux, kiểm tra).
/// Tiến độ qua sự kiện `whiteboard-progress`; trả manifest. `scene_ids` để xuất riêng một số cảnh.
#[tauri::command]
pub async fn export_whiteboard_project(
    project: serde_json::Value,
    output_path: String,
    scene_ids: Option<Vec<String>>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let wb = Arc::clone(&state.whiteboard);
    whiteboard_blocking(move || {
        wb.render_project(project, output_path, scene_ids, &|p| {
            let _ = app.emit("whiteboard-progress", p.clone());
        })
    })
    .await
}

/// Lưu dự án whiteboard format v1 (JSON, ghi nguyên tử).
#[tauri::command]
pub async fn save_whiteboard_project_v1(path: String, project: serde_json::Value) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || crate::executors::whiteboard::save_project_file(Path::new(&path), &project))
        .await
        .map_err(|e| AppError::Other(format!("Luồng lưu dự án bị lỗi: {}", e)))?
        .map_err(|e| AppError::Other(e.to_string()))
}

/// Mở dự án whiteboard format v1; từ chối tệp không phải dự án hoặc có schemaVersion mới hơn app.
#[tauri::command]
pub async fn load_whiteboard_project_v1(path: String) -> Result<serde_json::Value, AppError> {
    tauri::async_runtime::spawn_blocking(move || crate::executors::whiteboard::load_project_file(Path::new(&path)))
        .await
        .map_err(|e| AppError::Other(format!("Luồng mở dự án bị lỗi: {}", e)))?
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub fn check_system_dependencies(app: tauri::AppHandle) -> crate::diagnostics::SystemDiagnostics {
    crate::diagnostics::DiagnosticsManager::run_diagnostics(&app)
}

#[tauri::command]
pub fn save_os_secret(key: String, value: String) -> Result<bool, AppError> {
    crate::secret_store::SecretStore::set_secret(&key, &value)
        .map(|_| true)
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub fn delete_os_secret(key: String) -> Result<bool, AppError> {
    crate::secret_store::SecretStore::delete_secret(&key)
        .map(|_| true)
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub fn has_os_secret(key: String) -> Result<bool, AppError> {
    match crate::secret_store::SecretStore::get_secret(&key) {
        Ok(Some(s)) => Ok(!s.trim().is_empty()),
        Ok(None) => Ok(false),
        Err(e) => Err(AppError::Other(e.to_string())),
    }
}


#[cfg(test)]
mod whiteboard_review_regression_tests {
    use super::*;

    fn project() -> WhiteboardProject {
        serde_json::from_value(serde_json::json!({
            "id":"project-test", "schemaVersion":1, "revision":1, "title":"test",
            "fps":30, "paperColor":"#FFFFFF", "masterAudioPath":"voice.wav",
            "scenes": [
                {"id":"a","order":1,"revision":1,"imagePath":"a.png","annotationPath":"a.json",
                 "timelineStartMs":0,"timelineEndMs":1000,"durationMs":1000,"status":"idle"},
                {"id":"b","order":2,"revision":1,"imagePath":"b.png","annotationPath":"b.json",
                 "timelineStartMs":1000,"timelineEndMs":2000,"durationMs":1000,"status":"idle"}
            ]
        })).unwrap()
    }

    #[test]
    fn whiteboard_thumbnail_roundtrip_and_png_validation() {
        use base64::{engine::general_purpose, Engine as _};
        let mut p = project(); // Old projects without a cover still open.
        assert!(p.thumbnail.is_none());
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1280, 720).write_to(&mut png, image::ImageFormat::Png).unwrap();
        let encoded = general_purpose::STANDARD.encode(png.into_inner());
        p.thumbnail = Some(WhiteboardThumbnail {
            mode: Some("generated".into()),
            font_choice: Some("grenzegotisch".into()), typography_version: Some(1),
            title: "Tam Anh Chiến Lữ Bố".into(), image_path: "cover.png".into(),
            layout: Some("full-bleed-top".into()),
            aspect_ratio: Some("16:9".into()),
            pen_type: "quill".into(), png_data_url: format!("data:image/png;base64,{}", encoded),
        });
        p.thumbnail_draft = Some(WhiteboardThumbnailDraft { title: "Bản nháp mới".into(), image_path: "other.png".into(), font_choice: Some("auto".into()) });
        let path = std::env::temp_dir().join(format!("wb-thumbnail-{}.json", uuid::Uuid::new_v4()));
        let name = path.to_string_lossy().to_string();
        tauri::async_runtime::block_on(save_whiteboard_project(name.clone(), p)).unwrap();
        let mut reopened = tauri::async_runtime::block_on(load_whiteboard_project(name)).unwrap();
        let cover = reopened.thumbnail.as_mut().unwrap();
        assert_eq!(cover.title, "Tam Anh Chiến Lữ Bố");
        assert_eq!(cover.pen_type, "quill");
        assert_eq!(cover.font_choice.as_deref(), Some("grenzegotisch"));
        assert_eq!(cover.typography_version, Some(1));
        assert_eq!(cover.layout.as_deref(), Some("full-bleed-top"));
        assert_eq!(thumbnail_png(cover).unwrap(), encoded);

        // Portrait 9:16 (720x1280) validation test
        let mut portrait_png = Vec::new();
        image::RgbImage::new(720, 1280).write_to(&mut std::io::Cursor::new(&mut portrait_png), image::ImageFormat::Png).unwrap();
        let encoded_portrait = general_purpose::STANDARD.encode(&portrait_png);
        cover.png_data_url = format!("data:image/png;base64,{}", encoded_portrait);
        assert_eq!(thumbnail_png(cover).unwrap(), encoded_portrait);

        assert_eq!(reopened.thumbnail_draft.as_ref().unwrap().title, "Bản nháp mới");
        assert_eq!(reopened.thumbnail_draft.as_ref().unwrap().font_choice.as_deref(), Some("auto"));
        cover.png_data_url = "data:image/png;base64,broken".into();
        assert!(thumbnail_png(cover).is_err());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn whiteboard_page_turn_roundtrip_and_old_projects() {
        let mut p = project();
        assert!(p.page_turn_ms.is_none()); // Dự án cũ không có trường này vẫn mở được.
        let json = serde_json::to_value(&p).unwrap();
        assert!(json.get("pageTurnMs").is_none());
        p.page_turn_ms = Some(800);
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["pageTurnMs"], 800);
        let back: WhiteboardProject = serde_json::from_value(json).unwrap();
        assert_eq!(back.page_turn_ms, Some(800));
    }

    #[test]
    fn whiteboard_speech_config_roundtrip() {
        let mut p = project();
        assert!(p.speech_config.is_none());
        p.speech_config = Some(WhiteboardSpeechConfig {
            mode: "characters".into(),
            default_voice_id: "Thùy Dung".into(),
            timing_mode: "auto".into(),
            speakers: vec![
                WhiteboardSpeaker {
                    id: "spk-1".into(),
                    name: "Thầy giáo".into(),
                    voice_id: "Hải Đăng".into(),
                    source_character_id: None,
                },
                WhiteboardSpeaker {
                    id: "spk-2".into(),
                    name: "Học sinh".into(),
                    voice_id: "Trúc Ly".into(),
                    source_character_id: Some("char-hs".into()),
                },
            ],
            audio_fingerprint: Some("fp-12345".into()),
        });
        let path = std::env::temp_dir().join(format!("wb-speech-{}.json", uuid::Uuid::new_v4()));
        let name = path.to_string_lossy().to_string();
        tauri::async_runtime::block_on(save_whiteboard_project(name.clone(), p)).unwrap();
        let reopened = tauri::async_runtime::block_on(load_whiteboard_project(name)).unwrap();
        let sc = reopened.speech_config.unwrap();
        assert_eq!(sc.mode, "characters");
        assert_eq!(sc.default_voice_id, "Thùy Dung");
        assert_eq!(sc.timing_mode, "auto");
        assert_eq!(sc.speakers.len(), 2);
        assert_eq!(sc.speakers[0].name, "Thầy giáo");
        assert_eq!(sc.speakers[0].voice_id, "Hải Đăng");
        assert_eq!(sc.speakers[1].source_character_id.as_deref(), Some("char-hs"));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn whiteboard_single_voice_three_scenes_roundtrip() {
        let mut p = project();
        let mut scenes = Vec::new();
        for i in 0..3 {
            let mut scene = serde_json::to_value(&p.scenes[0]).unwrap();
            scene["id"] = serde_json::json!(format!("scene-{}", i + 1));
            scene["order"] = serde_json::json!(i + 1);
            scene["timelineStartMs"] = serde_json::json!(i * 1000);
            scene["timelineEndMs"] = serde_json::json!((i + 1) * 1000);
            scene["cues"] = serde_json::json!([{
                "id": format!("cue-{}", i + 1), "index": i + 1,
                "startMs": i * 1000, "endMs": (i + 1) * 1000, "durMs": 1000,
                "text": "Lời kể", "spokenText": "Lời kể", "speakerId": null
            }]);
            scenes.push(serde_json::from_value(scene).unwrap());
        }
        p.scenes = scenes;
        p.speech_config = Some(WhiteboardSpeechConfig {
            mode: "single".into(), default_voice_id: "Thái Sơn".into(), timing_mode: "fixed".into(),
            speakers: vec![], audio_fingerprint: None,
        });
        let path = std::env::temp_dir().join(format!("wb-single-{}.json", uuid::Uuid::new_v4()));
        let name = path.to_string_lossy().to_string();
        tauri::async_runtime::block_on(save_whiteboard_project(name.clone(), p)).unwrap();
        let reopened = tauri::async_runtime::block_on(load_whiteboard_project(name)).unwrap();
        let config = reopened.speech_config.unwrap();
        assert_eq!(config.mode, "single");
        assert_eq!(config.default_voice_id, "Thái Sơn");
        assert!(config.speakers.is_empty());
        assert_eq!(reopened.scenes.len(), 3);
        assert!(reopened.scenes.iter().all(|s| s.cues.len() == 1 && s.cues[0]["speakerId"].is_null()));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn whiteboard_master_timeline_rejects_reorder_and_retime() {
        let mut p = project();
        assert!(validate_whiteboard_project_timeline(&p).is_ok());
        p.scenes.swap(0, 1);
        assert!(validate_whiteboard_project_timeline(&p).is_err());
        p.master_audio_path = None;
        assert!(validate_whiteboard_project_timeline(&p).is_ok());
        let mut p = project();
        p.scenes[0].duration_ms = 1500;
        assert!(validate_whiteboard_project_timeline(&p).is_err());
    }

    #[test]
    fn whiteboard_annotation_edit_preserves_original_canvas() {
        let path = std::env::temp_dir().join(format!("wb-canvas-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&path, r#"{"canvas":{"width":2752,"height":1536},"storyBasis":"original","elements":[]}"#).unwrap();
        tauri::async_runtime::block_on(save_whiteboard_annotation(path.to_string_lossy().to_string(),
            serde_json::json!({"sceneDurationMs":15000,"elements":[]}))).unwrap();
        let edited: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(edited["canvas"]["width"],2752);
        assert_eq!(edited["storyBasis"],"original");
        assert_eq!(edited["sceneDurationMs"],15000);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn whiteboard_project_roundtrip_keeps_edited_elements() {
        let mut p = project();
        p.scenes[0].elements = Some(vec![serde_json::json!({
            "id":"edited", "sequence":1,
            "region":{"x":20,"y":30,"width":40,"height":50},
            "reveal":{"startMs":0,"durationMs":500,"direction":"right_to_left"}
        })]);
        let path = std::env::temp_dir().join(format!("wb-elements-{}.json", uuid::Uuid::new_v4()));
        let name = path.to_string_lossy().to_string();
        tauri::async_runtime::block_on(save_whiteboard_project(name.clone(), p)).unwrap();
        let reopened = tauri::async_runtime::block_on(load_whiteboard_project(name)).unwrap();
        let elements = reopened.scenes[0].elements.as_ref().unwrap();
        assert_eq!(elements[0]["region"]["x"], 20);
        assert_eq!(elements[0]["reveal"]["direction"], "right_to_left");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn whiteboard_publish_moves_manifest_and_invalidates_old_metadata() {
        let dir = std::env::temp_dir().join(format!("wb-publish-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let part = dir.join("scene.part.mp4").to_string_lossy().to_string();
        let final_path = dir.join("scene.mp4").to_string_lossy().to_string();
        std::fs::write(&part, b"new-video").unwrap();
        std::fs::write(format!("{}.manifest.json",part), b"new-manifest").unwrap();
        std::fs::write(format!("{}.manifest.json",final_path), b"old-manifest").unwrap();
        publish_whiteboard_scene(&part, &final_path).unwrap();
        assert_eq!(std::fs::read(&final_path).unwrap(), b"new-video");
        assert_eq!(std::fs::read(format!("{}.manifest.json",final_path)).unwrap(), b"new-manifest");
        assert!(!std::path::Path::new(&format!("{}.manifest.json",part)).exists());
        std::fs::write(&part, b"video-without-cache").unwrap();
        publish_whiteboard_scene(&part, &final_path).unwrap();
        assert!(!std::path::Path::new(&format!("{}.manifest.json",final_path)).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn whiteboard_scan_folder_mapping_rules_test() {
        let dir = std::env::temp_dir().join(format!("wb-scan-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let save_dummy_image = |filename: &str, w: u32, h: u32| {
            let path = dir.join(filename);
            let img = image::RgbImage::new(w, h);
            img.save(&path).unwrap();
        };

        save_dummy_image("1.png", 100, 100);
        save_dummy_image("01.jpg", 100, 100); // duplicate with 1.png
        save_dummy_image("02.png", 200, 100); // scene 2
        save_dummy_image("10.png", 100, 100); // excess for 3 scenes
        save_dummy_image("thumb.png", 1280, 720); // thumbnail candidate
        save_dummy_image("thumbnail-9x16.png", 720, 1280); // thumbnail candidate
        std::fs::write(dir.join("notes.txt"), b"ignore this").unwrap();

        let scene_ids = vec!["s1".into(), "s2".into(), "s3".into()];
        let res = tauri::async_runtime::block_on(scan_whiteboard_folder_images(
            dir.to_string_lossy().to_string(),
            3,
            scene_ids,
            None,
        )).unwrap();

        assert_eq!(res.total_files_scanned, 7);
        assert_eq!(res.mappings.len(), 3);

        // Scene 1: duplicate (1.png & 01.jpg)
        assert_eq!(res.mappings[0].scene_index, 1);
        assert_eq!(res.mappings[0].status, "duplicate");
        assert_eq!(res.mappings[0].candidate_images.len(), 2);

        // Scene 2: ready (02.png)
        assert_eq!(res.mappings[1].scene_index, 2);
        assert_eq!(res.mappings[1].status, "ready");
        assert!(res.mappings[1].matched_image.is_some());
        assert_eq!(res.mappings[1].matched_image.as_ref().unwrap().filename, "02.png");

        // Scene 3: missing
        assert_eq!(res.mappings[2].scene_index, 3);
        assert_eq!(res.mappings[2].status, "missing");

        // Thumbnail candidates: 2 files
        assert_eq!(res.thumbnail_candidates.len(), 2);
        let thumb_names: Vec<_> = res.thumbnail_candidates.iter().map(|t| t.filename.as_str()).collect();
        assert!(thumb_names.contains(&"thumb.png"));
        assert!(thumb_names.contains(&"thumbnail-9x16.png"));

        // Excess images: 10.png
        assert_eq!(res.excess_images.len(), 1);
        assert_eq!(res.excess_images[0].filename, "10.png");

        // Ignored files: notes.txt
        assert!(res.ignored_files.contains(&"notes.txt".to_string()));

        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn whiteboard_imported_complete_thumbnail_test() {
        let dir = std::env::temp_dir().join(format!("wb-thumb-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("thumbnail-9x16.png");
        image::RgbImage::new(1080, 1920).save(&path).unwrap();

        let thumb = tauri::async_runtime::block_on(import_whiteboard_complete_thumbnail(
            path.to_string_lossy().to_string(),
            Some("Đổng Trác Uống Trà".into()),
        )).unwrap();

        assert_eq!(thumb.mode.as_deref(), Some("imported"));
        assert_eq!(thumb.aspect_ratio.as_deref(), Some("9:16"));
        assert_eq!(thumb.title, "Đổng Trác Uống Trà");

        let png_bytes = thumbnail_png(&thumb).unwrap();
        assert!(!png_bytes.is_empty());

        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn whiteboard_scan_dong_trac_real_project_folder_test() {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let proj_dir = manifest_dir.parent().unwrap().join("wb-projects").join("04. Dong Trac uong tra");
        if !proj_dir.exists() {
            return;
        }

        let scene_ids = vec!["scene-01".into(), "scene-02".into(), "scene-03".into()];
        let res = tauri::async_runtime::block_on(scan_whiteboard_folder_images(
            proj_dir.to_string_lossy().to_string(),
            3,
            scene_ids,
            None,
        )).unwrap();

        assert_eq!(res.matched_scenes_count, 3);
        assert_eq!(res.mappings[0].status, "ready");
        assert_eq!(res.mappings[0].matched_image.as_ref().unwrap().filename, "1.png");
        assert_eq!(res.mappings[1].status, "ready");
        assert_eq!(res.mappings[1].matched_image.as_ref().unwrap().filename, "2.png");
        assert_eq!(res.mappings[2].status, "ready");
        assert_eq!(res.mappings[2].matched_image.as_ref().unwrap().filename, "3.png");

        assert_eq!(res.thumbnail_candidates.len(), 1);
        assert_eq!(res.thumbnail_candidates[0].filename, "thumbnail-9x16.png");
        assert_eq!(res.thumbnail_candidates[0].aspect_ratio.as_deref(), Some("9:16"));
    }
}

#[cfg(test)]
mod audio_timing_regression_tests {
    use super::*;

    #[test]
    fn retime_preserves_manual_geometry_and_source_annotation() {
        let dir = std::env::temp_dir().join(format!("wb-timing-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("source.json");
        let original = serde_json::json!({"schemaVersion":1,"canvas":{"width":2752,"height":1536},
            "storyBasis":"manual","sceneDurationMs":50000,
            "elements":[{"id":"manual","sequence":1,"region":{"x":7,"y":8,"width":90,"height":80},
                "reveal":{"mode":"fade","startMs":1000,"durationMs":39000,"direction":"top_to_bottom"}}]});
        std::fs::write(&input, serde_json::to_string(&original).unwrap()).unwrap();
        let result = tauri::async_runtime::block_on(retime_whiteboard_annotation(
            input.to_string_lossy().to_string(),23000,22000)).unwrap();
        let output = result["annotation_path"].as_str().unwrap();
        assert_ne!(output,input.to_string_lossy());
        let retimed: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(output).unwrap()).unwrap();
        assert_eq!(retimed["canvas"],original["canvas"]);
        assert_eq!(retimed["elements"][0]["region"],original["elements"][0]["region"]);
        assert_eq!(retimed["elements"][0]["reveal"]["mode"],"fade");
        let reveal=&retimed["elements"][0]["reveal"];
        assert_eq!(reveal["startMs"].as_u64().unwrap()+reveal["durationMs"].as_u64().unwrap(),21500);
        assert_eq!(serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(&input).unwrap()).unwrap(),original);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_speech_window_is_rejected_before_reading_annotation() {
        let result = tauri::async_runtime::block_on(retime_whiteboard_annotation("missing.json".into(),1000,2000));
        assert!(result.unwrap_err().to_string().contains("Thời lượng TTS"));
    }
}


// ==========================================
// SUBTITLE HARDSUB COMMANDS (F17)
// ==========================================
use tauri_plugin_shell::ShellExt;

#[derive(serde::Serialize)]
pub struct SubtitleBurnResult {
    pub ok: bool,
    pub output_path: String,
    pub file_size: u64,
    pub message: String,
}

/// Đóng dấu phụ đề cứng (Hardsub) trực tiếp lên video bằng FFmpeg
#[tauri::command]
pub async fn burn_video_subtitles(
    video_path: String,
    srt_path: String,
    output_path: String,
    preset: Option<crate::models::SubtitlePreset>,
    custom_style: Option<crate::models::SubtitleStyleConfig>,
    is_portrait: Option<bool>,
    kinetic_highlight: Option<bool>,
    app_handle: tauri::AppHandle,
) -> Result<SubtitleBurnResult, AppError> {
    let video_p = Path::new(&video_path);
    let srt_p = Path::new(&srt_path);

    if !video_p.exists() {
        return Err(AppError::NotFound(format!("Không tìm thấy video đầu vào: {}", video_path)));
    }
    if !srt_p.exists() {
        return Err(AppError::NotFound(format!("Không tìm thấy tệp phụ đề: {}", srt_path)));
    }

    let out_p = Path::new(&output_path);
    if let Some(parent) = out_p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // 1. Xác định cấu hình style
    let portrait = is_portrait.unwrap_or(false);
    let style = if let Some(cs) = custom_style {
        cs
    } else {
        let p = preset.unwrap_or(crate::models::SubtitlePreset::TiktokNeon);
        crate::models::SubtitleStyleConfig::from_preset(p, portrait)
    };

    // 2. Xử lý Kinetic Typography nếu được bật (Cinecode punch keywords & chunks)
    let enable_kinetic = kinetic_highlight.unwrap_or(false);
    let filter_arg = if enable_kinetic {
        let (width, height) = if portrait { (1080, 1920) } else { (1920, 1080) };
        let highlight_col = if style.primary_color == "&H0000FFFF" { "&H0000FF00" } else { "&H0000FFFF" };
        match crate::kinetic_subtitles::KineticGenerator::convert_srt_to_kinetic_ass(
            srt_p,
            &style,
            highlight_col,
            width,
            height,
        ) {
            Ok(ass_path) => {
                let ass_escaped = ass_path
                    .to_string_lossy()
                    .replace('\\', "/")
                    .replace(':', "\\:")
                    .replace('\'', "'\\''");
                format!("ass='{}'", ass_escaped)
            }
            Err(_) => {
                let force_style = style.to_force_style_string();
                let srt_escaped = srt_path
                    .replace('\\', "/")
                    .replace(':', "\\:")
                    .replace('\'', "'\\''");
                format!("subtitles='{}':force_style='{}'", srt_escaped, force_style)
            }
        }
    } else {
        let force_style = style.to_force_style_string();
        let srt_escaped = srt_path
            .replace('\\', "/")
            .replace(':', "\\:")
            .replace('\'', "'\\''");
        format!("subtitles='{}':force_style='{}'", srt_escaped, force_style)
    };

    // 3. Thực thi FFmpeg sidecar
    let sidecar_cmd = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| AppError::Other(format!("Lỗi khởi tạo FFmpeg sidecar: {}", e)))?;

    let output = sidecar_cmd
        .args([
            "-y",
            "-i",
            &video_path,
            "-vf",
            &filter_arg,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "copy", // Giữ nguyên audio track không nén lại
            &output_path,
        ])
        .output()
        .await
        .map_err(|e| AppError::Other(format!("Lỗi thực thi lệnh in phụ đề: {}", e)))?;

    if !output.status.success() {
        let err_log = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Other(format!("FFmpeg in phụ đề thất bại: {}", err_log)));
    }

    let file_size = std::fs::metadata(&output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(SubtitleBurnResult {
        ok: true,
        output_path,
        file_size,
        message: "In phụ đề lên video thành công!".to_string(),
    })
}

/// Trích xuất audio nhanh từ video thành PCM WAV 16 kHz Mono để phục vụ bóc phụ đề Whisper
#[tauri::command]
pub async fn extract_audio_for_subtitles(
    video_path: String,
    output_wav_path: String,
    app_handle: tauri::AppHandle,
) -> Result<String, AppError> {
    let video_p = Path::new(&video_path);
    if !video_p.exists() {
        return Err(AppError::NotFound(format!("Không tìm thấy video: {}", video_path)));
    }

    if let Some(parent) = Path::new(&output_wav_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let sidecar_cmd = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| AppError::Other(format!("Lỗi khởi tạo FFmpeg: {}", e)))?;

    let output = sidecar_cmd
        .args([
            "-y",
            "-i",
            &video_path,
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            &output_wav_path,
        ])
        .output()
        .await
        .map_err(|e| AppError::Other(format!("Lỗi trích xuất audio: {}", e)))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Other(format!("Không thể tách audio: {}", err)));
    }

    Ok(output_wav_path)
}
