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
  mode?: "draw" | "instant" | "fade";
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

export interface WhiteboardAlignedScene {
  sceneIndex: number;
  timelineStartMs: number;
  timelineEndMs: number;
  sceneDurationMs: number;
  speechEndMs: number;
  cueRange: [number, number];
}

export interface WhiteboardSrtTtsResponse {
  audio_path: string;
  duration_sec: number;
  aligned_srt_path?: string | null;
  cues?: WhiteboardSrtCue[] | null;
  scenes?: WhiteboardAlignedScene[] | null;
}

export interface WhiteboardSrtCue {
  index: number;
  startMs: number;
  endMs: number;
  speechEndMs?: number;
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
  speechEndMs?: number;
  cues: WhiteboardSrtCue[];
  status: WhiteboardSceneStatus;
  audioPath?: string;
  outputPath?: string;
  imageType?: WhiteboardImageType;
  inkPath?: WhiteboardInkPath;
  colorFill?: WhiteboardColorFill;
  inkWeight?: number;
  colorWeight?: number;
  randomSeed?: number;
  styleMode?: "manual" | "random";
  subjectFirst?: boolean;
  analysisConfidence?: number;
  elements?: WhiteboardElement[];
  error?: string;
}

export type WhiteboardPenType =
  | "pen"
  | "calligraphy"
  | "bamboo"
  | "vintage"
  | "technical"
  | "quill"
  | "digital"
  | "cyberpunk"
  | "crystal"
  | "wand";

export interface WhiteboardPenOption {
  id: WhiteboardPenType;
  name: string;
  filename: string;
  desc: string;
}

export const WHITEBOARD_PEN_OPTIONS: WhiteboardPenOption[] = [
  { id: "pen", name: "Bàn tay vẽ (Mặc định)", filename: "drawing-hand.png", desc: "Tay cầm bút dạ đen vẽ phác họa" },
  { id: "calligraphy", name: "Bút lông thư pháp", filename: "calligraphy-brush.png", desc: "Bút lông cán tre truyền thống" },
  { id: "bamboo", name: "Bút cán tre", filename: "bamboo-pen.png", desc: "Bút mực cán tre mộc mạc" },
  { id: "vintage", name: "Bút máy cổ điển", filename: "vintage-pen.png", desc: "Bút máy ngòi vàng sang trọng" },
  { id: "technical", name: "Bút vẽ kỹ thuật", filename: "technical-drawing-pen.png", desc: "Bút kim / Rapidograph vẽ kiến trúc" },
  { id: "quill", name: "Bút lông vũ", filename: "quill-pen.png", desc: "Bút lông ngỗng châu Âu cổ điển" },
  { id: "digital", name: "Bút cảm ứng kỹ thuật số", filename: "digital-pen.png", desc: "Stylus bảng vẽ đồ họa Wacom/iPad" },
  { id: "cyberpunk", name: "Bút Cyberpunk dạ quang", filename: "cyberpunk-pen.png", desc: "Bút công nghệ tương lai viền LED" },
  { id: "crystal", name: "Bút pha lê thủy tinh", filename: "crystal-pen.png", desc: "Bút thủy tinh chấm mực trong suốt" },
  { id: "wand", name: "Bút đũa phép thuật", filename: "wand-pen.png", desc: "Đũa thần kỳ ảo đính ngọc phép" },
];

export type WhiteboardFontId = "charm" | "mali" | "bitter" | "grenzegotisch" | "chakrapetch" | "bevietnampro";
export type WhiteboardFontChoice = "auto" | WhiteboardFontId;

export interface WhiteboardThumbnailDraft {
  fontChoice?: WhiteboardFontChoice;
  title: string;
  imagePath: string;
}

export interface WhiteboardThumbnail extends WhiteboardThumbnailDraft {
  penType: WhiteboardPenType;
  pngDataUrl: string;
  layout?: "full-bleed-top";
  typographyVersion?: number;
}

export interface WhiteboardProject {
  id: string;
  schemaVersion: number;
  revision: number;
  title: string;
  fps: number;
  paperColor: string;
  handPath?: string;
  thumbnail?: WhiteboardThumbnail;
  thumbnailDraft?: WhiteboardThumbnailDraft;
  scenes: WhiteboardSceneItem[];
  sourceSrtPath?: string;
  masterAudioPath?: string;
  outputVideoPath?: string;
}

