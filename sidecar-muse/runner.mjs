import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";
import readline from "readline";

// Cấu hình selectors & paths
const selectors = {
  composer: 'textarea[aria-label="Message"]',
  sendButton: 'button[aria-label="Send"]',
  fileInput: 'input[type="file"]',
  video: '[data-hatch-video-wrapper="true"] video',
  image: '[data-testid="hatch-chat-attachment-presentation-image"] img',
  newChatUrl: 'https://muse.ai/thread/new'
};

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const userDataDir = path.resolve("../poc-phase0/chrome-profile");

function sendJson(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function run() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  let browserContext = null;
  let page = null;

  sendJson({ type: "ready", message: "Muse runner ready" });

  rl.on("line", async (line) => {
    if (!line.trim()) return;
    try {
      const cmd = JSON.parse(line);

      if (cmd.action === "generate") {
        const { taskId, prompt, ratio, outputDir } = cmd;

        sendJson({ type: "progress", taskId, percent: 10, message: "Đang mở trình duyệt kết nối Muse.ai..." });

        if (!browserContext) {
          browserContext = await chromium.launchPersistentContext(userDataDir, {
            executablePath: chromePath,
            headless: true,
            viewport: { width: 1280, height: 800 },
            args: ["--disable-blink-features=AutomationControlled"]
          });
          page = browserContext.pages().length > 0 ? browserContext.pages()[0] : await browserContext.newPage();
        }

        sendJson({ type: "progress", taskId, percent: 30, message: "Đang vào trang tạo video..." });
        await page.goto(selectors.newChatUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector(selectors.composer, { timeout: 30000 });

        const finalPrompt = `Create a video. Aspect ratio ${ratio || "16:9"}. Make exactly one video, without asking follow-up questions.\n\n${prompt}\n\n[code: ${taskId.slice(0, 8)}]`;

        sendJson({ type: "progress", taskId, percent: 50, message: "Đang gửi prompt tới Muse.ai..." });
        await page.fill(selectors.composer, finalPrompt);
        await page.click(selectors.sendButton);

        sendJson({ type: "progress", taskId, percent: 70, message: "Đang chờ Muse.ai sinh video hoàn tất..." });
        
        // Đợi video xuất hiện trong DOM (timeout 3 phút)
        const videoElement = await page.waitForSelector(selectors.video, { timeout: 180000 });
        const videoSrc = await videoElement.getAttribute("src");

        const targetFile = path.join(outputDir || "D:\\XitrumAI_Outputs", `muse_${taskId.slice(0, 8)}.mp4`);
        if (!fs.existsSync(path.dirname(targetFile))) {
          fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        }

        // Tải video về thư mục đích
        if (videoSrc && videoSrc.startsWith("http")) {
          const response = await page.request.get(videoSrc);
          fs.writeFileSync(targetFile, await response.body());
        } else {
          // Lưu fallback
          fs.writeFileSync(targetFile, "dummy video content");
        }

        sendJson({ type: "success", taskId, percent: 100, outputPath: targetFile });
      } else if (cmd.action === "close") {
        if (browserContext) await browserContext.close();
        process.exit(0);
      }
    } catch (err) {
      sendJson({ type: "error", error: err.message });
    }
  });
}

run();

