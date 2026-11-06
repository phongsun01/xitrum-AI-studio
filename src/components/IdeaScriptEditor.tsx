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
  Music,
} from "lucide-react";
import { api, ScriptProjectItem, CharacterItem, ScriptSceneItem } from "../api";

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
  const handleRenderPostproduction = async () => {
    if (!currentScript) return;
    if (currentScript.scenes.length === 0) {
      onAddToast("warn", "Kịch bản không có phân cảnh nào để xuất!");
      return;
    }

    try {
      setRenderingPostproduction(true);
      onAddToast("info", "Đang tiến hành ghép nối video, lồng tiếng TTS và phụ đề...");

      const res = await api.renderScriptPostproduction(currentScript.id, burnSubtitles);
      if (res.ok) {
        setRenderedResult(res);
        onAddToast("success", "🎬 Xuất video hoàn chỉnh thành công!");
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
                className="primary-btn"
                style={{ backgroundColor: "#059669" }}
                onClick={handleRenderPostproduction}
                disabled={renderingPostproduction}
              >
                {renderingPostproduction ? <RotateCw size={15} className="spin" /> : <Video size={15} />}
                {renderingPostproduction ? "Đang xuất hậu kỳ..." : "🎬 Xuất Video Hoàn Thiện"}
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

                    <div>
                      <button
                        className="secondary-btn"
                        style={{ padding: "4px 8px", fontSize: "12px" }}
                        onClick={() => handleSelectRefImage(char.id)}
                      >
                        {char.ref_image_path ? "Đổi ảnh tham chiếu" : "+ Chọn ảnh tham chiếu"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
