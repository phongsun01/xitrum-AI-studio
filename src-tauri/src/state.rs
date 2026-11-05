use crate::db::Database;
use crate::queue::QueueManager;
use std::sync::Arc;

pub struct AppState {
    pub db: Arc<Database>,
    pub queue: Arc<QueueManager>,
}

impl AppState {
    pub fn new(db_path: &str, app_handle: tauri::AppHandle) -> Self {
        let db = Arc::new(Database::new(db_path).expect("Failed to initialize SQLite database"));
        let queue = Arc::new(QueueManager::new(Arc::clone(&db), app_handle));
        Self { db, queue }
    }
}
