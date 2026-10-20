import {voicePackage} from '../../scripts/dev-manager/voice-package.mjs';import {releaseContent} from '../../src/hosted-voice-protocol.js';import {digest} from '../../src/dev-manager-protocol.js';import {execFileSync} from 'node:child_process';
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {fakeDaytona} from './manual/hosted-daytona-fixture.mjs';
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV='false';process.env.WRANGLER_SEND_METRICS='false';const {unstable_dev}=await import('wrangler');
const policy={wall_ms:120000,model_calls:10,account_active:1,platform_active:2,daily_jobs:3};
test('ordinary account API key dispatches in the cloud without manager; encrypted custody, source fences, isolation, rotation and restart',{timeout:60000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'gv-hosted-state-')),daytona=await fakeDaytona();let worker;
 const assets=join(dir,'assets');await mkdir(join(assets,'runtime'),{recursive:true});await writeFile(join(assets,'index.html'),'Hosted voice contract fixture');const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),pkg=await voicePackage(source),fixtureRelease={schema:'gameverse.hosted-voice-release/1',source_commit:source,files:Object.fromEntries(pkg.files),games:[{gameId:'soccer',version:'1.0.0',artifactSha256:'d'.repeat(64)}]};fixtureRelease.sha256=await digest(releaseContent(fixtureRelease));await writeFile(join(assets,'runtime/voice-worker.json'),JSON.stringify(fixtureRelease));
 const start=async()=>worker=await unstable_dev('tests/hosting/fixtures/dev-manager-worker.js',{config:'tests/hosting/fixtures/wrangler.voice.jsonc',assets,local:true,ip:'127.0.0.1',port:0,persistTo:dir,vars:{HOSTED_VOICE_ENABLED:'1',OPENAI_API_KEY:'sk-operator-fixture-must-not-be-used',HOSTED_VOICE_POLICY:JSON.stringify(policy),DAYTONA_API_URL:daytona.base,HOSTED_VOICE_BROKER_URL:'http://127.0.0.1:1'},logLevel:'error',inspect:false,experimental:{disableExperimentalWarning:true,disableDevRegistry:true,watch:false}});
 t.after(async()=>{await worker?.stop();await daytona.stop();await rm(dir,{recursive:true,force:true});});await start();
 const req=(path,{cookie,body,raw,method=body||raw?'POST':'GET',headers={},origin='http://localhost'}={})=>worker.fetch('http://localhost'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'}),...headers},body:raw||body&&JSON.stringify(body)});
 const read=async(path,options)=>{const r=await req(path,options),v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v;};
 const login=async actor=>(await req('/test/login/'+actor)).headers.get('set-cookie').split(';')[0];let n=await login('n'),b=await login('b');
 assert.equal((await read('/api/me',{cookie:n})).account.developer,false);
 assert.equal((await read('/api/voice/config',{cookie:n})).available,false);
 assert.equal((await req('/api/dev-manager/status',{cookie:n})).status,403);
 const key='sk-hosted-fixture-ordinary-account-key';await read('/api/agent-connections/codex/api-key',{cookie:n,body:{key}});
 const config=await read('/api/voice/config',{cookie:n});assert.equal(config.available,true);assert.equal(config.executor,'hosted-api-key');assert.equal(config.manager_id,undefined);assert.equal(config.inference_qualified,false);
 assert.equal((await read('/api/voice/config',{cookie:b})).available,false,'no operator-key fallback');
 const release=await(await worker.fetch('http://localhost/runtime/voice-worker.json')).json(),game=release.games[0],binding={id:crypto.randomUUID(),epoch:crypto.randomUUID(),execution:'hosted-api-key',target:{...game,profileId:'ordinary-profile',sessionId:'ses_hosted',sourceCommit:config.source_commit},snapshot:{games:[],sessions:[],runs:[]}};
 assert.equal((await req('/api/browser-voice/bind',{cookie:b,body:binding})).status,403,'missing account key cannot admit a job');
 assert.equal((await req('/api/browser-voice/bind',{cookie:n,body:{...binding,target:{...binding.target,artifactSha256:'f'.repeat(64)}}})).status,409);
 assert.equal((await req('/api/browser-voice/bind',{cookie:n,body:binding,origin:'https://evil.example'})).status,403);
 await read('/api/browser-voice/bind',{cookie:n,body:binding});const id=crypto.randomUUID(),audio=Buffer.from('synthetic recorded microphone bytes'),headers={'Content-Type':'audio/webm','X-Request-ID':id,'X-Gameverse-Voice-Session':binding.id};
 assert.equal((await req('/api/voice/transcriptions',{cookie:n,raw:audio,headers})).status,202);assert.equal((await req('/api/voice/transcriptions',{cookie:n,raw:audio,headers})).status,202);
 assert.equal((await req('/api/voice/requests/'+id,{cookie:b})).status,404);
 // The browser polls more frequently than the alarm interval. Polling must not
 // postpone dispatch forever; exercise real workerd alarms without a manual tick.
 const dispatchUntil=Date.now()+7000;while(daytona.stats.executes===0&&Date.now()<dispatchUntil){await read('/api/browser-voice/poll',{cookie:n,body:{id:binding.id,epoch:binding.epoch}});await new Promise(r=>setTimeout(r,100));}
 assert.equal(daytona.stats.executes,1,'continuous browser polling must not starve the dispatch alarm');
 let state=await read('/test/hosted/inspect',{cookie:n});assert.equal(Object.keys(state.tasks).length,1);assert.equal(daytona.stats.creates,1);assert.equal(daytona.stats.executes,1);assert(!JSON.stringify(state).includes(key));assert(!JSON.stringify(daytona.stats.launches).includes(key));assert.equal(daytona.stats.launches[0].source_commit,config.source_commit);
 const {token}=await read('/test/hosted/token?id='+id,{cookie:n}),owner=state.owner,endpoint='/api/browser-voice/worker/'+id+'?executor=hosted-api-key&account='+encodeURIComponent(owner);
 const call=body=>read(endpoint,{body,headers:{Authorization:'Bearer '+token}});
 assert.equal((await req(endpoint,{body:{op:'work'},headers:{Authorization:'Bearer forged'}})).status,401);
 assert.equal((await call({op:'work'})).active,true);
 const transcription=await call({op:'provider',id:id+':asr',kind:'transcribe',payload:{request_id:id}});assert.equal(transcription.text,'Play soccer and try to score');assert.deepEqual(await call({op:'provider',id:id+':asr',kind:'transcribe',payload:{request_id:id}}),transcription);
 await worker.stop();worker=null;await start();n=await login('n');state=await read('/test/hosted/inspect',{cookie:n});assert.equal(state.tasks[id].id,id);await read('/api/browser-voice/poll',{cookie:n,body:{id:binding.id,epoch:binding.epoch}});assert.equal(daytona.stats.creates,1);assert.equal(daytona.stats.executes,1);
 const inFlight=req(endpoint,{body:{op:'provider',id:'rotation-in-flight',kind:'plan',payload:{state:'hold-for-key-rotation',questions:[]}},headers:{Authorization:'Bearer '+token}});await new Promise(r=>setTimeout(r,120));
 await read('/api/agent-connections/codex/api-key',{cookie:n,body:{key:'sk-hosted-fixture-rotated-account-key'}});
 const late=await inFlight;assert.equal((await late.json()).error,'voice_provider_failed','an in-flight response cannot survive key rotation');
 assert.equal((await call({op:'work'})).active,false);
 assert.equal((await req(endpoint,{body:{op:'provider',id:'late',kind:'plan',payload:{}},headers:{Authorization:'Bearer '+token}})).status,409);
 const cleanupUntil=Date.now()+7500;while(Date.now()<cleanupUntil){state=await read('/test/hosted/inspect',{cookie:n});if(state.tasks[id].cleanup_confirmed)break;await new Promise(r=>setTimeout(r,150));}assert.equal(state.tasks[id].cleanup_confirmed,true);assert.equal(state.tasks[id].phase,'cancelled');assert.equal(daytona.stats.deletes,1);assert(state.tasks[id].artifacts.some(a=>a.kind==='source'));const artifact=state.tasks[id].artifacts.find(a=>a.kind==='source'),download='/api/voice/requests/'+id+'/artifacts/'+artifact.sha256;assert.equal((await req(download,{cookie:n})).status,200);assert.equal((await req(download,{cookie:b})).status,404);assert.equal((await read('/api/voice/requests/'+id,{cookie:n})).worker.cleanup_confirmed,true);
});
