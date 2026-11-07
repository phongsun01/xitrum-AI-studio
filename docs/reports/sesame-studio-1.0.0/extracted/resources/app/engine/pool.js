/**
 * POOL — chạy song song các task trên nhiều tài khoản Muse. Scheduler chọn cặp task → tài khoản,
 * Pool gắn task vào trang Muse của tài khoản đó và chạy runTask (không đổi từ Đợt 1).
 * Không phụ thuộc Electron: store, trang Muse, runTask truyền vào.
 */

const { plan, pausedUntil } = require('./scheduler');
const { runTask, failurePatch } = require('./muse-runner');

const realSleep = ms => new Promise(r => setTimeout(r, ms));
// Nghỉ ngẫu nhiên 15–20s giữa 2 lần gửi trên cùng tài khoản: gửi dồn dập dễ bị Muse nghi là tool.
// ponytail: hằng số cứng, thêm ô cài đặt nếu người dùng cần chỉnh.
const randomGap = () => 15e3 + Math.random() * 5e3;

class Pool {
  // skip(task): true → task chờ chưa được chạy (dự án đang tạm dừng)
  constructor({ tasks, accounts, pageFor, config, loadImage, onFiles = () => {}, run = runTask, sleep = realSleep, now = Date.now, skip = () => false, gap = randomGap, onNeedLogin = null }) {
    Object.assign(this, { tasks, accounts, pageFor, config, loadImage, onFiles, run, sleep, now, skip, gap, onNeedLogin });
    this.running = new Map(); // taskId → accountId
  }

  busy(accId) {
    return [...this.running.values()].filter(id => id === accId).length;
  }

  pump() {
    const pairs = plan({ tasks: this.tasks.list().filter(t => t.status !== 'queued' || !this.skip(t)), accounts: this.accounts.list(), settings: this.accounts.settings, running: this.running, now: this.now() });
    for (const { taskId, accountId } of pairs) this.runOne(this.tasks.get(taskId), accountId);
  }

  // Trang vừa mở còn đang tải → login() báo chưa; dò thêm ~1 phút trước khi kết luận
  async checkLogin(accId, tries = 20) {
    const page = this.pageFor(accId);
    for (let i = 0; i < tries; i++) {
      // Lần đầu được mở Chrome; sau đó người dùng đóng Chrome → thôi dò, KHÔNG mở lại (đóng rồi lại hiện Chrome khác)
      if (i && page.chrome?.running === false) break;
      if ((await page.login().catch(() => null))?.loggedIn) {
        if (this.accounts.get(accId)?.loggedIn !== true) this.accounts.update(accId, { loggedIn: true });
        return true;
      }
      if (i < tries - 1) await this.sleep(3000);
    }
    this.accounts.update(accId, { loggedIn: false });
    return false;
  }

  async refreshQuota(accId) {
    const q = await this.pageFor(accId).quota().catch(() => null);
    if (q && this.accounts.get(accId)) this.accounts.update(accId, { quota: q });
    return q;
  }

  async runOne(task, accId) {
    const id = task.id;
    this.running.set(id, accId);
    const page = this.pageFor(accId);
    const isLive = () => this.tasks.get(id)?.status === 'processing';
    const cfg = this.config();
    let done = false;
    try {
      if (task.status === 'queued') {
        // giữ chỗ trước khi dò đăng nhập: pump() chạy chồng không lấy lại task này
        this.tasks.update(id, { status: 'processing', accountId: accId, step: 'Kiểm tra đăng nhập', startedAt: this.now(), finishedAt: 0, attempts: task.attempts + 1, error: '', files: [], sessionId: '', held: false });
        let logged = await this.checkLogin(accId, 2);
        if (!logged) {
          const acc = this.accounts.get(accId);
          if (typeof this.onNeedLogin === 'function') {
            await this.onNeedLogin(accId);
          } else {
            await page.show().catch(() => {});
          }
          this.tasks.update(id, { step: `Vui lòng đăng nhập ${acc?.name || 'tài khoản'} trên cửa sổ Chrome vừa mở` });
          logged = await this.checkLogin(accId, 60);
        }
        if (!logged) {
          if (isLive()) this.tasks.update(id, { status: 'queued', accountId: '', step: '', attempts: task.attempts - 1, error: `${this.accounts.get(accId)?.name || accId} chưa đăng nhập` });
          return;
        }
        const wait = (this.accounts.get(accId)?.lastUsedAt || 0) + this.gap() - this.now();
        if (wait > 0) {
          this.tasks.update(id, { step: `Nghỉ ~${Math.ceil(wait / 1000)}s rồi mới gửi (tránh gửi dồn)` });
          await this.sleep(wait);
          if (!isLive()) return;
        }
      }
      const files = await this.run(this.tasks.get(id), { page, accountId: accId, update: p => this.tasks.update(id, p), isLive, outputDir: cfg.outputDir, loadImage: this.loadImage, limits: cfg.limits });
      done = true;
      if (!files || !isLive()) return;
      // Ảnh xong → ghi link chat để video làm tiếp trong cùng chat (link chat Muse = /thread/<sessionId>)
      const sid = this.tasks.get(id).sessionId;
      this.tasks.update(id, { status: 'succeeded', step: `Đã tải ${files.length} file`, finishedAt: this.now(), files,
        ...(task.kind === 'image' && sid ? { thread: `https://muse.ai/thread/${sid}` } : {}) });
      this.onFiles(files);
    } catch (e) {
      if (!isLive()) return;
      // Muse không nhận lệnh: có thể do hết hạn mức → đọc hạn mức; tài khoản phải nghỉ thì trả task về hàng đợi, không tốn lượt
      if (/^Muse không nhận lệnh/.test(e.message)) {
        await this.refreshQuota(accId);
        const acc = this.accounts.get(accId);
        if (acc && pausedUntil(acc, this.accounts.settings, this.now())) {
          const t = this.tasks.get(id);
          this.tasks.update(id, { status: 'queued', accountId: '', sessionId: '', step: '', attempts: t.attempts - 1, error: `${acc.name} hết hạn mức, chờ tài khoản khác` });
          return;
        }
      }
      this.tasks.update(id, failurePatch(this.tasks.get(id), e, this.now(), cfg.maxAttempts));
    } finally {
      this.running.delete(id);
      if (this.accounts.get(accId)) {
        this.accounts.update(accId, { lastUsedAt: this.now() });
        if (done) this.refreshQuota(accId); // không chặn
      }
      setImmediate(() => this.pump());
    }
  }

  cancel(id) {
    const task = this.tasks.get(id);
    if (!task || (task.status !== 'queued' && task.status !== 'processing')) return task || null;
    if (task.status === 'processing' && task.sessionId) this.pageFor(task.accountId || 'default').cancel(task.sessionId).catch(() => {});
    this.tasks.update(id, { status: 'cancelled', error: 'Đã huỷ', finishedAt: this.now() });
    return task;
  }

  // Trước khi xoá tài khoản: task dở của nó không dò tiếp được nữa → gửi lại từ đầu trên tài khoản khác
  releaseAccount(accId) {
    for (const t of this.tasks.list()) {
      if (t.status === 'processing' && (t.accountId || 'default') === accId && !this.running.has(t.id)) {
        this.tasks.update(t.id, { status: 'queued', sessionId: '', accountId: '', step: '', error: 'Tài khoản đã xoá, gửi lại' });
      }
    }
  }
}

module.exports = { Pool };
