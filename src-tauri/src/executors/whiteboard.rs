use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tracing::{info, warn};

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "action")]
pub enum WhiteboardRequest {
    #[serde(rename = "ping")]
    Ping {
        #[serde(default)]
        task_id: String,
    },
    #[serde(rename = "parse_srt")]
    ParseSrt {
        #[serde(default)]
        task_id: String,
        srt_path: String,
        #[serde(default = "default_target_sec")]
        target_sec: f64,
        #[serde(default = "default_min_sec")]
        min_sec: f64,
        #[serde(default = "default_max_sec")]
        max_sec: f64,
    },
    #[serde(rename = "generate_annotation")]
    GenerateAnnotation {
        #[serde(default)]
        task_id: String,
        image_path: String,
        #[serde(default)]
        scene_id: String,
        #[serde(default)]
        story_basis: String,
        #[serde(default = "default_duration_ms")]
        duration_ms: i64,
        #[serde(default)]
        cues: Vec<serde_json::Value>,
        /// Nếu có, runner ghi annotation ra tệp này (ghi nguyên tử) và trả về `savedTo`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        output_path: Option<String>,
        /// Cho phép ghi đè tệp đã tồn tại; mặc định runner từ chối với lỗi ANNOTATION_EXISTS.
        #[serde(default)]
        overwrite: bool,
    },
    #[serde(rename = "render_scene")]
    RenderScene {
        #[serde(default)]
        task_id: String,
        image_path: String,
        annotation_path: String,
        output_path: String,
        #[serde(default = "default_fps")]
        fps: i32,
        #[serde(default = "default_paper_color")]
        paper_color: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        hand_path: Option<String>,
    },
    #[serde(rename = "merge_scenes")]
    MergeScenes {
        #[serde(default)]
        task_id: String,
        video_paths: Vec<String>,
        output_path: String,
    },
    #[serde(rename = "exit")]
    Exit,
}

fn default_target_sec() -> f64 { 30.0 }
fn default_min_sec() -> f64 { 25.0 }
fn default_max_sec() -> f64 { 35.0 }
fn default_duration_ms() -> i64 { 10000 }
fn default_fps() -> i32 { 30 }
fn default_paper_color() -> String { "#F5EBD7".to_string() }

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WhiteboardResponse {
    #[serde(rename = "ready")]
    Ready { message: String },
    #[serde(rename = "pong")]
    Pong {
        task_id: Option<String>,
        status: String,
    },
    #[serde(rename = "done")]
    Done {
        task_id: Option<String>,
        action: Option<String>,
        data: Option<serde_json::Value>,
    },
    #[serde(rename = "error")]
    Error {
        task_id: Option<String>,
        message: String,
        traceback: Option<String>,
    },
}

pub struct WhiteboardPipeline {
    runner_path: PathBuf,
    process: Mutex<Option<(Child, ChildStdin, BufReader<std::process::ChildStdout>)>>,
}

impl WhiteboardPipeline {
    pub fn new() -> Self {
        let current_dir = std::env::current_dir().unwrap_or_default();
        let candidate_1 = current_dir.join("sidecar-whiteboard").join("whiteboard_runner.py");
        let candidate_2 = current_dir.join("..").join("sidecar-whiteboard").join("whiteboard_runner.py");

        let runner_path = if candidate_1.exists() {
            candidate_1
        } else if candidate_2.exists() {
            candidate_2
        } else {
            PathBuf::from("sidecar-whiteboard/whiteboard_runner.py")
        };

        Self {
            runner_path,
            process: Mutex::new(None),
        }
    }

