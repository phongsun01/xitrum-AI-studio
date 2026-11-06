use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    MuseVideo,
    MuseImage,
    WhisperStt,
    Rembg,
    FfmpegRender,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Queued,
    Running,
    Success,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskItem {
    pub id: String,
    pub kind: TaskKind,
    pub status: TaskStatus,
    pub prompt: Option<String>,
    pub ratio: Option<String>,
    pub input_path: Option<String>,
    pub output_path: Option<String>,
    pub progress: u32,
    pub error_msg: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateItem {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub ratio: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioJobItem {
    pub id: String,
    pub audio_path: String,
    pub status: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioSegmentItem {
    pub id: String,
    pub job_id: String,
    pub seq: i32,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub prompt: Option<String>,
    pub ref_image_path: Option<String>,
    pub queue_task_id: Option<String>,
    pub output_video_path: Option<String>,
    pub approval: Option<String>, // "approved", "rejected", null
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub output_dir: String,
    pub default_ratio: String,
    pub whisper_model: String, // "ggml-tiny", "ggml-base", "ggml-medium"
    pub chrome_profile_dir: String, // Thư mục Chrome profile để giữ đăng nhập Muse.ai
    pub max_parallel_muse: usize,
    pub max_parallel_local: usize,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            output_dir: String::from("D:\\XitrumAI_Outputs"),
            default_ratio: String::from("16:9"),
            whisper_model: String::from("ggml-tiny"),
            chrome_profile_dir: String::from("D:\\Antigravity\\REA\\REA-project\\poc-phase0\\chrome-profile"),
            max_parallel_muse: 1,
            max_parallel_local: 2,
        }
    }
}

