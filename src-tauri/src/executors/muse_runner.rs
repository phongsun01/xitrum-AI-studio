use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum RunnerCommand {
    CheckSession {
        user_data_dir: Option<String>,
    },
    Generate {
        task_id: String,
        prompt: String,
        ratio: Option<String>,
        kind: String,
        input_path: Option<String>,
        output_dir: String,
        user_data_dir: Option<String>,
    },
    Close,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RunnerMessage {
    Ready { message: Option<String> },
    Progress { task_id: Option<String>, percent: u32, message: Option<String> },
    Success { task_id: Option<String>, percent: u32, output_path: String },
    SessionStatus { ok: bool, message: String },
    SessionExpired { task_id: Option<String>, message: String },
    Error { error: String },
}

pub struct MuseRunner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
}

impl MuseRunner {
    pub fn new() -> Self {
        Self {
            child: None,
            stdin: None,
        }
    }

    /// Khởi động Node sidecar runner nếu chưa chạy
    pub async fn ensure_started(&mut self) -> Result<()> {
        if self.child.is_some() {
            return Ok(());
        }

        let script_path = "D:\\Antigravity\\REA\\REA-project\\xitrum-AI-studio\\sidecar-muse\\runner.mjs";
        tracing::info!("Starting Muse Node.js runner: {}", script_path);

        let mut child = Command::new("node")
            .arg(script_path)
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

    /// Kiểm tra phiên đăng nhập Muse.ai
    pub async fn check_session(&mut self, user_data_dir: Option<String>) -> Result<(bool, String)> {
        self.ensure_started().await?;

        let cmd = RunnerCommand::CheckSession { user_data_dir };
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
                    tracing::warn!("Task {} cancelled by token", task_id);
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