    fn spawn_process(&self) -> Result<(Child, ChildStdin, BufReader<std::process::ChildStdout>)> {
        let py_cmd = if cfg!(target_os = "windows") { "py" } else { "python3" };

        let mut child = Command::new(py_cmd)
            .env("PYTHONUTF8", "1")
            .arg(&self.runner_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .with_context(|| format!("Không thể khởi động Whiteboard Python runner tại: {:?}", self.runner_path))?;

        let stdin = child.stdin.take().ok_or_else(|| anyhow!("Không lấy được stdin của Whiteboard runner"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("Không lấy được stdout của Whiteboard runner"))?;
        let mut reader = BufReader::new(stdout);

        let mut ready_line = String::new();
        reader.read_line(&mut ready_line).context("Không đọc được tín hiệu khởi động từ Whiteboard runner")?;

        match serde_json::from_str::<WhiteboardResponse>(&ready_line) {
            Ok(WhiteboardResponse::Ready { message }) => {
                info!("Whiteboard Engine đã sẵn sàng: {}", message);
                Ok((child, stdin, reader))
            }
            Ok(WhiteboardResponse::Error { message, .. }) => {
                Err(anyhow!("Lỗi khởi động Whiteboard: {}", message))
            }
            _ => Err(anyhow!("Không nhận được tín hiệu ready từ Whiteboard (nhận: {})", ready_line)),
        }
    }

    fn send_request(&self, req: WhiteboardRequest) -> Result<WhiteboardResponse> {
        let mut guard = self.process.lock().map_err(|e| anyhow!("Lỗi khóa Mutex: {}", e))?;

        if guard.is_none() {
            *guard = Some(self.spawn_process()?);
        }

        let req_json = serde_json::to_string(&req)?;
        let mut retry = false;

        if let Some((_, stdin, reader)) = guard.as_mut() {
            if let Err(e) = writeln!(stdin, "{}", req_json) {
                warn!("Gửi lệnh đến Whiteboard runner thất bại: {}. Đang khởi động lại...", e);
                retry = true;
            } else if let Err(e) = stdin.flush() {
                warn!("Flush stdin Whiteboard runner thất bại: {}. Đang khởi động lại...", e);
                retry = true;
            } else {
                let mut resp_line = String::new();
                if let Err(e) = reader.read_line(&mut resp_line) {
                    warn!("Đọc phản hồi từ Whiteboard runner thất bại: {}. Đang khởi động lại...", e);
                    retry = true;
                } else if resp_line.trim().is_empty() {
                    warn!("Nhận phản hồi rỗng từ Whiteboard runner. Đang khởi động lại...");
                    retry = true;
                } else {
                    let resp: WhiteboardResponse = serde_json::from_str(&resp_line)
                        .map_err(|e| anyhow!("Lỗi phân tích phản hồi Whiteboard: {} (raw: {})", e, resp_line))?;
                    return Ok(resp);
                }
            }
        }

        if retry {
            *guard = None;
            let (child, mut stdin, mut reader) = self.spawn_process()?;
            writeln!(stdin, "{}", req_json)?;
            stdin.flush()?;
            let mut resp_line = String::new();
            reader.read_line(&mut resp_line)?;
            let resp: WhiteboardResponse = serde_json::from_str(&resp_line)
                .map_err(|e| anyhow!("Lỗi phân tích phản hồi Whiteboard (thử lại): {}", e))?;
            *guard = Some((child, stdin, reader));
            return Ok(resp);
        }

        Err(anyhow!("Không thể giao tiếp với Whiteboard Runner"))
    }

    pub fn parse_srt(&self, srt_path: String) -> Result<serde_json::Value> {
        let req = WhiteboardRequest::ParseSrt {
            task_id: uuid::Uuid::new_v4().to_string(),
            srt_path,
            target_sec: 30.0,
            min_sec: 25.0,
            max_sec: 35.0,
        };
        match self.send_request(req)? {
            WhiteboardResponse::Done { data, .. } => Ok(data.unwrap_or_default()),
            WhiteboardResponse::Error { message, traceback, .. } => {
                Err(anyhow!("Lỗi phân tích SRT: {}\nChi tiết: {:?}", message, traceback))
            }
            _ => Err(anyhow!("Phản hồi không hợp lệ từ Whiteboard")),
        }
    }

    pub fn generate_annotation(
        &self,
        image_path: String,
        scene_id: String,
        story_basis: String,
        duration_ms: i64,
        cues: Vec<serde_json::Value>,
        output_path: Option<String>,
        overwrite: bool,
    ) -> Result<serde_json::Value> {
        let req = WhiteboardRequest::GenerateAnnotation {
            task_id: uuid::Uuid::new_v4().to_string(),
            image_path,
            scene_id,
            story_basis,
            duration_ms,
            cues,
            output_path,
            overwrite,
        };
        match self.send_request(req)? {
            WhiteboardResponse::Done { data, .. } => Ok(data.unwrap_or_default()),
            WhiteboardResponse::Error { message, traceback, .. } => {
                Err(anyhow!("Lỗi sinh annotation: {}\nChi tiết: {:?}", message, traceback))
            }
            _ => Err(anyhow!("Phản hồi không hợp lệ từ Whiteboard")),
        }
    }

    pub fn render_scene(
        &self,
        image_path: String,
        annotation_path: String,
        output_path: String,
        fps: i32,
        paper_color: String,
        hand_path: Option<String>,
    ) -> Result<serde_json::Value> {
        let req = WhiteboardRequest::RenderScene {
            task_id: uuid::Uuid::new_v4().to_string(),
            image_path,
            annotation_path,
            output_path,
            fps,
            paper_color,
            hand_path,
        };
        match self.send_request(req)? {
            WhiteboardResponse::Done { data, .. } => Ok(data.unwrap_or_default()),
            WhiteboardResponse::Error { message, traceback, .. } => {
                Err(anyhow!("Lỗi render bảng trắng: {}\nChi tiết: {:?}", message, traceback))
            }
            _ => Err(anyhow!("Phản hồi không hợp lệ từ Whiteboard")),
        }
    }

    pub fn merge_scenes(&self, video_paths: Vec<String>, output_path: String) -> Result<serde_json::Value> {
        let req = WhiteboardRequest::MergeScenes {
            task_id: uuid::Uuid::new_v4().to_string(),
            video_paths,
            output_path,
        };
        match self.send_request(req)? {
            WhiteboardResponse::Done { data, .. } => Ok(data.unwrap_or_default()),
            WhiteboardResponse::Error { message, traceback, .. } => {
                Err(anyhow!("Lỗi ghép cảnh: {}\nChi tiết: {:?}", message, traceback))
            }
            _ => Err(anyhow!("Phản hồi không hợp lệ từ Whiteboard")),
        }
    }
}
