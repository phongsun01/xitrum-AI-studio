use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
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
        #[serde(default)]
        exact_cues: bool,
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
    #[serde(rename = "analyze_image_style")]
    AnalyzeImageStyle {
        #[serde(default)]
        task_id: String,
        image_path: String,
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
        #[serde(skip_serializing_if = "Option::is_none")]
        audio_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        ink_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        color_fill: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        ink_weight: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        color_weight: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<i64>,
        subject_first: Option<bool>,
    },
    #[serde(rename = "get_fingerprint")]
    GetFingerprint {
        #[serde(default)]
        task_id: String,
        image_path: String,
        annotation_path: String,
        #[serde(default = "default_fps")]
        fps: i32,
        #[serde(default = "default_paper_color")]
        paper_color: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        hand_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        audio_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        ink_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        color_fill: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        ink_weight: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        color_weight: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<i64>,
        subject_first: Option<bool>,
    },
    #[serde(rename = "verify_cache")]
    VerifyCache {
        #[serde(default)]
        task_id: String,
        video_path: String,
        expected_fingerprint: String,
    },
    #[serde(rename = "render_preview")]
    RenderPreview {
        #[serde(default)]
        task_id: String,
        image_path: String,
        annotation_path: String,
        output_path: String,
    },
    #[serde(rename = "merge_scenes")]
    MergeScenes {
        #[serde(default)]
        task_id: String,
        video_paths: Vec<String>,
        output_path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        master_audio_path: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        thumbnail_png: Option<String>,
    },
    #[serde(rename = "validate_project")]
    ValidateProject {
        #[serde(default)]
        task_id: String,
        project: serde_json::Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scene_ids: Option<Vec<String>>,
    },
    #[serde(rename = "render_project")]
    RenderProject {
        #[serde(default)]
        task_id: String,
        project: serde_json::Value,
        output_path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scene_ids: Option<Vec<String>>,
    },
    #[serde(rename = "check_env")]
    CheckEnv {
        #[serde(default)]
        task_id: String,
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

/// Thời gian chờ tối đa cho từng loại thao tác. Hết hạn thì tiến trình runner bị dừng hẳn
/// (kill + wait) thay vì để giao diện treo vô hạn.
#[derive(Debug, Clone)]
pub struct Timeouts {
    pub ready: Duration,
    pub quick: Duration,
    pub generate: Duration,
    pub render: Duration,
    pub merge: Duration,
    /// Xuất cả dự án nhiều cảnh (render từng cảnh + nối + audio).
    pub project: Duration,
    pub install: Duration,
}

impl Default for Timeouts {
    fn default() -> Self {
        Self {
            ready: Duration::from_secs(60),
            quick: Duration::from_secs(60),
            generate: Duration::from_secs(120),
            render: Duration::from_secs(30 * 60),
            merge: Duration::from_secs(10 * 60),
            project: Duration::from_secs(3 * 60 * 60),
            install: Duration::from_secs(20 * 60),
        }
    }
}

/// Tiến trình runner đang chạy. Stdout được một luồng riêng đọc và chỉ chuyển tiếp các dòng JSON
/// (bắt đầu bằng `{`) qua kênh; nhờ đó phía chờ có thể có timeout và dòng rác không làm hỏng giao thức.
struct Proc {
    child: Arc<Mutex<Child>>,
    stdin: ChildStdin,
    rx: Receiver<String>,
}

/// Dừng cả cây tiến trình: runner Python và các tiến trình con của nó (ffmpeg, pip...).
/// Unix: runner chạy trong nhóm tiến trình riêng (pgid == pid) nên kill cả nhóm.
/// Windows: `taskkill /T /F`. Chỉ kill mỗi Python sẽ để ffmpeg chạy ngầm đến khi tự xong.
fn kill_tree(child: &mut Child) {
    let pid = child.id();
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-KILL", "--", &format!("-{}", pid)])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(windows)]
    {
        let mut c = Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
        apply_no_window(&mut c);
        let _ = c.status();
    }
    let _ = child.kill();
}

/// Đặt tiến trình con vào nhóm riêng để `kill_tree` dừng được cả nhóm (Unix).
fn isolate_process_group(cmd: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(not(unix))]
    {
        let _ = cmd;
    }
}

impl Proc {
    fn kill(&self) {
        if let Ok(mut c) = self.child.lock() {
            kill_tree(&mut c);
            let _ = c.wait();
        }
    }
}

impl Drop for Proc {
    fn drop(&mut self) {
        // Không để lại tiến trình Python (và render dở dang) mồ côi khi bỏ runner, hết hạn, hủy hoặc thoát app.
        self.kill();
    }
}

enum WaitError {
    Timeout,
    Cancelled,
    Died,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn venv_python(venv_dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    }
}

fn system_python() -> PathBuf {
    PathBuf::from(if cfg!(target_os = "windows") { "py" } else { "python3" })
}

fn apply_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

/// Tìm ffmpeg đi kèm app: cạnh file thực thi (bản cài đặt: Tauri đặt externalBin ở đây, bỏ hậu tố
/// target-triple), hoặc `src-tauri/binaries/ffmpeg-<triple>` khi chạy dev. Không thấy thì Python dùng PATH.
fn resolve_bundled_ffmpeg() -> Option<PathBuf> {
    let exe_name = if cfg!(target_os = "windows") { "ffmpeg.exe" } else { "ffmpeg" };
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            dirs.push(d.to_path_buf());
        }
    }
    for d in &dirs {
        let p = d.join(exe_name);
        if p.is_file() {
            return Some(p);
        }
    }
    let mut dev: Vec<PathBuf> = Vec::new();
    if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        dev.push(PathBuf::from(m).join("binaries"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        dev.push(cwd.join("binaries"));
        dev.push(cwd.join("src-tauri").join("binaries"));
    }
    for d in dev {
        if let Ok(rd) = std::fs::read_dir(&d) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with("ffmpeg-") && !name.ends_with(".d") && e.path().is_file() {
                    return Some(e.path());
                }
            }
        }
    }
    None
}

