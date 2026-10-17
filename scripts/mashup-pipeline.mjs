import { loadPromptRegistry, renderPrompt, savePromptCall, promptLockSha256 } from './prompt-registry.mjs';
import { testingServiceConfiguration } from './local-testing-config.mjs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile, rename, access, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path,'utf8'));
const save = (path,value) => writeFile(path, JSON.stringify(value,null,2)+'\n');
const worldRef='tools/composition/worlds/sonic-metroid-signal-descent.json';
const games=['sonic-advance','metroid-zero-mission'];
const baseline='local/composition-builds/sonic-metroid-signal-descent-25';
const limitsDefault={ model_calls:24,native_frames:960,wall_seconds:60,repairs:1 };
export function validateBudget(value={}) {
  const budget={...limitsDefault,...value};
  for(const key of ['model_calls','native_frames','wall_seconds','repairs']) if(!Number.isInteger(budget[key])||budget[key]< (key==='repairs'?0:1))throw Error('invalid_campaign_limit_'+key);
  // Caller-owned explicit resource limits. A limit never becomes success.
  return budget;
}
export function semanticDelta(before,after) {
  const old=new Map(before.stages.map(s=>[s.native_stage,s]));const changes=[];
  for(const stage of after.stages||[]) {
    const prev=old.get(stage.native_stage);
    for(const item of stage.prefabs||[]) {
      const prior=prev?.prefabs?.find(p=>p.id===item.id);
      if(JSON.stringify(prior)!==JSON.stringify(item))changes.push({stage:stage.native_stage,kind:item.kind,id:item.id,before:prior||null,after:item});
    }
    for(const item of prev?.prefabs||[])if(!stage.prefabs.some(p=>p.id===item.id))changes.push({stage:stage.native_stage,kind:item.kind,id:item.id,before:item,after:null});
  }
  const kinds=[...new Set(changes.map(c=>c.kind))];
  if(changes.length<2||kinds.length<2)throw Error('insufficient_linked_system_change');
  if(!kinds.some(k=>['gate','freeze_gateway'].includes(k))||!kinds.some(k=>['relic','alien','recharge','heat'].includes(k)))throw Error('require_progression_and_world_system_change');
  return {changes,kinds,scope:'Authored campaign prefab/configuration composition over original Sonic + source-backed MZM systems. No new recovered source claimed.'};
}
export function runChild(command,args,{cwd,signal,timeoutMs,onEvent,env=process.env}={}) {
 return new Promise((resolveResult,reject)=>{
  if(signal?.aborted){reject(Error('cancelled'));return;}
  const child=spawn(command,args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});let output='',termination=null;
  const kill=reason=>{termination=reason;try{process.kill(-child.pid,'SIGTERM');}catch{};killTimer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},1000);killTimer.unref();};
  let killTimer;const abort=()=>kill('cancelled');signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>kill('stage_timeout'),timeoutMs);timer.unref();
  for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output=(output+data.toString()).slice(-16000);});
  const cleanup=()=>{clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);};
  child.on('error',error=>{cleanup();reject(error);});child.on('close',code=>{cleanup();if(termination)reject(Error(termination));else if(code!==0)reject(Object.assign(Error('native_stage_failed'),{detail:output}));else resolveResult({code,output});});
 });
}
async function protectedFiles(work) {
 const files={};
 async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.name==='.git'||entry.name==='__pycache__'||entry.name==='design.json'||entry.name==='acceptance.json')continue;const p=join(dir,entry.name);if(entry.isSymbolicLink())throw Error('runtime_symlink_rejected');if(entry.isDirectory())await walk(p);else if(entry.isFile()&&p!==join(work,worldRef))files[p]=hash(await readFile(p));}}
 await walk(work);return files;
}
export function createMashupPipeline({root,agent,catalog,runtimeRoot=process.env.GAMEVERSE_MASHUP_RUNTIME_ROOT,python=process.env.GAMEVERSE_PYTHON||'/opt/homebrew/bin/python3',child=runChild,originalResolver}={}) {
 if(!root)throw Error('pipeline_root_required');
 const original=async id=>typeof originalResolver==='function'?await originalResolver(id):null;
 const operator={};for(const [name,key]of Object.entries({MASHUP_MODEL_CALLS:'model_calls',MASHUP_NATIVE_FRAMES:'native_frames',MASHUP_BOT_SECONDS:'wall_seconds',MASHUP_REPAIRS:'repairs'}))if(process.env[name]!==undefined){if(!/^\d+$/.test(process.env[name]))throw Error('invalid_operator_limit_'+name);operator[key]=Number(process.env[name]);}
 const campaignDefaults=validateBudget(operator);
 const helper=join(root,'scripts/mashup-runtime.py');
 async function capabilities(){
  const missing=[];const testing=await testingServiceConfiguration();
  if(!testing.configured)missing.push(testing.reason||'Native S1/S2 model credential reference unavailable');
  if(!runtimeRoot)missing.push('GAMEVERSE_MASHUP_RUNTIME_ROOT: installed research source/compiler runtime');
  else for(const ref of [baseline+'/composition.lock.json',baseline+'/sources/'+worldRef,'tools/composition/native_build.py','tools/re/session/build/gba-session','tools/playtester/sonic_adapter.py','local/roms/Sonic Advance (USA) (En,Ja).gba','local/roms/Metroid - Zero Mission (USA).gba'])try{const id=ref.endsWith('Sonic Advance (USA) (En,Ja).gba')?'sonic-advance':ref.endsWith('Metroid - Zero Mission (USA).gba')?'metroid-zero-mission':null;const uploaded=id?await original(id):null;await access(uploaded?.path||join(runtimeRoot,ref));}catch{missing.push(ref);}
  return {schema:'gameverse.mashup-pipeline-capabilities/1',available:missing.length===0,model_credentials_available:testing.configured,source_games:games,missing_inputs:missing,creation:'ChatGPT subscription agent authors connected campaign prefabs, compiles source-backed native graph, boots natively and runs S1/S2 bot',limits:campaignDefaults,scope:'Sonic Advance world/momentum plus source-backed MZM combat/motion/impact/Ripper with authored acquisition, gates and ecology. Authored bridges remain declared. Late campaign not qualified.',provenance:{baseline_sha256:'f1faa36558ae5d7ccacfc94292201b63c7a870803464a2f4d2699c6654bf6bf1',source_games:games},supports:{arbitrary_game_pairs:false,checkpoint_resume:true,model_playtest:true,automatic_repair:true}};
 }
 async function stage(name,work,signal,onEvent,budget,extraEnv={}){
  onEvent?.({type:'pipeline-stage',stage:name,phase:name,message:{prepare:'Capturing reviewed source systems into an isolated job workspace',build:'Compiling the composed native cartridge',boot:'Checking the cartridge in the native emulator',model:'Native bot is testing with S1 confidence gating and S2 escalation'}[name]});
  let selectedHelper=helper;if(name!=='prepare')try{await access(join(work,'.runner/mashup-runtime.py'));selectedHelper=join(work,'.runner/mashup-runtime.py');}catch{}
  const sonicOriginal=name==='prepare'?await original('sonic-advance'):null,metroidOriginal=name==='prepare'?await original('metroid-zero-mission'):null;
  await child(python,[selectedHelper,name,'--workspace',work,...(name==='prepare'?['--runtime',runtimeRoot,...(sonicOriginal?['--sonic-original',sonicOriginal.path]:[]),...(metroidOriginal?['--metroid-original',metroidOriginal.path]:[])]:[]),...(name==='model'?['--seconds',String(budget.wall_seconds),'--calls',String(budget.model_calls),'--frames',String(budget.native_frames)]:[])],{cwd:root,signal,timeoutMs:name==='model'?(budget.wall_seconds+20)*1000:name==='prepare'?30000:name==='build'?62000:30000,env:{...process.env,...extraEnv},onEvent});
  return json(join(work,name+'-stage.json'));
 }
 async function bot(work,signal,onEvent,budget,resumeState,resumeContext,outputRoot){
  try{const report=(await stage('model',work,signal,onEvent,budget,resumeState?{GAMEVERSE_MODEL_RESUME_STATE:resumeState,GAMEVERSE_MODEL_RESUME_CONTEXT:resumeContext,GAMEVERSE_MODEL_OUTPUT_ROOT:outputRoot}:{})).result;
   return {status:report.status,reason:report.reason,source_defects:report.source_defects||[],scope:'Bounded native model objective; campaign completion unverified',model_calls:report.continuation?.chunk_usage?.model_calls??((report.decision_calls||0)+(report.system2_calls||0)),model_calls_total:(report.decision_calls||0)+(report.system2_calls||0),frames:report.continuation?.chunk_usage?.native_frames??report.frames,frames_total:report.frames,checkpoint:report.checkpoint,report:join(report.evidence_root||work,'model-report.json'),can_resume:report.status!=='success'&&!!report.checkpoint?.learning_context};
  }catch(error){if(signal?.aborted)throw error;return {status:'blocked',reason:error.message,scope:'Model testing did not complete; inspect retained stage evidence',can_resume:false};}
 }
 async function run({id,intent,source_games=games,library_refs=[],directory,signal,onEvent,budget:requestedBudget,parent}={}){
  source_games=source_games?.length?source_games:games;
  const start=Date.now(),budget=validateBudget({...campaignDefaults,...requestedBudget});await mkdir(directory,{recursive:true});
  await save(join(directory,'intent.json'),{id,intent,source_games,budget});
  if(source_games.length!==2||source_games.some(g=>!games.includes(g)))return {status:'blocked',reason:'unsupported_source_games',gaps:['Installed source-backed native graph supports Sonic Advance + Metroid Zero Mission only.'],qualification:{outcome:'unavailable'}};
  const caps=await capabilities();if(!caps.available)return {status:'blocked',reason:'missing_runtime_inputs',gaps:caps.missing_inputs,qualification:{outcome:'unavailable'}};
  if(!agent?.run)return {status:'blocked',reason:'chatgpt_agent_unavailable',qualification:{outcome:'unavailable'}};
  const work=join(directory,'workspace');await stage('prepare',work,signal,onEvent,budget);
  await mkdir(join(work,'.runner'),{recursive:true});await copyFile(helper,join(work,'.runner/mashup-runtime.py'));await copyFile(join(root,'scripts/mashup_stagnation.py'),join(work,'.runner/mashup_stagnation.py'));
  const parentResult=parent?.pipeline_result||parent;let parentLineage=null;
  if(parentResult){
    if(!parentResult.workspace||!parentResult.artifact?.path||!parentResult.artifact?.sha256||!parentResult.provenance?.world_sha256)throw Error('parent_editable_composition_unavailable');
    if(hash(await readFile(parentResult.artifact.path))!==parentResult.artifact.sha256)throw Error('parent_artifact_identity_mismatch');
    const parentWorld=await readFile(join(parentResult.workspace,worldRef));if(hash(parentWorld)!==parentResult.provenance.world_sha256)throw Error('parent_source_identity_mismatch');
    if(JSON.stringify(parentResult.provenance.source_games)!==JSON.stringify(games))throw Error('parent_source_pair_mismatch');
    await writeFile(join(work,worldRef),parentWorld);
    parentLineage={artifact_sha256:parentResult.artifact.sha256,world_sha256:hash(parentWorld),operation:'isolated editable composition fork',save_compatibility:'unverified; no player-save migration'};
  }
  const promptLock=await loadPromptRegistry(root);await save(join(work,'prompt-lock.json'),promptLock);
  const before=await json(join(work,worldRef)),protectedBefore=await protectedFiles(work);
  const libraryContext=catalog?{search:await catalog.context({q:intent,limit:16}),selected:await Promise.all(library_refs.map(id=>catalog.detail(id)))}:null;
  await save(join(directory,'library-context.json'),libraryContext);
  const promptPin={status:'versioned',sha256:promptLockSha256(promptLock),path:join(work,'prompt-lock.json')};
  await save(join(directory,'prompt-provenance.json'),promptPin);
  const resolvedCreate=renderPrompt(promptLock,'codex-create',{libraryContext:JSON.stringify(libraryContext),intent,worldRef,parentInstruction:parentLineage?'This is a refinement of the exact parent authored world already installed here, not a reset to the original baseline. Preserve prior linked systems unless the request changes them.':''});
  const createPrompt=await savePromptCall(join(directory,'composition-prompt.json'),resolvedCreate);
  const prompt=resolvedCreate.text;
  onEvent?.({type:'pipeline-stage',stage:'compose',phase:'compose',message:'The ChatGPT agent is composing linked game systems from your request'});
  const composed=await agent.run({prompt,cwd:work,signal,onEvent});await save(join(directory,'composition-agent.json'),{...composed,prompt:createPrompt});
  const protectedAfter=await protectedFiles(work);if(JSON.stringify(protectedBefore)!==JSON.stringify(protectedAfter))throw Error('protected_runtime_modified');
  const design=await json(join(work,'design.json'));
  if(design.request_satisfied!==true)return {status:'blocked',reason:'request_exceeds_supported_systems',gaps:design.gaps||[],design,qualification:{outcome:'unavailable'}};
  const delta=semanticDelta(before,await json(join(work,worldRef)));await save(join(directory,'semantic-delta.json'),delta);
  let built=await stage('build',work,signal,onEvent,budget);
  if(built.result.output_sha256===(parentLineage?.artifact_sha256||(await json(join(work,'baseline.json'))).baseline_rom_sha256))throw Error('unchanged_cartridge');
  let boot=await stage('boot',work,signal,onEvent,budget);let tested=await bot(work,signal,onEvent,budget);
  const repairAttempts=[];
  for(let attempt=0;attempt<budget.repairs&&tested.status!=='success'&&tested.source_defects?.length;attempt++){
   const locked=await protectedFiles(work),previousWorldBytes=await readFile(join(work,worldRef)),previousWorld=hash(previousWorldBytes),previousDesign=await readFile(join(work,'design.json')),previousAcceptance=await readFile(join(work,'acceptance.json'));
   onEvent?.({type:'pipeline-stage',stage:'repair',phase:'repair',message:'The agent is inspecting native observations for a supported repair'});
   const resolvedRepair=renderPrompt(promptLock,'codex-repair',{worldRef,intent,reason:String(tested.reason)});
   const repairPrompt=await savePromptCall(join(directory,`repair-prompt-${attempt+1}.json`),resolvedRepair);
   const diagnosis=await agent.run({cwd:work,signal,onEvent,prompt:resolvedRepair.text});
   await save(join(directory,`repair-agent-${attempt+1}.json`),{...diagnosis,prompt:repairPrompt});
   if(JSON.stringify(locked)!==JSON.stringify(await protectedFiles(work)))throw Error('protected_runtime_modified');
   const nextDesign=await json(join(work,'design.json'));repairAttempts.push({attempt:attempt+1,applied:nextDesign.repair_applied===true,reason:nextDesign.repair_reason});
   if(nextDesign.repair_applied!==true||nextDesign.request_satisfied!==true||hash(await readFile(join(work,worldRef)))===previousWorld){await writeFile(join(work,worldRef),previousWorldBytes);await writeFile(join(work,'design.json'),previousDesign);await writeFile(join(work,'acceptance.json'),previousAcceptance);break;}
   semanticDelta(before,await json(join(work,worldRef)));
   const archive=join(work,'attempts',String(attempt));await mkdir(archive,{recursive:true});
   for(const name of ['build','boot','model-native','model-playtest','model-report.json','build-stage.json','boot-stage.json','model-stage.json','model-learning.json'])try{await rename(join(work,name),join(archive,name));}catch(e){if(e.code!=='ENOENT')throw e;}
   built=await stage('build',work,signal,onEvent,budget);boot=await stage('boot',work,signal,onEvent,budget);tested=await bot(work,signal,onEvent,budget);
  }
  const artifact=join(directory,'game.gba');await copyFile(join(work,'build/game.gba'),artifact);
  const result={status:'completed',artifact:{path:artifact,sha256:hash(await readFile(artifact)),title:design.title||'Sonic × Metroid'},user_intent_validated:tested.status==='success'&&design.request_satisfied===true,qualification:{outcome:'pass',scope:'native-boot',bot:tested,campaign:'unqualified'},design:await json(join(work,'design.json')),repair_attempts:repairAttempts,provenance:{prompts:promptPin,source_games:games,parent:parentLineage,baseline:await json(join(work,'baseline.json')),world_sha256:hash(await readFile(join(work,worldRef))),composition_lock:join(work,'build/composition.lock.json'),semantic_delta:semanticDelta(before,await json(join(work,worldRef)))},can_resume:tested.can_resume,checkpoint:tested.checkpoint,workspace:work,budget,timings:{total_s:(Date.now()-start)/1000,queue_s:null,last_attempt_build_s:built.result.wall_s,last_attempt_boot_s:boot.wall_s,attempt_reports:join(work,'attempts'),stage_accounting:'Stages nested within total; bot/native setup retained separately'}};
  await save(join(directory,'pipeline-result.json'),result);return result;
 }
 async function resume({id,directory,prior,signal,onEvent,budget:requestedBudget}={}){
  const started=Date.now();
  const budget=validateBudget({...campaignDefaults,...(requestedBudget||prior.budget)}),work=join(directory,'workspace');
  if(!prior.can_resume||!prior.checkpoint?.path||prior.workspace!==work)throw Error('safe_checkpoint_unavailable');
  if(hash(await readFile(prior.artifact.path))!==prior.artifact.sha256||hash(await readFile(join(work,'build/game.gba')))!==prior.artifact.sha256)throw Error('resume_artifact_mismatch');
  if(hash(await readFile(prior.checkpoint.path))!==prior.checkpoint.sha256)throw Error('resume_checkpoint_mismatch');
  const learning=prior.checkpoint.learning_context;if(!learning||hash(await readFile(learning.path))!==learning.sha256)throw Error('resume_model_context_mismatch');
  const promptPin=prior.provenance?.prompts;
  if(promptPin?.status==='versioned'){
   const frozen=await json(join(work,'prompt-lock.json'));
   if(promptLockSha256(frozen)!==promptPin.sha256)throw Error('resume_prompt_identity_mismatch');
  }
  const continuation=join(work,'continuations',String(Date.now()));await mkdir(continuation,{recursive:true});
  // Keep prior images/events/state paths immutable; continuation writes a new evidence tree.
  const tested=await bot(work,signal,onEvent,budget,prior.checkpoint.path,learning.path,continuation);
  const result={...prior,status:'completed',user_intent_validated:tested.status==='success'&&prior.design?.request_satisfied===true,qualification:{...prior.qualification,bot:tested},can_resume:tested.can_resume,checkpoint:tested.checkpoint,budget,continuation_of:id,prompt_status:promptPin?.status||'legacy_unversioned',timings:{total_s:(Date.now()-started)/1000,build_s:null,boot_s:null,reused_artifact:true,accounting:'No build/boot in continuation; prior stages retained in earlier chunk'}};
  await save(join(directory,'pipeline-result.json'),result);return result;
 }
 return {capabilities,run,resume};
}
