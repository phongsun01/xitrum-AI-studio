import { useState } from "react";
import { api, SubtitlePreset, SubtitleStyleConfig } from "../api";
import {
  Captions,
  FileVideo,
  FileText,
  FolderOpen,
  Sparkles,
  Play,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sliders,
} from "lucide-react";

export function SubtitleTool() {
  const [videoPath, setVideoPath] = useState("");
  const [srtPath, setSrtPath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [isPortrait, setIsPortrait] = useState(false);

  // Preset & Style options
  const [selectedPreset, setSelectedPreset] = useState<SubtitlePreset>("tiktok_neon");
  const [fontName, setFontName] = useState("Arial");
  const [fontSize, setFontSize] = useState<number>(24);
  const [primaryColor, setPrimaryColor] = useState("&H0000FFFF"); // Vàng chanh ASS
  const [borderStyle, setBorderStyle] = useState<number>(3); // 3: box, 1: outline
  const [marginV, setMarginV] = useState<number>(120);
  const [kineticHighlight, setKineticHighlight] = useState<boolean>(true); // Cinecode punch accents

  // Status & Progress
  const [loading, setLoading] = useState(false);
  const [extractingAudio, setExtractingAudio] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [resultVideo, setResultVideo] = useState<{ path: string; size: number } | null>(null);

  // Chọn file video
  const handlePickVideo = async () => {
    try {
      const file = await api.pickFile([
        { name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi"] },
      ]);
      if (file) {
        setVideoPath(file);
        // Tự động gợi ý file output
        const autoOut = file.replace(/\.[^/.]+$/, "") + "-subtitled.mp4";
        setOutputPath(autoOut);

        // Tự động kiểm tra nếu có file .srt cùng tên
        const candidateSrt = file.replace(/\.[^/.]+$/, "") + ".srt";
        const hasSrt = await api.checkFileExists(candidateSrt);
        if (hasSrt && !srtPath) {
          setSrtPath(candidateSrt);
        }
        setStatusMsg({ text: `Đã chọn video: ${file}`, ok: true });
      }
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi chọn video: ${e.message || e}`, ok: false });
    }
  };

  // Chọn file SRT
  const handlePickSrt = async () => {
    try {
      const file = await api.pickFile([
        { name: "Phụ đề SRT", extensions: ["srt"] },
      ]);
      if (file) {
        setSrtPath(file);
        setStatusMsg({ text: `Đã chọn phụ đề: ${file}`, ok: true });
      }
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi chọn phụ đề: ${e.message || e}`, ok: false });
    }
  };

  // Trích xuất audio nhanh để người dùng đưa vào tab Audio Timeline (Whisper)
  const handleExtractAudio = async () => {
    if (!videoPath) {
      setStatusMsg({ text: "Vui lòng chọn video đầu vào trước.", ok: false });
      return;
    }
    setExtractingAudio(true);
    setStatusMsg(null);
    try {
      const targetWav = videoPath.replace(/\.[^/.]+$/, "") + "-extracted.wav";
      await api.extractAudioForSubtitles(videoPath, targetWav);
      setStatusMsg({
        text: `Đã tách audio 16kHz thành công: ${targetWav}. Bạn có thể qua tab 'Bóc Tách Audio' để Whisper nhận dạng ra SRT!`,
        ok: true,
      });
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi tách audio: ${e.message || e}`, ok: false });
    } finally {
      setExtractingAudio(false);
    }
  };

  // Áp dụng Preset
  const handleSelectPreset = (preset: SubtitlePreset) => {
    setSelectedPreset(preset);
    if (preset === "tiktok_neon") {
      setFontSize(isPortrait ? 26 : 22);
      setPrimaryColor("&H0000FFFF"); // Vàng chanh
      setBorderStyle(3); // Hộp mờ tương phản
      setMarginV(isPortrait ? 120 : 30);
    } else if (preset === "classic_cinema") {
      setFontSize(isPortrait ? 22 : 20);
      setPrimaryColor("&H00FFFFFF"); // Trắng tinh
      setBorderStyle(1); // Viền đen bóng đổ
      setMarginV(isPortrait ? 90 : 25);
    } else if (preset === "notion_whiteboard") {
      setFontSize(isPortrait ? 22 : 20);
      setPrimaryColor("&H00222222"); // Đen xám than
      setBorderStyle(1);
      setMarginV(isPortrait ? 80 : 25);
    }
  };

  // Toggle khung hình dọc 9:16
  const handleTogglePortrait = (portrait: boolean) => {
    setIsPortrait(portrait);
    if (portrait) {
      setMarginV(120); // Safe-area tránh UI TikTok ở đáy
      if (fontSize < 24) setFontSize(26);
    } else {
      setMarginV(30);
      if (fontSize > 22) setFontSize(20);
    }
  };

  // Thực thi Hardsub
  const handleBurnSubtitles = async () => {
    if (!videoPath || !srtPath || !outputPath) {
      setStatusMsg({
        text: "Vui lòng chọn đầy đủ Video, File phụ đề (.srt) và vị trí xuất file.",
        ok: false,
      });
      return;
    }

    setLoading(true);
    setStatusMsg(null);
    setResultVideo(null);

    try {
      const customConfig: SubtitleStyleConfig = {
        font_name: fontName,
        font_size: fontSize,
        primary_color: primaryColor,
        outline_color: borderStyle === 3 ? "&H00000000" : (selectedPreset === "notion_whiteboard" ? "&H00FFFFFF" : "&H00000000"),
        border_style: borderStyle,
        outline_width: 2.0,
        shadow_depth: borderStyle === 1 ? 1.0 : 0.0,
        alignment: 2, // Canh giữa đáy
        margin_v: marginV,
      };

      const res = await api.burnVideoSubtitles(
        videoPath,
        srtPath,
        outputPath,
        selectedPreset,
        customConfig,
        isPortrait,
        kineticHighlight
      );

      setResultVideo({ path: res.output_path, size: res.file_size });
      setStatusMsg({
        text: `Đã in phụ đề thành công vào video: ${res.output_path} (${(res.file_size / 1024 / 1024).toFixed(2)} MB)`,
        ok: true,
      });
    } catch (e: any) {
      setStatusMsg({
        text: `Lỗi in phụ đề: ${e.message || e}`,
        ok: false,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ padding: "8px", borderRadius: "8px", background: "rgba(0, 229, 255, 0.1)" }}>
            <Captions size={28} color="#00e5ff" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.3rem" }}>Công Cụ In Phụ Đề (Hardsub Generator)</h2>
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.7 }}>
              Đóng dấu phụ đề chết lên video bằng FFmpeg, chuẩn Safe-Area TikTok/Reels, không lỗi font tiếng Việt, xử lý nhanh 1–2 giây.
            </p>
          </div>
        </div>
      </div>

      {statusMsg && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "6px",
            backgroundColor: statusMsg.ok ? "rgba(46, 204, 113, 0.15)" : "rgba(231, 76, 60, 0.15)",
            border: `1px solid ${statusMsg.ok ? "#2ecc71" : "#e74c3c"}`,
            color: statusMsg.ok ? "#2ecc71" : "#e74c3c",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "0.9rem",
          }}
        >
          {statusMsg.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Main Form: 2 cột */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "20px" }}>
        {/* Cột 1: Tệp đầu vào & Đầu ra */}
        <div style={{ backgroundColor: "rgba(255,255,255,0.03)", padding: "18px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", display: "flex", flexDirection: "column", gap: "14px" }}>
          <h3 style={{ margin: 0, fontSize: "1rem", display: "flex", alignItems: "center", gap: "8px" }}>
            <FileVideo size={18} color="#61afef" /> 1. Chọn Video & Phụ Đề
          </h3>

          {/* Chọn Video */}
          <div>
            <label style={{ fontSize: "0.8rem", opacity: 0.8, marginBottom: "4px", display: "block" }}>Video đầu vào:</label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                readOnly
                placeholder="Chọn file video (.mp4, .mov, .mkv)..."
                value={videoPath}
                style={{ flex: 1, padding: "8px 12px", borderRadius: "4px", border: "1px solid #444", background: "#222", color: "#fff" }}
              />
              <button className="secondary-btn" onClick={handlePickVideo} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <FolderOpen size={14} /> Chọn Video
              </button>
            </div>
          </div>

          {/* Chọn Phụ Đề */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <label style={{ fontSize: "0.8rem", opacity: 0.8 }}>File phụ đề (.srt):</label>
              {videoPath && !srtPath && (
                <button
                  onClick={handleExtractAudio}
                  disabled={extractingAudio}
                  style={{ background: "transparent", border: "none", color: "#00e5ff", cursor: "pointer", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "4px" }}
                >
                  {extractingAudio ? <RefreshCw size={12} className="spin" /> : <Sparkles size={12} />} Chưa có SRT? Bấm tách audio để Whisper nhận dạng
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                readOnly
                placeholder="Chọn file phụ đề .srt..."
                value={srtPath}
                style={{ flex: 1, padding: "8px 12px", borderRadius: "4px", border: "1px solid #444", background: "#222", color: "#fff" }}
              />
              <button className="secondary-btn" onClick={handlePickSrt} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <FileText size={14} /> Chọn SRT
              </button>
            </div>
          </div>

          {/* File xuất Video */}
          <div>
            <label style={{ fontSize: "0.8rem", opacity: 0.8, marginBottom: "4px", display: "block" }}>File video xuất ra:</label>
            <input
              type="text"
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
              placeholder="Đường dẫn video thành phẩm có phụ đề..."
              style={{ width: "100%", padding: "8px 12px", borderRadius: "4px", border: "1px solid #444", background: "#222", color: "#fff" }}
            />
          </div>

          {/* Tùy chọn Tỉ lệ video (Safe Area 9:16 vs 16:9) */}
          <div style={{ marginTop: "8px", padding: "10px", background: "rgba(0,0,0,0.2)", borderRadius: "6px" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: "bold", display: "block", marginBottom: "8px" }}>Khung hình & Vùng an toàn (Safe Area):</span>
            <div style={{ display: "flex", gap: "12px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "0.85rem" }}>
                <input
                  type="radio"
                  name="ratio"
                  checked={!isPortrait}
                  onChange={() => handleTogglePortrait(false)}
                />
                Ngang 16:9 (YouTube, Facebook)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "0.85rem" }}>
                <input
                  type="radio"
                  name="ratio"
                  checked={isPortrait}
                  onChange={() => handleTogglePortrait(true)}
                />
                Dọc 9:16 (TikTok, Reels, Shorts)
              </label>
            </div>
            {isPortrait && (
              <p style={{ margin: "6px 0 0 0", fontSize: "0.75rem", color: "#d19a66" }}>
                💡 Chế độ 9:16 tự động đẩy lề dưới lên cao (MarginV = 120px) để không bị che khuất bởi caption & các nút Like/Share của TikTok.
              </p>
            )}
          </div>
        </div>

        {/* Cột 2: Cấu hình Kiểu chữ & Preset */}
        <div style={{ backgroundColor: "rgba(255,255,255,0.03)", padding: "18px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", display: "flex", flexDirection: "column", gap: "14px" }}>
          <h3 style={{ margin: 0, fontSize: "1rem", display: "flex", alignItems: "center", gap: "8px" }}>
            <Sliders size={18} color="#98c379" /> 2. Tùy Chọn Kiểu Chữ Phụ Đề
          </h3>

          {/* 3 Preset Nhanh */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
            <button
              onClick={() => handleSelectPreset("tiktok_neon")}
              style={{
                padding: "8px 6px",
                borderRadius: "6px",
                border: selectedPreset === "tiktok_neon" ? "2px solid #00e5ff" : "1px solid #444",
                background: selectedPreset === "tiktok_neon" ? "rgba(0, 229, 255, 0.15)" : "#222",
                color: "#fff",
                cursor: "pointer",
                textAlign: "center",
                fontSize: "0.8rem",
              }}
            >
              <span style={{ color: "#ffff00", fontWeight: "bold" }}>TikTok Neon</span>
              <div style={{ fontSize: "0.7rem", opacity: 0.7 }}>Vàng hộp mờ</div>
            </button>

            <button
              onClick={() => handleSelectPreset("classic_cinema")}
              style={{
                padding: "8px 6px",
                borderRadius: "6px",
                border: selectedPreset === "classic_cinema" ? "2px solid #00e5ff" : "1px solid #444",
                background: selectedPreset === "classic_cinema" ? "rgba(0, 229, 255, 0.15)" : "#222",
                color: "#fff",
                cursor: "pointer",
                textAlign: "center",
                fontSize: "0.8rem",
              }}
            >
              <span style={{ color: "#ffffff", fontWeight: "bold" }}>Cinema Classic</span>
              <div style={{ fontSize: "0.7rem", opacity: 0.7 }}>Trắng viền đen</div>
            </button>

            <button
              onClick={() => handleSelectPreset("notion_whiteboard")}
              style={{
                padding: "8px 6px",
                borderRadius: "6px",
                border: selectedPreset === "notion_whiteboard" ? "2px solid #00e5ff" : "1px solid #444",
                background: selectedPreset === "notion_whiteboard" ? "rgba(0, 229, 255, 0.15)" : "#222",
                color: "#fff",
                cursor: "pointer",
                textAlign: "center",
                fontSize: "0.8rem",
              }}
            >
              <span style={{ color: "#aaaaaa", fontWeight: "bold" }}>Whiteboard</span>
              <div style={{ fontSize: "0.7rem", opacity: 0.7 }}>Đen viền trắng</div>
            </button>
          </div>

          {/* Chỉnh chi tiết style */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={{ fontSize: "0.75rem", opacity: 0.8 }}>Font chữ:</label>
              <input
                type="text"
                value={fontName}
                onChange={(e) => setFontName(e.target.value)}
                style={{ width: "100%", padding: "6px 8px", borderRadius: "4px", border: "1px solid #444", background: "#222", color: "#fff", fontSize: "0.85rem" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", opacity: 0.8 }}>Cỡ chữ (FontSize):</label>
              <input
                type="number"
                value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value) || 20)}
                style={{ width: "100%", padding: "6px 8px", borderRadius: "4px", border: "1px solid #444", background: "#222", color: "#fff", fontSize: "0.85rem" }}
              />
            </div>
          </div>

          {/* Cinecode Kinetic Accent Toggle */}
          <div style={{ padding: "10px 12px", background: "rgba(0, 229, 255, 0.08)", border: "1px solid rgba(0, 229, 255, 0.25)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: "600", color: "#00e5ff", display: "flex", alignItems: "center", gap: "6px" }}>
                <Sparkles size={14} /> Tô vàng từng từ (TikTok)
              </span>
              <span style={{ fontSize: "0.75rem", opacity: 0.75 }}>
                Cụm tối đa 4 từ; tô vàng lần lượt, nhấn nhẹ từ khóa. Nhịp từng từ ước lượng theo mốc câu SRT.
              </span>
            </div>
            <input
              type="checkbox"
              checked={kineticHighlight}
              onChange={(e) => setKineticHighlight(e.target.checked)}
              style={{ width: "18px", height: "18px", cursor: "pointer", accentColor: "#00e5ff" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={{ fontSize: "0.75rem", opacity: 0.8 }}>Dạng viền (BorderStyle):</label>
              <select
                value={borderStyle}
                onChange={(e) => setBorderStyle(parseInt(e.target.value) || 1)}
                style={{ width: "100%", padding: "6px 8px", borderRadius: "4px", border: "1px solid #444", background: "#222", color: "#fff", fontSize: "0.85rem" }}
              >
                <option value={3}>Hộp đen mờ (Opaque Box - Khuyên dùng)</option>
                <option value={1}>Viền nét mảnh (Outline)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", opacity: 0.8 }}>Khoảng cách đáy (MarginV):</label>
              <input
                type="number"
                value={marginV}
                onChange={(e) => setMarginV(parseInt(e.target.value) || 30)}
                style={{ width: "100%", padding: "6px 8px", borderRadius: "4px", border: "1px solid #444", background: "#222", color: "#fff", fontSize: "0.85rem" }}
              />
            </div>
          </div>

          {/* Nút hành động chính */}
          <button
            className="primary-btn"
            onClick={handleBurnSubtitles}
            disabled={!videoPath || !srtPath || !outputPath || loading}
            style={{ marginTop: "auto", padding: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontSize: "1rem", fontWeight: "bold" }}
          >
            {loading ? <RefreshCw size={18} className="spin" /> : <Play size={18} />}
            {loading ? "Đang in phụ đề lên video..." : "In Phụ Đề Lên Video (Burn Hardsub)"}
          </button>
        </div>
      </div>

      {/* Hiển thị kết quả hoàn tất */}
      {resultVideo && (
        <div style={{ background: "rgba(46, 204, 113, 0.1)", border: "1px solid #2ecc71", borderRadius: "8px", padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: "bold", color: "#2ecc71", marginBottom: "4px" }}>🎉 Xuất video có phụ đề thành công!</div>
            <div style={{ fontSize: "0.85rem", opacity: 0.8 }}>Đường dẫn: {resultVideo.path}</div>
          </div>
          <button
            className="secondary-btn"
            onClick={() => api.openOutputFolder(resultVideo.path)}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <FolderOpen size={16} /> Mở Thư Mục Chứa
          </button>
        </div>
      )}
    </div>
  );
}
