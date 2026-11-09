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

test('batch images require explicit duplicate resolution and batch annotation preserves existing files',
 {skip:!fs.existsSync(chrome),timeout:60000}, async()=>{
 const server=await createServer({server:{port:0,strictPort:false,host:'127.0.0.1'},clearScreen:false});
 let browser;
 try {
  await server.listen();
  browser=await chromium.launch({executablePath:chrome,headless:true});
  const page=await browser.newPage();page.setDefaultTimeout(8000);
  await page.addInitScript(()=>{
   window.saved=[];window.generated=[];window.scenario='empty';window.files=[];
   const image=(filename,error)=>({path:`/tmp/${filename}`,filename,width:100,height:100,fingerprint:filename,error});
   const element={id:'e',label:'Test',sequence:1,region:{x:0,y:0,width:10,height:10},reveal:{startMs:0,durationMs:500,direction:'left_to_right'}};
   window.__TAURI_INTERNALS__={transformCallback:()=>1,unregisterCallback:()=>{},convertFileSrc:p=>p,invoke:async(cmd,args)=>{
    if(cmd==='plugin:dialog|open')return args.options.directory?'/tmp/images':'/tmp/project.whiteboard.json';
    if(cmd==='load_whiteboard_project')return {id:'p',schemaVersion:1,revision:1,title:'Test',fps:30,paperColor:'#fff',scenes:[1,2,3].map(i=>({id:`s${i}`,order:i,revision:1,imagePath:window.scenario==='empty'?'':`/tmp/old-${i}.png`,annotationPath:window.scenario==='empty'?'':`/tmp/custom-${i}.json`,elements:window.scenario==='empty'?undefined:[element],timelineStartMs:(i-1)*1000,timelineEndMs:i*1000,durationMs:1000,cues:[],status:'idle'}))};
    if(cmd==='scan_whiteboard_folder_images')return {folderPath:'/tmp/images',mappings:[
     {sceneIndex:0,sceneId:'s1',status:'duplicate',candidateImages:[image('1.png'),image('01.png'),image('001.png','broken')]},
     {sceneIndex:1,sceneId:'s2',status:'error',matchedImage:image('2.png','broken'),candidateImages:[image('2.png','broken')]},
     {sceneIndex:2,sceneId:'s3',status:'ready',matchedImage:image('3.png'),candidateImages:[image('3.png')]},
    ],matchedScenesCount:1,thumbnailCandidates:[],excessImages:[],ignoredFiles:[],errors:[]};
    if(cmd==='save_whiteboard_project'){window.saved.push(args.project);return {success:true};}
    if(cmd==='generate_whiteboard_annotation'){
     if(args.overwrite || window.files.includes(args.outputPath))throw new Error('Attempt to overwrite an existing annotation');
     window.generated.push(args);window.files.push(args.outputPath);return {savedTo:args.outputPath,elements:[element]};
    }
    if(cmd==='check_file_exists')return window.files.includes(args.filePath);
    if(cmd==='list_tts_voices')return [];
    if(cmd==='check_whiteboard_env')return {ok:true,missing:[]};
    if(cmd==='plugin:event|listen')return 1;
    return null;
   }};
  });
  await page.route('**/batch-review',r=>r.fulfill({contentType:'text/html',body:html}));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/batch-review`);
  const open=()=>page.getByRole('button',{name:'Mở Dự Án',exact:true}).click();
  await open();
  await page.getByRole('button',{name:'Nạp ảnh thư mục',exact:true}).click();
  const rows=page.locator('table tbody tr');
  await rows.nth(0).waitFor();
  assert.equal(await rows.nth(0).getByRole('checkbox').isDisabled(),true);
  assert.equal(await rows.nth(1).getByRole('checkbox').isDisabled(),true);
  assert.equal(await rows.nth(0).locator('select').inputValue(),'');
  assert.equal(await rows.nth(0).locator('option[value="/tmp/001.png"]').isDisabled(),true);
  await page.locator('table thead input[type=checkbox]').uncheck();
  await page.locator('table thead input[type=checkbox]').check();
  assert.equal(await rows.nth(0).getByRole('checkbox').isChecked(),false);
  assert.equal(await rows.nth(1).getByRole('checkbox').isChecked(),false);
  await rows.nth(0).locator('select').selectOption('/tmp/01.png');
  assert.equal(await rows.nth(0).getByRole('checkbox').isChecked(),true);
  await page.getByRole('button',{name:'Áp dụng cho 2 cảnh',exact:true}).click();
  await page.getByRole('button',{name:'Lưu Dự Án',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.saved.at(-1).scenes.map(s=>s.imagePath)),['/tmp/01.png','','/tmp/3.png']);
  // Missing files are recreated, using no-overwrite for publication.
  await page.evaluate(()=>{window.scenario='missing';window.files=[];window.generated=[];});
  await open();await page.getByRole('button',{name:'Tạo mẫu tất cả',exact:true}).click();
  await page.getByRole('button',{name:'Bắt đầu tạo mẫu',exact:true}).click();
  await page.getByText(/Hoàn tất tạo mẫu hàng loạt: 3 cảnh thành công/).waitFor();
  assert.equal(await page.evaluate(()=>window.generated.length),3);
  // Existing arbitrary names plus occupied v2 versions must yield fresh v3 outputs.
  await page.evaluate(()=>{window.scenario='existing';window.generated=[];window.files=[1,2,3].flatMap(i=>[`/tmp/custom-${i}.json`,`/tmp/custom-${i}.v2.annotation.json`]);});
  await open();await page.getByRole('button',{name:'Tạo mẫu tất cả',exact:true}).click();
  await page.locator('input[name="batchAnnoMode"][value="all"]').check();
  await page.getByRole('button',{name:'Bắt đầu tạo mẫu',exact:true}).click();
  await page.getByText(/Hoàn tất tạo mẫu hàng loạt: 3 cảnh thành công/).waitFor();
  const generated=await page.evaluate(()=>window.generated);
  assert.deepEqual(generated.map(x=>x.outputPath),[1,2,3].map(i=>`/tmp/custom-${i}.v3.annotation.json`));
  assert.ok(generated.every(x=>x.overwrite===false));
 } finally {await browser?.close();await server.close();}
});
