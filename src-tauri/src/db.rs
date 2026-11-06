use crate::errors::AppError;
use crate::models::{
    AppConfig, AudioJobItem, AudioSegmentItem, TaskItem, TaskKind, TaskStatus, TemplateItem,
};
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

        // 3. Bảng Templates (v0.2.0 F6)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                prompt TEXT NOT NULL,
                ratio TEXT,
                created_at INTEGER NOT NULL
            )",
            [],
        )?;

        // 4. Bảng Audio Jobs (v0.3.0 F7)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS audio_jobs (
                id TEXT PRIMARY KEY,
                audio_path TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        )?;

        // 5. Bảng Audio Segments (v0.3.0 F7 & F10, v0.4.0 F12)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS audio_segments (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                start_ms INTEGER NOT NULL,
                end_ms INTEGER NOT NULL,
                text TEXT NOT NULL,
                prompt TEXT,
                ref_image_path TEXT,
                queue_task_id TEXT,
                output_video_path TEXT,
                approval TEXT,
                FOREIGN KEY (job_id) REFERENCES audio_jobs(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Tự động kiểm tra bổ sung cột output_video_path nếu bảng đã tồn tại từ trước
        let _ = conn.execute("ALTER TABLE audio_segments ADD COLUMN output_video_path TEXT", []);

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

    pub fn get_task(&self, id: &str) -> Result<TaskItem, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, kind, status, prompt, ratio, input_path, output_path, progress, error_msg, created_at, updated_at 
             FROM tasks WHERE id = ?1",
        )?;

        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
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
        } else {
            Err(AppError::NotFound(format!("Không tìm thấy task {}", id)))
        }
    }

    pub fn update_task_prompt(&self, id: &str, prompt: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let now = chrono_now();
        let rows_affected = conn.execute(
            "UPDATE tasks SET prompt = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'queued'",
            params![prompt, now, id],
        )?;

        if rows_affected == 0 {
            Err(AppError::Other("Chỉ có thể sửa prompt khi task đang ở trạng thái chờ (queued)".into()))
        } else {
            Ok(())
        }
    }

    // --- Templates CRUD (v0.2.0 F6) ---
    pub fn save_template(&self, tpl: &TemplateItem) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO templates (id, name, prompt, ratio, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![tpl.id, tpl.name, tpl.prompt, tpl.ratio, tpl.created_at],
        )?;
        Ok(())
    }

    pub fn list_templates(&self) -> Result<Vec<TemplateItem>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, prompt, ratio, created_at FROM templates ORDER BY created_at DESC",
        )?;

        let iter = stmt.query_map([], |row| {
            Ok(TemplateItem {
                id: row.get(0)?,
                name: row.get(1)?,
                prompt: row.get(2)?,
                ratio: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;

        let mut list = Vec::new();
        for item in iter {
            list.push(item?);
        }
        Ok(list)
    }

    pub fn delete_template(&self, id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM templates WHERE id = ?1", params![id])?;
        Ok(())
    }

    // --- Audio Jobs & Segments CRUD (v0.3.0 F7, F8, F10) ---
    pub fn create_audio_job(&self, job: &AudioJobItem) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO audio_jobs (id, audio_path, status, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![job.id, job.audio_path, job.status, job.created_at],
        )?;
        Ok(())
    }

    pub fn update_audio_job_status(&self, job_id: &str, status: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE audio_jobs SET status = ?1 WHERE id = ?2",
            params![status, job_id],
        )?;
        Ok(())
    }

    pub fn list_audio_jobs(&self) -> Result<Vec<AudioJobItem>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, audio_path, status, created_at FROM audio_jobs ORDER BY created_at DESC")?;
        let iter = stmt.query_map([], |row| {
            Ok(AudioJobItem {
                id: row.get(0)?,
                audio_path: row.get(1)?,
                status: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        let mut list = Vec::new();
        for item in iter {
            list.push(item?);
        }
        Ok(list)
    }

    pub fn insert_audio_segments(&self, segments: &[AudioSegmentItem]) -> Result<(), AppError> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for s in segments {
            tx.execute(
                "INSERT OR REPLACE INTO audio_segments (id, job_id, seq, start_ms, end_ms, text, prompt, ref_image_path, queue_task_id, output_video_path, approval)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    s.id,
                    s.job_id,
                    s.seq,
                    s.start_ms,
                    s.end_ms,
                    s.text,
                    s.prompt,
                    s.ref_image_path,
                    s.queue_task_id,
                    s.output_video_path,
                    s.approval,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_audio_segments(&self, job_id: &str) -> Result<Vec<AudioSegmentItem>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, job_id, seq, start_ms, end_ms, text, prompt, ref_image_path, queue_task_id, output_video_path, approval
             FROM audio_segments WHERE job_id = ?1 ORDER BY seq ASC",
        )?;
        let iter = stmt.query_map(params![job_id], |row| {
            Ok(AudioSegmentItem {
                id: row.get(0)?,
                job_id: row.get(1)?,
                seq: row.get(2)?,
                start_ms: row.get(3)?,
                end_ms: row.get(4)?,
                text: row.get(5)?,
                prompt: row.get(6)?,
                ref_image_path: row.get(7)?,
                queue_task_id: row.get(8)?,
                output_video_path: row.get(9)?,
                approval: row.get(10)?,
            })
        })?;
        let mut list = Vec::new();
        for item in iter {
            list.push(item?);
        }
        Ok(list)
    }

    pub fn update_audio_segment(
        &self,
        segment_id: &str,
        text: Option<&str>,
        prompt: Option<&str>,
        ref_image_path: Option<&str>,
        output_video_path: Option<&str>,
        approval: Option<&str>,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE audio_segments 
             SET text = COALESCE(?1, text),
                 prompt = COALESCE(?2, prompt),
                 ref_image_path = COALESCE(?3, ref_image_path),
                 output_video_path = COALESCE(?4, output_video_path),
                 approval = COALESCE(?5, approval)
             WHERE id = ?6",
            params![text, prompt, ref_image_path, output_video_path, approval, segment_id],
        )?;
        Ok(())
    }

    pub fn set_segment_queue_task_id(
        &self,
        segment_id: &str,
        queue_task_id: &str,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE audio_segments SET queue_task_id = ?1 WHERE id = ?2",
            params![queue_task_id, segment_id],
        )?;
        Ok(())
    }

    pub fn update_segment_by_task_id(
        &self,
        queue_task_id: &str,
        output_video_path: &str,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE audio_segments SET output_video_path = ?1 WHERE queue_task_id = ?2",
            params![output_video_path, queue_task_id],
        )?;
        Ok(())
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

