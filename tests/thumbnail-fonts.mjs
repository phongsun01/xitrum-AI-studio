// Start `npm run dev`, then `node tests/thumbnail-fonts.mjs`.
// CHROME_PATH may point to another installed Chromium browser.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const external = [], fontRequests = [], errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http") && new URL(url).hostname !== "127.0.0.1") {
      external.push(url);
      return route.abort();
    }
    if (url.endsWith(".ttf")) fontRequests.push(url);
    return route.continue();
  });
  await page.addInitScript(() => {
    const illustration = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#f3e5cc"/><path d="M0 720L300 350L650 650L1000 330L1280 720Z" fill="#846d58"/></svg>');
    window.__savedProject = null;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (cmd, args = {}) => {
      if (cmd === "plugin:dialog|open") return "/fixture/cover.png";
      if (cmd === "plugin:dialog|save") return "/fixture/project.whiteboard.json";
      if (cmd === "read_whiteboard_cover_image") return illustration;
      if (cmd === "save_whiteboard_project") { window.__savedProject = structuredClone(args.project); return { success: true }; }
      if (cmd === "load_whiteboard_project") return window.__savedProject;
      if (cmd === "check_whiteboard_env") return { ok: true, missing: [] };
      if (cmd === "get_config") return {};
      if (cmd.startsWith("list_")) return [];
      if (cmd === "check_file_exists") return true;
      if (cmd === "get_lane_status") return { muse_available_slots: 1, local_available_slots: 2 };
      if (cmd.startsWith("has_")) return false;
      return null;
    } };
  });
  await page.goto("http://127.0.0.1:1420");
  await page.getByRole("button", { name: "Bảng Trắng Vẽ Tay" }).click();
  await page.getByLabel("Tiêu đề ảnh bìa", { exact: true }).fill("KINH CHÂU · LỮ BỐ · TRƯỜNG GIANG");
  const pen = page.getByLabel("Loại bút vẽ toàn dự án", { exact: true });
  const font = page.getByLabel("Font tiêu đề", { exact: true });
  await pen.selectOption("calligraphy");
  assert.match(await font.locator("option:checked").textContent(), /Charm/);
  await pen.selectOption("wand");
  assert.match(await font.locator("option:checked").textContent(), /Grenze Gotisch/);
  await font.selectOption("mali");
  await pen.selectOption("cyberpunk");
  assert.equal(await font.inputValue(), "mali"); // Explicit override survives pen change.
  await page.getByRole("button", { name: "Chọn ảnh riêng", exact: true }).click();
  await page.getByRole("button", { name: "Tạo Thumbnail", exact: true }).click();
  const preview = page.getByAltText("Xem trước thumbnail đã tạo");
  await preview.waitFor();
  const png = await preview.getAttribute("src");
  assert(png.startsWith("data:image/png;base64,"));
  await page.getByRole("button", { name: "Lưu Dự Án", exact: true }).click();
  await page.waitForFunction(() => window.__savedProject?.thumbnail?.fontChoice === "mali");
  await font.selectOption("bitter");
  assert(await page.getByText("Bìa cần cập nhật · Nhấn tạo lại", { exact: false }).isVisible());
  await page.getByRole("button", { name: "Mở Dự Án", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#wb-cover-font").value === "mali");
  assert.equal(await preview.getAttribute("src"), png);
  assert(await page.getByText("Thumbnail sẵn sàng", { exact: false }).isVisible());
  // Cold-load all six fonts and render every pen with external network blocked.
  const results = await page.evaluate(async () => {
    const { THUMBNAIL_FONTS, PEN_FONTS, loadCoverFont } = await import("/src/lib/whiteboardFonts.ts");
    const { createWhiteboardThumbnail } = await import("/src/lib/whiteboardThumbnail.ts");
    const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#f3e5cc"; ctx.fillRect(0, 0, 1280, 720);
    const art = canvas.toDataURL();
    for (const font of THUMBNAIL_FONTS) {
      await loadCoverFont(font.id);
      if (!document.fonts.check(`${font.weight} 40px ${font.family}`, "Ă Â Đ Ê Ô Ơ Ư Ắ Ữ Ộ Ỳ")) throw new Error(`Font failed: ${font.id}`);
    }
    const results = [];
    for (const pen of Object.keys(PEN_FONTS)) {
      const result = await createWhiteboardThumbnail("Thư pháp · Phù thủy · Lữ Bố · Trường Giang".normalize("NFD"), pen, art);
      results.push(result);
    }
    return results;
  });
  assert.equal(new Set(results).size, 10);
  assert.equal(new Set(fontRequests).size, 6);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log("Passed: 6 local fonts, 10 pen effects, Vietnamese NFC/NFD, auto/manual selection, saved PNG/font roundtrip, stale cover warning; no external requests.");
} finally {
  await browser.close();
}
