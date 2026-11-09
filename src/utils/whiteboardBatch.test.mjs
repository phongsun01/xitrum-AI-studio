import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('./whiteboardBatch.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {nextAnnotationPath, selectedBatchImage}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const image=(path,error)=>({path,width:100,height:100,error});
test('arbitrary names and existing versions never select an occupied output',async()=>{
  for(const [input,occupied,expected] of [
    ['/tmp/custom.json',['/tmp/custom.json','/tmp/custom.v2.annotation.json'],'/tmp/custom.v3.annotation.json'],
    ['C:\\data\\custom.json',['C:\\data\\custom.json'],'C:\\data\\custom.v2.annotation.json'],
    ['/tmp/scene.v2.annotation.json',['/tmp/scene.v2.annotation.json','/tmp/scene.v3.annotation.json'],'/tmp/scene.v4.annotation.json'],
    ['/tmp/scene.annotation.json',[],'/tmp/scene.annotation.json'],
    ['/tmp/custom',['/tmp/custom'],'/tmp/custom.v2.annotation.json'],
  ]) assert.equal(await nextAnnotationPath(input,async p=>occupied.includes(p)),expected);
});
test('file inspection errors do not authorize an overwrite',async()=>{
  await assert.rejects(nextAnnotationPath('old.json',async()=>{throw new Error('access denied');}),/access denied/);
});
test('duplicate requires explicit valid choice; broken and missing rows stay unselectable',()=>{
  const good=image('1.png');const broken=image('01.png','bad image');
  const row={status:'duplicate',candidateImages:[good,broken],matchedImage:undefined};
  assert.equal(selectedBatchImage(row),undefined);
  assert.equal(selectedBatchImage(row,'wrong.png'),undefined);
  assert.equal(selectedBatchImage(row,broken.path),undefined);
  assert.equal(selectedBatchImage(row,good.path),good);
  assert.equal(selectedBatchImage({...row,status:'error',matchedImage:broken},broken.path),undefined);
  assert.equal(selectedBatchImage({...row,status:'missing'}),undefined);
  assert.equal(selectedBatchImage({status:'ready',matchedImage:good}),good);
});
