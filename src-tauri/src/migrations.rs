use anyhow::{anyhow, Result};
use rusqlite::Connection;
use std::path::Path;

pub struct MigrationManager;

struct Migration {
    version: i32,
    description: &'static str,
    sql: &'static str,
}

impl MigrationManager {
    /// Định nghĩa danh sách migration theo thứ tự phiên bản tăng dần
    fn get_migrations() -> Vec<Migration> {
        vec![
            Migration {
                version: 1,
                description: "Khởi tạo schema baseline v0.7.0",
                sql: r#"
                    -- 1. Bảng Tasks
                    CREATE TABLE IF NOT EXISTS tasks (
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
                    );

                    -- 2. Bảng Settings
                    CREATE TABLE IF NOT EXISTS settings (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    );

                    -- 3. Bảng Templates
                    CREATE TABLE IF NOT EXISTS templates (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        prompt TEXT NOT NULL,
                        ratio TEXT,
                        created_at INTEGER NOT NULL
                    );

                    -- 4. Bảng Audio Jobs
                    CREATE TABLE IF NOT EXISTS audio_jobs (
                        id TEXT PRIMARY KEY,
                        audio_path TEXT NOT NULL,
                        status TEXT NOT NULL,
                        created_at INTEGER NOT NULL
                    );

                    -- 5. Bảng Audio Segments
                    CREATE TABLE IF NOT EXISTS audio_segments (
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
                    );

                    -- 6. Bảng Scripts
                    CREATE TABLE IF NOT EXISTS scripts (
                        id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        idea TEXT NOT NULL,
                        genre TEXT,
                        target_duration_sec INTEGER NOT NULL DEFAULT 60,
                        ratio TEXT NOT NULL DEFAULT '16:9',
                        status TEXT NOT NULL DEFAULT 'draft',
                        environment_lock_en TEXT,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    );

                    -- 7. Bảng Script Scenes
                    CREATE TABLE IF NOT EXISTS script_scenes (
                        id TEXT PRIMARY KEY,
                        script_id TEXT NOT NULL,
                        scene_num INTEGER NOT NULL,
                        duration_sec INTEGER NOT NULL DEFAULT 5,
                        visual_summary TEXT,
                        prompt_en TEXT NOT NULL,
                        voiceover_vi TEXT,
                        ref_image_path TEXT,
                        queue_task_id TEXT,
                        output_video_path TEXT,
                        audio_task_id TEXT,
                        audio_path TEXT,
                        status TEXT NOT NULL DEFAULT 'pending',
                        FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE
                    );

                    -- 8. Bảng Characters
                    CREATE TABLE IF NOT EXISTS characters (
                        id TEXT PRIMARY KEY,
                        script_id TEXT NOT NULL,
                        name TEXT NOT NULL,
                        gender TEXT,
                        age_group TEXT,
                        clothing_prompt_en TEXT,
                        appearance_prompt_en TEXT NOT NULL,
                        avatar_path TEXT,
                        created_at INTEGER NOT NULL,
                        FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE
                    );

                    -- 9. Bảng Products
                    CREATE TABLE IF NOT EXISTS products (
                        id TEXT PRIMARY KEY,
                        script_id TEXT NOT NULL,
                        name TEXT NOT NULL,
                        category TEXT,
                        features_en TEXT NOT NULL,
                        image_path TEXT,
                        created_at INTEGER NOT NULL,
                        FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE
                    );

                    -- 10. Bảng Proxies
                    CREATE TABLE IF NOT EXISTS proxies (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT,
                        raw_masked TEXT NOT NULL,
                        scheme TEXT NOT NULL DEFAULT 'http',
                        host TEXT NOT NULL,
                        port INTEGER NOT NULL,
                        username TEXT,
                        encrypted_password TEXT,
                        status TEXT NOT NULL DEFAULT 'unknown',
                        ip TEXT,
                        latency_ms INTEGER,
                        checked_at REAL
                    );
                "#,
            },
            Migration {
                version: 2,
                description: "Chuẩn bị các trường metadata cho G1-G3: provider, connection_mode, generation_key",
                sql: r#"
                    -- Thêm các cột phục vụ idempotent queue và provider abstraction
                    ALTER TABLE tasks ADD COLUMN provider TEXT DEFAULT 'muse';
                    ALTER TABLE tasks ADD COLUMN connection_mode TEXT DEFAULT 'muse_web';
                    ALTER TABLE tasks ADD COLUMN requested_model TEXT;
                    ALTER TABLE tasks ADD COLUMN observed_model TEXT;
                    ALTER TABLE tasks ADD COLUMN generation_key TEXT;
                    ALTER TABLE tasks ADD COLUMN scene_revision INTEGER DEFAULT 1;

                    -- Bảng quản lý attempt chi tiết cho từng task (G1)
                    CREATE TABLE IF NOT EXISTS task_attempts (
                        id TEXT PRIMARY KEY,
                        task_id TEXT NOT NULL,
                        attempt_num INTEGER NOT NULL,
                        phase TEXT NOT NULL,
                        remote_job_id TEXT,
                        session_id TEXT,
                        error_code TEXT,
                        error_msg TEXT,
                        started_at INTEGER NOT NULL,
                        finished_at INTEGER,
                        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
                    );
                "#,
            },
            Migration {
                version: 3,
                description: "G1 Index cho generation_key và trạng thái tasks",
                sql: r#"
                    -- Index hỗ trợ tra cứu nhanh generation_key tránh dispatch trùng lặp
                    CREATE INDEX IF NOT EXISTS idx_tasks_generation_key ON tasks(generation_key);
                    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
                    CREATE INDEX IF NOT EXISTS idx_task_attempts_task_id ON task_attempts(task_id);
                "#,
            },
        ]
    }

