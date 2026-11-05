import { useState, useEffect } from "react";
import { api, TaskItem, AppConfig } from "./api";
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
} from "lucide-react";
import "./App.css";

function App() {
  const [activeTab, setActiveTab] = useState<"video" | "audio" | "rembg" | "settings">("video");
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [statusMsg, setStatusMsg] = useState("");

  // Form states
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoRatio, setVideoRatio] = useState("16:9");
  const [audioPath, setAudioPath] = useState("d:\\Antigravity\\REA\\project-docs\\poc-phase0\\jfk.wav");
  const [imagePath, setImagePath] = useState("d:\\Antigravity\\REA\project-docs\\poc-phase0\\poc_rembg\\input.png");

  // Settings
  const [config, setConfig] = useState<AppConfig>({
    output_dir: "D:\\XitrumAI_Outputs",
    default_ratio: "16:9",
    max_parallel_muse: 1,
    max_parallel_local: 2,
  });

  const loadData = async () => {
    try {
      const [taskList, cfg] = await Promise.all([api.listTasks(), api.getSettings()]);
      setTasks(taskList);
      if (cfg) setConfig(cfg);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(async () => {
      try {
        const taskList = await api.listTasks();
        setTasks(taskList);
      } catch (e) {
        console.error(e);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  const handleCreateVideo = async () => {
    if (!videoPrompt.trim()) return;
    try {
      setStatusMsg("Đang thêm tác vụ tạo Video vào hàng đợi...");
      await api.enqueueTask("muse_video", videoPrompt, videoRatio, null);
      setVideoPrompt("");
      setStatusMsg("✅ Đã thêm tác vụ tạo video thành công!");
      loadData();
    } catch (err) {
      setStatusMsg(`❌ Lỗi: ${err}`);
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
      setStatusMsg("Đang thêm tác vụ bóc tách audio vào hàng đợi Whisper...");
      await api.enqueueTask("whisper_stt", null, null, audioPath);
      setStatusMsg("✅ Đã bắt đầu bóc tách giọng nói!");
      loadData();
    } catch (err) {
      setStatusMsg(`❌ Lỗi: ${err}`);
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
      setStatusMsg("Đang thêm tác vụ tách nền ảnh...");
      await api.enqueueTask("rembg", null, null, imagePath);
      setStatusMsg("✅ Đã bắt đầu tách nền ảnh!");
      loadData();
    } catch (err) {
      setStatusMsg(`❌ Lỗi: ${err}`);
    }
  };

  const handlePickOutputDir = async () => {
    const dir = await api.pickDirectory();
    if (dir) {
      const newCfg = { ...config, output_dir: dir };
      setConfig(newCfg);
      await api.saveSettings(newCfg);
      setStatusMsg("✅ Đã cập nhật thư mục xuất file!");
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="logo-box">
          <div className="logo-badge">X</div>
          <h2>Xitrum AI</h2>
        </div>

        <nav className="nav-menu">
          <button
            className={`nav-item ${activeTab === "video" ? "active" : ""}`}
            onClick={() => setActiveTab("video")}
          >
            <Video size={18} /> Tạo Video Muse.ai
          </button>
          <button
            className={`nav-item ${activeTab === "audio" ? "active" : ""}`}
            onClick={() => setActiveTab("audio")}
          >
            <Mic size={18} /> Bóc Tách Audio (Whisper)
          </button>
          <button
            className={`nav-item ${activeTab === "rembg" ? "active" : ""}`}
            onClick={() => setActiveTab("rembg")}
          >
            <Scissors size={18} /> Tách Nền Ảnh (Rembg)
          </button>
          <button
            className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <Settings size={18} /> Cài Đặt Hệ Thống
          </button>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="top-bar">
          <div className="title-section">
            <h1>Xitrum AI Studio</h1>
            <span className="version-badge">Tauri v2 • Rust Core • Offline Engine</span>
          </div>
        </header>

        {statusMsg && <div className="status-banner">{statusMsg}</div>}

        {/* Tab 1: Video */}
        {activeTab === "video" && (
          <div className="panel-card">
            <h3>🎬 Hàng Đợi Sinh Video Tự Động (Muse.ai)</h3>
            <p className="panel-desc">
              Nhập nội dung kịch bản, hệ thống sẽ tự động điều khiển session Muse.ai và tải video hoàn chỉnh về máy.
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
              <div className="form-group" style={{ flex: 1 }}>
                <label>Tỉ lệ khung hình (Aspect Ratio):</label>
                <select value={videoRatio} onChange={(e) => setVideoRatio(e.target.value)}>
                  <option value="16:9">Ngang YouTube / TV (16:9)</option>
                  <option value="9:16">Dọc TikTok / Reels / Shorts (9:16)</option>
                  <option value="1:1">Vuông Instagram (1:1)</option>
                </select>
              </div>
              <button className="primary-btn" onClick={handleCreateVideo} style={{ alignSelf: "flex-end" }}>
                <Send size={16} /> Thêm Vào Hàng Đợi
              </button>
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

        {/* Tab 4: Settings */}
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
                    <th>Chi Tiết</th>
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
                      <td className="task-detail" title={t.prompt || t.input_path || ""}>
                        {t.prompt || t.input_path || "-"}
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
                        {t.status === "running" && (
                          <button
                            className="cancel-btn"
                            onClick={() => api.cancelTask(t.id)}
                          >
                            Hủy
                          </button>
                        )}
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
