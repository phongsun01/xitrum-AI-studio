/**
 * ACCOUNT STORE — các tài khoản Muse + cài đặt chạy song song, lưu ở userData/accounts.json.
 * Mỗi tài khoản 1 Chrome riêng, profile userData/profiles/<id>. 'default' là profile của Đợt 1.
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_SETTINGS = { maxAccounts: 2, totalThreads: 2, mode: 'rotate', useTopup: true, keepGoing: false, proxies: '', usePool: false };
const clamp = (v, lo, hi, def) => Math.min(Math.max(parseInt(v, 10) || def, lo), hi);

function cleanSettings(s = {}) {
  return {
    maxAccounts: clamp(s.maxAccounts ?? DEFAULT_SETTINGS.maxAccounts, 1, 20, 1),
    totalThreads: clamp(s.totalThreads ?? DEFAULT_SETTINGS.totalThreads, 1, 50, 1),
    mode: s.mode === 'sequential' ? 'sequential' : 'rotate',
    useTopup: s.useTopup ?? DEFAULT_SETTINGS.useTopup,
    keepGoing: s.keepGoing ?? DEFAULT_SETTINGS.keepGoing,
    proxies: String(s.proxies ?? '').slice(0, 20000), // mỗi dòng 1 proxy, xem engine/proxy.js
    usePool: Boolean(s.usePool ?? String(s.proxies ?? '').trim()) // công tắc kho proxy dự phòng; bản cũ đã có danh sách → coi như bật
  };
}

function cleanAccount(a) {
  const provider = ['muse', 'google_flow', 'seedance', 'dola'].includes(a.provider) ? a.provider : 'muse';
  const name = String(a.name || a.id).slice(0, 60);
  return {
    id: a.id, name, provider,
    apiKey: String(a.apiKey || '').slice(0, 300), enabled: a.enabled !== false,
    threads: clamp(a.threads ?? 1, 1, 5, 1), loggedIn: a.loggedIn ?? true, quota: a.quota || null, lastUsedAt: a.lastUsedAt || 0,
    // proxy: '' = tự chọn trong danh sách, 'none' = không dùng, còn lại = 1 dòng proxy cố định; proxyAuto = proxy đang được tự chọn (giữ cố định)
    proxy: String(a.proxy || '').slice(0, 300), proxyAuto: String(a.proxyAuto || '').slice(0, 300)
  };
}

class AccountStore extends EventEmitter {
  constructor(dir = (typeof app !== 'undefined' && app?.getPath ? app.getPath('userData') : path.join(process.env.APPDATA || process.env.HOME || '.', 'sesame-studio'))) {
    super();
    this.file = path.join(dir, 'accounts.json');
    let data = {};
    try { data = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch {}
    this.settings = cleanSettings(data.settings);
    const loaded = (Array.isArray(data.accounts) ? data.accounts : [])
      .filter(a => a && typeof a.id === 'string' && a.id)
      .map(a => {
        if (a.id === 'acc_seedance_1' && a.provider === 'seedance' && /^seedance/i.test(String(a.name || ''))) {
          return cleanAccount({ ...a, id: 'acc_dola_1', name: 'Dola 1 (Seedance 2.0)', provider: 'dola', loggedIn: true });
        }
        return cleanAccount(a);
      });
    const seenIds = new Set();
    this.accounts = loaded.filter(a => {
      if (seenIds.has(a.id)) return false;
      seenIds.add(a.id);
      return true;
    });
    if (!this.accounts.length) {
      this.accounts = [
        cleanAccount({ id: 'default', name: 'Tài khoản 1', provider: 'muse', enabled: true, loggedIn: true }),
        cleanAccount({ id: 'acc_5f95e2ab', name: 'Google Flow 1', provider: 'google_flow', enabled: true, loggedIn: true }),
        cleanAccount({ id: 'acc_dola_1', name: 'Dola 1 (Seedance 2.0)', provider: 'dola', enabled: true, loggedIn: true })
      ];
      this.flush();
    } else if (data.accounts && JSON.stringify(data.accounts) !== JSON.stringify(this.accounts)) {
      this.flush();
    }
  }

  changed() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 200);
    this.emit('change');
  }

  flush() {
    clearTimeout(this.saveTimer);
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify({ settings: this.settings, accounts: this.accounts }, null, 1));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[AccountStore] Không ghi được accounts.json:', e.message);
    }
  }

  list() { return this.accounts; }
  get(id) { return this.accounts.find(a => a.id === id); }

  add(name, provider = 'muse') {
    const p = ['muse', 'google_flow', 'seedance', 'dola'].includes(provider) ? provider : 'muse';
    let defaultName = '';
    if (p === 'google_flow') {
      const count = this.accounts.filter(a => a.provider === 'google_flow').length + 1;
      defaultName = `Google Flow ${count}`;
    } else if (p === 'seedance') {
      const count = this.accounts.filter(a => a.provider === 'seedance').length + 1;
      defaultName = `Seedance ${count}`;
    } else if (p === 'dola') {
      const count = this.accounts.filter(a => a.provider === 'dola').length + 1;
      defaultName = `Dola ${count}`;
    } else {
      defaultName = `Tài khoản ${this.accounts.length + 1}`;
    }
    const acc = cleanAccount({
      id: 'acc_' + crypto.randomBytes(4).toString('hex'),
      name: String(name || '').trim() || defaultName,
      provider: p
    });
    this.accounts.push(acc);
    this.changed();
    return acc;
  }

  update(id, patch) {
    const i = this.accounts.findIndex(a => a.id === id);
    if (i < 0) return null;
    this.accounts[i] = cleanAccount({ ...this.accounts[i], ...patch, id });
    this.changed();
    return this.accounts[i];
  }

  remove(id) {
    if (this.accounts.length <= 1 || !this.get(id)) return false;
    this.accounts = this.accounts.filter(a => a.id !== id);
    this.changed();
    return true;
  }

  setSettings(patch) {
    this.settings = cleanSettings({ ...this.settings, ...patch });
    this.changed();
    return this.settings;
  }
}

module.exports = { AccountStore, DEFAULT_SETTINGS };
