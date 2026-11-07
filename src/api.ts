import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface TaskItem {
  id: string;
  kind: "muse_video" | "muse_image" | "whisper_stt" | "rembg" | "ffmpeg_render";
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  prompt: string | null;
  ratio: string | null;
  input_path: string | null;
  output_path: string | null;
  progress: number;
  error_msg: string | null;
  created_at: number;
  updated_at: number;
}

export interface ProxyItem {
  id: number;
  name: string | null;
  raw_masked: string;
  scheme: string;
  host: string;
  port: number;
  username: string | null;
  status: "unknown" | "ok" | "dead" | "checking";
  ip: string | null;
  latency_ms: number | null;
  checked_at: number | null;
}

export interface AppConfig {
  output_dir: string;
  default_ratio: string;
  whisper_model: string;
  chrome_path: string | null;
  chrome_profile_dir: string;
  active_proxy_id: number | null;
  music_dir: string | null;
  music_volume: number;
  max_parallel_muse: number;
  max_parallel_local: number;
}

export interface TemplateItem {
  id: string;
  name: string;
  prompt: string;
  ratio: string | null;
  created_at: number;
}

export interface AudioJobItem {
  id: string;
  audio_path: string;
  status: string;
  created_at: number;
}

export interface AudioSegmentItem {
  id: string;
  job_id: string;
  seq: number;
  start_ms: number;
  end_ms: number;
  text: string;
  prompt: string | null;
  ref_image_path: string | null;
  queue_task_id: string | null;
  output_video_path: string | null;
  approval: "approved" | "rejected" | null;
}

export interface CharacterItem {
  id: string;
  name: string;
  description: string;
  voice: string | null;
  ref_image_path: string | null;
  identity_lock_en?: string | null;
  locked?: boolean;
  created_at: number;
}

export interface ProductItem {
  id: string;
  script_id: string;
  name: string;
  description?: string | null;
  image_path?: string | null;
  product_lock_en?: string | null;
  locked?: boolean;
  created_at: number;
}

export interface ScriptSceneItem {
  id: string;
  script_id: string;
  scene_no: number;
  narration: string;
  visual_prompt: string;
  video_prompt: string;
  character: string | null;
  duration_sec: number;
  ref_image_path: string | null;
  audio_path: string | null;
  video_path: string | null;
  queue_task_id: string | null;
  product_id?: string | null;
  camera_moves?: string[];
  style?: string | null;
}

export interface ScriptProjectItem {
  id: string;
  title: string;
  idea: string | null;
  genre: string | null;
  target_duration_sec: number | null;
  ratio: string;
  status: "draft" | "reviewed" | "queued" | "done";
  environment_lock_en?: string | null;
  created_at: number;
  updated_at: number;
  characters: CharacterItem[];
  products?: ProductItem[];
  scenes: ScriptSceneItem[];
}

