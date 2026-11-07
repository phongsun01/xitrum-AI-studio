import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('./whiteboardTiming.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {applyAlignedTiming} = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const scenes=[0,1,2,3].map(i=>({id:`s${i}`,order:i+1,revision:2,imagePath:`${i}.png`,annotationPath:`${i}.json`,
 timelineStartMs:i*35000,timelineEndMs:(i+1)*35000,durationMs:35000,cues:[{index:i+1,text:'test'}],status:'done',outputPath:'old.mp4',audioPath:'old.wav'}));
const result={aligned_srt_path:'aligned.srt',cues:scenes.map((s,i)=>({...s.cues[0],startMs:i*23000,endMs:(i+1)*23000})),
 scenes:scenes.map((s,i)=>({sceneIndex:i+1,cueRange:[i+1,i+1],timelineStartMs:i*23000,timelineEndMs:(i+1)*23000,sceneDurationMs:23000,speechEndMs:22000}))};
test('retains four images and IDs, resets stale render state, updates contiguous windows',()=>{
 const before=JSON.stringify(scenes);const next=applyAlignedTiming(scenes,result);
 assert.equal(next.length,4);assert.deepEqual(next.map(s=>s.id),scenes.map(s=>s.id));
 assert.deepEqual(next.map(s=>s.imagePath),scenes.map(s=>s.imagePath));
 assert.equal(next[3].timelineEndMs,92000);assert.ok(next.every(s=>s.revision===3 && s.status==='idle' && !s.outputPath && !s.audioPath));
 assert.equal(JSON.stringify(scenes),before);
});
test('rejects different grouping or broken timeline without modifying source scenes',()=>{
 const before=JSON.stringify(scenes);
 assert.throws(()=>applyAlignedTiming(scenes,{...result,scenes:result.scenes.slice(1)}));
 assert.throws(()=>applyAlignedTiming(scenes,{...result,scenes:result.scenes.map((s,i)=>i===1?{...s,timelineStartMs:0}:s)}));
 assert.equal(JSON.stringify(scenes),before);
});
