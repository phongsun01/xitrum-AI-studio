import { useState, useEffect } from "react";
import { api, TaskItem, AppConfig, TemplateItem } from "./api";
import { TemplateLibrary } from "./components/TemplateLibrary";
import { ToastContainer, ToastItem } from "./components/Toast";
import { AudioTimeline } from "./components/AudioTimeline";
import {
  Video,
  Mic,
  Scissors,
  Settings,
  ListOrdered,
  FolderOpen,
  Send,
  XCircle,
  CheckCircle,
  Clock,
  AlertCircle,
  FileAudio,
  Image as ImageIcon,
  RotateCw,
  Copy,
  Edit2,
  Bookmark,
  Check,
  X,
  ListVideo,
  PanelLeftClose,
  PanelLeft,
  Cpu,
  Globe,
} from "lucide-react";
import "./App.css";

function App() {
  const [activeTab, setActiveTab] = useState<
    "video" | "audio" | "timeline" | "rembg" | "templates" | "settings"
  >("video");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Form states
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoRatio, setVideoRatio] = useState("16:9");
  const [audioPath, setAudioPath] = useState("d:\\Antigravity\\REA\\project-docs\\poc-phase0\\jfk.wav");
  const [imagePath, setImagePath] = useState("d:\\Antigravity\\REA\\project-docs\\poc-phase0\\poc_rembg\\input.png");

  // Inline edit prompt modal/state (F4)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingPromptText, setEditingPromptText] = useState("");

  // Settings
  const [config, setConfig] = useState<AppConfig>({
    output_dir: "D:\\XitrumAI_Outputs",
    default_ratio: "16:9",
    whisper_model: "ggml-tiny",
    chrome_profile_dir: "D:\\Antigravity\\REA\\REA-project\\poc-phase0\\chrome-profile",
    music_dir: null,
    music_volume: 0.15,
    max_parallel_muse: 1,
    max_parallel_local: 2,
  });
  const [sessionChecking, setSessionChecking] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [laneStatus, setLaneStatus] = useState<{ muse_available_slots: number; local_available_slots: number }>({
    muse_available_slots: 1,
    local_available_slots: 2,
  });

  // Helper toast notification
  const addToast = (type: "success" | "error" | "info", message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
    if (type !== "error") {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    }
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const loadData = async () => {
    try {
      const [taskList, cfg, tplList] = await Promise.all([
        api.listTasks(),
        api.getSettings(),
        api.listTemplates(),
      ]);
      setTasks(taskList);
      if (cfg) setConfig(cfg);
      if (tplList) setTemplates(tplList);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(async () => {
      try {
        const [taskList, lanes] = await Promise.all([
          api.listTasks(),
          api.getLaneStatus(),
        ]);
        setTasks(taskList);
        if (lanes) setLaneStatus(lanes);
      } catch (e) {
        console.error(e);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  // F1: Mở thư mục chứa kết quả
  const handleOpenFolder = async (taskId: string) => {
    try {
      await api.openOutputFolder(taskId);
      addToast("success", "Đã mở thư mục kết quả thành công!");
    } catch (err) {
      addToast("error", `Không thể mở thư mục: ${err}`);
    }
  };

  // F2: Retry task thất bại
  const handleRetryTask = async (taskId: string) => {
    try {
      await api.retryTask(taskId);
      addToast("info", "Đã đưa tác vụ trở lại hàng đợi!");
      loadData();
    } catch (err) {
      addToast("error", `Lỗi retry: ${err}`);
    }
  };

  // F3: Duplicate task
  const handleDuplicateTask = async (taskId: string) => {
    try {
      await api.duplicateTask(taskId);
      addToast("success", "Đã nhân bản tác vụ vào hàng đợi!");
      loadData();
    } catch (err) {
      addToast("error", `Lỗi nhân bản: ${err}`);
    }
  };

  // F4: Bắt đầu sửa prompt
  const startEditPrompt = (task: TaskItem) => {
    setEditingTaskId(task.id);
    setEditingPromptText(task.prompt || "");
  };

  // F4: Lưu sửa prompt
  const saveEditPrompt = async () => {
    if (!editingTaskId) return;
    try {
      await api.editTaskPrompt(editingTaskId, editingPromptText);
      addToast("success", "Đã cập nhật prompt thành công!");
      setEditingTaskId(null);
      loadData();
    } catch (err) {
      addToast("error", `Lỗi cập nhật prompt: ${err}`);
    }
  };

  // F6: Apply template
  const handleApplyTemplate = (tpl: TemplateItem) => {
    setVideoPrompt(tpl.prompt);
    if (tpl.ratio) setVideoRatio(tpl.ratio);
    setActiveTab("video");
    addToast("info", `Đã điền mẫu "${tpl.name}" vào form Video!`);
  };

  // F6: Save template
  const handleSaveTemplate = async (name: string, prompt: string, ratio?: string) => {
    try {
      await api.saveTemplate(name, prompt, ratio);
      addToast("success", `Đã lưu mẫu "${name}" vào thư viện!`);
      const tpls = await api.listTemplates();
      setTemplates(tpls);
    } catch (err) {
      addToast("error", `Lỗi lưu mẫu: ${err}`);
    }
  };

  // F6: Delete template
  const handleDeleteTemplate = async (id: string) => {
    try {
      await api.deleteTemplate(id);
      addToast("info", "Đã xóa mẫu khỏi thư viện!");
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      addToast("error", `Lỗi xóa mẫu: ${err}`);
    }
  };

  const handleCreateVideo = async () => {
    if (!videoPrompt.trim()) return;
    try {
      await api.enqueueTask("muse_video", videoPrompt, videoRatio, null);
      setVideoPrompt("");
      addToast("success", "Đã thêm tác vụ tạo video vào hàng đợi!");
      loadData();
    } catch (err) {
      addToast("error", `Lỗi tạo video: ${err}`);
    }
  };

  const handlePickAudio = async () => {
    const file = await api.pickFile([
      { name: "Audio Files", extensions: ["mp3", "wav", "m4a", "flac", "ogg"] },
    ]);
    if (file) setAudioPath(file);
  };

  const handleStartStt = async () => {
    if (!audioPath.trim()) return;
    try {
      await api.enqueueTask("whisper_stt", null, null, audioPath);
      addToast("success", "Đã thêm tác vụ bóc tách giọng nói!");
      loadData();
    } catch (err) {
      addToast("error", `Lỗi bóc tách audio: ${err}`);
    }
  };

  const handlePickImage = async () => {
    const file = await api.pickFile([
      { name: "Image Files", extensions: ["png", "jpg", "jpeg", "webp"] },
    ]);
    if (file) setImagePath(file);
  };

  const handleStartRembg = async () => {
    if (!imagePath.trim()) return;
    try {
      await api.enqueueTask("rembg", null, null, imagePath);
      addToast("success", "Đã thêm tác vụ tách nền ảnh!");
      loadData();
    } catch (err) {
      addToast("error", `Lỗi tách nền: ${err}`);
    }
  };

  const handlePickOutputDir = async () => {
    const dir = await api.pickDirectory();
    if (dir) {
      const newCfg = { ...config, output_dir: dir };
      setConfig(newCfg);
      await api.saveSettings(newCfg);
      addToast("success", "Đã cập nhật thư mục lưu kết quả!");
    }
  };

  return (
    <div className="app-container">
      {/* Toast Notification Container (F5) */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      {/* Sidebar Navigation */}
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="logo-box">
          <div className="logo-badge">X</div>
          {!sidebarCollapsed && <h2>Xitrum AI</h2>}
          <button
            className="sidebar-toggle-btn"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? "Mở rộng menu (Sidebar)" : "Thu gọn menu"}
          >
            {sidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="nav-menu">
          <button
            className={`nav-item ${activeTab === "video" ? "active" : ""}`}
            onClick={() => setActiveTab("video")}
            title="Tạo Video Muse.ai"
          >
            <Video size={18} /> {!sidebarCollapsed && <span>Tạo Video Muse.ai</span>}
          </button>
          <button
            className={`nav-item ${activeTab === "audio" ? "active" : ""}`}
            onClick={() => setActiveTab("audio")}
            title="Bóc Tách Audio (Whisper)"
          >
            <Mic size={18} /> {!sidebarCollapsed && <span>Bóc Tách Audio (Whisper)</span>}
          </button>
          <button
            className={`nav-item ${activeTab === "timeline" ? "active" : ""}`}
            onClick={() => setActiveTab("timeline")}
            title="Audio Timeline Editor"
          >
            <ListVideo size={18} /> {!sidebarCollapsed && <span>Audio Timeline Editor</span>}
          </button>
          <button
            className={`nav-item ${activeTab === "rembg" ? "active" : ""}`}
            onClick={() => setActiveTab("rembg")}
            title="Tách Nền Ảnh (Rembg)"
          >
            <Scissors size={18} /> {!sidebarCollapsed && <span>Tách Nền Ảnh (Rembg)</span>}
          </button>
          <button
            className={`nav-item ${activeTab === "templates" ? "active" : ""}`}
            onClick={() => setActiveTab("templates")}
            title="Thư Viện Templates"
          >
            <Bookmark size={18} /> {!sidebarCollapsed && <span>Thư Viện Templates</span>}
          </button>
          <button
            className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
            title="Cài Đặt Hệ Thống"
          >
            <Settings size={18} /> {!sidebarCollapsed && <span>Cài Đặt Hệ Thống</span>}
          </button>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="top-bar">
          <div className="title-section">
            <h1>Xitrum AI Studio</h1>
            <span className="version-badge">v0.4.0 • Rust Multi-Lane • Offline Engine</span>
          </div>

          {/* F14: Multi-Lane Status Indicators */}
          <div className="lane-status-container" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <div className="lane-badge" title="Số luồng Muse.ai RPA còn trống">
              <Globe size={14} className="text-primary" />
              <span>Muse Cloud: <strong>{laneStatus.muse_available_slots}/{config.max_parallel_muse}</strong> slot</span>
            </div>
            <div className="lane-badge" title="Số luồng Local Offline (Whisper/Rembg/FFmpeg) còn trống">
              <Cpu size={14} style={{ color: "#16a34a" }} />
              <span>Local Offline: <strong>{laneStatus.local_available_slots}/{config.max_parallel_local}</strong> slot</span>
            </div>
          </div>
        </header>

        {/* Tab 1: Video */}
        {activeTab === "video" && (
          <div className="panel-card">
            <h3>🎬 Hàng Đợi Sinh Video Tự Động (Muse.ai)</h3>
            <p className="panel-desc">
              Nhập nội dung kịch bản hoặc chọn từ Thư viện Templates để tự động hóa tạo video.
            </p>
            <div className="form-group">
              <label>Kịch bản / Prompt:</label>
              <textarea
                rows={3}
                placeholder="Ví dụ: Cinematic shot of a red futuristic sports car driving through neon city streets in rainy night..."
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
              />
            </div>
            <div className="form-row">
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label>Tỉ lệ khung hình (Aspect Ratio):</label>
                <select value={videoRatio} onChange={(e) => setVideoRatio(e.target.value)} style={{ height: "42px" }}>
                  <option value="16:9">Ngang YouTube / TV (16:9)</option>
                  <option value="9:16">Dọc TikTok / Reels / Shorts (9:16)</option>
                  <option value="1:1">Vuông Instagram (1:1)</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ visibility: "hidden" }}>Thao tác</label>
                <button
                  className="primary-btn"
                  onClick={handleCreateVideo}
                  style={{ height: "42px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                >
                  <Send size={16} /> Thêm Vào Hàng Đợi
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Audio */}
        {activeTab === "audio" && (
          <div className="panel-card">
            <h3>🎙️ Bóc Tách Lời Thoại Sang Timeline (FFmpeg + Whisper)</h3>
            <p className="panel-desc">
              Tự động chuẩn hóa âm thanh và trích xuất timeline câu chữ, phục vụ làm phụ đề hoặc khớp hình video.
            </p>
            <div className="form-group">
              <label>File Âm Thanh:</label>
              <div className="input-with-button">
                <input
                  type="text"
                  placeholder="Chọn file audio hoặc dán đường dẫn..."
                  value={audioPath}
                  onChange={(e) => setAudioPath(e.target.value)}
                />
                <button className="secondary-btn" onClick={handlePickAudio}>
                  <FolderOpen size={16} /> Chọn File...
                </button>
              </div>
            </div>
            <button className="primary-btn" onClick={handleStartStt}>
              <FileAudio size={16} /> Bắt Đầu Bóc Tách
            </button>
          </div>
        )}

        {/* Tab: Timeline Editor (F7, F8, F10) */}
        {activeTab === "timeline" && (
          <AudioTimeline
            onAddToast={addToast}
            onRefreshTasks={loadData}
          />
        )}

        {/* Tab 3: Rembg */}
        {activeTab === "rembg" && (
          <div className="panel-card">
            <h3>✂️ Tách Nền Ảnh Nhân Vật Mẫu (ONNX Runtime Rust)</h3>
            <p className="panel-desc">
              Xóa nền ảnh chân dung siêu tốc (~0.2s) để làm ảnh tham chiếu (Reference) ghép vào video.
            </p>
            <div className="form-group">
              <label>File Ảnh Chân Dung:</label>
              <div className="input-with-button">
                <input
                  type="text"
                  placeholder="Chọn file ảnh hoặc dán đường dẫn..."
                  value={imagePath}
                  onChange={(e) => setImagePath(e.target.value)}
                />
                <button className="secondary-btn" onClick={handlePickImage}>
                  <FolderOpen size={16} /> Chọn Ảnh...
                </button>
              </div>
            </div>
            <button className="primary-btn" onClick={handleStartRembg}>
              <ImageIcon size={16} /> Tách Nền Ngay
            </button>
          </div>
        )}

        {/* Tab 4: Templates (F6) */}
        {activeTab === "templates" && (
          <TemplateLibrary
            templates={templates}
            onApply={handleApplyTemplate}
            onSave={handleSaveTemplate}
            onDelete={handleDeleteTemplate}
          />
        )}

        {/* Tab 5: Settings */}
        {activeTab === "settings" && (
          <div className="panel-card">
            <h3>⚙️ Cài Đặt Hệ Thống & Thư Mục Đầu Ra</h3>
            <div className="form-group">
              <label>Thư Mục Lưu Kết Quả (Output Directory):</label>
              <div className="input-with-button">
                <input type="text" readOnly value={config.output_dir} />
                <button className="secondary-btn" onClick={handlePickOutputDir}>
                  <FolderOpen size={16} /> Đổi Thư Mục...
                </button>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label>Tỉ Lệ Mặc Định:</label>
                <select
                  value={config.default_ratio}
                  onChange={async (e) => {
                    const newCfg = { ...config, default_ratio: e.target.value };
                    setConfig(newCfg);
                    await api.saveSettings(newCfg);
                  }}
                >
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </div>

              <div className="form-group" style={{ flex: 1 }}>
                <label>Mô Hình Nhận Dạng Whisper (F9):</label>
                <select
                  value={config.whisper_model}
                  onChange={async (e) => {
                    const newCfg = { ...config, whisper_model: e.target.value };
                    setConfig(newCfg);
                    await api.saveSettings(newCfg);
                    addToast("info", `Đã chọn mô hình Whisper: ${e.target.value}`);
                  }}
                >
                  <option value="ggml-tiny">ggml-tiny (~75MB, Siêu nhanh, Tiết kiệm RAM)</option>
                  <option value="ggml-base">ggml-base (~142MB, Cân bằng tốc độ & độ chuẩn)</option>
                  <option value="ggml-medium">ggml-medium (~1.5GB, Độ chuẩn xác cao nhất)</option>
                </select>
              </div>
            </div>

            {/* F11: Muse.ai Chrome Profile & Session Management */}
            <div className="form-group" style={{ marginTop: "18px" }}>
              <label>Thư Mục Lưu Chrome Profile Muse.ai (F11 Runner Thật):</label>
              <div className="input-with-button">
                <input
                  type="text"
                  value={config.chrome_profile_dir}
                  onChange={async (e) => {
                    const newCfg = { ...config, chrome_profile_dir: e.target.value };
                    setConfig(newCfg);
                    await api.saveSettings(newCfg);
                  }}
                />
                <button
                  className="secondary-btn"
                  onClick={async () => {
                    const dir = await api.pickDirectory();
                    if (dir) {
                      const newCfg = { ...config, chrome_profile_dir: dir };
                      setConfig(newCfg);
                      await api.saveSettings(newCfg);
                      addToast("success", "Đã cập nhật thư mục Chrome profile!");
                    }
                  }}
                >
                  <FolderOpen size={16} /> Chọn Folder...
                </button>
              </div>
            </div>

            <div className="session-status-box" style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
              <button
                className="primary-btn sm-btn"
                disabled={sessionChecking}
                onClick={async () => {
                  setSessionChecking(true);
                  try {
                    addToast("info", "Đang mở Chrome kiểm tra phiên đăng nhập Muse.ai...");
                    const res = await api.checkMuseSession();
                    setSessionStatus(res);
                    if (res.ok) {
                      addToast("success", res.message);
                    } else {
                      addToast("error", res.message);
                    }
                  } catch (e) {
                    addToast("error", `Lỗi kiểm tra session: ${e}`);
                  } finally {
                    setSessionChecking(false);
                  }
                }}
              >
                <RotateCw size={14} className={sessionChecking ? "spin-icon" : ""} />
                {sessionChecking ? "Đang Kiểm Tra..." : "Kiểm Tra Phiên Đăng Nhập Muse.ai"}
              </button>

              {sessionStatus && (
                <span className={`status-badge status-${sessionStatus.ok ? "success" : "failed"}`}>
                  {sessionStatus.message}
                </span>
              )}
            </div>

            {/* F13: Thư viện Nhạc Nền Tự Động */}
            <div className="form-group" style={{ marginTop: "24px", paddingTop: "18px", borderTop: "1px dashed var(--border-color)" }}>
              <label>🎵 Thư Mục Nhạc Nền Tự Động (F13 - Auto Background Music):</label>
              <p className="panel-desc" style={{ marginBottom: "8px" }}>
                Khi Render ghép video (F12), hệ thống sẽ tự động chọn ngẫu nhiên 1 bản nhạc từ thư mục này và hòa trộn (amix) làm nền video.
              </p>
              <div className="input-with-button">
                <input
                  type="text"
                  placeholder="Chưa chọn thư mục nhạc nền (bấm Chọn Folder...)"
                  value={config.music_dir || ""}
                  onChange={async (e) => {
                    const newCfg = { ...config, music_dir: e.target.value.trim() ? e.target.value : null };
                    setConfig(newCfg);
                    await api.saveSettings(newCfg);
                  }}
                />
                <button
                  className="secondary-btn"
                  onClick={async () => {
                    const dir = await api.pickDirectory();
                    if (dir) {
                      const newCfg = { ...config, music_dir: dir };
                      setConfig(newCfg);
                      await api.saveSettings(newCfg);
                      addToast("success", "Đã chọn thư mục nhạc nền!");
                    }
                  }}
                >
                  <FolderOpen size={16} /> Chọn Folder...
                </button>
                {config.music_dir && (
                  <button
                    className="danger-btn sm-btn"
                    onClick={async () => {
                      const newCfg = { ...config, music_dir: null };
                      setConfig(newCfg);
                      await api.saveSettings(newCfg);
                      addToast("info", "Đã bỏ chọn thư mục nhạc nền");
                    }}
                  >
                    Bỏ Chọn
                  </button>
                )}
              </div>
            </div>

            <div className="form-row" style={{ marginTop: "12px" }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Âm Lượng Nhạc Nền: {Math.round((config.music_volume || 0.15) * 100)}%</label>
                <input
                  type="range"
                  min="0.05"
                  max="0.5"
                  step="0.05"
                  value={config.music_volume || 0.15}
                  onChange={async (e) => {
                    const vol = parseFloat(e.target.value);
                    const newCfg = { ...config, music_volume: vol };
                    setConfig(newCfg);
                    await api.saveSettings(newCfg);
                  }}
                />
              </div>
            </div>

            {/* F14: Cấu hình số luồng song song Multi-Lane */}
            <div className="form-group" style={{ marginTop: "24px", paddingTop: "18px", borderTop: "1px dashed var(--border-color)" }}>
              <label>🚦 Cấu Hình Số Luồng Song Song (F14 Multi-Lane Runner):</label>
              <div className="form-row" style={{ marginTop: "8px" }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Số luồng Muse.ai (Tối đa song song):</label>
                  <select
                    value={config.max_parallel_muse}
                    onChange={async (e) => {
                      const val = parseInt(e.target.value, 10);
                      const newCfg = { ...config, max_parallel_muse: val };
                      setConfig(newCfg);
                      await api.saveSettings(newCfg);
                      addToast("info", `Đã lưu cấu hình Muse: ${val} luồng`);
                    }}
                  >
                    <option value={1}>1 luồng (Khuyên dùng - Tránh rate limit Chrome)</option>
                    <option value={2}>2 luồng song song</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Số luồng Local Offline (Whisper / Rembg):</label>
                  <select
                    value={config.max_parallel_local}
                    onChange={async (e) => {
                      const val = parseInt(e.target.value, 10);
                      const newCfg = { ...config, max_parallel_local: val };
                      setConfig(newCfg);
                      await api.saveSettings(newCfg);
                      addToast("info", `Đã lưu cấu hình Local: ${val} luồng`);
                    }}
                  >
                    <option value={1}>1 luồng</option>
                    <option value={2}>2 luồng song song (Tiết kiệm CPU)</option>
                    <option value={4}>4 luồng song song (Tối đa hiệu năng)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Task Queue Table */}
        <section className="queue-section">
          <div className="queue-header">
            <h3>
              <ListOrdered size={20} /> Bảng Hàng Đợi Tác Vụ (Realtime)
            </h3>
            <span className="task-count">{tasks.length} tác vụ</span>
          </div>

          {tasks.length === 0 ? (
            <div className="empty-box">Hàng đợi đang trống. Hãy thêm một tác vụ ở trên!</div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Loại</th>
                    <th>Chi Tiết / Prompt</th>
                    <th>Trạng Thái</th>
                    <th>Tiến Độ</th>
                    <th>Kết Quả / Lỗi</th>
                    <th>Thao Tác</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id}>
                      <td className="task-id">{t.id.slice(0, 8)}</td>
                      <td>
                        <span className="kind-tag">{t.kind}</span>
                      </td>
                      <td className="task-detail">
                        {editingTaskId === t.id ? (
                          <div className="inline-edit-box">
                            <input
                              type="text"
                              value={editingPromptText}
                              onChange={(e) => setEditingPromptText(e.target.value)}
                              className="inline-edit-input"
                            />
                            <button
                              className="icon-action-btn success-btn"
                              onClick={saveEditPrompt}
                              title="Lưu prompt"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              className="icon-action-btn"
                              onClick={() => setEditingTaskId(null)}
                              title="Hủy sửa"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <span title={t.prompt || t.input_path || ""}>
                            {t.prompt || t.input_path || "-"}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`status-badge status-${t.status}`}>
                          {t.status === "success" && <CheckCircle size={12} />}
                          {t.status === "running" && <Clock size={12} />}
                          {t.status === "failed" && <AlertCircle size={12} />}
                          {t.status === "cancelled" && <XCircle size={12} />}
                          {t.status}
                        </span>
                      </td>
                      <td>
                        <div className="progress-bar-container">
                          <div
                            className="progress-bar-fill"
                            style={{ width: `${t.progress}%` }}
                          />
                          <span className="progress-text">{t.progress}%</span>
                        </div>
                      </td>
                      <td className="task-output" title={t.output_path || t.error_msg || ""}>
                        {t.output_path || t.error_msg || "-"}
                      </td>
                      <td>
                        <div className="actions-cell">
                          {/* F1: Mở thư mục kết quả khi success */}
                          {t.status === "success" && (
                            <button
                              className="icon-action-btn primary-btn-light"
                              onClick={() => handleOpenFolder(t.id)}
                              title="Mở thư mục chứa kết quả"
                            >
                              <FolderOpen size={14} />
                            </button>
                          )}

                          {/* F4: Sửa prompt khi còn trong hàng đợi queued */}
                          {t.status === "queued" && editingTaskId !== t.id && (
                            <button
                              className="icon-action-btn"
                              onClick={() => startEditPrompt(t)}
                              title="Chỉnh sửa prompt"
                            >
                              <Edit2 size={14} />
                            </button>
                          )}

                          {/* F2: Retry khi task failed */}
                          {t.status === "failed" && (
                            <button
                              className="icon-action-btn warning-btn"
                              onClick={() => handleRetryTask(t.id)}
                              title="Thử lại tác vụ này"
                            >
                              <RotateCw size={14} />
                            </button>
                          )}

                          {/* F3: Nhân bản duplicate task */}
                          <button
                            className="icon-action-btn"
                            onClick={() => handleDuplicateTask(t.id)}
                            title="Nhân bản (Duplicate) tác vụ"
                          >
                            <Copy size={14} />
                          </button>

                          {/* Cancel khi running */}
                          {t.status === "running" && (
                            <button
                              className="cancel-btn"
                              onClick={() => api.cancelTask(t.id)}
                            >
                              Hủy
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
