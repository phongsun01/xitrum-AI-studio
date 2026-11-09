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

export interface WhiteboardSpeaker {
  id: string; // ID ổn định duy nhất (vd: "speaker-1", "narrator")
  name: string; // Tên hiển thị (vd: "Thầy giáo", "Người dẫn chuyện")
  voiceId: string; // VieNeu voice ID (vd: "Hải Đăng", "Thùy Dung")
  sourceCharacterId?: string; // ID liên kết Character Bible khi import
}

export interface WhiteboardSpeechConfig {
  mode: "single" | "characters";
  defaultVoiceId: string;
  timingMode: "fixed" | "auto";
  speakers: WhiteboardSpeaker[];
  audioFingerprint?: string;
}

export interface WhiteboardSrtCue {
  id?: string;
  index: number;
  startMs: number;
  endMs: number;
  speechEndMs?: number;
  durMs: number;
  text: string;
  sourceText?: string;
  spokenText?: string;
  speakerName?: string | null;
  speakerId?: string | null;
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
  text?: string;
  storyBasis?: string;
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
  mode?: "generated" | "imported";
  penType: WhiteboardPenType;
  pngDataUrl: string;
  layout?: "full-bleed-top";
  typographyVersion?: number;
  aspectRatio?: "16:9" | "9:16";
}

export interface WhiteboardFolderImageItem {
  path: string;
  filename: string;
  stem: string;
  extension: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  fileSize: number;
  fingerprint: string;
  error?: string;
}

export interface WhiteboardSceneImageMapping {
  sceneIndex: number;
  sceneId: string;
  currentImagePath?: string;
  matchedImage?: WhiteboardFolderImageItem;
  candidateImages: WhiteboardFolderImageItem[];
  status: "ready" | "missing" | "duplicate" | "error";
  error?: string;
}

export interface WhiteboardFolderScanResult {
  folderPath: string;
  totalFilesScanned: number;
  matchedScenesCount: number;
  mappings: WhiteboardSceneImageMapping[];
  thumbnailCandidates: WhiteboardFolderImageItem[];
  excessImages: WhiteboardFolderImageItem[];
  ignoredFiles: string[];
  errors: string[];
}

export interface WhiteboardProject {
  /** Marker returned only while importing a legacy V1 project. */
  importedLegacyV1?: boolean;
  id: string;
  schemaVersion: number;
  revision: number;
  title: string;
  fps: number;
  paperColor: string;
  handPath?: string;
  speechConfig?: WhiteboardSpeechConfig;
  thumbnail?: WhiteboardThumbnail;
  thumbnailDraft?: WhiteboardThumbnailDraft;
  scenes: WhiteboardSceneItem[];
  sourceSrtPath?: string;
  masterAudioPath?: string;
  /** Lật trang phải → trái giữa các cảnh (ms); 0/undefined = tắt. */
  pageTurnMs?: number;
  outputVideoPath?: string;
}

// Whiteboard Schema 3 (skill /wb) import interfaces
export interface WhiteboardWbCharacter {
  name: string;
  aliases?: string[];
  description?: string;
  reference?: string | null;
}

export interface WhiteboardWbSpeaker {
  id: string;
  name: string;
  voice_id: string;
}

export interface WhiteboardWbSpeech {
  mode: "single" | "characters";
  speakers: WhiteboardWbSpeaker[];
}

export interface WhiteboardWbCue {
  id: string;
  index: number;
  scene_index: number;
  start_ms: number;
  end_ms: number;
  text: string;
  spoken_text?: string;
  speaker_id?: string | null;
}

export interface WhiteboardWbBeat {
  start_ms: number;
  end_ms: number;
  kind?: string;
  spoken_anchor?: string;
  action?: string;
  assets?: string[];
  visual_characters?: string[];
}

export interface WhiteboardWbScene {
  index: number;
  start_ms: number;
  end_ms: number;
  cue_ids: string[];
  text: string;
  mentioned_characters?: string[];
  visual_characters?: string[];
  props?: string[];
  setting?: string;
  moment?: string;
  beat_timing?: string;
  beats?: WhiteboardWbBeat[];
}

export interface WhiteboardWbMeta {
  schema_version: number;
  title?: string;
  language?: string;
  source?: string;
  srt_source?: string;
  srt_sha256: string;
  timing?: {
    kind?: string;
    duration_ms?: number;
  };
  options?: {
    speech?: string;
    ratio?: string;
    thumb?: boolean;
    thumb_ratio?: string | null;
    topic?: string | null;
  };
  character_mode?: string;
  characters?: WhiteboardWbCharacter[];
  speech?: WhiteboardWbSpeech;
  cues: WhiteboardWbCue[];
  scenes: WhiteboardWbScene[];
}

export interface WhiteboardWbInspectResult {
  wbJsonPath?: string;
  bundleFingerprint?: string;
  valid: boolean;
  schemaVersion: number;
  srtSha256Matches: boolean;
  title?: string;
  scenesCount: number;
  cuesCount: number;
  speakersCount: number;
  durationMs: number;
  speechMode: "single" | "characters";
  speakers: WhiteboardSpeaker[];
  scenes: WhiteboardSceneItem[];
  warnings?: string[];
  errors: string[];
}


