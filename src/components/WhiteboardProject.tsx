import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  WhiteboardManifest,
  WhiteboardProblem,
  WhiteboardProjectV1 as Project,
  WhiteboardScene,
} from "../api";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Film, FolderOpen, Plus, Save, Trash2, XCircle } from "lucide-react";

const errText = (e: any): string => String(e?.message ?? e);
const isCancelled = (e: any): boolean => errText(e).startsWith("CANCELLED");
const baseName = (p?: string | null) => (p ? p.split(/[\\/]/).pop() || p : "(chưa chọn)");
const stem = (p: string) => p.replace(/\.[^/.\\]+$/, "");
const newProject = (): Project => ({
  schemaVersion: 1,
  id: `proj-${Date.now().toString(36)}`,
  name: "Dự án mới",
  fps: 30,
  paperColor: "#F5EBD7",
  hand: null,
  masterAudio: null,
  scenes: [],
});
const sceneId = (n: number) => `scene-${String(n).padStart(2, "0")}`;

const input: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: "8px",
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "var(--text-main)",
};

interface Props {
  /** Cảnh gợi ý từ bước phân tích SRT (nếu có) để tạo nhanh danh sách cảnh. */
  srtScenes?: { sceneIndex: number; sceneDurationMs: number; timelineStartMs: number }[];
}

