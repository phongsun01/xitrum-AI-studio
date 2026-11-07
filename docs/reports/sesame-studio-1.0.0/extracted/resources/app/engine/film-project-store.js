const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODES = new Set(['film', 'story', 'hiu', 'affiliate']);
const STATUSES = new Set(['draft', 'approved', 'held', 'running', 'done', 'failed']);
const PROJECT_ID = /^film_[a-f0-9]{16,64}$/;
const ENTITY_ID = /^[a-z][a-z0-9_\-]{0,63}$/;
const ASSET_ID = /^asset_[a-f0-9]{16,64}$/;
const LIMIT = 10 * 1024 * 1024;
const MAX_ASSET = 50 * 1024 * 1024;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function fail(message) { throw new Error(message); }
function obj(v, label) { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`Invalid ${label}`); return v; }
function keys(v, allowed, label) { for (const k of Object.keys(v)) if (!allowed.includes(k)) fail(`Unknown ${label} field: ${k}`); }
function text(v, max, label, optional = false) {
  if (optional && v === undefined) return undefined;
  if (typeof v !== 'string' || Buffer.byteLength(v, 'utf8') > max) fail(`Invalid ${label}`);
  return v.trim();
}
function id(v, regex, label) { if (typeof v !== 'string' || !regex.test(v)) fail(`Invalid ${label}`); return v; }
function ids(v, label) {
  if (!Array.isArray(v) || v.length > 100) fail(`Invalid ${label}`);
  const out = v.map(x => id(x, ENTITY_ID, label));
  if (new Set(out).size !== out.length) fail(`Duplicate ${label}`);
  return out;
}
function unique(items, label) { if (new Set(items.map(x => x.id)).size !== items.length) fail(`Duplicate ${label}`); }
function normalCharacter(c) {
  obj(c, 'character'); keys(c, ['id', 'name', 'look', 'assetIds'], 'character');
  const out = { id: id(c.id, ENTITY_ID, 'character id'), name: text(c.name, 120, 'character name'), assetIds: ids(c.assetIds || [], 'assetIds') };
  if (!out.name) fail('Empty character name');
  if (c.look !== undefined) out.look = text(c.look, 4000, 'look');
  return out;
}
function normalShot(s) {
  obj(s, 'shot'); keys(s, ['id', 'seconds', 'prompt', 'castIds', 'assetIds', 'narration', 'dialogue', 'status', 'taskId', 'outputPath'], 'shot');
  const out = { id: id(s.id, /^shot_[a-z0-9_\-]{1,59}$/, 'shot id'), prompt: text(s.prompt, 12000, 'prompt'), castIds: ids(s.castIds || [], 'castIds'), assetIds: ids(s.assetIds || [], 'assetIds'), status: s.status || 'draft' };
  if (!STATUSES.has(out.status)) fail('Invalid shot status');
  if (s.seconds !== undefined) { if (typeof s.seconds !== 'number' || !Number.isFinite(s.seconds) || s.seconds <= 0 || s.seconds > 3600) fail('Invalid seconds'); out.seconds = s.seconds; }
  if (s.narration !== undefined) out.narration = text(s.narration, 12000, 'narration');
  if (s.dialogue !== undefined) {
    if (!Array.isArray(s.dialogue) || s.dialogue.length > 100) fail('Invalid dialogue');
    out.dialogue = s.dialogue.map(d => text(d, 4000, 'dialogue'));
  }
  if (s.taskId !== undefined) out.taskId = text(s.taskId, 120, 'taskId');
  if (s.outputPath !== undefined) out.outputPath = text(s.outputPath, 2048, 'outputPath');
  return out;
}
function normalScene(s) {
  obj(s, 'scene'); keys(s, ['id', 'title', 'shots'], 'scene');
  if (!Array.isArray(s.shots) || s.shots.length > 500) fail('Invalid shots');
  const out = { id: id(s.id, ENTITY_ID, 'scene id'), shots: s.shots.map(normalShot) };
  if (s.title !== undefined) out.title = text(s.title, 200, 'title');
  unique(out.shots, 'shot id'); return out;
}
function normalAsset(a, projectId) {
  obj(a, 'asset'); keys(a, ['id', 'relPath', 'sha256', 'bytes', 'mime', 'sourceName'], 'asset');
  const aid = id(a.id, ASSET_ID, 'asset id');
  const ext = path.extname(a.relPath || '').toLowerCase();
  const expected = `film-project-assets/${projectId}/${aid}${ext}`;
  if (!MIME[ext] || a.relPath !== expected || a.mime !== MIME[ext]) fail('Invalid asset path or mime');
  if (!/^[a-f0-9]{64}$/.test(a.sha256) || !Number.isSafeInteger(a.bytes) || a.bytes < 1 || a.bytes > MAX_ASSET) fail('Invalid asset metadata');
  return { id: aid, relPath: expected, sha256: a.sha256, bytes: a.bytes, mime: a.mime, sourceName: text(a.sourceName, 255, 'sourceName') };
}
function normalProject(p) {
  obj(p, 'project'); keys(p, ['id', 'mode', 'name', 'sourceText', 'characters', 'scenes', 'assets', 'revision', 'createdAt', 'updatedAt', 'archived', 'seriesBible'], 'project');
  const pid = id(p.id, PROJECT_ID, 'project id');
  if (!MODES.has(p.mode)) fail('Invalid mode');
  if (!Array.isArray(p.characters) || p.characters.length > 100 || !Array.isArray(p.scenes) || p.scenes.length > 200 || !Array.isArray(p.assets) || p.assets.length > 1000) fail('Invalid project collections');
  const out = { id: pid, mode: p.mode, name: text(p.name, 160, 'name'), characters: p.characters.map(normalCharacter), scenes: p.scenes.map(normalScene), assets: p.assets.map(a => normalAsset(a, pid)), revision: p.revision, createdAt: p.createdAt, updatedAt: p.updatedAt };
  if (!out.name || !Number.isSafeInteger(out.revision) || out.revision < 1 || !Number.isFinite(Date.parse(out.createdAt)) || !Number.isFinite(Date.parse(out.updatedAt))) fail('Invalid project metadata');
  if (p.sourceText !== undefined) out.sourceText = text(p.sourceText, 200000, 'sourceText');
  if (p.archived !== undefined) { if (typeof p.archived !== 'boolean') fail('Invalid archived'); out.archived = p.archived; }
  if (p.seriesBible !== undefined) {
    const sb = p.seriesBible;
    out.seriesBible = {
      premise: text(sb?.premise || '', 5000, 'premise', true) || '',
      mainConflict: text(sb?.mainConflict || '', 5000, 'mainConflict', true) || '',
      episodes: (Array.isArray(sb?.episodes) ? sb.episodes : []).slice(0, 100).map(ep => ({
        ep: Number(ep.ep) || 1,
        title: text(ep.title || '', 160, 'ep title', true) || '',
        summary: text(ep.summary || '', 4000, 'ep summary', true) || '',
        twist: text(ep.twist || '', 2000, 'ep twist', true) || '',
        unresolved: text(ep.unresolved || '', 2000, 'ep unresolved', true) || ''
      }))
    };
  }
  unique(out.characters, 'character id'); unique(out.scenes, 'scene id'); unique(out.assets, 'asset id');
  const characters = new Set(out.characters.map(c => c.id)); const assets = new Set(out.assets.map(a => a.id));
  const shots = out.scenes.flatMap(s => s.shots); unique(shots, 'shot id');
  for (const c of out.characters) for (const ref of c.assetIds) if (!assets.has(ref)) fail('Unknown asset reference');
  for (const s of shots) {
    for (const ref of s.castIds) if (!characters.has(ref)) fail('Unknown cast reference');
    for (const ref of s.assetIds) if (!assets.has(ref)) fail('Unknown asset reference');
  }
  if (Buffer.byteLength(JSON.stringify(out)) > LIMIT) fail('Project too large');
  return out;
}
function parse(raw) {
  const d = JSON.parse(raw); obj(d, 'store'); keys(d, ['version', 'projects'], 'store');
  if (d.version !== 1 || !Array.isArray(d.projects) || d.projects.length > 1000) fail('Invalid store version');
  const projects = d.projects.map(normalProject); unique(projects, 'project id');
  return { version: 1, projects };
}
class FilmProjectStore {
  constructor(dir) {
    if (typeof dir !== 'string' || !dir) fail('Invalid dir');
    this.dir = path.resolve(dir); this.file = path.join(this.dir, 'film-projects-v1.json');
    this.backup = this.file + '.bak'; this.assetsDir = path.join(this.dir, 'film-project-assets');
  }
  _read() { return fs.existsSync(this.file) ? parse(fs.readFileSync(this.file, 'utf8')) : { version: 1, projects: [] }; }
  _save(d) {
    const raw = JSON.stringify(d); if (Buffer.byteLength(raw) > LIMIT * 100) fail('Store too large');
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(tmp, raw, { flag: 'wx' });
      // Never overwrite the last known good backup with corrupt bytes: all callers read/validate first.
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.backup);
      fs.renameSync(tmp, this.file);
    } finally { try { fs.unlinkSync(tmp); } catch {} }
  }
  _find(d, pid) { id(pid, PROJECT_ID, 'project id'); const p = d.projects.find(x => x.id === pid); if (!p) fail('Unknown project'); return p; }
  list() { return structuredClone(this._read().projects); }
  get(pid) { return structuredClone(this._find(this._read(), pid)); }
  hasProject(pid) { return typeof pid === 'string' && PROJECT_ID.test(pid) && this._read().projects.some(p => p.id === pid); }
  create({ name, mode } = {}) {
    if (!MODES.has(mode)) fail('Invalid mode');
    const d = this._read(); const now = new Date().toISOString();
    const p = normalProject({ id: 'film_' + crypto.randomBytes(12).toString('hex'), mode, name, characters: [], scenes: [], assets: [], revision: 1, createdAt: now, updatedAt: now });
    d.projects.push(p); this._save(d); return structuredClone(p);
  }
  replace(pid, changes, expectedRevision) {
    obj(changes, 'changes'); keys(changes, ['characters', 'scenes', 'sourceText', 'seriesBible'], 'changes');
    const d = this._read(); const old = this._find(d, pid);
    if (old.revision !== expectedRevision) fail('Revision conflict');
    const p = normalProject({ ...old, ...changes, revision: old.revision + 1, updatedAt: new Date().toISOString() });
    d.projects[d.projects.indexOf(old)] = p; this._save(d); return structuredClone(p);
  }
  checkDuplicateIdea(pid, newIdeaText) {
    const p = this._find(this._read(), pid);
    const text = String(newIdeaText || '').toLowerCase().trim();
    if (!text || !p.seriesBible?.episodes?.length) return { isDuplicate: false, score: 0 };
    const STOP = new Set(['và', 'là', 'có', 'của', 'được', 'trong', 'với', 'cho', 'này', 'khi', 'đã', 'sẽ', 'nhưng', 'thì', 'mà', 'ở', 'đó', 'từ', 'ra', 'vào']);
    const extractWords = s => new Set(s.split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3 && !STOP.has(w)));
    const newWords = extractWords(text);
    if (!newWords.size) return { isDuplicate: false, score: 0 };
    let highestScore = 0; let matchedEp = null; let sharedWords = [];
    for (const ep of p.seriesBible.episodes) {
      const epWords = extractWords(`${ep.title} ${ep.summary} ${ep.twist}`);
      if (!epWords.size) continue;
      const overlap = [...newWords].filter(w => epWords.has(w));
      const score = Number((overlap.length / Math.min(newWords.size, epWords.size)).toFixed(2));
      if (score > highestScore) {
        highestScore = score; matchedEp = ep; sharedWords = overlap.slice(0, 5);
      }
    }
    const isDuplicate = highestScore >= 0.45;
    return {
      isDuplicate,
      score: highestScore,
      matchedEpisode: matchedEp ? matchedEp.ep : null,
      matchedTitle: matchedEp ? matchedEp.title : '',
      sharedWords,
      warning: isDuplicate ? `Cảnh báo: Ý tưởng này có thể bị trùng lặp với Tập ${matchedEp.ep} ("${matchedEp.title}"). Điểm tương đồng: ${sharedWords.join(', ')}.` : ''
    };
  }
  importAsset(pid, sourcePath) {
    const d = this._read(); const old = this._find(d, pid);
    if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) fail('Invalid source path');
    const source = path.resolve(sourcePath); const st = fs.lstatSync(source);
    if (!st.isFile() || st.isSymbolicLink() || st.size < 1 || st.size > MAX_ASSET) fail('Invalid asset file');
    const ext = path.extname(source).toLowerCase(); if (!MIME[ext]) fail('Unsupported asset type');
    const aid = 'asset_' + crypto.randomBytes(12).toString('hex');
    const relPath = `film-project-assets/${pid}/${aid}${ext}`;
    const base = path.join(this.assetsDir, pid);
    // Reject symlink ancestors rather than letting an attacker redirect the copy outside userData.
    for (let cur = this.dir; ; cur = path.dirname(cur)) { if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink()) fail('Symlink directory'); if (cur === path.dirname(cur)) break; }
    for (const cur of [this.assetsDir, base]) if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink()) fail('Symlink asset directory');
    fs.mkdirSync(base, { recursive: true });
    const target = path.join(base, aid + ext);
    try {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      const bytes = fs.readFileSync(target);
      if (bytes.length !== st.size || bytes.length > MAX_ASSET) fail('Asset changed during copy');
      const asset = normalAsset({ id: aid, relPath, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, mime: MIME[ext], sourceName: path.basename(source) }, pid);
      const p = normalProject({ ...old, assets: [...old.assets, asset], revision: old.revision + 1, updatedAt: new Date().toISOString() });
      d.projects[d.projects.indexOf(old)] = p; this._save(d); return structuredClone(asset);
    } catch (e) { try { fs.unlinkSync(target); } catch {} throw e; }
  }
  resolveAsset(pid, aid) {
    const p = this._find(this._read(), pid); id(aid, ASSET_ID, 'asset id');
    const a = p.assets.find(x => x.id === aid); if (!a) fail('Unknown asset');
    const target = path.resolve(this.dir, ...a.relPath.split('/'));
    if (!target.startsWith(path.resolve(this.assetsDir, pid) + path.sep)) fail('Invalid asset path');
    for (let cur = target; cur !== this.dir && cur !== path.dirname(cur); cur = path.dirname(cur)) {
      if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink()) fail('Symlink asset path');
    }
    if (!fs.statSync(target).isFile()) fail('Invalid asset file');
    return target;
  }
  markShot(pid, shotId, patch, expectedRevision) {
    obj(patch, 'shot patch'); keys(patch, ['seconds', 'prompt', 'castIds', 'assetIds', 'narration', 'dialogue', 'status', 'taskId', 'outputPath'], 'shot patch');
    id(shotId, /^shot_[a-z0-9_\-]{1,59}$/, 'shot id');
    const d = this._read(); const old = this._find(d, pid);
    if (old.revision !== expectedRevision) fail('Revision conflict');
    let matched = false;
    const scenes = old.scenes.map(scene => ({ ...scene, shots: scene.shots.map(shot => {
      if (shot.id !== shotId) return shot;
      matched = true; return normalShot({ ...shot, ...patch });
    }) }));
    if (!matched) fail('Unknown shot');
    const p = normalProject({ ...old, scenes, revision: old.revision + 1, updatedAt: new Date().toISOString() });
    d.projects[d.projects.indexOf(old)] = p; this._save(d); return structuredClone(p);
  }
  restoreBackup() {
    if (!fs.existsSync(this.backup)) fail('No backup');
    const restored = parse(fs.readFileSync(this.backup, 'utf8'));
    // Explicit recovery only; do not copy damaged primary onto the valid backup.
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(restored), { flag: 'wx' }); fs.renameSync(tmp, this.file); }
    finally { try { fs.unlinkSync(tmp); } catch {} }
    return this.list();
  }
}
module.exports = { FilmProjectStore };
