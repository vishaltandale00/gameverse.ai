import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Store} from '../../scripts/dev-manager/store.mjs';import {Transport,identity} from '../../scripts/dev-manager/transport.mjs';import {digest} from '../../src/dev-manager-protocol.js';
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV='false';process.env.WRANGLER_SEND_METRICS='false';process.env.WRANGLER_LOG_PATH=join(tmpdir(),'gameverse-manager-test.log');
const {unstable_dev}=await import('wrangler');
test('actual SQLite/R2 Worker binds signed managers, isolates artifacts and retains state across restart',{timeout:60000},async t=>{
  const persist=await mkdtemp(join(tmpdir(),'gvm-workerd-')),dir=await mkdtemp(join(tmpdir(),'gvm-device-'));let worker;const assets=join(persist,'assets');await mkdir(assets);await writeFile(join(assets,'index.html'),'Synthetic API test assets');
  const start=async()=>{worker=await unstable_dev('tests/hosting/fixtures/dev-manager-worker.js',{config:'tests/hosting/fixtures/wrangler.manager.jsonc',assets,local:true,ip:'127.0.0.1',port:0,persistTo:persist,logLevel:'error',inspect:false,experimental:{disableExperimentalWarning:true,disableDevRegistry:true,watch:false}});};
  t.after(async()=>{await worker?.stop();await rm(persist,{recursive:true,force:true});await rm(dir,{recursive:true,force:true});});await start();
  const request=(path,{cookie,method='GET',body,origin='http://localhost'}={})=>worker.fetch('http://localhost'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'})},...(body?{body:JSON.stringify(body)}:{})});
  const login=async actor=>{const r=await request('/test/login/'+actor);return {cookie:r.headers.get('set-cookie').split(';')[0],account:(await r.json()).account};};
  const a=await login('a'),b=await login('b'),n=await login('n');const store=new Store(dir);await store.init();const ident=await identity(store);let replay;
  const transport=new Transport({url:'http://127.0.0.1:1',identity:ident,allowHttp:true,fetchImpl:async(url,options)=>{replay={url:'http://localhost'+new URL(url).pathname,options};return worker.fetch(replay.url,options);}});
  await t.test('anonymous/nondeveloper/browser origin and cryptographic proofs fail closed',async()=>{
    assert.equal((await request('/api/dev-manager')).status,401);assert.equal((await request('/api/dev-manager',{cookie:n.cookie})).status,403);
    await transport.call('/api/dev-manager/register',{id:ident.id,key:ident.key,code_hash:await digest(ident.code)});
    assert.equal((await request('/api/dev-manager/pair',{cookie:a.cookie,method:'POST',origin:'https://evil.example',body:{id:ident.id,code:ident.code}})).status,403);
    assert.equal((await request('/api/dev-manager/pair',{cookie:a.cookie,method:'POST',body:{id:ident.id,code:'wrong'}})).status,409);
    assert.equal((await request('/api/dev-manager/pair',{cookie:a.cookie,method:'POST',body:{id:ident.id,code:ident.code}})).status,200);
    assert.equal((await request('/api/dev-manager/pair',{cookie:b.cookie,method:'POST',body:{id:ident.id,code:ident.code}})).status,403);
    await transport.device({op:'poll'});assert.equal((await worker.fetch(replay.url,replay.options)).status,401);
    assert.equal((await worker.fetch(replay.url,{...replay.options,body:JSON.stringify({op:'view'})})).status,401);
  });
  await t.test('a rejected registration replay cannot reset pairing attempts or expiry',async()=>{
    const fresh={...ident,id:crypto.randomUUID()};let registration;
    const client=new Transport({url:'http://127.0.0.1:1',identity:fresh,allowHttp:true,fetchImpl:async(url,options)=>{const target='http://localhost'+new URL(url).pathname;registration={target,options};return worker.fetch(target,options);}});
    await client.call('/api/dev-manager/register',{id:fresh.id,key:fresh.key,code_hash:await digest('bounded-code')});
    const envelope=registration;
    for(let n=0;n<5;n++)assert.equal((await request('/api/dev-manager/pair',{cookie:a.cookie,method:'POST',body:{id:fresh.id,code:'wrong'}})).status,409);
    const inspect=async()=>JSON.parse((await(await request('/test/inspect')).json())[0].value).devices[fresh.id];
    const before=await inspect();assert.equal(before.attempts,5);
    assert.equal((await worker.fetch(envelope.target,envelope.options)).status,401);
    const after=await inspect();assert.equal(after.attempts,5);assert.equal(after.expires_at,before.expires_at);
    assert.equal((await request('/api/dev-manager/pair',{cookie:a.cookie,method:'POST',body:{id:fresh.id,code:'bounded-code'}})).status,409);
  });
  let task;
  await t.test('typed fixture is idempotent, reports are source-correlated, and artifact storage is private',async()=>{
    const input={id:crypto.randomUUID(),manager_id:ident.id,source_commit:'6dc3a480c254b9a07ba6979ada68bc9ec992539f',limits:{wall_ms:300000,job_wall_ms:60000,max_jobs:3,max_sandboxes:2,model_calls:0}};
    const r=await request('/api/dev-manager/tasks',{cookie:a.cookie,method:'POST',body:input});assert.equal(r.status,202);task=await r.json();assert.equal((await request('/api/dev-manager/tasks',{cookie:a.cookie,method:'POST',body:input})).status,202);
    const poll=await transport.device({op:'poll'});assert.equal(poll.commands.length,1);const command=poll.commands[0];
    await transport.device({op:'report',report:{command_id:command.id,sequence:1,phase:'creating'}});
    const bytes=Buffer.from('public retained source');const sha256=await digest(bytes);await transport.device({op:'artifact',task_id:task.id,kind:'source',sha256,data:bytes.toString('base64url')});
    const route=`/api/dev-manager/tasks/${task.id}/artifacts/${sha256}`;
    assert.equal((await request(route,{cookie:b.cookie})).status,403);const own=await request(route,{cookie:a.cookie});assert.equal(own.status,200);assert.equal(await own.text(),bytes.toString());
    const storage=await(await request('/test/inspect')).text();assert.equal(storage.includes(ident.private_key.d),false);assert.equal(storage.includes(ident.code),false);
  });
  await t.test('paired manager, session, task and R2 artifact survive actual workerd restart',async()=>{
    await worker.stop();await start();const data=await transport.device({op:'poll'});assert.equal(data.owner,a.account.id);assert.equal(data.tasks[0].id,task.id);
    const snapshot=await(await request('/api/dev-manager',{cookie:a.cookie})).json();assert.equal(snapshot.managers[0].id,ident.id);assert.equal(snapshot.tasks[0].artifacts.length,1);
    await request('/api/dev-manager/revoke',{cookie:a.cookie,method:'POST',body:{id:ident.id}});await assert.rejects(transport.device({op:'poll'}),/pairing_required/);await transport.call('/api/dev-manager/register',{id:ident.id,key:ident.key,code_hash:await digest('new-code')});await assert.rejects(transport.device({op:'poll'}),/pairing_required/);assert.equal((await request('/api/dev-manager/pair',{cookie:a.cookie,method:'POST',body:{id:ident.id,code:'new-code'}})).status,200);assert.equal((await transport.device({op:'poll'})).owner,a.account.id);
  });
});
