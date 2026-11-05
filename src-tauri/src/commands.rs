use crate::db::chrono_now;
use crate::errors::AppError;
use crate::models::{AppConfig, TaskItem, TaskKind, TemplateItem};
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

