import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadPromptRegistry, renderPrompt, promptLockSha256, savePromptCall } from '../scripts/prompt-registry.mjs';
const root=new URL('../',import.meta.url).pathname;
const sha=s=>createHash('sha256').update(s).digest('hex');
test('reviewed registry renders identically across JavaScript and Python, preserving literal user tokens',async()=>{
 const lock=await loadPromptRegistry(root), values={libraryContext:'null',intent:'literal {{worldRef}} $& ${intent}',worldRef:'world.json',parentInstruction:''};
 const js=renderPrompt(lock,'codex-create',values);
 assert.ok(js.text.includes(values.intent));
 const py=spawnSync('python3',['-B','-c','import json,sys; from tools.prompts import render; data=json.load(sys.stdin); print(json.dumps(render(data["lock"],"codex-create",data["values"])))'],{cwd:root,input:JSON.stringify({lock,values}),encoding:'utf8'});
 assert.equal(py.status,0,py.stderr);const [text,pin]=JSON.parse(py.stdout);
 assert.equal(text,js.text);assert.deepEqual(pin,js.prompt);
 assert.throws(()=>renderPrompt(lock,'codex-create',{}),/missing_prompt_variable/);
});
test('new registry revision applies to new runs; frozen run survives change and detects corruption',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'gameverse-prompts-'));
 try{
  await cp(join(root,'prompts'),join(temp,'prompts'),{recursive:true});
  const frozen=await loadPromptRegistry(temp), original=renderPrompt(frozen,'s2-reasoning');
  const registry=JSON.parse(await readFile(join(temp,'prompts/registry.json'),'utf8'));
  const pin=registry.prompts.find(p=>p.id==='s2-reasoning'), content=JSON.parse(await readFile(join(temp,pin.ref),'utf8'));
  content.version='1.0.1';content.template+=' New revision.';pin.version=content.version;pin.ref='prompts/s2-reasoning/1.0.1.json';
  const bytes=JSON.stringify(content,null,2)+'\n';pin.sha256=sha(bytes);await writeFile(join(temp,pin.ref),bytes);registry.version='1.0.1';await writeFile(join(temp,'prompts/registry.json'),JSON.stringify(registry));
  const current=await loadPromptRegistry(temp);
  assert.notEqual(renderPrompt(current,'s2-reasoning').text,original.text);
  assert.deepEqual(renderPrompt(frozen,'s2-reasoning'),original);
  assert.notEqual(promptLockSha256(current),promptLockSha256(frozen));
  const receipt=await savePromptCall(join(temp,'call.json'),original), snapshot=JSON.parse(await readFile(receipt.snapshot,'utf8'));
  assert.equal(sha(snapshot.resolved_prompt),receipt.resolved_sha256);
  frozen.prompts[0].content+=' ';assert.throws(()=>promptLockSha256(frozen),/prompt_identity_mismatch/);
  await writeFile(join(temp,pin.ref),bytes+' ');await assert.rejects(loadPromptRegistry(temp),/prompt_identity_mismatch/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('versioned pipeline resume validates original lock before any work and ignores moving registry',async()=>{
 const {createMashupPipeline}=await import('../scripts/mashup-pipeline.mjs');
 const {mkdir}=await import('node:fs/promises');
 const temp=await mkdtemp(join(tmpdir(),'prompt-resume-')),directory=join(temp,'run'),work=join(directory,'workspace');
 try{
  await mkdir(join(work,'build'),{recursive:true});await mkdir(join(work,'.runner'));
  for(const [path,bytes]of [[join(work,'build/game.gba'),'rom'],[join(directory,'game.gba'),'rom'],[join(work,'state.ss'),'state'],[join(work,'learning.json'),'context'],[join(work,'.runner/mashup-runtime.py'),'retained runner']])await writeFile(path,bytes);
  const lock=await loadPromptRegistry(root);await writeFile(join(work,'prompt-lock.json'),JSON.stringify(lock));
  const prior={can_resume:true,workspace:work,artifact:{path:join(directory,'game.gba'),sha256:sha('rom')},checkpoint:{path:join(work,'state.ss'),sha256:sha('state'),learning_context:{path:join(work,'learning.json'),sha256:sha('context')}},provenance:{prompts:{status:'versioned',sha256:promptLockSha256(lock)}},qualification:{}};
  let calls=0;const pipeline=createMashupPipeline({root:temp,child:async(_cmd,_args,options)=>{calls++;await writeFile(join(work,'model-stage.json'),JSON.stringify({result:{status:'stopped',reason:'limit',checkpoint:prior.checkpoint,evidence_root:options.env.GAMEVERSE_MODEL_OUTPUT_ROOT}}));}});
  const result=await pipeline.resume({id:'same-run',directory,prior});assert.equal(calls,1);assert.equal(result.prompt_status,'versioned'); // temp intentionally has no moving registry
  const changed=structuredClone(lock);changed.registry.version='different';await writeFile(join(work,'prompt-lock.json'),JSON.stringify(changed));
  await assert.rejects(pipeline.resume({id:'same-run',directory,prior}),/resume_prompt_identity_mismatch/);assert.equal(calls,1);
  await rm(join(work,'prompt-lock.json'));
  await assert.rejects(pipeline.resume({id:'same-run',directory,prior}),/ENOENT/);assert.equal(calls,1);
 }finally{await rm(temp,{recursive:true,force:true});}
});
