import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createMashupApi } from '../scripts/mashup-api.mjs';
const agent={status:async()=>({authenticated:true,type:'chatgpt'})};
const wait=async(fn)=>{for(let n=0;n<100;n++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out');};
async function fixture(t,run){const root=await mkdtemp(join(tmpdir(),'mashup-api-'));t.after(()=>rm(root,{recursive:true,force:true}));const api=createMashupApi({root,agent,pipeline:{capabilities:async()=>({presets:[]}),run},timeoutMs:1000});t.after(()=>api.shutdown());return {root,api};}
test('distinct text requests have durable idempotency and passing immutable artifacts',async t=>{
 const {root,api}=await fixture(t,async({directory,onEvent})=>{await onEvent({stage:'building',message:'Compiling actual candidate'});const bytes=Buffer.from('native-test-artifact');const path=join(directory,'candidate.gba');await writeFile(path,bytes);return {status:'completed',qualification:{outcome:'pass',scope:'native-boot'},artifact:{path,sha256:createHash('sha256').update(bytes).digest('hex')}};});
 const input={request_id:randomUUID(),intent:'A source game request'};
 await api.submit(input);const result=await wait(async()=>{const r=await api.status(input.request_id);return r.status==='completed'&&r;});
 assert.equal(result.playable,true);assert.equal(result.artifact_path,undefined);assert.equal(result.events[0].stage,'building');assert.ok(result.timings.total_s>=0);
 assert.equal((await api.submit(input)).artifact.sha256,result.artifact.sha256);
 await assert.rejects(api.submit({...input,intent:'Another request'}),{code:'idempotency_conflict'});
 const restarted=createMashupApi({root,agent,pipeline:{capabilities:async()=>({}),run:async()=>{throw Error('must not replay');}}});assert.equal((await restarted.status(input.request_id)).playable,true);
});
test('unqualified candidate remains blocked and concurrent requests do not queue',async t=>{
 let release;const {api}=await fixture(t,()=>new Promise(resolve=>{release=resolve;}));const input={request_id:randomUUID(),intent:'Make a mashup'};
 await api.submit(input);await assert.rejects(api.submit({request_id:randomUUID(),intent:'Another mashup'}),{code:'busy'});release({status:'completed',qualification:{outcome:'partial'}});
 const r=await wait(async()=>{const r=await api.status(input.request_id);return r.status==='blocked'&&r;});assert.equal(r.playable,false);assert.equal(r.error.code,'qualification_required');
});
test('cancellation cannot publish a candidate even when worker reports success',async t=>{
 const {api}=await fixture(t,({signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve({status:'completed',qualification:{outcome:'pass'}}),{once:true})));const id=randomUUID();await api.submit({request_id:id,intent:'Build a game'});await api.cancel(id);const r=await wait(async()=>{const r=await api.status(id);return r.status==='cancelled'&&r;});assert.equal(r.playable,false);
});
test('HTTP mutation rejects cross-site requests before dispatch',async t=>{
 const {api}=await fixture(t,async()=>{throw Error('unexpected dispatch');});
 const res={writeHead(code){this.code=code;},end(body){this.body=body;}};
 assert.equal(await api.handle({method:'POST',headers:{host:'127.0.0.1:4173',origin:'https://attacker.example'}},res,'/api/mashup/runs'),true);assert.equal(res.code,403);
});

test('explicit resume preserves lineage and never repeats construction',async t=>{
 let builds=0,resumes=0;const {root,api}=await fixture(t,async()=>{builds++;return {status:'blocked',can_resume:true,checkpoint:{artifact_sha256:'a'.repeat(64),usage_complete:true}};});
 // Use a fresh API with the same persistence and an actual checkpoint handler.
 const runtime=createMashupApi({root,agent,pipeline:{capabilities:async()=>({}),run:async()=>{builds++;return {status:'blocked',can_resume:true,checkpoint:{usage_complete:true}};},resume:async({prior})=>{resumes++;assert.equal(prior.checkpoint.usage_complete,true);return {status:'blocked',can_resume:true,checkpoint:prior.checkpoint};}}});
 const id=randomUUID();await runtime.submit({request_id:id,intent:'Build connected progression'});await wait(async()=>{const r=await runtime.status(id);return r.status==='blocked'&&r.can_resume;});await runtime.resume(id);const result=await wait(async()=>{const r=await runtime.status(id);return r.status==='blocked'&&r.resume_count===1&&r.finished_at&&r;});assert.equal(builds,1);assert.equal(resumes,1);assert.ok(result.timings.last_chunk_s>=0);
});
test('refinement receives exact private parent context without exposing it in public status',async t=>{
 const ids=[randomUUID(),randomUUID()];let received;
 const {api}=await fixture(t,async({id,parent,directory})=>{if(id===ids[0]){const bytes=Buffer.from('parent'),path=join(directory,'parent.gba');await writeFile(path,bytes);return {status:'completed',qualification:{outcome:'pass'},workspace:'/private/job/workspace',artifact:{path,sha256:createHash('sha256').update(bytes).digest('hex')},provenance:{world_sha256:'b'.repeat(64)}};}received=parent;return {status:'blocked'};});
 await api.submit({request_id:ids[0],intent:'Original connected systems'});await wait(async()=>{const r=await api.status(ids[0]);return r.status==='completed';});const publicParent=await api.status(ids[0]);assert.equal(publicParent.pipeline_result,undefined);
 await api.submit({request_id:ids[1],parent_request_id:ids[0],intent:'Original connected systems with a new route'});await wait(async()=>received);assert.equal(received.pipeline_result.workspace,'/private/job/workspace');assert.equal(received.pipeline_result.artifact.sha256,createHash('sha256').update('parent').digest('hex'));
});
test('receipt preserves requested selection separately from compiler source routing',async t=>{
 const routing={backend:'pokemon-overworld',source_games:['pokemon-leafgreen','pokemon-emerald'],requested_source_games:[],inferred_from:'request'};
 const {api}=await fixture(t,async({onEvent})=>{await onEvent({stage:'planning',type:'routing',routing,message:'Selected LeafGreen/Emerald'});return {status:'blocked',reason:'missing_runtime_inputs',routing};});
 const id=randomUUID();await api.submit({request_id:id,intent:'Build Pokemon Leaf Green but with Pokemon Emerald overworld sprites',source_games:[]});
 const result=await wait(async()=>{const r=await api.status(id);return r.status==='blocked'&&r;});
 assert.deepEqual(result.source_games,[]);assert.deepEqual(result.routing.source_games,['pokemon-leafgreen','pokemon-emerald']);assert.equal(result.routing.backend,'pokemon-overworld');
});
test('Pokemon intent validation requires scoped native graphics evidence, not boot alone',async t=>{
 let full=false;const {root,api}=await fixture(t,async({directory})=>{const path=join(directory,'game.gba'),bytes=Buffer.from('candidate');await writeFile(path,bytes);return {status:'completed',routing:{backend:'pokemon-overworld'},artifact:{path,sha256:createHash('sha256').update(bytes).digest('hex')},qualification:{outcome:'pass',scope:full?'native-graphics-consumer':'native-boot',request_satisfied:true},design:{request_satisfied:true},user_intent_validated:true};});
 const first=randomUUID();await api.submit({request_id:first,intent:'LeafGreen with Emerald overworld sprites'});const boot=await wait(async()=>{const r=await api.status(first);return r.finished_at&&r;});assert.equal(boot.playable,true);assert.equal(boot.objective_validated,false);
 full=true;const second=randomUUID();await api.submit({request_id:second,intent:'LeafGreen with Emerald overworld sprites'});const graphics=await wait(async()=>{const r=await api.status(second);return r.finished_at&&r;});assert.equal(graphics.playable,true);assert.equal(graphics.objective_validated,true);
});
test('failed parent automatically becomes a fresh retry with immutable provenance',async t=>{
 const ids=[randomUUID(),randomUUID()];let received;const {api}=await fixture(t,async args=>{received=args;return {status:'blocked',reason:'pending'};});
 await api.submit({request_id:ids[0],intent:'Build Pokemon Leaf Green but with Pokemon Emerald overworld sprites'});await wait(async()=>{const r=await api.status(ids[0]);return r.finished_at&&r;});
 const original=await api.status(ids[0]);await api.submit({request_id:ids[1],intent:original.intent,parent_request_id:ids[0]});const retry=await wait(async()=>{const r=await api.status(ids[1]);return r.finished_at&&r;});
 assert.equal(received.parent,null);assert.equal(retry.retry_of,ids[0]);assert.equal(retry.parent_request_id,undefined);assert.equal(retry.intent,original.intent);assert.equal((await api.status(ids[0])).input_sha256,original.input_sha256);
});
test('library references are validated metadata and stay separate from source intent',async t=>{
 const root=await mkdtemp(join(tmpdir(),'library-api-'));t.after(()=>rm(root,{recursive:true,force:true}));let received;
 const catalog={summary:async()=>({available:true}),detail:async id=>id==='typed-ir:mario.jump'?{id,label:'Mario jump',executable:false}:null,search:async()=>({items:[]})};
 const api=createMashupApi({root,agent,catalog,pipeline:{capabilities:async()=>({}),run:async args=>{received=args;return {status:'blocked'};}}});
 await assert.rejects(api.submit({request_id:randomUUID(),intent:'Pokemon as Sonic',library_refs:['../../secret']}),{code:'invalid_library_refs'});
 const input={request_id:randomUUID(),intent:'Pokemon as Sonic',source_games:['pokemon-leafgreen','sonic-advance'],library_refs:['typed-ir:mario.jump']};await api.submit(input);await wait(async()=>received);
 assert.equal(received.intent,input.intent);assert.deepEqual(received.source_games,input.source_games);assert.deepEqual(received.library_refs,input.library_refs);
 await assert.rejects(api.submit({...input,library_refs:[]}),{code:'idempotency_conflict'});
});