/// Ghi dự án ra tệp JSON nguyên tử (ghi tệp tạm cạnh đích rồi đổi tên) để không bao giờ để lại tệp dở.
pub fn save_project_file(path: &Path, project: &serde_json::Value) -> Result<()> {
    if !project.is_object() {
        return Err(anyhow!("Dự án phải là một đối tượng JSON"));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("Không tạo được thư mục {:?}", parent))?;
    }
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(project)?;
    std::fs::write(&tmp, text).with_context(|| format!("Không ghi được {:?}", tmp))?;
    std::fs::rename(&tmp, path).with_context(|| format!("Không thay được {:?}", path))?;
    Ok(())
}

/// Đọc dự án; từ chối tệp không phải dự án hoặc có schemaVersion mới hơn bản app hiểu.
pub fn load_project_file(path: &Path) -> Result<serde_json::Value> {
    let text = std::fs::read_to_string(path).with_context(|| format!("Không đọc được {:?}", path))?;
    let v: serde_json::Value = serde_json::from_str(&text).with_context(|| format!("{:?} không phải JSON hợp lệ", path))?;
    let ver = v.get("schemaVersion").and_then(|x| x.as_i64());
    match ver {
        None => Err(anyhow!("Tệp không phải dự án Whiteboard (thiếu schemaVersion)")),
        Some(n) if n > PROJECT_SCHEMA_VERSION => Err(anyhow!(
            "Dự án dùng schemaVersion {} mới hơn bản app này hiểu ({}); hãy cập nhật app",
            n,
            PROJECT_SCHEMA_VERSION
        )),
        Some(_) => Ok(v),
    }
}

pub const PROJECT_SCHEMA_VERSION: i64 = 1;

pub struct WhiteboardPipeline {
    runner_path: PathBuf,
    skill_dir: PathBuf,
    data_dir: Option<PathBuf>,
    /// ffmpeg đi kèm app (externalBin) nếu tìm thấy; truyền cho runner qua XITRUM_FFMPEG.
    ffmpeg_path: Option<PathBuf>,
    timeouts: Timeouts,
    /// Trình thông dịch ép dùng (đặt sau khi cài môi trường, hoặc trong kiểm thử).
    python_override: Mutex<Option<PathBuf>>,
    /// Giữ khóa này suốt một yêu cầu để các yêu cầu không xen kẽ nhau.
    process: Mutex<Option<Proc>>,
    /// Bản sao tay cầm Child để `cancel()` dừng được tiến trình mà không cần chờ khóa `process`.
    current: Mutex<Option<Arc<Mutex<Child>>>>,
    cancelled: AtomicBool,
}

impl WhiteboardPipeline {
    pub fn new() -> Self {
        Self::with_dirs(None, None)
    }

    pub fn with_app_handle(app_handle: &tauri::AppHandle) -> Self {
        use tauri::Manager;
        let resource_dir = app_handle.path().resource_dir().ok();
        let data_dir = app_handle.path().app_local_data_dir().ok();
        Self::with_dirs(resource_dir, data_dir)
    }

    /// `resource_dir`: thư mục tài nguyên của bản cài đặt; `data_dir`: thư mục dữ liệu người dùng
    /// (nơi đặt môi trường ảo Python do app cài).
    pub fn with_dirs(resource_dir: Option<PathBuf>, data_dir: Option<PathBuf>) -> Self {
        let rel = Path::new("sidecar-whiteboard").join("whiteboard_runner.py");
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(r) = &resource_dir {
            candidates.push(r.join(&rel));
            // Tài nguyên khai báo bằng "../sidecar-whiteboard/..." được Tauri đặt dưới "_up_".
            candidates.push(r.join("_up_").join(&rel));
        }
        if let Ok(cwd) = std::env::current_dir() {
            candidates.push(cwd.join(&rel));
            candidates.push(cwd.join("..").join(&rel));
        }
        let runner_path = candidates
            .into_iter()
            .find(|p| p.exists())
            .unwrap_or_else(|| rel.clone());
        Self::build(runner_path, data_dir, Timeouts::default(), None)
    }

    /// Dùng cho kiểm thử: chỉ định sẵn runner, trình thông dịch và timeout.
    pub fn with_runner(runner_path: PathBuf, python: Option<PathBuf>, timeouts: Timeouts) -> Self {
        Self::build(runner_path, None, timeouts, python)
    }

    fn build(runner_path: PathBuf, data_dir: Option<PathBuf>, timeouts: Timeouts, python: Option<PathBuf>) -> Self {
        let skill_dir = runner_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();
        Self {
            runner_path,
            skill_dir,
            data_dir,
            ffmpeg_path: resolve_bundled_ffmpeg(),
            timeouts,
            python_override: Mutex::new(python),
            process: Mutex::new(None),
            current: Mutex::new(None),
            cancelled: AtomicBool::new(false),
        }
    }

