import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('./whiteboardTiming.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {applyAlignedTiming, appendSilentEndingScene, speechScenesForTts, splitFinalCue} = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
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

test('silent last illustration survives TTS alignment without a generated voice',()=>{
 const original=scenes.map(s=>({...s,audioPath:undefined}));
 const extended=appendSilentEndingScene(original,'silent-final');
 const before=JSON.stringify(extended);
 assert.equal(extended.at(-1).timelineStartMs,140000);
 assert.equal(speechScenesForTts(extended).length,4);
 const next=applyAlignedTiming(extended,result);
 assert.equal(next.length,5);
 assert.equal(next.at(-1).id,'silent-final');
 assert.equal(next.at(-1).timelineStartMs,92000);
 assert.equal(next.at(-1).timelineEndMs,95000);
 assert.equal(next.at(-1).durationMs,3000);
 assert.equal(next.at(-1).cues.length,0);
 assert.equal(next.at(-1).speechEndMs,undefined);
 assert.equal(next.at(-1).audioPath,undefined);
 assert.equal(JSON.stringify(extended),before);
 assert.throws(()=>speechScenesForTts([extended.at(-1),...original]));
});

test('short punchline gets its own image without extending the spoken timeline',()=>{
 const scene={...scenes[0],audioPath:undefined,timelineStartMs:0,timelineEndMs:5500,durationMs:5500,
  cues:[{index:1,startMs:0,endMs:5000,text:'setup'},{index:2,startMs:5000,endMs:5500,text:'punchline'}]};
 const source=[scene];const before=JSON.stringify(source);
 const next=splitFinalCue(source,'punchline');
 assert.deepEqual(next.map(s=>s.durationMs),[5000,500]);
 assert.equal(next[0].timelineEndMs,next[1].timelineStartMs);
 assert.equal(next[0].imagePath,scene.imagePath);
 assert.equal(next[0].annotationPath,'');
 assert.equal(next[1].imagePath,'');
 assert.equal(next[1].annotationPath,'');
 assert.deepEqual(next.flatMap(s=>s.cues).map(c=>c.text),['setup','punchline']);
 assert.equal(next[1].timelineEndMs,5500);
 assert.equal(JSON.stringify(source),before);
 const withTail=splitFinalCue(appendSilentEndingScene(source,'silent'),'punchline');
 assert.equal(withTail.at(-1).timelineStartMs,5500);
 assert.deepEqual(withTail.map(s=>s.order),[1,2,3]);
 assert.throws(()=>splitFinalCue([{...scene,audioPath:'whole-scene.wav'}],'punchline'));
});
