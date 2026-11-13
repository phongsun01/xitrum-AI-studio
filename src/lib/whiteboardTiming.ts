import type { WhiteboardSceneItem, WhiteboardSrtTtsResponse } from "../types/whiteboard";

export function speechScenesForTts(scenes: WhiteboardSceneItem[]): WhiteboardSceneItem[] {
  const spoken = scenes.filter(s => s.cues.length > 0);
  if (!spoken.length || scenes.some((s, i) => !s.cues.length && i !== scenes.length - 1)) {
    throw new Error("Chỉ cảnh cuối được không có lời đọc. Hãy chia các cảnh trước từ SRT.");
  }
  return spoken;
}

export function appendSilentEndingScene(scenes: WhiteboardSceneItem[], id: string): WhiteboardSceneItem[] {
  const start = scenes[scenes.length - 1]?.timelineEndMs ?? 0;
  return [...scenes, { id, order: scenes.length + 1, revision: 1,
    imagePath: "", annotationPath: "", timelineStartMs: start, timelineEndMs: start + 3000,
    durationMs: 3000, cues: [], status: "idle", subjectFirst: true, colorFill: "brush", inkPath: "grid" }];
}

/** Split at an existing cue boundary; never guess an audio boundary within a sentence. */
export function splitFinalCue(scenes: WhiteboardSceneItem[], id: string): WhiteboardSceneItem[] {
  const index = scenes.length - (scenes[scenes.length - 1]?.cues.length ? 1 : 2);
  const scene = scenes[index];
  if (!scene || scene.cues.length < 2) return scenes;
  if (scene.audioPath) throw new Error("Cảnh đang có audio riêng. Hãy dùng master audio hoặc tạo lại TTS trước khi tách câu chốt.");
  const last = scene.cues[scene.cues.length - 1]!;
  const cut = last.startMs;
  if (cut <= scene.timelineStartMs || cut >= scene.timelineEndMs) throw new Error("Mốc câu chốt không nằm trong timeline cảnh.");
  const before = { ...scene, cues: scene.cues.slice(0, -1), durationMs: cut - scene.timelineStartMs,
    timelineEndMs: cut, speechEndMs: undefined, revision: scene.revision + 1,
    annotationPath: "", elements: undefined, outputPath: undefined, status: "idle" as const };
  const final: WhiteboardSceneItem = { id, order: index + 2, revision: 1, imagePath: "", annotationPath: "",
    timelineStartMs: cut, timelineEndMs: scene.timelineEndMs, durationMs: scene.timelineEndMs - cut,
    cues: [last], status: "idle", subjectFirst: true, colorFill: "brush", inkPath: "grid" };
  return [...scenes.slice(0, index), before, final, ...scenes.slice(index + 1)].map((s, i) => ({ ...s, order: i + 1 }));
}

export function applyAlignedTiming(scenes: WhiteboardSceneItem[], result: WhiteboardSrtTtsResponse): WhiteboardSceneItem[] {
  const spoken = speechScenesForTts(scenes);
  if (!result.aligned_srt_path || !result.cues || result.scenes?.length !== spoken.length) {
    throw new Error("TTS không trả đủ timeline để giữ nguyên số cảnh.");
  }
  let cursor = 0;
  return scenes.map((scene, i) => {
    if (!scene.cues.length) {
      if (scene.audioPath || !Number.isFinite(scene.durationMs) || scene.durationMs <= 0) throw new Error("Cảnh cuối không lời phải có thời lượng dương và không có audio riêng.");
      const start = cursor;
      cursor += scene.durationMs;
      return { ...scene, timelineStartMs: start, timelineEndMs: cursor, speechEndMs: undefined,
        outputPath: undefined, status: "idle" as const, revision: scene.revision + 1 };
    }
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
