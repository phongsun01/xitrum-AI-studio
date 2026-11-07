use crate::errors::AppError;
use crate::migrations::MigrationManager;
use crate::models::{
    AppConfig, AudioJobItem, AudioSegmentItem, CharacterItem, ProductItem, ProxyItem, ScriptProjectItem,
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
        let mut conn = Connection::open(path.as_ref())?;
        // S7: Kích hoạt PRAGMA foreign_keys = ON để cascading delete và quan hệ khóa ngoại có hiệu lực
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;

        // Chạy versioned migration có backup an toàn và rollback khi lỗi
        MigrationManager::migrate(&mut conn, path.as_ref())
            .map_err(|e| AppError::Other(format!("Database migration failed: {e}")))?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_defaults()?;
        Ok(db)
    }

    fn init_defaults(&self) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();

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
            "INSERT INTO tasks (id, kind, status, prompt, ratio, input_path, output_path, progress, error_msg, created_at, updated_at, provider, connection_mode, requested_model, observed_model, generation_key, scene_revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
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
                task.provider.as_deref().unwrap_or("muse"),
                task.connection_mode.as_deref().unwrap_or("muse_web"),
                task.requested_model,
                task.observed_model,
                task.generation_key,
                task.scene_revision.unwrap_or(1),
            ],
        )?;
        Ok(())
    }

    pub fn find_task_by_generation_key(&self, generation_key: &str) -> Result<Option<TaskItem>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, kind, status, prompt, ratio, input_path, output_path, progress, error_msg, created_at, updated_at, provider, connection_mode, requested_model, observed_model, generation_key, scene_revision
             FROM tasks WHERE generation_key = ?1 ORDER BY created_at DESC LIMIT 1",
        )?;

        let mut rows = stmt.query(params![generation_key])?;
        if let Some(row) = rows.next()? {
            let kind_raw: String = row.get(1)?;
            let status_raw: String = row.get(2)?;
            let kind = serde_json::from_str(&format!("\"{}\"", kind_raw)).unwrap_or(TaskKind::MuseVideo);
            let status = serde_json::from_str(&format!("\"{}\"", status_raw)).unwrap_or(TaskStatus::Queued);

            Ok(Some(TaskItem {
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
                provider: row.get(11)?,
                connection_mode: row.get(12)?,
                requested_model: row.get(13)?,
                observed_model: row.get(14)?,
                generation_key: row.get(15)?,
                scene_revision: row.get(16)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn list_pending_tasks(&self) -> Result<Vec<TaskItem>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, kind, status, prompt, ratio, input_path, output_path, progress, error_msg, created_at, updated_at, provider, connection_mode, requested_model, observed_model, generation_key, scene_revision
             FROM tasks WHERE status = 'queued' ORDER BY created_at ASC",
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
                provider: row.get(11)?,
                connection_mode: row.get(12)?,
                requested_model: row.get(13)?,
                observed_model: row.get(14)?,
                generation_key: row.get(15)?,
                scene_revision: row.get(16)?,
            })
        })?;

        let mut list = Vec::new();
        for task in task_iter {
            list.push(task?);
        }
        Ok(list)
    }

    pub fn record_task_attempt(&self, attempt: &crate::models::TaskAttemptItem) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO task_attempts (id, task_id, attempt_num, phase, remote_job_id, session_id, error_code, error_msg, started_at, finished_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                attempt.id,
                attempt.task_id,
                attempt.attempt_num,
                attempt.phase,
                attempt.remote_job_id,
                attempt.session_id,
                attempt.error_code,
                attempt.error_msg,
                attempt.started_at,
                attempt.finished_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_latest_task_attempt(&self, task_id: &str) -> Result<Option<crate::models::TaskAttemptItem>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, task_id, attempt_num, phase, remote_job_id, session_id, error_code, error_msg, started_at, finished_at
             FROM task_attempts WHERE task_id = ?1 ORDER BY attempt_num DESC LIMIT 1",
        )?;

        let mut rows = stmt.query(params![task_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(crate::models::TaskAttemptItem {
                id: row.get(0)?,
                task_id: row.get(1)?,
                attempt_num: row.get(2)?,
                phase: row.get(3)?,
                remote_job_id: row.get(4)?,
                session_id: row.get(5)?,
                error_code: row.get(6)?,
                error_msg: row.get(7)?,
                started_at: row.get(8)?,
                finished_at: row.get(9)?,
            }))
        } else {
            Ok(None)
        }
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
            "SELECT id, kind, status, prompt, ratio, input_path, output_path, progress, error_msg, created_at, updated_at, provider, connection_mode, requested_model, observed_model, generation_key, scene_revision
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
                provider: row.get(11)?,
                connection_mode: row.get(12)?,
                requested_model: row.get(13)?,
                observed_model: row.get(14)?,
                generation_key: row.get(15)?,
                scene_revision: row.get(16)?,
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
            "SELECT id, kind, status, prompt, ratio, input_path, output_path, progress, error_msg, created_at, updated_at, provider, connection_mode, requested_model, observed_model, generation_key, scene_revision
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
                provider: row.get(11)?,
                connection_mode: row.get(12)?,
                requested_model: row.get(13)?,
                observed_model: row.get(14)?,
                generation_key: row.get(15)?,
                scene_revision: row.get(16)?,
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
            "INSERT OR REPLACE INTO scripts (id, title, idea, genre, target_duration_sec, ratio, status, environment_lock_en, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                script.id,
                script.title,
                script.idea,
                script.genre,
                script.target_duration_sec,
                script.ratio,
                script.status,
                script.environment_lock_en,
                script.created_at,
                script.updated_at,
            ],
        )?;

        // Xóa characters, products và scenes cũ nếu update
        tx.execute("DELETE FROM characters WHERE script_id = ?1", params![script.id])?;
        tx.execute("DELETE FROM products WHERE script_id = ?1", params![script.id])?;
        tx.execute("DELETE FROM script_scenes WHERE script_id = ?1", params![script.id])?;

        for c in &script.characters {
            tx.execute(
                "INSERT INTO characters (id, script_id, name, description, voice, ref_image_path, identity_lock_en, locked, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![c.id, script.id, c.name, c.description, c.voice, c.ref_image_path, c.identity_lock_en, c.locked as i32, c.created_at],
            )?;
        }

        for p in &script.products {
            tx.execute(
                "INSERT INTO products (id, script_id, name, description, image_path, product_lock_en, locked, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![p.id, script.id, p.name, p.description, p.image_path, p.product_lock_en, p.locked as i32, p.created_at],
            )?;
        }

        for s in &script.scenes {
            let camera_moves_json = serde_json::to_string(&s.camera_moves).unwrap_or_else(|_| "[]".to_string());
            let style_str = s.style.clone().unwrap_or_else(|| "default".to_string());
            tx.execute(
                "INSERT INTO script_scenes (id, script_id, scene_no, narration, visual_prompt, video_prompt, character, duration_sec, ref_image_path, audio_path, video_path, queue_task_id, product_id, camera_moves, style)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
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
                    s.product_id,
                    camera_moves_json,
                    style_str,
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn get_script_project(&self, script_id: &str) -> Result<Option<ScriptProjectItem>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, idea, genre, target_duration_sec, ratio, status, environment_lock_en, created_at, updated_at
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
            let environment_lock_en: Option<String> = row.get(7)?;
            let created_at: i64 = row.get(8)?;
            let updated_at: i64 = row.get(9)?;

            let mut char_stmt = conn.prepare(
                "SELECT id, name, description, voice, ref_image_path, identity_lock_en, locked, created_at
                 FROM characters WHERE script_id = ?1 ORDER BY created_at ASC",
            )?;
            let char_rows = char_stmt.query_map(params![script_id], |r| {
                let locked_int: i32 = r.get(6).unwrap_or(0);
                Ok(CharacterItem {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    description: r.get(2)?,
                    voice: r.get(3)?,
                    ref_image_path: r.get(4)?,
                    identity_lock_en: r.get(5)?,
                    locked: locked_int != 0,
                    created_at: r.get(7)?,
                })
            })?;
            let mut characters = Vec::new();
            for c in char_rows {
                characters.push(c?);
            }

            let mut prod_stmt = conn.prepare(
                "SELECT id, script_id, name, description, image_path, product_lock_en, locked, created_at
                 FROM products WHERE script_id = ?1 ORDER BY created_at ASC",
            )?;
            let prod_rows = prod_stmt.query_map(params![script_id], |r| {
                let locked_int: i32 = r.get(6).unwrap_or(0);
                Ok(ProductItem {
                    id: r.get(0)?,
                    script_id: r.get(1)?,
                    name: r.get(2)?,
                    description: r.get(3)?,
                    image_path: r.get(4)?,
                    product_lock_en: r.get(5)?,
                    locked: locked_int != 0,
                    created_at: r.get(7)?,
                })
            })?;
            let mut products = Vec::new();
            for p in prod_rows {
                products.push(p?);
            }

            let mut scene_stmt = conn.prepare(
                "SELECT id, script_id, scene_no, narration, visual_prompt, video_prompt, character, duration_sec, ref_image_path, audio_path, video_path, queue_task_id, product_id, camera_moves, style
                 FROM script_scenes WHERE script_id = ?1 ORDER BY scene_no ASC",
            )?;
            let scene_rows = scene_stmt.query_map(params![script_id], |r| {
                let moves_str: String = r.get(13).unwrap_or_else(|_| "[]".to_string());
                let camera_moves: Vec<String> = serde_json::from_str(&moves_str).unwrap_or_default();
                let style: Option<String> = r.get(14).ok();
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
                    product_id: r.get(12)?,
                    camera_moves,
                    style: style.or_else(|| Some("default".to_string())),
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
                environment_lock_en,
                created_at,
                updated_at,
                characters,
                products,
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
        let camera_moves_json = serde_json::to_string(&scene.camera_moves).unwrap_or_else(|_| "[]".to_string());
        let style_str = scene.style.clone().unwrap_or_else(|| "default".to_string());
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
                queue_task_id = ?9,
                product_id = ?10,
                camera_moves = ?11,
                style = ?12
             WHERE id = ?13",
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
                scene.product_id,
                camera_moves_json,
                style_str,
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

    pub fn update_character_lock(&self, character_id: &str, identity_lock_en: Option<&str>, locked: bool) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE characters SET identity_lock_en = ?1, locked = ?2 WHERE id = ?3",
            params![identity_lock_en, locked as i32, character_id],
        )?;
        Ok(())
    }

    pub fn update_product_lock(&self, product_id: &str, product_lock_en: Option<&str>, locked: bool) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE products SET product_lock_en = ?1, locked = ?2 WHERE id = ?3",
            params![product_lock_en, locked as i32, product_id],
        )?;
        Ok(())
    }

    pub fn delete_script_project(&self, script_id: &str) -> Result<(), AppError> {
        let mut conn = self.conn.lock().unwrap();
        // S7: Xóa trong 1 giao dịch và dọn dẹp sạch cả 4 bảng
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM script_scenes WHERE script_id = ?1", params![script_id])?;
        tx.execute("DELETE FROM products WHERE script_id = ?1", params![script_id])?;
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