    /// Thực hiện backup database an toàn sang file .bak (tương thích cả WAL mode bằng VACUUM INTO)
    pub fn backup_database(conn: &Connection, db_path: &Path) -> Result<Option<std::path::PathBuf>> {
        // Nếu DB trong bộ nhớ (:memory:) thì bỏ qua bước sao lưu file
        if db_path.to_string_lossy() == ":memory:" || !db_path.exists() {
            return Ok(None);
        }

        let now = chrono_now();
        let backup_path = db_path.with_extension(format!("bak.{}.db", now));
        let backup_str = backup_path.to_string_lossy().to_string();

        // Sử dụng VACUUM INTO để sinh snapshot độc lập và nhất quán ngay cả khi có WAL file
        conn.execute(&format!("VACUUM INTO '{}'", backup_str.replace('\'', "''")), [])
            .map_err(|e| anyhow!("Failed to create database backup snapshot via VACUUM INTO: {e}"))?;

        tracing::info!("Database backed up successfully to: {:?}", backup_path);
        Ok(Some(backup_path))
    }

    /// Kiểm tra và áp dụng tất cả migrations chưa chạy
    pub fn migrate(conn: &mut Connection, db_path: &Path) -> Result<()> {
        // Đảm bảo bật Foreign Keys và tạo bảng lưu vết migrations
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS schema_migrations (
                 version INTEGER PRIMARY KEY,
                 applied_at INTEGER NOT NULL,
                 description TEXT NOT NULL
             );"
        ).map_err(|e| anyhow!("Failed to initialize schema_migrations table: {e}"))?;

        let current_version: i32 = conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |r| r.get(0),
        ).unwrap_or(0);

        let migrations = Self::get_migrations();
        let pending: Vec<&Migration> = migrations.iter().filter(|m| m.version > current_version).collect();

        if pending.is_empty() {
            tracing::info!("Database schema is up to date (version {})", current_version);
            return Ok(());
        }

        tracing::info!(
            "Current DB version is {}. Found {} pending migration(s). Backing up first...",
            current_version,
            pending.len()
        );

        // Tạo backup an toàn trước khi chạy các migration
        let backup_file = Self::backup_database(conn, db_path)?;

        for m in pending {
            tracing::info!("Applying migration v{}: {}", m.version, m.description);

            // Chạy trong Transaction; nếu lỗi lập tức rollback và dừng lại
            let tx = conn.transaction()
                .map_err(|e| anyhow!("Failed to start transaction for migration v{}: {e}", m.version))?;

            if let Err(e) = tx.execute_batch(m.sql) {
                let _ = tx.rollback();
                return Err(anyhow!(
                    "Migration v{} failed and was rolled back! Error: {}. (Backup file: {:?})",
                    m.version, e, backup_file
                ));
            }

            let now = chrono_now();
            if let Err(e) = tx.execute(
                "INSERT INTO schema_migrations (version, applied_at, description) VALUES (?1, ?2, ?3)",
                rusqlite::params![m.version, now, m.description],
            ) {
                let _ = tx.rollback();
                return Err(anyhow!("Failed to record migration v{}: {e}", m.version));
            }

            tx.commit()
                .map_err(|e| anyhow!("Failed to commit migration v{}: {e}", m.version))?;

            tracing::info!("Migration v{} applied successfully.", m.version);
        }

        Ok(())
    }
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn test_migration_versioning_and_idempotence() {
        let mut conn = Connection::open_in_memory().unwrap();
        let dummy_path = Path::new(":memory:");

        // Chạy migration lần 1
        MigrationManager::migrate(&mut conn, dummy_path).expect("First migration should succeed");

        let v1: i32 = conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0)).unwrap();
        assert_eq!(v1, 3);

        // Kiểm tra cấu trúc các bảng đã tạo
        let count: i64 = conn.query_row("SELECT count(*) FROM tasks", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);

        // Kiểm tra các cột mới đã tồn tại
        conn.execute("INSERT INTO tasks (id, kind, status, created_at, updated_at, provider) VALUES ('t1', 'muse_video', 'queued', 100, 100, 'muse')", []).unwrap();
        let provider: String = conn.query_row("SELECT provider FROM tasks WHERE id = 't1'", [], |r| r.get(0)).unwrap();
        assert_eq!(provider, "muse");

        // Chạy migration lần 2: phải idempotent (không thay đổi dữ liệu, không báo lỗi)
        MigrationManager::migrate(&mut conn, dummy_path).expect("Second migration run should be idempotent");

        let v2: i32 = conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0)).unwrap();
        assert_eq!(v2, 3);

        let count2: i64 = conn.query_row("SELECT count(*) FROM tasks", [], |r| r.get(0)).unwrap();
        assert_eq!(count2, 1);
    }
}

