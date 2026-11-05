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

export interface TemplateItem {
  id: string;
  name: string;
  prompt: string;
  ratio: string | null;
  created_at: number;
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

