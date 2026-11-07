import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import {
  WhiteboardProject,
  WhiteboardSceneItem,
  WhiteboardEnvCheck,
} from "../types/whiteboard";
import {
  PenTool,
  Layers,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Film,
  RefreshCw,
  XCircle,
  Download,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Save,
  Play,
  Mic,
  RotateCcw,
  Check,
  Volume2,
  VolumeX,
  Eye,
} from "lucide-react";

const errText = (e: any): string => String(e?.message ?? e);
const isCancelled = (e: any): boolean => errText(e).startsWith("CANCELLED");

export function WhiteboardEditor() {
  const [srtPath, setSrtPath] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [projectId, setProjectId] = useState(() => "project-" + Date.now());
  const [projectRevision, setProjectRevision] = useState(1);
  const [outputVideoPath, setOutputVideoPath] = useState("");
  const [masterAudioPath, setMasterAudioPath] = useState("");
  const [audioExists, setAudioExists] = useState(false);

  const [fps, setFps] = useState(30);
  const [paperColor, setPaperColor] = useState("#F5EBD7");
  const [penType, setPenType] = useState<"pen" | "calligraphy">("pen");

  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [previewModalImg, setPreviewModalImg] = useState<string | null>(null);

  // Danh sách các cảnh trong dự án
  const [scenes, setScenes] = useState<WhiteboardSceneItem[]>([]);
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);

  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null);
  const [env, setEnv] = useState<WhiteboardEnvCheck | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState("");

  // VieNeu-TTS Voice selection
  const [voices, setVoices] = useState<{ id: string; name: string; gender: string; region: string }[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("Thùy Dung");
  const [generatingTts, setGeneratingTts] = useState(false);
  const [ttsSuccess, setTtsSuccess] = useState(false);
  const [exactCues, setExactCues] = useState(true);

  // Modal xác nhận xuất video
  const [showAudioConfirmModal, setShowAudioConfirmModal] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [existingScenesCount, setExistingScenesCount] = useState(0);

  const activeScene = scenes[selectedSceneIndex] || null;

  const refreshEnv = async () => {
    try {
      setEnv(await api.checkWhiteboardEnv());
      const vList = await api.listTtsVoices();
      if (vList && vList.length > 0) {
        setVoices(vList);
      }
    } catch (e: any) {
      setEnv({ ok: false, missing: [], error: errText(e) });
    }
  };

  // Tự động kiểm tra file âm thanh master có thực sự tồn tại trên đĩa hay không
  useEffect(() => {
    let active = true;
    if (!masterAudioPath) {
      setAudioExists(false);
      return;
    }
    api.checkFileExists(masterAudioPath).then((exists) => {
      if (active) {
        setAudioExists(Boolean(exists));
      }
    }).catch(() => {
      if (active) setAudioExists(false);
    });
    return () => {
      active = false;
    };
  }, [masterAudioPath]);

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
        /* dev ngoài Tauri */
      }
    };
    on("whiteboard-progress", (p) =>
      setProgress({ percent: Number(p?.percent) || 0, message: p?.message || "" })
    );
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
      setStatusMsg({
        text: isCancelled(e) ? "Đã hủy cài đặt." : `Lỗi cài môi trường: ${errText(e)}`,
        ok: false,
      });
    } finally {
      setInstalling(false);
      await refreshEnv();
    }
  };

  const handleCancel = async () => {
    try {
      await api.cancelWhiteboard();
    } catch {
      /* ignore */
    }
  };

  const handlePickSrt = async () => {
    try {
      const path = await api.pickFile([{ name: "SRT Subtitle", extensions: ["srt"] }]);
      if (path) {
        setSrtPath(path);
        // Tự động kiểm tra file .wav hoặc .mp3 cùng tên có thực sự tồn tại không
        const defaultWav = path.replace(/\.[^/.]+$/, "") + ".wav";
        const defaultMp3 = path.replace(/\.[^/.]+$/, "") + ".mp3";
        if (!masterAudioPath) {
          const hasWav = await api.checkFileExists(defaultWav);
          if (hasWav) {
            setMasterAudioPath(defaultWav);
          } else {
            const hasMp3 = await api.checkFileExists(defaultMp3);
            if (hasMp3) {
              setMasterAudioPath(defaultMp3);
            }
          }
        }
        setStatusMsg({ text: `Đã chọn tệp SRT: ${path}`, ok: true });
      }
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi chọn file: ${errText(e)}`, ok: false });
    }
  };

  const handlePickMasterAudio = async () => {
    try {
      const path = await api.pickFile([{ name: "Audio Files", extensions: ["wav", "mp3", "aac", "m4a"] }]);
      if (path) {
        setMasterAudioPath(path);
        setStatusMsg({ text: `Đã chọn file âm thanh master: ${path}`, ok: true });
      }
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi chọn file âm thanh: ${errText(e)}`, ok: false });
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
      const res = await api.parseWhiteboardSrt(srtPath, exactCues);

      // Tự động khởi tạo danh sách cảnh từ SRT nếu dự án đang rỗng
      const initialScenes: WhiteboardSceneItem[] = res.scenes.map((s, idx) => ({
        id: `scene-${String(s.sceneIndex).padStart(2, "0")}`,
        order: idx + 1,
        revision: 1,
        imagePath: "",
        annotationPath: "",
        timelineStartMs: s.timelineStartMs,
        timelineEndMs: s.timelineEndMs,
        durationMs: s.sceneDurationMs,
        cues: res.cues.filter(
          (c) => c.index >= s.cueRange[0] && c.index <= s.cueRange[1]
        ),
        status: "idle",
      }));
      setScenes(initialScenes);
      setSelectedSceneIndex(0);

      setStatusMsg({
        text: `Đã phân tích ${res.cues.length} câu thoại, khởi tạo ${initialScenes.length} phân cảnh!`,
        ok: true,
      });
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi phân tích SRT: ${errText(e)}`, ok: false });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateSrtTts = async () => {
    if (!srtPath) {
      setStatusMsg({ text: "Vui lòng chọn tệp SRT trước khi tạo giọng đọc.", ok: false });
      return;
    }
    setGeneratingTts(true);
    setTtsSuccess(false);
    setStatusMsg(null);
    try {
      const res = await api.generateWhiteboardSrtTts(srtPath, selectedVoice);
      setMasterAudioPath(res.audio_path);
      setTtsSuccess(true);
      setStatusMsg({
        text: `Đã tạo giọng đọc VieNeu Master Audio (${res.duration_sec}s): ${res.audio_path}`,
        ok: true,
      });
    } catch (e: any) {
      setTtsSuccess(false);
      setStatusMsg({ text: `Lỗi tạo giọng đọc từ SRT: ${errText(e)}`, ok: false });
    } finally {
      setGeneratingTts(false);
    }
  };

  const handleReset = () => {
    setSrtPath("");
    setProjectPath("");
    setOutputVideoPath("");
    setMasterAudioPath("");
    setScenes([]);
    setSelectedSceneIndex(0);
    setStatusMsg({ text: "Đã làm mới bảng trắng về trạng thái ban đầu.", ok: true });
    setTtsSuccess(false);
    refreshEnv();
  };

  // Thao tác với danh sách cảnh
  const handleAddScene = () => {
    const nextNum = scenes.length + 1;
    const newScene: WhiteboardSceneItem = {
      id: `scene-${String(nextNum).padStart(2, "0")}`,
      order: nextNum,
      revision: 1,
      imagePath: "",
      annotationPath: "",
      timelineStartMs: 0,
      timelineEndMs: 10000,
      durationMs: 10000,
      cues: [],
      status: "idle",
    };
    setScenes([...scenes, newScene]);
    setSelectedSceneIndex(scenes.length);
  };

  const handleDeleteScene = (idx: number) => {
    if (scenes.length <= 1) {
      setStatusMsg({ text: "Dự án cần ít nhất 1 phân cảnh.", ok: false });
      return;
    }
    const next = scenes.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 }));
    setScenes(next);
    if (selectedSceneIndex >= next.length) {
      setSelectedSceneIndex(next.length - 1);
    }
  };

  const handleMoveScene = (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= scenes.length) return;
    const copy = [...scenes];
    const temp = copy[idx];
    copy[idx] = copy[targetIdx];
    copy[targetIdx] = temp;
    const reordered = copy.map((s, i) => ({ ...s, order: i + 1 }));
    setScenes(reordered);
    setSelectedSceneIndex(targetIdx);
  };

  const updateActiveScene = (patch: Partial<WhiteboardSceneItem>) => {
    if (!activeScene) return;
    const next = [...scenes];
    next[selectedSceneIndex] = {
      ...activeScene,
      ...patch,
      revision: activeScene.revision + 1,
    };
    setScenes(next);
  };

  const handlePickSceneImage = async () => {
    if (!activeScene) return;
    try {
      const path = await api.pickFile([{ name: "Image", extensions: ["png", "jpg", "jpeg"] }]);
      if (path) {
        const autoAnno = path.replace(/\.[^/.]+$/, "") + `.${activeScene.id}.annotation.json`;
        let patch: Partial<WhiteboardSceneItem> = { imagePath: path, annotationPath: autoAnno };

        // W3: Tự động phân tích style ảnh
        try {
          const analysis = await api.analyzeWhiteboardImage(path);
          if (analysis) {
            patch = {
              ...patch,
              imageType: analysis.imageType,
              inkPath: analysis.recommended.inkPath,
              colorFill: analysis.recommended.colorFill,
              inkWeight: analysis.recommended.inkWeight,
              colorWeight: analysis.recommended.colorWeight,
              analysisConfidence: analysis.confidence,
            };
          }
        } catch (e) {
          console.warn("Lỗi phân tích style ảnh:", e);
        }

        updateActiveScene(patch);
      }
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi chọn ảnh: ${errText(e)}`, ok: false });
    }
  };

  const handlePickSceneAnnotation = async () => {
    if (!activeScene) return;
    try {
      const path = await api.pickFile([{ name: "Annotation JSON", extensions: ["json"] }]);
      if (path) {
        updateActiveScene({ annotationPath: path });
      }
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi chọn annotation: ${errText(e)}`, ok: false });
    }
  };

  const handleAutoAnnotationCurrent = async () => {
    if (!activeScene || !activeScene.imagePath) {
      setStatusMsg({ text: "Vui lòng chọn ảnh minh họa cho cảnh này trước.", ok: false });
      return;
    }
    const targetPath =
      activeScene.annotationPath ||
      activeScene.imagePath.replace(/\.[^/.]+$/, "") + `.${activeScene.id}.annotation.json`;

    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await api.generateWhiteboardAnnotation(
        activeScene.imagePath,
        activeScene.id,
        "Hoạt hình phân cảnh",
        activeScene.durationMs,
        activeScene.cues,
        targetPath,
        true
      );
      updateActiveScene({
        annotationPath: res.savedTo || targetPath,
        elements: (res.elements as any) || undefined,
      });
      setStatusMsg({
        text: `Đã sinh annotation cho ${activeScene.id} (${(activeScene.durationMs / 1000).toFixed(1)}s, ${res.elements?.length || 0} vùng vẽ): ${res.savedTo || targetPath}`,
        ok: true,
      });
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi tạo mẫu annotation: ${errText(e)}`, ok: false });
    } finally {
      setLoading(false);
    }
  };

  // Xem trước các vùng vẽ của cảnh (R6 Preview)
  const handlePreviewScene = async () => {
    if (!activeScene || !activeScene.imagePath || !activeScene.annotationPath) {
      setStatusMsg({ text: "Cần chọn ảnh và tạo annotation trước khi xem trước vùng vẽ.", ok: false });
      return;
    }
    const previewOut = activeScene.imagePath.replace(/\.[^/.]+$/, "") + `.${activeScene.id}.preview.png`;
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await api.renderWhiteboardPreview(activeScene.imagePath, activeScene.annotationPath, previewOut);
      setPreviewModalImg(res.preview_path);
      setStatusMsg({ text: `Đã tạo ảnh xem trước vùng vẽ: ${res.preview_path}`, ok: true });
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi tạo ảnh xem trước: ${errText(e)}`, ok: false });
    } finally {
      setLoading(false);
    }
  };

  // R6: Chỉnh sửa trực quan các vùng vẽ (Elements Editor)
  const handleUpdateElementDirection = async (elIndex: number, newDirection: string) => {
    if (!activeScene || !activeScene.elements) return;
    const updatedElements = [...activeScene.elements];
    updatedElements[elIndex] = {
      ...updatedElements[elIndex],
      reveal: {
        ...updatedElements[elIndex].reveal,
        direction: newDirection,
      },
    };
    updateActiveScene({ elements: updatedElements });
    await syncAnnotationElements(updatedElements);
  };

  const handleUpdateElementDuration = async (elIndex: number, newDurationMs: number) => {
    if (!activeScene || !activeScene.elements) return;
    const updatedElements = [...activeScene.elements];
    updatedElements[elIndex] = {
      ...updatedElements[elIndex],
      reveal: {
        ...updatedElements[elIndex].reveal,
        durationMs: Math.max(100, newDurationMs),
      },
    };
    updateActiveScene({ elements: updatedElements });
    await syncAnnotationElements(updatedElements);
  };

  const handleMoveElementSequence = async (elIndex: number, direction: "up" | "down") => {
    if (!activeScene || !activeScene.elements) return;
    const targetIdx = direction === "up" ? elIndex - 1 : elIndex + 1;
    if (targetIdx < 0 || targetIdx >= activeScene.elements.length) return;

    const list = [...activeScene.elements];
    const temp = list[elIndex];
    list[elIndex] = list[targetIdx];
    list[targetIdx] = temp;

    // Cập nhật lại số sequence tăng dần
    const reindexed = list.map((item, idx) => ({
      ...item,
      sequence: idx + 1,
    }));

    updateActiveScene({ elements: reindexed });
    await syncAnnotationElements(reindexed);
  };

  const syncAnnotationElements = async (elements: typeof activeScene.elements) => {
    if (!activeScene || !activeScene.annotationPath || !elements) return;
    try {
      const payload = {
        schemaVersion: 1,
        sceneId: activeScene.id,
        sceneDurationMs: activeScene.durationMs,
        elements,
      };
      await api.saveWhiteboardAnnotation(activeScene.annotationPath, payload);
    } catch (e) {
      console.warn("Không đồng bộ được annotation.json:", e);
    }
  };

  // Render một cảnh hiện tại
  const handleRenderSingleScene = async () => {
    if (!activeScene || !activeScene.imagePath) {
      setStatusMsg({ text: "Cảnh hiện tại chưa chọn ảnh minh họa.", ok: false });
      return;
    }

    const out =
      activeScene.outputPath ||
      activeScene.imagePath.replace(/\.[^/.]+$/, "") + `.${activeScene.id}.mp4`;

    setLoading(true);
    setStatusMsg(null);

    try {
      let annoPath = activeScene.annotationPath;
      // Nếu chưa có annotation file hoặc file chưa tồn tại trên đĩa, tự động sinh trước khi render
      if (!annoPath) {
        annoPath = activeScene.imagePath.replace(/\.[^/.]+$/, "") + `.${activeScene.id}.annotation.json`;
      }

      setProgress({ percent: 10, message: `Kiểm tra/tạo nét vẽ cho ${activeScene.id}...` });
      try {
        const genRes = await api.generateWhiteboardAnnotation(
          activeScene.imagePath,
          activeScene.id,
          "Hoạt hình phân cảnh",
          activeScene.durationMs,
          activeScene.cues,
          annoPath,
          false // không ghi đè nếu file đã có
        );
        if (genRes?.savedTo) {
          annoPath = genRes.savedTo;
          updateActiveScene({ annotationPath: annoPath });
        }
      } catch (e) {
        console.warn("Lỗi auto sinh annotation trước render:", e);
      }

      setProgress({ percent: 20, message: `Bắt đầu render ${activeScene.id}...` });
      const handParam = penType === "calligraphy" ? "calligraphy-brush.png" : "drawing-hand.png";
      const res = await api.renderWhiteboardScene(
        activeScene.imagePath,
        annoPath,
        out,
        fps,
        paperColor,
        handParam,
        activeScene.audioPath,
        activeScene.inkPath,
        activeScene.colorFill,
        activeScene.inkWeight,
        activeScene.colorWeight,
        activeScene.durationMs
      );
      updateActiveScene({ annotationPath: annoPath, outputPath: res.output_path, status: "done" });
      setStatusMsg({
        text: `Render thành công ${activeScene.id}: ${res.output_path}`,
        ok: true,
      });
    } catch (e: any) {
      setStatusMsg({
        text: isCancelled(e) ? "Đã hủy render." : `Lỗi render cảnh: ${errText(e)}`,
        ok: false,
      });
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  // Lưu dự án
  const handleSaveProject = async () => {
    let path = projectPath;
    let projectTitle = "Whiteboard Explainer Project";

    // Tìm folder hoặc file làm căn cứ đặt tên mặc định
    const samplePath =
      projectPath ||
      srtPath ||
      masterAudioPath ||
      outputVideoPath ||
      scenes.find((s) => s.imagePath)?.imagePath ||
      "";

    let folderName = "";
    if (samplePath) {
      const parts = samplePath.split(/[/\\]/).filter(Boolean);
      parts.pop(); // Bỏ tên file
      folderName = parts.pop() || "";
      if (folderName && folderName.trim()) {
        projectTitle = folderName.trim();
      }
    }

    if (!path) {
      const defaultFileName = folderName ? `${folderName}.whiteboard.json` : "project.whiteboard.json";
      const selected = await api.saveFileDialog(
        [{ name: "Whiteboard Project", extensions: ["whiteboard.json", "json"] }],
        defaultFileName
      );
      if (!selected) return;
      path = selected;
      setProjectPath(path);
    } else {
      // Nếu đã có đường dẫn dự án, cập nhật lại title từ tên file/folder
      const filename = path.split(/[/\\]/).pop()?.replace(/\.(whiteboard\.json|json)$/i, "");
      if (filename && filename.trim()) {
        projectTitle = filename.trim();
      }
    }

    const nextRevision = projectRevision + 1;
    const project: WhiteboardProject = {
      id: projectId,
      schemaVersion: 1,
      revision: nextRevision,
      title: projectTitle,
      fps,
      paperColor,
      handPath: penType === "calligraphy" ? "calligraphy-brush.png" : "drawing-hand.png",
      scenes,
      masterAudioPath: masterAudioPath || undefined,
      outputVideoPath,
    };
    try {
      await api.saveWhiteboardProject(path, project);
      setProjectRevision(nextRevision);
      setStatusMsg({ text: `Đã lưu dự án "${projectTitle}" (rev ${nextRevision}) thành công: ${path}`, ok: true });
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi lưu dự án: ${errText(e)}`, ok: false });
    }
  };

  // Mở dự án
  const handleOpenProject = async () => {
    try {
      const path = await api.pickFile([{ name: "Whiteboard Project", extensions: ["whiteboard.json", "json"] }]);
      if (!path) return;
      const proj = await api.loadWhiteboardProject(path);
      setProjectPath(path);
      if (proj.id) setProjectId(proj.id);
      if (proj.revision) setProjectRevision(proj.revision);
      setFps(proj.fps || 30);
      setPaperColor(proj.paperColor || "#F5EBD7");
      if (proj.handPath && proj.handPath.includes("calligraphy")) {
        setPenType("calligraphy");
      } else {
        setPenType("pen");
      }
      setScenes(proj.scenes || []);
      setMasterAudioPath(proj.masterAudioPath || "");
      setOutputVideoPath(proj.outputVideoPath || "");
      setSelectedSceneIndex(0);
      setStatusMsg({ text: `Đã mở dự án: ${path} (${proj.scenes?.length || 0} cảnh)`, ok: true });
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi mở dự án: ${errText(e)}`, ok: false });
    }
  };

  // Thực thi render toàn bộ dự án
  const executeRenderProject = async (targetOut: string, resumeMode: boolean) => {
    const project: WhiteboardProject = {
      id: projectId,
      schemaVersion: 1,
      revision: projectRevision,
      title: "Whiteboard Project",
      fps,
      paperColor,
      handPath: penType === "calligraphy" ? "calligraphy-brush.png" : "drawing-hand.png",
      scenes,
      masterAudioPath: masterAudioPath || undefined,
      outputVideoPath: targetOut,
    };

    setLoading(true);
    setProgress({ percent: 0, message: resumeMode ? "Đang tiếp tục xuất dự án..." : "Chuẩn bị xuất toàn bộ dự án..." });
    setStatusMsg(null);
    try {
      const res = await api.renderWhiteboardProject(project, targetOut, resumeMode);
      setStatusMsg({
        text: `Xuất thành công toàn bộ dự án (${res.scenes_count || scenes.length} cảnh): ${res.output_path}`,
        ok: true,
      });
    } catch (e: any) {
      setStatusMsg({
        text: isCancelled(e) ? "Đã hủy xuất dự án." : `Lỗi xuất dự án: ${errText(e)}`,
        ok: false,
      });
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  // Xuất toàn bộ dự án (có kiểm tra audio và resume các cảnh đã có)
  const handleRenderFullProject = async (forceNoAudio: boolean = false) => {
    if (scenes.length === 0) {
      setStatusMsg({ text: "Dự án chưa có phân cảnh nào.", ok: false });
      return;
    }

    // 1. Kiểm tra audio: Nếu chưa có file master (hoặc file không tồn tại) và không có cảnh nào có audio
    let hasValidMasterAudio = false;
    if (masterAudioPath) {
      try {
        hasValidMasterAudio = await api.checkFileExists(masterAudioPath);
      } catch {
        hasValidMasterAudio = false;
      }
    }
    const hasAnyAudio = Boolean(hasValidMasterAudio || scenes.some((s) => s.audioPath));
    if (!hasAnyAudio && !forceNoAudio) {
      setShowAudioConfirmModal(true);
      return;
    }

    // 2. Chọn đường dẫn xuất
    let out = outputVideoPath;
    if (!out) {
      let defaultName = "whiteboard_full.mp4";
      const samplePath =
        projectPath ||
        srtPath ||
        masterAudioPath ||
        scenes.find((s) => s.imagePath)?.imagePath ||
        "";
      if (samplePath) {
        const parts = samplePath.split(/[/\\]/);
        parts.pop();
        const folderName = parts.pop();
        if (folderName && folderName.trim()) {
          defaultName = `${folderName}.mp4`;
        }
      }
      const selected = await api.saveFileDialog(
        [{ name: "Video MP4", extensions: ["mp4"] }],
        defaultName
      );
      if (!selected) return;
      out = selected;
      setOutputVideoPath(out);
    }

    // 3. Đếm số cảnh đã render hoàn tất trước đó trong thư mục xuất
    let countFinished = 0;
    scenes.forEach((s) => {
      // Nếu scene đã có trạng thái 'done' hoặc có file outputPath hợp lệ
      if (s.status === "done" || s.outputPath) {
        countFinished += 1;
      }
    });

    if (countFinished > 0 && countFinished < scenes.length) {
      setExistingScenesCount(countFinished);
      setShowResumeModal(true);
      return;
    }

    await executeRenderProject(out, false);
  };

  return (
    <div className="panel-card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Header & Công cụ Dự án */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <PenTool size={26} color="#e06c75" />
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Hoạt Hình Bảng Trắng Nhiều Phân Cảnh (Multi-Scene)</h3>
            <p className="panel-desc" style={{ margin: 0 }}>
              Quản lý độc lập từng phân cảnh, timeline SRT, nét vẽ bám mực và ghép toàn dự án không gián đoạn.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", opacity: loading ? 0.45 : 1.0, pointerEvents: loading ? "none" : "auto", transition: "opacity 0.2s" }}>
          <button
            className="secondary-btn"
            onClick={handleReset}
            disabled={loading || generatingTts}
            title="Làm mới bảng trắng về trạng thái rỗng"
            style={{ display: "flex", alignItems: "center", gap: "4px" }}
          >
            <RotateCcw size={14} /> Làm Mới
          </button>
          <button className="secondary-btn" onClick={handleOpenProject} disabled={loading} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <FolderOpen size={14} /> Mở Dự Án
          </button>
          <button className="secondary-btn" onClick={handleSaveProject} disabled={loading} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Save size={14} /> Lưu Dự Án
          </button>
          <button
            className="primary-btn"
            onClick={() => handleRenderFullProject(false)}
            disabled={loading || scenes.length === 0}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            {loading ? <RefreshCw size={14} className="spin" /> : <Film size={14} />} Xuất Toàn Bộ Dự Án
          </button>
        </div>
      </div>

      {/* Môi trường & Banner cảnh báo */}
      {env && !env.ok && (
        <div style={{ padding: "10px 14px", borderRadius: "8px", backgroundColor: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertCircle size={16} />
            <span>
              Môi trường Python Whiteboard chưa sẵn sàng
              {env.missing.length > 0 ? `: thiếu ${env.missing.join(", ")}` : ""}.
              {installLog ? ` (${installLog})` : ""}
            </span>
          </div>
          <button className="primary-btn" onClick={handleInstallEnv} disabled={installing || loading} style={{ padding: "4px 10px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
            {installing ? <RefreshCw size={12} className="spin" /> : <Download size={12} />} Cài tự động
          </button>
        </div>
      )}

      {/* Thanh tiến độ */}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ flex: 1, height: "8px", borderRadius: "4px", background: "#e2e8f0", overflow: "hidden" }}>
            <div style={{ width: `${progress ? progress.percent : 0}%`, height: "100%", background: "var(--primary)", transition: "width 0.2s" }} />
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
        <div style={{ padding: "8px 12px", borderRadius: "8px", backgroundColor: statusMsg.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${statusMsg.ok ? "#bbf7d0" : "#fecaca"}`, color: statusMsg.ok ? "#166534" : "#991b1b", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
          {statusMsg.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Bố cục 2 Cột: Quản lý Phân Cảnh & Chi Tiết Cảnh */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(380px, 420px) minmax(0, 1fr)", gap: "16px" }}>
        {/* Cột 1: Danh sách Phân Cảnh */}
        <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: "10px", minWidth: 0, boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Layers size={16} color="var(--primary)" />
              <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>Phân Cảnh ({scenes.length})</h4>
            </div>
            <button className="secondary-btn" onClick={handleAddScene} style={{ padding: "4px 8px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
              <Plus size={12} /> Thêm Cảnh
            </button>
          </div>

          {/* Phân tích SRT & Tạo TTS */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%", boxSizing: "border-box" }}>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                type="text"
                readOnly
                placeholder="Chọn .srt..."
                value={srtPath ? srtPath.split("/").pop() : ""}
                style={{ flex: 1, minWidth: 0, padding: "6px 10px", fontSize: "12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff" }}
              />
              <button className="secondary-btn" onClick={handlePickSrt} style={{ padding: "4px 8px", fontSize: "12px", flexShrink: 0 }}>
                Chọn
              </button>
              <button className="secondary-btn" onClick={handleParseSrt} disabled={!srtPath || loading} style={{ padding: "4px 8px", fontSize: "12px", flexShrink: 0 }}>
                Chia Cảnh
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--text-muted)", margin: "2px 0" }}>
              <input
                type="checkbox"
                id="wb-exact-cues"
                checked={exactCues}
                onChange={(e) => setExactCues(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              <label htmlFor="wb-exact-cues" style={{ cursor: "pointer" }} title="Mỗi câu phụ đề trong file SRT sẽ tạo thành 1 phân cảnh độc lập (không tự động gộp theo thời gian)">
                Giữ nguyên 1 câu SRT = 1 cảnh
              </label>
            </div>

            {/* Tạo giọng đọc VieNeu-TTS 1 chạm từ file SRT */}
            <div style={{ display: "flex", gap: "6px", alignItems: "center", width: "100%", boxSizing: "border-box" }}>
              <select
                value={selectedVoice}
                onChange={(e) => {
                  setSelectedVoice(e.target.value);
                  setTtsSuccess(false);
                }}
                style={{ flex: 1, minWidth: 0, maxWidth: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff" }}
              >
                {voices.length > 0 ? (
                  voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="Thùy Dung">Thùy Dung (Nữ · Nam)</option>
                    <option value="Thái Sơn">Thái Sơn (Nam · Nam)</option>
                    <option value="Hải Đăng">Hải Đăng (Nam · Bắc)</option>
                    <option value="Trúc Ly">Trúc Ly (Nữ · Bắc)</option>
                    <option value="Quang Sơn">Quang Sơn (Nam · Trung)</option>
                  </>
                )}
              </select>
              <button
                className="secondary-btn"
                onClick={handleGenerateSrtTts}
                disabled={!srtPath || generatingTts || loading}
                title="Tạo giọng đọc thuyết minh master từ toàn bộ nội dung SRT"
                style={{
                  padding: "5px 10px",
                  fontSize: "12px",
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  color: ttsSuccess ? "#16a34a" : "var(--primary)",
                  borderColor: ttsSuccess ? "#86efac" : undefined,
                  backgroundColor: ttsSuccess ? "#f0fdf4" : undefined,
                  whiteSpace: "nowrap",
                }}
              >
                {generatingTts ? (
                  <RefreshCw size={12} className="spin" />
                ) : ttsSuccess ? (
                  <Check size={13} color="#16a34a" />
                ) : (
                  <Mic size={12} />
                )}
                {generatingTts ? "Đang tạo..." : ttsSuccess ? "Đã tạo xong" : "Tạo TTS"}
              </button>
            </div>

            {/* Chỉ báo trạng thái đang tạo TTS */}
            {generatingTts && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 10px",
                  borderRadius: "6px",
                  backgroundColor: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  fontSize: "12px",
                  color: "#1d4ed8",
                }}
              >
                <RefreshCw size={14} className="spin" style={{ flexShrink: 0 }} />
                <span>Đang tổng hợp giọng đọc VieNeu TTS từ file SRT...</span>
              </div>
            )}

            {/* File âm thanh Master Audio (nếu đã có sẵn hoặc vừa tạo) */}
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Chọn file âm thanh (.wav/.mp3) đã có..."
                  value={masterAudioPath ? masterAudioPath.split(/[/\\]/).pop() : ""}
                  readOnly
                  title={masterAudioPath || "Chưa có file âm thanh"}
                  style={{
                    width: "100%",
                    padding: "5px 26px 5px 8px",
                    fontSize: "12px",
                    borderRadius: "6px",
                    border: audioExists ? "1px solid #86efac" : "1px solid #fca5a5",
                    background: audioExists ? "#f0fdf4" : "#fef2f2",
                  }}
                />
                <span
                  title={audioExists ? "Đã có âm thanh master" : "Chưa có file âm thanh (video xuất sẽ không có tiếng)"}
                  style={{
                    position: "absolute",
                    right: "7px",
                    display: "flex",
                    alignItems: "center",
                    pointerEvents: "none",
                  }}
                >
                  {audioExists ? (
                    <Volume2 size={13} color="#16a34a" />
                  ) : (
                    <VolumeX size={13} color="#ef4444" />
                  )}
                </span>
              </div>
              <button
                className="secondary-btn"
                onClick={handlePickMasterAudio}
                title="Chọn file âm thanh Master nếu bạn đã có sẵn file thu âm/TTS"
                style={{ padding: "5px 8px", fontSize: "12px", whiteSpace: "nowrap" }}
              >
                Chọn Audio
              </button>
              {masterAudioPath && (
                <button
                  className="icon-btn"
                  onClick={() => setMasterAudioPath("")}
                  title="Bỏ chọn file audio"
                  style={{ padding: "4px" }}
                >
                  <Trash2 size={12} color="#94a3b8" />
                </button>
              )}
            </div>
          </div>

          {/* Danh sách cuộn các Scene */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "420px", overflowY: "auto", paddingRight: "4px" }}>
            {scenes.map((s, idx) => (
              <div
                key={s.id}
                onClick={() => setSelectedSceneIndex(idx)}
                style={{
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: idx === selectedSceneIndex ? "1px solid var(--primary)" : "1px solid #e2e8f0",
                  background: idx === selectedSceneIndex ? "#eff6ff" : "#ffffff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  transition: "background 0.15s ease",
                }}
              >
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ fontWeight: 600, fontSize: "13px", color: idx === selectedSceneIndex ? "var(--primary)" : "#1e293b" }}>
                    #{s.order} {s.id}
                  </span>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    {(s.durationMs / 1000).toFixed(1)}s · {s.imagePath ? "Đã có ảnh" : "Chưa có ảnh"}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                  <button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleMoveScene(idx, -1); }} disabled={idx === 0} title="Lên">
                    <ArrowUp size={12} />
                  </button>
                  <button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleMoveScene(idx, 1); }} disabled={idx === scenes.length - 1} title="Xuống">
                    <ArrowDown size={12} />
                  </button>
                  <button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleDeleteScene(idx); }} title="Xóa">
                    <Trash2 size={12} color="#ef4444" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cột 2: Thiết lập Chi Tiết Cho Cảnh Đang Chọn */}
        {activeScene ? (
          <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h4 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>
                Chi Tiết #{activeScene.order}: {activeScene.id}
              </h4>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  className="secondary-btn"
                  onClick={handlePreviewScene}
                  disabled={loading || !activeScene.imagePath || !activeScene.annotationPath}
                  style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 10px", fontSize: "12px" }}
                  title="Xem trước các vùng vẽ và thứ tự (R6 Preview)"
                >
                  <Eye size={14} /> Xem Trước Vùng Vẽ
                </button>
                <button
                  className="secondary-btn"
                  onClick={handleRenderSingleScene}
                  disabled={loading || !activeScene.imagePath}
                  style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 12px", fontSize: "12px" }}
                >
                  <Play size={14} /> Render Thử Cảnh Này
                </button>
              </div>
            </div>

            {/* Ảnh minh họa */}
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>Ảnh minh họa (Line-Art / 2D)</label>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  type="text"
                  readOnly
                  placeholder="Chọn ảnh cho cảnh này..."
                  value={activeScene.imagePath}
                  style={{ flex: 1, padding: "6px 10px", fontSize: "12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff" }}
                />
                <button className="secondary-btn" onClick={handlePickSceneImage} style={{ padding: "6px 10px", fontSize: "12px" }}>
                  Chọn Ảnh
                </button>
              </div>
            </div>

            {/* Annotation */}
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>Annotation (JSON)</label>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  type="text"
                  placeholder="Đường dẫn annotation.json..."
                  value={activeScene.annotationPath}
                  onChange={(e) => updateActiveScene({ annotationPath: e.target.value })}
                  style={{ flex: 1, padding: "6px 10px", fontSize: "12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff" }}
                />
                <button className="secondary-btn" onClick={handlePickSceneAnnotation} style={{ padding: "6px 10px", fontSize: "12px" }}>
                  Chọn
                </button>
                <button className="secondary-btn" onClick={handleAutoAnnotationCurrent} style={{ padding: "6px 10px", fontSize: "12px" }}>
                  Tạo Mẫu
                </button>
              </div>
            </div>

            {/* W3: Phong cách vẽ & Phân loại ảnh */}
            <div style={{ background: "#ffffff", padding: "10px", borderRadius: "6px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)" }}>
                  Phong cách vẽ & Nhận diện ảnh
                </span>
                {activeScene.imageType && (
                  <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: activeScene.imageType === "line_art_mono" ? "#f0fdf4" : (activeScene.imageType === "colored" ? "#eff6ff" : "#fefce8"), color: activeScene.imageType === "line_art_mono" ? "#166534" : (activeScene.imageType === "colored" ? "#1d4ed8" : "#854d0e"), fontWeight: 600 }}>
                    {activeScene.imageType === "line_art_mono" && "Nét đơn sắc (Line-Art)"}
                    {activeScene.imageType === "filled_mono" && "Có mảng đen (Filled Mono)"}
                    {activeScene.imageType === "colored" && "Ảnh màu (Colored)"}
                    {activeScene.imageType === "blank" && "Ảnh rỗng (Blank)"}
                    {activeScene.imageType === "uncertain" && "Chưa xác định"}
                    {activeScene.analysisConfidence ? ` (${Math.round(activeScene.analysisConfidence * 100)}%)` : ""}
                  </span>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div>
                  <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>Nét vẽ (Ink Path):</label>
                  <select
                    value={activeScene.inkPath || "grid"}
                    onChange={(e) => updateActiveScene({ inkPath: e.target.value as any })}
                    style={{ width: "100%", padding: "4px 8px", fontSize: "12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff" }}
                  >
                    <option value="grid">Lưới ô vuông (Grid - Mặc định)</option>
                    <option value="skeleton">Khung xương bám nét (Skeleton)</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>Tô màu (Color Fill):</label>
                  <select
                    value={activeScene.colorFill || "contour-wipe"}
                    onChange={(e) => updateActiveScene({ colorFill: e.target.value as any })}
                    style={{ width: "100%", padding: "4px 8px", fontSize: "12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff" }}
                  >
                    <option value="none">Không tô (Chỉ vẽ nét - Tối ưu Line-Art)</option>
                    <option value="contour-wipe">Quét viền xuống (Contour-Wipe)</option>
                    <option value="brush">Quét cọ theo quỹ đạo (Brush)</option>
                    <option value="palette-brush">Tô theo nhóm màu Lab (Palette-Brush - R3)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* W4 / R6: Danh sách & Biên tập các vùng vẽ (Elements Editor) trực quan */}
            {activeScene.elements && activeScene.elements.length > 0 && (
              <div style={{ background: "#ffffff", padding: "10px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>
                    Biên tập vùng vẽ ({activeScene.elements.length} vùng)
                  </label>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    Đổi thứ tự, hướng quét và thời lượng từng nét
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "200px", overflowY: "auto" }}>
                  {activeScene.elements.map((el, idx) => (
                    <div
                      key={el.id || idx}
                      style={{
                        padding: "6px 8px",
                        borderRadius: "4px",
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        fontSize: "12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "8px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveElementSequence(idx, "up")}
                            style={{
                              background: "none",
                              border: "none",
                              padding: "0 2px",
                              cursor: idx === 0 ? "not-allowed" : "pointer",
                              opacity: idx === 0 ? 0.3 : 1,
                              lineHeight: 1,
                            }}
                            title="Di chuyển lên trước"
                          >
                            <ArrowUp size={11} />
                          </button>
                          <button
                            type="button"
                            disabled={idx === (activeScene.elements?.length ?? 1) - 1}
                            onClick={() => handleMoveElementSequence(idx, "down")}
                            style={{
                              background: "none",
                              border: "none",
                              padding: "0 2px",
                              cursor: idx === (activeScene.elements?.length ?? 1) - 1 ? "not-allowed" : "pointer",
                              opacity: idx === (activeScene.elements?.length ?? 1) - 1 ? 0.3 : 1,
                              lineHeight: 1,
                            }}
                            title="Di chuyển xuống sau"
                          >
                            <ArrowDown size={11} />
                          </button>
                        </div>
                        <span style={{ fontWeight: 700, color: "var(--primary)", minWidth: "22px" }}>#{el.sequence}</span>
                        <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={el.label || el.id}>
                          {el.label || el.id}
                        </span>
                        <span style={{ fontSize: "10px", color: "#64748b", background: "#e2e8f0", padding: "1px 4px", borderRadius: "3px", whiteSpace: "nowrap" }}>
                          [{el.region.x},{el.region.y} {el.region.width}x{el.region.height}]
                        </span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <select
                          value={el.reveal.direction || "left_to_right"}
                          onChange={(e) => handleUpdateElementDirection(idx, e.target.value)}
                          style={{
                            padding: "2px 4px",
                            fontSize: "11px",
                            borderRadius: "4px",
                            border: "1px solid #cbd5e1",
                            background: "#ffffff",
                          }}
                          title="Hướng quét nét vẽ"
                        >
                          <option value="left_to_right">Trái sang phải (L→R)</option>
                          <option value="top_to_bottom">Trên xuống dưới (T↓B)</option>
                          <option value="right_to_left">Phải sang trái (R←L)</option>
                          <option value="bottom_to_top">Dưới lên trên (B↑T)</option>
                        </select>

                        <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                          <input
                            type="number"
                            min="100"
                            step="200"
                            value={el.reveal.durationMs || 1000}
                            onChange={(e) => handleUpdateElementDuration(idx, parseInt(e.target.value) || 500)}
                            style={{
                              width: "55px",
                              padding: "2px 4px",
                              fontSize: "11px",
                              borderRadius: "4px",
                              border: "1px solid #cbd5e1",
                              textAlign: "right",
                            }}
                            title="Thời lượng vẽ vùng này (ms)"
                          />
                          <span style={{ fontSize: "10px", color: "#64748b" }}>ms</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Thời lượng & Cấu hình */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>Thời lượng (ms)</label>
                <input
                  type="number"
                  value={activeScene.durationMs}
                  onChange={(e) => updateActiveScene({ durationMs: parseInt(e.target.value) || 1000 })}
                  style={{ width: "100%", padding: "6px 10px", fontSize: "12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>Màu nền giấy</label>
                <input
                  type="text"
                  value={paperColor}
                  onChange={(e) => setPaperColor(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", fontSize: "12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>Loại bút vẽ</label>
                <select
                  value={penType}
                  onChange={(e) => setPenType(e.target.value as "pen" | "calligraphy")}
                  style={{ width: "100%", padding: "6px 10px", fontSize: "12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff" }}
                >
                  <option value="pen">Tay vẽ / Bút dạ thường</option>
                  <option value="calligraphy">Bút lông thư pháp (Calligraphy)</option>
                </select>
              </div>
            </div>

            {/* Phụ đề của cảnh nếu có */}
            {activeScene.cues.length > 0 && (
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Phụ đề trong cảnh ({activeScene.cues.length} câu)
                </label>
                <div style={{ maxHeight: "120px", overflowY: "auto", fontSize: "12px", background: "#ffffff", padding: "8px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                  {activeScene.cues.map((c: any) => (
                    <div key={c.index} style={{ marginBottom: "4px" }}>
                      <span style={{ color: "var(--primary)", fontWeight: 600 }}>#{c.index}</span> {c.text}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
            Chọn hoặc thêm một phân cảnh để bắt đầu cấu hình.
          </div>
        )}
      </div>

      {/* Modal 1: Cảnh báo chưa có file âm thanh khi Xuất toàn bộ */}
      {showAudioConfirmModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "16px",
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "10px",
              padding: "20px",
              maxWidth: "440px",
              width: "100%",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#b45309" }}>
              <AlertCircle size={24} />
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Cảnh báo: Chưa có âm thanh!</h3>
            </div>
            <p style={{ margin: 0, fontSize: "13px", color: "#475569", lineHeight: 1.5 }}>
              Dự án hiện <strong>chưa có file âm thanh Master</strong> và các phân cảnh cũng chưa gắn file audio riêng. Nếu tiếp tục xuất, video thu được sẽ <strong>không có tiếng</strong> (video câm).
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
              <button
                className="secondary-btn"
                onClick={() => setShowAudioConfirmModal(false)}
                style={{ padding: "6px 14px", fontSize: "13px" }}
              >
                Hủy bỏ (Để chọn/tạo audio)
              </button>
              <button
                className="primary-btn"
                onClick={() => {
                  setShowAudioConfirmModal(false);
                  handleRenderFullProject(true);
                }}
                style={{ padding: "6px 14px", fontSize: "13px", backgroundColor: "#f59e0b", borderColor: "#d97706" }}
              >
                Tiếp tục (Xuất video không tiếng)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Tùy chọn Tiếp tục (Resume) hoặc Tạo lại từ đầu */}
      {showResumeModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "16px",
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "10px",
              padding: "20px",
              maxWidth: "460px",
              width: "100%",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--primary)" }}>
              <Film size={24} />
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Tùy chọn xuất dự án</h3>
            </div>
            <p style={{ margin: 0, fontSize: "13px", color: "#475569", lineHeight: 1.5 }}>
              Hệ thống phát hiện đã có <strong>{existingScenesCount}/{scenes.length}</strong> phân cảnh được render hoàn chỉnh trước đó. Bạn muốn tiếp tục từ phân cảnh chưa xong hay tạo lại toàn bộ từ đầu?
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
              <button
                className="secondary-btn"
                onClick={() => {
                  setShowResumeModal(false);
                  if (outputVideoPath) executeRenderProject(outputVideoPath, false);
                }}
                style={{ padding: "6px 14px", fontSize: "13px" }}
              >
                Tạo lại từ đầu
              </button>
              <button
                className="primary-btn"
                onClick={() => {
                  setShowResumeModal(false);
                  if (outputVideoPath) executeRenderProject(outputVideoPath, true);
                }}
                style={{ padding: "6px 14px", fontSize: "13px" }}
              >
                Tiếp tục các cảnh còn lại
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Xem trước phân tích vùng vẽ (R6 Preview) */}
      {previewModalImg && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "16px",
          }}
          onClick={() => setPreviewModalImg(null)}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "10px",
              padding: "16px",
              maxWidth: "800px",
              maxHeight: "90vh",
              width: "100%",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Eye size={18} color="var(--primary)" />
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>Xem Trước Vùng Vẽ & Thứ Tự Xuất Hiện</h3>
              </div>
              <button className="icon-btn" onClick={() => setPreviewModalImg(null)}>
                <XCircle size={18} />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", justifyContent: "center", alignItems: "center", background: "#f1f5f9", borderRadius: "6px", padding: "8px" }}>
              <img
                src={`asset://${previewModalImg}`}
                alt="Whiteboard Preview"
                style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: "4px" }}
                onError={(e) => {
                  // Fallback load ảnh local
                  (e.target as any).src = "file://" + previewModalImg;
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px", color: "var(--text-muted)" }}>
              <span>Đường dẫn: {previewModalImg}</span>
              <button className="secondary-btn" onClick={() => setPreviewModalImg(null)} style={{ padding: "4px 12px" }}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
