use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;
use crate::paths::PathResolver;

#[derive(Debug, Clone, Serialize)]
pub enum DepStatus {
    Ready,
    Missing,
    Corrupted,
    MissingModel,
    Error(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyReport {
    pub name: String,
    pub category: String, // "runtime", "binary", "model", "sidecar"
    pub status: DepStatus,
    pub version: Option<String>,
    pub resolved_path: Option<String>,
    pub details: String,
    pub affected_features: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemDiagnostics {
    pub os: String,
    pub arch: String,
    pub all_ready: bool,
    pub dependencies: Vec<DependencyReport>,
}

pub struct DiagnosticsManager;

impl DiagnosticsManager {
    pub fn run_diagnostics(app: &AppHandle) -> SystemDiagnostics {
        let mut reports = Vec::new();

        // 1. Kiểm tra Node.js (cần cho sidecar-muse runner)
        reports.push(Self::check_node());

        // 2. Kiểm tra Python 3 (cần cho sidecar-tts & sidecar-whiteboard)
        reports.push(Self::check_python());

        // 3. Kiểm tra FFmpeg binary
        reports.push(Self::check_ffmpeg(app));

        // 4. Kiểm tra Whisper-cli binary
        reports.push(Self::check_whisper(app));

        // 5. Kiểm tra Whisper Model (ggml-*.bin)
        reports.push(Self::check_whisper_model(app));

        // 6. Kiểm tra Rembg ONNX Model (u2netp.onnx / birefnet)
        reports.push(Self::check_rembg_model(app));

        // 7. Kiểm tra Sidecar Muse Runner script
        reports.push(Self::check_sidecar_muse(app));

        // 8. Kiểm tra Sidecar TTS Runner script
        reports.push(Self::check_sidecar_tts(app));

        // 9. Kiểm tra Sidecar Whiteboard Runner script
        reports.push(Self::check_sidecar_whiteboard(app));

        let all_ready = reports.iter().all(|r| matches!(r.status, DepStatus::Ready));

        SystemDiagnostics {
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            all_ready,
            dependencies: reports,
        }
    }

    fn check_node() -> DependencyReport {
        let res = Command::new("node").arg("--version").output();
        match res {
            Ok(output) if output.status.success() => {
                let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
                DependencyReport {
                    name: "Node.js Runtime".into(),
                    category: "runtime".into(),
                    status: DepStatus::Ready,
                    version: Some(ver),
                    resolved_path: None,
                    details: "Node.js sẵn sàng thực thi sidecar-muse".into(),
                    affected_features: vec![],
                }
            }
            Ok(_) | Err(_) => DependencyReport {
                name: "Node.js Runtime".into(),
                category: "runtime".into(),
                status: DepStatus::Missing,
                version: None,
                resolved_path: None,
                details: "Không tìm thấy lệnh node trong PATH hệ thống".into(),
                affected_features: vec!["Sinh video qua Muse AI (sidecar-muse)".into()],
            },
        }
    }

    fn check_python() -> DependencyReport {
        let py_cmd = if cfg!(target_os = "windows") { "py" } else { "python3" };
        let res = Command::new(py_cmd).arg("--version").output();
        match res {
            Ok(output) if output.status.success() => {
                let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
                DependencyReport {
                    name: "Python 3 Runtime".into(),
                    category: "runtime".into(),
                    status: DepStatus::Ready,
                    version: Some(ver),
                    resolved_path: None,
                    details: "Python 3 sẵn sàng thực thi TTS và Whiteboard".into(),
                    affected_features: vec![],
                }
            }
            Ok(_) | Err(_) => DependencyReport {
                name: "Python 3 Runtime".into(),
                category: "runtime".into(),
                status: DepStatus::Missing,
                version: None,
                resolved_path: None,
                details: format!("Không tìm thấy '{}' trong hệ thống", py_cmd),
                affected_features: vec![
                    "Đọc giọng lồng tiếng cục bộ VieNeu/TTS".into(),
                    "Hiệu ứng vẽ tay Whiteboard".into(),
                ],
            },
        }
    }

    fn check_ffmpeg(_app: &AppHandle) -> DependencyReport {
        // Tìm binary ffmpeg từ externalBin hoặc system path
        let mut path_candidate = None;
        let ext = if cfg!(target_os = "windows") { ".exe" } else { "" };

        // Thử tìm trong Tauri binaries
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let target_triple = if cfg!(target_os = "macos") {
                if cfg!(target_arch = "aarch64") { "aarch64-apple-darwin" } else { "x86_64-apple-darwin" }
            } else if cfg!(target_os = "windows") {
                "x86_64-pc-windows-msvc"
            } else {
                "x86_64-unknown-linux-gnu"
            };
            let p = PathBuf::from(manifest_dir).join("binaries").join(format!("ffmpeg-{}{}", target_triple, ext));
            if p.is_file() {
                path_candidate = Some(p);
            }
        }

        let mut cmd_to_run = if let Some(ref p) = path_candidate {
            Command::new(p)
        } else {
            Command::new("ffmpeg")
        };

        match cmd_to_run.arg("-version").output() {
            Ok(out) if out.status.success() => {
                let first_line = String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or("").to_string();
                DependencyReport {
                    name: "FFmpeg Media Processor".into(),
                    category: "binary".into(),
                    status: DepStatus::Ready,
                    version: Some(first_line),
                    resolved_path: path_candidate.map(|p| p.to_string_lossy().to_string()),
                    details: "FFmpeg khả dụng và chạy được lệnh -version".into(),
                    affected_features: vec![],
                }
            }
            _ => DependencyReport {
                name: "FFmpeg Media Processor".into(),
                category: "binary".into(),
                status: DepStatus::Missing,
                version: None,
                resolved_path: path_candidate.map(|p| p.to_string_lossy().to_string()),
                details: "FFmpeg không tìm thấy hoặc thực thi bị lỗi".into(),
                affected_features: vec![
                    "Ghép video, xuất bản timeline MP4".into(),
                    "Cắt ghép audio, trích xuất âm thanh".into(),
                ],
            },
        }
    }

    fn check_whisper(_app: &AppHandle) -> DependencyReport {
        let mut path_candidate = None;
        let ext = if cfg!(target_os = "windows") { ".exe" } else { "" };

        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let target_triple = if cfg!(target_os = "macos") {
                if cfg!(target_arch = "aarch64") { "aarch64-apple-darwin" } else { "x86_64-apple-darwin" }
            } else if cfg!(target_os = "windows") {
                "x86_64-pc-windows-msvc"
            } else {
                "x86_64-unknown-linux-gnu"
            };
            let p = PathBuf::from(manifest_dir).join("binaries").join(format!("whisper-cli-{}{}", target_triple, ext));
            if p.is_file() {
                // Kiểm tra kích thước file
                let meta = std::fs::metadata(&p).ok();
                let len = meta.map(|m| m.len()).unwrap_or(0);
                if len == 0 {
                    return DependencyReport {
                        name: "Whisper CLI Binary".into(),
                        category: "binary".into(),
                        status: DepStatus::Corrupted,
                        version: None,
                        resolved_path: Some(p.to_string_lossy().to_string()),
                        details: "File whisper-cli trong thư mục binaries có dung lượng 0 byte (chưa tải binary thật)".into(),
                        affected_features: vec!["Nhận diện giọng nói STT (Speech-to-Text) cục bộ".into()],
                    };
                }
                path_candidate = Some(p);
            }
        }

        let mut cmd_to_run = if let Some(ref p) = path_candidate {
            Command::new(p)
        } else {
            Command::new("whisper-cli")
        };

        match cmd_to_run.arg("-h").output() {
            Ok(out) if out.status.success() => DependencyReport {
                name: "Whisper CLI Binary".into(),
                category: "binary".into(),
                status: DepStatus::Ready,
                version: Some("whisper.cpp cli".into()),
                resolved_path: path_candidate.map(|p| p.to_string_lossy().to_string()),
                details: "Whisper CLI thực thi bình thường".into(),
                affected_features: vec![],
            },
            _ => DependencyReport {
                name: "Whisper CLI Binary".into(),
                category: "binary".into(),
                status: DepStatus::Missing,
                version: None,
                resolved_path: path_candidate.map(|p| p.to_string_lossy().to_string()),
                details: "Không tìm thấy hoặc không thể chạy whisper-cli".into(),
                affected_features: vec!["Nhận diện giọng nói STT (Speech-to-Text) cục bộ".into()],
            },
        }
    }

    fn check_whisper_model(app: &AppHandle) -> DependencyReport {
        let search_dirs = PathResolver::whisper_model_search_dirs(app);
        let model_files = ["ggml-tiny.bin", "ggml-base.bin", "ggml-medium.bin"];

        for dir in &search_dirs {
            for m in &model_files {
                let candidate = dir.join(m);
                if candidate.is_file() {
                    let len = std::fs::metadata(&candidate).map(|meta| meta.len()).unwrap_or(0);
                    if len > 1024 * 1024 {
                        return DependencyReport {
                            name: format!("Whisper Model ({})", m),
                            category: "model".into(),
                            status: DepStatus::Ready,
                            version: Some(format!("{:.1} MB", len as f64 / (1024.0 * 1024.0))),
                            resolved_path: Some(candidate.to_string_lossy().to_string()),
                            details: "Model ggml đã được tải và sẵn sàng".into(),
                            affected_features: vec![],
                        };
                    }
                }
            }
        }

        DependencyReport {
            name: "Whisper Model (ggml-tiny.bin)".into(),
            category: "model".into(),
            status: DepStatus::MissingModel,
            version: None,
            resolved_path: None,
            details: "Chưa tải model Whisper vào thư mục models/ (cần ggml-tiny.bin)".into(),
            affected_features: vec!["Tạo phụ đề và tách nhịp tự động từ âm thanh".into()],
        }
    }

    fn check_rembg_model(app: &AppHandle) -> DependencyReport {
        if let Some(p) = PathResolver::resolve_rembg_model(app) {
            let len = std::fs::metadata(&p).map(|meta| meta.len()).unwrap_or(0);
            if len > 100_000 {
                return DependencyReport {
                    name: "Rembg ONNX Model".into(),
                    category: "model".into(),
                    status: DepStatus::Ready,
                    version: Some(format!("{:.1} MB", len as f64 / (1024.0 * 1024.0))),
                    resolved_path: Some(p.to_string_lossy().to_string()),
                    details: "Model ONNX tách nền đã sẵn sàng".into(),
                    affected_features: vec![],
                };
            }
        }

        DependencyReport {
            name: "Rembg ONNX Model".into(),
            category: "model".into(),
            status: DepStatus::MissingModel,
            version: None,
            resolved_path: None,
            details: "Không tìm thấy u2netp.onnx hoặc birefnet.onnx".into(),
            affected_features: vec!["Tách nền nhân vật / sản phẩm tự động bằng AI".into()],
        }
    }

    fn check_sidecar_muse(app: &AppHandle) -> DependencyReport {
        if let Some(p) = PathResolver::resolve_muse_runner(app) {
            DependencyReport {
                name: "Sidecar Muse Runner (JS)".into(),
                category: "sidecar".into(),
                status: DepStatus::Ready,
                version: Some("runner.mjs".into()),
                resolved_path: Some(p.to_string_lossy().to_string()),
                details: "Đã định vị thành công script runner".into(),
                affected_features: vec![],
            }
        } else {
            DependencyReport {
                name: "Sidecar Muse Runner (JS)".into(),
                category: "sidecar".into(),
                status: DepStatus::Missing,
                version: None,
                resolved_path: None,
                details: "Không tìm thấy sidecar-muse/runner.mjs trong bundle hoặc thư mục app".into(),
                affected_features: vec!["Tạo video Muse AI".into()],
            }
        }
    }

    fn check_sidecar_tts(app: &AppHandle) -> DependencyReport {
        if let Some(p) = PathResolver::resolve_tts_runner(app) {
            DependencyReport {
                name: "Sidecar TTS Runner (Python)".into(),
                category: "sidecar".into(),
                status: DepStatus::Ready,
                version: Some("tts_runner.py".into()),
                resolved_path: Some(p.to_string_lossy().to_string()),
                details: "Đã định vị thành công script runner".into(),
                affected_features: vec![],
            }
        } else {
            DependencyReport {
                name: "Sidecar TTS Runner (Python)".into(),
                category: "sidecar".into(),
                status: DepStatus::Missing,
                version: None,
                resolved_path: None,
                details: "Không tìm thấy sidecar-tts/tts_runner.py".into(),
                affected_features: vec!["Tổng hợp giọng nói VieNeu".into()],
            }
        }
    }

    fn check_sidecar_whiteboard(app: &AppHandle) -> DependencyReport {
        if let Some(p) = PathResolver::resolve_whiteboard_runner(app) {
            DependencyReport {
                name: "Sidecar Whiteboard Runner (Python)".into(),
                category: "sidecar".into(),
                status: DepStatus::Ready,
                version: Some("whiteboard_runner.py".into()),
                resolved_path: Some(p.to_string_lossy().to_string()),
                details: "Đã định vị thành công script runner".into(),
                affected_features: vec![],
            }
        } else {
            DependencyReport {
                name: "Sidecar Whiteboard Runner (Python)".into(),
                category: "sidecar".into(),
                status: DepStatus::Missing,
                version: None,
                resolved_path: None,
                details: "Không tìm thấy sidecar-whiteboard/whiteboard_runner.py".into(),
                affected_features: vec!["Hiệu ứng vẽ tay Whiteboard".into()],
            }
        }
    }
}
