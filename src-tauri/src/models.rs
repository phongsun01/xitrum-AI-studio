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
pub struct AppConfig {
    pub output_dir: String,
    pub default_ratio: String,
    pub max_parallel_muse: usize,
    pub max_parallel_local: usize,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            output_dir: String::from("D:\\XitrumAI_Outputs"),
            default_ratio: String::from("16:9"),
            max_parallel_muse: 1,
            max_parallel_local: 2,
        }
    }
}

