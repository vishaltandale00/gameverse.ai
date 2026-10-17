import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMashupPipeline, semanticDelta, validateBudget, runChild } from '../scripts/mashup-pipeline.mjs';
const base={stages:[{native_stage:0,prefabs:[{id:1,kind:'relic',component:'missile',x:200},{id:2,kind:'gate',component:'missile',x:300}]}]};
test('presentation changes cannot count as a substantial composition',()=>{
 assert.throws(()=>semanticDelta(base,{...base,title:'Different'}),/insufficient/);
 const next=structuredClone(base);next.stages[0].prefabs[0].x=210;assert.throws(()=>semanticDelta(base,next),/insufficient/);
});
test('linked native acquisition and barrier placements have exact semantic diff',()=>{
 const next=structuredClone(base);next.stages[0].prefabs[0].x=240;next.stages[0].prefabs[1].x=420;
 const report=semanticDelta(base,next);assert.deepEqual(report.kinds,['relic','gate']);assert.equal(report.changes.length,2);assert.equal(report.changes[0].before.x,200);
});
test('campaign limits configurable and finite, never inferred as game success',()=>{
 assert.equal(validateBudget({model_calls:48}).model_calls,48);assert.throws(()=>validateBudget({wall_seconds:Infinity}));assert.throws(()=>validateBudget({native_frames:0}));
});
test('missing installed native source runtime returns concrete gap',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mashup-pipeline-test-'));const p=createMashupPipeline({root,runtimeRoot:join(root,'absent')});
 const caps=await p.capabilities();assert.equal(caps.available,false);assert.ok(caps.missing_inputs.some(x=>x.includes('gba-session')));
 const result=await p.run({id:'test',intent:'mix',source_games:['pokemon-firered','metroid-zero-mission'],directory:join(root,'run')});
 assert.equal(result.reason,'unsupported_source_games');assert.equal(result.artifact,undefined);
});
test('aborting a worker waits for native child exit',async()=>{
 const signal=new AbortController();const running=runChild(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:signal.signal,timeoutMs:5000});setTimeout(()=>signal.abort(),20);await assert.rejects(running,/cancelled/);
});

test('resume requires exact native bytes and complete pinned learning context',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mashup-resume-test-')),directory=join(root,'run'),work=join(directory,'workspace');await mkdir(join(work,'build'),{recursive:true});
 const sha=x=>createHash('sha256').update(x).digest('hex');await writeFile(join(work,'build/game.gba'),'rom');await writeFile(join(directory,'game.gba'),'rom');await writeFile(join(work,'state.ss'),'state');
 let launched=0;const p=createMashupPipeline({root,child:async()=>{launched++;}});
 const prior={can_resume:true,workspace:work,artifact:{path:join(directory,'game.gba'),sha256:sha('rom')},checkpoint:{path:join(work,'state.ss'),sha256:sha('state')}};
 await assert.rejects(p.resume({directory,prior}),/resume_model_context_mismatch/);assert.equal(launched,0);
 await writeFile(join(work,'state.ss'),'changed');await assert.rejects(p.resume({directory,prior}),/resume_checkpoint_mismatch/);assert.equal(launched,0);
});
test('resume uses frozen helper with original exact state and learning paths',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mashup-resume-flow-')),directory=join(root,'run'),work=join(directory,'workspace');await mkdir(join(work,'build'),{recursive:true});
 const sha=x=>createHash('sha256').update(x).digest('hex');for(const [path,data]of [[join(work,'build/game.gba'),'rom'],[join(directory,'game.gba'),'rom'],[join(work,'state.ss'),'state'],[join(work,'learning.json'),'context']])await writeFile(path,data);
 await mkdir(join(work,'.runner'));await writeFile(join(work,'.runner/mashup-runtime.py'),'frozen historical helper');
 const calls=[];const prior={can_resume:true,workspace:work,budget:{model_calls:3,native_frames:120,wall_seconds:20,repairs:0},design:{request_satisfied:true},artifact:{path:join(directory,'game.gba'),sha256:sha('rom')},qualification:{outcome:'pass',scope:'native-boot'},checkpoint:{path:join(work,'state.ss'),sha256:sha('state'),learning_context:{path:join(work,'learning.json'),sha256:sha('context')}}};
 const p=createMashupPipeline({root,child:async(_cmd,args,options)=>{calls.push({args,options});await writeFile(join(work,'model-stage.json'),JSON.stringify({result:{status:'stopped',reason:'model_call_limit',decision_calls:4,system2_calls:1,frames:192,checkpoint:prior.checkpoint,evidence_root:options.env.GAMEVERSE_MODEL_OUTPUT_ROOT}}));return {};}});
 const result=await p.resume({id:'same-job',directory,prior});assert.equal(calls.length,1);assert.equal(calls[0].args[1],'model');assert.equal(calls[0].args[0],join(work,'.runner/mashup-runtime.py'));assert.equal(calls[0].options.env.GAMEVERSE_MODEL_RESUME_STATE,prior.checkpoint.path);assert.equal(calls[0].options.env.GAMEVERSE_MODEL_RESUME_CONTEXT,prior.checkpoint.learning_context.path);assert.ok(calls[0].options.env.GAMEVERSE_MODEL_OUTPUT_ROOT.includes('/continuations/'));assert.equal(result.artifact.sha256,prior.artifact.sha256);assert.equal(result.user_intent_validated,false);
});

test('operator campaign resource limits are explicit and reflected in capabilities',async()=>{
 const old=process.env.MASHUP_MODEL_CALLS;try{process.env.MASHUP_MODEL_CALLS='48';const p=createMashupPipeline({root:'/private/tmp'});assert.equal((await p.capabilities()).limits.model_calls,48);process.env.MASHUP_MODEL_CALLS='unlimited';assert.throws(()=>createMashupPipeline({root:'/private/tmp'}),/invalid_operator_limit/);}finally{if(old===undefined)delete process.env.MASHUP_MODEL_CALLS;else process.env.MASHUP_MODEL_CALLS=old;}
});
