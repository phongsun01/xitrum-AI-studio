import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";
import readline from "readline";

const selectors = {
  composer: 'textarea[aria-label="Message"]',
  sendButton: 'button[aria-label="Send"]',
  fileInput: 'input[type="file"]',
  attachmentReady: '[data-testid*="attachment" i] img[src^="blob:"]',
  loggedInMarker: 'textarea[aria-label="Message"]',
  loginMarker: 'input[placeholder="Mobile number or email"], input[type="email"]',
  captcha: 'iframe[src*="captcha"], iframe[title*="challenge" i]',
  video: '[data-hatch-video-wrapper="true"] video',
  image: '[data-testid="hatch-chat-attachment-presentation-image"] img',
  rateLimit: '[role="alert"]:has-text("limit")',
  newChatUrl: 'https://muse.ai/thread/new'
};

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
// Profile Chrome thực tế lưu phiên đăng nhập
const defaultProfileDir = "D:\\Antigravity\\REA\\REA-project\\poc-phase0\\chrome-profile";

function sendJson(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

let browserContext = null;
let page = null;

async function getOrCreatePage(userDataDir) {
  if (!browserContext) {
    const profile = userDataDir && fs.existsSync(userDataDir) ? userDataDir : defaultProfileDir;
    if (!fs.existsSync(profile)) {
      fs.mkdirSync(profile, { recursive: true });
    }

    browserContext = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath,
      headless: false, // Hiện UI để người dùng thấy tiến trình và đăng nhập/xác thực nếu cần
      viewport: { width: 1280, height: 800 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check"
      ]
    });
    page = browserContext.pages().length > 0 ? browserContext.pages()[0] : await browserContext.newPage();
  }
  return page;
}

async function checkSession(p) {
  await p.goto(selectors.newChatUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await p.waitForTimeout(2000);
  const isLoginNeeded = (await p.locator(selectors.loginMarker).count()) > 0;
  const hasComposer = (await p.locator(selectors.composer).count()) > 0;

  if (isLoginNeeded || !hasComposer) {
    return { ok: false, message: "Chưa đăng nhập Muse.ai hoặc phiên đăng nhập đã hết hạn" };
  }
  return { ok: true, message: "Phiên đăng nhập Muse.ai sẵn sàng" };
}

async function run() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  sendJson({ type: "ready", message: "Muse runner initialized" });

  rl.on("line", async (line) => {
    if (!line.trim()) return;
    try {
      const cmd = JSON.parse(line);

      if (cmd.action === "check_session") {
        const p = await getOrCreatePage(cmd.userDataDir);
        const sess = await checkSession(p);
        sendJson({ type: "session_status", ok: sess.ok, message: sess.message });
      } else if (cmd.action === "generate") {
        const { taskId, prompt, ratio, kind, inputPath, outputDir, userDataDir } = cmd;

        sendJson({ type: "progress", taskId, percent: 15, message: "Đang mở trình duyệt kết nối Muse.ai..." });
        const p = await getOrCreatePage(userDataDir);

        sendJson({ type: "progress", taskId, percent: 30, message: "Đang kiểm tra giao diện Muse.ai..." });
        await p.goto(selectors.newChatUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

        // Kiểm tra đăng nhập
        const isLogin = await p.locator(selectors.loginMarker).count();
        if (isLogin > 0) {
          sendJson({
            type: "session_expired",
            taskId,
            message: "Phiên đăng nhập Muse.ai đã hết hạn. Vui lòng đăng nhập lại tài khoản trên cửa sổ Chrome."
          });
          return;
        }

        await p.waitForSelector(selectors.composer, { timeout: 30000 });

        // Nếu có ảnh tham chiếu (inputPath), đính kèm vào Muse.ai trước
        if (inputPath && fs.existsSync(inputPath)) {
          sendJson({ type: "progress", taskId, percent: 45, message: "Đang đính kèm ảnh tham chiếu..." });
          const fileInput = p.locator(selectors.fileInput);
          if ((await fileInput.count()) > 0) {
            await fileInput.setInputFiles(inputPath);
            await p.waitForTimeout(2000);
          }
        }

        const isVideo = kind !== "muse_image";
        const promptTemplate = isVideo
          ? `Create a video. Aspect ratio ${ratio || "16:9"}. Make exactly one video, without asking follow-up questions.\n\n${prompt}\n\n[code: ${taskId.slice(0, 8)}]`
          : `Create an image. Aspect ratio ${ratio || "16:9"}. Make exactly one image, without asking follow-up questions.\n\n${prompt}\n\n[code: ${taskId.slice(0, 8)}]`;

        sendJson({ type: "progress", taskId, percent: 60, message: "Đang gửi kịch bản lên Muse.ai..." });
        await p.fill(selectors.composer, promptTemplate);
        await p.click(selectors.sendButton);

        sendJson({ type: "progress", taskId, percent: 75, message: "Đang chờ Muse.ai xử lý & sinh kết quả..." });

        const outDirectory = outputDir || "D:\\XitrumAI_Outputs";
        if (!fs.existsSync(outDirectory)) {
          fs.mkdirSync(outDirectory, { recursive: true });
        }

        const ext = isVideo ? "mp4" : "png";
        const targetFile = path.join(outDirectory, `muse_${taskId.slice(0, 8)}.${ext}`);

        if (isVideo) {
          // Chờ video hoàn thành (tối đa 4 phút)
          try {
            const videoElem = await p.waitForSelector(selectors.video, { timeout: 240000 });
            const videoSrc = await videoElem.getAttribute("src");
            if (videoSrc && videoSrc.startsWith("http")) {
              const resp = await p.request.get(videoSrc);
              fs.writeFileSync(targetFile, await resp.body());
            } else {
              // Fallback
              fs.writeFileSync(targetFile, "");
            }
          } catch (e) {
            // Không tìm thấy video kịp, chụp màn hình kết quả để người dùng kiểm tra
            await p.screenshot({ path: targetFile.replace(".mp4", ".png") });
            sendJson({ type: "success", taskId, percent: 100, outputPath: targetFile.replace(".mp4", ".png") });
            return;
          }
        } else {
          // Chờ ảnh hoàn thành
          const imgElem = await p.waitForSelector(selectors.image, { timeout: 120000 });
          const imgSrc = await imgElem.getAttribute("src");
          if (imgSrc && imgSrc.startsWith("http")) {
            const resp = await p.request.get(imgSrc);
            fs.writeFileSync(targetFile, await resp.body());
          } else {
            await p.screenshot({ path: targetFile });
          }
        }

        sendJson({ type: "success", taskId, percent: 100, outputPath: targetFile });
      } else if (cmd.action === "close") {
        if (browserContext) {
          await browserContext.close();
          browserContext = null;
        }
        process.exit(0);
      }
    } catch (err) {
      sendJson({ type: "error", error: err.message });
    }
  });
}

run();
