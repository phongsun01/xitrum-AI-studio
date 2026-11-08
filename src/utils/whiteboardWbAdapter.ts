import {
  WhiteboardProject,
  WhiteboardSceneItem,
  WhiteboardSpeechConfig,
  WhiteboardWbInspectResult,
} from "../types/whiteboard";

/**
 * Ánh xạ kết quả kiểm tra bộ WB schema 2/3 (WhiteboardWbInspectResult)
 * thành một WhiteboardProject sẵn sàng đưa vào WhiteboardEditor.
 *
 * Đảm bảo:
 * - 1 scene trong .wb.json tương ứng đúng 1 WhiteboardSceneItem.
 * - Danh sách cues của mỗi scene giữ nguyên thứ tự, spokenText và speakerId.
 * - speechConfig được thiết lập đúng mode ("characters" hoặc "single") và speakers.
 * - Reset audioFingerprint, masterAudioPath, outputVideoPath để tránh dùng nhầm audio cũ.
 */
export function buildProjectFromWbImport(
  inspectResult: WhiteboardWbInspectResult,
  srtPath: string,
  baseProject?: WhiteboardProject | null
): WhiteboardProject {
  if (!inspectResult.valid) throw new Error("Bộ WB chưa hợp lệ; không thể nhập.");
  const defaultVoiceId = baseProject?.speechConfig?.defaultVoiceId || "Thùy Dung";
  const speechConfig: WhiteboardSpeechConfig = {
    mode: inspectResult.speechMode,
    defaultVoiceId,
    timingMode: baseProject?.speechConfig?.timingMode || "auto",
    speakers: inspectResult.speakers.map(s => ({ ...s, voiceId: s.voiceId || defaultVoiceId })),
    audioFingerprint: undefined,
  };

  const scenes: WhiteboardSceneItem[] = inspectResult.scenes.map((sc, idx) => ({
    ...sc,
    order: idx + 1,
    revision: 1,
    imagePath: sc.imagePath || "",
    annotationPath: sc.annotationPath || "",
    outputPath: undefined,
    audioPath: undefined,
    error: undefined,
    status: "idle",
    subjectFirst: true,
    colorFill: "brush",
    inkPath: "grid",
  }));

  const projectTitle =
    inspectResult.title?.trim() ||
    baseProject?.title ||
    srtPath.split(/[/\\]/).pop()?.replace(/\.srt$/i, "") ||
    "Dự án Whiteboard";

  return {
    id: baseProject?.id || `wb-proj-${Date.now()}`,
    schemaVersion: 1,
    revision: (baseProject?.revision || 0) + 1,
    title: projectTitle,
    fps: baseProject?.fps || 30,
    paperColor: baseProject?.paperColor || "#F5EBD7",
    handPath: baseProject?.handPath,
    sourceSrtPath: srtPath,
    masterAudioPath: undefined,
    outputVideoPath: undefined,
    speechConfig,
    scenes,
  };
}

/** Re-read both files before applying a preview; metadata changes matter even if SRT does not. */
export async function revalidateWbImport(
  preview: WhiteboardWbInspectResult,
  srtPath: string,
  inspect: (srtPath: string, wbJsonPath?: string | null) => Promise<WhiteboardWbInspectResult>,
): Promise<WhiteboardWbInspectResult> {
  const fresh = await inspect(srtPath, preview.wbJsonPath);
  if (!fresh.valid) throw new Error(fresh.errors.join("\n"));
  if (!preview.bundleFingerprint || fresh.bundleFingerprint !== preview.bundleFingerprint) {
    throw new Error("Bộ SRT/metadata đã thay đổi sau khi xem trước. Hãy kiểm tra lại bộ WB.");
  }
  return fresh;
}

export function describeWbImportErrors(errors: string[]): { title: string; description: string } {
  if (errors.some(e => e.startsWith("WB_SCHEMA_MISMATCH"))) {
    return { title: "Định dạng WB chưa được hỗ trợ",
      description: "Ứng dụng hỗ trợ schema 2 một giọng và schema 3 nhiều giọng. Không đổi riêng số schema trong file; hãy xuất bộ WB đúng định dạng hoặc nhập SRT thông thường." };
  }
  if (errors.some(e => /^(WB_INVALID_JSON|WB_INVALID_METADATA|WB_SPEECH_MODE_INVALID):/.test(e))) {
    return { title: "Cấu trúc metadata WB không hợp lệ",
      description: "File .wb.json thiếu trường, sai kiểu dữ liệu hoặc sai cú pháp. Kiểm tra cấu trúc theo schema được khai báo; lỗi này không có nghĩa là SRT đã bị chỉnh sửa." };
  }
  if (errors.some(e => /^(WB_SRT_HASH_MISMATCH|WB_CUE_COUNT_MISMATCH|WB_CUE_MISMATCH):/.test(e))) {
    return { title: "SRT và metadata WB không khớp",
      description: "Hash, số cue, nội dung hoặc timestamp không khớp giữa hai file. Hãy chọn bộ SRT và .wb.json cùng phiên bản hoặc nhập riêng SRT." };
  }
  return { title: "Không thể nhập bộ WB",
    description: "Kiểm tra các lỗi cụ thể bên dưới về file, thời gian, phân vai và nhóm cảnh. Có thể hủy để sửa bộ WB hoặc chọn nhập SRT thông thường." };
}

