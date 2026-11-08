import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('./whiteboardWbAdapter.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {buildProjectFromWbImport, revalidateWbImport, describeWbImportErrors} = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const preview = { valid:true, wbJsonPath:'/tmp/story.v2.wb.json', bundleFingerprint:'bundle-v1',
  title:'Bài học', speechMode:'characters', speakers:[{id:'t',name:'Thầy',voiceId:'Hải Đăng'}, {id:'s',name:'Trò',voiceId:''}],
  errors:[], scenes:[{id:'s1', cues:[{id:'c1'},{id:'c2'},{id:'c3'}], outputPath:'stale.mp4', audioPath:'stale.wav'}] };
const base = {id:'project',revision:5,speechConfig:{defaultVoiceId:'Thái Sơn',timingMode:'fixed'},masterAudioPath:'old.wav',outputVideoPath:'old.mp4'};
test('keeps three cues in one scene, preserves narrator/timing and assigns only unselected voices',()=>{
  const before=JSON.stringify([preview,base]);
  const result=buildProjectFromWbImport(preview,'story.v2.srt',base);
  assert.equal(result.scenes.length,1); assert.equal(result.scenes[0].cues.length,3);
  assert.equal(result.speechConfig.defaultVoiceId,'Thái Sơn');
  assert.equal(result.speechConfig.timingMode,'fixed');
  assert.deepEqual(result.speechConfig.speakers.map(s=>s.voiceId),['Hải Đăng','Thái Sơn']);
  assert.equal(result.revision,6);
  assert.equal(result.masterAudioPath,undefined);assert.equal(result.outputVideoPath,undefined);
  assert.equal(result.scenes[0].outputPath,undefined); assert.equal(result.scenes[0].audioPath,undefined);
  assert.equal(JSON.stringify([preview,base]),before);
});
test('new project narrator uses app default, not the first character voice',()=>{
  assert.equal(buildProjectFromWbImport(preview,'story.srt').speechConfig.defaultVoiceId,'Thùy Dung');
});
test('schema 2 imports as three single voice scenes without a character voice table',()=>{
  const single={...preview,schemaVersion:2,speechMode:'single',speakers:[],scenes:[1,2,3].map(i=>({id:`s${i}`,cues:[{id:`c${i}`,speakerId:null}]}))};
  const result=buildProjectFromWbImport(single,'story.srt',base);
  assert.equal(result.scenes.length,3);
  assert.equal(result.speechConfig.mode,'single');
  assert.equal(result.speechConfig.defaultVoiceId,'Thái Sơn');
  assert.deepEqual(result.speechConfig.speakers,[]);
  assert.ok(result.scenes.every(s=>s.cues.length===1));
});
test('unsupported schemas, malformed metadata and SRT mismatch have distinct explanations',()=>{
  const unsupported=describeWbImportErrors(['WB_SCHEMA_MISMATCH: version 9']);
  const malformed=describeWbImportErrors(['WB_INVALID_METADATA: scenes is null']);
  const mismatch=describeWbImportErrors(['WB_SRT_HASH_MISMATCH: changed']);
  assert.match(unsupported.title,/chưa được hỗ trợ/);
  assert.match(malformed.title,/Cấu trúc/);
  assert.match(mismatch.title,/không khớp/);
  assert.notEqual(unsupported.description,malformed.description);
  assert.notEqual(malformed.description,mismatch.description);
});
test('invalid bundle cannot replace a project',()=>{
  assert.throws(()=>buildProjectFromWbImport({...preview,valid:false},'story.srt',base));
});
test('apply re-reads the selected metadata and returns a matching fresh snapshot',async()=>{
  const fresh=structuredClone(preview);
  assert.equal(await revalidateWbImport(preview,'story.srt',async(s,j)=>{
    assert.equal(s,'story.srt');assert.equal(j,preview.wbJsonPath);return fresh;
  }),fresh);
});
test('apply rejects SRT or metadata changes since preview',async()=>{
  await assert.rejects(revalidateWbImport(preview,'story.srt',async()=>({...preview,bundleFingerprint:'bundle-v2'})),/thay đổi/);
  await assert.rejects(revalidateWbImport({...preview,bundleFingerprint:undefined},'story.srt',async()=>preview),/thay đổi/);
});
test('apply rejects fresh validation and read errors without returning a project',async()=>{
  await assert.rejects(revalidateWbImport(preview,'story.srt',async()=>({...preview,valid:false,errors:['WB_SRT_HASH_MISMATCH']})),/HASH/);
  await assert.rejects(revalidateWbImport(preview,'story.srt',async()=>{throw new Error('file missing');}),/missing/);
});
