import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import {
  WhiteboardProject,
  WhiteboardThumbnail,
  WhiteboardFontChoice,
  WhiteboardSceneItem,
  WhiteboardEnvCheck,
  WhiteboardPenType,
  WHITEBOARD_PEN_OPTIONS,
  WhiteboardSpeechConfig,
  WhiteboardSpeaker,
  WhiteboardSrtCue,
  WhiteboardWbInspectResult,
  WhiteboardFolderScanResult,
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
  Image as ImageIcon,
  Sparkles,
  BookOpen,
  FolderDown,
  Wand2,
  StopCircle,
} from "lucide-react";

import { applyAlignedTiming } from "../lib/whiteboardTiming";
import { COVER_LAYOUT, COVER_TYPOGRAPHY_VERSION, createWhiteboardThumbnail } from "../lib/whiteboardThumbnail";
import { buildProjectFromWbImport, revalidateWbImport, describeWbImportErrors } from "../utils/whiteboardWbAdapter";

import { THUMBNAIL_FONTS, loadCoverFont, resolveCoverFont, normalizeCoverFontChoice } from "../lib/whiteboardFonts";

const errText = (e: any): string => String(e?.message ?? e);
const isCancelled = (e: any): boolean => errText(e).startsWith("CANCELLED");

export function WhiteboardEditor() {
  const exportWithoutAudio = useRef(false);
  const annotationSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [srtPath, setSrtPath] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [projectId, setProjectId] = useState(() => "project-" + Date.now());
  const [projectRevision, setProjectRevision] = useState(1);
  const [outputVideoPath, setOutputVideoPath] = useState("");
  const [masterAudioPath, setMasterAudioPath] = useState("");
  const [audioExists, setAudioExists] = useState(false);

  const [fps, setFps] = useState(30);
  const [paperColor, setPaperColor] = useState("#F5EBD7");
  const [thumbnailTitle, setThumbnailTitle] = useState("");
  const [thumbnailImagePath, setThumbnailImagePath] = useState("");
  const [thumbnailFontChoice, setThumbnailFontChoice] = useState<WhiteboardFontChoice>("auto");
  const [thumbnailFontError, setThumbnailFontError] = useState("");
  const [thumbnail, setThumbnail] = useState<WhiteboardThumbnail>();
  const [penType, setPenType] = useState<WhiteboardPenType>("pen");

  const resolveHandFilename = (type: WhiteboardPenType): string => {
    const found = WHITEBOARD_PEN_OPTIONS.find((opt) => opt.id === type);
    return found ? found.filename : "drawing-hand.png";
  };

  const resolvePenTypeFromPath = (handPath?: string): WhiteboardPenType => {
    if (!handPath) return "pen";
    const basename = handPath.split(/[/\\]/).pop();
    const found = WHITEBOARD_PEN_OPTIONS.find(
      (opt) => opt.filename === basename || opt.id === handPath
    );
    return found ? found.id : "pen";
  };

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
  const [autoTiming, setAutoTiming] = useState(true);
  const [speechMode, setSpeechMode] = useState<"single" | "characters">("single");
  const [speakers, setSpeakers] = useState<WhiteboardSpeaker[]>([]);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [audioFingerprint, setAudioFingerprint] = useState<string | null>(null);

  const computeCurrentSpeechFingerprint = () => {
    return JSON.stringify({
      mode: speechMode,
      defaultVoiceId: selectedVoice,
      timingMode: autoTiming ? "auto" : "fixed",
      speakers: speakers.map(s => ({ id: s.id, voiceId: s.voiceId })),
      cues: scenes.flatMap(s => s.cues).map(c => ({
        index: c.index,
        spokenText: c.spokenText || c.text,
        speakerId: c.speakerId || null,
      })),
    });
  };

  const isTtsCurrent = Boolean(
    masterAudioPath &&
    audioFingerprint &&
    audioFingerprint === computeCurrentSpeechFingerprint()
  );

  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const ttsInputRef = useRef("");
  ttsInputRef.current = JSON.stringify([srtPath, selectedVoice, speechMode, speakers, autoTiming]);

  // Modal xác nhận xuất video
  const [showAudioConfirmModal, setShowAudioConfirmModal] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [existingScenesCount, setExistingScenesCount] = useState(0);

  // Modal xác nhận nhập bộ kịch bản Whiteboard (.wb.json)
  const [wbImportModalData, setWbImportModalData] = useState<{
    inspect: WhiteboardWbInspectResult;
    srtPath: string;
  } | null>(null);

  const [wbReplaceConfirmed, setWbReplaceConfirmed] = useState(false);
  const wbImportApplying = useRef(false);
  const wbEditorSnapshot = useRef("");
  wbEditorSnapshot.current = JSON.stringify([projectId, projectRevision, scenes, srtPath,
    selectedVoice, speechMode, speakers, autoTiming, masterAudioPath, outputVideoPath]);
  useEffect(() => setWbReplaceConfirmed(false), [wbImportModalData]);

  const wbImportError = describeWbImportErrors(wbImportModalData?.inspect.errors || []);
  const activeScene = scenes[selectedSceneIndex] || null;
  const coverSource = thumbnailImagePath || scenes.find((scene) => scene.imagePath)?.imagePath || "";
  const coverFont = resolveCoverFont(penType, thumbnailFontChoice);
  const isImportedThumbnail = thumbnail?.mode === "imported";
  const thumbnailReady = Boolean(
    thumbnail && (
      isImportedThumbnail
        ? Boolean(thumbnail.pngDataUrl)
        : (
            thumbnail.title === thumbnailTitle.trim() &&
            thumbnail.imagePath === coverSource &&
            thumbnail.penType === penType &&
            thumbnail.layout === COVER_LAYOUT &&
            thumbnail.typographyVersion === COVER_TYPOGRAPHY_VERSION &&
            (thumbnail.fontChoice ?? "auto") === thumbnailFontChoice
          )
    )
  );

  // State cho nạp ảnh phân cảnh hàng loạt từ thư mục
  const [batchScanModalOpen, setBatchScanModalOpen] = useState(false);
  const [batchScanResult, setBatchScanResult] = useState<WhiteboardFolderScanResult | null>(null);
  const [batchOverwriteExisting, setBatchOverwriteExisting] = useState(false);
  const [batchSelectedRows, setBatchSelectedRows] = useState<Record<number, boolean>>({});
  const [batchChosenDuplicates, setBatchChosenDuplicates] = useState<Record<number, string>>({});
  const [batchChosenThumbnail, setBatchChosenThumbnail] = useState<string | null>(null);
  const [batchThumbnailMode, setBatchThumbnailMode] = useState<"imported" | "generated" | "none">("imported");

  // State cho tạo mẫu annotation hàng loạt
  const [batchAnnoModalOpen, setBatchAnnoModalOpen] = useState(false);
  const [batchAnnoMode, setBatchAnnoMode] = useState<"missing" | "all">("missing");
  const [isBatchAnnotating, setIsBatchAnnotating] = useState(false);
  const [batchAnnoProgress, setBatchAnnoProgress] = useState<{
    current: number;
    total: number;
    success: number;
    skipped: number;
    error: number;
    currentSceneId: string;
    errors: { sceneId: string; error: string }[];
  } | null>(null);
  const batchAnnoCancelRequested = useRef(false);

  useEffect(() => {
    let active = true;
    setThumbnailFontError("");
    loadCoverFont(coverFont.id).catch((error) => {
      if (active) setThumbnailFontError(errText(error));
    });
    return () => { active = false; };
  }, [coverFont.id]);

  const handleCreateThumbnail = async () => {
    if (!thumbnailTitle.trim() || !coverSource) {
      setStatusMsg({ text: "Nhập tiêu đề và chọn ảnh minh họa trước khi tạo thumbnail.", ok: false });
      return;
    }
    setLoading(true);
    setProgress({ percent: 0, message: "Đang tạo thumbnail..." });
    try {
      const title = thumbnailTitle.trim();
      const illustration = await api.readWhiteboardCoverImage(coverSource);
      const generated = await createWhiteboardThumbnail(title, penType, illustration, thumbnailFontChoice);
      setThumbnail({
        title,
        imagePath: coverSource,
        penType,
        pngDataUrl: generated.pngDataUrl,
        aspectRatio: generated.aspectRatio,
        layout: COVER_LAYOUT,
        fontChoice: thumbnailFontChoice,
        typographyVersion: COVER_TYPOGRAPHY_VERSION,
      });
      setThumbnailImagePath(coverSource);
      setStatusMsg({ text: "Đã tạo thumbnail. Lưu dự án để giữ ảnh bìa này; khi xuất sẽ chèn đúng 2 giây đầu.", ok: true });
    } catch (e) {
      setStatusMsg({ text: `Lỗi tạo thumbnail: ${errText(e)}`, ok: false });
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const handlePickCoverImage = async () => {
    try {
      const path = await api.pickFile([{ name: "Ảnh bìa", extensions: ["png", "jpg", "jpeg", "webp"] }]);
      if (path) setThumbnailImagePath(path);
    } catch (e) {
      setStatusMsg({ text: `Lỗi chọn ảnh bìa: ${errText(e)}`, ok: false });
    }
  };

  const handlePickCompleteThumbnail = async () => {
    try {
      const path = await api.pickFile([{ name: "Ảnh bìa hoàn chỉnh", extensions: ["png", "jpg", "jpeg", "webp"] }]);
      if (path) {
        setLoading(true);
        setStatusMsg(null);
        try {
          const imported = await api.importWhiteboardCompleteThumbnail(path, thumbnailTitle.trim() || undefined);
          setThumbnail(imported);
          setThumbnailImagePath(path);
          setStatusMsg({
            text: `Đã nạp thành công ảnh bìa hoàn chỉnh (${imported.aspectRatio}): ${path.split(/[/\\]/).pop()}`,
            ok: true,
          });
        } finally {
          setLoading(false);
        }
      }
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi nạp ảnh bìa hoàn chỉnh: ${errText(e)}`, ok: false });
    }
  };

  const handleOpenBatchImageModal = async () => {
    if (scenes.length === 0) {
      setStatusMsg({ text: "Dự án chưa có phân cảnh nào. Vui lòng tạo cảnh hoặc nhập phụ đề SRT trước.", ok: false });
      return;
    }
    try {
      const folder = await api.pickDirectory();
      if (!folder) return;

      setLoading(true);
      setStatusMsg({ text: `Đang quét thư mục ảnh: ${folder}...`, ok: true });
      try {
        const res = await api.scanWhiteboardFolderImages(
          folder,
          scenes.length,
          scenes.map((s) => s.id),
          scenes.map((s) => s.imagePath || null)
        );
        setBatchScanResult(res);
        setBatchOverwriteExisting(false);

        const initialSelected: Record<number, boolean> = {};
        const initialDuplicates: Record<number, string> = {};

        res.mappings.forEach((m) => {
          const hasImg = Boolean(m.matchedImage || (m.candidateImages && m.candidateImages.length > 0));
          const sceneAlreadyHasImg = Boolean(scenes[m.sceneIndex]?.imagePath);
          initialSelected[m.sceneIndex] = hasImg && !sceneAlreadyHasImg;

          if (m.matchedImage) {
            initialDuplicates[m.sceneIndex] = m.matchedImage.path;
          } else if (m.candidateImages && m.candidateImages.length > 0) {
            initialDuplicates[m.sceneIndex] = m.candidateImages[0].path;
          }
        });

        setBatchSelectedRows(initialSelected);
        setBatchChosenDuplicates(initialDuplicates);

        if (res.thumbnailCandidates && res.thumbnailCandidates.length > 0) {
          setBatchChosenThumbnail(res.thumbnailCandidates[0].path);
          setBatchThumbnailMode("imported");
        } else {
          setBatchChosenThumbnail(null);
          setBatchThumbnailMode("none");
        }

        setBatchScanModalOpen(true);
      } finally {
        setLoading(false);
      }
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi khi quét thư mục ảnh: ${errText(e)}`, ok: false });
    }
  };

  const handleToggleBatchOverwrite = (nextOverwrite: boolean) => {
    setBatchOverwriteExisting(nextOverwrite);
    if (!batchScanResult) return;
    setBatchSelectedRows((prev) => {
      const next = { ...prev };
      batchScanResult.mappings.forEach((m) => {
        const hasImg = Boolean(m.matchedImage || (m.candidateImages && m.candidateImages.length > 0));
        const sceneAlreadyHasImg = Boolean(scenes[m.sceneIndex]?.imagePath);
        if (hasImg) {
          next[m.sceneIndex] = nextOverwrite ? true : !sceneAlreadyHasImg;
        }
      });
      return next;
    });
  };

  const handleApplyBatchImages = async () => {
    if (!batchScanResult) return;

    if (scenes.length !== batchScanResult.mappings.length) {
      setStatusMsg({
        text: "Cấu trúc danh sách cảnh đã thay đổi so với lúc quét. Vui lòng quét lại thư mục ảnh.",
        ok: false,
      });
      setBatchScanModalOpen(false);
      return;
    }

    let appliedCount = 0;
    const updatedScenes = scenes.map((scene, idx) => {
      const isSelected = batchSelectedRows[idx];
      const mapping = batchScanResult.mappings[idx];
      if (!isSelected || !mapping) return scene;

      const chosenPath = batchChosenDuplicates[idx] || mapping.matchedImage?.path;
      if (!chosenPath) return scene;

      appliedCount++;
      return {
        ...scene,
        imagePath: chosenPath,
        annotationPath: "",
        elements: undefined,
        outputPath: "",
        status: "idle" as const,
        revision: (scene.revision || 1) + 1,
      };
    });

    setScenes(updatedScenes);
    if (appliedCount > 0) {
      setOutputVideoPath("");
    }

    let thumbMsg = "";
    if (batchChosenThumbnail && batchThumbnailMode !== "none") {
      try {
        if (batchThumbnailMode === "imported") {
          const importedThumb = await api.importWhiteboardCompleteThumbnail(
            batchChosenThumbnail,
            thumbnailTitle.trim() || undefined
          );
          setThumbnail(importedThumb);
          setThumbnailImagePath(batchChosenThumbnail);
          thumbMsg = " Đã nạp ảnh bìa hoàn chỉnh.";
        } else if (batchThumbnailMode === "generated") {
          setThumbnailImagePath(batchChosenThumbnail);
          thumbMsg = " Đã đặt ảnh minh họa bìa.";
        }
      } catch (err: any) {
        thumbMsg = ` (Lỗi nạp ảnh bìa: ${errText(err)})`;
      }
    }

    setBatchScanModalOpen(false);
    setStatusMsg({
      text: `Đã áp dụng nạp ảnh thành công cho ${appliedCount} cảnh.${thumbMsg}`,
      ok: true,
    });
  };

  const handleStartBatchAnnotation = async () => {
    try {
      await annotationSaveQueue.current;
    } catch (e) {
      setStatusMsg({ text: `Lỗi lưu annotation hiện tại: ${errText(e)}`, ok: false });
      return;
    }

    const targetIndices: number[] = [];
    scenes.forEach((s, idx) => {
      if (!s.imagePath) return;
      if (batchAnnoMode === "missing") {
        if (!s.annotationPath || !s.elements || s.elements.length === 0) {
          targetIndices.push(idx);
        }
      } else {
        targetIndices.push(idx);
      }
    });

    if (targetIndices.length === 0) {
      setStatusMsg({
        text:
          batchAnnoMode === "missing"
            ? "Tất cả các cảnh có ảnh đã có annotation hợp lệ. Không có cảnh nào cần tạo mẫu."
            : "Không có cảnh nào có ảnh minh họa để tạo mẫu.",
        ok: true,
      });
      setBatchAnnoModalOpen(false);
      return;
    }

    setIsBatchAnnotating(true);
    batchAnnoCancelRequested.current = false;

    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errorsList: { sceneId: string; error: string }[] = [];

    setBatchAnnoProgress({
      current: 1,
      total: targetIndices.length,
      success: 0,
      skipped: 0,
      error: 0,
      currentSceneId: scenes[targetIndices[0]].id,
      errors: [],
    });

    for (let i = 0; i < targetIndices.length; i++) {
      if (batchAnnoCancelRequested.current) {
        break;
      }
      const idx = targetIndices[i];
      const scene = scenes[idx];

      setBatchAnnoProgress({
        current: i + 1,
        total: targetIndices.length,
        success: successCount,
        skipped: skippedCount,
        error: errorCount,
        currentSceneId: scene.id,
        errors: [...errorsList],
      });

      try {
        const targetPath =
          scene.annotationPath ||
          scene.imagePath.replace(/\.[^/.]+$/, "") + `.${scene.id}.annotation.json`;

        const relativeCues = scene.cues.map((c) => ({
          ...c,
          startMs: c.startMs - scene.timelineStartMs,
          endMs: c.endMs - scene.timelineStartMs,
          speechEndMs:
            c.speechEndMs === undefined ? undefined : c.speechEndMs - scene.timelineStartMs,
        }));

        const res = await api.generateWhiteboardAnnotation(
          scene.imagePath,
          scene.id,
          "Hoạt hình phân cảnh",
          scene.durationMs,
          relativeCues,
          targetPath,
          true
        );

        setScenes((prevScenes) => {
          const next = [...prevScenes];
          if (next[idx] && next[idx].id === scene.id) {
            next[idx] = {
              ...next[idx],
              annotationPath: res.savedTo || targetPath,
              elements: (res.elements as any) || undefined,
              outputPath: "",
            };
          }
          return next;
        });

        successCount++;
      } catch (err: any) {
        errorCount++;
        errorsList.push({ sceneId: scene.id, error: errText(err) });
      }
    }

    const wasCancelled = batchAnnoCancelRequested.current;
    setIsBatchAnnotating(false);
    setBatchAnnoProgress(null);
    setBatchAnnoModalOpen(false);

    if (wasCancelled) {
      setStatusMsg({
        text: `Đã dừng tạo mẫu sau cảnh hiện tại. Kết quả: ${successCount} thành công, ${errorCount} lỗi.`,
        ok: errorCount === 0,
      });
    } else {
      setStatusMsg({
        text: `Hoàn tất tạo mẫu hàng loạt: ${successCount} cảnh thành công${
          errorCount > 0 ? `, ${errorCount} cảnh lỗi` : ""
        }.`,
        ok: errorCount === 0,
      });
    }
  };

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

  const autoDetectMasterAudio = async (path: string) => {
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
  };

  const handlePickSrt = async () => {
    try {
      const path = await api.pickFile([{ name: "SRT Subtitle", extensions: ["srt"] }]);
      if (path) {
        // Tự động kiểm tra kịch bản .wb.json đi kèm
        try {
          const inspect = await api.inspectWhiteboardWbImport(path);
          const hasJson = !inspect.errors.some(
            (e) => e.startsWith("WB_JSON_NOT_FOUND") || e.startsWith("WB_SRT_NOT_FOUND")
          );
          if (hasJson) {
            setWbImportModalData({ inspect, srtPath: path });
            return;
          }
        } catch (wbErr) {
          console.warn("Lỗi kiểm tra .wb.json:", wbErr);
        }

        setSrtPath(path);
        await autoDetectMasterAudio(path);
        setStatusMsg({ text: `Đã chọn tệp SRT: ${path}`, ok: true });
      }
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi chọn file: ${errText(e)}`, ok: false });
    }
  };

  const handleInspectAndImportWb = async (customSrtPath?: string) => {
    const targetPath = customSrtPath || srtPath;
    if (!targetPath) {
      setStatusMsg({ text: "Vui lòng chọn tệp SRT trước.", ok: false });
      return;
    }
    setLoading(true);
    try {
      const inspect = await api.inspectWhiteboardWbImport(targetPath);
      setWbImportModalData({ inspect, srtPath: targetPath });
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi kiểm tra kịch bản WB: ${errText(e)}`, ok: false });
    } finally {
      setLoading(false);
    }
  };

  const handleApplyWbImport = async (data: { inspect: WhiteboardWbInspectResult; srtPath: string }) => {
    if (loading || generatingTts || wbImportApplying.current || (scenes.length > 0 && !wbReplaceConfirmed)) return;
    wbImportApplying.current = true;
    setLoading(true);
    const snapshot = wbEditorSnapshot.current;
    try {
      await annotationSaveQueue.current;
      const fresh = await revalidateWbImport(data.inspect, data.srtPath, api.inspectWhiteboardWbImport);
      if (wbEditorSnapshot.current !== snapshot) throw new Error("Dự án đã thay đổi khi kiểm tra bộ WB. Hãy xem trước lại.");
      const currentProject: WhiteboardProject = {
        id: projectId,
        schemaVersion: 1,
        revision: projectRevision,
        title: thumbnailTitle || "Dự án Whiteboard",
        fps,
        paperColor,
        handPath: resolveHandFilename(penType),
        scenes,
        speechConfig: {
          mode: speechMode,
          defaultVoiceId: selectedVoice,
          timingMode: autoTiming ? "auto" : "fixed",
          speakers,
        },
      };

      const proj = buildProjectFromWbImport(fresh, data.srtPath, currentProject);
      setProjectRevision(proj.revision);
      setOutputVideoPath("");
      setAudioFingerprint(null);
      setThumbnail(undefined);
      setThumbnailImagePath("");
      if (proj.title) setThumbnailTitle(proj.title);
      setScenes(proj.scenes);
      if (proj.speechConfig) {
        setSpeechMode(proj.speechConfig.mode);
        setSpeakers(proj.speechConfig.speakers);
        setSelectedVoice(proj.speechConfig.defaultVoiceId);
        setAutoTiming(proj.speechConfig.timingMode === "auto");
      }
      setSrtPath(data.srtPath);
      setMasterAudioPath("");
      setTtsSuccess(false);
      setSelectedSceneIndex(0);
      setWbImportModalData(null);

      setStatusMsg({
        text: `Đã nhập kịch bản Whiteboard thành công: ${proj.scenes.length} phân cảnh, ${fresh.cuesCount} câu thoại, ${fresh.speakers.length} nhân vật!`,
        ok: true,
      });
    } catch (e) {
      setStatusMsg({ text: `Không thể nhập bộ WB: ${errText(e)}`, ok: false });
    } finally {
      wbImportApplying.current = false;
      setLoading(false);
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

  const handleParseSrt = async (targetPath = srtPath) => {
    if (!targetPath) {
      setStatusMsg({ text: "Vui lòng chọn tệp SRT trước.", ok: false });
      return;
    }
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await api.parseWhiteboardSrt(targetPath, exactCues);

      // Tự động lập danh sách nhân vật (Character Bible của Whiteboard) từ nhãn SRT
      const detectedNames = new Set<string>();
      res.cues.forEach((c) => {
        if (c.speakerName && c.speakerName.trim()) {
          detectedNames.add(c.speakerName.trim());
        }
      });

      if (detectedNames.size > 0) {
        setSpeechMode("characters");
        const availableVoices = voices.length > 0 ? voices : [
          { id: "Thùy Dung", name: "Thùy Dung" },
          { id: "Hải Đăng", name: "Hải Đăng" },
          { id: "Trúc Ly", name: "Trúc Ly" },
          { id: "Thái Sơn", name: "Thái Sơn" },
          { id: "Quang Sơn", name: "Quang Sơn" },
        ];
        const newSpeakers: WhiteboardSpeaker[] = Array.from(detectedNames).map((name, idx) => {
          const defaultVoiceForChar = availableVoices[(idx + 1) % availableVoices.length]?.id || selectedVoice;
          return {
            id: `spk-${idx + 1}`,
            name,
            voiceId: defaultVoiceForChar,
          };
        });
        setSpeakers(newSpeakers);

        // Gán speakerId cho từng cue
        res.cues.forEach((c) => {
          if (c.speakerName) {
            const found = newSpeakers.find((s) => s.name.toLowerCase() === c.speakerName!.toLowerCase());
            if (found) c.speakerId = found.id;
          }
        });
      }

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
        subjectFirst: true,
        colorFill: "brush",
        inkPath: "grid",
      }));
      setScenes(initialScenes);
      setSrtPath(targetPath);
      setMasterAudioPath("");
      setOutputVideoPath("");
      setAudioFingerprint(null);
      setTtsSuccess(false);
      setProjectRevision(v => v + 1);
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
    if (autoTiming && (!scenes.length || scenes.some(s => !s.cues.length))) {
      setStatusMsg({ text: "Hãy Chia Cảnh từ SRT trước để giữ đúng cảnh và ảnh khi căn TTS.", ok: false });
      return;
    }
    const snapshot = JSON.stringify(scenes);
    const originalScenes = scenes;
    const inputSnapshot = ttsInputRef.current;
    setLoading(true);
    setGeneratingTts(true);
    setTtsSuccess(false);
    setStatusMsg(null);
    try {
      await annotationSaveQueue.current;
      const ranges = originalScenes.map(s => [s.cues[0]?.index, s.cues[s.cues.length - 1]?.index]);
      const allCues = originalScenes.flatMap((s) => s.cues);
      const currentSpeechConfig: WhiteboardSpeechConfig = {
        mode: speechMode,
        defaultVoiceId: selectedVoice,
        timingMode: autoTiming ? "auto" : "fixed",
        speakers,
      };

      const res = await api.generateWhiteboardSrtTts(
        srtPath,
        selectedVoice,
        autoTiming,
        autoTiming ? ranges : [],
        currentSpeechConfig,
        allCues
      );
      if (JSON.stringify(scenesRef.current) !== snapshot || ttsInputRef.current !== inputSnapshot) throw new Error("Cảnh đã thay đổi khi tạo TTS. Hãy tạo lại với phân cảnh mới.");
      if (autoTiming) {
        const next = applyAlignedTiming(originalScenes, res);
        for (const scene of next) {
          if (scene.annotationPath) {
            const retimed = await api.retimeWhiteboardAnnotation(scene.annotationPath, scene.durationMs, scene.speechEndMs!);
            scene.annotationPath = retimed.annotation_path;
            scene.elements = retimed.elements;
          }
        }
        if (JSON.stringify(scenesRef.current) !== snapshot || ttsInputRef.current !== inputSnapshot) throw new Error("Cảnh đã thay đổi. Timeline cũ được giữ nguyên; hãy tạo lại TTS.");
        setScenes(next);
        setSrtPath(res.aligned_srt_path!);
        setOutputVideoPath("");
        setProjectRevision(v => v + 1);
      }
      setMasterAudioPath(res.audio_path);
      setAudioFingerprint(computeCurrentSpeechFingerprint());
      setTtsSuccess(true);
      setStatusMsg({ text: `Đã tạo TTS (${res.duration_sec}s)${autoTiming ? ", căn lại cảnh và lịch vẽ; cần render lại" : ", giữ mốc SRT"}: ${res.audio_path}`, ok: true });
    } catch (e: any) {
      setTtsSuccess(false);
      setStatusMsg({ text: `Lỗi tạo giọng đọc từ SRT: ${errText(e)}`, ok: false });
    } finally {
      setGeneratingTts(false);
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSrtPath("");
    setProjectPath("");
    setProjectId("project-" + Date.now());
    setProjectRevision(1);
    setOutputVideoPath("");
    setMasterAudioPath("");
    setAudioFingerprint(null);
    setThumbnailTitle("");
    setThumbnailImagePath("");
    setThumbnail(undefined);
    setThumbnailFontError("");
    setScenes([
      {
        id: "scene-01",
        order: 1,
        revision: 1,
        imagePath: "",
        annotationPath: "",
        timelineStartMs: 0,
        timelineEndMs: 10000,
        durationMs: 10000,
        cues: [],
        status: "idle",
        subjectFirst: true,
        colorFill: "brush",
        inkPath: "grid",
      },
    ]);
    setSelectedSceneIndex(0);
    setSpeechMode("single");
    setSelectedVoice("Thùy Dung");
    setAutoTiming(true);
    setSpeakers([]);
    setStatusMsg({ text: "Đã làm mới bảng trắng về trạng thái ban đầu.", ok: true });
    setTtsSuccess(false);
    refreshEnv();
  };

  // Thao tác với danh sách cảnh
  const handleAddScene = () => {
    const nextNum = scenes.length + 1;
    const newScene: WhiteboardSceneItem = {
      id: `scene-${crypto.randomUUID()}`,
      order: nextNum,
      revision: 1,
      imagePath: "",
      annotationPath: "",
      timelineStartMs: 0,
      timelineEndMs: 10000,
      durationMs: 10000,
      cues: [],
      status: "idle",
      subjectFirst: true,
      colorFill: "brush",
      inkPath: "grid",
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

  const handleRandomStyle = () => {
    if (!activeScene) return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const mono = activeScene.imageType === "line_art_mono" || activeScene.imageType === "blank";
    const fills = ["brush", "contour-wipe", "palette-brush"] as const;
    updateActiveScene({ randomSeed: seed, styleMode: "random",
      inkPath: seed % 2 ? "skeleton" : "grid",
      colorFill: mono ? "none" : fills[Math.floor(seed / 2) % fills.length],
      inkWeight: mono ? 1 : 2, colorWeight: mono ? 0 : 1,
      status: "idle",
    });
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
        activeScene.cues.map(c => ({ ...c,
          startMs: c.startMs - activeScene.timelineStartMs,
          endMs: c.endMs - activeScene.timelineStartMs,
          speechEndMs: c.speechEndMs === undefined ? undefined : c.speechEndMs - activeScene.timelineStartMs,
        })),
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
  const handleUpdateElementMode = async (index: number, mode: "draw" | "instant" | "fade") => {
    if (!activeScene?.elements) return;
    const elements = activeScene.elements.map((e, i) => i === index ? { ...e, reveal: { ...e.reveal, mode } } : e);
    updateActiveScene({ elements, status: "idle", outputPath: undefined });
    await syncAnnotationElements(elements);
  };

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
    let cursor = Math.min(...list.map((item) => item.reveal.startMs));
    const reindexed = list.map((item, idx) => {
      const next = { ...item, sequence: idx + 1, reveal: { ...item.reveal, startMs: cursor } };
      cursor += item.reveal.durationMs;
      return next;
    });

    updateActiveScene({ elements: reindexed });
    await syncAnnotationElements(reindexed);
  };

  const handleSplitElement = async (index: number, count: number) => {
    if (!activeScene?.elements) return;
    const original = activeScene.elements[index];
    if (original.region.width < count * 2 || original.reveal.durationMs < count * 100) return;
    const parts = Array.from({ length: count }, (_, i) => {
      const x0 = Math.round(original.region.width * i / count);
      const x1 = Math.round(original.region.width * (i + 1) / count);
      const t0 = Math.round(original.reveal.durationMs * i / count);
      const t1 = Math.round(original.reveal.durationMs * (i + 1) / count);
      return { ...original, id: crypto.randomUUID(), label: `${original.label} (${i + 1})`,
        region: { ...original.region, x: original.region.x + x0, width: x1 - x0 },
        reveal: { ...original.reveal, startMs: original.reveal.startMs + t0, durationMs: t1 - t0 } };
    });
    const elements = [...activeScene.elements.slice(0, index), ...parts, ...activeScene.elements.slice(index + 1)]
      .map((element, i) => ({ ...element, sequence: i + 1 }));
    updateActiveScene({ elements, status: "idle" });
    await syncAnnotationElements(elements);
  };

  const handleRegionChange = async (index: number, key: "x" | "y" | "width" | "height", value: number) => {
    if (!activeScene?.elements || !Number.isFinite(value)) return;
    const elements = activeScene.elements.map((element, i) => i === index
      ? { ...element, region: { ...element.region, [key]: Math.max(key === "x" || key === "y" ? 0 : 1, Math.round(value)) } }
      : element);
    updateActiveScene({ elements, status: "idle" });
    await syncAnnotationElements(elements);
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
      const target = activeScene.annotationPath;
      const operation = annotationSaveQueue.current.catch(() => undefined)
        .then(() => api.saveWhiteboardAnnotation(target, payload));
      annotationSaveQueue.current = operation;
      await operation;
    } catch (e) {
      setStatusMsg({ text: `Không lưu được vùng vẽ: ${errText(e)}`, ok: false });
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
      await annotationSaveQueue.current;
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
      const handParam = resolveHandFilename(penType);
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
        activeScene.durationMs,
        activeScene.subjectFirst
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

    projectTitle = thumbnailTitle.trim() || projectTitle;
    const nextRevision = projectRevision + 1;
    const project: WhiteboardProject = {
      id: projectId,
      schemaVersion: 1,
      revision: nextRevision,
      title: projectTitle,
      fps,
      paperColor,
      handPath: resolveHandFilename(penType),
      speechConfig: {
        mode: speechMode,
        defaultVoiceId: selectedVoice,
        timingMode: autoTiming ? "auto" : "fixed",
        speakers,
        audioFingerprint: audioFingerprint || undefined,
      },
      thumbnail,
      thumbnailDraft: { title: thumbnailTitle, imagePath: thumbnailImagePath, fontChoice: thumbnailFontChoice },
      scenes,
      sourceSrtPath: srtPath || undefined,
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
      setPenType(resolvePenTypeFromPath(proj.handPath));
      setThumbnail(proj.thumbnail);
      setThumbnailFontChoice(normalizeCoverFontChoice(proj.thumbnailDraft?.fontChoice ?? proj.thumbnail?.fontChoice));
      setThumbnailTitle(proj.thumbnailDraft?.title ?? proj.thumbnail?.title ?? proj.title ?? "");
      setThumbnailImagePath(proj.thumbnailDraft?.imagePath ?? proj.thumbnail?.imagePath ?? "");
      setScenes(proj.scenes || []);
      setSrtPath(proj.sourceSrtPath || "");
      setMasterAudioPath(proj.masterAudioPath || "");
      setOutputVideoPath(proj.outputVideoPath || "");

      // Khôi phục speechConfig (nếu project cũ không có speechConfig thì reset sạch về single mode)
      if (proj.speechConfig) {
        setSpeechMode(proj.speechConfig.mode);
        setSelectedVoice(proj.speechConfig.defaultVoiceId || "Thùy Dung");
        setAutoTiming(proj.speechConfig.timingMode === "auto");
        setSpeakers(proj.speechConfig.speakers || []);
        setAudioFingerprint(proj.speechConfig.audioFingerprint || null);
      } else {
        setSpeechMode("single");
        setSelectedVoice("Thùy Dung");
        setAutoTiming(true);
        setSpeakers([]);
        setAudioFingerprint(null);
      }

      setSelectedSceneIndex(0);
      setStatusMsg({ text: `Đã mở dự án: ${path} (${proj.scenes?.length || 0} cảnh)`, ok: true });
    } catch (e: any) {
      setStatusMsg({ text: `Lỗi mở dự án: ${errText(e)}`, ok: false });
    }
  };

  // Thực thi render toàn bộ dự án
  const executeRenderProject = async (targetOut: string, resumeMode: boolean) => {
    try { await annotationSaveQueue.current; }
    catch (e) { setStatusMsg({ text: `Chưa lưu được annotation: ${errText(e)}`, ok: false }); return; }
    if (!thumbnailReady) {
      setStatusMsg({ text: "Hãy tạo hoặc tạo lại thumbnail và xem trước trước khi xuất dự án.", ok: false });
      return;
    }
    const project: WhiteboardProject = {
      id: projectId,
      schemaVersion: 1,
      revision: projectRevision,
      title: thumbnailTitle.trim() || "Whiteboard Project",
      fps,
      paperColor,
      handPath: resolveHandFilename(penType),
      speechConfig: {
        mode: speechMode,
        defaultVoiceId: selectedVoice,
        timingMode: autoTiming ? "auto" : "fixed",
        speakers,
        audioFingerprint: audioFingerprint || undefined,
      },
      thumbnail,
      thumbnailDraft: { title: thumbnailTitle, imagePath: thumbnailImagePath, fontChoice: thumbnailFontChoice },
      scenes: exportWithoutAudio.current ? scenes.map((scene) => ({ ...scene, audioPath: undefined })) : scenes,
      sourceSrtPath: srtPath || undefined,
      masterAudioPath: exportWithoutAudio.current ? undefined : masterAudioPath || undefined,
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
    exportWithoutAudio.current = forceNoAudio;
    if (!thumbnailReady) {
      setStatusMsg({ text: "Hãy tạo hoặc tạo lại thumbnail và xem trước trước khi xuất dự án.", ok: false });
      return;
    }
    if (scenes.length === 0) {
      setStatusMsg({ text: "Dự án chưa có phân cảnh nào.", ok: false });
      return;
    }

    if (masterAudioPath && !forceNoAudio) {
      if (audioFingerprint && !isTtsCurrent) {
        setStatusMsg({
          text: "Cấu hình giọng đọc/phân vai/câu thoại đã thay đổi so với file âm thanh master hiện tại. Vui lòng nhấn 'Tạo TTS' để đồng bộ lại trước khi xuất dự án.",
          ok: false,
        });
        return;
      }
      let cursor = 0;
      const mismatch = scenes.some((scene) => {
        const invalid = scene.timelineStartMs !== cursor || scene.timelineEndMs - scene.timelineStartMs !== scene.durationMs;
        cursor += scene.durationMs;
        return invalid;
      });
      if (mismatch) {
        setStatusMsg({ text: "Thứ tự/thời lượng cảnh không còn khớp master audio. Khôi phục timeline SRT hoặc bỏ master và gán audio riêng từng cảnh trước khi xuất.", ok: false });
        return;
      }
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
      <div style={{ display: "grid", gridTemplateColumns: "minmax(460px, 500px) minmax(0, 1fr)", gap: "16px" }}>
        {/* Cột 1: Danh sách Phân Cảnh */}
        <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: "10px", minWidth: 0, boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Layers size={16} color="var(--primary)" />
              <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>Phân Cảnh ({scenes.length})</h4>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                type="button"
                className="secondary-btn"
                onClick={handleOpenBatchImageModal}
                disabled={loading || scenes.length === 0}
                title="Quét thư mục nạp ảnh hàng loạt cho các phân cảnh (1.png, 2.jpg...)"
                style={{ padding: "4px 8px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}
              >
                <FolderDown size={13} /> Nạp ảnh thư mục
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setBatchAnnoModalOpen(true)}
                disabled={loading || scenes.length === 0}
                title="Tạo mẫu nét vẽ hoạt hình cho tất cả hoặc các cảnh còn thiếu"
                style={{ padding: "4px 8px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}
              >
                <Wand2 size={13} /> Tạo mẫu tất cả
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={handleAddScene}
                style={{ padding: "4px 8px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}
              >
                <Plus size={12} /> Thêm Cảnh
              </button>
            </div>
          </div>

          {/* Chọn Loại bút vẽ chung cho toàn bộ dự án & thumbnail */}
          <div style={{ background: "#ffffff", padding: "8px 10px", borderRadius: "6px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)", display: "flex", alignItems: "center", gap: "5px" }}>
              <PenTool size={13} color="var(--primary)" /> Loại bút vẽ toàn dự án:
            </label>
            <select
              aria-label="Loại bút vẽ toàn dự án"
              value={penType}
              onChange={(e) => setPenType(e.target.value as WhiteboardPenType)}
              style={{
                width: "100%",
                padding: "6px 8px",
                fontSize: "12px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                fontWeight: 500,
              }}
            >
              {WHITEBOARD_PEN_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name} ({opt.desc})
                </option>
              ))}
            </select>
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
              <button className="secondary-btn" disabled={loading || generatingTts} onClick={handlePickSrt} style={{ padding: "4px 8px", fontSize: "12px", flexShrink: 0 }}>
                Chọn
              </button>
              <button className="secondary-btn" onClick={() => handleParseSrt()} disabled={!srtPath || loading} style={{ padding: "4px 8px", fontSize: "12px", flexShrink: 0 }}>
                Chia Cảnh
              </button>
              <button
                className="secondary-btn"
                onClick={() => handleInspectAndImportWb()}
                disabled={!srtPath || loading}
                style={{ padding: "4px 8px", fontSize: "12px", flexShrink: 0, color: "#0284c7" }}
                title="Kiểm tra và nhập kịch bản đồng bộ từ tệp .wb.json"
              >
                Kịch bản WB
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

            <label style={{ fontSize: "12px" }}>
              <input type="checkbox" checked={autoTiming} disabled={loading || generatingTts}
                onChange={e => {
                  setAutoTiming(e.target.checked);
                  setTtsSuccess(false);
                }} />
              Tự căn thời lượng theo TTS (giữ nguyên cảnh và ảnh)
            </label>

            {/* Chế độ giọng đọc: Một giọng duy nhất hoặc Theo nhân vật */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#f1f5f9", padding: "4px 8px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <span style={{ fontSize: "11px", fontWeight: 600, color: "#475569" }}>Chế độ đọc:</span>
              <label style={{ fontSize: "11px", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="wb-speech-mode"
                  checked={speechMode === "single"}
                  onChange={() => {
                    setSpeechMode("single");
                    setTtsSuccess(false);
                  }}
                />
                Một giọng
              </label>
              <label style={{ fontSize: "11px", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="wb-speech-mode"
                  checked={speechMode === "characters"}
                  onChange={() => {
                    setSpeechMode("characters");
                    setTtsSuccess(false);
                  }}
                />
                Theo nhân vật ({speakers.length})
              </label>
            </div>

            {/* Bảng phân vai theo nhân vật (Character Bible của Whiteboard) */}
            {speechMode === "characters" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  background: "#f8fafc",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  padding: "8px",
                  fontSize: "11px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 600, color: "#334155" }}>
                  <span>Phân vai giọng đọc nhân vật</span>
                  <span style={{ fontSize: "10px", color: "#64748b" }}>Tự bóc tách từ [Tên]: trong SRT</span>
                </div>

                {speakers.length === 0 ? (
                  <div style={{ color: "#94a3b8", fontStyle: "italic", padding: "4px 0" }}>
                    Chưa phát hiện nhân vật. Nhấn “Chia Cảnh” từ file SRT có nhãn [Tên]: để nạp nhân vật.
                  </div>
                ) : (
                  speakers.map((spk, sIdx) => (
                    <div key={spk.id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontWeight: 600, minWidth: "80px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={spk.name}>
                        {spk.name}:
                      </span>
                      <select
                        value={spk.voiceId}
                        onChange={(e) => {
                          const updated = [...speakers];
                          updated[sIdx].voiceId = e.target.value;
                          setSpeakers(updated);
                          setTtsSuccess(false);
                        }}
                        style={{ flex: 1, minWidth: 0, padding: "3px 6px", fontSize: "11px", borderRadius: "4px", border: "1px solid #cbd5e1", background: "#ffffff" }}
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
                            <option value="Hải Đăng">Hải Đăng (Nam · Bắc)</option>
                            <option value="Trúc Ly">Trúc Ly (Nữ · Bắc)</option>
                            <option value="Thái Sơn">Thái Sơn (Nam · Nam)</option>
                            <option value="Quang Sơn">Quang Sơn (Nam · Trung)</option>
                          </>
                        )}
                      </select>
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={async () => {
                          try {
                            setPreviewingVoiceId(spk.voiceId);
                            const p = await api.previewTtsVoice(spk.voiceId, `Xin chào, tôi là ${spk.name}`);
                            if (p) {
                              const audio = new Audio(p);
                              audio.play();
                            }
                          } catch (err) {
                            console.error(err);
                          } finally {
                            setPreviewingVoiceId(null);
                          }
                        }}
                        disabled={previewingVoiceId === spk.voiceId}
                        style={{ padding: "2px 6px", fontSize: "10px", display: "inline-flex", alignItems: "center", gap: "2px" }}
                        title="Nghe thử giọng"
                      >
                        {previewingVoiceId === spk.voiceId ? <RefreshCw size={10} className="spin" /> : <Play size={10} />} Nghe
                      </button>
                    </div>
                  ))
                )}

                {/* Hàng người dẫn chuyện mặc định */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", borderTop: "1px dashed #e2e8f0", paddingTop: "4px" }}>
                  <span style={{ fontWeight: 600, minWidth: "80px", color: "#64748b" }} title="Các câu không có nhãn nhân vật">
                    Dẫn chuyện:
                  </span>
                  <select
                    value={selectedVoice}
                    onChange={(e) => {
                      setSelectedVoice(e.target.value);
                      setTtsSuccess(false);
                    }}
                    style={{ flex: 1, minWidth: 0, padding: "3px 6px", fontSize: "11px", borderRadius: "4px", border: "1px solid #cbd5e1", background: "#ffffff" }}
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
                        <option value="Hải Đăng">Hải Đăng (Nam · Bắc)</option>
                        <option value="Trúc Ly">Trúc Ly (Nữ · Bắc)</option>
                        <option value="Thái Sơn">Thái Sơn (Nam · Nam)</option>
                        <option value="Quang Sơn">Quang Sơn (Nam · Trung)</option>
                      </>
                    )}
                  </select>
                </div>
              </div>
            )}

            {/* Tạo giọng đọc VieNeu-TTS 1 chạm từ file SRT */}
            <div style={{ display: "flex", gap: "6px", alignItems: "center", width: "100%", boxSizing: "border-box" }}>
              {speechMode === "single" && (
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
              )}
              <button
                className="secondary-btn"
                onClick={handleGenerateSrtTts}
                disabled={!srtPath || generatingTts || loading}
                title="Tạo giọng đọc master từ toàn bộ nội dung SRT theo phân vai"
                style={{
                  flex: speechMode === "characters" ? 1 : undefined,
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
                ) : (ttsSuccess && isTtsCurrent) ? (
                  <Check size={13} color="#16a34a" />
                ) : (
                  <Mic size={12} />
                )}
                {generatingTts
                  ? "Đang tạo..."
                  : (ttsSuccess && isTtsCurrent)
                  ? "Đã tạo xong TTS"
                  : speechMode === "characters"
                  ? "Tạo TTS Theo Phân Vai"
                  : "Tạo TTS"}
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

              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <button className="secondary-btn" onClick={handleRandomStyle} disabled={loading || !activeScene.imageType || activeScene.imageType === "uncertain"}>
                  {activeScene.styleMode === "random" ? "Đổi kiểu ngẫu nhiên" : "Ngẫu nhiên phù hợp"}
                </button>
                <label style={{ fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={activeScene.subjectFirst !== undefined ? activeScene.subjectFirst : true}
                    onChange={(e) => updateActiveScene({ subjectFirst: e.target.checked })}
                  />
                  Tô chủ thể trước nền
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div>
                  <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>Nét vẽ (Ink Path):</label>
                  <select
                    value={activeScene.inkPath || "grid"}
                    onChange={(e) => updateActiveScene({ inkPath: e.target.value as any, styleMode: "manual" })}
                    style={{ width: "100%", padding: "4px 8px", fontSize: "12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff" }}
                  >
                    <option value="grid">Lưới ô vuông (Grid - Mặc định)</option>
                    <option value="skeleton">Khung xương bám nét (Skeleton)</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>Tô màu (Color Fill):</label>
                  <select
                    value={activeScene.colorFill || "brush"}
                    onChange={(e) => updateActiveScene({ colorFill: e.target.value as any, styleMode: "manual" })}
                    style={{ width: "100%", padding: "4px 8px", fontSize: "12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff" }}
                  >
                    <option value="brush">Quét cọ theo quỹ đạo (Brush)</option>
                    <option value="contour-wipe">Quét viền xuống (Contour-Wipe)</option>
                    <option value="none">Không tô (Chỉ vẽ nét - Tối ưu Line-Art)</option>
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

                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <button onClick={() => handleSplitElement(idx, 2)} disabled={loading}>Chia 2 cột</button>
                        <button onClick={() => handleSplitElement(idx, 3)} disabled={loading}>Chia 3 cột</button>
                        {(["x", "y", "width", "height"] as const).map((key) => (
                          <label key={key}>{key}: <input type="number" value={el.region[key]}
                            style={{ width: "60px" }} disabled={loading}
                            onChange={(e) => handleRegionChange(idx, key, Number(e.target.value))} /></label>
                        ))}
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

                        <select value={el.reveal.mode || "draw"} disabled={loading}
                          onChange={e => handleUpdateElementMode(idx, e.target.value as "draw" | "instant" | "fade")}
                          title="Cách hiện vùng: nền có thể hiện ngay, chỉ vẽ chi tiết quan trọng">
                          <option value="draw">Vẽ nét</option>
                          <option value="instant">Hiện ngay</option>
                          <option value="fade">Hiện nhanh</option>
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

            {/* Thời lượng & Cấu hình cảnh */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>Thời lượng cảnh (ms)</label>
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
            </div>

            {/* Phụ đề của cảnh nếu có */}
            {activeScene.cues.length > 0 && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>
                    Phụ đề & Nhân vật ({activeScene.cues.length} câu)
                  </label>
                  {speechMode === "characters" && (
                    <span style={{ fontSize: "11px", color: "#64748b" }}>
                      Có thể gán lại người nói cho từng câu
                    </span>
                  )}
                </div>
                <div style={{ maxHeight: "160px", overflowY: "auto", fontSize: "12px", background: "#ffffff", padding: "8px", borderRadius: "6px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {activeScene.cues.map((c: WhiteboardSrtCue, cueIdx: number) => {
                    return (
                      <div key={c.index || cueIdx} style={{ display: "flex", alignItems: "flex-start", gap: "6px", background: "#f8fafc", padding: "4px 6px", borderRadius: "4px", border: "1px solid #f1f5f9" }}>
                        <span style={{ color: "var(--primary)", fontWeight: 700, minWidth: "22px", fontSize: "11px", marginTop: "2px" }}>#{c.index}</span>
                        
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "12px", color: "#1e293b", wordBreak: "break-word" }}>
                            {c.spokenText || c.text}
                          </div>
                          {c.sourceText && c.sourceText !== c.spokenText && (
                            <div style={{ fontSize: "10px", color: "#94a3b8" }}>
                              Gốc: {c.sourceText}
                            </div>
                          )}
                        </div>

                        {/* Dropdown đổi người nói cho câu này khi ở chế độ Theo nhân vật */}
                        {speechMode === "characters" && (
                          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "4px" }}>
                            <select
                              value={c.speakerId || ""}
                              onChange={(e) => {
                                const newId = e.target.value || null;
                                const updatedCues = [...activeScene.cues];
                                const targetSpk = speakers.find((s) => s.id === newId);
                                updatedCues[cueIdx] = {
                                  ...updatedCues[cueIdx],
                                  speakerId: newId,
                                  speakerName: targetSpk ? targetSpk.name : null,
                                };
                                updateActiveScene({ cues: updatedCues });
                                setTtsSuccess(false);
                              }}
                              style={{
                                fontSize: "11px",
                                padding: "2px 4px",
                                borderRadius: "4px",
                                border: "1px solid #cbd5e1",
                                background: c.speakerId ? "#eff6ff" : "#ffffff",
                                color: c.speakerId ? "#1d4ed8" : "#475569",
                                fontWeight: c.speakerId ? 600 : 400,
                              }}
                              title="Người nói câu này"
                            >
                              <option value="">(Người dẫn chuyện)</option>
                              {speakers.map((spk) => (
                                <option key={spk.id} value={spk.id}>
                                  {spk.name} ({spk.voiceId})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })}
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

      {/* Phần Ảnh Bìa / Thumbnail (2 giây đầu) - Đặt dưới phần phân cảnh, chia 2 cột thẳng hàng đồng bộ */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid var(--border-color)",
          borderRadius: "10px",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          opacity: loading ? 0.7 : 1,
          pointerEvents: loading ? "none" : "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                background: "#eff6ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--primary)",
              }}
            >
              <ImageIcon size={16} />
            </div>
            <div>
              <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--text-main)" }}>
                Ảnh Bìa Dự Án (Thumbnail · 2 giây mở đầu)
              </h4>
              <p style={{ margin: 0, fontSize: "11px", color: "var(--text-muted)" }}>
                Ảnh tràn khung, tiêu đề phía trên. Font tiếng Việt offline, hiệu ứng theo bút và watermark xitrum-AI-studio. Thoại phân cảnh bắt đầu sau 2s ảnh bìa.
              </p>
            </div>
          </div>
          {thumbnail && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {isImportedThumbnail ? (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "#166534",
                    background: "#f0fdf4",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    border: "1px solid #bbf7d0",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <CheckCircle2 size={12} /> Bìa hoàn chỉnh (Imported)
                </span>
              ) : thumbnailReady ? (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "#166534",
                    background: "#f0fdf4",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    border: "1px solid #bbf7d0",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <CheckCircle2 size={12} /> Thumbnail sẵn sàng
                </span>
              ) : (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "#b45309",
                    background: "#fffbeb",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    border: "1px solid #fde68a",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <AlertCircle size={12} /> Bìa cần cập nhật · Nhấn tạo lại
                </span>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(460px, 500px) minmax(0, 1fr)",
            gap: "16px",
            alignItems: "start",
          }}
        >
          {/* Cột trái: Cấu hình thông số bìa (thẳng hàng chuẩn với Cột 1 Phân Cảnh) */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)", display: "block", marginBottom: "4px" }}>
                Tiêu đề ảnh bìa <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="text"
                maxLength={160}
                aria-label="Tiêu đề ảnh bìa"
                value={thumbnailTitle}
                onChange={(e) => setThumbnailTitle(e.target.value)}
                placeholder="VD: Tam Anh Chiến Lữ Bố · Hồi 5 Tam Quốc Diễn Nghĩa"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "7px 10px",
                  fontSize: "13px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                }}
              />
            </div>

            <div>
              <label htmlFor="wb-cover-font" style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Font tiêu đề</label>
              <select id="wb-cover-font" value={thumbnailFontChoice} disabled={loading}
                onChange={(e) => setThumbnailFontChoice(e.target.value as WhiteboardFontChoice)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }}>
                <option value="auto">Tự động theo bút ({resolveCoverFont(penType).label})</option>
                {THUMBNAIL_FONTS.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
              </select>
              <div style={{ fontFamily: coverFont.family, fontWeight: coverFont.weight, fontSize: 24, padding: "8px 0", lineHeight: 1.5 }}>
                {thumbnailTitle.trim() || "Tiếng Việt · Trường Giang · Lữ Bố"}
              </div>
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>
                Font dùng offline, đủ dấu tiếng Việt. Hiệu ứng theo bút; chọn “Tự động theo bút” để font đổi cùng bút. Nhấn tạo lại thumbnail để áp dụng.
              </p>
              {thumbnailFontError && <span role="alert" style={{ color: "#b91c1c", fontSize: 12 }}>{thumbnailFontError}</span>}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div style={{ background: "#f8fafc", padding: "6px 10px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>
                  Bút vẽ theo dự án:
                </span>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--primary)" }}>
                  {WHITEBOARD_PEN_OPTIONS.find((opt) => opt.id === penType)?.name || "Bút tiêu chuẩn"}
                </span>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)", display: "block", marginBottom: "4px" }}>
                  Nguồn ảnh minh họa bìa
                </label>
                <div style={{ display: "flex", gap: "4px" }}>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={handlePickCoverImage}
                    style={{ flex: 1, padding: "5px 8px", fontSize: "11px", justifyContent: "center", whiteSpace: "nowrap" }}
                  >
                    Chọn ảnh riêng
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setThumbnailImagePath("")}
                    title="Dùng ảnh của phân cảnh đầu tiên làm minh họa bìa"
                    style={{ flex: 1, padding: "5px 8px", fontSize: "11px", justifyContent: "center", whiteSpace: "nowrap" }}
                  >
                    Cảnh đầu
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={handlePickCompleteThumbnail}
                    title="Nhập ảnh bìa hoàn chỉnh (16:9 hoặc 9:16) mà không cần ghép chữ lại"
                    style={{ flex: 1.2, padding: "5px 8px", fontSize: "11px", justifyContent: "center", whiteSpace: "nowrap" }}
                  >
                    Nhập bìa hoàn chỉnh
                  </button>
                </div>
              </div>
            </div>

            {isImportedThumbnail && (
              <div
                style={{
                  fontSize: "12px",
                  color: "#166534",
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: "6px",
                  padding: "6px 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <CheckCircle2 size={14} />
                <span>
                  Đang dùng ảnh bìa hoàn chỉnh (Imported). Khi xuất video, ảnh này được chèn trực tiếp 2 giây đầu mà không cần ghép thêm chữ.
                </span>
              </div>
            )}

            <div
              style={{
                fontSize: "11px",
                color: "#64748b",
                background: "#f8fafc",
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid #e2e8f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <span style={{ fontWeight: 500, color: "#475569" }}>Ảnh đang dùng:</span>
              <span
                style={{
                  fontFamily: "monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: coverSource ? "#1e293b" : "#94a3b8",
                }}
                title={coverSource || "Chưa có ảnh minh họa"}
              >
                {coverSource ? coverSource.split(/[/\\]/).pop() : "Chưa chọn (sẽ lấy cảnh #1)"}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
              <button
                type="button"
                className="primary-btn"
                onClick={handleCreateThumbnail}
                disabled={loading || !thumbnailTitle.trim() || !coverSource}
                style={{
                  padding: "7px 14px",
                  fontSize: "12px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Sparkles size={14} />
                {thumbnail ? "Tạo lại Thumbnail" : "Tạo Thumbnail"}
              </button>
              {thumbnail && (
                <a
                  href={thumbnail.pngDataUrl}
                  download="thumbnail.png"
                  className="secondary-btn"
                  style={{
                    padding: "6px 12px",
                    fontSize: "12px",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <Download size={13} /> Tải ảnh PNG
                </a>
              )}
            </div>
          </div>

          {/* Cột phải: Khung hiển thị xem trước trực quan Thumbnail (thẳng hàng với Cột 2 Chi Tiết Cảnh) */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "10px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b" }}>
                Xem trước {thumbnail?.aspectRatio === "9:16" ? "(Dọc 9:16)" : "(Ngang 16:9)"} · Tiêu đề phía trên
              </span>
              {thumbnail && (
                <span style={{ fontSize: "10px", color: "#059669", background: "#dcfce7", padding: "1px 6px", borderRadius: "3px", fontWeight: 600 }}>
                  {thumbnail.aspectRatio === "9:16" ? "Portrait 720×1280" : "HD 1280×720"}
                </span>
              )}
            </div>

            {thumbnail ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  width: "100%",
                  minHeight: "220px",
                  background: "#f1f5f9",
                  borderRadius: "6px",
                  padding: "8px",
                }}
              >
                <div
                  style={{
                    width: thumbnail.aspectRatio === "9:16" ? "auto" : "100%",
                    height: thumbnail.aspectRatio === "9:16" ? "320px" : "auto",
                    aspectRatio: thumbnail.aspectRatio === "9:16" ? "9 / 16" : "16 / 9",
                    maxWidth: "100%",
                    borderRadius: "6px",
                    overflow: "hidden",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                  }}
                >
                  <img
                    src={thumbnail.pngDataUrl}
                    alt="Xem trước thumbnail đã tạo"
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                  />
                </div>
              </div>
            ) : (
              <div
                style={{
                  width: "100%",
                  aspectRatio: "16 / 9",
                  borderRadius: "6px",
                  border: "1px dashed #cbd5e1",
                  background: "#ffffff",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  color: "var(--text-muted)",
                }}
              >
                <ImageIcon size={28} color="#94a3b8" />
                <span style={{ fontSize: "12px" }}>Nhấn “Tạo Thumbnail” để xem trước</span>
              </div>
            )}
          </div>
        </div>
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

      {/* Modal 4: Nhập Kịch Bản Whiteboard Schema 3 (.wb.json) */}
      {wbImportModalData && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.6)",
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
              borderRadius: "12px",
              padding: "22px",
              maxWidth: "560px",
              width: "100%",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            {scenes.length > 0 && (
              <label style={{ display: "flex", gap: "8px", color: "#92400e", fontSize: "13px" }}>
                <input type="checkbox" checked={wbReplaceConfirmed} disabled={loading}
                  onChange={e => setWbReplaceConfirmed(e.target.checked)} />
                Tôi đồng ý thay toàn bộ cảnh hiện tại. Hãy lưu dự án trước nếu cần giữ ảnh và chỉnh sửa cũ.
              </label>
            )}
            {wbImportModalData.inspect.valid ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#0284c7" }}>
                  <BookOpen size={24} />
                  <div>
                    <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
                      Phát hiện kịch bản Whiteboard đồng bộ (.wb.json)
                    </h3>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>
                      Schema {wbImportModalData.inspect.schemaVersion} · {wbImportModalData.inspect.scenesCount} cảnh · {wbImportModalData.inspect.speechMode === "single" ? "Một giọng" : "Nhiều giọng"} · Khớp SHA-256 với {wbImportModalData.srtPath.split("/").pop()}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    fontSize: "13px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#64748b" }}>Tiêu đề kịch bản:</span>
                    <strong style={{ color: "#0f172a" }}>
                      {wbImportModalData.inspect.title || "Chưa đặt tiêu đề"}
                    </strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#64748b" }}>Cấu trúc phân cảnh:</span>
                    <strong style={{ color: "#0f172a" }}>
                      {wbImportModalData.inspect.scenesCount} phân cảnh (1 cảnh = 1 ảnh minh họa)
                    </strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#64748b" }}>Tổng số câu thoại:</span>
                    <strong style={{ color: "#0f172a" }}>
                      {wbImportModalData.inspect.cuesCount} câu ({(wbImportModalData.inspect.durationMs / 1000).toFixed(1)} giây)
                    </strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#64748b" }}>Chế độ đọc thoại:</span>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: "12px",
                        fontSize: "11px",
                        fontWeight: 600,
                        backgroundColor:
                          wbImportModalData.inspect.speechMode === "characters" ? "#dbeafe" : "#f1f5f9",
                        color:
                          wbImportModalData.inspect.speechMode === "characters" ? "#1e40af" : "#475569",
                      }}
                    >
                      {wbImportModalData.inspect.speechMode === "characters"
                        ? "Phân vai nhiều nhân vật"
                        : "Một giọng"}
                    </span>
                  </div>
                </div>

                {wbImportModalData.inspect.speakers.length > 0 && (
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                      Danh mục nhân vật phát hiện ({wbImportModalData.inspect.speakers.length}):
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {wbImportModalData.inspect.speakers.map((sp) => (
                        <div
                          key={sp.id}
                          style={{
                            fontSize: "12px",
                            padding: "4px 8px",
                            borderRadius: "6px",
                            background: "#e0f2fe",
                            border: "1px solid #bae6fd",
                            color: "#0369a1",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <strong>{sp.name}</strong>
                          <span style={{ color: "#0284c7", fontSize: "11px" }}>({sp.voiceId})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {wbImportModalData.inspect.warnings && wbImportModalData.inspect.warnings.length > 0 && (
                  <div
                    style={{
                      backgroundColor: "#fefce8",
                      border: "1px solid #fef08a",
                      borderRadius: "6px",
                      padding: "8px 10px",
                      fontSize: "12px",
                      color: "#854d0e",
                    }}
                  >
                    {wbImportModalData.inspect.warnings.map((w, idx) => (
                      <div key={idx}>⚠️ {w}</div>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "8px",
                    marginTop: "8px",
                    borderTop: "1px solid #f1f5f9",
                    paddingTop: "12px",
                  }}
                >
                  <button
                    className="secondary-btn"
                    disabled={loading || (scenes.length > 0 && !wbReplaceConfirmed)}
                    onClick={() => {
                      if (loading || (scenes.length > 0 && !wbReplaceConfirmed)) return;
                      const path = wbImportModalData.srtPath;
                      setWbImportModalData(null);
                      void handleParseSrt(path);
                    }}
                    style={{ padding: "8px 14px", fontSize: "13px" }}
                  >
                    Chỉ chia cảnh theo SRT
                  </button>
                  <button className="secondary-btn" disabled={loading}
                    onClick={() => setWbImportModalData(null)}>Hủy nhập</button>
                  <button
                    className="primary-btn"
                    disabled={loading || generatingTts || (scenes.length > 0 && !wbReplaceConfirmed)}
                    onClick={() => void handleApplyWbImport(wbImportModalData)}
                    style={{
                      padding: "8px 16px",
                      fontSize: "13px",
                      backgroundColor: "#0284c7",
                      borderColor: "#0369a1",
                    }}
                  >
                    Nhập theo phân cảnh từ WB (Khuyên dùng)
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#dc2626" }}>
                  <AlertCircle size={24} />
                  <div>
                    <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
                      {wbImportError.title}
                    </h3>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>
                      Không thể nhập bộ WB theo metadata hiện tại
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    fontSize: "12px",
                    color: "#991b1b",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  {wbImportModalData.inspect.errors.map((err, idx) => (
                    <div key={idx}>• {err}</div>
                  ))}
                </div>

                <p style={{ margin: 0, fontSize: "13px", color: "#475569", lineHeight: 1.5 }}>
                  {wbImportError.description}
                </p>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "8px",
                    marginTop: "8px",
                    borderTop: "1px solid #f1f5f9",
                    paddingTop: "12px",
                  }}
                >
                  <button
                    className="secondary-btn"
                    disabled={loading}
                    onClick={() => setWbImportModalData(null)}
                    style={{ padding: "8px 14px", fontSize: "13px" }}
                  >
                    Hủy bỏ
                  </button>
                  <button
                    className="primary-btn"
                    disabled={loading || (scenes.length > 0 && !wbReplaceConfirmed)}
                    onClick={() => {
                      if (loading || (scenes.length > 0 && !wbReplaceConfirmed)) return;
                      const path = wbImportModalData.srtPath;
                      setWbImportModalData(null);
                      void handleParseSrt(path);
                    }}
                    style={{
                      padding: "8px 16px",
                      fontSize: "13px",
                      backgroundColor: "#f59e0b",
                      borderColor: "#d97706",
                    }}
                  >
                    Tiếp tục chỉ dùng phụ đề SRT
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal 5: Nạp ảnh phân cảnh hàng loạt từ thư mục */}
      {batchScanModalOpen && batchScanResult && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
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
              borderRadius: "12px",
              padding: "20px 24px",
              maxWidth: "850px",
              width: "100%",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--primary)" }}>
                <FolderDown size={24} />
                <div>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--text-main)" }}>
                    Nạp ảnh phân cảnh hàng loạt từ thư mục
                  </h3>
                  <div style={{ fontSize: "12px", color: "#64748b", fontFamily: "monospace", marginTop: "2px" }}>
                    {batchScanResult.folderPath}
                  </div>
                </div>
              </div>
              <button
                className="icon-btn"
                onClick={() => setBatchScanModalOpen(false)}
                title="Đóng"
                style={{ padding: "4px" }}
              >
                <XCircle size={18} />
              </button>
            </div>

            {/* Options & Stats bar */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "10px 14px",
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 500, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={batchOverwriteExisting}
                  onChange={(e) => handleToggleBatchOverwrite(e.target.checked)}
                />
                Thay ảnh các cảnh đã có ảnh minh họa
              </label>

              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
                <span style={{ background: "#dcfce7", color: "#166534", padding: "2px 8px", borderRadius: "4px", fontWeight: 600 }}>
                  Khớp: {batchScanResult.matchedScenesCount}/{batchScanResult.mappings.length} cảnh
                </span>
                {batchScanResult.excessImages.length > 0 && (
                  <span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: "4px" }}>
                    {batchScanResult.excessImages.length} ảnh dư
                  </span>
                )}
                {batchScanResult.ignoredFiles.length > 0 && (
                  <span style={{ background: "#f1f5f9", color: "#475569", padding: "2px 8px", borderRadius: "4px" }}>
                    {batchScanResult.ignoredFiles.length} file bỏ qua
                  </span>
                )}
              </div>
            </div>

            {/* Mappings Table */}
            <div style={{ border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden", maxHeight: "320px", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
                <thead style={{ background: "#f1f5f9", position: "sticky", top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: "8px 10px", width: "40px", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={
                          batchScanResult.mappings.length > 0 &&
                          batchScanResult.mappings.every((m) => {
                            const hasValid = Boolean(m.matchedImage || (m.candidateImages && m.candidateImages.length > 0));
                            return !hasValid || batchSelectedRows[m.sceneIndex];
                          })
                        }
                        onChange={(e) => {
                          const checkAll = e.target.checked;
                          setBatchSelectedRows((prev) => {
                            const next = { ...prev };
                            batchScanResult.mappings.forEach((m) => {
                              const hasValid = Boolean(m.matchedImage || (m.candidateImages && m.candidateImages.length > 0));
                              if (hasValid) next[m.sceneIndex] = checkAll;
                            });
                            return next;
                          });
                        }}
                      />
                    </th>
                    <th style={{ padding: "8px 10px" }}>Cảnh</th>
                    <th style={{ padding: "8px 10px" }}>Ảnh đang dùng</th>
                    <th style={{ padding: "8px 10px" }}>Ảnh mới phát hiện</th>
                    <th style={{ padding: "8px 10px", width: "130px" }}>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {batchScanResult.mappings.map((mapping) => {
                    const scene = scenes[mapping.sceneIndex];
                    const isSelected = Boolean(batchSelectedRows[mapping.sceneIndex]);
                    const hasCandidates = mapping.candidateImages && mapping.candidateImages.length > 0;
                    const canSelect = Boolean(mapping.matchedImage || hasCandidates);

                    return (
                      <tr
                        key={mapping.sceneIndex}
                        style={{
                          borderTop: "1px solid #f1f5f9",
                          background: isSelected ? "#f0fdf4" : "transparent",
                        }}
                      >
                        <td style={{ padding: "8px 10px", textAlign: "center" }}>
                          <input
                            type="checkbox"
                            disabled={!canSelect}
                            checked={isSelected}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setBatchSelectedRows((prev) => ({
                                ...prev,
                                [mapping.sceneIndex]: checked,
                              }));
                            }}
                          />
                        </td>
                        <td style={{ padding: "8px 10px", fontWeight: 600 }}>
                          #{mapping.sceneIndex + 1}
                          <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 400, marginLeft: "4px" }}>
                            ({scene ? (scene.durationMs / 1000).toFixed(1) + "s" : ""})
                          </span>
                        </td>
                        <td style={{ padding: "8px 10px", color: mapping.currentImagePath ? "#1e293b" : "#94a3b8" }}>
                          {mapping.currentImagePath ? mapping.currentImagePath.split(/[/\\]/).pop() : "(Chưa có)"}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {mapping.status === "duplicate" && hasCandidates ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              <select
                                value={batchChosenDuplicates[mapping.sceneIndex] || mapping.candidateImages[0].path}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setBatchChosenDuplicates((prev) => ({
                                    ...prev,
                                    [mapping.sceneIndex]: val,
                                  }));
                                }}
                                style={{
                                  padding: "4px 6px",
                                  fontSize: "12px",
                                  borderRadius: "4px",
                                  border: "1px solid #cbd5e1",
                                  maxWidth: "260px",
                                }}
                              >
                                {mapping.candidateImages.map((c) => (
                                  <option key={c.path} value={c.path}>
                                    {c.filename} {c.width && c.height ? `(${c.width}x${c.height})` : ""}
                                  </option>
                                ))}
                              </select>
                              <span style={{ fontSize: "11px", color: "#b45309" }}>
                                Trùng số thứ tự: vui lòng chọn 1 ảnh để gán
                              </span>
                            </div>
                          ) : mapping.matchedImage ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                                {mapping.matchedImage.filename}
                              </span>
                              {mapping.matchedImage.width && mapping.matchedImage.height && (
                                <span style={{ fontSize: "11px", color: "#64748b" }}>
                                  ({mapping.matchedImage.width}×{mapping.matchedImage.height})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: "#94a3b8", fontStyle: "italic" }}>
                              (Không có ảnh khớp)
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {mapping.status === "ready" && (
                            <span style={{ background: "#dcfce7", color: "#166534", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", fontWeight: 600 }}>
                              Sẵn sàng
                            </span>
                          )}
                          {mapping.status === "duplicate" && (
                            <span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", fontWeight: 600 }}>
                              Trùng tên
                            </span>
                          )}
                          {mapping.status === "missing" && (
                            <span style={{ background: "#f1f5f9", color: "#64748b", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>
                              Thiếu ảnh
                            </span>
                          )}
                          {mapping.status === "error" && (
                            <span style={{ background: "#fee2e2", color: "#991b1b", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", fontWeight: 600 }} title={mapping.error}>
                              Lỗi ảnh
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Thumbnail Candidate Selection */}
            {batchScanResult.thumbnailCandidates.length > 0 && (
              <div
                style={{
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600, fontSize: "13px", color: "#1e40af" }}>
                  <ImageIcon size={16} /> Phát hiện ảnh bìa (Thumbnail):
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px", fontSize: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ color: "#475569" }}>Chọn file:</span>
                    <select
                      value={batchChosenThumbnail || ""}
                      onChange={(e) => setBatchChosenThumbnail(e.target.value || null)}
                      style={{ padding: "4px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                    >
                      {batchScanResult.thumbnailCandidates.map((c) => (
                        <option key={c.path} value={c.path}>
                          {c.filename} {c.width && c.height ? `(${c.width}×${c.height} · ${c.aspectRatio || ""})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="batchThumbnailMode"
                        value="imported"
                        checked={batchThumbnailMode === "imported"}
                        onChange={() => setBatchThumbnailMode("imported")}
                      />
                      <span>Bìa hoàn chỉnh (không phủ chữ)</span>
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="batchThumbnailMode"
                        value="generated"
                        checked={batchThumbnailMode === "generated"}
                        onChange={() => setBatchThumbnailMode("generated")}
                      />
                      <span>Ảnh minh họa (ghép chữ trong app)</span>
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="batchThumbnailMode"
                        value="none"
                        checked={batchThumbnailMode === "none"}
                        onChange={() => setBatchThumbnailMode("none")}
                      />
                      <span>Không dùng</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Extra files info */}
            {(batchScanResult.excessImages.length > 0 || batchScanResult.ignoredFiles.length > 0) && (
              <div style={{ fontSize: "11px", color: "#64748b", display: "flex", flexDirection: "column", gap: "2px" }}>
                {batchScanResult.excessImages.length > 0 && (
                  <div>
                    • <strong>Ảnh vượt quá số cảnh:</strong>{" "}
                    {batchScanResult.excessImages.map((e) => e.filename).join(", ")}
                  </div>
                )}
                {batchScanResult.ignoredFiles.length > 0 && (
                  <div>
                    • <strong>File bỏ qua (không theo quy tắc tên số):</strong>{" "}
                    {batchScanResult.ignoredFiles.join(", ")}
                  </div>
                )}
              </div>
            )}

            {/* Footer Buttons */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", borderTop: "1px solid #e2e8f0", paddingTop: "12px" }}>
              <button
                className="secondary-btn"
                onClick={() => setBatchScanModalOpen(false)}
                style={{ padding: "7px 14px", fontSize: "13px" }}
              >
                Hủy
              </button>
              <button
                className="primary-btn"
                onClick={handleApplyBatchImages}
                disabled={Object.values(batchSelectedRows).filter(Boolean).length === 0}
                style={{ padding: "7px 16px", fontSize: "13px" }}
              >
                Áp dụng cho {Object.values(batchSelectedRows).filter(Boolean).length} cảnh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 6: Tạo mẫu nét vẽ hoạt hình hàng loạt */}
      {batchAnnoModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
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
              borderRadius: "12px",
              padding: "20px 24px",
              maxWidth: "540px",
              width: "100%",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--primary)", borderBottom: "1px solid #e2e8f0", paddingBottom: "10px" }}>
              <Wand2 size={24} />
              <div>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--text-main)" }}>
                  Tạo mẫu nét vẽ hoạt hình hàng loạt
                </h3>
                <div style={{ fontSize: "12px", color: "#64748b" }}>
                  Tự động phân tích ảnh và sinh lịch vẽ annotation theo thời gian thoại
                </div>
              </div>
            </div>

            {!isBatchAnnotating ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="batchAnnoMode"
                      value="missing"
                      checked={batchAnnoMode === "missing"}
                      onChange={() => setBatchAnnoMode("missing")}
                      style={{ marginTop: "3px" }}
                    />
                    <div>
                      <strong>Chỉ tạo mẫu cho các cảnh còn thiếu (Khuyến nghị)</strong>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>
                        Bỏ qua các cảnh đã có annotation để bảo toàn các chỉnh sửa vùng vẽ trước đó.
                      </div>
                    </div>
                  </label>

                  <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="batchAnnoMode"
                      value="all"
                      checked={batchAnnoMode === "all"}
                      onChange={() => setBatchAnnoMode("all")}
                      style={{ marginTop: "3px" }}
                    />
                    <div>
                      <strong>Tạo lại toàn bộ các cảnh đã có ảnh minh họa</strong>
                      <div style={{ fontSize: "12px", color: "#b45309" }}>
                        Lưu ý: Sẽ tính toán lại nét vẽ và ghi đè toàn bộ các vùng vẽ đã chỉnh sửa thủ công.
                      </div>
                    </div>
                  </label>
                </div>

                <div
                  style={{
                    backgroundColor: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "10px 14px",
                    fontSize: "12px",
                    color: "#475569",
                  }}
                >
                  <div>
                    • Tổng số cảnh có ảnh: <strong>{scenes.filter((s) => Boolean(s.imagePath)).length}/{scenes.length}</strong>
                  </div>
                  <div>
                    • Cảnh chưa có annotation:{" "}
                    <strong>{scenes.filter((s) => Boolean(s.imagePath) && (!s.annotationPath || !s.elements || s.elements.length === 0)).length}</strong>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", borderTop: "1px solid #e2e8f0", paddingTop: "12px" }}>
                  <button
                    className="secondary-btn"
                    onClick={() => setBatchAnnoModalOpen(false)}
                    style={{ padding: "7px 14px", fontSize: "13px" }}
                  >
                    Hủy
                  </button>
                  <button
                    className="primary-btn"
                    onClick={handleStartBatchAnnotation}
                    style={{ padding: "7px 16px", fontSize: "13px" }}
                  >
                    Bắt đầu tạo mẫu
                  </button>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main)" }}>
                  Đang tạo mẫu cảnh {batchAnnoProgress?.current}/{batchAnnoProgress?.total} ({batchAnnoProgress?.currentSceneId})...
                </div>

                <div style={{ width: "100%", height: "8px", borderRadius: "4px", background: "#e2e8f0", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${batchAnnoProgress ? (batchAnnoProgress.current / batchAnnoProgress.total) * 100 : 0}%`,
                      height: "100%",
                      background: "var(--primary)",
                      transition: "width 0.2s",
                    }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#64748b" }}>
                  <span>Thành công: <strong style={{ color: "#166534" }}>{batchAnnoProgress?.success || 0}</strong></span>
                  <span>Lỗi: <strong style={{ color: "#991b1b" }}>{batchAnnoProgress?.error || 0}</strong></span>
                </div>

                {batchAnnoProgress && batchAnnoProgress.errors.length > 0 && (
                  <div style={{ maxHeight: "100px", overflowY: "auto", fontSize: "11px", color: "#991b1b", background: "#fef2f2", padding: "6px 8px", borderRadius: "4px" }}>
                    {batchAnnoProgress.errors.map((e, idx) => (
                      <div key={idx}>• {e.sceneId}: {e.error}</div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6px" }}>
                  <button
                    className="secondary-btn"
                    onClick={() => {
                      batchAnnoCancelRequested.current = true;
                    }}
                    style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", fontSize: "12px", color: "#b91c1c" }}
                  >
                    <StopCircle size={14} /> Dừng sau cảnh hiện tại
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
