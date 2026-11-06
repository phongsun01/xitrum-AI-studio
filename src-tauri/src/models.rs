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
pub struct CharacterItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub voice: Option<String>,
    pub ref_image_path: Option<String>,
    pub identity_lock_en: Option<String>,
    #[serde(default)]
    pub locked: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductItem {
    pub id: String,
    pub script_id: String,
    pub name: String,
    pub description: Option<String>,
    pub image_path: Option<String>,
    pub product_lock_en: Option<String>,
    #[serde(default)]
    pub locked: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptSceneItem {
    pub id: String,
    pub script_id: String,
    pub scene_no: i32,
    pub narration: String,
    pub visual_prompt: String,
    pub video_prompt: String,
    pub character: Option<String>,
    pub duration_sec: f32,
    pub ref_image_path: Option<String>,
    pub audio_path: Option<String>,
    pub video_path: Option<String>,
    pub queue_task_id: Option<String>,
    pub product_id: Option<String>,
    #[serde(default)]
    pub camera_moves: Vec<String>,
    #[serde(default = "default_scene_style")]
    pub style: Option<String>,
}

fn default_scene_style() -> Option<String> {
    Some("default".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptProjectItem {
    pub id: String,
    pub title: String,
    pub idea: Option<String>,
    pub genre: Option<String>,
    pub target_duration_sec: Option<i32>,
    pub ratio: String,
    pub status: String, // "draft", "reviewed", "queued", "done"
    pub environment_lock_en: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub characters: Vec<CharacterItem>,
    #[serde(default)]
    pub products: Vec<ProductItem>,
    pub scenes: Vec<ScriptSceneItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyItem {
    pub id: i64,
    pub name: Option<String>,
    pub raw_masked: String,
    pub scheme: String,
    pub host: String,
    pub port: i32,
    pub username: Option<String>,
    #[serde(skip_serializing)]
    pub encrypted_password: Option<String>,
    pub status: String, // "unknown", "ok", "dead", "checking"
    pub ip: Option<String>,
    pub latency_ms: Option<i32>,
    pub checked_at: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub output_dir: String,
    pub default_ratio: String,
    pub whisper_model: String, // "ggml-tiny", "ggml-base", "ggml-medium"
    pub chrome_path: Option<String>, // Đường dẫn Chrome / Edge tùy biến
    pub chrome_profile_dir: String, // Thư mục Chrome profile để giữ đăng nhập Muse.ai
    pub active_proxy_id: Option<i64>, // Proxy được chọn cho Muse runner
    pub music_dir: Option<String>, // Thư mục chứa nhạc nền tự động (F13)
    pub music_volume: f32, // Âm lượng nhạc nền (0.05 -> 0.5, mặc định 0.15)
    pub max_parallel_muse: usize,
    pub max_parallel_local: usize,
}

impl Default for AppConfig {
    fn default() -> Self {
        // Tự động tìm đường dẫn thư mục chuẩn
        let local_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\Users\\Default\\AppData\\Local".to_string());
        let default_profile = format!("{}\\XitrumAI\\chrome-profile", local_data);
        let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        let default_output = format!("{}\\Videos\\XitrumAI_Outputs", user_profile);

        Self {
            output_dir: default_output,
            default_ratio: String::from("16:9"),
            whisper_model: String::from("ggml-tiny"),
            chrome_path: None,
            chrome_profile_dir: default_profile,
            active_proxy_id: None,
            music_dir: None,
            music_volume: 0.15,
            max_parallel_muse: 1,
            max_parallel_local: 2,
        }
    }
}

