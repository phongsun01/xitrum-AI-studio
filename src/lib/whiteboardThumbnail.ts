import { loadCoverFont, resolveCoverFont } from "./whiteboardFonts";
import type { WhiteboardFontChoice, WhiteboardPenType } from "../types/whiteboard";

// Presets affect layout, typography and palette; they do not restyle the source illustration.
export const COVER_PRESETS: Record<WhiteboardPenType, { background: string; ink: string; accent: string }> = {
  pen: { background: "#fffdf6", ink: "#172330", accent: "#c94d35" },
  calligraphy: { background: "#f4e8cf", ink: "#282018", accent: "#a12e25" },
  bamboo: { background: "#eee9d4", ink: "#293c2d", accent: "#6d8050" },
  vintage: { background: "#e9d6b4", ink: "#3c2b22", accent: "#8b513a" },
  technical: { background: "#edf3f8", ink: "#17324d", accent: "#337db0" },
  quill: { background: "#f3dfb8", ink: "#382017", accent: "#8d2923" },
  digital: { background: "#eaf1ff", ink: "#172858", accent: "#5265d9" },
  cyberpunk: { background: "#101829", ink: "#e4fcff", accent: "#46efd0" },
  crystal: { background: "#f4edf9", ink: "#4c3567", accent: "#a278b9" },
  wand: { background: "#241b3d", ink: "#fff2da", accent: "#d8b271" },
};

export const COVER_TYPOGRAPHY_VERSION = 1;

export const COVER_LAYOUT = "full-bleed-top" as const;

export async function createWhiteboardThumbnail(title: string, pen: WhiteboardPenType, illustration: string, fontChoice: WhiteboardFontChoice = "auto") {
  const { StaticCanvas, FabricImage, Textbox, FabricText, Shadow, Gradient } = await import("fabric");
  const font = resolveCoverFont(pen, fontChoice);
  const watermarkFont = resolveCoverFont("pen");
  await Promise.all([loadCoverFont(font.id), loadCoverFont(watermarkFont.id)]);
  const preset = COVER_PRESETS[pen];
  const canvas = new StaticCanvas(document.createElement("canvas"), {
    width: 1280, height: 720, backgroundColor: preset.background, enableRetinaScaling: false,
  });
  try {
    // Cover the whole canvas, centered, without stretching the illustration.
    const image = await FabricImage.fromURL(illustration);
    const scale = Math.max(1280 / image.width, 720 / image.height);
    image.set({ left: 640, top: 360, originX: "center", originY: "center", scaleX: scale, scaleY: scale });
    canvas.add(image);
    // Keep all text within the empty upper 30%, above the main subjects.
    const text = new Textbox(title.trim().normalize("NFC"), {
      originX: "center", originY: "top", left: 640, top: 36, width: 1100,
      fontSize: 82, fontFamily: font.family, textAlign: "center",
      fontWeight: font.weight, fill: preset.ink, lineHeight: 1.15, splitByGrapheme: false,
      shadow: new Shadow({ color: preset.background, blur: 3, offsetX: 0, offsetY: 1 }),
    });
    while ((text.height > 155 || text.width > 1100) && text.fontSize > 20) text.set("fontSize", text.fontSize - 2);
    // The pen controls the effect even when the user chooses a different font.
    const effects = {
      pen: { stroke: preset.background, strokeWidth: 1.2, glow: preset.background, blur: 3, offset: 1 },
      calligraphy: { stroke: "#251a14", strokeWidth: 0.35, glow: "#d4bea0", blur: 2, offset: 2 },
      bamboo: { stroke: "#eee9d4", strokeWidth: 0.7, glow: "#596348", blur: 2, offset: 2 },
      vintage: { stroke: "#c79b60", strokeWidth: 0.8, glow: "#41251a", blur: 2, offset: 2 },
      technical: { stroke: "#e3f4ff", strokeWidth: 1.2, glow: "#17324d", blur: 2, offset: 1 },
      quill: { stroke: "#e9c992", strokeWidth: 0.8, glow: "#633d26", blur: 2, offset: 2 },
      digital: { stroke: "#eaf1ff", strokeWidth: 1.4, glow: "#5265d9", blur: 4, offset: 1 },
      cyberpunk: { stroke: "#101829", strokeWidth: 1.8, glow: "#46efd0", blur: 12, offset: 0 },
      crystal: { stroke: "#5b3b7d", strokeWidth: 1, glow: "#dcc7ff", blur: 9, offset: 0 },
      wand: { stroke: "#38204c", strokeWidth: 1.8, glow: "#9864db", blur: 10, offset: 1 },
    }[pen];
    text.set({ stroke: effects.stroke, strokeWidth: effects.strokeWidth, paintFirst: "stroke",
      shadow: new Shadow({ color: effects.glow, blur: effects.blur, offsetX: effects.offset, offsetY: effects.offset }) });
    if (pen === "wand" || pen === "crystal" || pen === "cyberpunk") {
      const colors = pen === "wand" ? ["#fff4bd", "#e4b64e", "#966123"]
        : pen === "crystal" ? ["#ffffff", "#e1caff", "#a188bd"] : ["#f0ffff", "#46efd0", "#25aacb"];
      text.set("fill", new Gradient({ type: "linear", coords: { x1: 0, y1: 0, x2: 0, y2: text.height },
        colorStops: colors.map((color, index) => ({ offset: index / 2, color })) }));
    }
    canvas.add(text);
    canvas.add(new FabricText("xitrum-AI-studio", {
      left: 1240, top: 678, originX: "right", originY: "top", fontSize: 20,
      fontFamily: watermarkFont.family, fontWeight: watermarkFont.weight, fill: preset.ink, opacity: 0.85,
      shadow: new Shadow({ color: preset.background, blur: 4, offsetX: 0, offsetY: 0 }),
    }));
    canvas.renderAll();
    return canvas.toDataURL({ format: "png", multiplier: 1 });
  } finally {
    await canvas.dispose();
  }
}
