use crate::db::chrono_now;
use crate::errors::AppError;
use crate::models::{
    AppConfig, AudioJobItem, AudioSegmentItem, ProxyItem, ScriptProjectItem, ScriptSceneItem,
    TaskItem, TaskKind, TemplateItem,
};
use crate::state::AppState;
use std::path::Path;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn enqueue_task(
    kind: TaskKind,
    prompt: Option<String>,
    ratio: Option<String>,
    input_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<TaskItem, AppError> {
    state.queue.enqueue(kind, prompt, ratio, input_path).await
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
        state.db.get_proxy(proxy_id).ok().flatten().map(|p| crate::executors::muse_runner::ProxyConfig {
            server: format!("{}://{}:{}", p.scheme, p.host, p.port),
            username: p.username,
            password: p.encrypted_password,
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
    state
        .queue
        .enqueue(task.kind, task.prompt, task.ratio, task.input_path)
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
    let task = state
        .queue
        .enqueue(TaskKind::MuseVideo, Some(prompt), Some("16:9".into()), seg.ref_image_path)
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
        if let Ok(_) = state.db.insert_proxy(
            Some(&name),
            &raw_masked,
            &scheme,
            &host,
            port,
            username.as_deref(),
            encrypted_pass.as_deref(),
        ) {
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
        // Giải mã mật khẩu tạm để test kết nối
        let pass = proxy.encrypted_password.as_ref().map(|enc| {
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
        }).unwrap_or_default();
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

    // Tạo map tra cứu nhân vật: name -> (description, ref_image_path)
    let char_map: std::collections::HashMap<String, (String, Option<String>)> = script
        .characters
        .iter()
        .map(|c| (c.name.trim().to_lowercase(), (c.description.clone(), c.ref_image_path.clone())))
        .collect();

    let mut queued_count = 0;
    let mut task_ids = Vec::new();

    for scene in &script.scenes {
        // Kết hợp prompt: visual_prompt + mô tả nhân vật (nếu có)
        let mut final_prompt = if !scene.video_prompt.trim().is_empty() {
            scene.video_prompt.trim().to_string()
        } else {
            scene.visual_prompt.trim().to_string()
        };

        // Xác định ảnh tham chiếu khuôn mặt (ưu tiên từ scene, sau đó từ Character Bible)
        let mut char_ref_img = scene.ref_image_path.clone();

        if let Some(ref char_name) = scene.character {
            let key = char_name.trim().to_lowercase();
            if let Some((desc, char_img)) = char_map.get(&key) {
                if !desc.trim().is_empty() && !final_prompt.contains(desc) {
                    final_prompt = format!("{}, Character: {}", final_prompt, desc);
                }
                if char_ref_img.is_none() && char_img.is_some() {
                    char_ref_img = char_img.clone();
                }
            }
        }

        // Tạo task trong queue
        let task = state
            .queue
            .enqueue(
                TaskKind::MuseVideo,
                Some(final_prompt),
                Some(script.ratio.clone()),
                char_ref_img,
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

// ==========================================
// MỐC 5: HẬU KỲ HOÀN CHỈNH (FFMPEG MERGE & POST-PRODUCTION)
// ==========================================

/// Tạo file phụ đề .srt chuẩn UTF-8 từ danh sách phân cảnh kịch bản
fn generate_srt_content(scenes: &[ScriptSceneItem]) -> String {
    let mut srt = String::new();
    let mut current_sec: f32 = 0.0;

    for (idx, scene) in scenes.iter().enumerate() {
        let dur = if scene.duration_sec > 0.0 { scene.duration_sec } else { 5.0 };
        let start_sec = current_sec;
        let end_sec = current_sec + dur;
        current_sec = end_sec;

        let start_fmt = format_srt_timestamp(start_sec);
        let end_fmt = format_srt_timestamp(end_sec);

        srt.push_str(&format!("{}\n", idx + 1));
        srt.push_str(&format!("{} --> {}\n", start_fmt, end_fmt));
        let narration = scene.narration.trim();
        srt.push_str(&format!("{}\n\n", narration));
    }

    srt
}

fn format_srt_timestamp(seconds: f32) -> String {
    let total_ms = (seconds * 1000.0) as i64;
    let ms = total_ms % 1000;
    let total_s = total_ms / 1000;
    let s = total_s % 60;
    let total_m = total_s / 60;
    let m = total_m % 60;
    let h = total_m / 60;
    format!("{:02}:{:02}:{:02},{:03}", h, m, s, ms)
}

#[tauri::command]
pub async fn render_script_postproduction(
    script_id: String,
    burn_subtitles: bool,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    use tauri_plugin_shell::ShellExt;

    let script = state
        .db
        .get_script_project(&script_id)?
        .ok_or_else(|| AppError::Other("Không tìm thấy dự án kịch bản".into()))?;

    if script.scenes.is_empty() {
        return Err(AppError::Other("Kịch bản không có phân cảnh nào để ghép".into()));
    }

    let config = state.db.get_config().unwrap_or_default();
    let out_dir = Path::new(&config.output_dir);
    if !out_dir.exists() {
        let _ = std::fs::create_dir_all(out_dir);
    }

    let temp_dir = std::env::temp_dir();
    let unique_id = uuid::Uuid::new_v4().to_string();
    let short_id = &unique_id[..8];

    // 1. Chuẩn bị video clips cho từng scene
    // Nếu scene có video_path thật thì dùng, nếu chưa có (ví dụ test hoặc Muse chưa chạy)
    // thì tự động sinh color slide kèm text tiêu đề để đảm bảo file video ra mượt mà
    let mut scene_video_clips: Vec<String> = Vec::new();
    let (res_w, res_h) = if script.ratio == "9:16" {
        ("720", "1280")
    } else {
        ("1280", "720")
    };

    for (idx, scene) in script.scenes.iter().enumerate() {
        if let Some(ref v_path) = scene.video_path {
            if Path::new(v_path).exists() {
                scene_video_clips.push(v_path.clone());
                continue;
            }
        }

        // Tạo clip màu nền tương ứng thời lượng duration_sec
        let dur = if scene.duration_sec > 0.0 { scene.duration_sec } else { 5.0 };
        let clip_path = temp_dir.join(format!("scene_clip_{}_{}.mp4", short_id, idx));
        let clip_path_str = clip_path.to_string_lossy().to_string();

        let colors = ["#1e293b", "#0f172a", "#1e1b4b", "#172554", "#064e3b", "#312e81"];
        let color = colors[idx % colors.len()];

        let synth_args = [
            "-y",
            "-f", "lavfi",
            "-i", &format!("color=c={}:s={}x{}:d={:.2}", color, res_w, res_h, dur),
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            &clip_path_str,
        ];

        let output = app_handle
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| AppError::Other(format!("FFmpeg sidecar error: {e}")))?
            .args(synth_args)
            .output()
            .await
            .map_err(|e| AppError::Other(format!("Lỗi tạo video scene: {e}")))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Other(format!("FFmpeg synth scene failed: {err}")));
        }

        scene_video_clips.push(clip_path_str);
    }

    // 2. Nối video clips bằng concat demuxer
    let concat_list_file = temp_dir.join(format!("script_concat_{}.txt", short_id));
    let mut concat_txt = String::new();
    for clip in &scene_video_clips {
        let norm = clip.replace('\\', "/");
        concat_txt.push_str(&format!("file '{}'\n", norm));
    }
    std::fs::write(&concat_list_file, &concat_txt)
        .map_err(|e| AppError::Other(format!("Lỗi ghi file concat: {e}")))?;
    let concat_list_str = concat_list_file.to_string_lossy().to_string();

    let raw_concat_video = temp_dir.join(format!("raw_video_{}.mp4", short_id));
    let raw_concat_video_str = raw_concat_video.to_string_lossy().to_string();

    let concat_output = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| AppError::Other(format!("FFmpeg error: {e}")))?
        .args([
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", &concat_list_str,
            "-c", "copy",
            &raw_concat_video_str,
        ])
        .output()
        .await
        .map_err(|e| AppError::Other(format!("Lỗi ghép video scenes: {e}")))?;

    if !concat_output.status.success() {
        let err = String::from_utf8_lossy(&concat_output.stderr);
        return Err(AppError::Other(format!("Concat video failed: {err}")));
    }

    // 3. Chuẩn bị track audio giọng đọc tổng hợp (TTS track)
    let full_tts_audio = temp_dir.join(format!("full_tts_{}.wav", short_id));
    let full_tts_audio_str = full_tts_audio.to_string_lossy().to_string();

    let mut tts_audio_list = String::new();
    let mut has_any_real_tts = false;
    for (idx, scene) in script.scenes.iter().enumerate() {
        if let Some(ref a_path) = scene.audio_path {
            if Path::new(a_path).exists() {
                let norm = a_path.replace('\\', "/");
                tts_audio_list.push_str(&format!("file '{}'\n", norm));
                has_any_real_tts = true;
                continue;
            }
        }
        // Tạo đoạn im lặng tương ứng duration
        let dur = if scene.duration_sec > 0.0 { scene.duration_sec } else { 5.0 };
        let silence_wav = temp_dir.join(format!("silence_{}_{}.wav", short_id, idx));
        let silence_str = silence_wav.to_string_lossy().to_string();

        let _ = app_handle
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| AppError::Other(format!("FFmpeg error: {e}")))?
            .args([
                "-y",
                "-f", "lavfi",
                "-i", &format!("anullsrc=r=44100:cl=mono:d={:.2}", dur),
                "-c:a", "pcm_s16le",
                &silence_str,
            ])
            .output()
            .await;

        let norm = silence_str.replace('\\', "/");
        tts_audio_list.push_str(&format!("file '{}'\n", norm));
    }

    let tts_list_file = temp_dir.join(format!("tts_concat_list_{}.txt", short_id));
    std::fs::write(&tts_list_file, &tts_audio_list)
        .map_err(|e| AppError::Other(format!("Lỗi ghi file tts concat: {e}")))?;
    let tts_list_str = tts_list_file.to_string_lossy().to_string();

    let tts_concat_res = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| AppError::Other(format!("FFmpeg error: {e}")))?
        .args([
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", &tts_list_str,
            "-c:a", "pcm_s16le",
            &full_tts_audio_str,
        ])
        .output()
        .await
        .map_err(|e| AppError::Other(format!("Lỗi ghép track âm thanh TTS: {e}")))?;

    if !tts_concat_res.status.success() {
        let err = String::from_utf8_lossy(&tts_concat_res.stderr);
        return Err(AppError::Other(format!("Concat audio failed: {err}")));
    }

    // 4. Tạo phụ đề SRT
    let srt_content = generate_srt_content(&script.scenes);
    let srt_file = out_dir.join(format!("{}_{}.srt", script.title.replace(' ', "_"), short_id));
    let srt_file_str = srt_file.to_string_lossy().to_string();
    std::fs::write(&srt_file, srt_content)
        .map_err(|e| AppError::Other(format!("Lỗi lưu file phụ đề SRT: {e}")))?;

    // 5. Kiểm tra nhạc nền BGM để ducking
    let mut selected_music_path: Option<String> = None;
    if let Some(ref music_dir) = config.music_dir {
        let dir_p = Path::new(music_dir);
        if dir_p.is_dir() {
            if let Ok(entries) = std::fs::read_dir(dir_p) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                        let ext_lower = ext.to_lowercase();
                        if ext_lower == "mp3" || ext_lower == "wav" || ext_lower == "m4a" {
                            selected_music_path = Some(p.to_string_lossy().to_string());
                            break;
                        }
                    }
                }
            }
        }
    }

    // 6. Ghép toàn bộ vào file thành phẩm cuối cùng:
    // Video + TTS Audio + BGM ducking + SRT Subtitles
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

    // Xử lý bộ lọc filter_complex cho Audio Ducking và Phụ đề
    let mut filter_complex = String::new();
    let vol = config.music_volume.clamp(0.01, 1.0);

    if has_bgm {
        // Audio Ducking: giảm âm lượng BGM khi có giọng TTS (sidechain ducking hoặc volume level)
        filter_complex.push_str(&format!(
            "[2:a]volume={:.2}[bgm];[1:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]",
            vol
        ));
    } else {
        filter_complex.push_str("[1:a]anull[aout]");
    }

    // Phụ đề burn-in (nếu burn_subtitles = true)
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
        return Err(AppError::Other(format!("FFmpeg render failed: {err}")));
    }

    // Dọn file tạm
    let _ = std::fs::remove_file(&concat_list_file);
    let _ = std::fs::remove_file(&raw_concat_video);
    let _ = std::fs::remove_file(&full_tts_audio);
    let _ = std::fs::remove_file(&tts_list_file);

    // Cập nhật trạng thái kịch bản thành "done"
    state.db.update_script_status(&script.id, "done")?;

    Ok(serde_json::json!({
        "ok": true,
        "video_path": final_mp4_str,
        "srt_path": srt_file_str,
        "has_tts": has_any_real_tts,
        "has_bgm": has_bgm,
        "burned_subtitles": burn_subtitles,
    }))
}

