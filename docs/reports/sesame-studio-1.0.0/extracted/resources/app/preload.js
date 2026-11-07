const { contextBridge, ipcRenderer } = require('electron');

const on = (ch, cb) => {
  const h = (_e, d) => cb(d);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

const api = {
  // --- Core Events ---
  onStatusUpdate: (cb) => on('status-update', cb),
  onAccountsUpdate: (cb) => on('accounts-update', cb),
  onVideoCompleted: (cb) => on('video-completed', cb),
  onCrmJobReceived: (cb) => on('crm-job-received', cb),
  onTaskUpdate: (cb) => on('task-update', cb),
  onMergeProgress: (cb) => on('merge-progress', cb),
  onStudioUpdate: (cb) => on('studio-update', cb),
  onComposeProgress: (cb) => on('compose-progress', cb),
  onProgress: (cb) => on('sesame:progress', cb),

  // --- Accounts & Proxies ---
  openMuseLogin: () => ipcRenderer.invoke('open-muse-login'),
  logoutMuse: () => ipcRenderer.invoke('logout-muse'),
  checkMuseStatus: () => ipcRenderer.invoke('check-muse-status'),
  listAccounts: () => ipcRenderer.invoke('accounts-list'),
  addAccount: (name, provider) => ipcRenderer.invoke('account-add', name, provider),
  updateAccount: (id, patch) => ipcRenderer.invoke('account-update', id, patch),
  removeAccount: (id) => ipcRenderer.invoke('account-remove', id),
  loginAccount: (id) => ipcRenderer.invoke('account-login', id),
  showAccount: (id) => ipcRenderer.invoke('account-show', id),
  logoutAccount: (id) => ipcRenderer.invoke('account-logout', id),
  saveAccountSettings: (patch) => ipcRenderer.invoke('accounts-settings', patch),
  checkProxies: () => ipcRenderer.invoke('proxies-check'),
  checkAccountsQuota: (id) => ipcRenderer.invoke('accounts-check-quota', id),
  checkAccountsLogin: () => ipcRenderer.invoke('accounts-check-login'),

  // --- Studio, Tasks & Queue ---
  openOutputFolder: () => ipcRenderer.invoke('open-output-folder'),
  openMusicFolder: () => ipcRenderer.invoke('open-music-folder'),
  addMusic: (video) => ipcRenderer.invoke('add-music', video),
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  submitTask: (input) => ipcRenderer.invoke('task-submit', input),
  listTasks: () => ipcRenderer.invoke('task-list'),
  cancelTask: (id) => ipcRenderer.invoke('task-cancel', id),
  retryTask: (id) => ipcRenderer.invoke('task-retry', id),
  removeTask: (id) => ipcRenderer.invoke('task-remove', id),
  resumeTasks: () => ipcRenderer.invoke('task-resume'),
  runTasks: (ids) => ipcRenderer.invoke('task-run', ids),
  stopAllTasks: () => ipcRenderer.invoke('task-stop-all'),
  clearFinishedTasks: () => ipcRenderer.invoke('task-clear-finished'),
  revealFile: (p) => ipcRenderer.invoke('reveal-file', p),
  getApiKey: (regenerate) => ipcRenderer.invoke('get-api-key', regenerate),
  queueLoad: () => ipcRenderer.invoke('queue-load'),
  queueSave: (data) => ipcRenderer.invoke('queue-save', data),

  // --- Merge, VieNeu TTS & Scene Compose ---
  mergeVideos: (pathsOrPayload, name, opts) => {
    if (Array.isArray(pathsOrPayload)) {
      return ipcRenderer.invoke('merge-videos', pathsOrPayload, name, opts);
    }
    return ipcRenderer.invoke('sesame:merge-videos', pathsOrPayload);
  },
  vieneuVoices: () => ipcRenderer.invoke('vieneu-voices'),
  vieneuPreview: (payload) => ipcRenderer.invoke('vieneu-preview', payload),
  vieneuDubVideo: (payload) => ipcRenderer.invoke('vieneu-dub-video', payload),
  dubVideoVieneu: (payload) => ipcRenderer.invoke('vieneu-dub-video', payload),
  composeScenesVoice: (payload) => ipcRenderer.invoke('compose-scenes-voice', payload),

  // --- Assets (Characters, Bible, Projects) & Drama V5.1 ---
  getStudio: () => ipcRenderer.invoke('studio-get'),
  saveStudio: (patch) => ipcRenderer.invoke('studio-save', patch),
  addStudioImage: (src) => ipcRenderer.invoke('studio-add-image', src),
  listCharacters: () => ipcRenderer.invoke('studio-get').then(s => (s && s.characters) || []),
  verifyDrama: (spec, paths) => ipcRenderer.invoke('drama-verify', { spec, paths }),
  optimizePromptV51: (payload) => ipcRenderer.invoke('drama-optimize-v51', payload),
  scrapeAndAnalyzeLadi: (url, opts) => ipcRenderer.invoke('scrape-and-analyze-ladi', url, opts),
  addProject: (name) => ipcRenderer.invoke('project-add', name),
  updateProject: (id, patch) => ipcRenderer.invoke('project-update', id, patch),
  setProject: (id) => ipcRenderer.invoke('project-current', id),
  removeProject: (id) => ipcRenderer.invoke('project-remove', id),

  // --- Film Project v1 & Shot Board ---
  filmList: () => ipcRenderer.invoke('film-list'),
  filmGet: (id) => ipcRenderer.invoke('film-get', id),
  filmCreate: (payload) => ipcRenderer.invoke('film-create', payload),
  filmReplace: (id, changes, revision) => ipcRenderer.invoke('film-replace', id, changes, revision),
  filmMarkShot: (id, shotId, patch, revision) => ipcRenderer.invoke('film-mark-shot', id, shotId, patch, revision),
  filmImportDirector: (id, spec, revision) => ipcRenderer.invoke('film-import-director', id, spec, revision),
  filmChooseAsset: (id, characterId) => ipcRenderer.invoke('film-choose-asset', id, characterId),
  filmHoldShot: (id, shotId, revision) => ipcRenderer.invoke('film-hold-shot', id, shotId, revision),
  filmCheckDuplicate: (id, text) => ipcRenderer.invoke('film-check-duplicate', id, text),

  // --- AI Script Judge ---
  judgeScript: (specOrScenes) => ipcRenderer.invoke('script-judge', specOrScenes),
  judgeScriptPrompt: (text, genre) => ipcRenderer.invoke('script-judge-prompt', text, genre),

  // --- Facebook Reels & Settings ---
  fetchImageBase64: (url) => ipcRenderer.invoke('fetch-image-base64', url),
  getUserConfig: () => ipcRenderer.invoke('get-user-config'),
  saveUserConfig: (cfg) => ipcRenderer.invoke('save-user-config', cfg),
  fetchFbPages: (token) => ipcRenderer.invoke('fetch-fb-pages', token),
  verifyFbToken: (payload) => ipcRenderer.invoke('verify-fb-token', payload),
  publishFbReels: (payload) => ipcRenderer.invoke('publish-fb-reels', payload),
  selectVideoFile: () => ipcRenderer.invoke('select-video-file'),
  selectImageFile: (multi) => ipcRenderer.invoke('select-image-file', multi),
  getLibraryVideos: () => ipcRenderer.invoke('get-library-videos'),
  listLibrary: () => ipcRenderer.invoke('list-library'),
  trashFiles: (paths) => ipcRenderer.invoke('trash-files', paths),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // --- Flow Builder ---
  flowGenerateProject: (input) => ipcRenderer.invoke('flow-generate-project', input),
  flowBuildScenePrompt: (scene, entities, opts) => ipcRenderer.invoke('flow-build-scene-prompt', { scene, entities, opts }),
  flowChatGptHelper: (input) => ipcRenderer.invoke('flow-chatgpt-helper', input),
  flowParseExternal: (payload) => ipcRenderer.invoke('flow-parse-external', payload),
  flowExtractEndFrame: (videoPath) => ipcRenderer.invoke('flow-extract-end-frame', videoPath),
  flowStateLoad: () => ipcRenderer.invoke('flow-state-load'),
  flowStateSave: (data) => ipcRenderer.invoke('flow-state-save', data),

  // --- Toolkit ---
  pickFile: (opts) => ipcRenderer.invoke('sesame:pick-file', opts),
  pickFiles: (opts) => ipcRenderer.invoke('sesame:pick-files', opts),
  pickFolder: () => ipcRenderer.invoke('sesame:pick-folder'),
  openPath: (targetPath) => ipcRenderer.invoke('sesame:open-path', targetPath),
  getDefaultOutputDir: () => ipcRenderer.invoke('sesame:get-output-dir'),
  pathsExist: (paths) => ipcRenderer.invoke('sesame:paths-exist', paths),
  checkEnvironment: () => ipcRenderer.invoke('sesame:env-check'),
  listOutputs: (dirPath) => ipcRenderer.invoke('sesame:list-outputs', dirPath),
  deleteFile: (filePath) => ipcRenderer.invoke('sesame:delete-file', filePath),

  analyzeEduVideo: (videoPath) => ipcRenderer.invoke('sesame:edu-analyze', videoPath),
  translateLines: (lines, targetLang) => ipcRenderer.invoke('sesame:edu-translate', { lines, targetLang }),
  renderEduVideo: (payload) => ipcRenderer.invoke('sesame:edu-render', payload),

  parseNovelScript: (payload) => ipcRenderer.invoke('sesame:story-parse', payload),
  renderStoryVideo: (payload) => ipcRenderer.invoke('sesame:story-render', payload),
  renderInstantWithCleanTemplate: (payload) => ipcRenderer.invoke('sesame:render-instant-clean', payload),
  listCleanTemplates: () => ipcRenderer.invoke('sesame:list-clean-templates'),
  generateAiScenes: (payload) => ipcRenderer.invoke('sesame:story-to-sesame', payload),

  downloadViralVideo: (payload) => ipcRenderer.invoke('sesame:viral-download', payload),
  renderViralRemix: (payload) => ipcRenderer.invoke('sesame:viral-render', payload),
  listAiScenes: () => ipcRenderer.invoke('sesame:list-ai-scenes'),

  toolkitTranslateSrt: (payload) => ipcRenderer.invoke('sesame:toolkit-translate-srt', payload),
  toolkitDubTrack: (payload) => ipcRenderer.invoke('sesame:toolkit-dub-track', payload),
  toolkitGetVoices: () => ipcRenderer.invoke('sesame:toolkit-get-voices'),
  toolkitProbeVideo: (videoPath) => ipcRenderer.invoke('sesame:toolkit-probe-video', videoPath),
  toolkitDetectScenes: (payload) => ipcRenderer.invoke('sesame:toolkit-detect-scenes', payload),
  toolkitPlanSegments: (payload) => ipcRenderer.invoke('sesame:toolkit-plan-segments', payload),
  toolkitCutExport: (payload) => ipcRenderer.invoke('sesame:toolkit-cut-export', payload),
  toolkitMergeCuts: (payload) => ipcRenderer.invoke('sesame:toolkit-merge-cuts', payload),
  editList: () => ipcRenderer.invoke('sesame:edit-list'),
  editNew: (name) => ipcRenderer.invoke('sesame:edit-new', name),
  editLoad: (id) => ipcRenderer.invoke('sesame:edit-load', id),
  editSave: (project) => ipcRenderer.invoke('sesame:edit-save', project),
  editDelete: (id) => ipcRenderer.invoke('sesame:edit-delete', id),
  editProbe: (files) => ipcRenderer.invoke('sesame:edit-probe', files),
  editWave: (payload) => ipcRenderer.invoke('sesame:edit-wave', payload),
  psyncBuild: (project) => ipcRenderer.invoke('sesame:psync-build', project),
  psyncParse: (payload) => ipcRenderer.invoke('sesame:psync-parse', payload),
  saveText: (payload) => ipcRenderer.invoke('sesame:save-text', payload),
  editExport: (payload) => ipcRenderer.invoke('sesame:edit-export', payload),
  editPreview: (payload) => ipcRenderer.invoke('sesame:edit-preview', payload),
  onEditExportProgress: (cb) => on('sesame:progress', (d) => { if (d && d.channel === 'edit-export') cb(d); }),
  toolkitTrimVideo: (payload) => ipcRenderer.invoke('sesame:toolkit-trim-video', payload),
  toolkitSplitVideo: (payload) => ipcRenderer.invoke('sesame:toolkit-split-video', payload),
  toolkitExtractAudio: (videoPath) => ipcRenderer.invoke('sesame:toolkit-extract-audio', videoPath),
  toolkitTtsNormalize: (payload) => ipcRenderer.invoke('sesame:toolkit-tts-normalize', payload),
  toolkitTtsParseTimed: (payload) => ipcRenderer.invoke('sesame:toolkit-tts-parse-timed', payload),
  toolkitTtsReadTxt: (filePath) => ipcRenderer.invoke('sesame:toolkit-tts-read-txt', filePath),
  toolkitTtsGenerate: (payload) => ipcRenderer.invoke('sesame:toolkit-tts-generate', payload),
  toolkitTtsCatalog: () => ipcRenderer.invoke('sesame:tts-catalog'),
  toolkitTtsPreview: (payload) => ipcRenderer.invoke('sesame:tts-preview', payload),

  fbGetConfig: () => ipcRenderer.invoke('get-user-config'),
  fbSaveConfig: (cfg) => ipcRenderer.invoke('save-user-config', cfg),
  fbFetchPages: (token) => ipcRenderer.invoke('fetch-fb-pages', token),
  fbVerifyToken: (payload) => ipcRenderer.invoke('verify-fb-token', payload),
  fbPublishReel: (payload) => ipcRenderer.invoke('publish-fb-reels', payload),

  feat: (name, payload) => ipcRenderer.invoke('feat:' + name, payload),
  zoom: (action) => ipcRenderer.invoke('sesame:zoom', action),
  onZoomChanged: (cb) => on('sesame:zoom-changed', cb)
};

contextBridge.exposeInMainWorld('sesame', api);
contextBridge.exposeInMainWorld('electronAPI', api);
