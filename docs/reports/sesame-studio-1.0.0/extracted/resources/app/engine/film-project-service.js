/**
 * Film Project v1 boundary: turns validated Director specs into persisted shots and HELD tasks.
 * Dependency injected for no-credit tests. Never accepts a renderer-supplied file path;
 * the Electron main process obtains sourcePath through its own native file picker.
 */
const DramaCompiler = require('./drama-compiler');
const fs = require('fs');
const crypto = require('crypto');

const MODES = new Set(['film', 'story', 'hiu', 'affiliate']);
const fail = message => { throw new Error(message); };
const clean = v => String(v == null ? '' : v).trim();
const idOk = v => typeof v === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(v);

class FilmProjectService {
  constructor({ store, studioStore, taskStore, submitTask, compiler = DramaCompiler }) {
    if (!store || !taskStore || typeof submitTask !== 'function') throw new Error('FilmProjectService dependencies missing');
    this.store = store; this.studioStore = studioStore; this.taskStore = taskStore; this.submitTask = submitTask; this.compiler = compiler;
  }
  list() { return this.store.list().map(p => ({ id:p.id, name:p.name, mode:p.mode, revision:p.revision, sceneCount:p.scenes.length, archived:p.archived === true })); }
  get(id) {
    const p = this.store.get(id);
    return { ...p, assets: p.assets.map(a => {
      try { return { ...a, path: this.store.resolveAsset(id, a.id), missing: false }; }
      catch (_) { return { ...a, path: '', missing: true }; }
    }) };
  }
  hasProject(id) { return this.store.hasProject(id); }
  create(data) {
    if (!MODES.has(data?.mode)) fail('Mode dự án không hợp lệ');
    return this.get(this.store.create(data).id);
  }
  replace(id, changes, revision) {
    const old = this.store.get(id);
    if (old.scenes.some(scene => scene.shots.some(shot => shot.taskId))) fail('Dự án đã có task; không thay toàn bộ shot. Tạo một dự án mới để giữ liên kết task cũ.');
    const scenes = (changes?.scenes || []).map(scene => ({ ...scene, shots: (scene.shots || []).map(shot => ({ ...shot, status:'draft', taskId:undefined, outputPath:undefined })) }));
    return this.get(this.store.replace(id, { ...changes, scenes }, revision).id);
  }
  importDirector(id, spec, revision) {
    const project = this.store.get(id);
    if (project.revision !== revision) fail('Dự án đã đổi ở cửa sổ khác. Bấm Làm mới rồi nạp lại.');
    if (!['film', 'story'].includes(project.mode)) fail('Spec Đạo diễn phim chỉ dùng cho Phim AI/Reel truyện trong lát đầu. HIU/Affiliate chưa nối pipeline.');
    if (project.scenes.some(scene => scene.shots.some(shot => shot.taskId))) fail('Dự án đã có task; không thay toàn bộ shot. Tạo dự án mới để giữ lịch sử.');
    const compiled = this.compiler.compile(spec, { library: [] });
    if (!compiled.ok || !compiled.shots.length) fail('Spec Đạo diễn chưa hợp lệ: ' + (compiled.errors?.[0]?.msg || 'không có shot'));
    if (spec.characters.some(c => !idOk(c.id))) fail('ID nhân vật phải là chữ thường ASCII, VD: nam, nu, hero_1.');
    const characters = spec.characters.map(c => ({ id:c.id, name:c.name, look:c.look || '', assetIds:[] }));
    const scenes = spec.shots.map((sh, i) => ({
      id:`scene_${i+1}`, title:`Cảnh ${i+1}`,
      shots:[{
        id:`shot_${i+1}`, seconds:Number(sh.seconds), prompt:compiled.shots[i].prompt,
        castIds:sh.cast || [], assetIds:[], narration:compiled.shots[i].narration || '',
        status:'draft'
      }]
    }));
    const sourceText = clean(spec.sourceText || spec.storyText || '');
    return this.get(this.store.replace(id, { characters, scenes, sourceText }, revision).id);
  }
  updateShot(id, shotId, patch, revision) {
    const project = this.store.get(id);
    if (project.revision !== revision) fail('Dự án đã đổi. Bấm Làm mới rồi sửa lại.');
    const shot = project.scenes.flatMap(s => s.shots).find(s => s.id === shotId);
    if (!shot) fail('Không tìm thấy shot.');
    if (shot.taskId || ['held','running','done'].includes(shot.status)) fail('Shot đã có task, không được sửa bản snapshot. Tạo dự án/shot mới hoặc xử lý task cũ trước.');
    const contentKeys = ['prompt','narration','castIds','assetIds','seconds'];
    const editing = contentKeys.some(k => Object.prototype.hasOwnProperty.call(patch || {}, k));
    if (editing && patch.status !== 'draft') fail('Sửa nội dung phải đưa shot về nháp để duyệt lại.');
    if (!editing && patch?.status !== 'approved') fail('Chỉ được chuyển nháp → đã duyệt ở bước này.');
    if (!editing && !clean(shot.prompt)) fail('Prompt shot trống.');
    const allowed = editing ? Object.fromEntries(contentKeys.filter(k => k in patch).map(k => [k, patch[k]])) : {};
    allowed.status = editing ? 'draft' : 'approved';
    return this.get(this.store.markShot(id, shotId, allowed, revision).id);
  }
  attachAsset(id, characterId, sourcePath) {
    const p = this.store.get(id);
    const c = p.characters.find(x => x.id === characterId);
    if (!c) fail('Nhân vật không tồn tại trong dự án.');
    if ((c.assetIds || []).length >= 3) fail('Tối đa 3 ảnh tham chiếu cho mỗi nhân vật trong lát đầu.');
    const a = this.store.importAsset(id, sourcePath); // Copies into project-owned folder; never deletes original.
    const latest = this.store.get(id);
    const characters = latest.characters.map(x => x.id === characterId ? { ...x, assetIds:[...x.assetIds,a.id] } : x);
    return this.get(this.store.replace(id, { characters }, latest.revision).id);
  }
  holdShot(id, shotId, revision) {
    const p = this.store.get(id);
    if (p.revision !== revision) fail('Dự án đã đổi. Bấm Làm mới trước khi đưa shot vào chờ.');
    if (!['film','story'].includes(p.mode)) fail('HIU/Affiliate chưa nối queue trong lát đầu.');
    const scene = p.scenes.find(s => s.shots.some(x => x.id === shotId));
    const shot = scene?.shots.find(x => x.id === shotId);
    if (!shot) fail('Không tìm thấy shot.');
    if (shot.status !== 'approved' || shot.taskId) fail('Chỉ shot đã duyệt và chưa có task mới được đưa vào chờ.');
    if (!clean(shot.prompt)) fail('Prompt shot trống.');
    const assetIds = [...new Set([...(shot.assetIds || []), ...(shot.castIds || []).flatMap(cid => p.characters.find(c => c.id === cid)?.assetIds || [])])];
    for (const cid of shot.castIds || []) {
      const c = p.characters.find(x => x.id === cid);
      if (!c || !(c.assetIds || []).length) fail(`Nhân vật “${c?.name || cid}” chưa có ảnh tham chiếu trong dự án. Chọn ảnh trước khi duyệt.`);
    }
    // Validate the copied project-owned ref still matches its recorded bytes/hash before queueing.
    const images = assetIds.map(aid => {
      const asset = p.assets.find(a => a.id === aid);
      const assetPath = this.store.resolveAsset(id, aid);
      const bytes = fs.readFileSync(assetPath);
      if (!asset || bytes.length !== asset.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
        fail(`Ảnh tham chiếu “${asset?.sourceName || aid}” đã bị thay đổi sau khi nhập; chọn lại ảnh trước khi đưa vào chờ.`);
      }
      return { imageLocalPath: assetPath };
    });
    const input = { project:id, held:true, source:'ui', kind:'video', engine:'auto', ratio:'9:16',
      prompt:shot.prompt, label:`${p.name} · ${scene.title || shot.id}`, images, timeoutMin:30 };
    const task = this.submitTask(input);
    if (!task?.id || task.held !== true || task.status !== 'queued' || task.project !== id) {
      if (task?.id) this.taskStore.remove(task.id);
      fail('Task không ở trạng thái chờ an toàn. Đã rollback, không gửi Muse.');
    }
    try {
      const saved = this.store.markShot(id,shotId,{status:'held',taskId:task.id},revision);
      return { project:this.get(saved.id), task };
    } catch(e) { this.taskStore.remove(task.id); throw e; }
  }
  checkDuplicate(id, text) {
    return this.store.checkDuplicateIdea(id, text);
  }
}
module.exports = { FilmProjectService };
