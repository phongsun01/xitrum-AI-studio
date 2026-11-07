use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Serialize, Clone)]
pub struct ProxyConfig {
    pub server: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum RunnerCommand {
    CheckSession {
        #[serde(rename = "userDataDir")]
        user_data_dir: Option<String>,
        #[serde(rename = "chromePath")]
        chrome_path: Option<String>,
        proxy: Option<ProxyConfig>,
    },
    Generate {
        #[serde(rename = "taskId")]
        task_id: String,
        prompt: String,
        ratio: Option<String>,
        kind: String,
        #[serde(rename = "inputPath")]
        input_path: Option<String>,
        #[serde(rename = "outputDir")]
        output_dir: String,
        #[serde(rename = "userDataDir")]
        user_data_dir: Option<String>,
        #[serde(rename = "chromePath")]
        chrome_path: Option<String>,
        proxy: Option<ProxyConfig>,
    },
    Close,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RunnerMessage {
    Ready {
        message: Option<String>,
    },
    Progress {
        #[serde(alias = "taskId")]
        task_id: Option<String>,
        percent: u32,
        message: Option<String>,
    },
    #[serde(alias = "task_complete")]
    Success {
        #[serde(alias = "taskId")]
        task_id: Option<String>,
        #[serde(default)]
        percent: u32,
        #[serde(alias = "outputPath", alias = "outputFile", alias = "output_file")]
        output_path: String,
    },
    SessionStatus {
        ok: bool,
        message: String,
    },
    SessionExpired {
        #[serde(alias = "taskId")]
        task_id: Option<String>,
        message: String,
    },
    Error {
        #[serde(alias = "message")]
        error: String,
    },
}

pub struct MuseRunner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    app_handle: Option<tauri::AppHandle>,
}

impl MuseRunner {
    pub fn new() -> Self {
        Self {
            child: None,
            stdin: None,
            app_handle: None,
        }
    }

    pub fn with_app_handle(app_handle: tauri::AppHandle) -> Self {
        Self {
            child: None,
            stdin: None,
            app_handle: Some(app_handle),
        }
    }

    /// Khởi động Node sidecar runner nếu chưa chạy (hoặc đã chết)
    pub async fn ensure_started(&mut self) -> Result<()> {
        if let Some(child) = self.child.as_mut() {
            // Kiểm tra tiến trình còn sống không
            match child.try_wait() {
                Ok(None) => return Ok(()), // Vẫn đang chạy tốt
                _ => {
                    tracing::warn!("Muse runner process had exited, restarting...");
                    self.child = None;
                    self.stdin = None;
                }
            }
        }

        // Tự động tìm đường dẫn tới file sidecar-muse/runner.mjs linh hoạt (bundle resources hoặc dev)
        let script_path = if let Some(ref app) = self.app_handle {
            crate::paths::PathResolver::resolve_muse_runner(app)
                .unwrap_or_else(|| PathBuf::from("sidecar-muse/runner.mjs"))
        } else {
            let current_dir = std::env::current_dir().unwrap_or_default();
            let candidate_1 = current_dir.join("sidecar-muse").join("runner.mjs");
            let candidate_2 = current_dir.join("..").join("sidecar-muse").join("runner.mjs");
            if candidate_1.exists() {
                candidate_1
            } else if candidate_2.exists() {
                candidate_2
            } else {
                PathBuf::from("sidecar-muse/runner.mjs")
            }
        };
        tracing::info!("Starting Muse Node.js runner: {:?}", script_path);

        let mut child = Command::new("node")
            .arg(&script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| anyhow::anyhow!("Failed to spawn node sidecar-muse: {}", e))?;

        let stdin = child.stdin.take().ok_or_else(|| anyhow::anyhow!("No stdin on node runner"))?;
        self.child = Some(child);
        self.stdin = Some(stdin);

        Ok(())
    }

    /// Reset / đóng tiến trình runner nếu gặp lỗi nặng
    pub fn reset(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
        }
        self.stdin = None;
    }

