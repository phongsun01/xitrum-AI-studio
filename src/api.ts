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
  max_parallel_muse: number;
  max_parallel_local: number;
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

