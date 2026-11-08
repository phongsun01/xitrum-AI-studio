import {
  WhiteboardProject,
  WhiteboardSceneItem,
  WhiteboardSpeechConfig,
  WhiteboardWbInspectResult,
} from "../types/whiteboard";

/**
 * Ánh xạ kết quả kiểm tra bộ WB Schema 3 (WhiteboardWbInspectResult)
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
  const speechConfig: WhiteboardSpeechConfig = {
    mode: inspectResult.speechMode,
    defaultVoiceId: inspectResult.speakers[0]?.voiceId || "Thùy Dung",
    timingMode: "auto",
    speakers: inspectResult.speakers,
    audioFingerprint: undefined,
  };

  const scenes: WhiteboardSceneItem[] = inspectResult.scenes.map((sc, idx) => ({
    ...sc,
    order: idx + 1,
    revision: 1,
    imagePath: sc.imagePath || "",
    annotationPath: sc.annotationPath || "",
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