    /// Kiểm tra phiên đăng nhập Muse.ai
    pub async fn check_session(
        &mut self,
        user_data_dir: Option<String>,
        chrome_path: Option<String>,
        proxy: Option<ProxyConfig>,
    ) -> Result<(bool, String)> {
        self.ensure_started().await?;

        let cmd = RunnerCommand::CheckSession {
            user_data_dir,
            chrome_path,
            proxy,
        };
        let cmd_str = serde_json::to_string(&cmd)?;

        if let Some(stdin) = self.stdin.as_mut() {
            stdin.write_all(format!("{}\n", cmd_str).as_bytes()).await?;
            stdin.flush().await?;
        }

        let child = self.child.as_mut().unwrap();
        let stdout = child.stdout.as_mut().ok_or_else(|| anyhow::anyhow!("No stdout on runner"))?;
        let mut reader = BufReader::new(stdout).lines();

        while let Some(line) = reader.next_line().await? {
            if let Ok(msg) = serde_json::from_str::<RunnerMessage>(&line) {
                match msg {
                    RunnerMessage::SessionStatus { ok, message } => {
                        return Ok((ok, message));
                    }
                    RunnerMessage::Error { error } => {
                        return Err(anyhow::anyhow!("Runner error: {}", error));
                    }
                    _ => {}
                }
            }
        }

        Err(anyhow::anyhow!("Runner closed without returning session status"))
    }

    /// Chạy tác vụ sinh video hoặc ảnh với Muse.ai
    pub async fn execute_task<F>(
        &mut self,
        task_id: &str,
        kind_str: &str,
        prompt: &str,
        ratio: Option<&str>,
        input_path: Option<&str>,
        output_dir: &str,
        user_data_dir: Option<&str>,
        chrome_path: Option<&str>,
        proxy: Option<ProxyConfig>,
        progress_cb: F,
        token: &CancellationToken,
    ) -> Result<PathBuf>
    where
        F: Fn(u32, Option<String>),
    {
        self.ensure_started().await?;

        let cmd = RunnerCommand::Generate {
            task_id: task_id.to_string(),
            prompt: prompt.to_string(),
            ratio: ratio.map(|r| r.to_string()),
            kind: kind_str.to_string(),
            input_path: input_path.map(|p| p.to_string()),
            output_dir: output_dir.to_string(),
            user_data_dir: user_data_dir.map(|p| p.to_string()),
            chrome_path: chrome_path.map(|p| p.to_string()),
            proxy,
        };

        let cmd_str = serde_json::to_string(&cmd)?;

        if let Some(stdin) = self.stdin.as_mut() {
            stdin.write_all(format!("{}\n", cmd_str).as_bytes()).await?;
            stdin.flush().await?;
        }

        let child = self.child.as_mut().unwrap();
        let stdout = child.stdout.as_mut().ok_or_else(|| anyhow::anyhow!("No stdout on runner"))?;
        let mut reader = BufReader::new(stdout).lines();

        loop {
            tokio::select! {
                _ = token.cancelled() => {
                    tracing::warn!("Task {} cancelled by token, resetting runner process", task_id);
                    // S9: Khi hủy thì tắt runner rồi khởi động lại sạch để dừng browser và tránh nhận nhầm kết quả
                    self.reset();
                    return Err(anyhow::anyhow!("Cancelled by user"));
                }
                res = reader.next_line() => {
                    match res? {
                        Some(line) => {
                            if let Ok(msg) = serde_json::from_str::<RunnerMessage>(&line) {
                                match msg {
                                    RunnerMessage::Progress { percent, message, .. } => {
                                        progress_cb(percent, message);
                                    }
                                    RunnerMessage::Success { output_path, .. } => {
                                        return Ok(PathBuf::from(output_path));
                                    }
                                    RunnerMessage::SessionExpired { message, .. } => {
                                        return Err(anyhow::anyhow!("SESSION_EXPIRED: {}", message));
                                    }
                                    RunnerMessage::Error { error } => {
                                        return Err(anyhow::anyhow!("Muse runner error: {}", error));
                                    }
                                    _ => {}
                                }
                            }
                        }
                        None => {
                            return Err(anyhow::anyhow!("Muse runner process ended unexpectedly"));
                        }
                    }
                }
            }
        }
    }
}
