// Run explicitly: node --test src/utils/whiteboardWbImport.ui.test.mjs
// Uses an isolated Chrome profile and mocked Tauri IPC; no real project is modified.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';
const chrome = process.env.WB_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const html = `<!doctype html><html><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;
window.__vite_plugin_react_preamble_installed__=true;
const R=await import('/node_modules/.vite/deps/react.js');const React=R.default||R;
const D=await import('/node_modules/.vite/deps/react-dom_client.js');const createRoot=D.createRoot||D.default.createRoot;
const {WhiteboardEditor}=await import('/src/components/WhiteboardEditor.tsx');
createRoot(document.getElementById('root')).render(React.createElement(WhiteboardEditor));
</script></html>`;

test('import preview protects existing scenes, rejects changed files and applies complete project state',
 {skip:!fs.existsSync(chrome),timeout:60000}, async()=>{
  const server=await createServer({server:{port:0,strictPort:false,host:'127.0.0.1'},clearScreen:false});
  let browser;
  try {
    await server.listen();
    const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
    browser=await chromium.launch({executablePath:chrome,headless:true});
    const page=await browser.newPage();
    page.setDefaultTimeout(8000);
    page.on("pageerror",err=>console.error("Browser error:",err.message));
    await page.addInitScript(()=>{
      window.saved=[];window.inspectCalls=0;window.changed=false;
      const oldScene={id:'old-scene',order:1,revision:1,imagePath:'',annotationPath:'',timelineStartMs:0,timelineEndMs:1000,durationMs:1000,cues:[{id:'old-cue',index:1,text:'Cũ',startMs:0,endMs:1000,durMs:1000}],status:'idle'};
      window.__TAURI_INTERNALS__={transformCallback:()=>1,unregisterCallback:()=>{},convertFileSrc:p=>p,
        invoke:async(cmd,args)=>{
          if(cmd==='plugin:dialog|open') return args.options.filters[0].name.includes('Project')?'/tmp/old.whiteboard.json':'/tmp/story.v2.srt';
          if(cmd==='plugin:dialog|save') return '/tmp/review.whiteboard.json';
          if(cmd==='load_whiteboard_project' && window.reopenSaved) return structuredClone(window.saved.at(-1));
          if(cmd==='load_whiteboard_project') return {id:'old-project',schemaVersion:1,revision:10,title:'Old',fps:30,paperColor:'#fff',scenes:[oldScene],sourceSrtPath:'/tmp/old.srt',masterAudioPath:'/tmp/old.wav',outputVideoPath:'/tmp/old.mp4',speechConfig:{mode:'single',defaultVoiceId:'Thái Sơn',timingMode:'fixed',speakers:[],audioFingerprint:'old-fingerprint'}};
          if(cmd==='inspect_whiteboard_wb_import'){
            window.inspectCalls++;
            if(window.singleImport) return {valid:true,wbJsonPath:'/tmp/story.v2.wb.json',bundleFingerprint:'single-preview',schemaVersion:2,srtSha256Matches:true,title:'Một giọng',scenesCount:3,cuesCount:3,speakersCount:0,durationMs:3000,speechMode:'single',errors:[],warnings:[],speakers:[],scenes:[1,2,3].map(i=>({...oldScene,id:`single-${i}`,order:i,timelineStartMs:(i-1)*1000,timelineEndMs:i*1000,cues:[{id:`single-cue-${i}`,index:i,startMs:(i-1)*1000,endMs:i*1000,durMs:1000,text:`Lời kể ${i}`,spokenText:`Lời kể ${i}`,speakerId:null}]}))};
            return {valid:true,wbJsonPath:'/tmp/story.v2.wb.json',bundleFingerprint:window.changed?'changed':'preview',schemaVersion:3,srtSha256Matches:true,title:'New',scenesCount:1,cuesCount:3,speakersCount:2,durationMs:3000,speechMode:'characters',errors:[],warnings:[],speakers:[{id:'t',name:'Thầy',voiceId:'Hải Đăng'},{id:'s',name:'Trò',voiceId:''}],scenes:[{...oldScene,id:'new-scene',timelineEndMs:3000,durationMs:3000,cues:[1,2,3].map(i=>({id:`cue-${i}`,index:i,startMs:(i-1)*1000,endMs:i*1000,durMs:1000,text:`Lời ${i}`,spokenText:`Lời ${i}`,speakerId:i===1?null:i===2?'t':'s'}))}]};
          }
          if(cmd==='save_whiteboard_project'){window.saved.push(args.project);return {success:true};}
          if(cmd==='list_tts_voices')return [{id:'Thái Sơn',name:'Thái Sơn'},{id:'Hải Đăng',name:'Hải Đăng'}];
          if(cmd==='check_whiteboard_env')return {ok:true,missing:[]};
          if(cmd==='check_file_exists')return false;
          if(cmd==='plugin:event|listen')return 1;
          return null;
        }};
    });
    await page.route('**/wb-import-review',route=>route.fulfill({contentType:'text/html',body:html}));
    await page.goto(origin+'/wb-import-review');
    await page.getByRole('button',{name:'Mở Dự Án',exact:true}).click();
    await page.locator('input[placeholder="Chọn .srt..."]').locator('..').getByRole('button',{name:'Chọn',exact:true}).click();
    const apply=page.getByRole('button',{name:'Nhập theo phân cảnh từ WB (Khuyên dùng)',exact:true});
    await apply.waitFor();
    assert.equal(await apply.isDisabled(),true);
    // Cancel must leave the SRT, voices, media, and revision of the old project intact.
    await page.getByRole('button',{name:'Hủy nhập',exact:true}).click();
    await page.getByRole('button',{name:'Lưu Dự Án',exact:true}).click();
    let saved=await page.evaluate(()=>window.saved.at(-1));
    assert.equal(saved.sourceSrtPath,'/tmp/old.srt');assert.equal(saved.scenes[0].id,'old-scene');
    assert.equal(saved.masterAudioPath,'/tmp/old.wav');assert.equal(saved.outputVideoPath,'/tmp/old.mp4');
    await page.locator('input[placeholder="Chọn .srt..."]').locator('..').getByRole('button',{name:'Chọn',exact:true}).click();await apply.waitFor();
    await page.getByRole('checkbox',{name:/Tôi đồng ý thay toàn bộ cảnh/}).check();
    await page.evaluate(()=>window.changed=true);
    await apply.click();
    await page.getByText(/Bộ SRT\/metadata đã thay đổi/).waitFor();
    await page.getByRole('button',{name:'Hủy nhập',exact:true}).click();
    await page.evaluate(()=>window.changed=false);
    await page.locator('input[placeholder="Chọn .srt..."]').locator('..').getByRole('button',{name:'Chọn',exact:true}).click();await apply.waitFor();
    await page.getByRole('checkbox',{name:/Tôi đồng ý thay toàn bộ cảnh/}).check();
    await apply.click();
    await page.getByText(/Đã nhập kịch bản Whiteboard thành công/).waitFor();
    await page.getByRole('button',{name:'Lưu Dự Án',exact:true}).click();
    saved=await page.evaluate(()=>window.saved.at(-1));
    assert.equal(saved.scenes.length,1);assert.equal(saved.scenes[0].cues.length,3);
    assert.equal(saved.speechConfig.defaultVoiceId,'Thái Sơn');
    assert.equal(saved.speechConfig.timingMode,'fixed');
    assert.deepEqual(saved.speechConfig.speakers.map(s=>s.voiceId),['Hải Đăng','Thái Sơn']);
    assert.equal(saved.revision,13); // old=10, save after cancel=11, import=12, save=13
    assert.equal(saved.masterAudioPath,undefined);assert.equal(saved.outputVideoPath,'');
    assert.equal(saved.speechConfig.audioFingerprint,undefined);
    assert.equal(await page.evaluate(()=>window.inspectCalls),5);
    // A schema 2 bundle must replace a multi-speaker project with three single-voice scenes.
    await page.evaluate(()=>window.singleImport=true);
    await page.locator('input[placeholder="Chọn .srt..."]').locator('..').getByRole('button',{name:'Chọn',exact:true}).click();
    await apply.waitFor();
    await page.getByText(/Schema 2 · 3 cảnh · Một giọng/).waitFor();
    await page.getByRole('checkbox',{name:/Tôi đồng ý thay toàn bộ cảnh/}).check();
    await apply.click();
    await page.getByText(/Đã nhập kịch bản Whiteboard thành công: 3 phân cảnh/).waitFor();
    assert.equal(await page.getByText('Phân vai giọng đọc nhân vật',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Lưu Dự Án',exact:true}).click();
    saved=await page.evaluate(()=>window.saved.at(-1));
    assert.equal(saved.scenes.length,3);assert.ok(saved.scenes.every(s=>s.cues.length===1));
    assert.equal(saved.speechConfig.mode,'single');assert.deepEqual(saved.speechConfig.speakers,[]);
    assert.equal(saved.speechConfig.defaultVoiceId,'Thái Sơn');
    await page.evaluate(()=>window.reopenSaved=true);
    await page.getByRole('button',{name:'Mở Dự Án',exact:true}).click();
    await page.getByText(/Đã mở dự án:.*\(3 cảnh\)/).waitFor();
    await page.getByRole('button',{name:'Lưu Dự Án',exact:true}).click();
    saved=await page.evaluate(()=>window.saved.at(-1));
    assert.equal(saved.scenes.length,3);assert.equal(saved.speechConfig.mode,'single');
    assert.equal(saved.speechConfig.defaultVoiceId,'Thái Sơn');
  } finally {await browser?.close();await server.close();}
});
