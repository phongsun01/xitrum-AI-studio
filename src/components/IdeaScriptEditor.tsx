import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Copy,
  Check,
  ClipboardPaste,
  User,
  Image as ImageIcon,
  CheckCircle,
  Trash2,
  Edit2,
  Film,
  FolderOpen,
  Volume2,
  Mic,
  Play,
  RotateCw,
  Send,
  Video,
  FileText,
  Eye,
  Music,
  Lock,
  Unlock,
  Package,
} from "lucide-react";
import { api, ScriptProjectItem, CharacterItem, ProductItem, ScriptSceneItem } from "../api";

interface Props {
  onAddToast: (type: "success" | "error" | "info" | "warn", message: string) => void;
  onRefreshTasks?: () => void;
  onNavigateToQueue?: () => void;
}

interface VoiceItem {
  id: string;
  name: string;
  gender: string;
  region: string;
}

export const IdeaScriptEditor: React.FC<Props> = ({ onAddToast, onRefreshTasks, onNavigateToQueue }) => {
  // Form input ý tưởng
  const [ideaText, setIdeaText] = useState("");
  const [genre, setGenre] = useState("Kể chuyện");
  const [durationSec, setDurationSec] = useState(30);
  const [ratio, setRatio] = useState("16:9");

  // State kịch bản
  const [jsonInput, setJsonInput] = useState("");
  const [currentScript, setCurrentScript] = useState<ScriptProjectItem | null>(null);
  const [scriptsList, setScriptsList] = useState<ScriptProjectItem[]>([]);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<"input" | "review" | "history">("input");
  const [dispatchingQueue, setDispatchingQueue] = useState(false);

  // Hậu kỳ FFmpeg State (Mốc 5)
  const [renderingPostproduction, setRenderingPostproduction] = useState(false);
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [renderedResult, setRenderedResult] = useState<{
    video_path: string;
    srt_path: string;
    has_tts: boolean;
    has_bgm: boolean;
    burned_subtitles: boolean;
  } | null>(null);

  // VieNeu-TTS State (Mốc 2)
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [ttsGeneratingSceneId, setTtsGeneratingSceneId] = useState<string | null>(null);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);

  // Phase 3: Analyzing state
  const [analyzingTarget, setAnalyzingTarget] = useState<string | null>(null);

  const CAMERA_MOVES = [
    { id: "drone", label: "Flycam / Drone", en: "aerial drone shot" },
    { id: "slow_motion", label: "Slow motion", en: "slow motion" },
    { id: "dolly_in", label: "Dolly in", en: "dolly in" },
    { id: "pan", label: "Lia máy ngang", en: "panning shot" },
    { id: "orbit", label: "Quay vòng", en: "orbit shot" },
    { id: "tracking", label: "Bám theo", en: "tracking shot" },
    { id: "handheld", label: "Cầm tay", en: "handheld" },
    { id: "timelapse", label: "Time-lapse", en: "time-lapse" },
    { id: "static", label: "Cố định", en: "static shot" },
    { id: "crane", label: "Cần cẩu lên", en: "crane shot" },
  ];

  const STYLES = [
    { id: "default", label: "Mặc định", en: "" },
    { id: "cinematic", label: "Điện ảnh", en: "cinematic, film grain" },
    { id: "documentary", label: "Tài liệu", en: "documentary, realistic" },
    { id: "commercial", label: "Quảng cáo", en: "high-end commercial" },
    { id: "anime", label: "Anime", en: "2D anime style" },
    { id: "vintage", label: "Phim cổ", en: "vintage film" },
    { id: "dreamy", label: "Mộng mơ", en: "dreamy, soft light" },
    { id: "noir", label: "Noir", en: "black and white noir" },
  ];

  const getFinalPreviewPrompt = (scene: ScriptSceneItem): string => {
    let base = (scene.video_prompt || scene.visual_prompt || "").trim();
    if (!currentScript) return base;

    // Character description
    if (scene.character) {
      const char = currentScript.characters.find(
        (c) => c.name.trim().toLowerCase() === scene.character?.trim().toLowerCase()
      );
      if (char && char.description && !base.includes(char.description)) {
        base += `, Character: ${char.description}`;
      }
    }

    // Camera & Style
    const parts: string[] = [];
    if (scene.camera_moves) {
      for (const m of scene.camera_moves) {
        const item = CAMERA_MOVES.find((cm) => cm.id === m);
        if (item && item.en && !base.toLowerCase().includes(item.en.toLowerCase())) {
          parts.push(item.en);
        }
      }
    }
    if (scene.style && scene.style !== "default") {
      const sItem = STYLES.find((st) => st.id === scene.style);
      if (sItem && sItem.en && !base.toLowerCase().includes(sItem.en.toLowerCase())) {
        parts.push(sItem.en);
      }
    }
    if (parts.length > 0) {
      base += `, ${parts.join(", ")}`;
    }

    // Lock descriptors
    if (scene.character) {
      const char = currentScript.characters.find(
        (c) => c.name.trim().toLowerCase() === scene.character?.trim().toLowerCase()
      );
      if (char?.identity_lock_en && !base.includes(char.identity_lock_en)) {
        base += `\n\nCharacter — keep exactly the same in every scene:\n${char.identity_lock_en}`;
      }
    }

    if (scene.product_id && currentScript.products) {
      const prod = currentScript.products.find((p) => p.id === scene.product_id);
      if (prod?.product_lock_en && !base.includes(prod.product_lock_en)) {
        base += `\n\nProduct — keep exactly the same in every scene:\n${prod.product_lock_en}`;
      }
    }

    if (currentScript.environment_lock_en && !base.includes(currentScript.environment_lock_en)) {
      base += `\n\nSetting — keep exactly the same in every scene:\n${currentScript.environment_lock_en}`;
    }

    return base;
  };

  // Tạo prompt ảnh chuyên dụng cho Whiteboard (Line-art, sạch, nền trắng tinh, nét vẽ mực rõ ràng)
  const getWhiteboardPrompt = (scene: ScriptSceneItem): string => {
    const desc = scene.visual_prompt || scene.narration || "";
    const cleanDesc = desc.replace(/^(Cảnh \d+:|Scene \d+:)\s*/i, "").trim();
    return `Minimalist clean whiteboard line art sketch of ${cleanDesc}, black ink on pure solid white background, high contrast vector style, continuous outline contour, 2D minimalist explainer illustration, no shading, no gradients, no photorealism, isolated on white`;
  };

  // Load danh sách kịch bản & danh sách giọng đọc
  const loadScripts = async () => {
    try {
      const list = await api.listScriptProjects();
      setScriptsList(list);
    } catch (e: any) {
      console.error(e);
    }
  };

  const loadTtsVoices = async () => {
    try {
      const v = await api.listTtsVoices();
      setVoices(v);
    } catch (e: any) {
      console.error("Lỗi nạp giọng VieNeu-TTS:", e);
    }
  };

  useEffect(() => {
    loadScripts();
    loadTtsVoices();
  }, []);

  // Mẫu Prompt dùng chung chuẩn 100% từ ke-hoach-y-tuong-video.md
  const generatePromptText = () => {
    return `Hãy viết kịch bản video theo ý tưởng sau, trả về đúng định dạng JSON, không giải thích thêm ngoài JSON.

Ý tưởng: ${ideaText.trim() || "[Chưa nhập ý tưởng]"}
Thể loại: ${genre}
Thời lượng: ${durationSec} giây
Tỷ lệ khung hình: ${ratio}
Ngôn ngữ lời thoại: tiếng Việt có dấu, ngắn gọn, mỗi cảnh 1 ý chính.

Yêu cầu JSON:
{
  "title": "tên video",
  "characters": [
    {"name": "tên nhân vật", "description": "mô tả ngoại hình, trang phục cố định", "voice": "nam/nữ/trẻ em"}
  ],
  "scenes": [
    {
      "scene_no": 1,
      "narration": "lời thoại của cảnh này",
      "visual_prompt": "prompt tạo ảnh, tiếng Anh, mô tả cảnh + nhân vật",
      "video_prompt": "prompt tạo video, tiếng Anh, mô tả chuyển động",
      "character": "tên nhân vật chính của cảnh",
      "duration_sec": 5
    }
  ]
}

Quy tắc: tổng thời lượng các cảnh bằng thời lượng đã chọn, nhân vật giống nhau ở mọi cảnh, lời thoại khớp với thời lượng từng cảnh.`;
  };

  // Sao chép prompt
  const handleCopyPrompt = async () => {
    if (!ideaText.trim()) {
      onAddToast("warn", "Vui lòng nhập ý tưởng trước khi sao chép mẫu prompt!");
      return;
    }
    const prompt = generatePromptText();
    await navigator.clipboard.writeText(prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2500);
    onAddToast("success", "Đã sao chép mẫu prompt! Hãy dán vào ChatGPT / Claude / Gemini.");
  };

  // Phân tích JSON kịch bản
  const handleParseJson = async () => {
    if (!jsonInput.trim()) {
      onAddToast("warn", "Vui lòng dán nội dung JSON kịch bản vào ô trống!");
      return;
    }

    try {
      let cleaned = jsonInput.trim();

      // Bỏ markdown code block nếu có
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```[a-z]*\s*/i, "").replace(/```$/, "").trim();
      }

      // Xóa các ký tự BOM, zero-width space hoặc ký tự ẩn thường gặp khi copy từ web
      cleaned = cleaned.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");

      // Tự động chuẩn hóa dấu ngoặc kép thông minh (smart quotes: “ ” „ « ») thành dấu ngoặc kép chuẩn (")
      cleaned = cleaned.replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"');

      // Tự động chuẩn hóa dấu nháy đơn thông minh (‘ ’) thành (')
      cleaned = cleaned.replace(/[\u2018\u2019]/g, "'");

      // Nếu người dùng copy kèm text trước hoặc sau JSON, tự tìm block {...} ngoài cùng
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      }

      const parsed = JSON.parse(cleaned);

      if (!parsed.title || !Array.isArray(parsed.scenes)) {
        throw new Error("JSON thiếu trường 'title' hoặc 'scenes'. Vui lòng kiểm tra lại cấu trúc JSON!");
      }

      if (parsed.scenes.length === 0) {
        throw new Error("Kịch bản phải có ít nhất 1 phân cảnh (scenes không được rỗng)!");
      }

      // S8: Kiểm tra chi tiết từng scene và tổng thời lượng
      const seenSceneNos = new Set<number>();
      for (let i = 0; i < parsed.scenes.length; i++) {
        const s = parsed.scenes[i];
        const sNo = Number(s.scene_no) || (i + 1);
        if (seenSceneNos.has(sNo)) {
          throw new Error(`Trùng lặp số thứ tự cảnh: Cảnh số ${sNo}`);
        }
        seenSceneNos.add(sNo);

        const dur = Number(s.duration_sec);
        if (isNaN(dur) || dur <= 0) {
          throw new Error(`Thời lượng cảnh ${sNo} không hợp lệ (phải > 0 giây, nhận được: ${s.duration_sec})`);
        }

        const narration = (s.narration || "").trim();
        const visual = (s.visual_prompt || s.video_prompt || "").trim();
        if (!narration && !visual) {
          throw new Error(`Cảnh ${sNo} không có lời thoại lẫn mô tả hình ảnh.`);
        }
      }

      const scriptId = `script_${Date.now()}`;
      const now = Date.now();

      const defaultVoice = voices[0]?.id || "hn_female_thao";

      const characters: CharacterItem[] = (parsed.characters || []).map(
        (c: any, idx: number) => {
          let chosenVoice = defaultVoice;
          const desc = `${c.name || ""} ${c.description || ""} ${c.voice || ""}`.toLowerCase();
          
          // S8: Ánh xạ giọng thông minh theo giới tính và nhóm tuổi
          if (desc.includes("trẻ em") || desc.includes("bé") || desc.includes("con nít") || desc.includes("child")) {
            chosenVoice = voices.find((v) => v.id.includes("child") || v.id.includes("be"))?.id || "hn_female_thao";
          } else if (desc.includes("nam") || desc.includes("ông") || desc.includes("chú") || desc.includes("anh") || desc.includes("male")) {
            chosenVoice = voices.find((v) => v.gender === "male")?.id || "hn_male_tuan";
          } else {
            chosenVoice = voices.find((v) => v.gender === "female")?.id || "hn_female_thao";
          }

          return {
            id: `char_${scriptId}_${idx + 1}`,
            name: c.name || `Nhân vật ${idx + 1}`,
            description: c.description || "",
            voice: chosenVoice,
            ref_image_path: null,
            created_at: now + idx,
          };
        }
      );

      const scenes: ScriptSceneItem[] = parsed.scenes.map((s: any, idx: number) => ({
        id: `scene_${scriptId}_${idx + 1}`,
        script_id: scriptId,
        scene_no: s.scene_no || idx + 1,
        narration: s.narration || "",
        visual_prompt: s.visual_prompt || "",
        video_prompt: s.video_prompt || "",
        character: s.character || null,
        duration_sec: Number(s.duration_sec) || 5,
        ref_image_path: null,
        audio_path: null,
        video_path: null,
        queue_task_id: null,
      }));

      const newScript: ScriptProjectItem = {
        id: scriptId,
        title: parsed.title,
        idea: ideaText.trim() || null,
        genre,
        target_duration_sec: durationSec,
        ratio,
        status: "draft",
        created_at: now,
        updated_at: now,
        characters,
        scenes,
      };

      await api.saveScriptProject(newScript);
      setCurrentScript(newScript);
      setActiveSubTab("review");
      loadScripts();
      onAddToast("success", `Đã nạp kịch bản "${newScript.title}" với ${scenes.length} phân cảnh!`);
    } catch (e: any) {
      onAddToast("error", `Lỗi phân tích JSON: ${e.message}`);
    }
  };

  // Chọn ảnh tham chiếu cho Character
  const handleSelectRefImage = async (charId: string) => {
    try {
      const selected = await api.pickFile([
        { name: "Hình ảnh", extensions: ["png", "jpg", "jpeg", "webp"] },
      ]);
      if (selected && currentScript) {
        await api.updateCharacterRefImage(charId, selected);
        const updated = await api.getScriptProject(currentScript.id);
        if (updated) setCurrentScript(updated);
        onAddToast("success", "Đã gán ảnh tham chiếu cho nhân vật!");
      }
    } catch (e: any) {
      onAddToast("error", `Lỗi chọn ảnh: ${e.message}`);
    }
  };

  // Thay đổi giọng đọc của nhân vật
  const handleUpdateCharVoice = (charId: string, voiceId: string) => {
    if (!currentScript) return;
    const updatedChars = currentScript.characters.map((c) => {
      if (c.id === charId) {
        return { ...c, voice: voiceId };
      }
      return c;
    });
    setCurrentScript({ ...currentScript, characters: updatedChars });
  };

  // Nghe thử giọng đọc (Preview Voice Sample)
  const handlePreviewVoice = async (voiceId: string) => {
    setPreviewingVoiceId(voiceId);
    try {
      const audioPath = await api.previewTtsVoice(voiceId);
      const audio = new Audio(`https://asset.localhost/${audioPath.replace(/\\/g, "/")}`);
      audio.play();
      onAddToast("info", "Đang phát âm thanh thử giọng đọc...");
    } catch (e: any) {
      onAddToast("error", `Lỗi nghe thử giọng: ${e.message}`);
    } finally {
      setPreviewingVoiceId(null);
    }
  };

  // Tạo giọng đọc cho 1 cảnh cụ thể (VieNeu-TTS)
  const handleGenerateTtsForScene = async (scene: ScriptSceneItem) => {
    if (!currentScript) return;
    if (!scene.narration.trim()) {
      onAddToast("warn", `Cảnh #${scene.scene_no} chưa có lời thoại!`);
      return;
    }

    // Tìm giọng đọc gán cho nhân vật của cảnh này
    let voiceId = voices[0]?.id || "hn_female_thao";
    if (scene.character) {
      const char = currentScript.characters.find(
        (c) => c.name.toLowerCase() === scene.character?.toLowerCase()
      );
      if (char?.voice) {
        voiceId = char.voice;
      }
    }

    setTtsGeneratingSceneId(scene.id);
    try {
      const res = await api.generateSceneTts(scene.id, scene.narration, voiceId, 1.0);
      handleUpdateSceneField(scene.id, "audio_path", res.audio_path);
      handleUpdateSceneField(scene.id, "duration_sec", res.duration_sec);

      // Lưu cập nhật vào DB
      await api.updateScriptScene({
        ...scene,
        audio_path: res.audio_path,
        duration_sec: res.duration_sec,
      });

      onAddToast("success", `Đã tạo giọng đọc cho Cảnh #${scene.scene_no} (Thời lượng: ${res.duration_sec}s)!`);
    } catch (e: any) {
      onAddToast("error", `Lỗi tạo giọng đọc: ${e.message}`);
    } finally {
      setTtsGeneratingSceneId(null);
    }
  };

  // Tạo giọng đọc cho toàn bộ kịch bản
  const handleGenerateAllTts = async () => {
    if (!currentScript) return;
    onAddToast("info", "Bắt đầu tạo giọng đọc tự động cho toàn bộ kịch bản...");
    for (const scene of currentScript.scenes) {
      await handleGenerateTtsForScene(scene);
    }
    const updated = await api.getScriptProject(currentScript.id);
    if (updated) setCurrentScript(updated);
    onAddToast("success", "Hoàn tất tạo giọng đọc cho tất cả các cảnh!");
  };

  // Sửa trường thông tin cảnh
  const handleUpdateSceneField = (
    sceneId: string,
    field: keyof ScriptSceneItem,
    val: any
  ) => {
    if (!currentScript) return;
    const updatedScenes = currentScript.scenes.map((s) => {
      if (s.id === sceneId) {
        return { ...s, [field]: val };
      }
      return s;
    });
    setCurrentScript({ ...currentScript, scenes: updatedScenes });
  };

  // Lưu lại kịch bản sau khi sửa
  const handleSaveReviewedScript = async () => {
    if (!currentScript) return;
    try {
      const toSave = { ...currentScript, status: "reviewed" as const, updated_at: Date.now() };
      await api.saveScriptProject(toSave);
      setCurrentScript(toSave);
      loadScripts();
      onAddToast("success", "Đã lưu kịch bản duyệt thành công!");
    } catch (e: any) {
      onAddToast("error", `Lỗi lưu kịch bản: ${e.message}`);
    }
  };

  // Mốc 4: Đẩy toàn bộ kịch bản vào hàng đợi sinh video (Queue)
  const handleDispatchToQueue = async () => {
    if (!currentScript) return;
    if (currentScript.scenes.length === 0) {
      onAddToast("warn", "Kịch bản chưa có phân cảnh nào để tạo video!");
      return;
    }

    try {
      setDispatchingQueue(true);
      // Lưu lại thay đổi hiện tại trước khi đẩy
      await api.saveScriptProject({ ...currentScript, status: "reviewed", updated_at: Date.now() });

      const res = await api.dispatchScriptToQueue(currentScript.id);
      if (res.ok) {
        onAddToast(
          "success",
          `🚀 Đã đẩy thành công ${res.queued_count} cảnh kịch bản vào Hàng Đợi (Queue)!`
        );
        // Refresh danh sách tasks ngoài app
        if (onRefreshTasks) onRefreshTasks();
        // Load lại kịch bản để thấy queue_task_id
        const reloaded = await api.getScriptProject(currentScript.id);
        if (reloaded) setCurrentScript(reloaded);
        // Chuyển hướng sang tab Queue nếu người dùng muốn
        if (onNavigateToQueue) {
          onNavigateToQueue();
        }
      }
    } catch (e: any) {
      onAddToast("error", `Lỗi đẩy vào hàng đợi: ${e.message}`);
    } finally {
      setDispatchingQueue(false);
    }
  };

  // Mốc 5: Hậu kỳ hoàn chỉnh (FFmpeg Merge: Clips + TTS Audio + BGM ducking + SRT Subtitles)
  const handleRenderPostproduction = async (mode: "preview" | "final" = "preview") => {
    if (!currentScript) return;
    if (currentScript.scenes.length === 0) {
      onAddToast("warn", "Kịch bản không có phân cảnh nào để xuất!");
      return;
    }

    try {
      setRenderingPostproduction(true);
      onAddToast("info", mode === "final" ? "Đang xuất bản Final (kiểm tra đầy đủ video cảnh)..." : "Đang tạo bản Preview xem thử...");

      const res = await api.renderScriptPostproduction(currentScript.id, burnSubtitles, mode);
      if (res.ok) {
        setRenderedResult(res);
        if (res.mode === "final") {
          onAddToast("success", "🎬 Xuất bản Final video thành công 100%!");
        } else {
          onAddToast("success", `🎬 Tạo bản Preview thành công! ${res.placeholder_count ? `(${res.placeholder_count} cảnh dùng slide tạm)` : ""}`);
        }
        loadScripts();
      }
    } catch (e: any) {
      onAddToast("error", `Lỗi xuất video hậu kỳ: ${e.message}`);
    } finally {
      setRenderingPostproduction(false);
    }
  };

  // Xóa kịch bản
  const handleDeleteScript = async (id: string) => {
    if (!confirm("Bạn có chắc muốn xóa kịch bản này?")) return;
    try {
      await api.deleteScriptProject(id);
      if (currentScript?.id === id) setCurrentScript(null);
      loadScripts();
      onAddToast("info", "Đã xóa kịch bản.");
    } catch (e: any) {
      onAddToast("error", `Lỗi xóa: ${e.message}`);
    }
  };

  return (
    <div className="panel-card">
      {/* Sub Tabs đồng nhất với style chung */}
      <div style={{ display: "flex", gap: "10px", borderBottom: "1px solid var(--border-color)", paddingBottom: "14px", marginBottom: "20px" }}>
        <button
          className={activeSubTab === "input" ? "primary-btn" : "secondary-btn"}
          onClick={() => setActiveSubTab("input")}
        >
          <Sparkles size={16} /> 1. Ý Tưởng & Kịch Bản
        </button>
        <button
          className={activeSubTab === "review" ? "primary-btn" : "secondary-btn"}
          onClick={() => setActiveSubTab("review")}
          disabled={!currentScript}
          style={{ opacity: !currentScript ? 0.5 : 1, cursor: !currentScript ? "not-allowed" : "pointer" }}
        >
          <Film size={16} /> 2. Character Bible & Duyệt Kịch Bản {currentScript && `(${currentScript.scenes.length} cảnh)`}
        </button>
        <button
          className={activeSubTab === "history" ? "primary-btn" : "secondary-btn"}
          onClick={() => setActiveSubTab("history")}
        >
          <FolderOpen size={16} /> Lịch Sử Kịch Bản ({scriptsList.length})
        </button>
      </div>

      {/* SUBTAB 1: INPUT Ý TƯỞNG & COPY PROMPT */}
      {activeSubTab === "input" && (
        <div>
          <h3>✨ Khởi Tạo Kịch Bản Video Từ Ý Tưởng</h3>
          <p className="panel-desc">
            Nhập ý tưởng ngắn gọn, bấm <b>Sao chép mẫu Prompt</b> rồi dán cho bất kỳ Chatbot nào (ChatGPT, Claude, Gemini). Sau đó dán kịch bản JSON trả về vào đây.
          </p>

          <div className="form-group">
            <label>Ý tưởng video của bạn:</label>
            <textarea
              rows={3}
              placeholder="Ví dụ: Kể chuyện chú mèo đi lạc giữa thành phố mưa, tìm được đường về nhà nhờ mùi bánh mì thơm..."
              value={ideaText}
              onChange={(e) => setIdeaText(e.target.value)}
            />
          </div>

          <div className="form-row" style={{ marginBottom: "16px" }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Thể loại kịch bản:</label>
              <select value={genre} onChange={(e) => setGenre(e.target.value)}>
                <option value="Kể chuyện">Kể chuyện / Tâm sự</option>
                <option value="Bán hàng">Quảng cáo / Bán hàng (Affiliate)</option>
                <option value="Giải thích">Giải thích kiến thức / Tin tức</option>
                <option value="Hài hước">Hài hước / Drama kịch tính</option>
              </select>
            </div>

            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Thời lượng mong muốn:</label>
              <select
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value))}
              >
                <option value={15}>15 giây (Story / Shorts ngắn)</option>
                <option value={30}>30 giây (TikTok / Reels tiêu chuẩn)</option>
                <option value={60}>60 giây (Kịch bản chi tiết)</option>
                <option value={90}>90 giây (Kể chuyện dài)</option>
              </select>
            </div>

            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Tỷ lệ khung hình:</label>
              <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                <option value="9:16">9:16 (Dọc - TikTok, Reels, Shorts)</option>
                <option value="16:9">16:9 (Ngang - YouTube, Facebook)</option>
                <option value="1:1">1:1 (Vuông - Instagram feed)</option>
              </select>
            </div>

            <div className="form-group" style={{ flex: 1.2, marginBottom: 0, justifyContent: "flex-end" }}>
              <label style={{ visibility: "hidden" }}>Sao chép:</label>
              <button
                className="primary-btn"
                style={{ height: "42px", justifyContent: "center" }}
                onClick={handleCopyPrompt}
              >
                {copiedPrompt ? <Check size={16} /> : <Copy size={16} />}
                {copiedPrompt ? "Đã sao chép!" : "Sao chép Prompt Chatbot"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: "24px", paddingTop: "18px", borderTop: "1px solid var(--border-color)" }}>
            <div className="form-group">
              <label>📥 Dán kết quả JSON kịch bản nhận được từ Chatbot:</label>
              <textarea
                rows={7}
                placeholder="Dán toàn bộ kết quả JSON từ ChatGPT/Claude vào đây..."
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                style={{ fontFamily: "monospace", fontSize: "13px" }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
              <button
                className="primary-btn"
                style={{ backgroundColor: "#16a34a" }}
                onClick={handleParseJson}
              >
                <ClipboardPaste size={16} /> Nạp Kịch Bản Vào Studio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 2: CHARACTER BIBLE & REVIEW KỊCH BẢN */}
      {activeSubTab === "review" && currentScript && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
            <div>
              <h3>🎬 Kịch Bản: {currentScript.title}</h3>
              <p className="panel-desc" style={{ marginBottom: 0 }}>
                Thể loại: <b>{currentScript.genre}</b> • Tỷ lệ: <b>{currentScript.ratio}</b> • Thời lượng: <b>{currentScript.target_duration_sec}s</b> • Trạng thái: <span style={{ color: "#16a34a", fontWeight: 600 }}>{currentScript.status}</span>
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                className="secondary-btn"
                style={{ borderColor: "#16a34a", color: "#16a34a" }}
                onClick={handleGenerateAllTts}
                title="Tạo giọng đọc VieNeu-TTS cho tất cả phân cảnh"
              >
                <Mic size={15} /> Tạo Giọng Đọc Tất Cả Cảnh
              </button>
              <button className="secondary-btn" onClick={handleSaveReviewedScript}>
                <CheckCircle size={15} /> Lưu Kịch Bản
              </button>
              <button
                className="secondary-btn"
                style={{ backgroundColor: "#eff6ff", borderColor: "#3b82f6", color: "#1d4ed8" }}
                onClick={handleDispatchToQueue}
                disabled={dispatchingQueue}
              >
                {dispatchingQueue ? <RotateCw size={15} className="spin" /> : <Send size={15} />}
                {dispatchingQueue ? "Đang đẩy..." : "🚀 Đẩy Vào Queue"}
              </button>
              <button
                className="secondary-btn"
                style={{ backgroundColor: "#f0fdf4", borderColor: "#10b981", color: "#047857" }}
                onClick={() => handleRenderPostproduction("preview")}
                disabled={renderingPostproduction}
                title="Tạo nhanh bản xem thử (chấp nhận slide màu nếu cảnh chưa có video)"
              >
                {renderingPostproduction ? <RotateCw size={15} className="spin" /> : <Eye size={15} />}
                {renderingPostproduction ? "Đang xuất..." : "👁️ Xem Thử (Preview)"}
              </button>
              <button
                className="primary-btn"
                style={{ backgroundColor: "#059669" }}
                onClick={() => handleRenderPostproduction("final")}
                disabled={renderingPostproduction}
                title="Xuất bản cuối cùng (yêu cầu tất cả các cảnh phải có video thật)"
              >
                {renderingPostproduction ? <RotateCw size={15} className="spin" /> : <Video size={15} />}
                {renderingPostproduction ? "Đang xuất..." : "🎬 Xuất Bản Final"}
              </button>
            </div>
          </div>

          {/* HẬU KỲ THÀNH PHẨM (MỐC 5 PREVIEW BANNER) */}
          {renderedResult && (
            <div
              style={{
                background: "#ecfdf5",
                border: "1px solid #a7f3d0",
                borderRadius: "10px",
                padding: "16px",
                marginBottom: "20px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <b style={{ color: "#065f46", fontSize: "15px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <CheckCircle size={18} /> Video Thành Phẩm Đã Sẵn Sàng!
                </b>
                <span style={{ fontSize: "12px", color: "#047857" }}>
                  {renderedResult.burned_subtitles ? "✓ Đã gắn phụ đề cứng (Hardsub)" : ""}
                  {renderedResult.has_bgm ? " • ✓ Đã hòa nhạc nền BGM ducking" : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: "300px" }}>
                  <video
                    controls
                    src={`https://asset.localhost/${renderedResult.video_path.replace(/\\/g, "/")}`}
                    style={{ width: "100%", maxHeight: "240px", borderRadius: "8px", background: "#000" }}
                  />
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ fontSize: "13px", color: "#1f2937" }}>
                    <b>File video:</b> <code style={{ fontSize: "12px" }}>{renderedResult.video_path}</code>
                  </div>
                  <div style={{ fontSize: "13px", color: "#1f2937" }}>
                    <b>File phụ đề:</b> <code style={{ fontSize: "12px" }}>{renderedResult.srt_path}</code>
                  </div>
                  <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                    <button
                      className="primary-btn"
                      style={{ padding: "6px 14px", fontSize: "13px" }}
                      onClick={() => {
                        // Mở file video bằng trình phát mặc định
                        window.open(`https://asset.localhost/${renderedResult.video_path.replace(/\\/g, "/")}`);
                      }}
                    >
                      <Play size={14} /> Mở Toàn Màn Hình
                    </button>
                    <button
                      className="secondary-btn"
                      style={{ padding: "6px 14px", fontSize: "13px" }}
                      onClick={() => setRenderedResult(null)}
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CẤU HÌNH TÙY CHỌN HẬU KỲ */}
          <div
            style={{
              background: "#f8fafc",
              padding: "12px 16px",
              borderRadius: "8px",
              border: "1px solid var(--border-color)",
              marginBottom: "18px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={burnSubtitles}
                  onChange={(e) => setBurnSubtitles(e.target.checked)}
                />
                <FileText size={15} style={{ color: "var(--primary)" }} /> Tự động sinh & Burn phụ đề tiếng Việt (SRT Hardsub)
              </label>
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px" }}>
              <Music size={14} /> Tự động ghép Nhạc nền (BGM Ducking) nếu thư mục nhạc được cấu hình trong Cài Đặt
            </div>
          </div>

          {/* CHARACTER BIBLE */}
          <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "10px", border: "1px solid var(--border-color)", marginBottom: "20px" }}>
            <h4 style={{ display: "flex", alignItems: "center", gap: "8px", margin: "0 0 12px 0", fontSize: "14px", color: "#0f172a" }}>
              <User size={16} style={{ color: "var(--primary)" }} /> Character Bible (Dàn Nhân Vật, Gán Giọng & Ảnh Khuôn Mặt Cố Định)
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "12px" }}>
              {currentScript.characters.map((char) => (
                <div
                  key={char.id}
                  style={{
                    background: "white",
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                    padding: "12px",
                    display: "flex",
                    gap: "12px",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  }}
                >
                  <div
                    style={{
                      width: "64px",
                      height: "64px",
                      borderRadius: "8px",
                      background: "#f1f5f9",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                      border: "1px dashed #cbd5e1",
                      flexShrink: 0,
                    }}
                  >
                    {char.ref_image_path ? (
                      <img
                        src={`https://asset.localhost/${char.ref_image_path.replace(/\\/g, "/")}`}
                        alt={char.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <ImageIcon size={22} style={{ color: "#94a3b8" }} />
                    )}
                  </div>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <b style={{ fontSize: "14px", color: "#1e293b" }}>{char.name}</b>
                      <button
                        className="secondary-btn"
                        style={{ padding: "2px 6px", fontSize: "11px" }}
                        onClick={() => handlePreviewVoice(char.voice || "hn_female_thao")}
                        title="Nghe thử giọng này"
                      >
                        {previewingVoiceId === char.voice ? <RotateCw size={12} className="spin" /> : <Volume2 size={12} />} Nghe thử
                      </button>
                    </div>

                    {/* Chọn giọng đọc VieNeu */}
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <label style={{ fontSize: "11px", color: "var(--text-muted)" }}>Giọng:</label>
                      <select
                        style={{ flex: 1, fontSize: "12px", padding: "3px 6px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                        value={char.voice || ""}
                        onChange={(e) => handleUpdateCharVoice(char.id, e.target.value)}
                      >
                        {voices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0, lineHeight: 1.3 }}>
                      {char.description || "Chưa có mô tả ngoại hình"}
                    </p>

                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        className="secondary-btn"
                        style={{ padding: "4px 8px", fontSize: "12px" }}
                        onClick={() => handleSelectRefImage(char.id)}
                      >
                        {char.ref_image_path ? "Đổi ảnh" : "+ Chọn ảnh"}
                      </button>

                      {char.ref_image_path && (
                        <button
                          className="secondary-btn"
                          style={{ padding: "4px 8px", fontSize: "12px", color: "var(--primary)" }}
                          disabled={analyzingTarget === char.id}
                          onClick={async () => {
                            setAnalyzingTarget(char.id);
                            try {
                              const key = localStorage.getItem("xitrum_gemini_api_key");
                              const res = await api.analyzeImage(char.ref_image_path!, "character", key);
                              if (res.ok && res.descriptor) {
                                const updated = currentScript.characters.map((ch) =>
                                  ch.id === char.id ? { ...ch, identity_lock_en: res.descriptor, locked: true } : ch
                                );
                                const newScript = { ...currentScript, characters: updated };
                                setCurrentScript(newScript);
                                await api.saveScriptProject(newScript);
                                onAddToast("success", "Đã phân tích và khóa đặc điểm nhân vật!");
                              } else {
                                onAddToast("error", res.message);
                              }
                            } catch (e: any) {
                              onAddToast("error", "Lỗi phân tích: " + e);
                            } finally {
                              setAnalyzingTarget(null);
                            }
                          }}
                        >
                          <Sparkles size={12} className={analyzingTarget === char.id ? "spin" : ""} />
                          {analyzingTarget === char.id ? "Đang phân tích..." : "Phân tích ảnh"}
                        </button>
                      )}

                      {char.identity_lock_en && (
                        <button
                          className="secondary-btn"
                          style={{ padding: "4px 8px", fontSize: "12px", color: char.locked ? "#16a34a" : "#ca8a04" }}
                          onClick={async () => {
                            const updated = currentScript.characters.map((ch) =>
                              ch.id === char.id ? { ...ch, locked: !ch.locked } : ch
                            );
                            const newScript = { ...currentScript, characters: updated };
                            setCurrentScript(newScript);
                            await api.saveScriptProject(newScript);
                            onAddToast("info", char.locked ? "Đã mở khóa nhân vật" : "Đã khóa nhân vật!");
                          }}
                        >
                          {char.locked ? <Lock size={12} /> : <Unlock size={12} />}
                          {char.locked ? "Đã khóa" : "Mở khóa"}
                        </button>
                      )}
                    </div>

                    {/* Câu khóa mặt (Lock Descriptor) */}
                    <div style={{ marginTop: "6px" }}>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569" }}>
                        🔒 Khóa Ngoại Hình (Identity Lock - Tiếng Anh):
                      </label>
                      <textarea
                        rows={2}
                        readOnly={char.locked}
                        style={{
                          width: "100%",
                          fontSize: "11px",
                          fontFamily: "monospace",
                          background: char.locked ? "#f1f5f9" : "white",
                          border: "1px solid #cbd5e1",
                          borderRadius: "4px",
                          padding: "4px",
                        }}
                        placeholder="Câu mô tả tiếng Anh cố định (ví dụ: A 25-year-old Vietnamese woman, long black hair...)"
                        value={char.identity_lock_en || ""}
                        onChange={(e) => {
                          const updated = currentScript.characters.map((ch) =>
                            ch.id === char.id ? { ...ch, identity_lock_en: e.target.value } : ch
                          );
                          setCurrentScript({ ...currentScript, characters: updated });
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* PRODUCTS SECTION (PHASE 3) */}
          <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "10px", border: "1px solid var(--border-color)", marginBottom: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h4 style={{ display: "flex", alignItems: "center", gap: "8px", margin: 0, fontSize: "14px", color: "#0f172a" }}>
                <Package size={16} style={{ color: "var(--primary)" }} /> Danh Sách Sản Phẩm & Khóa Chi Tiết Bao Bì
              </h4>
              <button
                className="secondary-btn"
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={async () => {
                  const newProd: ProductItem = {
                    id: "prod_" + Math.random().toString(36).substring(2, 9),
                    script_id: currentScript.id,
                    name: "Sản phẩm mới",
                    description: "",
                    image_path: null,
                    product_lock_en: "",
                    locked: false,
                    created_at: Date.now(),
                  };
                  const updatedProds = [...(currentScript.products || []), newProd];
                  const newScript = { ...currentScript, products: updatedProds };
                  setCurrentScript(newScript);
                  await api.saveScriptProject(newScript);
                  onAddToast("success", "Đã thêm sản phẩm mới!");
                }}
              >
                + Thêm Sản Phẩm
              </button>
            </div>

            {(!currentScript.products || currentScript.products.length === 0) ? (
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic" }}>
                Chưa có sản phẩm nào. Bạn có thể thêm sản phẩm để khóa đặc điểm bao bì/nhãn hiệu xuyên suốt các cảnh.
              </p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "12px" }}>
                {currentScript.products.map((prod) => (
                  <div
                    key={prod.id}
                    style={{
                      background: "white",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      padding: "12px",
                      display: "flex",
                      gap: "12px",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                    }}
                  >
                    <div
                      style={{
                        width: "64px",
                        height: "64px",
                        borderRadius: "8px",
                        background: "#f1f5f9",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        border: "1px dashed #cbd5e1",
                        flexShrink: 0,
                      }}
                    >
                      {prod.image_path ? (
                        <img
                          src={`https://asset.localhost/${prod.image_path.replace(/\\/g, "/")}`}
                          alt={prod.name}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <Package size={22} style={{ color: "#94a3b8" }} />
                      )}
                    </div>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <input
                          type="text"
                          style={{ fontSize: "13px", fontWeight: 600, border: "1px solid transparent", borderBottom: "1px dashed #cbd5e1", padding: "2px 4px", width: "70%" }}
                          value={prod.name}
                          onChange={(e) => {
                            const updated = currentScript.products!.map((p) =>
                              p.id === prod.id ? { ...p, name: e.target.value } : p
                            );
                            setCurrentScript({ ...currentScript, products: updated });
                          }}
                        />
                        <button
                          className="secondary-btn"
                          style={{ padding: "2px 6px", color: "#ef4444" }}
                          onClick={async () => {
                            const updated = currentScript.products!.filter((p) => p.id !== prod.id);
                            const newScript = { ...currentScript, products: updated };
                            setCurrentScript(newScript);
                            await api.saveScriptProject(newScript);
                            onAddToast("info", "Đã xóa sản phẩm!");
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>

                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                        <button
                          className="secondary-btn"
                          style={{ padding: "4px 8px", fontSize: "12px" }}
                          onClick={async () => {
                            const file = await api.pickFile([
                              { name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] },
                            ]);
                            if (file) {
                              const updated = currentScript.products!.map((p) =>
                                p.id === prod.id ? { ...p, image_path: file } : p
                              );
                              const newScript = { ...currentScript, products: updated };
                              setCurrentScript(newScript);
                              await api.saveScriptProject(newScript);
                              onAddToast("success", "Đã cập nhật ảnh sản phẩm!");
                            }
                          }}
                        >
                          {prod.image_path ? "Đổi ảnh SP" : "+ Chọn ảnh SP"}
                        </button>

                        {prod.image_path && (
                          <button
                            className="secondary-btn"
                            style={{ padding: "4px 8px", fontSize: "12px", color: "var(--primary)" }}
                            disabled={analyzingTarget === prod.id}
                            onClick={async () => {
                              setAnalyzingTarget(prod.id);
                              try {
                                const key = localStorage.getItem("xitrum_gemini_api_key");
                                const res = await api.analyzeImage(prod.image_path!, "product", key);
                                if (res.ok && res.descriptor) {
                                  const updated = currentScript.products!.map((p) =>
                                    p.id === prod.id ? { ...p, product_lock_en: res.descriptor, locked: true } : p
                                  );
                                  const newScript = { ...currentScript, products: updated };
                                  setCurrentScript(newScript);
                                  await api.saveScriptProject(newScript);
                                  onAddToast("success", "Đã phân tích và khóa đặc điểm sản phẩm!");
                                } else {
                                  onAddToast("error", res.message);
                                }
                              } catch (e: any) {
                                onAddToast("error", "Lỗi: " + e);
                              } finally {
                                setAnalyzingTarget(null);
                              }
                            }}
                          >
                            <Sparkles size={12} className={analyzingTarget === prod.id ? "spin" : ""} />
                            {analyzingTarget === prod.id ? "Đang phân tích..." : "Phân tích ảnh"}
                          </button>
                        )}

                        {prod.product_lock_en && (
                          <button
                            className="secondary-btn"
                            style={{ padding: "4px 8px", fontSize: "12px", color: prod.locked ? "#16a34a" : "#ca8a04" }}
                            onClick={async () => {
                              const updated = currentScript.products!.map((p) =>
                                p.id === prod.id ? { ...p, locked: !p.locked } : p
                              );
                              const newScript = { ...currentScript, products: updated };
                              setCurrentScript(newScript);
                              await api.saveScriptProject(newScript);
                              onAddToast("info", prod.locked ? "Đã mở khóa sản phẩm" : "Đã khóa sản phẩm!");
                            }}
                          >
                            {prod.locked ? <Lock size={12} /> : <Unlock size={12} />}
                            {prod.locked ? "Đã khóa" : "Mở khóa"}
                          </button>
                        )}
                      </div>

                      <div style={{ marginTop: "4px" }}>
                        <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569" }}>
                          🔒 Khóa Sản Phẩm (Product Lock - Tiếng Anh):
                        </label>
                        <textarea
                          rows={2}
                          readOnly={prod.locked}
                          style={{
                            width: "100%",
                            fontSize: "11px",
                            fontFamily: "monospace",
                            background: prod.locked ? "#f1f5f9" : "white",
                            border: "1px solid #cbd5e1",
                            borderRadius: "4px",
                            padding: "4px",
                          }}
                          placeholder="Câu mô tả tiếng Anh cố định bao bì, nhãn, màu sắc..."
                          value={prod.product_lock_en || ""}
                          onChange={(e) => {
                            const updated = currentScript.products!.map((p) =>
                              p.id === prod.id ? { ...p, product_lock_en: e.target.value } : p
                            );
                            setCurrentScript({ ...currentScript, products: updated });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SCENE LIST */}
          <div>
            <h4 style={{ margin: "0 0 12px 0", fontSize: "15px" }}>Phân Cảnh Kịch Bản ({currentScript.scenes.length} Cảnh)</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {currentScript.scenes.map((scene) => (
                <div
                  key={scene.id}
                  style={{
                    background: "white",
                    border: "1px solid var(--border-color)",
                    borderRadius: "10px",
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
                  }}
                >
                  {/* Phase 2: CAMERA MOVES & VISUAL STYLES */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "#f8fafc", padding: "10px 12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    {/* Nhóm 1: Chuyển động camera (chọn tối đa 2) */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>
                          🎥 Chuyển Động Camera (Chọn tối đa 2):
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                          {(scene.camera_moves || []).length}/2 đã chọn
                        </span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {CAMERA_MOVES.map((cm) => {
                          const isSelected = (scene.camera_moves || []).includes(cm.id);
                          return (
                            <button
                              key={cm.id}
                              type="button"
                              className={isSelected ? "primary-btn" : "secondary-btn"}
                              style={{
                                padding: "2px 8px",
                                fontSize: "11px",
                                borderRadius: "12px",
                                background: isSelected ? "var(--primary)" : "white",
                              }}
                              onClick={() => {
                                const currentMoves = scene.camera_moves || [];
                                if (isSelected) {
                                  handleUpdateSceneField(scene.id, "camera_moves", currentMoves.filter((m) => m !== cm.id));
                                } else {
                                  if (currentMoves.length >= 2) {
                                    onAddToast("warn", "Chỉ chọn tối đa 2 chuyển động cho 1 cảnh!");
                                    return;
                                  }
                                  handleUpdateSceneField(scene.id, "camera_moves", [...currentMoves, cm.id]);
                                }
                              }}
                            >
                              {cm.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Nhóm 2: Phong cách quay (chỉ chọn 1) */}
                    <div>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "4px" }}>
                        🎨 Phong Cách Quay (Chọn 1):
                      </span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {STYLES.map((st) => {
                          const isSelected = (scene.style || "default") === st.id;
                          return (
                            <button
                              key={st.id}
                              type="button"
                              className={isSelected ? "primary-btn" : "secondary-btn"}
                              style={{
                                padding: "2px 8px",
                                fontSize: "11px",
                                borderRadius: "12px",
                                background: isSelected ? "var(--primary)" : "white",
                              }}
                              onClick={() => handleUpdateSceneField(scene.id, "style", st.id)}
                            >
                              {st.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Chọn Sản phẩm cho cảnh nếu kịch bản có sản phẩm */}
                    {currentScript.products && currentScript.products.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>📦 Sản Phẩm Xuất Hiện:</span>
                        <select
                          style={{ fontSize: "12px", padding: "2px 8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                          value={scene.product_id || ""}
                          onChange={(e) => handleUpdateSceneField(scene.id, "product_id", e.target.value || null)}
                        >
                          <option value="">-- Không có sản phẩm trong cảnh này --</option>
                          {currentScript.products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} {p.locked ? "🔒" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontWeight: 600, color: "var(--primary)", fontSize: "14px" }}>
                        Cảnh #{scene.scene_no} {scene.character && `(Nhân vật: ${scene.character})`}
                      </span>
                      {scene.queue_task_id && (
                        <span style={{ fontSize: "11px", background: "#e0e7ff", color: "#4338ca", padding: "2px 8px", borderRadius: "12px", fontWeight: 500 }}>
                          Task: {scene.queue_task_id.slice(0, 8)}...
                        </span>
                      )}
                      {scene.video_path && (
                        <span style={{ fontSize: "11px", background: "#dcfce7", color: "#15803d", padding: "2px 8px", borderRadius: "12px", fontWeight: 600 }}>
                          ✓ Video Đã Tạo Xong
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      {/* Audio player / nút tạo giọng đọc */}
                      {scene.audio_path ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontSize: "12px", color: "#16a34a", fontWeight: 600 }}>✓ Đã có giọng đọc</span>
                          <button
                            className="secondary-btn"
                            style={{ padding: "3px 8px", fontSize: "12px" }}
                            onClick={() => {
                              const audio = new Audio(`https://asset.localhost/${scene.audio_path?.replace(/\\/g, "/")}`);
                              audio.play();
                            }}
                          >
                            <Play size={12} /> Nghe
                          </button>
                          <button
                            className="secondary-btn"
                            style={{ padding: "3px 8px", fontSize: "12px" }}
                            onClick={() => handleGenerateTtsForScene(scene)}
                            title="Tạo lại giọng đọc"
                          >
                            <RotateCw size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="secondary-btn"
                          style={{ padding: "4px 10px", fontSize: "12px", color: "var(--primary)" }}
                          onClick={() => handleGenerateTtsForScene(scene)}
                          disabled={ttsGeneratingSceneId === scene.id}
                        >
                          <Mic size={14} /> {ttsGeneratingSceneId === scene.id ? "Đang tạo giọng..." : "Tạo giọng đọc (TTS)"}
                        </button>
                      )}

                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <label style={{ fontSize: "13px", color: "var(--text-muted)" }}>Thời lượng (giây):</label>
                        <input
                          type="number"
                          style={{ width: "65px", padding: "4px 8px", fontSize: "13px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                          value={scene.duration_sec}
                          onChange={(e) =>
                            handleUpdateSceneField(scene.id, "duration_sec", Number(e.target.value))
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: "13px" }}>Lời thoại (Tiếng Việt):</label>
                    <textarea
                      rows={2}
                      value={scene.narration}
                      onChange={(e) => handleUpdateSceneField(scene.id, "narration", e.target.value)}
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-group" style={{ flex: 1, margin: 0 }}>
                      <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Visual Prompt (Tạo ảnh):</label>
                      <textarea
                        rows={2}
                        style={{ fontSize: "12px", fontFamily: "monospace" }}
                        value={scene.visual_prompt}
                        onChange={(e) => handleUpdateSceneField(scene.id, "visual_prompt", e.target.value)}
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1, margin: 0 }}>
                      <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Video Prompt (Tạo video):</label>
                      <textarea
                        rows={2}
                        style={{ fontSize: "12px", fontFamily: "monospace" }}
                        value={scene.video_prompt}
                        onChange={(e) => handleUpdateSceneField(scene.id, "video_prompt", e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Prompt cuối sẽ gửi (Read-only preview) */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ background: "#f1f5f9", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <span style={{ fontSize: "11px", fontWeight: 600, color: "#475569" }}>
                          👁️ Prompt cuối gửi sang Muse (Video):
                        </span>
                        <button
                          type="button"
                          className="secondary-btn"
                          style={{ padding: "2px 6px", fontSize: "10px" }}
                          onClick={() => {
                            navigator.clipboard.writeText(getFinalPreviewPrompt(scene));
                            onAddToast("info", "Đã copy prompt Muse!");
                          }}
                        >
                          Copy
                        </button>
                      </div>
                      <div style={{ fontSize: "11px", fontFamily: "monospace", color: "#1e293b", whiteSpace: "pre-wrap", lineHeight: 1.4, maxHeight: "80px", overflowY: "auto" }}>
                        {getFinalPreviewPrompt(scene)}
                      </div>
                    </div>

                    {/* Prompt tạo ảnh cho Whiteboard */}
                    <div style={{ background: "#fefce8", padding: "8px 10px", borderRadius: "6px", border: "1px solid #fef08a" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <span style={{ fontSize: "11px", fontWeight: 600, color: "#854d0e", display: "flex", alignItems: "center", gap: "4px" }}>
                          🖍️ Prompt tạo ảnh nét vẽ Whiteboard (Line-Art Sketch):
                        </span>
                        <div style={{ display: "flex", gap: "4px" }}>
                          <button
                            type="button"
                            className="secondary-btn"
                            style={{ padding: "2px 6px", fontSize: "10px", color: "#854d0e" }}
                            onClick={() => {
                              handleUpdateSceneField(scene.id, "visual_prompt", getWhiteboardPrompt(scene));
                              onAddToast("success", "Đã áp dụng vào Visual Prompt!");
                            }}
                            title="Áp dụng prompt này vào ô Visual Prompt của cảnh"
                          >
                            Áp Dụng
                          </button>
                          <button
                            type="button"
                            className="secondary-btn"
                            style={{ padding: "2px 6px", fontSize: "10px", color: "#854d0e" }}
                            onClick={() => {
                              navigator.clipboard.writeText(getWhiteboardPrompt(scene));
                              onAddToast("info", "Đã copy prompt Whiteboard!");
                            }}
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      <div style={{ fontSize: "11px", fontFamily: "monospace", color: "#713f12", whiteSpace: "pre-wrap", lineHeight: 1.4, maxHeight: "80px", overflowY: "auto" }}>
                        {getWhiteboardPrompt(scene)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 3: LỊCH SỬ KỊCH BẢN */}
      {activeSubTab === "history" && (
        <div>
          <h3>📚 Lịch Sử Kịch Bản Đã Lưu</h3>
          <p className="panel-desc">Xem lại, chỉnh sửa hoặc nạp lại các kịch bản bạn đã tạo trước đây.</p>

          {scriptsList.length === 0 ? (
            <p style={{ padding: "30px", textAlign: "center", color: "var(--text-muted)" }}>Chưa có kịch bản nào được lưu.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "14px" }}>
              {scriptsList.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "14px 18px",
                    background: "white",
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                  }}
                >
                  <div>
                    <b style={{ fontSize: "15px", color: "#0f172a" }}>{item.title}</b>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
                      Thể loại: {item.genre} • Số cảnh: {item.scenes.length} • Tỷ lệ: {item.ratio} • Tạo lúc:{" "}
                      {new Date(item.created_at).toLocaleString("vi-VN")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      className="secondary-btn"
                      onClick={() => {
                        setCurrentScript(item);
                        setActiveSubTab("review");
                      }}
                    >
                      <Edit2 size={14} /> Mở Kịch Bản
                    </button>
                    <button
                      className="secondary-btn"
                      style={{ color: "#ef4444", borderColor: "#fecaca" }}
                      onClick={() => handleDeleteScript(item.id)}
                    >
                      <Trash2 size={14} /> Xóa
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
