use crate::errors::AppError;
use crate::models::{
    AppConfig, AudioJobItem, AudioSegmentItem, CharacterItem, ProxyItem, ScriptProjectItem,
    ScriptSceneItem, TaskItem, TaskKind, TaskStatus, TemplateItem,
};
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }

    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self, AppError> {
        let conn = Connection::open(path)?;
        // S7: Kích hoạt PRAGMA foreign_keys = ON để cascading delete và quan hệ khóa ngoại có hiệu lực
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
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

        // Khởi tạo các template mẫu chất lượng cao nếu bảng templates còn trống
        let tpl_count: i64 = conn.query_row(
            "SELECT count(*) FROM templates",
            [],
            |r| r.get(0),
        ).unwrap_or(0);

        if tpl_count == 0 {
            let default_templates = vec![
                (
                    "tpl-tiktok-hook",
                    "📱 TikTok Hook - Giữ Chân Người Xem",
                    "A charismatic presenter talking dynamically towards the camera, energetic hand gestures, expressive face, modern studio background with neon accent lights, cinematic lighting, 4k ultra-realistic.",
                    "9:16"
                ),
                (
                    "tpl-cinematic-broll",
                    "🎬 Điện Ảnh - Cinematic B-Roll",
                    "Slow motion cinematic panning shot, warm sunset golden hour lighting, gentle wind blowing, shallow depth of field, anamorphic lens flare, professional film color grading 8k.",
                    "16:9"
                ),
                (
                    "tpl-podcast-talk",
                    "🎙️ Podcast / Talkshow Phỏng Vấn",
                    "Close-up interview angle, speaker talking thoughtfully in front of a shure microphone, cozy ambient warm cafe studio, natural bokeh background, soft rim light.",
                    "16:9"
                ),
                (
                    "tpl-review-showcase",
                    "📦 Review Sản Phẩm / Đập Hộp",
                    "Top-down isometric view transitioning to front view, hands unboxing luxury premium device, clean minimalist wooden desk setup, crisp shadows, sharp product focus.",
                    "9:16"
                ),
                (
                    "tpl-tech-explainer",
                    "💡 Giải Thích Khoa Học / Công Nghệ",
                    "Modern expert standing in high-tech laboratory with glowing holographic data charts floating around, pointing and explaining complex concepts, sleek futuristic aesthetic.",
                    "16:9"
                )
            ];

            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            for (id, name, prompt, ratio) in default_templates {
                let _ = conn.execute(
                    "INSERT INTO templates (id, name, prompt, ratio, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![id, name, prompt, ratio, now],
                );
            }
        }

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

        // 6. Bảng Scripts (Mốc 1 - Ý tưởng -> Kịch bản)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS scripts (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                idea TEXT,
                genre TEXT,
                target_duration_sec INTEGER,
                ratio TEXT NOT NULL DEFAULT '16:9',
                status TEXT NOT NULL DEFAULT 'draft',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        // 7. Bảng Characters (Mốc 1 - Character Bible)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS characters (
                id TEXT PRIMARY KEY,
                script_id TEXT,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                voice TEXT,
                ref_image_path TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // 8. Bảng Script Scenes (Mốc 1 - Phân cảnh kịch bản)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS script_scenes (
                id TEXT PRIMARY KEY,
                script_id TEXT NOT NULL,
                scene_no INTEGER NOT NULL,
                narration TEXT NOT NULL,
                visual_prompt TEXT NOT NULL,
                video_prompt TEXT NOT NULL,
                character TEXT,
                duration_sec REAL NOT NULL DEFAULT 5.0,
                ref_image_path TEXT,
                audio_path TEXT,
                video_path TEXT,
                queue_task_id TEXT,
                FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // 9. Bảng Proxies (Mốc 3 - Quản lý Proxy Bảo Mật)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS proxies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                raw_masked TEXT NOT NULL,
                scheme TEXT DEFAULT 'http',
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT,
                encrypted_password TEXT,
                status TEXT DEFAULT 'unknown',
                ip TEXT,
                latency_ms INTEGER,
                checked_at REAL
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

    // ==========================================
    // SCRIPTS & CHARACTER BIBLE METHODS (Mốc 1)
    // ==========================================

    pub fn save_script_project(&self, script: &ScriptProjectItem) -> Result<(), AppError> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        tx.execute(
            "INSERT OR REPLACE INTO scripts (id, title, idea, genre, target_duration_sec, ratio, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                script.id,
                script.title,
                script.idea,
                script.genre,
                script.target_duration_sec,
                script.ratio,
                script.status,
                script.created_at,
                script.updated_at,
            ],
        )?;

        // Xóa characters và scenes cũ nếu update
        tx.execute("DELETE FROM characters WHERE script_id = ?1", params![script.id])?;
        tx.execute("DELETE FROM script_scenes WHERE script_id = ?1", params![script.id])?;

        for c in &script.characters {
            tx.execute(
                "INSERT INTO characters (id, script_id, name, description, voice, ref_image_path, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![c.id, script.id, c.name, c.description, c.voice, c.ref_image_path, c.created_at],
            )?;
        }

        for s in &script.scenes {
            tx.execute(
                "INSERT INTO script_scenes (id, script_id, scene_no, narration, visual_prompt, video_prompt, character, duration_sec, ref_image_path, audio_path, video_path, queue_task_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    s.id,
                    script.id,
                    s.scene_no,
                    s.narration,
                    s.visual_prompt,
                    s.video_prompt,
                    s.character,
                    s.duration_sec,
                    s.ref_image_path,
                    s.audio_path,
                    s.video_path,
                    s.queue_task_id,
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn get_script_project(&self, script_id: &str) -> Result<Option<ScriptProjectItem>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, idea, genre, target_duration_sec, ratio, status, created_at, updated_at
             FROM scripts WHERE id = ?1",
        )?;

        let mut rows = stmt.query(params![script_id])?;
        if let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            let title: String = row.get(1)?;
            let idea: Option<String> = row.get(2)?;
            let genre: Option<String> = row.get(3)?;
            let target_duration_sec: Option<i32> = row.get(4)?;
            let ratio: String = row.get(5)?;
            let status: String = row.get(6)?;
            let created_at: i64 = row.get(7)?;
            let updated_at: i64 = row.get(8)?;

            let mut char_stmt = conn.prepare(
                "SELECT id, name, description, voice, ref_image_path, created_at
                 FROM characters WHERE script_id = ?1 ORDER BY created_at ASC",
            )?;
            let char_rows = char_stmt.query_map(params![script_id], |r| {
                Ok(CharacterItem {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    description: r.get(2)?,
                    voice: r.get(3)?,
                    ref_image_path: r.get(4)?,
                    created_at: r.get(5)?,
                })
            })?;
            let mut characters = Vec::new();
            for c in char_rows {
                characters.push(c?);
            }

            let mut scene_stmt = conn.prepare(
                "SELECT id, script_id, scene_no, narration, visual_prompt, video_prompt, character, duration_sec, ref_image_path, audio_path, video_path, queue_task_id
                 FROM script_scenes WHERE script_id = ?1 ORDER BY scene_no ASC",
            )?;
            let scene_rows = scene_stmt.query_map(params![script_id], |r| {
                Ok(ScriptSceneItem {
                    id: r.get(0)?,
                    script_id: r.get(1)?,
                    scene_no: r.get(2)?,
                    narration: r.get(3)?,
                    visual_prompt: r.get(4)?,
                    video_prompt: r.get(5)?,
                    character: r.get(6)?,
                    duration_sec: r.get(7)?,
                    ref_image_path: r.get(8)?,
                    audio_path: r.get(9)?,
                    video_path: r.get(10)?,
                    queue_task_id: r.get(11)?,
                })
            })?;
            let mut scenes = Vec::new();
            for s in scene_rows {
                scenes.push(s?);
            }

            Ok(Some(ScriptProjectItem {
                id,
                title,
                idea,
                genre,
                target_duration_sec,
                ratio,
                status,
                created_at,
                updated_at,
                characters,
                scenes,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn list_script_projects(&self) -> Result<Vec<ScriptProjectItem>, AppError> {
        let ids: Vec<String> = {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT id FROM scripts ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            let mut result = Vec::new();
            for id in rows {
                result.push(id?);
            }
            result
        };

        let mut list = Vec::new();
        for id in ids {
            if let Some(script) = self.get_script_project(&id)? {
                list.push(script);
            }
        }
        Ok(list)
    }

    pub fn update_script_scene_task(
        &self,
        scene_id: &str,
        queue_task_id: &str,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE script_scenes SET queue_task_id = ?1 WHERE id = ?2",
            params![queue_task_id, scene_id],
        )?;
        Ok(())
    }

    pub fn update_script_scene_by_task_id(
        &self,
        queue_task_id: &str,
        video_path: &str,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE script_scenes SET video_path = ?1 WHERE queue_task_id = ?2",
            params![video_path, queue_task_id],
        )?;
        Ok(())
    }

    pub fn update_script_status(&self, script_id: &str, status: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE scripts SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, crate::db::chrono_now(), script_id],
        )?;
        Ok(())
    }

    pub fn update_script_scene(&self, scene: &ScriptSceneItem) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE script_scenes SET
                narration = ?1,
                visual_prompt = ?2,
                video_prompt = ?3,
                character = ?4,
                duration_sec = ?5,
                ref_image_path = ?6,
                audio_path = ?7,
                video_path = ?8,
                queue_task_id = ?9
             WHERE id = ?10",
            params![
                scene.narration,
                scene.visual_prompt,
                scene.video_prompt,
                scene.character,
                scene.duration_sec,
                scene.ref_image_path,
                scene.audio_path,
                scene.video_path,
                scene.queue_task_id,
                scene.id,
            ],
        )?;
        Ok(())
    }

    pub fn update_character_ref_image(&self, character_id: &str, ref_image_path: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE characters SET ref_image_path = ?1 WHERE id = ?2",
            params![ref_image_path, character_id],
        )?;
        Ok(())
    }

    pub fn delete_script_project(&self, script_id: &str) -> Result<(), AppError> {
        let mut conn = self.conn.lock().unwrap();
        // S7: Xóa trong 1 giao dịch và dọn dẹp sạch cả 3 bảng
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM script_scenes WHERE script_id = ?1", params![script_id])?;
        tx.execute("DELETE FROM characters WHERE script_id = ?1", params![script_id])?;
        tx.execute("DELETE FROM scripts WHERE id = ?1", params![script_id])?;
        tx.commit()?;
        Ok(())
    }

    // ==========================================
    // PROXIES CRUD & MANAGEMENT (Mốc 3)
    // ==========================================

    pub fn insert_proxy(
        &self,
        name: Option<&str>,
        raw_masked: &str,
        scheme: &str,
        host: &str,
        port: i32,
        username: Option<&str>,
        encrypted_password: Option<&str>,
    ) -> Result<i64, AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO proxies (name, raw_masked, scheme, host, port, username, encrypted_password, status, checked_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'unknown', ?8)",
            params![
                name,
                raw_masked,
                scheme,
                host,
                port,
                username,
                encrypted_password,
                crate::db::chrono_now() as f64 / 1000.0,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_proxies(&self) -> Result<Vec<ProxyItem>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, raw_masked, scheme, host, port, username, encrypted_password, status, ip, latency_ms, checked_at
             FROM proxies ORDER BY id DESC",
        )?;

        let rows = stmt.query_map([], |r| {
            Ok(ProxyItem {
                id: r.get(0)?,
                name: r.get(1)?,
                raw_masked: r.get(2)?,
                scheme: r.get(3)?,
                host: r.get(4)?,
                port: r.get(5)?,
                username: r.get(6)?,
                encrypted_password: r.get(7)?,
                status: r.get(8)?,
                ip: r.get(9)?,
                latency_ms: r.get(10)?,
                checked_at: r.get(11)?,
            })
        })?;

        let mut list = Vec::new();
        for p in rows {
            list.push(p?);
        }
        Ok(list)
    }

    pub fn get_proxy(&self, id: i64) -> Result<Option<ProxyItem>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, raw_masked, scheme, host, port, username, encrypted_password, status, ip, latency_ms, checked_at
             FROM proxies WHERE id = ?1",
        )?;

        let mut rows = stmt.query(params![id])?;
        if let Some(r) = rows.next()? {
            Ok(Some(ProxyItem {
                id: r.get(0)?,
                name: r.get(1)?,
                raw_masked: r.get(2)?,
                scheme: r.get(3)?,
                host: r.get(4)?,
                port: r.get(5)?,
                username: r.get(6)?,
                encrypted_password: r.get(7)?,
                status: r.get(8)?,
                ip: r.get(9)?,
                latency_ms: r.get(10)?,
                checked_at: r.get(11)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn update_proxy_status(
        &self,
        id: i64,
        status: &str,
        ip: Option<&str>,
        latency_ms: Option<i32>,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let now = crate::db::chrono_now() as f64 / 1000.0;
        conn.execute(
            "UPDATE proxies SET status = ?1, ip = ?2, latency_ms = ?3, checked_at = ?4 WHERE id = ?5",
            params![status, ip, latency_ms, now, id],
        )?;
        Ok(())
    }

    pub fn delete_proxy(&self, id: i64) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM proxies WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn delete_dead_proxies(&self) -> Result<usize, AppError> {
        let conn = self.conn.lock().unwrap();
        let count = conn.execute("DELETE FROM proxies WHERE status = 'dead'", [])?;
        Ok(count)
    }
}

pub fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

