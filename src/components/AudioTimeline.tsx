import React, { useState, useEffect } from "react";
import {
  api,
  AudioJobItem,
  AudioSegmentItem,
} from "../api";
import {
  Mic,
  FileText,
  Download,
  Send,
  Check,
  X,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Image as ImageIcon,
  Film,
  RotateCcw,
} from "lucide-react";

interface Props {
  onAddToast: (type: "success" | "error" | "info", msg: string) => void;
  onRefreshTasks: () => void;
}

export const AudioTimeline: React.FC<Props> = ({
  onAddToast,
  onRefreshTasks,
}) => {
  const [jobs, setJobs] = useState<AudioJobItem[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [segments, setSegments] = useState<AudioSegmentItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Editing state for segment text/prompt
  const [editingSegId, setEditingSegId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editPrompt, setEditPrompt] = useState("");

  const [rendering, setRendering] = useState(false);

  const loadJobs = async () => {
    try {
      const list = await api.listAudioJobs();
      setJobs(list);
      if (list.length > 0 && !selectedJobId) {
        setSelectedJobId(list[0].id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadSegments = async (jobId: string) => {
    setLoading(true);
    try {
      const segs = await api.listAudioSegments(jobId);
      setSegments(segs);
    } catch (e) {
      onAddToast("error", `Lỗi tải segments: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  useEffect(() => {
    if (selectedJobId) {
      loadSegments(selectedJobId);
    } else {
      setSegments([]);
    }
  }, [selectedJobId]);

  const formatMs = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const msRemainder = Math.floor((ms % 1000) / 100);
    return `${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}.${msRemainder}`;
  };

  const handleStartEdit = (seg: AudioSegmentItem) => {
    setEditingSegId(seg.id);
    setEditText(seg.text);
    setEditPrompt(seg.prompt || "");
  };

  const handleSaveEdit = async (segId: string) => {
    try {
      await api.updateAudioSegment(segId, {
        text: editText,
        prompt: editPrompt,
      });
      setSegments((prev) =>
        prev.map((s) =>
          s.id === segId ? { ...s, text: editText, prompt: editPrompt } : s
        )
      );
      setEditingSegId(null);
      onAddToast("success", "Đã cập nhật câu thoại và prompt!");
    } catch (e) {
      onAddToast("error", `Lỗi cập nhật: ${e}`);
    }
  };

  const handlePickRefImage = async (segId: string) => {
    const file = await api.pickFile([
      { name: "Image Files", extensions: ["png", "jpg", "jpeg", "webp"] },
    ]);
    if (file) {
      try {
        await api.updateAudioSegment(segId, { refImagePath: file });
        setSegments((prev) =>
          prev.map((s) => (s.id === segId ? { ...s, ref_image_path: file } : s))
        );
        onAddToast("success", "Đã gắn ảnh người mẫu tham chiếu!");
      } catch (e) {
        onAddToast("error", `Lỗi gán ảnh: ${e}`);
      }
    }
  };

  const handleToggleApproval = async (
    segId: string,
    current: "approved" | "rejected" | null,
    target: "approved" | "rejected"
  ) => {
    const nextVal = current === target ? null : target;
    try {
      await api.updateAudioSegment(segId, { approval: nextVal });
      setSegments((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, approval: nextVal } : s))
      );
    } catch (e) {
      onAddToast("error", `Lỗi đổi trạng thái duyệt: ${e}`);
    }
  };

  const handlePushToQueue = async (segId: string) => {
    if (!selectedJobId) return;
    try {
      await api.addSegmentToQueue(selectedJobId, segId);
      onAddToast("success", "Đã đẩy đoạn video này vào hàng đợi Muse.ai!");
      onRefreshTasks();
      loadSegments(selectedJobId);
    } catch (e) {
      onAddToast("error", `Lỗi đẩy vào queue: ${e}`);
    }
  };

  // F15: Chạy lại Muse.ai cho 1 segment cụ thể
  const handleRegenerate = async (segId: string) => {
    if (!selectedJobId) return;
    try {
      await api.regenerateSegment(selectedJobId, segId);
      onAddToast("info", "Đã đưa đoạn video vào hàng đợi để tạo lại (Regenerate)!");
      onRefreshTasks();
      loadSegments(selectedJobId);
    } catch (e) {
      onAddToast("error", `Lỗi tạo lại video: ${e}`);
    }
  };

  const handleExport = async (format: "srt" | "txt") => {
    if (!selectedJobId) return;
    try {
      const outPath = await api.exportScript(selectedJobId, format);
      onAddToast("success", `Đã xuất file ${format.toUpperCase()}: ${outPath}`);
    } catch (e) {
      onAddToast("error", `Lỗi xuất file: ${e}`);
    }
  };

  const handleRenderFullVideo = async () => {
    if (!selectedJobId) return;
    setRendering(true);
    try {
      onAddToast("info", "Đang tiến hành ghép các đoạn video + âm thanh gốc với FFmpeg...");
      const finalFile = await api.renderAudioJob(selectedJobId);
      onAddToast("success", `✅ Ghép video hoàn tất: ${finalFile}`);
      loadJobs();
      if (selectedJobId) loadSegments(selectedJobId);
    } catch (e) {
      onAddToast("error", `Lỗi ghép video: ${e}`);
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="panel-card audio-timeline-card">
      <div className="timeline-top-bar">
        <div className="job-selector-group">
          <label>
            <Mic size={16} /> Chọn File Audio Đã Phân Tích:
          </label>
          <select
            value={selectedJobId || ""}
            onChange={(e) => setSelectedJobId(e.target.value)}
          >
            {jobs.length === 0 ? (
              <option value="">Chưa có dữ liệu bóc tách nào</option>
            ) : (
              jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.audio_path.split("\\").pop()} ({j.id.slice(0, 8)})
                </option>
              ))
            )}
          </select>
          <button
            className="icon-action-btn"
            onClick={loadJobs}
            title="Làm mới danh sách"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {selectedJobId && segments.length > 0 && (
          <div className="export-actions">
            <button
              className="primary-btn sm-btn"
              disabled={rendering}
              onClick={handleRenderFullVideo}
              title="Ghép các video segment hoàn thành thành 1 video duy nhất"
            >
              <Film size={14} /> {rendering ? "Đang Ghép..." : "Render Ghép Video (F12)"}
            </button>
            <button
              className="secondary-btn sm-btn"
              onClick={() => handleExport("srt")}
            >
              <Download size={14} /> Xuất Phụ Đề (.SRT)
            </button>
            <button
              className="secondary-btn sm-btn"
              onClick={() => handleExport("txt")}
            >
              <FileText size={14} /> Xuất Kịch Bản (.TXT)
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="empty-box">Đang tải timeline phân rã...</div>
      ) : segments.length === 0 ? (
        <div className="empty-box">
          {jobs.length === 0
            ? "Chưa có file audio nào được xử lý. Hãy qua tab 'Bóc Tách Audio' để bắt đầu!"
            : "Chưa có segment nào cho file này."}
        </div>
      ) : (
        <div className="table-wrapper timeline-table-wrapper">
          <table>
            <thead>
              <tr>
                <th style={{ width: "50px" }}>#</th>
                <th style={{ width: "130px" }}>Thời Gian</th>
                <th>Lời Thoại (Speech Transcript)</th>
                <th>Prompt Tạo Video</th>
                <th style={{ width: "120px" }}>Ảnh Mẫu</th>
                <th style={{ width: "110px" }}>Video Segment</th>
                <th style={{ width: "90px" }}>Duyệt</th>
                <th style={{ width: "110px" }}>Hàng Đợi</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((seg) => (
                <tr key={seg.id} className={`seg-row approval-${seg.approval || "none"}`}>
                  <td className="task-id">{seg.seq + 1}</td>
                  <td className="time-badge">
                    {formatMs(seg.start_ms)} → {formatMs(seg.end_ms)}
                  </td>
                  <td>
                    {editingSegId === seg.id ? (
                      <textarea
                        rows={2}
                        className="inline-edit-input"
                        style={{ width: "100%" }}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                      />
                    ) : (
                      <div className="seg-text" onClick={() => handleStartEdit(seg)}>
                        {seg.text}
                      </div>
                    )}
                  </td>
                  <td>
                    {editingSegId === seg.id ? (
                      <div className="inline-edit-box">
                        <input
                          type="text"
                          placeholder="Nhập prompt video AI..."
                          value={editPrompt}
                          onChange={(e) => setEditPrompt(e.target.value)}
                          className="inline-edit-input"
                          style={{ width: "100%" }}
                        />
                        <button
                          className="icon-action-btn success-btn"
                          onClick={() => handleSaveEdit(seg.id)}
                          title="Lưu"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          className="icon-action-btn"
                          onClick={() => setEditingSegId(null)}
                          title="Hủy"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div
                        className="seg-prompt text-muted"
                        onClick={() => handleStartEdit(seg)}
                        title="Bấm để chỉnh sửa prompt"
                      >
                        {seg.prompt || (
                          <span style={{ fontStyle: "italic", opacity: 0.6 }}>
                            (Mặc định dùng lời thoại hoặc bấm để sửa...)
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="ref-image-cell">
                      {seg.ref_image_path ? (
                        <span
                          className="ref-path-tag"
                          title={seg.ref_image_path}
                          onClick={() => handlePickRefImage(seg.id)}
                        >
                          📷 {seg.ref_image_path.split("\\").pop()}
                        </span>
                      ) : (
                        <button
                          className="icon-action-btn"
                          onClick={() => handlePickRefImage(seg.id)}
                          title="Chọn ảnh người mẫu tham chiếu"
                        >
                          <ImageIcon size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    {seg.output_video_path ? (
                      <span
                        className="ref-path-tag video-tag"
                        title={seg.output_video_path}
                      >
                        🎬 {seg.output_video_path.split("\\").pop()}
                      </span>
                    ) : seg.queue_task_id ? (
                      <span className="ratio-tag" style={{ background: "#fef9c3", color: "#a16207" }}>
                        ⏳ Đang xử lý
                      </span>
                    ) : (
                      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>-</span>
                    )}
                  </td>
                  <td>
                    <div className="actions-cell">
                      <button
                        className={`icon-action-btn ${
                          seg.approval === "approved" ? "success-btn" : ""
                        }`}
                        onClick={() =>
                          handleToggleApproval(seg.id, seg.approval, "approved")
                        }
                        title="Duyệt đoạn này"
                      >
                        <ThumbsUp size={13} />
                      </button>
                      <button
                        className={`icon-action-btn ${
                          seg.approval === "rejected" ? "danger-btn" : ""
                        }`}
                        onClick={() =>
                          handleToggleApproval(seg.id, seg.approval, "rejected")
                        }
                        title="Bỏ qua đoạn này"
                      >
                        <ThumbsDown size={13} />
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="actions-cell">
                      {seg.output_video_path ? (
                        <button
                          className="secondary-btn sm-btn"
                          onClick={() => handleRegenerate(seg.id)}
                          title="Tạo lại video đoạn này bằng Muse.ai (Regenerate)"
                        >
                          <RotateCcw size={12} /> Tạo Lại (F15)
                        </button>
                      ) : (
                        <button
                          className="primary-btn sm-btn"
                          onClick={() => handlePushToQueue(seg.id)}
                          title="Gửi đoạn này sang Queue Muse.ai"
                        >
                          <Send size={12} /> Tạo Video
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
    </div>
  );
};
