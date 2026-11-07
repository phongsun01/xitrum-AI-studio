import type { WhiteboardSceneItem, WhiteboardSrtTtsResponse } from "../types/whiteboard";

export function applyAlignedTiming(scenes: WhiteboardSceneItem[], result: WhiteboardSrtTtsResponse): WhiteboardSceneItem[] {
  if (!result.aligned_srt_path || !result.cues || result.scenes?.length !== scenes.length) {
    throw new Error("TTS không trả đủ timeline để giữ nguyên số cảnh.");
  }
  let cursor = 0;
  return scenes.map((scene, i) => {
    const timing = result.scenes![i];
    const range = [scene.cues[0]?.index, scene.cues[scene.cues.length - 1]?.index];
    if (range[0] !== timing.cueRange[0] || range[1] !== timing.cueRange[1] ||
        timing.timelineStartMs !== cursor || timing.sceneDurationMs <= 0 ||
        timing.timelineEndMs !== cursor + timing.sceneDurationMs ||
        timing.speechEndMs <= 0 || timing.speechEndMs > timing.sceneDurationMs) {
      throw new Error("Timeline TTS không khớp các cảnh hiện tại.");
    }
    cursor = timing.timelineEndMs;
    return { ...scene, revision: (scene.revision || 0) + 1,
      timelineStartMs: timing.timelineStartMs, timelineEndMs: timing.timelineEndMs,
      durationMs: timing.sceneDurationMs, speechEndMs: timing.speechEndMs,
      cues: result.cues!.filter(c => c.index >= timing.cueRange[0] && c.index <= timing.cueRange[1]),
      status: "idle", outputPath: undefined, audioPath: undefined, error: undefined };
  });
}