export const api = {
  // Lấy danh sách tasks
  listTasks: () => invoke<TaskItem[]>("list_tasks"),

  // Thêm task vào hàng đợi
  enqueueTask: (
    kind: TaskItem["kind"],
    prompt?: string | null,
    ratio?: string | null,
    inputPath?: string | null
  ) =>
    invoke<TaskItem>("enqueue_task", {
      kind,
      prompt: prompt ?? null,
      ratio: ratio ?? null,
      inputPath: inputPath ?? null,
    }),

  // Hủy task
  cancelTask: (taskId: string) => invoke<void>("cancel_task", { taskId }),

  // Retry task (F2)
  retryTask: (taskId: string) => invoke<TaskItem>("retry_task", { taskId }),

  // Duplicate task (F3)
  duplicateTask: (taskId: string) => invoke<TaskItem>("duplicate_task", { taskId }),

  // Edit task prompt khi đang queued (F4)
  editTaskPrompt: (taskId: string, prompt: string) =>
    invoke<void>("edit_task_prompt", { taskId, prompt }),

  // Mở thư mục kết quả (F1)
  openOutputFolder: (taskId: string) =>
    invoke<void>("open_output_folder", { taskId }),

  // Templates CRUD (F6)
  listTemplates: () => invoke<TemplateItem[]>("list_templates"),
  saveTemplate: (name: string, prompt: string, ratio?: string | null, id?: string) =>
    invoke<TemplateItem>("save_template", {
      id: id ?? null,
      name,
      prompt,
      ratio: ratio ?? null,
    }),
  deleteTemplate: (id: string) => invoke<void>("delete_template", { id }),

  // Audio Timeline & Segments (v0.3.0 F7, F8, F10)
  listAudioJobs: () => invoke<AudioJobItem[]>("list_audio_jobs"),
  listAudioSegments: (jobId: string) =>
    invoke<AudioSegmentItem[]>("list_audio_segments", { jobId }),
  updateAudioSegment: (
    segmentId: string,
    updates: {
      text?: string;
      prompt?: string;
      refImagePath?: string;
      approval?: "approved" | "rejected" | null;
    }
  ) =>
    invoke<void>("update_audio_segment", {
      segmentId,
      text: updates.text ?? null,
      prompt: updates.prompt ?? null,
      refImagePath: updates.refImagePath ?? null,
      approval: updates.approval ?? null,
    }),
  addSegmentToQueue: (jobId: string, segmentId: string) =>
    invoke<TaskItem>("add_segment_to_queue", { jobId, segmentId }),
  regenerateSegment: (jobId: string, segmentId: string) =>
    invoke<TaskItem>("regenerate_segment", { jobId, segmentId }),
  exportScript: (jobId: string, format: "srt" | "txt") =>
    invoke<string>("export_script", { jobId, format }),
  renderAudioJob: (jobId: string) =>
    invoke<string>("render_audio_job", { jobId }),

  // Kiểm tra phiên đăng nhập Muse.ai (F11)
  checkMuseSession: () =>
    invoke<{ ok: boolean; message: string }>("check_muse_session"),

  // Kiểm tra nhanh phiên Muse.ai qua Cookie (Phase 1)
  checkMuseSessionByCookie: (
    hatchSess: string,
    hatchNativeAuthDevice: string,
    hatchGw?: string | null,
    hatchVml?: string | null
  ) =>
    invoke<{ ok: boolean; message: string; checked_at: number }>(
      "check_muse_session_by_cookie",
      {
        hatchSess,
        hatchNativeAuthDevice,
        hatchGw: hatchGw ?? null,
        hatchVml: hatchVml ?? null,
      }
    ),

  // Phân tích ảnh khóa mặt / khóa sản phẩm với Gemini Vision (Phase 3)
  analyzeImage: (imagePath: string, kind: "character" | "product" | "environment", geminiApiKey?: string | null) =>
    invoke<{ ok: boolean; descriptor: string | null; message: string }>("analyze_image", {
      imagePath,
      kind,
      geminiApiKey: geminiApiKey ?? null,
    }),

  // Kiểm tra trạng thái các luồng Multi-Lane (F14)
  getLaneStatus: () =>
    invoke<{ muse_available_slots: number; local_available_slots: number }>(
      "get_lane_status"
    ),

  // Cấu hình settings
  getSettings: () => invoke<AppConfig>("get_settings"),
  saveSettings: (config: AppConfig) => invoke<void>("save_settings", { config }),

  // Scripts & Character Bible (Mốc 1)
  saveScriptProject: (script: ScriptProjectItem) =>
    invoke<void>("save_script_project", { script }),
  getScriptProject: (scriptId: string) =>
    invoke<ScriptProjectItem | null>("get_script_project", { scriptId }),
  listScriptProjects: () =>
    invoke<ScriptProjectItem[]>("list_script_projects"),
  updateScriptScene: (scene: ScriptSceneItem) =>
    invoke<void>("update_script_scene", { scene }),
  updateCharacterRefImage: (characterId: string, refImagePath: string) =>
    invoke<void>("update_character_ref_image", { characterId, refImagePath }),
  deleteScriptProject: (scriptId: string) =>
    invoke<void>("delete_script_project", { scriptId }),

  // VieNeu-TTS (Mốc 2)
  listTtsVoices: () =>
    invoke<{ id: string; name: string; gender: string; region: string }[]>("list_tts_voices"),
  generateSceneTts: (sceneId: string, text: string, voiceId: string, speed?: number) =>
    invoke<{ audio_path: string; duration_sec: number }>("generate_scene_tts", {
      sceneId,
      text,
      voiceId,
      speed: speed ?? 1.0,
    }),
  previewTtsVoice: (voiceId: string, text?: string) =>
    invoke<string>("preview_tts_voice", { voiceId, text: text ?? null }),

  // Proxies (Mốc 3)
  addProxies: (text: string) =>
    invoke<{ added: number; invalid: number }>("add_proxies", { text }),
  listProxies: () =>
    invoke<ProxyItem[]>("list_proxies"),
  testProxy: (proxyId: number) =>
    invoke<{ ok: boolean; ip?: string; latency_ms?: number; error?: string }>("test_proxy", { proxyId }),
  deleteProxy: (proxyId: number) =>
    invoke<void>("delete_proxy", { proxyId }),
  deleteDeadProxies: () =>
    invoke<number>("delete_dead_proxies"),

  // Nối kịch bản vào hàng đợi Task (Mốc 4)
  dispatchScriptToQueue: (scriptId: string) =>
    invoke<{ ok: boolean; script_id: string; queued_count: number; task_ids: string[] }>(
      "dispatch_script_to_queue",
      { scriptId }
    ),

  // Hậu kỳ FFmpeg hoàn chỉnh (Mốc 5)
  renderScriptPostproduction: (scriptId: string, burnSubtitles: boolean) =>
    invoke<{
      ok: boolean;
      video_path: string;
      srt_path: string;
      has_tts: boolean;
      has_bgm: boolean;
      burned_subtitles: boolean;
    }>("render_script_postproduction", { scriptId, burnSubtitles }),

  // Mở hộp thoại chọn file trên Windows
  pickFile: async (filters?: { name: string; extensions: string[] }[]) => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters,
    });
    return selected as string | null;
  },

  // Mở hộp thoại chọn thư mục
  pickDirectory: async () => {
    const selected = await open({
      directory: true,
      multiple: false,
    });
    return selected as string | null;
  },

  // Whiteboard Animation API (F16)
  parseWhiteboardSrt: (srtPath: string) =>
    invoke<{
      cues: { index: number; startMs: number; endMs: number; durMs: number; text: string }[];
      scenes: {
        sceneIndex: number;
        startMs: number;
        endMs: number;
        sceneDurationMs: number;
        cueRange: [number, number];
        text: string;
      }[];
    }>("parse_whiteboard_srt", { srtPath }),

  generateWhiteboardAnnotation: (
    imagePath: string,
    sceneId?: string,
    storyBasis?: string,
    durationMs?: number,
    cues?: any[],
    outputPath?: string,
    overwrite?: boolean
  ) =>
    invoke<{ elements?: any[]; savedTo?: string; [key: string]: any }>(
      "generate_whiteboard_annotation",
      {
        imagePath,
        sceneId,
        storyBasis,
        durationMs,
        cues,
        outputPath,
        overwrite,
      }
    ),

  renderWhiteboardScene: (
    imagePath: string,
    annotationPath: string,
    outputPath: string,
    fps?: number,
    paperColor?: string,
    handPath?: string
  ) =>
    invoke<{ output_path: string; file_size: number }>("render_whiteboard_scene", {
      imagePath,
      annotationPath,
      outputPath,
      fps,
      paperColor,
      handPath,
    }),

  mergeWhiteboardScenes: (videoPaths: string[], outputPath: string) =>
    invoke<{ output_path: string; file_size: number }>("merge_whiteboard_scenes", {
      videoPaths,
      outputPath,
    }),
};

