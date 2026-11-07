export interface WhiteboardCanvas {
  width: number;
  height: number;
}

export interface WhiteboardRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WhiteboardReveal {
  startMs: number;
  durationMs: number;
  direction: "left_to_right" | "top_to_bottom" | "right_to_left" | "bottom_to_top" | string;
  maskPaddingPx?: number;
  protectedRegions?: WhiteboardRegion[];
}

export interface WhiteboardHandPath {
  start: [number, number];
  end: [number, number];
  easing?: string;
}

export interface WhiteboardElement {
  id: string;
  label: string;
  sequence: number;
  type?: string;
  subtitle?: string;
  narrativeRole?: string;
  region: WhiteboardRegion;
  reveal: WhiteboardReveal;
  handPath?: WhiteboardHandPath;
}

export interface WhiteboardAnnotation {
  schemaVersion: number;
  sceneId: string;
  canvas: WhiteboardCanvas;
  storyBasis?: string;
  sceneDurationMs: number;
  elements: WhiteboardElement[];
}

export interface WhiteboardSrtCue {
  index: number;
  startMs: number;
  endMs: number;
  durMs: number;
  text: string;
}

export interface WhiteboardSrtScene {
  sceneIndex: number;
  startMs: number;
  endMs: number;
  timelineStartMs: number;
  timelineEndMs: number;
  sceneDurationMs: number;
  belowMin: boolean;
  aboveMax: boolean;
  cueRange: [number, number];
  text: string;
}

export interface WhiteboardParseSrtResponse {
  cues: WhiteboardSrtCue[];
  scenes: WhiteboardSrtScene[];
}

export interface WhiteboardGenerateAnnotationResponse {
  schemaVersion?: number;
  sceneId?: string;
  canvas?: WhiteboardCanvas;
  elements?: WhiteboardElement[];
  savedTo?: string;
  [key: string]: unknown;
}

export interface WhiteboardRenderResponse {
  output_path: string;
  file_size: number;
  scenes_count?: number;
}

export interface WhiteboardMergeResponse {
  output_path: string;
  file_size: number;
}

export interface WhiteboardEnvCheck {
  ok: boolean;
  python?: string;
  pythonVersion?: string;
  missing: string[];
  ffmpeg?: string | null;
  error?: string;
}

export type WhiteboardImageType = "line_art_mono" | "filled_mono" | "colored" | "blank" | "uncertain";
export type WhiteboardInkPath = "grid" | "skeleton";
export type WhiteboardColorFill = "contour-wipe" | "brush" | "palette-brush" | "none";

export interface WhiteboardImageAnalysis {
  imageType: WhiteboardImageType;
  confidence: number;
  hasColor: boolean;
  coloredRatio: number;
  thickRatio: number;
  contentRatio: number;
  recommended: {
    inkPath: WhiteboardInkPath;
    colorFill: WhiteboardColorFill;
    inkWeight: number;
    colorWeight: number;
  };
}

export type WhiteboardSceneStatus = "idle" | "rendering" | "done" | "error";

export interface WhiteboardSceneItem {
  id: string;
  order: number;
  revision: number;
  imagePath: string;
  annotationPath: string;
  timelineStartMs: number;
  timelineEndMs: number;
  durationMs: number;
  cues: WhiteboardSrtCue[];
  status: WhiteboardSceneStatus;
  audioPath?: string;
  outputPath?: string;
  imageType?: WhiteboardImageType;
  inkPath?: WhiteboardInkPath;
  colorFill?: WhiteboardColorFill;
  inkWeight?: number;
  colorWeight?: number;
  analysisConfidence?: number;
  elements?: WhiteboardElement[];
  error?: string;
}

export interface WhiteboardProject {
  id: string;
  schemaVersion: number;
  revision: number;
  title: string;
  fps: number;
  paperColor: string;
  handPath?: string;
  scenes: WhiteboardSceneItem[];
  masterAudioPath?: string;
  outputVideoPath?: string;
}

