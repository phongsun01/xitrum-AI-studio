use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
    pub gender: String,
    pub region: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum TtsRequest {
    ListVoices,
    Generate {
        task_id: String,
        text: String,
        voice_id: String,
        output_path: String,
        speed: f32,
    },
    Exit,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TtsResponse {
    Ready {
        message: Option<String>,
    },
    Voices {
        voices: Vec<VoiceInfo>,
    },
    Done {
        task_id: Option<String>,
        output_path: String,
        duration_sec: f32,
        voice_id: Option<String>,
    },
    Error {
        task_id: Option<String>,
        message: String,
    },
}

pub struct TtsPipeline {
    script_path: PathBuf,
}

impl TtsPipeline {
    pub fn new() -> Self {
        // Tự động tìm đường dẫn tới file sidecar-tts/tts_runner.py
        let current_dir = std::env::current_dir().unwrap_or_default();
        let candidate_1 = current_dir.join("sidecar-tts").join("tts_runner.py");
        let candidate_2 = current_dir.join("..").join("sidecar-tts").join("tts_runner.py");

        let script_path = if candidate_1.exists() {
            candidate_1
        } else if candidate_2.exists() {
            candidate_2
        } else {
            PathBuf::from("sidecar-tts/tts_runner.py")
        };

        Self { script_path }
    }

    /// Khởi động subprocess Python chạy tts_runner.py qua stdin/stdout
    async fn spawn_runner(&self) -> Result<(Child, ChildStdin, BufReader<tokio::process::ChildStdout>)> {
        // Tìm Python executable: ưu tiên py trên Windows để tránh WindowsApps stub
        let mut candidates = Vec::new();
        if cfg!(windows) {
            candidates.push("py".to_string());
            if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                let py313 = PathBuf::from(&local_app_data).join("Programs").join("Python").join("Python313").join("python.exe");
                if py313.exists() {
                    candidates.push(py313.to_string_lossy().to_string());
                }
                let launcher = PathBuf::from(&local_app_data).join("Programs").join("Python").join("Launcher").join("py.exe");
                if launcher.exists() {
                    candidates.push(launcher.to_string_lossy().to_string());
                }
            }
            candidates.push("python".to_string());
        } else {
            candidates.push("python3".to_string());
            candidates.push("python".to_string());
        }

        let mut last_err = String::new();
        for cmd in candidates {
            let child_res = Command::new(&cmd)
                .arg(&self.script_path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn();

            match child_res {
                Ok(mut child) => {
                    let stdin = match child.stdin.take() {
                        Some(s) => s,
                        None => {
                            let _ = child.kill().await;
                            continue;
                        }
                    };
                    let stdout = match child.stdout.take() {
                        Some(s) => s,
                        None => {
                            let _ = child.kill().await;
                            continue;
                        }
                    };
                    let mut reader = BufReader::new(stdout);

                    // Đọc thông điệp 'ready' đầu tiên
                    let mut ready_line = String::new();
                    match reader.read_line(&mut ready_line).await {
                        Ok(n) if n > 0 => {
                            match serde_json::from_str::<TtsResponse>(&ready_line) {
                                Ok(TtsResponse::Ready { .. }) => return Ok((child, stdin, reader)),
                                Ok(TtsResponse::Error { message, .. }) => {
                                    let _ = child.kill().await;
                                    last_err = format!("Lỗi khởi động TTS: {}", message);
                                    continue;
                                }
                                _ => {
                                    let _ = child.kill().await;
                                    last_err = format!("Không nhận được tín hiệu ready từ TTS (nhận: {})", ready_line);
                                    continue;
                                }
                            }
                        }
                        _ => {
                            let _ = child.kill().await;
                            last_err = format!("Không đọc được đầu ra từ {}", cmd);
                            continue;
                        }
                    }
                }
                Err(e) => {
                    last_err = format!("Không thể chạy lệnh {}: {}", cmd, e);
                    continue;
                }
            }
        }

        Err(anyhow!("Không thể khởi động Python runner ({:?}): {}", self.script_path, last_err))
    }

    /// Lấy danh sách giọng đọc có sẵn
    pub async fn list_voices(&self) -> Result<Vec<VoiceInfo>> {
        let (mut child, mut stdin, mut reader) = self.spawn_runner().await?;

        let req = TtsRequest::ListVoices;
        let line = serde_json::to_string(&req)? + "\n";
        stdin.write_all(line.as_bytes()).await?;
        stdin.flush().await?;

        let mut resp_line = String::new();
        reader.read_line(&mut resp_line).await?;

        let resp: TtsResponse = serde_json::from_str(&resp_line)
            .map_err(|e| anyhow!("Lỗi phân tích JSON giọng đọc: {} (raw: {})", e, resp_line))?;

        let _ = stdin.write_all(b"{\"action\":\"exit\"}\n").await;
        let _ = child.kill().await;

        match resp {
            TtsResponse::Voices { voices } => Ok(voices),
            TtsResponse::Error { message, .. } => Err(anyhow!("Lỗi lấy danh sách giọng: {}", message)),
            _ => Err(anyhow!("Phản hồi không mong muốn từ TTS")),
        }
    }

    /// Tạo file âm thanh đọc lời thoại cho 1 cảnh
    pub async fn synthesize(
        &self,
        task_id: &str,
        text: &str,
        voice_id: &str,
        output_path: &Path,
        speed: f32,
    ) -> Result<(String, f32)> {
        let (mut child, mut stdin, mut reader) = self.spawn_runner().await?;

        let req = TtsRequest::Generate {
            task_id: task_id.to_string(),
            text: text.to_string(),
            voice_id: voice_id.to_string(),
            output_path: output_path.to_string_lossy().to_string(),
            speed,
        };

        let line = serde_json::to_string(&req)? + "\n";
        stdin.write_all(line.as_bytes()).await?;
        stdin.flush().await?;

        let mut resp_line = String::new();
        reader.read_line(&mut resp_line).await?;

        let resp: TtsResponse = serde_json::from_str(&resp_line)
            .map_err(|e| anyhow!("Lỗi phân tích phản hồi TTS: {} (raw: {})", e, resp_line))?;

        let _ = stdin.write_all(b"{\"action\":\"exit\"}\n").await;
        let _ = child.kill().await;

        match resp {
            TtsResponse::Done { output_path, duration_sec, .. } => Ok((output_path, duration_sec)),
            TtsResponse::Error { message, .. } => Err(anyhow!("Lỗi tạo giọng đọc: {}", message)),
            _ => Err(anyhow!("Phản hồi không mong muốn khi sinh giọng đọc")),
        }
    }
}

