import type { WhiteboardFontChoice, WhiteboardFontId, WhiteboardPenType } from "../types/whiteboard";

export const THUMBNAIL_FONTS: ReadonlyArray<{ id: WhiteboardFontId; label: string; family: string; file: string; weight: number }> = [
  { id: "charm", label: "Charm · Thư pháp", family: "XitrumCharm", file: "charm.ttf", weight: 700 },
  { id: "mali", label: "Mali · Viết tay", family: "XitrumMali", file: "mali.ttf", weight: 600 },
  { id: "bitter", label: "Bitter · Sách cổ", family: "XitrumBitter", file: "bitter.ttf", weight: 700 },
  { id: "grenzegotisch", label: "Grenze Gotisch · Phù thủy", family: "XitrumGrenzeGotisch", file: "grenzegotisch.ttf", weight: 700 },
  { id: "chakrapetch", label: "Chakra Petch · Công nghệ", family: "XitrumChakraPetch", file: "chakrapetch.ttf", weight: 700 },
  { id: "bevietnampro", label: "Be Vietnam Pro · Hiện đại", family: "XitrumBeVietnamPro", file: "bevietnampro.ttf", weight: 700 },
];

export const PEN_FONTS: Record<WhiteboardPenType, WhiteboardFontId> = {
  pen: "bevietnampro", calligraphy: "charm", bamboo: "mali", vintage: "bitter", technical: "chakrapetch",
  quill: "bitter", digital: "bevietnampro", cyberpunk: "chakrapetch", crystal: "charm", wand: "grenzegotisch",
};

export function resolveCoverFont(pen: WhiteboardPenType, override?: string) {
  const id = override && override !== "auto" ? override : PEN_FONTS[pen];
  const font = THUMBNAIL_FONTS.find((item) => item.id === id);
  if (!font) throw new Error("Font thumbnail không hợp lệ. Hãy chọn lại font.");
  return font;
}

const loadedFonts = new Map<WhiteboardFontId, Promise<void>>();
export function loadCoverFont(id: WhiteboardFontId): Promise<void> {
  const cached = loadedFonts.get(id);
  if (cached) return cached;
  const font = THUMBNAIL_FONTS.find((item) => item.id === id)!;
  // Vite copies public/fonts into the app bundle. No CDN or OS font dependency.
  const url = `${import.meta.env.BASE_URL}fonts/thumbnail/${font.file}`;
  const pending = (async () => {
    try {
      const face = new FontFace(font.family, `url("${url}") format("truetype")`, { style: "normal", weight: String(font.weight) });
      await face.load();
      document.fonts.add(face);
    } catch {
      loadedFonts.delete(id);
      throw new Error(`Không tải được font offline ${font.label}. Hãy kiểm tra bản cài đặt ứng dụng.`);
    }
  })();
  loadedFonts.set(id, pending);
  return pending;
}

export function normalizeCoverFontChoice(value: unknown): WhiteboardFontChoice {
  return THUMBNAIL_FONTS.some((font) => font.id === value) ? value as WhiteboardFontId : "auto";
}
