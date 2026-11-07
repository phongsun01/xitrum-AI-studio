use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Bộ định vị đường dẫn tài nguyên cho cả môi trường phát triển (cargo run)
/// và môi trường ứng dụng đã đóng gói (.app / installer).
pub struct PathResolver;

impl PathResolver {
    /// Định vị thư mục gốc tài nguyên bundled hoặc dev root
    pub fn resolve_resource_dir(app: &AppHandle) -> Option<PathBuf> {
        // 1. Thử lấy từ Tauri resource_dir (chuẩn khi đã đóng gói bundle)
        if let Ok(res_dir) = app.path().resource_dir() {
            if res_dir.exists() {
                return Some(res_dir);
            }
        }

        // 2. Fallback cho môi trường dev: tìm thư mục mẹ của src-tauri hoặc CWD
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let p = PathBuf::from(manifest_dir).join("..");
            if p.exists() {
                return Some(p);
            }
        }

        if let Ok(cwd) = std::env::current_dir() {
            if cwd.join("sidecar-muse").exists() || cwd.join("src-tauri").exists() {
                return Some(cwd);
            }
            if cwd.join("..").join("sidecar-muse").exists() {
                return Some(cwd.join(".."));
            }
        }

        None
    }

    /// Định vị entrypoint của sidecar-muse runner
    pub fn resolve_muse_runner(app: &AppHandle) -> Option<PathBuf> {
        let candidates = vec![
            // Trong bundle resources
            app.path().resource_dir().ok().map(|d| d.join("sidecar-muse").join("runner.mjs")),
            app.path().resource_dir().ok().map(|d| d.join("resources").join("sidecar-muse").join("runner.mjs")),
            // Trong dev mode qua CARGO_MANIFEST_DIR
            std::env::var("CARGO_MANIFEST_DIR").ok().map(|d| PathBuf::from(d).join("..").join("sidecar-muse").join("runner.mjs")),
            // Trong CWD hoặc parent của CWD
            std::env::current_dir().ok().map(|d| d.join("sidecar-muse").join("runner.mjs")),
            std::env::current_dir().ok().map(|d| d.join("..").join("sidecar-muse").join("runner.mjs")),
        ];

        candidates.into_iter().flatten().find(|p| p.is_file())
    }

    /// Định vị entrypoint của sidecar-tts runner
    pub fn resolve_tts_runner(app: &AppHandle) -> Option<PathBuf> {
        let candidates = vec![
            app.path().resource_dir().ok().map(|d| d.join("sidecar-tts").join("tts_runner.py")),
            app.path().resource_dir().ok().map(|d| d.join("resources").join("sidecar-tts").join("tts_runner.py")),
            std::env::var("CARGO_MANIFEST_DIR").ok().map(|d| PathBuf::from(d).join("..").join("sidecar-tts").join("tts_runner.py")),
            std::env::current_dir().ok().map(|d| d.join("sidecar-tts").join("tts_runner.py")),
            std::env::current_dir().ok().map(|d| d.join("..").join("sidecar-tts").join("tts_runner.py")),
        ];

        candidates.into_iter().flatten().find(|p| p.is_file())
    }

    /// Định vị entrypoint của sidecar-whiteboard runner
    pub fn resolve_whiteboard_runner(app: &AppHandle) -> Option<PathBuf> {
        let candidates = vec![
            app.path().resource_dir().ok().map(|d| d.join("sidecar-whiteboard").join("whiteboard_runner.py")),
            app.path().resource_dir().ok().map(|d| d.join("resources").join("sidecar-whiteboard").join("whiteboard_runner.py")),
            std::env::var("CARGO_MANIFEST_DIR").ok().map(|d| PathBuf::from(d).join("..").join("sidecar-whiteboard").join("whiteboard_runner.py")),
            std::env::current_dir().ok().map(|d| d.join("sidecar-whiteboard").join("whiteboard_runner.py")),
            std::env::current_dir().ok().map(|d| d.join("..").join("sidecar-whiteboard").join("whiteboard_runner.py")),
        ];

        candidates.into_iter().flatten().find(|p| p.is_file())
    }

    /// Định vị model file Rembg (u2netp.onnx hoặc birefnet.onnx)
    pub fn resolve_rembg_model(app: &AppHandle) -> Option<PathBuf> {
        let model_names = ["u2netp.onnx", "birefnet-general.onnx"];
        let mut dirs = Vec::new();

        if let Ok(res_dir) = app.path().resource_dir() {
            dirs.push(res_dir.join("resources"));
            dirs.push(res_dir.join("models"));
            dirs.push(res_dir);
        }

        if let Some(local_data) = dirs::data_local_dir() {
            dirs.push(local_data.join("XitrumAI").join("models"));
        }

        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let m = PathBuf::from(manifest_dir);
            dirs.push(m.join("resources"));
            dirs.push(m.join("..").join("resources"));
        }

        if let Ok(cwd) = std::env::current_dir() {
            dirs.push(cwd.join("resources"));
            dirs.push(cwd.join("src-tauri").join("resources"));
            dirs.push(cwd.join("..").join("src-tauri").join("resources"));
        }

        for dir in dirs {
            for name in &model_names {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }

        None
    }

    /// Định vị danh sách model directory cho Whisper
    pub fn whisper_model_search_dirs(app: &AppHandle) -> Vec<PathBuf> {
        let mut dirs = Vec::new();

        if let Some(local_data) = dirs::data_local_dir() {
            dirs.push(local_data.join("XitrumAI").join("models"));
        }

        if let Ok(res_dir) = app.path().resource_dir() {
            dirs.push(res_dir.join("resources"));
            dirs.push(res_dir.join("models"));
            dirs.push(res_dir);
        }

        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let m = PathBuf::from(manifest_dir);
            dirs.push(m.join("resources"));
            dirs.push(m.join("..").join("resources"));
        }

        if let Ok(cwd) = std::env::current_dir() {
            dirs.push(cwd.join("resources"));
            dirs.push(cwd.join("src-tauri").join("resources"));
            dirs.push(cwd.join("..").join("src-tauri").join("resources"));
        }

        dirs
    }
}
