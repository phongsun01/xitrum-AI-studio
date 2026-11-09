import type { WhiteboardFolderImageItem, WhiteboardSceneImageMapping } from "../types/whiteboard";

export function validBatchImage(image?: WhiteboardFolderImageItem | null): image is WhiteboardFolderImageItem {
  return Boolean(image && !image.error && image.width && image.width > 0 && image.height && image.height > 0);
}

/** Duplicate rows require an explicit choice; error/missing rows can never be applied. */
export function selectedBatchImage(mapping: WhiteboardSceneImageMapping, choice?: string): WhiteboardFolderImageItem | undefined {
  if (mapping.status === "ready" && validBatchImage(mapping.matchedImage)) return mapping.matchedImage;
  if (mapping.status !== "duplicate" || !choice) return undefined;
  const candidate = mapping.candidateImages.find(image => image.path === choice);
  return validBatchImage(candidate) ? candidate : undefined;
}

/** Existence/read errors propagate: they must never authorize an overwrite. */
export async function nextAnnotationPath(path: string, exists: (path: string) => Promise<boolean>): Promise<string> {
  if (!await exists(path)) return path;
  const version = path.match(/\.v(\d+)\.annotation\.json$/i);
  const start = version ? Number(version[1]) + 1 : 2;
  const base = /\.annotation\.json$/i.test(path)
    ? path.replace(/(?:\.v\d+)?\.annotation\.json$/i, "")
    : path.replace(/\.[^./\\]+$/, "");
  for (let i = start; Number.isSafeInteger(i) && i < start + 1000; i++) {
    const candidate = `${base}.v${i}.annotation.json`;
    if (!await exists(candidate)) return candidate;
  }
  throw new Error("Không tìm được tên annotation còn trống. Hãy chọn thư mục đầu ra khác.");
}