    /// Thứ tự: trình thông dịch đã ép → venv trong thư mục dữ liệu app → `.venv` của skill → Python hệ thống.
    fn python_program(&self) -> PathBuf {
        if let Some(p) = lock(&self.python_override).clone() {
            return p;
        }
        if let Some(d) = &self.data_dir {
            let p = venv_python(&d.join("whiteboard-venv"));
            if p.exists() {
                return p;
            }
        }
        let p = venv_python(&self.skill_dir.join(".venv"));
        if p.exists() {
            return p;
        }
        system_python()
    }

    fn spawn_process(&self) -> Result<Proc> {
        let py = self.python_program();
        let mut cmd = Command::new(&py);
        cmd.env("PYTHONUTF8", "1")
            .env("PYTHONUNBUFFERED", "1")
            .arg(&self.runner_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        if let Some(ff) = &self.ffmpeg_path {
            cmd.env("XITRUM_FFMPEG", ff); // runner dùng đúng ffmpeg đi kèm app thay vì chỉ dựa vào PATH
        }
        apply_no_window(&mut cmd);

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0); // Tạo process group riêng để kill toàn bộ cây tiến trình khi hủy (R5)
        }

        let mut child = cmd.spawn().with_context(|| {
            format!(
                "Không thể khởi động Whiteboard Python runner (python: {:?}, runner: {:?}). Đã cài Python chưa?",
                py, self.runner_path
            )
        })?;

