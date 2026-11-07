import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import {
  PenTool,
  FileText,
  Layers,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Film,
  Sparkles,
  RefreshCw,
  XCircle,
  Download,
} from "lucide-react";

const errText = (e: any): string => String(e?.message ?? e);
const isCancelled = (e: any): boolean => errText(e).startsWith("CANCELLED");

export function WhiteboardEditor() {
  const [srtPath, setSrtPath] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [annotationPath, setAnnotationPath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [fps, setFps] = useState(30);
  const [paperColor, setPaperColor] = useState("#F5EBD7");

  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const [srtData, setSrtData] = useState<{
    cues: any[];
    scenes: any[];
  } | null>(null);
  const [selectedScene, setSelectedScene] = useState(0);

  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null);
  const [env, setEnv] = useState<{ ok: boolean; missing: string[]; error?: string; ffmpeg?: string | null } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState("");

  const refreshEnv = async () => {
    try {
      setEnv(await api.checkWhiteboardEnv());
    } catch (e: any) {
      setEnv({ ok: false, missing: [], error: errText(e) });
    }
  };

  // Kiểm tra môi trường Python khi mở màn hình, và nghe sự kiện tiến độ/log từ backend.
  useEffect(() => {
    refreshEnv();
    const unlisten: Array<() => void> = [];
    let disposed = false;
    const on = async (event: string, handler: (payload: any) => void) => {
      try {
        const un = await listen<any>(event, (ev) => handler(ev.payload));
        if (disposed) un();
        else unlisten.push(un);
      } catch {
        /* chạy ngoài Tauri (trình duyệt dev): bỏ qua */
      }
    };
    on("whiteboard-progress", (p) => setProgress({ percent: Number(p?.percent) || 0, message: p?.message || "" }));
    on("whiteboard-install-log", (line) => setInstallLog(String(line)));
    return () => {
      disposed = true;
      unlisten.forEach((u) => u());
    };
  }, []);

  const handleInstallEnv = async () => {
    setInstalling(true);
    setInstallLog("");
    setStatusMsg(null);
    try {
      await api.installWhiteboardEnv();
      setStatusMsg({ text: "Đã cài xong môi trường Python cho Whiteboard.", ok: true });
    } catch (e: any) {
      setStatusMsg({ text: isCancelled(e) ? "Đã hủy cài đặt." : `Lỗi cài môi trường: ${errText(e)}`, ok: false });
    } finally {
      setInstalling(false);
      await refreshEnv();
    }
  };

  const handleCancel = async () => {
    try {
      await api.cancelWhiteboard();
    } catch {
      /* không có gì để hủy */
    }
  };

  const handlePickSrt = async () => {
    try {
      const path = await api.pickFile([
        { name: "SRT Subtitle", extensions: ["srt"] },
      ]);
      if (path) {
        setSrtPath(path);
        setStatusMsg({ text: `Đã chọn tệp SRT: ${path}`, ok: true });
      }
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi chọn file: ${e.message || e}`, ok: false });
    }
  };

  const handlePickImage = async () => {
    try {
      const path = await api.pickFile([
        { name: "Image", extensions: ["png", "jpg", "jpeg"] },
      ]);
      if (path) {
        setImagePath(path);
        if (!annotationPath) {
          const autoAnno = path.replace(/\.[^/.]+$/, "") + ".annotation.json";
          setAnnotationPath(autoAnno);
        }
        if (!outputPath) {
          const autoOut = path.replace(/\.[^/.]+$/, "") + "-whiteboard.mp4";
          setOutputPath(autoOut);
        }
        setStatusMsg({ text: `Đã chọn ảnh minh họa: ${path}`, ok: true });
      }
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi chọn file: ${e.message || e}`, ok: false });
    }
  };

  const handlePickAnnotation = async () => {
    try {
      const path = await api.pickFile([
        { name: "Annotation JSON", extensions: ["json"] },
      ]);
      if (path) {
        setAnnotationPath(path);
        setStatusMsg({ text: `Đã chọn annotation: ${path}`, ok: true });
      }
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi chọn file: ${e.message || e}`, ok: false });
    }
  };

  const handleParseSrt = async () => {
    if (!srtPath) {
      setStatusMsg({ text: "Vui lòng chọn tệp SRT trước.", ok: false });
      return;
    }
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await api.parseWhiteboardSrt(srtPath);
      setSrtData(res);
      setSelectedScene(0);
      setStatusMsg({
        text: `Đã phân tích thành công ${res.cues.length} câu thoại, gợi ý ${res.scenes.length} phân cảnh!`,
        ok: true,
      });
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi phân tích SRT: ${e.message || e}`, ok: false });
    } finally {
      setLoading(false);
    }
  };

  const handleAutoAnnotation = async () => {
    if (!imagePath) {
      setStatusMsg({ text: "Vui lòng chọn ảnh minh họa trước.", ok: false });
      return;
    }
    // Ghi ra ô "annotation" đang nhập; nếu trống thì suy ra từ tên ảnh (giống handlePickImage).
    const targetPath = annotationPath || imagePath.replace(/\.[^/.]+$/, "") + ".annotation.json";

    // Cảnh đang chọn (mặc định cảnh đầu): dùng đúng thời lượng timeline và các câu phụ đề của cảnh đó,
    // với mốc thời gian tính từ đầu cảnh (0 = đầu cảnh).
    const scene = srtData?.scenes[selectedScene];
    const sceneId = `scene-${String((scene?.sceneIndex ?? 1)).padStart(2, "0")}`;
    const durationMs = scene?.sceneDurationMs ?? 8000;
    const base = scene?.timelineStartMs ?? 0;
    const sceneCues = scene
      ? srtData!.cues
          .filter((c: any) => c.index >= scene.cueRange[0] && c.index <= scene.cueRange[1])
          .map((c: any) => ({
            ...c,
            startMs: Math.max(0, c.startMs - base),
            endMs: Math.max(0, c.endMs - base),
          }))
      : [];
    const storyBasis = scene ? String(scene.text).slice(0, 300) : "Hoạt hình bảng trắng";

    setLoading(true);
    setStatusMsg(null);
    try {
      const generate = (overwrite: boolean) =>
        api.generateWhiteboardAnnotation(
          imagePath,
          sceneId,
          storyBasis,
          durationMs,
          sceneCues,
          targetPath,
          overwrite
        );
      let res;
      try {
        res = await generate(false);
      } catch (e: any) {
        // Runner từ chối ghi đè âm thầm annotation người dùng có thể đã chỉnh tay.
        if (!String(e?.message || e).includes("ANNOTATION_EXISTS")) throw e;
        if (!confirm(`Tệp annotation đã tồn tại:\n${targetPath}\n\nGhi đè bằng khung mẫu mới? Nội dung bạn đã chỉnh sẽ mất.`)) {
          setStatusMsg({ text: "Đã hủy: giữ nguyên annotation hiện có.", ok: false });
          return;
        }
        res = await generate(true);
      }
      const saved = res.savedTo || targetPath;
      setAnnotationPath(saved);
      setStatusMsg({
        text: `Đã sinh và lưu annotation cho ${sceneId} (${(durationMs / 1000).toFixed(1)}s, ${res.elements?.length || 0} vùng): ${saved}`,
        ok: true,
      });
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi sinh annotation: ${e.message || e}`, ok: false });
    } finally {
      setLoading(false);
    }
  };

  const handleRenderVideo = async () => {
    if (!imagePath || !outputPath) {
      setStatusMsg({
        text: "Vui lòng chỉ định ảnh đầu vào và đường dẫn xuất video.",
        ok: false,
      });
      return;
    }
    setLoading(true);
    setProgress({ percent: 0, message: "Đang khởi động..." });
    setStatusMsg(null);
    try {
      const res = await api.renderWhiteboardScene(
        imagePath,
        annotationPath,
        outputPath,
        fps,
        paperColor
      );
      setStatusMsg({
        text: `Render thành công video bảng trắng: ${res.output_path} (${(res.file_size / 1024 / 1024).toFixed(2)} MB)`,
        ok: true,
      });
    } catch (e: any) {
      setStatusMsg({
        text: isCancelled(e) ? "Đã hủy render." : `Lỗi render bảng trắng: ${errText(e)}`,
        ok: false,
      });
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  return (
    <div className="panel-card" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Tiêu đề & Giới thiệu */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <PenTool size={28} color="#e06c75" />
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Hoạt Hình Bảng Trắng Vẽ Tay (Whiteboard Explainer)</h3>
            <p className="panel-desc" style={{ margin: 0 }}>
              Biến phụ đề SRT thành video hoạt hình bảng trắng vẽ tay trên nền giấy be ấm (`#F5EBD7`), 100% Offline không tốn credit Cloud.
            </p>
          </div>
        </div>
      </div>

      {env && !env.ok && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "8px",
            backgroundColor: "#fffbeb",
            border: "1px solid #fde68a",
            color: "#92400e",
            fontSize: "13px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertCircle size={16} />
            <span>
              Môi trường Python cho Whiteboard chưa sẵn sàng
              {env.missing.length > 0 ? `: thiếu ${env.missing.join(", ")}` : ""}.
              {env.error ? ` ${env.error}` : ""}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              className="primary-btn"
              onClick={handleInstallEnv}
              disabled={installing || loading}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", fontSize: "12px" }}
            >
              {installing ? <RefreshCw size={14} className="spin" /> : <Download size={14} />} Cài môi trường tự động
            </button>
            {installing && (
              <button className="secondary-btn" onClick={handleCancel} style={{ padding: "6px 12px", fontSize: "12px" }}>
                Hủy
              </button>
            )}
            <span style={{ fontSize: "12px", opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {installLog}
            </span>
          </div>
        </div>
      )}

      {env?.ok && !env.ffmpeg && (
        <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          Lưu ý: không tìm thấy ffmpeg trong PATH; ghép nhiều cảnh (merge) có thể cần ffmpeg.
        </div>
      )}

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ flex: 1, height: "8px", borderRadius: "4px", background: "#e2e8f0", overflow: "hidden" }}>
            <div
              style={{
                width: `${progress ? progress.percent : 0}%`,
                height: "100%",
                background: "var(--primary)",
                transition: "width 0.2s",
              }}
            />
          </div>
          <span style={{ fontSize: "12px", color: "var(--text-muted)", minWidth: "170px" }}>
            {progress ? `${progress.percent.toFixed(0)}% · ${progress.message}` : "Đang xử lý..."}
          </span>
          <button className="secondary-btn" onClick={handleCancel} style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 8px", fontSize: "12px" }}>
            <XCircle size={14} /> Hủy
          </button>
        </div>
      )}

      {statusMsg && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "8px",
            backgroundColor: statusMsg.ok ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${statusMsg.ok ? "#bbf7d0" : "#fecaca"}`,
            color: statusMsg.ok ? "#166534" : "#991b1b",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "13px",
          }}
        >
          {statusMsg.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Grid điều khiển */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        {/* Cột 1: Phụ đề & Phân cảnh SRT */}
        <div style={{ backgroundColor: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <FileText size={18} color="var(--primary)" />
            <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>1. Phụ Đề & Phân Cảnh (SRT)</h4>
          </div>

          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            <input
              type="text"
              readOnly
              placeholder="Chọn tệp phụ đề .srt..."
              value={srtPath}
              style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#ffffff", color: "var(--text-main)" }}
            />
            <button className="secondary-btn" onClick={handlePickSrt} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <FolderOpen size={14} /> Chọn SRT
            </button>
          </div>

          <button
            className="primary-btn"
            onClick={handleParseSrt}
            disabled={!srtPath || loading}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
          >
            {loading ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />} Phân Tích Cảnh Theo SRT (25-35s)
          </button>

          {srtData && (
            <div style={{ marginTop: "14px", maxHeight: "240px", overflowY: "auto", fontSize: "13px", background: "#ffffff", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
              <div style={{ fontWeight: "600", marginBottom: "8px", color: "var(--text-main)" }}>
                Gợi ý {srtData.scenes.length} phân cảnh (bấm để chọn cảnh dùng cho "Tạo mẫu"):
              </div>
              {srtData.scenes.map((s: any, i: number) => (
                <div
                  key={s.sceneIndex}
                  onClick={() => setSelectedScene(i)}
                  style={{
                    padding: "6px 8px",
                    borderBottom: "1px solid #f1f5f9",
                    cursor: "pointer",
                    borderRadius: "6px",
                    background: i === selectedScene ? "#eff6ff" : "transparent",
                    transition: "background 0.15s ease",
                  }}
                >
                  <span style={{ fontWeight: 600, color: "var(--primary)" }}>Cảnh {s.sceneIndex}</span>{" "}
                  <span style={{ color: "var(--text-muted)" }}>
                    ({(s.timelineStartMs / 1000).toFixed(1)}–{(s.timelineEndMs / 1000).toFixed(1)}s, {(s.sceneDurationMs / 1000).toFixed(1)}s)
                  </span>
                  {s.belowMin && <span style={{ color: "#d97706", fontWeight: 500 }}> ⚠ ngắn</span>}
                  {s.aboveMax && <span style={{ color: "#d97706", fontWeight: 500 }}> ⚠ dài</span>}:{" "}
                  <span style={{ color: "var(--text-main)" }}>{s.text.slice(0, 45)}...</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cột 2: Cấu hình Render & Xuất Video */}
        <div style={{ backgroundColor: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <Layers size={18} color="#16a34a" />
            <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>2. Ảnh Line-Art & Cấu Hình Render</h4>
          </div>

          <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
            <input
              type="text"
              readOnly
              placeholder="Chọn ảnh minh họa 2D line-art (.png)..."
              value={imagePath}
              style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#ffffff", color: "var(--text-main)" }}
            />
            <button className="secondary-btn" onClick={handlePickImage} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <FolderOpen size={14} /> Chọn Ảnh
            </button>
          </div>

          <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
            <input
              type="text"
              placeholder="Đường dẫn annotation.json..."
              value={annotationPath}
              onChange={(e) => setAnnotationPath(e.target.value)}
              style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#ffffff", color: "var(--text-main)" }}
            />
            <button className="secondary-btn" onClick={handlePickAnnotation}>
              Chọn
            </button>
            <button className="secondary-btn" onClick={handleAutoAnnotation} title="Tự động tạo khung annotation.json">
              Tạo mẫu
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Màu nền giấy</label>
              <input
                type="text"
                value={paperColor}
                onChange={(e) => setPaperColor(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#ffffff", color: "var(--text-main)" }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>FPS</label>
              <input
                type="number"
                value={fps}
                onChange={(e) => setFps(parseInt(e.target.value) || 30)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#ffffff", color: "var(--text-main)" }}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: "14px" }}>
            <label>File xuất MP4</label>
            <input
              type="text"
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
              placeholder="Đường dẫn file video đầu ra..."
              style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#ffffff", color: "var(--text-main)" }}
            />
          </div>

          <button
            className="primary-btn"
            onClick={handleRenderVideo}
            disabled={!imagePath || !outputPath || loading}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
          >
            {loading ? <RefreshCw size={14} className="spin" /> : <Film size={14} />} Render Video Bảng Trắng (Ink → Color)
          </button>
        </div>
      </div>
    </div>
  );
}
