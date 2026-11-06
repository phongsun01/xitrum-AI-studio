use crate::db::chrono_now;
use crate::errors::AppError;
use crate::models::{
    AppConfig, AudioJobItem, AudioSegmentItem, TaskItem, TaskKind, TemplateItem,
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
    let (ok, msg) = state.queue.check_muse_session(Some(cfg.chrome_profile_dir)).await?;
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

