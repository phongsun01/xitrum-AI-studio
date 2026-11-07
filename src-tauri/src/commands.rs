use crate::db::chrono_now;
use crate::errors::AppError;
use serde::{Deserialize, Serialize};
use crate::models::{
    AppConfig, AudioJobItem, AudioSegmentItem, ProxyItem, ScriptProjectItem, ScriptSceneItem,
    TaskItem, TaskKind, TemplateItem,
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
    force_new_generation: Option<bool>,
    state: State<'_, AppState>,
) -> Result<TaskItem, AppError> {
    state.queue.enqueue_advanced(
        kind,
        prompt,
        ratio,
        input_path,
        provider,
        requested_model,
        scene_revision,
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
    _state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let srt_p = std::path::Path::new(&srt_path);
    if !srt_p.exists() {
        return Err(AppError::Other(format!("File SRT không tồn tại: {}", srt_path)));
    }

    // Đặt file audio cùng thư mục với SRT hoặc trong output_dir
    let parent = srt_p.parent().unwrap_or(std::path::Path::new("."));
    let stem = srt_p.file_stem().and_then(|s| s.to_str()).unwrap_or("whiteboard_master");
    let output_file = parent.join(format!("{}_{}.wav", stem, voice_id.replace(' ', "_")));

    let pipeline = crate::executors::tts::TtsPipeline::new();
    let (audio_path, duration_sec) = pipeline
        .synthesize_srt("whiteboard_srt_tts", srt_p, &voice_id, &output_file)
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;

    Ok(serde_json::json!({
        "audio_path": audio_path,
        "duration_sec": duration_sec
    }))
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
            .enqueue_advanced(
                TaskKind::MuseVideo,
                Some(final_prompt),
                Some(script.ratio.clone()),
                char_ref_img,
                Some("muse".into()),
                None,
                Some(1),
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
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let wb = Arc::clone(&state.whiteboard);
    whiteboard_blocking(move || wb.parse_srt(srt_path)).await
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
            &|p| {
                let _ = app.emit("whiteboard-progress", p.clone());
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn merge_whiteboard_scenes(
    video_paths: Vec<String>,
    output_path: String,
    master_audio_path: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let wb = Arc::clone(&state.whiteboard);
    whiteboard_blocking(move || {
        wb.merge_scenes(video_paths, output_path, master_audio_path, &|p| {
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
    pub scenes: Vec<WhiteboardSceneItem>,
    #[serde(rename = "masterAudioPath", skip_serializing_if = "Option::is_none")]
    pub master_audio_path: Option<String>,
    #[serde(rename = "outputVideoPath", skip_serializing_if = "Option::is_none")]
    pub output_video_path: Option<String>,
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
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    if project.scenes.is_empty() {
        return Err(AppError::Other("Dự án chưa có phân cảnh nào để xuất".to_string()));
    }

    let wb = Arc::clone(&state.whiteboard);
    whiteboard_blocking(move || {
        let out_dir = std::path::Path::new(&output_video_path)
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."));
        let _ = std::fs::create_dir_all(out_dir);

        let mut rendered_videos: Vec<String> = Vec::new();
        let total_scenes = project.scenes.len();

        for (idx, scene) in project.scenes.iter().enumerate() {
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
                &emit_scene_progress,
            )?;

            // Đổi tên nguyên tử file part -> scene_out
            std::fs::rename(&scene_tmp_out, &scene_out)
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

