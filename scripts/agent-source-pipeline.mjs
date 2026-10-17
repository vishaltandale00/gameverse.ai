// Local source adaptation through the real configured Codex agent, without a game-pair allowlist.
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,realpath,lstat,readdir,open} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {loadPromptRegistry,renderPrompt,savePromptCall,promptLockSha256} from './prompt-registry.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
const save=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n',{mode:0o600});
export const originalIntentClauses=intent=>String(intent).split(/\r?\n/).filter(line=>line.trim()).map((text,index)=>({id:`original-clause-${index+1}`,text}));
export function preserveOriginalClauses(plan,ledger,clauses){
 for(const clause of clauses){
  const reserved=plan.requirements.find(row=>row.id===clause.id);if(reserved&&reserved.text!==clause.text)throw Error('agent_original_clause_identity_mismatch');
  if(!plan.requirements.some(row=>row.text===clause.text)){plan.requirements.push({...clause});ledger.requirements.push({...clause,status:'unverified',evidence:[]});}
 }
 plan.original_clauses=clauses;return {plan,ledger};
}
const safeToken=value=>typeof value==='string'?value.replace(/[^a-zA-Z0-9_./:-]/g,'_').slice(0,240):null;
export function boundedToolEvidence(event){
 const source=event?.evidence||{},record={schema:'gameverse.codex-tool-evidence/1',item_id:safeToken(source.item_id),item_type:safeToken(source.item_type),status:safeToken(source.status)};
 for(const key of ['exit_code','duration_ms','command_bytes','output_bytes'])if(Number.isFinite(source[key]))record[key]=source[key];
 for(const key of ['command_sha256','output_sha256'])if(/^[a-f0-9]{64}$/.test(source[key]||''))record[key]=source[key];
 if(Array.isArray(source.changes))record.changes=source.changes.slice(0,32).map(change=>({path_sha256:sha(String(change.path||'')),kind:safeToken(typeof change.kind==='string'?change.kind:change.kind?.type),...(typeof change.diff_sha256==='string'&&/^[a-f0-9]{64}$/.test(change.diff_sha256)?{diff_sha256:change.diff_sha256}:{}),...(Number.isFinite(change.diff_bytes)?{diff_bytes:change.diff_bytes}:{})}));
 return record;
}
export function validateSourcePlan(plan,{intent,source_games,request_plan}){
 if(plan?.intent!==intent||!Array.isArray(plan.source_games))throw Error('agent_plan_input_mismatch');
 if(source_games.length){if(JSON.stringify(plan.source_games)!==JSON.stringify(source_games))throw Error('agent_plan_input_mismatch');}
 else{
  const candidateIds=(request_plan?.source_candidates||[]).map(candidate=>candidate.id);
  if(!plan.source_games.length||new Set(plan.source_games).size!==plan.source_games.length||plan.source_games.some(id=>!candidateIds.includes(id)))throw Error('agent_plan_candidate_identity_invalid');
  if((request_plan?.required_source_games||[]).some(id=>!plan.source_games.includes(id)))throw Error('agent_plan_required_source_missing');
  if(typeof plan.identity_rationale!=='string'||!plan.identity_rationale.trim())throw Error('agent_plan_identity_rationale_required');
 }
 if(!plan.source_games.includes(plan.host)||!Array.isArray(plan.donors)||plan.donors.some(id=>!plan.source_games.includes(id)||id===plan.host))throw Error('agent_plan_source_roles_invalid');
 if(!Array.isArray(plan.requirements)||!plan.requirements.length||plan.requirements.some(r=>!r.id||typeof r.text!=='string'||!r.text)||new Set(plan.requirements.map(r=>r.id)).size!==plan.requirements.length)throw Error('agent_plan_requirements_invalid');
 return plan;
}
export function validateRequirementLedger(ledger,plan){
 if(!Array.isArray(ledger?.requirements)||ledger.requirements.length!==plan.requirements.length)throw Error('agent_requirement_ledger_incomplete');
 for(const r of plan.requirements){const row=ledger.requirements.find(x=>x.id===r.id);if(!row||row.text!==r.text||!['applied','partial','unmet','unverified'].includes(row.status)||!Array.isArray(row.evidence)||['applied','partial'].includes(row.status)&&!row.evidence.length)throw Error('agent_requirement_evidence_missing');}
 return ledger;
}
async function ownFile(base,ref,max=32*1024*1024){
 if(typeof ref!=='string'||!ref||ref.includes('\\')||ref.startsWith('/')||ref.split('/').includes('..'))throw Error('agent_output_path_rejected');
 const path=resolve(base,ref),info=await lstat(path),actual=await realpath(path);
 if(!actual.startsWith(base+sep)||info.isSymbolicLink()||!info.isFile()||info.size>max)throw Error('agent_output_path_rejected');
 return {path:actual,bytes:await readFile(actual)};
}
export async function captureLocalClosure(research,work,items,signal){
 const captured=[],skipped=[],visited=new Set();let bytes=0,files=0,entries=0,limited=false;
 const skip=(ref,reason)=>{if(skipped.length<100)skipped.push({ref,reason});};
 const sourceBase=await realpath(research),destination=join(work,'local');
 async function visit(ref){
  signal?.throwIfAborted();
  if(limited||visited.has(ref))return;visited.add(ref);if(++entries>20000){limited=true;skip(ref,'capture-entry-limit');return;}
  if(typeof ref!=='string'||ref.startsWith('/')||ref.includes('\\')||ref.split('/').some(p=>p==='..'||p.startsWith('.')))return;
  const path=join(sourceBase,ref);let info;try{info=await lstat(path);}catch{skip(ref,'unavailable');return;}
  if(info.isSymbolicLink()){skip(ref,'symlink-not-copied');return;}
  if(!((await realpath(path)).startsWith(sourceBase+sep)))return;
  if(info.isDirectory()){
   for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.name.startsWith('.')||['node_modules','__pycache__','build','logs'].includes(entry.name)||/\.(?:gba|sav|srm|log|pem|key|p12|pfx)$/i.test(entry.name)||/^(?:id_rsa|credentials|auth|secrets?)(?:[._-]|$)/i.test(entry.name))continue;
    await visit(ref+'/'+entry.name);
   }
  }else if(info.isFile()){
   if(files>=12000||bytes+info.size>128*1024*1024){limited=true;skip(ref,'capture-resource-limit');return;}
   const value=await readFile(path),target=join(destination,ref);await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,value,{mode:info.mode&0o111?0o700:0o600});
   captured.push({source_ref:ref,ref:'local/'+ref,sha256:sha(value),size_bytes:value.length});bytes+=value.length;files++;
  }
 }
 const refs=[...new Set(items.flatMap(i=>(i.provenance||[]).map(p=>p.ref)))].slice(0,80);
 for(const ref of refs)await visit(ref);
 return {captured,skipped,bytes,files,limited,limits:{max_bytes:128*1024*1024,max_files:12000},accounting:'Exact copied file hashes identify captured local source/tool inputs; skipped dependency closure remains explicit.'};
}
// Large manifests stay on disk. The bridge accepts a maximum 64k character prompt.
export function compactSourcePromptContext(request,context){
 const compactItem=item=>({id:item?.id,kind:item?.kind,label:String(item?.label||'').slice(0,160),provenance:(item?.provenance||[]).slice(0,3).map(p=>({ref:p.ref}))});
 const requestSummary={id:request.id,intent:request.intent,source_games:request.source_games,library_refs:request.library_refs,request_file:'request.json',source_candidates_file:request.request_plan?.source_candidates?.length?'request.json':null,parent_request_id:request.parent?.request_id||null,parent_details_file:request.parent?'request.json':null,original_clauses_file:'request.json'};
 const closure=context.closure||{};
 const summary={source_context_file:'source-context.json',source_capture_file:'source-capture.json',local_source_root:context.local_source_root,source_access:context.source_access,read_only_runtime_root:context.read_only_runtime_root,source_candidates:context.source_candidates?.slice(0,12),originals:context.originals,missing_originals:context.missing_originals,capture:{files:closure.files??closure.captured?.length??null,bytes:closure.bytes??null,limited:closure.limited??null,limits:closure.limits,first_source_refs:(closure.captured||[]).slice(0,12).map(p=>p.ref),note:'Read source-context.json and source-capture.json on disk for complete source/tool inventory, installed adapter recipes, hashes and dependency gaps before acting.'},selected_library_ids:(context.selected_library||[]).map(i=>i?.id),discovery:(context.discovery?.items||[]).slice(0,8).map(compactItem)};
 const contextJson=JSON.stringify(summary);
 return {requestJson:JSON.stringify(requestSummary),contextJson:contextJson.length<=24000?contextJson:JSON.stringify({source_context_file:'source-context.json',source_capture_file:'source-capture.json',note:'Read complete local context on disk; omitted inline inventory exceeds prompt budget.'})};
}
const outputContract={
 plan:{file:'request-plan.json',fields:['intent verbatim','source_games exact selected array; if selection empty, nonempty subset of request.request_plan.source_candidates ids','identity_rationale (required when source selection was empty)','host','donors','render_roles','behavior','maps','parameters','requirements: [{id,text}] (include every request.original_clauses verbatim)']},
 ledger:{file:'requirement-ledger.json',fields:['requirements: [{id,text,status: applied|partial|unmet|unverified,evidence: []}]']},
 receipt:{file:'attempt-receipt.json',fields:['status: candidate|ready-for-adapter|blocked','steps: [{action,outcome,evidence: []}]','blockers: []','changed_files: [workspace-relative source files]','recipe: optional structured installed adapter operation','candidate: optional {path,title}','build: optional {outcome,log}']},
 rules:['Inspect the discovered local source/IR/prefabs and installed tools. Copy the needed source closure before editing or building.','Attempt a viable source transformation and build, or identify a concrete inspected blocker. A known faithful adapter recipe may be submitted for independent execution.','Never mutate the research root or parent workspace. Never substitute a different game, standalone remake or arbitrary original launcher.','Every refinement, including intro, names and sprite size, needs an explicit requirement and evidence or unmet status.','Native verification is independently executed. No paid testing calls; no whole-game IR reconstruction claim.']
};
export function createAgentSourcePipeline({root,agent,catalog,originalResolver,runtimeRoot=process.env.GAMEVERSE_LIBRARY_ROOT||process.env.GAMEVERSE_MASHUP_RUNTIME_ROOT||root,verifyCandidate,captureSources,allowVerifiedPartial=false,wallMs=Number(process.env.MASHUP_AGENT_TIMEOUT_MS||900000),promptLoader=loadPromptRegistry}={}){
 if(!root||!agent?.run||!Number.isSafeInteger(wallMs)||wallMs<1||wallMs>1800000)throw Error('invalid_agent_source_pipeline_configuration');
 async function capabilities(){return {available:true,source_games:[],scope:'Bounded Codex local source investigation/adaptation; independent native verification before publication.',supports:{source_investigation:true,arbitrary_game_pairs:'attempt-when-local',checkpoint_resume:true},limits:{agent_wall_ms:wallMs,attempts:1}};}
 const budgetFor=prior=>Number.isSafeInteger(prior?.continuation?.total_budget_ms)&&prior.continuation.total_budget_ms>0&&prior.continuation.total_budget_ms<=1800000?prior.continuation.total_budget_ms:wallMs;
 const threadFor=prior=>prior?.error?.threadId||prior?.evidence?.agent?.threadId||prior?.continuation?.thread_id;
 const canResume=prior=>!!(prior&&prior.status!=='completed'&&prior.status!=='cancelled'&&prior.reason==='source_agent_attempt_incomplete'&&threadFor(prior)&&prior.workspace&&Number.isFinite(prior.timings?.total_s)&&prior.timings.total_s*1000<budgetFor(prior));
 async function run({id,intent,source_games=[],library_refs=[],directory,signal,onEvent=()=>{},parent,budget,request_plan,resumePrior}={}){
 const start=performance.now(),consumedMs=resumePrior?Math.ceil(resumePrior.timings.total_s*1000):0,totalBudgetMs=budgetFor(resumePrior),remainingMs=totalBudgetMs-consumedMs;
 if(resumePrior&&!canResume(resumePrior))throw Error('source_continuation_unavailable');
 const timeout=AbortSignal.timeout(Math.max(1,remainingMs)),boundedSignal=signal?AbortSignal.any([signal,timeout]):timeout;await mkdir(directory,{recursive:true});const work=join(directory,'agent-workspace');await mkdir(work,{recursive:true});const base=await realpath(work);
 const chunk=(resumePrior?.continuation?.chunk_count||1)+(resumePrior?1:0);
 if(resumePrior){
  if(await realpath(resumePrior.workspace)!==base)throw Error('source_continuation_workspace_mismatch');
  const snapshot=join(directory,'chunks',String(chunk-1).padStart(3,'0'));await mkdir(snapshot,{recursive:true});const manifest=[];
  for(const name of ['agent-result.json','agent-checkpoint.json','source-agent.json','agent-tools.jsonl','agent-prompt-lock.json','agent-source-prompt.json','host-request-plan.json','host-requirement-ledger.json']){
   try{const file=await ownFile(await realpath(directory),name,16*1024*1024);await writeFile(join(snapshot,name),file.bytes,{flag:'wx',mode:0o600});manifest.push({ref:name,sha256:sha(file.bytes)});}catch(error){if(!['ENOENT','EEXIST'].includes(error.code))throw error;}
  }
  await writeFile(join(snapshot,'snapshot.json'),JSON.stringify({schema:'gameverse.source-chunk-snapshot/1',chunk:chunk-1,files:manifest},null,2)+'\n',{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});
 }
 const request=resumePrior?JSON.parse((await ownFile(base,'request.json',4*1024*1024)).bytes.toString('utf8')):{schema:'gameverse.source-transform-request/1',id,intent,source_games,library_refs,original_clauses:originalIntentClauses(intent),parent:parent?{request_id:parent.request_id,workspace:parent.pipeline_result?.workspace,artifact:parent.pipeline_result?.artifact,provenance:parent.pipeline_result?.provenance}:null,request_plan:request_plan||null};
 if(resumePrior&&(request.id!==id||request.intent!==intent||JSON.stringify(request.source_games)!==JSON.stringify(source_games)))throw Error('source_continuation_input_mismatch');
 if(resumePrior?.provenance?.input_sha256&&sha(JSON.stringify(request))!==resumePrior.provenance.input_sha256)throw Error('source_continuation_request_identity_mismatch');
 request.original_clauses??=originalIntentClauses(request.intent);
 const checkpoint={schema:'gameverse.source-attempt-checkpoint/1',run_id:id,status:'running',stage:'capturing-inputs',started_at:new Date().toISOString(),attempts:1,chunk,budget:{total_ms:totalBudgetMs,consumed_before_ms:consumedMs,remaining_ms:remainingMs,prior_total_ms:resumePrior?.timings?.loop_config?.wall_ms??null}};
 await save(join(directory,'agent-checkpoint.json'),checkpoint);if(!resumePrior)await save(join(work,'request.json'),request);
 let context,agentResult,plan,ledger,receipt,prompts,resolved,originals,toolFile,toolCount=0,toolBytes=0,toolLimited=false,toolWrites=Promise.resolve();
 const toolHash=createHash('sha256'),toolPath=join(directory,'agent-tools.jsonl');
 if(resumePrior){try{const previous=await ownFile(await realpath(directory),'agent-tools.jsonl',512*1024);toolHash.update(previous.bytes);toolBytes=previous.bytes.length;toolCount=previous.bytes.toString('utf8').split('\n').filter(Boolean).length;}catch(error){if(error.code!=='ENOENT')throw error;}}
 const privateEvent=event=>{
  if(event?.type!=='tool-evidence')return onEvent(event);
  if(toolCount>=256||toolBytes>=512*1024){toolLimited=true;return;}
  const line=JSON.stringify({at:new Date().toISOString(),...boundedToolEvidence(event)})+'\n';
  if(toolBytes+Buffer.byteLength(line)>512*1024){toolLimited=true;return;}
  toolCount++;toolBytes+=Buffer.byteLength(line);toolHash.update(line);
  toolWrites=toolWrites.then(async()=>{toolFile??=await open(toolPath,resumePrior?'a':'wx',0o600);await toolFile.write(line);});
  return onEvent({type:'activity',itemType:'tool-completed',message:'Codex completed a local tool step; private execution evidence retained.'});
 };
 const finish=async(status,reason,gaps=[],extra={})=>{
  await toolWrites;if(toolFile){await toolFile.close();toolFile=null;}
  const toolExecution={schema:'gameverse.codex-tool-trace/1',records:toolCount,bytes:toolBytes,limited:toolLimited,path:toolCount?toolPath:null,sha256:toolHash.copy().digest('hex'),contents:'Private bounded real bridge item metadata and digests; no command/output text or credentials.'};
  Object.assign(checkpoint,{stage:'finished',status,reason,finished_at:new Date().toISOString()});await save(join(directory,'agent-checkpoint.json'),checkpoint);
  const result={status,reason,gaps,can_resume:false,continuation:{chunk_count:chunk,thread_id:threadFor(resumePrior)||agentResult?.threadId||extra.error?.threadId||null,total_budget_ms:totalBudgetMs,consumed_before_ms:consumedMs,remaining_before_ms:remainingMs,prior_budget_ms:resumePrior?.timings?.loop_config?.wall_ms??null},workspace:work,user_intent_validated:false,request_plan:plan||null,requirement_ledger:ledger||null,design:{request_satisfied:false,changes:receipt?.changed_files||[],gaps},qualification:{outcome:'unavailable'},evidence:{request,tool_execution:toolExecution,request_plan:plan||null,requirement_ledger:ledger||null,attempt:receipt||null,agent:agentResult?{threadId:agentResult.threadId,turnId:agentResult.turnId,status:agentResult.status}:null,source_context:context||null},provenance:{source_games,resolved_source_games:plan?.source_games||null,prompts:prompts||null,input_sha256:sha(JSON.stringify(request)),source_capture:context?.originals||[]},timings:{run_id:id,source_commit:null,source_commit_note:'Working-tree input hashes retained; commit unavailable.',adapter_version:'agent-source-transform/1',loop_config:{wall_ms:totalBudgetMs,attempts:1},total_s:consumedMs/1000+(performance.now()-start)/1000,last_chunk_s:(performance.now()-start)/1000,queue_s:null,build_s:null,simulation_s:null,evaluation_s:null,attempts:1,accounting:'Capture, agent and optional native verifier nested within total; unavailable stages are null.'},...extra};
  result.can_resume=canResume(result);
  await save(join(directory,'agent-result.json'),result);return result;
 };
 try{
  const sourceCandidates=(request.request_plan?.source_candidates||[]).filter(candidate=>typeof candidate?.id==='string'&&/^[a-z0-9-]{1,100}$/.test(candidate.id));
  const metadataOnly=!source_games.length&&sourceCandidates.length>0;
  if(!source_games.length&&!metadataOnly)return await finish('blocked','source_identity_required',['Select the local source games or resolve candidate identities from the local catalog.']);
  if(!resumePrior){
  const discovery=catalog?await catalog.context({q:intent,limit:30}):null,selected=catalog?await Promise.all(library_refs.map(id=>catalog.detail(id))):[];
  await mkdir(join(work,'inputs'),{recursive:true});originals=[];const missing=[];
  for(const game of source_games){
   const original=typeof originalResolver==='function'?await originalResolver(game):null;if(!original?.path){missing.push(game);continue;}
   const info=await lstat(original.path);if(!info.isFile()||info.isSymbolicLink()||info.size>32*1024*1024)throw Error('unsafe_original_input');
   const bytes=await readFile(original.path),digest=sha(bytes);if(original.sha256&&original.sha256!==digest)throw Error('original_input_identity_mismatch');
   const ref=`inputs/${game}.gba`;await writeFile(join(work,ref),bytes,{mode:0o600});originals.push({game_id:game,ref,sha256:digest,sha1:original.sha1||null,revision:original.revision??null});
  }
  const closure=typeof captureSources==='function'?await captureSources({source_games,source_candidates:sourceCandidates,metadata_only:metadataOnly,library_refs,discovery,selected,workspace:work,runtimeRoot,signal:boundedSignal}):await captureLocalClosure(runtimeRoot,work,[...(discovery?.items||[]),...selected.filter(Boolean)].map(item=>metadataOnly?{...item,provenance:(item.provenance||[]).filter(p=>typeof p.ref==='string'&&(/\.(?:json|md|txt)$/i.test(p.ref)||item.kind==='tool'&&/\.(?:mjs|py)$/i.test(p.ref)))}:item),boundedSignal);
  await save(join(directory,'source-capture.json'),closure);
  context={schema:'gameverse.source-context/1',local_source_root:'local',source_access:metadataOnly?'Read candidate source paths and tooling under read_only_runtime_root; copy the required source closure into this isolated workspace before editing or building. Do not access unrelated files or credentials.':'Edit only isolated copied local inputs. Inspect source-capture.json for exact hashes and missing dependencies.',...(metadataOnly?{read_only_runtime_root:await realpath(runtimeRoot),source_candidates:sourceCandidates}:{}),discovery,selected_library:selected,originals,missing_originals:missing,closure};
  await save(join(work,'source-capture.json'),closure);
  await save(join(work,'source-context.json'),context);
  if(!metadataOnly&&!originals.length&&!(closure.source_inventory||[]).length)return await finish('blocked','missing_local_inputs',['No verified original or captured game source checkout is available for investigation.']);
  const lock=await promptLoader(root);await save(join(directory,'agent-prompt-lock.json'),lock);prompts={lock_sha256:promptLockSha256(lock)};
  resolved=renderPrompt(lock,'codex-source-transform',{...compactSourcePromptContext(request,context),outputContractJson:JSON.stringify(outputContract)});
  if(resolved.text.length>60000)throw Error('source_prompt_budget_exceeded');
  prompts.call=await savePromptCall(join(directory,'agent-source-prompt.json'),resolved);
  }else{
   context=JSON.parse((await ownFile(base,'source-context.json',8*1024*1024)).bytes.toString('utf8'));originals=context.originals||[];
   if(resumePrior.provenance?.source_capture&&JSON.stringify(originals)!==JSON.stringify(resumePrior.provenance.source_capture))throw Error('source_continuation_original_identity_mismatch');
   const frozen=JSON.parse((await ownFile(await realpath(directory),'agent-prompt-lock.json',4*1024*1024)).bytes.toString('utf8'));const originalLockHash=promptLockSha256(frozen);
   if(resumePrior.provenance?.prompts?.original_lock_sha256&&resumePrior.provenance.prompts.original_lock_sha256!==originalLockHash)throw Error('source_original_prompt_lock_mismatch');
   if(!resumePrior.provenance?.prompts?.original_lock_sha256&&resumePrior.provenance?.prompts?.lock_sha256&&resumePrior.provenance.prompts.lock_sha256!==originalLockHash)throw Error('source_original_prompt_lock_mismatch');
   const lock=await promptLoader(root),suffix=String(chunk).padStart(3,'0');await save(join(directory,`agent-resume-prompt-lock-${suffix}.json`),lock);
   prompts={original_lock_sha256:originalLockHash,lock_sha256:promptLockSha256(lock),phase:'continuation',previous:resumePrior.provenance?.prompts||null};
   const continuation={thread_id:threadFor(resumePrior),chunk,total_budget_ms:totalBudgetMs,consumed_ms:consumedMs,remaining_ms:remainingMs,previous_budget_ms:resumePrior.timings?.loop_config?.wall_ms,workspace:work,request_file:'request.json',context_file:'source-context.json',plan_file:'request-plan.json',ledger_file:'requirement-ledger.json',receipt_file:'attempt-receipt.json',existing_artifacts:['artifacts/candidate.gba','artifacts/enemy-transfer.json','evidence/final-audit.json']};
   resolved=renderPrompt(lock,'codex-source-transform-resume',{requestJson:compactSourcePromptContext(request,context).requestJson,continuationJson:JSON.stringify(continuation),outputContractJson:JSON.stringify(outputContract)});
   if(resolved.text.length>60000)throw Error('source_prompt_budget_exceeded');
   prompts.call=await savePromptCall(join(directory,`agent-resume-prompt-${suffix}.json`),resolved);
  }
  checkpoint.stage='agent-investigation';await save(join(directory,'agent-checkpoint.json'),checkpoint);
  await onEvent({type:'pipeline-stage',stage:'planning',message:'Codex is investigating the selected local sources and attempting the requested transformation in an isolated workspace.'});
  boundedSignal.throwIfAborted();
  agentResult=await agent.run({cwd:work,prompt:resolved.text,...(resumePrior?{resumeThreadId:threadFor(resumePrior)}:{}),signal:boundedSignal,onEvent:privateEvent});await toolWrites;await save(join(directory,'source-agent.json'),agentResult);
  const output=async ref=>JSON.parse((await ownFile(base,ref,512*1024)).bytes.toString('utf8'));
  plan=validateSourcePlan(await output('request-plan.json'),request);ledger=validateRequirementLedger(await output('requirement-ledger.json'),plan);receipt=await output('attempt-receipt.json');
  preserveOriginalClauses(plan,ledger,request.original_clauses);validateRequirementLedger(ledger,plan);
  await save(join(directory,'host-request-plan.json'),plan);await save(join(directory,'host-requirement-ledger.json'),ledger);
  if(!Array.isArray(receipt.steps)||!receipt.steps.length||!Array.isArray(receipt.blockers)||!Array.isArray(receipt.changed_files)||!['candidate','ready-for-adapter','blocked'].includes(receipt.status))throw Error('agent_attempt_receipt_invalid');
  receipt.reporting='Agent-reported steps; independent verification required.';
  const changes=[];for(const ref of receipt.changed_files){const f=await ownFile(base,ref);changes.push({ref,sha256:sha(f.bytes)});}receipt.changed_files=changes;
  if(receipt.status==='blocked')return await finish('blocked','source_adaptation_blocked',receipt.blockers.length?receipt.blockers:['No native candidate produced; inspect retained agent attempt.']);
  let artifact=null;
  if(receipt.status==='candidate'){
   const file=await ownFile(base,receipt.candidate?.path);artifact={path:file.path,sha256:sha(file.bytes),title:receipt.candidate.title};
   if(originals.some(o=>o.sha256===artifact.sha256))return await finish('blocked','unchanged_original_candidate',['Candidate is identical to an input original.']);
   if(!changes.length||receipt.build?.outcome!=='pass')return await finish('blocked','source_build_evidence_required',['A changed source closure and successful build evidence are required.']);
  }else if(!receipt.recipe||typeof receipt.recipe!=='object')throw Error('agent_adapter_recipe_required');
  if(!verifyCandidate)return await finish('blocked','native_verifier_required',['Agent attempt retained; no independent native verifier is installed for this transformation.']);
  checkpoint.stage='independent-native-verification';await save(join(directory,'agent-checkpoint.json'),checkpoint);
  const verification=await verifyCandidate({id,intent,parent,original_clauses:request.original_clauses,plan,ledger,receipt,artifact,workspace:work,directory,sourceContext:context,budget,signal:boundedSignal,onEvent});await save(join(directory,'source-verification.json'),verification);
  // A trusted adapter may build the submitted recipe and return its generated artifact and ledger.
  if(verification?.requirement_ledger)ledger=validateRequirementLedger(verification.requirement_ledger,plan);
  artifact=verification?.artifact||artifact;
  const full=verification?.request_satisfied===true&&verification?.intent_coverage_verified===true&&ledger.requirements.every(r=>r.status==='applied');
  const partial=allowVerifiedPartial&&verification?.allow_verified_partial===true&&verification?.meaningful_change_verified===true&&verification?.source_roles_verified===true&&ledger.requirements.some(r=>['applied','partial'].includes(r.status));
  if(verification?.outcome!=='pass'||!full&&!partial)return await finish('blocked','source_candidate_unqualified',verification?.gaps||['Native verification did not prove the requested transformation.'],{qualification:verification||{outcome:'unavailable'}});
  boundedSignal.throwIfAborted();
  const actual=await realpath(artifact?.path),bytes=await readFile(actual);
  if(!actual.startsWith(await realpath(directory)+sep)||sha(bytes)!==artifact.sha256||originals.some(o=>o.sha256===artifact.sha256))throw Error('verified_artifact_identity_mismatch');
  return await finish('completed',null,verification.gaps||[],{artifact,qualification:verification,user_intent_validated:full,design:{title:artifact.title||'Your source transformation',request_satisfied:full,partial:!full,changes,gaps:verification.gaps||[]}});
 }catch(error){return await finish(signal?.aborted?'cancelled':'blocked',signal?.aborted?'cancelled':'source_agent_attempt_incomplete',[String(error.message).slice(0,1500)],{error:{code:'source_agent_attempt_incomplete',message:String(error.message).slice(0,1500),threadId:error.threadId||agentResult?.threadId||null,turnId:error.turnId||agentResult?.turnId||null}});}
 }
 return {capabilities,run,canResume,resume:args=>run({...args,resumePrior:args.prior})};
}