        let stdin = child.stdin.take().ok_or_else(|| anyhow!("Không lấy được stdin của Whiteboard runner"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("Không lấy được stdout của Whiteboard runner"))?;
        let child = Arc::new(Mutex::new(child));

        let (tx, rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut buf = Vec::new();
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let line = String::from_utf8_lossy(&buf).trim().to_string();
                        if line.starts_with('{') {
                            if tx.send(line).is_err() {
                                break;
                            }
                        } else if !line.is_empty() {
                            warn!("Whiteboard stdout (không phải JSON, bỏ qua): {}", line);
                        }
                    }
                }
            }
        });

        let proc = Proc { child: Arc::clone(&child), stdin, rx };
        match proc.rx.recv_timeout(self.timeouts.ready) {
            Ok(line) => match serde_json::from_str::<WhiteboardResponse>(&line) {
                Ok(WhiteboardResponse::Ready { message }) => {
                    info!("Whiteboard Engine đã sẵn sàng: {}", message);
                }
                Ok(WhiteboardResponse::Error { message, .. }) => {
                    return Err(anyhow!("Lỗi khởi động Whiteboard: {}", message));
                }
                _ => return Err(anyhow!("Không nhận được tín hiệu ready từ Whiteboard (nhận: {})", line)),
            },
            Err(RecvTimeoutError::Timeout) => {
                return Err(anyhow!("Whiteboard runner không báo ready sau {} giây", self.timeouts.ready.as_secs()));
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(anyhow!(
                    "Whiteboard runner thoát ngay khi khởi động (thiếu thư viện Python? xem nhật ký stderr)"
                ));
            }
        }
        *lock(&self.current) = Some(child);
        Ok(proc)
    }

    /// Dừng thao tác đang chạy (nếu có). Tiến trình runner bị kill và sẽ được khởi động lại ở yêu cầu kế.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        let child = lock(&self.current).clone();
        if let Some(c) = child {
            if let Ok(mut c) = c.lock() {
                #[cfg(unix)]
                {
                    extern "C" {
                        fn kill(pid: i32, sig: i32) -> i32;
                    }
                    let pid = c.id() as i32;
                    unsafe {
                        // Gửi SIGKILL tới âm pid để kill toàn bộ process group (R5)
                        let _ = kill(-pid, 9);
                    }
                }
                let _ = c.kill();
            }
        }
    }

    /// Kiểm tra trạng thái đã bị hủy hay chưa
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    fn await_response(
        &self,
        proc: &Proc,
        task_id: &str,
        timeout: Duration,
        on_progress: &dyn Fn(&serde_json::Value),
    ) -> std::result::Result<WhiteboardResponse, WaitError> {
        let deadline = Instant::now() + timeout;
        loop {
            if self.cancelled.load(Ordering::SeqCst) {
                return Err(WaitError::Cancelled);
            }
            let now = Instant::now();
            if now >= deadline {
                return Err(WaitError::Timeout);
            }
            let slice = (deadline - now).min(Duration::from_millis(200));
            match proc.rx.recv_timeout(slice) {
                Ok(line) => {
                    let v: serde_json::Value = match serde_json::from_str(&line) {
                        Ok(v) => v,
                        Err(e) => {
                            warn!("Bỏ qua dòng JSON hỏng từ Whiteboard: {} ({})", e, line);
                            continue;
                        }
                    };
                    // Phản hồi của yêu cầu khác (muộn/lạc) không được trả nhầm cho yêu cầu này.
                    let tid = v.get("task_id").and_then(|t| t.as_str()).unwrap_or("");
                    if !tid.is_empty() && !task_id.is_empty() && tid != task_id {
                        continue;
                    }
                    match v.get("type").and_then(|t| t.as_str()) {
                        Some("progress") => on_progress(&v),
                        Some("pong") | Some("done") | Some("error") => {
                            match serde_json::from_value::<WhiteboardResponse>(v) {
                                Ok(r) => return Ok(r),
                                Err(e) => warn!("Phản hồi Whiteboard không đúng định dạng: {}", e),
                            }
                        }
                        _ => {}
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(if self.cancelled.load(Ordering::SeqCst) {
                        WaitError::Cancelled
                    } else {
                        WaitError::Died
                    });
                }
            }
        }
    }

    /// Gửi một yêu cầu và chờ phản hồi cuối, chuyển tiếp các sự kiện `progress` qua `on_progress`.
    ///
    /// Quy tắc an toàn: chỉ khởi động lại và gửi lại yêu cầu khi việc *ghi* thất bại (runner chưa
    /// nhận được gì). Nếu runner chết, hết hạn hoặc bị hủy giữa chừng thì báo lỗi, không tự chạy lại
    /// (tránh render/ghép hai lần).
    pub fn request(
        &self,
        req: WhiteboardRequest,
        timeout: Duration,
        on_progress: &dyn Fn(&serde_json::Value),
    ) -> Result<WhiteboardResponse> {
        let mut guard = lock(&self.process);
        self.cancelled.store(false, Ordering::SeqCst);

        let req_value = serde_json::to_value(&req)?;
        let task_id = req_value.get("task_id").and_then(|t| t.as_str()).unwrap_or("").to_string();
        let line = serde_json::to_string(&req_value)?;

        // Runner đã chết lúc rảnh (bị kill ngoài, crash) → bỏ và khởi động lại.
        let idle_dead = guard
            .as_ref()
            .map(|p| lock(&p.child).try_wait().map(|s| s.is_some()).unwrap_or(false))
            .unwrap_or(false);
        if idle_dead {
            warn!("Whiteboard runner đã thoát khi rảnh; khởi động lại");
            *guard = None;
        }

        let mut written = false;
        for attempt in 0..2 {
            if guard.is_none() {
                *guard = Some(self.spawn_process()?);
            }
            let p = guard.as_mut().expect("vừa khởi động");
            while p.rx.try_recv().is_ok() {} // bỏ dòng cũ còn sót từ yêu cầu trước
            let res = writeln!(p.stdin, "{}", line).and_then(|_| p.stdin.flush());
            match res {
                Ok(()) => {
                    written = true;
                    break;
                }
                Err(e) => {
                    warn!("Ghi yêu cầu vào Whiteboard runner thất bại ({}), lần {}", e, attempt + 1);
                    *guard = None; // Drop → kill + wait
                }
            }
        }
        if !written {
            return Err(anyhow!("Không gửi được yêu cầu tới Whiteboard runner"));
        }

        let outcome = {
            let p = guard.as_ref().expect("đã có tiến trình");
            self.await_response(p, &task_id, timeout, on_progress)
        };
        match outcome {
            Ok(r) => Ok(r),
            Err(e) => {
                *guard = None; // dừng hẳn tiến trình (Drop)
                Err(match e {
                    WaitError::Timeout => anyhow!(
                        "Whiteboard không phản hồi sau {} giây; đã dừng tiến trình, hãy thử lại",
                        timeout.as_secs()
                    ),
                    WaitError::Cancelled => anyhow!("CANCELLED: Đã hủy theo yêu cầu"),
                    WaitError::Died => anyhow!(
                        "Whiteboard runner thoát đột ngột khi đang xử lý (thiếu bộ nhớ hoặc lỗi thư viện?); \
                         thao tác không được tự chạy lại"
                    ),
                })
            }
        }
    }

    fn call(
        &self,
        req: WhiteboardRequest,
        timeout: Duration,
        what: &str,
        on_progress: &dyn Fn(&serde_json::Value),
    ) -> Result<serde_json::Value> {
        match self.request(req, timeout, on_progress)? {
            WhiteboardResponse::Done { data, .. } => Ok(data.unwrap_or_default()),
            WhiteboardResponse::Error { message, traceback, .. } => {
                Err(anyhow!("Lỗi {}: {}\nChi tiết: {:?}", what, message, traceback))
            }
            _ => Err(anyhow!("Phản hồi không hợp lệ từ Whiteboard")),
        }
    }

    pub fn parse_srt(&self, srt_path: String, exact_cues: bool) -> Result<serde_json::Value> {
        let req = WhiteboardRequest::ParseSrt {
            task_id: uuid::Uuid::new_v4().to_string(),
            srt_path,
            exact_cues,
            target_sec: 30.0,
            min_sec: 25.0,
            max_sec: 35.0,
        };
        self.call(req, self.timeouts.quick, "phân tích SRT", &|_| {})
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
        self.call(req, self.timeouts.generate, "sinh annotation", &|_| {})
    }

    pub fn analyze_image_style(&self, image_path: String) -> Result<serde_json::Value> {
        let req = WhiteboardRequest::AnalyzeImageStyle {
            task_id: uuid::Uuid::new_v4().to_string(),
            image_path,
        };
        self.call(req, self.timeouts.quick, "phân tích style ảnh", &|_| {})
    }

    pub fn render_scene(
        &self,
        image_path: String,
        annotation_path: String,
        output_path: String,
        fps: i32,
        paper_color: String,
        hand_path: Option<String>,
        audio_path: Option<String>,
        ink_path: Option<String>,
        color_fill: Option<String>,
        ink_weight: Option<f64>,
        color_weight: Option<f64>,
        duration_ms: Option<i64>,
        subject_first: Option<bool>,
        on_progress: &dyn Fn(&serde_json::Value),
    ) -> Result<serde_json::Value> {
        let req = WhiteboardRequest::RenderScene {
            task_id: uuid::Uuid::new_v4().to_string(),
            image_path,
            annotation_path,
            output_path,
            fps,
            paper_color,
            hand_path,
            audio_path,
            ink_path,
            color_fill,
            ink_weight,
            color_weight,
            duration_ms,
            subject_first,
        };
        self.call(req, self.timeouts.render, "render bảng trắng", on_progress)
    }

    pub fn get_fingerprint(
        &self,
        image_path: String,
        annotation_path: String,
        fps: i32,
        paper_color: String,
        hand_path: Option<String>,
        audio_path: Option<String>,
        ink_path: Option<String>,
        color_fill: Option<String>,
        ink_weight: Option<f64>,
        color_weight: Option<f64>,
        duration_ms: Option<i64>,
        subject_first: Option<bool>,
    ) -> Result<String> {
        let req = WhiteboardRequest::GetFingerprint {
            task_id: uuid::Uuid::new_v4().to_string(),
            image_path,
            annotation_path,
            fps,
            paper_color,
            hand_path,
            audio_path,
            ink_path,
            color_fill,
            ink_weight,
            color_weight,
            duration_ms,
            subject_first,
        };
        let res = self.call(req, self.timeouts.quick, "tính fingerprint", &|_| {})?;
        let fp = res.get("fingerprint").and_then(|v| v.as_str()).unwrap_or("").to_string();
        Ok(fp)
    }

    pub fn verify_cache(&self, video_path: String, expected_fingerprint: String) -> bool {
        let req = WhiteboardRequest::VerifyCache {
            task_id: uuid::Uuid::new_v4().to_string(),
            video_path,
            expected_fingerprint,
        };
        match self.call(req, self.timeouts.quick, "kiểm tra cache", &|_| {}) {
            Ok(v) => v.get("valid").and_then(|b| b.as_bool()).unwrap_or(false),
            Err(_) => false,
        }
    }

    pub fn render_preview(
        &self,
        image_path: String,
        annotation_path: String,
        output_path: String,
    ) -> Result<serde_json::Value> {
        let req = WhiteboardRequest::RenderPreview {
            task_id: uuid::Uuid::new_v4().to_string(),
            image_path,
            annotation_path,
            output_path,
        };
        self.call(req, self.timeouts.quick, "tạo preview vùng vẽ", &|_| {})
    }

    pub fn merge_scenes(
        &self,
        video_paths: Vec<String>,
        output_path: String,
        master_audio_path: Option<String>,
        thumbnail_png: Option<String>,
        on_progress: &dyn Fn(&serde_json::Value),
    ) -> Result<serde_json::Value> {
        let req = WhiteboardRequest::MergeScenes {
            task_id: uuid::Uuid::new_v4().to_string(),
            video_paths,
            output_path,
            master_audio_path,
            thumbnail_png,
        };
        self.call(req, self.timeouts.merge, "ghép cảnh", on_progress)
    }

    /// Kiểm tra dự án (thiếu tệp, annotation vượt thời lượng, audio...). Trả `{errors, warnings}`.
    pub fn validate_project(&self, project: serde_json::Value, scene_ids: Option<Vec<String>>) -> Result<serde_json::Value> {
        let req = WhiteboardRequest::ValidateProject {
            task_id: uuid::Uuid::new_v4().to_string(),
            project,
            scene_ids,
        };
        self.call(req, self.timeouts.quick, "kiểm tra dự án", &|_| {})
    }

    /// Xuất dự án nhiều cảnh ra MP4 (có audio nếu dự án có). Trả manifest.
    pub fn render_project(
        &self,
        project: serde_json::Value,
        output_path: String,
        scene_ids: Option<Vec<String>>,
        on_progress: &dyn Fn(&serde_json::Value),
    ) -> Result<serde_json::Value> {
        let req = WhiteboardRequest::RenderProject {
            task_id: uuid::Uuid::new_v4().to_string(),
            project,
            output_path,
            scene_ids,
        };
        self.call(req, self.timeouts.project, "xuất dự án", on_progress)
    }

    /// Kiểm tra môi trường Python. Không bao giờ trả lỗi: sự cố được mô tả trong `ok:false` + `error`
    /// để giao diện hiện banner hướng dẫn cài đặt.
    pub fn check_env(&self) -> serde_json::Value {
        let req = WhiteboardRequest::CheckEnv { task_id: uuid::Uuid::new_v4().to_string() };
        let fail = |msg: String| {
            serde_json::json!({
                "ok": false,
                "python": self.python_program().to_string_lossy(),
                "missing": [],
                "error": msg,
            })
        };
        match self.request(req, self.timeouts.quick, &|_| {}) {
            Ok(WhiteboardResponse::Done { data, .. }) => data.unwrap_or_default(),
            Ok(WhiteboardResponse::Error { message, .. }) => fail(message),
            Ok(_) => fail("Phản hồi không hợp lệ từ Whiteboard".to_string()),
            Err(e) => fail(e.to_string()),
        }
    }

    /// Tạo/hoàn thiện môi trường ảo bằng `scripts/prepare_env.py` (chạy bằng Python hệ thống), đặt
    /// trong thư mục dữ liệu của app. Thành công thì runner được khởi động lại với môi trường mới.
    pub fn install_env(&self, on_line: &dyn Fn(&str)) -> Result<serde_json::Value> {
        // Không cài khi đang render: runner đang dùng môi trường hiện tại.
        let mut guard = match self.process.try_lock() {
            Ok(g) => g,
            Err(_) => return Err(anyhow!("Whiteboard đang bận; hãy thử lại khi thao tác hiện tại xong")),
        };
        self.cancelled.store(false, Ordering::SeqCst);

        let script = self.skill_dir.join("scripts").join("prepare_env.py");
        if !script.exists() {
            return Err(anyhow!("Không tìm thấy prepare_env.py tại {:?}", script));
        }
        let venv_dir = match &self.data_dir {
            Some(d) => d.join("whiteboard-venv"),
            None => self.skill_dir.join(".venv"),
        };
        if let Some(parent) = venv_dir.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let mut cmd = Command::new(system_python());
        cmd.env("PYTHONUTF8", "1")
            .env("PYTHONUNBUFFERED", "1")
            .arg(&script)
            .arg("--venv-dir")
            .arg(&venv_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        apply_no_window(&mut cmd);
        isolate_process_group(&mut cmd);
        let mut child = cmd
            .spawn()
            .context("Không chạy được Python hệ thống để cài môi trường (đã cài Python 3 và thêm vào PATH chưa?)")?;

        let (tx, rx) = mpsc::channel::<String>();
        for stream in [
            child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
            child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        ]
        .into_iter()
        .flatten()
        {
            let tx = tx.clone();
            std::thread::spawn(move || {
                let mut r = BufReader::new(stream);
                let mut buf = Vec::new();
                while let Ok(n) = r.read_until(b'\n', &mut buf) {
                    if n == 0 {
                        break;
                    }
                    let _ = tx.send(String::from_utf8_lossy(&buf).trim_end().to_string());
                    buf.clear();
                }
            });
        }
        drop(tx);

        let deadline = Instant::now() + self.timeouts.install;
        let mut env_py: Option<String> = None;
        let mut tail: Vec<String> = Vec::new();
        let status = loop {
            loop {
                match rx.try_recv() {
                    Ok(l) => {
                        if let Some(p) = l.strip_prefix("ENV_PY=") {
                            env_py = Some(p.trim().to_string());
                        }
                        on_line(&l);
                        tail.push(l);
                        if tail.len() > 20 {
                            tail.remove(0);
                        }
                    }
                    Err(_) => break,
                }
            }
            if self.cancelled.load(Ordering::SeqCst) {
                kill_tree(&mut child);
                let _ = child.wait();
                return Err(anyhow!("CANCELLED: Đã hủy cài đặt môi trường"));
            }
            if Instant::now() >= deadline {
                kill_tree(&mut child);
                let _ = child.wait();
                return Err(anyhow!("Cài môi trường quá {} giây; đã dừng", self.timeouts.install.as_secs()));
            }
            match child.try_wait() {
                Ok(Some(s)) => break s,
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(e) => return Err(anyhow!("Lỗi chờ tiến trình cài đặt: {}", e)),
            }
        };
        // lấy nốt dòng còn lại sau khi tiến trình thoát
        std::thread::sleep(Duration::from_millis(150));
        while let Ok(l) = rx.try_recv() {
            if let Some(p) = l.strip_prefix("ENV_PY=") {
                env_py = Some(p.trim().to_string());
            }
            on_line(&l);
            tail.push(l);
        }

        if !status.success() {
            return Err(anyhow!(
                "Cài môi trường thất bại (mã {:?}):\n{}",
                status.code(),
                tail.iter().rev().take(8).rev().cloned().collect::<Vec<_>>().join("\n")
            ));
        }
        let py = env_py.ok_or_else(|| anyhow!("prepare_env.py không in ENV_PY=<đường dẫn>"))?;
        *lock(&self.python_override) = Some(PathBuf::from(&py));
        *guard = None; // runner cũ (nếu có) bị dừng; lần gọi sau dùng môi trường mới
        Ok(serde_json::json!({ "python": py, "venvDir": venv_dir.to_string_lossy() }))
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    // Runner giả: chế độ chọn bằng `output_path` của RenderScene, `image_path` là tệp ghi pid/đếm.
    const FAKE: &str = r#"
import sys, os, json, time
def send(o): sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
send({"type": "ready", "message": "fake"})
for line in sys.stdin:
    req = json.loads(line)
    a, tid = req.get("action"), req.get("task_id", "")
    if a == "exit": break
    if a == "ping": send({"type": "pong", "task_id": tid, "status": "ok"}); continue
    if a == "check_env": send({"type": "done", "task_id": tid, "action": a, "data": {"ok": True, "missing": []}}); continue
    mode, mark = req.get("output_path"), req.get("image_path")
    with open(mark, "a") as f: f.write(str(os.getpid()) + "\n")
    if mode == "noise":
        print("rác không phải JSON"); sys.stdout.flush()
        send({"type": "progress", "task_id": tid, "percent": 10.0, "message": "a"})
        send({"type": "progress", "task_id": tid, "percent": 60.0, "message": "b"})
        send({"type": "done", "task_id": tid, "action": a, "data": {"pid": os.getpid()}})
        send({"type": "done", "task_id": "tre-muon", "action": a, "data": {"stray": True}})
    elif mode == "hang": time.sleep(3600)
    elif mode == "spawn-child":
        import subprocess
        ch = subprocess.Popen(["sleep", "300"])
        with open(mark + ".child", "w") as f: f.write(str(ch.pid))
        time.sleep(3600)
    elif mode == "die": os._exit(1)
    elif mode == "quit-after":
        send({"type": "done", "task_id": tid, "action": a, "data": {"pid": os.getpid()}}); os._exit(0)
    else: send({"type": "done", "task_id": tid, "action": a, "data": {"pid": os.getpid()}})
"#;

    struct Fixture {
        dir: PathBuf,
        pipe: WhiteboardPipeline,
    }

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn fixture(timeouts: Timeouts) -> Fixture {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("wb_rs_test_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).unwrap();
        let runner = dir.join("fake_runner.py");
        std::fs::write(&runner, FAKE).unwrap();
        let pipe = WhiteboardPipeline::with_runner(runner, Some(PathBuf::from("python3")), timeouts);
        Fixture { dir, pipe }
    }

    fn quick() -> Timeouts {
        Timeouts { ready: Duration::from_secs(20), quick: Duration::from_secs(20), render: Duration::from_secs(20), ..Timeouts::default() }
    }

    fn render(f: &Fixture, mode: &str, tid: &str, cb: &dyn Fn(&serde_json::Value), timeout: Duration) -> Result<WhiteboardResponse> {
        let mark = f.dir.join("marks.txt");
        f.pipe.request(
            WhiteboardRequest::RenderScene {
                task_id: tid.into(),
                image_path: mark.to_string_lossy().into(),
                annotation_path: String::new(),
                output_path: mode.into(),
                fps: 30,
                paper_color: "#FFFFFF".into(),
                hand_path: None,
                audio_path: None,
                ink_path: None,
                color_fill: None,
                ink_weight: None,
                color_weight: None,
                duration_ms: None,
                subject_first: None,
            },
            timeout,
            cb,
        )
    }

    fn pid_alive(pid: i64) -> bool {
        #[cfg(target_os = "linux")]
        {
            // Zombie (đã chết, chưa được tiến trình cha thu dọn) không tính là còn sống.
            match std::fs::read_to_string(format!("/proc/{}/stat", pid)) {
                Ok(s) => s.rsplit(')').next().map(|r| !r.trim_start().starts_with('Z')).unwrap_or(false),
                Err(_) => false,
            }
        }
        #[cfg(not(target_os = "linux"))]
        {
            extern "C" {
                fn kill(pid: i32, sig: i32) -> i32;
            }
            unsafe { kill(pid as i32, 0) == 0 }
        }
    }

    fn pid_of(r: Result<WhiteboardResponse>) -> i64 {
        match r.unwrap() {
            WhiteboardResponse::Done { data, .. } => data.unwrap()["pid"].as_i64().unwrap(),
            other => panic!("không phải Done: {:?}", other),
        }
    }

    #[test]
    fn noise_progress_and_stray_lines() {
        let f = fixture(quick());
        let seen = Mutex::new(Vec::<f64>::new());
        let cb = |v: &serde_json::Value| seen.lock().unwrap().push(v["percent"].as_f64().unwrap());
        let pid1 = pid_of(render(&f, "noise", "t1", &cb, Duration::from_secs(20)));
        assert_eq!(*seen.lock().unwrap(), vec![10.0, 60.0]);
        // Dòng "done" lạc (task_id khác) của yêu cầu trước không được trả nhầm cho yêu cầu sau.
        let pid2 = pid_of(render(&f, "ok", "t2", &|_| {}, Duration::from_secs(20)));
        assert_eq!(pid1, pid2, "cùng một runner được dùng lại");
    }

    #[test]
    fn timeout_kills_the_process() {
        let f = fixture(quick());
        let t0 = Instant::now();
        let err = render(&f, "hang", "t1", &|_| {}, Duration::from_millis(1200)).unwrap_err().to_string();
        assert!(err.contains("không phản hồi"), "{}", err);
        assert!(t0.elapsed() < Duration::from_secs(10));
        let marks = std::fs::read_to_string(f.dir.join("marks.txt")).unwrap();
        let pid: i64 = marks.lines().last().unwrap().parse().unwrap();
        assert!(!pid_alive(pid), "tiến trình runner phải bị dừng, không mồ côi");
        // Yêu cầu kế tiếp tự khởi động runner mới.
        let pid2 = pid_of(render(&f, "ok", "t2", &|_| {}, Duration::from_secs(20)));
        assert_ne!(pid, pid2);
    }

    #[test]
    fn cancel_kills_and_reports_cancelled() {
        let f = Arc::new(fixture(quick()));
        let f2 = Arc::clone(&f);
        let h = std::thread::spawn(move || render(&f2, "hang", "t1", &|_| {}, Duration::from_secs(60)));
        std::thread::sleep(Duration::from_millis(1500));
        let t0 = Instant::now();
        f.pipe.cancel();
        let err = h.join().unwrap().unwrap_err().to_string();
        assert!(err.starts_with("CANCELLED"), "{}", err);
        assert!(t0.elapsed() < Duration::from_secs(5));
        let marks = std::fs::read_to_string(f.dir.join("marks.txt")).unwrap();
        let pid: i64 = marks.lines().last().unwrap().parse().unwrap();
        assert!(!pid_alive(pid));
        // Hủy xong vẫn dùng lại được.
        pid_of(render(&f, "ok", "t2", &|_| {}, Duration::from_secs(20)));
    }

    #[test]
    fn cancel_kills_child_processes_of_the_runner() {
        // Python (runner) sinh tiến trình con như ffmpeg; hủy phải dừng cả cây, không chỉ Python.
        let f = Arc::new(fixture(quick()));
        let f2 = Arc::clone(&f);
        let h = std::thread::spawn(move || render(&f2, "spawn-child", "t1", &|_| {}, Duration::from_secs(60)));
        let child_file = f.dir.join("marks.txt.child");
        let t0 = Instant::now();
        while !child_file.exists() && t0.elapsed() < Duration::from_secs(10) {
            std::thread::sleep(Duration::from_millis(50));
        }
        let child_pid: i64 = std::fs::read_to_string(&child_file).unwrap().trim().parse().unwrap();
        assert!(pid_alive(child_pid), "tiến trình con phải đang chạy trước khi hủy");
        f.pipe.cancel();
        assert!(h.join().unwrap().unwrap_err().to_string().starts_with("CANCELLED"));
        std::thread::sleep(Duration::from_millis(300));
        assert!(!pid_alive(child_pid), "tiến trình con (ffmpeg) của runner không được chạy ngầm sau khi hủy");
    }

    #[test]
    fn timeout_also_kills_child_processes() {
        let f = fixture(quick());
        let _ = render(&f, "spawn-child", "t1", &|_| {}, Duration::from_millis(1500)).unwrap_err();
        let child_pid: i64 = std::fs::read_to_string(f.dir.join("marks.txt.child")).unwrap().trim().parse().unwrap();
        std::thread::sleep(Duration::from_millis(300));
        assert!(!pid_alive(child_pid));
    }

    #[test]
    fn project_requests_have_expected_wire_shape() {
        let v = serde_json::to_value(WhiteboardRequest::RenderProject {
            task_id: "t".into(),
            project: serde_json::json!({"schemaVersion": 1}),
            output_path: "/o.mp4".into(),
            scene_ids: Some(vec!["s2".into()]),
        })
        .unwrap();
        assert_eq!(v["action"], "render_project");
        assert_eq!(v["output_path"], "/o.mp4");
        assert_eq!(v["scene_ids"][0], "s2");
        let v = serde_json::to_value(WhiteboardRequest::ValidateProject {
            task_id: "t".into(),
            project: serde_json::json!({}),
            scene_ids: None,
        })
        .unwrap();
        assert_eq!(v["action"], "validate_project");
        assert!(v.get("scene_ids").is_none());
    }

    #[test]
    fn project_file_roundtrip_and_guards() {
        let dir = std::env::temp_dir().join(format!("wb_rs_proj_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("sub").join("demo.wbproj.json");
        let project = serde_json::json!({"schemaVersion": 1, "id": "p", "scenes": [{"id": "s1", "tên": "Cảnh đầu"}]});
        save_project_file(&path, &project).unwrap();
        assert!(!path.with_extension("json.tmp").exists(), "không để lại tệp tạm");
        assert_eq!(load_project_file(&path).unwrap(), project);
        let project2 = serde_json::json!({"schemaVersion": 1, "id": "p2", "scenes": []});
        save_project_file(&path, &project2).unwrap();
        assert_eq!(load_project_file(&path).unwrap()["id"], "p2");
        std::fs::write(&path, "{\"a\":1}").unwrap();
        assert!(load_project_file(&path).unwrap_err().to_string().contains("schemaVersion"));
        std::fs::write(&path, "{\"schemaVersion\": 99}").unwrap();
        assert!(load_project_file(&path).unwrap_err().to_string().contains("mới hơn"));
        std::fs::write(&path, "khong phai json").unwrap();
        assert!(load_project_file(&path).is_err());
        assert!(save_project_file(&path, &serde_json::json!([1, 2])).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn crash_mid_request_is_not_retried() {
        let f = fixture(quick());
        let err = render(&f, "die", "t1", &|_| {}, Duration::from_secs(20)).unwrap_err().to_string();
        assert!(err.contains("thoát đột ngột"), "{}", err);
        let marks = std::fs::read_to_string(f.dir.join("marks.txt")).unwrap();
        assert_eq!(marks.lines().count(), 1, "yêu cầu không được gửi lại sau khi runner chết");
        pid_of(render(&f, "ok", "t2", &|_| {}, Duration::from_secs(20)));
    }

    #[test]
    fn idle_dead_runner_is_respawned_transparently() {
        let f = fixture(quick());
        let pid1 = pid_of(render(&f, "quit-after", "t1", &|_| {}, Duration::from_secs(20)));
        std::thread::sleep(Duration::from_millis(400)); // runner tự thoát sau khi trả lời (còn là zombie tới khi try_wait)
        let pid2 = pid_of(render(&f, "ok", "t2", &|_| {}, Duration::from_secs(20)));
        assert_ne!(pid1, pid2);
        let marks = std::fs::read_to_string(f.dir.join("marks.txt")).unwrap();
        assert_eq!(marks.lines().count(), 2, "mỗi yêu cầu đúng một lần");
    }

    #[test]
    fn drop_kills_the_runner() {
        let f = fixture(quick());
        let pid = pid_of(render(&f, "ok", "t1", &|_| {}, Duration::from_secs(20)));
        assert!(pid_alive(pid));
        let Fixture { dir: _dir, pipe } = f;
        drop(pipe);
        std::thread::sleep(Duration::from_millis(300));
        assert!(!pid_alive(pid), "thoát app không được để lại Python mồ côi");
    }

    #[test]
    fn check_env_reports_failures_without_error() {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("wb_rs_test_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).unwrap();
        let runner = dir.join("fake_runner.py");
        std::fs::write(&runner, FAKE).unwrap();
        let good = WhiteboardPipeline::with_runner(runner.clone(), Some("python3".into()), quick());
        assert_eq!(good.check_env()["ok"], true);
        let bad = WhiteboardPipeline::with_runner(runner, Some("/khong/co/python".into()), quick());
        let v = bad.check_env();
        assert_eq!(v["ok"], false);
        assert!(v["error"].as_str().unwrap().contains("Python"));
    }

    #[test]
    fn python_resolution_order() {
        let p = WhiteboardPipeline::with_runner("x/sidecar-whiteboard/whiteboard_runner.py".into(), None, Timeouts::default());
        assert_eq!(p.python_program(), system_python());
        *lock(&p.python_override) = Some("/opt/py".into());
        assert_eq!(p.python_program(), PathBuf::from("/opt/py"));
    }
}
