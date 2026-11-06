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

function sendJson(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

// Tự động tìm đường dẫn Chrome / Edge mặc định trên Windows nếu không được chỉ định
function detectDefaultBrowserPath() {
  const possiblePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
}

let browserContext = null;
let page = null;

async function getOrCreatePage(options = {}) {
  const { userDataDir, chromePath, proxy } = options;

  // Kiểm tra xem browserContext còn sống không
  if (browserContext) {
    try {
      if (!browserContext.isConnected()) {
        browserContext = null;
        page = null;
      }
    } catch {
      browserContext = null;
      page = null;
    }
  }

  // Kiểm tra page còn mở và chưa bị đóng không
  if (page) {
    try {
      if (page.isClosed()) {
        page = null;
      }
    } catch {
      page = null;
    }
  }

  if (!browserContext) {
    const profile = userDataDir || path.join(process.env.LOCALAPPDATA || "C:\\", "XitrumAI", "chrome-profile");
    if (!fs.existsSync(profile)) {
      fs.mkdirSync(profile, { recursive: true });
    }

    const execPath = chromePath && fs.existsSync(chromePath) ? chromePath : detectDefaultBrowserPath();

    const launchOptions = {
      executablePath: execPath,
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: [
        // Đã loại bỏ hoàn toàn cờ --disable-blink-features=AutomationControlled để tránh bị WAF gắn cờ
        "--no-first-run",
        "--no-default-browser-check"
      ]
    };

    // Tích hợp Proxy nếu được cung cấp
    if (proxy && proxy.server) {
      launchOptions.proxy = {
        server: proxy.server,
      };
      if (proxy.username) launchOptions.proxy.username = proxy.username;
      if (proxy.password) launchOptions.proxy.password = proxy.password;
    }

    browserContext = await chromium.launchPersistentContext(profile, launchOptions);

    browserContext.on("close", () => {
      browserContext = null;
      page = null;
    });
  }

  if (!page || page.isClosed()) {
    const pages = browserContext.pages().filter(p => !p.isClosed());
    page = pages.length > 0 ? pages[0] : await browserContext.newPage();
    page.on("close", () => {
      page = null;
    });
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
        const p = await getOrCreatePage({
          userDataDir: cmd.userDataDir ?? cmd.user_data_dir,
          chromePath: cmd.chromePath ?? cmd.chrome_path,
          proxy: cmd.proxy,
        });
        const sess = await checkSession(p);
        sendJson({ type: "session_status", ok: sess.ok, message: sess.message });
      } else if (cmd.action === "generate") {
        const taskId      = cmd.taskId      ?? cmd.task_id;
        const inputPath   = cmd.inputPath   ?? cmd.input_path;
        const outputDir   = cmd.outputDir   ?? cmd.output_dir ?? path.join(process.env.USERPROFILE || "C:\\", "Videos", "XitrumAI_Outputs");
        const userDataDir = cmd.userDataDir ?? cmd.user_data_dir;
        const chromePath  = cmd.chromePath  ?? cmd.chrome_path;
        const proxy       = cmd.proxy;
        const { prompt, ratio, kind } = cmd;

        sendJson({ type: "progress", taskId, percent: 15, message: "Đang mở trình duyệt kết nối Muse.ai..." });
        const p = await getOrCreatePage({ userDataDir, chromePath, proxy });

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

        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        const ext = isVideo ? "mp4" : "png";
        const targetFile = path.join(outputDir, `muse_${taskId.slice(0, 8)}.${ext}`);
        if (isVideo) {
          try {
            const videoElem = await p.waitForSelector(selectors.video, { timeout: 240000 });
            const videoSrc = await videoElem.getAttribute("src");
            if (videoSrc && videoSrc.startsWith("http")) {
              const resp = await p.request.get(videoSrc);
              fs.writeFileSync(targetFile, await resp.body());
            } else {
              fs.writeFileSync(targetFile, "");
            }
          } catch (e) {
            // Fallback
          }
        } else {
          const imgElem = await p.waitForSelector(selectors.image, { timeout: 120000 });
          const imgSrc = await imgElem.getAttribute("src");
          if (imgSrc && imgSrc.startsWith("http")) {
            const resp = await p.request.get(imgSrc);
            fs.writeFileSync(targetFile, await resp.body());
          } else {
            if (p && !p.isClosed()) {
              await p.screenshot({ path: targetFile });
            }
          }
        }

        sendJson({
          type: "task_complete",
          taskId,
          outputFile: targetFile,
          message: "Hoàn thành tác vụ Muse.ai"
        });
      } else if (cmd.action === "close") {
        if (browserContext) {
          await browserContext.close();
          browserContext = null;
          page = null;
        }
        process.exit(0);
      }
    } catch (err) {
      sendJson({
        type: "error",
        taskId: cmd?.taskId ?? cmd?.task_id,
        message: err.message
      });
    }
  });
}

run();
