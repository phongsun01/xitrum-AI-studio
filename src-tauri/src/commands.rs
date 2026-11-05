use crate::errors::AppError;
use crate::models::{AppConfig, TaskItem, TaskKind};
use crate::state::AppState;
use tauri::State;

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

