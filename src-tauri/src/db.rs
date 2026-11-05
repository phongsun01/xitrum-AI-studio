use crate::errors::AppError;
use crate::models::{AppConfig, TaskItem, TaskKind, TaskStatus};
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self, AppError> {
        let conn = Connection::open(path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();

        // 1. Bảng Tasks
        conn.execute(
            "CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                prompt TEXT,
                ratio TEXT,
                input_path TEXT,
                output_path TEXT,
                progress INTEGER NOT NULL DEFAULT 0,
                error_msg TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        // 2. Bảng Settings
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        // Khôi phục trạng thái: Khi app khởi động lại, các task đang 'running' được reset về 'queued'
        conn.execute(
            "UPDATE tasks SET status = 'queued' WHERE status = 'running'",
            [],
        )?;

        Ok(())
    }

    pub fn insert_task(&self, task: &TaskItem) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let kind_str = serde_json::to_string(&task.kind)?;
        let status_str = serde_json::to_string(&task.status)?;

        conn.execute(
            "INSERT INTO tasks (id, kind, status, prompt, ratio, input_path, output_path, progress, error_msg, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                task.id,
                kind_str.trim_matches('"'),
                status_str.trim_matches('"'),
                task.prompt,
                task.ratio,
                task.input_path,
                task.output_path,
                task.progress,
                task.error_msg,
                task.created_at,
                task.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_task_status(
        &self,
        id: &str,
        status: TaskStatus,
        progress: u32,
        output_path: Option<&str>,
        error_msg: Option<&str>,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let status_str = serde_json::to_string(&status)?;
        let now = chrono_now();

        conn.execute(
            "UPDATE tasks SET status = ?1, progress = ?2, output_path = COALESCE(?3, output_path), error_msg = ?4, updated_at = ?5 WHERE id = ?6",
            params![
                status_str.trim_matches('"'),
                progress,
                output_path,
                error_msg,
                now,
                id,
            ],
        )?;
        Ok(())
    }

    pub fn list_tasks(&self) -> Result<Vec<TaskItem>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, kind, status, prompt, ratio, input_path, output_path, progress, error_msg, created_at, updated_at 
             FROM tasks ORDER BY created_at DESC",
        )?;

        let task_iter = stmt.query_map([], |row| {
            let kind_raw: String = row.get(1)?;
            let status_raw: String = row.get(2)?;

            let kind = serde_json::from_str(&format!("\"{}\"", kind_raw)).unwrap_or(TaskKind::MuseVideo);
            let status = serde_json::from_str(&format!("\"{}\"", status_raw)).unwrap_or(TaskStatus::Queued);

            Ok(TaskItem {
                id: row.get(0)?,
                kind,
                status,
                prompt: row.get(3)?,
                ratio: row.get(4)?,
                input_path: row.get(5)?,
                output_path: row.get(6)?,
                progress: row.get(7)?,
                error_msg: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;

        let mut list = Vec::new();
        for task in task_iter {
            list.push(task?);
        }
        Ok(list)
    }

    pub fn get_config(&self) -> Result<AppConfig, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = 'app_config'")?;
        let mut rows = stmt.query([])?;

        if let Some(row) = rows.next()? {
            let json_str: String = row.get(0)?;
            let config: AppConfig = serde_json::from_str(&json_str)?;
            Ok(config)
        } else {
            Ok(AppConfig::default())
        }
    }

    pub fn save_config(&self, config: &AppConfig) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let json_str = serde_json::to_string(config)?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('app_config', ?1)",
            params![json_str],
        )?;
        Ok(())
    }
}

pub fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

