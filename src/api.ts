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

export interface AppConfig {
  output_dir: string;
  default_ratio: string;
  whisper_model: string;
  chrome_profile_dir: string;
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
  exportScript: (jobId: string, format: "srt" | "txt") =>
    invoke<string>("export_script", { jobId, format }),
  renderAudioJob: (jobId: string) =>
    invoke<string>("render_audio_job", { jobId }),

  // Kiểm tra phiên đăng nhập Muse.ai (F11)
  checkMuseSession: () =>
    invoke<{ ok: boolean; message: string }>("check_muse_session"),

  // Cấu hình settings
  getSettings: () => invoke<AppConfig>("get_settings"),
  saveSettings: (config: AppConfig) => invoke<void>("save_settings", { config }),

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
};