export function WhiteboardProject({ srtScenes }: Props) {
  const [project, setProject] = useState<Project>(newProject);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [outputPath, setOutputPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null);
  const [problems, setProblems] = useState<{ errors: WhiteboardProblem[]; warnings: WhiteboardProblem[] } | null>(null);
  const [manifest, setManifest] = useState<WhiteboardManifest | null>(null);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let un: (() => void) | null = null;
    let disposed = false;
    listen<any>("whiteboard-progress", (ev) =>
      setProgress({ percent: Number(ev.payload?.percent) || 0, message: ev.payload?.message || "" })
    )
      .then((u) => (disposed ? u() : (un = u)))
      .catch(() => {});
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  const problemsByScene = useMemo(() => {
    const m = new Map<string, { errors: string[]; warnings: string[] }>();
    const get = (id: string | null) => {
      const k = id ?? "";
      if (!m.has(k)) m.set(k, { errors: [], warnings: [] });
      return m.get(k)!;
    };
    problems?.errors.forEach((p) => get(p.sceneId).errors.push(p.message));
    problems?.warnings.forEach((p) => get(p.sceneId).warnings.push(p.message));
    return m;
  }, [problems]);

  const update = (patch: Partial<Project>) => {
    setProject((p) => ({ ...p, ...patch }));
    setDirty(true);
    setProblems(null);
  };
  const updateScene = (i: number, patch: Partial<WhiteboardScene>) =>
    update({ scenes: project.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) });

  const confirmDiscard = () => !dirty || confirm("Dự án có thay đổi chưa lưu. Bỏ các thay đổi này?");

  const handleNew = () => {
    if (!confirmDiscard()) return;
    setProject(newProject());
    setProjectPath(null);
    setDirty(false);
    setProblems(null);
    setManifest(null);
    setStatus(null);
  };

  const handleOpen = async () => {
    if (!confirmDiscard()) return;
    try {
      const path = await api.pickFile([{ name: "Dự án Whiteboard", extensions: ["json"] }]);
      if (!path) return;
      const p = await api.loadWhiteboardProjectV1(path);
      setProject(p);
      setProjectPath(path);
      setDirty(false);
      setManifest(null);
      const v = await api.validateWhiteboardProjectV1(p).catch(() => null);
      setProblems(v);
      setStatus({ text: `Đã mở dự án: ${path}`, ok: true });
    } catch (e: any) {
      setStatus({ text: `Không mở được dự án: ${errText(e)}`, ok: false });
    }
  };

  const handleSave = async (asNew: boolean) => {
    try {
      let path = projectPath;
      if (asNew || !path) {
        path = await api.pickSaveFile(`${project.name || "du-an"}.wbproj.json`, [
          { name: "Dự án Whiteboard", extensions: ["json"] },
        ]);
        if (!path) return;
      }
      await api.saveWhiteboardProjectV1(path, project);
      setProjectPath(path);
      setDirty(false);
      setStatus({ text: `Đã lưu dự án: ${path}`, ok: true });
    } catch (e: any) {
      setStatus({ text: `Lỗi lưu dự án: ${errText(e)}`, ok: false });
    }
  };

  const addScene = () => {
    const n = project.scenes.length + 1;
    update({ scenes: [...project.scenes, { id: sceneId(n), imagePath: "", annotationPath: "", durationMs: 10000, audio: { mode: "auto" }, enabled: true }] });
  };

  const fromSrt = () => {
    if (!srtScenes?.length) return;
    if (project.scenes.length && !confirm("Thay danh sách cảnh hiện có bằng các cảnh từ SRT? (ảnh/annotation đã chọn cho cảnh trùng ID được giữ lại)")) return;
    const old = new Map(project.scenes.map((s) => [s.id, s]));
    update({
      scenes: srtScenes.map((s) => {
        const id = sceneId(s.sceneIndex);
        const prev = old.get(id);
        return {
          id,
          imagePath: prev?.imagePath ?? "",
          annotationPath: prev?.annotationPath ?? "",
          durationMs: s.sceneDurationMs,
          timelineStartMs: s.timelineStartMs,
          audio: prev?.audio ?? { mode: "auto" },
          enabled: true,
        };
      }),
    });
  };

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= project.scenes.length) return;
    const s = [...project.scenes];
    [s[i], s[j]] = [s[j], s[i]];
    update({ scenes: s });
  };

  const pickImage = async (i: number) => {
    const path = await api.pickFile([{ name: "Ảnh", extensions: ["png", "jpg", "jpeg"] }]);
    if (!path) return;
    const cur = project.scenes[i];
    updateScene(i, { imagePath: path, annotationPath: cur.annotationPath || stem(path) + ".annotation.json" });
  };
  const pickAnnotation = async (i: number) => {
    const path = await api.pickFile([{ name: "Annotation", extensions: ["json"] }]);
    if (path) updateScene(i, { annotationPath: path });
  };
  const pickSceneAudio = async (i: number) => {
    const path = await api.pickFile([{ name: "Audio", extensions: ["wav", "mp3", "m4a", "aac", "flac", "ogg"] }]);
    if (path) updateScene(i, { audio: { mode: "file", path } });
  };
  const pickMaster = async () => {
    const path = await api.pickFile([{ name: "Audio", extensions: ["wav", "mp3", "m4a", "aac", "flac", "ogg"] }]);
    if (path) update({ masterAudio: { path } });
  };
  const pickOutput = async () => {
    const path = await api.pickSaveFile(outputPath || `${project.name || "video"}.mp4`, [{ name: "MP4", extensions: ["mp4"] }]);
    if (path) setOutputPath(path);
  };

  const check = async (ids?: string[]) => {
    const v = await api.validateWhiteboardProjectV1(project, ids);
    setProblems(v);
    return v;
  };

  const handleCheck = async () => {
    setBusy(true);
    try {
      const v = await check();
      setStatus(
        v.errors.length
          ? { text: `Có ${v.errors.length} lỗi cần sửa trước khi xuất.`, ok: false }
          : { text: v.warnings.length ? `Hợp lệ, ${v.warnings.length} cảnh báo.` : "Dự án hợp lệ.", ok: true }
      );
    } catch (e: any) {
      setStatus({ text: `Lỗi kiểm tra: ${errText(e)}`, ok: false });
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async (ids?: string[]) => {
    if (!outputPath) {
      setStatus({ text: "Hãy chọn nơi lưu file MP4 đầu ra.", ok: false });
      return;
    }
    setBusy(true);
    setManifest(null);
    setStatus(null);
    setProgress({ percent: 0, message: "Kiểm tra dự án" });
    try {
      const v = await check(ids);
      if (v.errors.length) {
        setStatus({ text: `Có ${v.errors.length} lỗi cần sửa trước khi xuất.`, ok: false });
        return;
      }
      const m = await api.exportWhiteboardProjectV1(project, outputPath, ids);
      setManifest(m);
      setStatus({ text: `Đã xuất ${(m.totalDurationMs / 1000).toFixed(1)}s${m.hasAudio ? " (có audio)" : ""}: ${m.output}`, ok: true });
    } catch (e: any) {
      setStatus({
        text: isCancelled(e)
          ? "Đã hủy xuất. Các cảnh đã render xong được giữ lại để lần sau chạy nhanh hơn."
          : `Lỗi xuất dự án: ${errText(e)}`,
        ok: false,
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const totalMs = project.scenes.filter((s) => s.enabled !== false).reduce((a, s) => a + (Number(s.durationMs) || 0), 0);

  return (
    <div className="panel-card" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
        <div>
          <h3 style={{ margin: 0 }}>Dự án nhiều cảnh{dirty ? " •" : ""}</h3>
          <p className="panel-desc" style={{ margin: 0 }}>
            Ghép nhiều cảnh thành một video, có audio toàn bài hoặc audio riêng từng cảnh. {projectPath ? baseName(projectPath) : "Chưa lưu"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button className="secondary-btn" onClick={handleNew} disabled={busy}>Mới</button>
          <button className="secondary-btn" onClick={handleOpen} disabled={busy} style={{ display: "flex", alignItems: "center", gap: "4px" }}><FolderOpen size={14} /> Mở</button>
          <button className="secondary-btn" onClick={() => handleSave(false)} disabled={busy} style={{ display: "flex", alignItems: "center", gap: "4px" }}><Save size={14} /> Lưu</button>
          <button className="secondary-btn" onClick={() => handleSave(true)} disabled={busy}>Lưu thành…</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "10px" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.85rem" }}>
          Tên dự án
          <input style={input} value={project.name} onChange={(e) => update({ name: e.target.value })} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.85rem" }}>
          FPS
          <input style={input} type="number" min={1} max={120} value={project.fps} onChange={(e) => update({ fps: Number(e.target.value) })} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.85rem" }}>
          Màu giấy
          <input style={input} value={project.paperColor} onChange={(e) => update({ paperColor: e.target.value })} />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem" }}>
        <span style={{ minWidth: "110px" }}>Audio toàn bài:</span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{baseName(project.masterAudio?.path)}</span>
        <button className="secondary-btn" onClick={pickMaster} disabled={busy}>Chọn…</button>
        {project.masterAudio && <button className="secondary-btn" onClick={() => update({ masterAudio: null })} disabled={busy}>Bỏ</button>}
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <button className="secondary-btn" onClick={addScene} disabled={busy} style={{ display: "flex", alignItems: "center", gap: "4px" }}><Plus size={14} /> Thêm cảnh</button>
        <button className="secondary-btn" onClick={fromSrt} disabled={busy || !srtScenes?.length} title={srtScenes?.length ? "" : "Hãy phân tích SRT ở phần trên trước"}>
          Tạo cảnh từ SRT ({srtScenes?.length ?? 0})
        </button>
        <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>{project.scenes.length} cảnh · tổng {(totalMs / 1000).toFixed(1)}s</span>
      </div>

      {project.scenes.map((s, i) => {
        const pr = problemsByScene.get(s.id);
        return (
          <div key={i} style={{ border: `1px solid ${pr?.errors.length ? "#ef4444" : "#e2e8f0"}`, borderRadius: "10px", padding: "10px", opacity: s.enabled === false ? 0.55 : 1, display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <input type="checkbox" checked={s.enabled !== false} onChange={(e) => updateScene(i, { enabled: e.target.checked })} title="Đưa vào bản xuất" />
              <input style={{ ...input, width: "110px" }} value={s.id} onChange={(e) => updateScene(i, { id: e.target.value })} />
              <label style={{ fontSize: "0.85rem" }}>
                Thời lượng (ms){" "}
                <input style={{ ...input, width: "100px" }} type="number" min={1} value={s.durationMs} onChange={(e) => updateScene(i, { durationMs: Number(e.target.value) })} />
              </label>
              <label style={{ fontSize: "0.85rem" }}>
                Âm thanh{" "}
                <select style={input} value={s.audio?.mode ?? "auto"} onChange={(e) => updateScene(i, { audio: { mode: e.target.value as any, path: s.audio?.path } })}>
                  <option value="auto">Tự động (theo audio toàn bài)</option>
                  <option value="none">Im lặng</option>
                  <option value="file">Audio riêng</option>
                </select>
              </label>
              {s.audio?.mode === "file" && (
                <button className="secondary-btn" onClick={() => pickSceneAudio(i)}>{baseName(s.audio?.path)}</button>
              )}
              <span style={{ flex: 1 }} />
              <button className="secondary-btn" onClick={() => move(i, -1)} disabled={i === 0} title="Lên"><ChevronUp size={14} /></button>
              <button className="secondary-btn" onClick={() => move(i, 1)} disabled={i === project.scenes.length - 1} title="Xuống"><ChevronDown size={14} /></button>
              <button className="secondary-btn" onClick={() => handleExport([s.id])} disabled={busy || !outputPath} title="Xuất riêng cảnh này ra file đầu ra">Xuất riêng</button>
              <button className="secondary-btn" onClick={() => { if (confirm(`Xóa cảnh ${s.id}?`)) update({ scenes: project.scenes.filter((_, k) => k !== i) }); }} disabled={busy} title="Xóa cảnh"><Trash2 size={14} /></button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem", flexWrap: "wrap" }}>
              <button className="secondary-btn" onClick={() => pickImage(i)}>Ảnh: {baseName(s.imagePath)}</button>
              <button className="secondary-btn" onClick={() => pickAnnotation(i)}>Annotation: {baseName(s.annotationPath)}</button>
            </div>
            {pr?.errors.map((m, k) => (
              <div key={"e" + k} style={{ color: "#dc2626", fontSize: "0.8rem", display: "flex", gap: "6px", alignItems: "flex-start" }}><AlertCircle size={14} style={{ flexShrink: 0, marginTop: "2px" }} />{m}</div>
            ))}
            {pr?.warnings.map((m, k) => (
              <div key={"w" + k} style={{ color: "#b45309", fontSize: "0.8rem" }}>⚠ {m}</div>
            ))}
          </div>
        );
      })}

      {problemsByScene.get("") && (
        <div style={{ fontSize: "0.85rem" }}>
          {problemsByScene.get("")!.errors.map((m, k) => (
            <div key={"pe" + k} style={{ color: "#dc2626" }}>✖ {m}</div>
          ))}
          {problemsByScene.get("")!.warnings.map((m, k) => (
            <div key={"pw" + k} style={{ color: "#b45309" }}>⚠ {m}</div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem" }}>
        <span style={{ minWidth: "110px" }}>File xuất MP4:</span>
        <input style={{ ...input, flex: 1 }} value={outputPath} onChange={(e) => setOutputPath(e.target.value)} placeholder="Đường dẫn video đầu ra..." />
        <button className="secondary-btn" onClick={pickOutput} disabled={busy}>Chọn…</button>
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <button className="secondary-btn" onClick={handleCheck} disabled={busy || !project.scenes.length}>Kiểm tra dự án</button>
        <button
          className="primary-btn"
          onClick={() => handleExport()}
          disabled={busy || !project.scenes.length || !outputPath}
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
        >
          <Film size={14} /> Xuất toàn bộ dự án
        </button>
      </div>

      {busy && progress && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ flex: 1, height: "8px", borderRadius: "4px", background: "#e2e8f0", overflow: "hidden" }}>
            <div style={{ width: `${progress.percent}%`, height: "100%", background: "#3b82f6", transition: "width 0.2s" }} />
          </div>
          <span style={{ fontSize: "0.8rem", minWidth: "260px" }}>{progress.percent.toFixed(0)}% · {progress.message}</span>
          <button className="secondary-btn" onClick={() => api.cancelWhiteboard().catch(() => {})} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <XCircle size={14} /> Hủy
          </button>
        </div>
      )}

      {status && (
        <div style={{ display: "flex", gap: "6px", alignItems: "flex-start", color: status.ok ? "#16a34a" : "#dc2626", fontSize: "0.9rem" }}>
          {status.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span style={{ wordBreak: "break-word" }}>{status.text}</span>
        </div>
      )}

      {manifest && manifest.warnings.length > 0 && (
        <div style={{ fontSize: "0.8rem", color: "#b45309" }}>
          {manifest.warnings.map((w, k) => <div key={k}>⚠ {w}</div>)}
        </div>
      )}
    </div>
  );
}
