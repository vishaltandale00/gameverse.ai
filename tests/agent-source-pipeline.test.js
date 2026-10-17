import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createAgentSourcePipeline,validateSourcePlan,compactSourcePromptContext,preserveOriginalClauses,originalIntentClauses} from '../scripts/agent-source-pipeline.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const intent='sonic but the enemies are pokemon';
const games=['sonic-advance','pokemon-leafgreen'];
const sha=v=>createHash('sha256').update(v).digest('hex');
const save=(p,v)=>writeFile(p,JSON.stringify(v));
async function fixture(t,options={}){
 const dir=await mkdtemp(join(tmpdir(),'source-agent-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const runtime=join(dir,'runtime');await mkdir(join(runtime,'source'),{recursive:true});await writeFile(join(runtime,'source/enemy.c'),'void enemy(void) {}');await writeFile(join(runtime,'source/.env'),'secret');await writeFile(join(runtime,'source/private.pem'),'private-key');
 const original=join(dir,'original.gba');await writeFile(original,'original');
 let called=0;
 const catalog={context:async()=>({items:[{id:'source:local',provenance:[{ref:'source'},{ref:'source/enemy.c'}]}]}),detail:async id=>({id,provenance:[]})};
 const plan={intent,source_games:games,host:'sonic-advance',donors:['pokemon-leafgreen'],render_roles:['enemy-render'],behavior:[],maps:[],parameters:{},requirements:[{id:'enemies',text:'Sonic enemies use Pokemon art'}]};
 const ledger={requirements:[{...plan.requirements[0],status:'unmet',evidence:[]}]};
 const agent={run:async args=>{called++;const capturedRequest=JSON.parse(await readFile(join(args.cwd,'request.json'),'utf8'));assert.ok(args.prompt.includes(JSON.stringify(capturedRequest.intent)));if(!options.metadataPhase)assert.equal(await readFile(join(args.cwd,'local/source/enemy.c'),'utf8'),'void enemy(void) {}');
  await save(join(args.cwd,'request-plan.json'),plan);await save(join(args.cwd,'requirement-ledger.json'),ledger);await save(join(args.cwd,'attempt-receipt.json'),{status:'blocked',steps:[{action:'inspect source/enemy.c',outcome:'No native host binding found',evidence:['local/source/enemy.c']}],blockers:['Inspected enemy owner lacks donor consumer binding.'],changed_files:[]});
  args.onEvent({type:'tool-evidence',evidence:{item_id:'real-item',item_type:'commandExecution',status:'completed',exit_code:0,command_sha256:sha('inspect'),command_bytes:7,output_sha256:sha('secret-output'),output_bytes:13,command:'OPENAI_API_KEY=private-key',output:'secret-output',changes:[{path:'/private/secret-file',kind:'update',diff_sha256:sha('private-diff')}]}});
  await options.agent?.(args,plan,ledger);return {threadId:'actual-transport-thread',turnId:'turn',status:'completed',text:'Inspected source.'};}};
 const {agent:agentHook,metadataPhase,...pipelineOptions}=options;
 const pipeline=createAgentSourcePipeline({root,agent,catalog,runtimeRoot:runtime,originalResolver:async()=>({path:original,sha256:sha('original')}),...pipelineOptions});
 return {dir,runtime,plan,ledger,pipeline,called:()=>called,args:{id:'run-1',intent,source_games:games,library_refs:['source:local'],directory:join(dir,'run')}};
}
test('unregistered local pair executes configured agent and retains concrete blocked investigation',async t=>{
 const f=await fixture(t);const result=await f.pipeline.run(f.args);
 assert.equal(f.called(),1);assert.equal(result.reason,'source_adaptation_blocked');assert.equal(result.evidence.agent.threadId,'actual-transport-thread');assert.equal(result.request_plan.host,'sonic-advance');assert.equal(result.requirement_ledger.requirements[0].status,'unmet');
 assert.equal(result.provenance.source_capture.length,2);assert.equal(result.evidence.source_context.closure.captured.length,1);assert.ok(result.provenance.prompts.call.template_sha256);assert.equal(result.artifact,undefined);assert.equal(result.timings.attempts,1);
 const checkpoint=JSON.parse(await readFile(join(f.args.directory,'agent-checkpoint.json')));assert.equal(checkpoint.status,'blocked');
 assert.equal(result.evidence.tool_execution.records,1);const trace=await readFile(result.evidence.tool_execution.path,'utf8');assert.ok(trace.includes('real-item'));assert.ok(!trace.includes('private-key'));assert.ok(!trace.includes('secret-output'));assert.ok(!trace.includes('/private/secret-file'));assert.equal(sha(trace),result.evidence.tool_execution.sha256);
});
test('trusted adapter may publish explicitly qualified partial, preserving unmet scope',async t=>{
 const f=await fixture(t,{allowVerifiedPartial:true,agent:async({cwd},plan,ledger)=>{
  await save(join(cwd,'attempt-receipt.json'),{status:'ready-for-adapter',steps:[{action:'inspect host source',outcome:'render consumer identified',evidence:['local/source/enemy.c']}],blockers:[],changed_files:[],recipe:{operation:'pokemon-enemies'}});
 },verifyCandidate:async({workspace,plan})=>{
  const path=join(workspace,'generated.gba');await writeFile(path,'modified source game');return {outcome:'pass',request_satisfied:false,allow_verified_partial:true,meaningful_change_verified:true,source_roles_verified:true,gaps:['Boss art retained'],artifact:{path,sha256:sha('modified source game')},requirement_ledger:{requirements:plan.requirements.map(row=>({...row,status:'partial',evidence:['independent-native-consumer.json']}))}};
 }});
 const result=await f.pipeline.run(f.args);assert.equal(result.status,'completed');assert.equal(result.design.request_satisfied,false);assert.equal(result.user_intent_validated,false);assert.equal(result.requirement_ledger.requirements[0].status,'partial');assert.deepEqual(result.gaps,['Boss art retained']);assert.ok(result.artifact.sha256);
});
test('agent-authored build claims cannot publish without independent native verifier',async t=>{
 const f=await fixture(t,{agent:async({cwd})=>{await writeFile(join(cwd,'enemy.c'),'changed');await writeFile(join(cwd,'candidate.gba'),'new');await save(join(cwd,'attempt-receipt.json'),{status:'candidate',steps:[{action:'build',outcome:'claimed-pass'}],blockers:[],changed_files:['enemy.c'],candidate:{path:'candidate.gba'},build:{outcome:'pass'}});}});
 const result=await f.pipeline.run(f.args);assert.equal(result.reason,'native_verifier_required');assert.equal(result.artifact,undefined);
});
test('agent output symlinks fail closed with retained agent identity',async t=>{
 const f=await fixture(t,{agent:async({cwd})=>{await rm(join(cwd,'request-plan.json'));await symlink(join(cwd,'../../original.gba'),join(cwd,'request-plan.json'));}});
 const result=await f.pipeline.run(f.args);assert.equal(result.reason,'source_agent_attempt_incomplete');assert.match(result.gaps[0],/agent_output_path_rejected/);assert.equal(result.evidence.agent.threadId,'actual-transport-thread');
});
test('plan must preserve exact source selection, intent and directional host',()=>{
 const request={intent,source_games:games};assert.throws(()=>validateSourcePlan({intent:'play Pokemon',source_games:games},request),/input_mismatch/);
 assert.throws(()=>validateSourcePlan({intent,source_games:games,host:'unselected',donors:[],requirements:[{id:'x',text:'x'}]},request),/source_roles/);
});

test('large 12000-file closures and parent provenance remain disk references within prompt budget',()=>{
 const request={id:'large',intent:'x'.repeat(12000),source_games:games,library_refs:['selected'],parent:{request_id:'parent',provenance:{huge:'x'.repeat(1000000)}}};
 const context={originals:[],closure:{captured:Array.from({length:12000},(_,i)=>({ref:'local/source/'+i+'.c',sha256:'a'.repeat(64)})),files:12000},discovery:{items:[]}};
 const prompt=compactSourcePromptContext(request,context);assert.ok(prompt.contextJson.length<24000);assert.ok(prompt.requestJson.length<13000);assert.ok(prompt.contextJson.includes('source-context.json'));assert.ok(!prompt.requestJson.includes('huge'));assert.equal(JSON.parse(prompt.requestJson).intent,request.intent);
});

test('host retains every original refinement clause even if the model omits it',()=>{
 const text='Sonic with Pokemon enemies\nRefinement: skip introduction\nRefinement: make my name Jeff';
 const plan={requirements:[{id:'enemy',text:'Pokemon enemy art'}]},ledger={requirements:[{id:'enemy',text:'Pokemon enemy art',status:'applied',evidence:['claimed']} ]};
 preserveOriginalClauses(plan,ledger,originalIntentClauses(text));assert.equal(plan.requirements.length,4);assert.equal(ledger.requirements.find(r=>r.id==='original-clause-3').text,'Refinement: make my name Jeff');assert.equal(ledger.requirements.find(r=>r.id==='original-clause-3').status,'unverified');
});

test('interrupted source attempt resumes same thread and workspace without recapture or resetting total budget',async t=>{
 let captures=0,turns=0;
 const f=await fixture(t,{wallMs:900,captureSources:async({workspace})=>{captures++;await mkdir(join(workspace,'local/source'),{recursive:true});await writeFile(join(workspace,'local/source/enemy.c'),'void enemy(void) {}');return {captured:[],source_inventory:[{game_id:'sonic-advance',ref:'local/source'}]};},agent:async args=>{turns++;if(!args.resumeThreadId){await rm(join(args.cwd,'attempt-receipt.json'));throw Object.assign(Error('Coding turn cancelled or timed out.'),{threadId:'retained-thread',turnId:'first-turn'});}assert.equal(args.resumeThreadId,'retained-thread');assert.match(args.prompt,/continu/i);}});
 const first=await f.pipeline.run(f.args);assert.equal(first.reason,'source_agent_attempt_incomplete');assert.equal(first.can_resume,true);
 const originalLock=await readFile(join(f.args.directory,'agent-prompt-lock.json'));first.timings.total_s=0.300012;first.timings.loop_config.wall_ms=300;await save(join(f.args.directory,'agent-result.json'),first);
 const result=await f.pipeline.resume({...f.args,prior:first});assert.equal(turns,2);assert.equal(captures,1);assert.equal(result.reason,'source_adaptation_blocked');assert.equal(result.continuation.consumed_before_ms,301);assert.equal(result.continuation.remaining_before_ms,599);assert.equal(result.continuation.prior_budget_ms,300);assert.ok(result.timings.total_s>=0.301);
 assert.deepEqual(await readFile(join(f.args.directory,'agent-prompt-lock.json')),originalLock);assert.deepEqual(await readFile(join(f.args.directory,'chunks/001/agent-prompt-lock.json')),originalLock);assert.ok(await readFile(join(f.args.directory,'agent-resume-prompt-lock-002.json')));assert.equal(result.evidence.tool_execution.records,2);assert.equal(JSON.parse(await readFile(join(f.args.directory,'chunks/001/agent-result.json'))).error.threadId,'retained-thread');assert.equal(result.can_resume,false);
});

test('empty explicit selection with Mario catalog candidates reaches agent without copying game trees',async t=>{
 const mario='super-mario-advance-4-super-mario-bros-3',requested='Mario but with Pokemon enemies';let captureArgs;
 const f=await fixture(t,{metadataPhase:true,originalResolver:async()=>null,captureSources:async args=>{captureArgs=args;return {captured:[],source_inventory:[],scope:'metadata-only'};},agent:async({cwd},plan,ledger)=>{Object.assign(plan,{intent:requested,source_games:[mario],host:mario,donors:[],identity_rationale:'The local catalog identifies this available Mario host source; no explicit edition was selected.',requirements:[{id:'core',text:requested}]});ledger.requirements=[{...plan.requirements[0],status:'unverified',evidence:[]}];await save(join(cwd,'request-plan.json'),plan);await save(join(cwd,'requirement-ledger.json'),ledger);}});
 const candidates=[{id:mario,name:'Super Mario Advance 4',source_refs:[{ref:'local/decomps/sma4'}]}];
 const result=await f.pipeline.run({...f.args,intent:requested,source_games:[],request_plan:{source_candidates:candidates}});
 assert.equal(f.called(),1);assert.equal(result.reason,'source_adaptation_blocked');assert.deepEqual(captureArgs.source_games,[]);assert.equal(captureArgs.metadata_only,true);assert.deepEqual(captureArgs.source_candidates,candidates);assert.deepEqual(result.provenance.source_games,[]);assert.deepEqual(result.provenance.resolved_source_games,[mario]);assert.equal(result.evidence.source_context.read_only_runtime_root,await realpath(f.runtime));
});
test('metadata-first plan cannot select a game absent from catalog candidates',async t=>{
 const f=await fixture(t,{metadataPhase:true,originalResolver:async()=>null,captureSources:async()=>({captured:[],source_inventory:[]}),agent:async({cwd},plan)=>{plan.source_games=['unrelated-game'];plan.host='unrelated-game';plan.donors=[];plan.identity_rationale='A convenient substitute';await save(join(cwd,'request-plan.json'),plan);}});
 const result=await f.pipeline.run({...f.args,source_games:[],request_plan:{source_candidates:[{id:'super-mario-advance-4-super-mario-bros-3',name:'Mario'}]}});assert.equal(f.called(),1);assert.equal(result.reason,'source_agent_attempt_incomplete');assert.match(result.gaps[0],/candidate_identity_invalid/);assert.equal(result.artifact,undefined);
});

test('metadata-first selection must retain every exact named source alongside ambiguous families',()=>{
 const mario='super-mario-advance-4-super-mario-bros-3',fusion='metroid-fusion';
 const request={intent:'Mario with Metroid Fusion combat',source_games:[],request_plan:{source_candidates:[{id:mario},{id:fusion}],required_source_games:[fusion]}};
 const plan={intent:request.intent,source_games:[mario],host:mario,donors:[],identity_rationale:'Choose locally available Mario host',requirements:[{id:'core',text:request.intent}]};
 assert.throws(()=>validateSourcePlan(plan,request),/required_source_missing/);
 assert.equal(validateSourcePlan({...plan,source_games:[mario,fusion],donors:[fusion]},request).donors[0],fusion);
});
