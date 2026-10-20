import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { runtimeRoot,authPath,cliVersion } from '../../infra/cloudflare/claude-runtime.js';

process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV='false';
process.env.WRANGLER_SEND_METRICS='false';
process.env.WRANGLER_LOG_PATH=join(tmpdir(),'gameverse-jobs-test-wrangler.log');
const { unstable_dev }=await import('wrangler');
const digest=value=>createHash('sha256').update(value).digest('hex');
const cookie=(response,name)=>response.headers.get('set-cookie')?.match(new RegExp(name+'=([0-9a-f]{64})'))?.[0];

test('durable browser connection and disposable coding lifecycle with uncertain responses', {timeout:60000},async t=>{
  const state=await mkdtemp(join(tmpdir(),'gameverse-jobs-'));
  const sandboxes=new Map();let creates=0,deletes=0,holdJobs=false,dropCreate=true,dropDelete=true,base;
  const uploadedCredentials=[];let loginCodeUploads=0;
  const provider=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');const parts=[];for await(const part of req)parts.push(part);
    const bytes=Buffer.concat(parts);const reply=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(value));};
    if(url.pathname.endsWith('/Verifications')){const body=new URLSearchParams(bytes.toString());reply({sid:'VE'+'3'.repeat(32),to:body.get('To'),status:'pending'});return;}
    if(url.pathname.endsWith('/VerificationCheck')){reply({sid:'VE'+'3'.repeat(32),status:'approved'});return;}
    if(url.pathname==='/sandbox'&&req.method==='POST'){
      creates++;const body=JSON.parse(bytes.toString()),id=randomUUID();
      const dto={id,name:body.name,state:'started',cpu:1,memory:1,disk:3,toolboxProxyUrl:base+'/toolbox'};
      sandboxes.set(body.name,{dto,files:new Map()});
      if(dropCreate){dropCreate=false;res.destroy();return;}reply(dto);return;
    }
    const sandboxRoute=url.pathname.match(/^\/sandbox\/([^/]+)$/);
    if(sandboxRoute){const name=decodeURIComponent(sandboxRoute[1]),sandbox=sandboxes.get(name);
      if(!sandbox){reply({},404);return;}
      if(req.method==='DELETE'){deletes++;sandboxes.delete(name);if(dropDelete){dropDelete=false;res.destroy();return;}reply({});return;}
      reply(sandbox.dto);return;
    }
    const route=url.pathname.match(/^\/toolbox\/([^/]+)(\/.*)$/);
    const sandbox=route&&[...sandboxes.values()].find(s=>s.dto.id===route[1]);
    if(!sandbox){reply({},404);return;}
    if(route[2]==='/files/upload-v2'){
      const form=await new Response(bytes,{headers:{'Content-Type':req.headers['content-type']}}).formData();
      const file=Buffer.from(await form.get('file').arrayBuffer()),path=url.searchParams.get('path');sandbox.files.set(path,file);
      if(path===authPath)uploadedCredentials.push(JSON.parse(file.toString()).claudeAiOauth.accessToken);
      if(path===runtimeRoot+'/login-code'){
        loginCodeUploads++;await new Promise(resolve=>setTimeout(resolve,35));
        sandbox.files.set(authPath,Buffer.from(JSON.stringify({claudeAiOauth:{accessToken:'fixture-initial-auth'}})));
        // Keep the old authorization URL in runtime status until the host has
        // observed verification. Polling must not restore a submitted-code form.
      }
      reply({});return;
    }
    if(route[2]==='/files/download'){
      const file=sandbox.files.get(url.searchParams.get('path'));if(!file){reply({},404);return;}
      res.writeHead(200,{'Content-Type':'application/octet-stream'}).end(file);return;
    }
    if(route[2]==='/process/execute'){
      const {command}=JSON.parse(bytes.toString());
      if(command.includes('runtime.mjs connect'))sandbox.files.set(runtimeRoot+'/status.json',Buffer.from(JSON.stringify({phase:'awaiting_authorization',auth_url:'https://claude.ai/oauth/authorize?fixture=true'})));
      const job=command.match(/runtime\.mjs job ([0-9a-f-]{36})/);
      if(job){
        if(holdJobs)sandbox.files.set(runtimeRoot+'/status.json',Buffer.from(JSON.stringify({phase:'running'})));
        else {
          const source=Buffer.from('def add(a, b):\n    return a + b\n');
          sandbox.files.set(runtimeRoot+'/work/calculator.py',source);
          sandbox.files.set(runtimeRoot+'/result.json',Buffer.from(JSON.stringify({schema:'gameverse.connected-agent-probe/1',run_id:job[1],success:true,
            checks:{source_changed:true,addition_cases_passed:true},source_sha256:digest(source),cli_version:cliVersion,num_turns:1,reported_cost_usd:null,started_at:Date.now()-10,finished_at:Date.now()})));
          sandbox.files.set(runtimeRoot+'/status.json',Buffer.from(JSON.stringify({phase:'finished',success:true})));
          sandbox.files.set(authPath,Buffer.from(JSON.stringify({claudeAiOauth:{accessToken:'fixture-refreshed-auth'}})));
        }
      }
      reply({exitCode:0,result:''});return;
    }
    reply({},404);
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${provider.address().port}`;
  let worker;
  t.after(async()=>{await worker?.stop();await new Promise(resolve=>provider.close(resolve));await rm(state,{recursive:true,force:true});});
  worker=await unstable_dev('infra/cloudflare/worker.js',{config:'tests/hosting/fixtures/wrangler.platform.jsonc',
    local:true,ip:'127.0.0.1',port:0,persistTo:state,logLevel:'error',inspect:false,
    experimental:{disableExperimentalWarning:true,disableDevRegistry:true,watch:false},
    vars:{APP_ENV:'test',HOST_RECONCILE_MS:'25',DAYTONA_API_KEY:'fixture-not-real',DAYTONA_API_URL:base,
      TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'fixture-only',TWILIO_VERIFY_SERVICE_SID:'VA'+'2'.repeat(32),
      ACCOUNT_ID_KEY:'11'.repeat(32),AGENT_CREDENTIAL_KEY:'22'.repeat(32),VERIFY_TEST_URL:base,
      GAMEVERSE_PILOT_PHONES:'+12025550101,+12025550102',GAMEVERSE_DEVELOPER_PHONES:'+12025550101,+12025550102'}});
  const request=(path,session,method='GET',body)=>worker.fetch('http://localhost'+path,{method,headers:{Origin:'http://localhost',
    ...(session?{Cookie:session}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const call=async(path,session,method='GET',body)=>{const response=await request(path,session,method,body);const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
  const signIn=async phone=>{const sent=await request('/api/auth/phone/start',null,'POST',{phone});assert.equal(sent.status,200);
    const verified=await request('/api/auth/phone/check',cookie(sent,'__Host-gameverse-phone'),'POST',{code:'123456'});assert.equal(verified.status,200);return cookie(verified,'__Host-gameverse');};
  const waitFor=async(id,session,predicate)=>{
    const deadline=Date.now()+10000;let row;
    while(Date.now()<deadline){row=await call('/api/jobs/'+id,session);if(predicate(row))return row;await new Promise(resolve=>setTimeout(resolve,30));}
    assert.fail('Operation did not reach expected state: '+JSON.stringify(row));
  };
  const a=await signIn('+12025550101'),b=await signIn('+12025550102');
  const pendingId=randomUUID();
  await t.test('request waits without allocating; uncertain login allocation is reconciled once',async()=>{
    const job=await call('/api/jobs',a,'POST',{request_id:pendingId,intent:'Preserve this intent and baseline',provider:'claude'});
    assert.equal(job.phase,'awaiting_connection');assert.equal(creates,0);
    const connect=await call('/api/agent-connections/claude/browser',a,'POST',{request_id:randomUUID()});
    const login=await waitFor(connect.id,a,row=>!!row.auth_url);
    assert.equal(login.auth_url,'https://claude.ai/oauth/authorize?fixture=true');assert.equal(creates,1);
    const second=await call('/api/agent-connections/claude/browser',b,'POST',{request_id:randomUUID()});
    await call('/api/jobs/'+second.id+'/cancel',b,'POST');
    assert.equal((await waitFor(second.id,b,row=>row.phase==='cancelled')).cleanup_confirmed,true);assert.equal(creates,1);
    assert.equal(login.connection_step,'authorize');
    const submissions=await Promise.all([1,2].map(()=>call('/api/jobs/'+login.id+'/code',a,'POST',{code:'fixture-authorization-code'})));
    for(const submission of submissions){assert.equal(submission.connection_step,'verifying');assert.equal(submission.auth_url,null);}
    assert.equal(loginCodeUploads,1);
    await new Promise(resolve=>setTimeout(resolve,90));
    const verifying=await call('/api/jobs/'+login.id,a);
    assert.equal(verifying.connection_step,'verifying');assert.equal(verifying.auth_url,null);
    sandboxes.get(`gv-${login.id}`).files.set(runtimeRoot+'/status.json',Buffer.from(JSON.stringify({phase:'authorized'})));
    const completed=await waitFor(pendingId,a,row=>row.phase==='succeeded'||row.phase==='failed'||row.phase==='cleanup_failed');
    assert.equal(completed.phase,'succeeded',JSON.stringify(completed));assert.equal(completed.cleanup_confirmed,true);
    assert.equal(completed.intent,'Preserve this intent and baseline');assert.equal(completed.baseline,'addition-todo/1');
    assert.equal(creates,2);assert.equal(sandboxes.size,0);assert.equal(deletes,2);
  });
  await t.test('retained result is private and a fresh job reuses refreshed credentials',async()=>{
    const result=await call('/api/jobs/'+pendingId+'/result',a);assert.equal(result.success,true);assert.equal(result.hosting_receipt.cleanup_confirmed,true);
    assert.equal((await request('/api/jobs/'+pendingId+'/result',b)).status,404);
    const id=randomUUID();await call('/api/jobs',a,'POST',{request_id:id,provider:'claude',intent:'Fresh sandbox reuse'});
    assert.equal((await waitFor(id,a,row=>row.phase==='succeeded'||row.phase==='failed')).phase,'succeeded');
    assert.deepEqual(uploadedCredentials,['fixture-initial-auth','fixture-refreshed-auth']);assert.equal(creates,3);assert.equal(sandboxes.size,0);
    const settings=await call('/api/agent-connections',a);assert.equal(settings.default_provider,'claude');assert.ok(!JSON.stringify(settings).includes('fixture-refreshed-auth'));
  });
  await t.test('disconnect cancels a running job, deletes its sandbox and prevents another admission',async()=>{
    holdJobs=true;const id=randomUUID();await call('/api/jobs',a,'POST',{request_id:id,provider:'claude',intent:'Cancel during execution'});
    await waitFor(id,a,row=>row.phase==='running');
    await call('/api/agent-connections/claude/disconnect',a,'POST');
    const cancelled=await waitFor(id,a,row=>row.phase==='cancelled');assert.equal(cancelled.cleanup_confirmed,true);assert.equal(cancelled.result_available,false);assert.equal(sandboxes.size,0);
    const waiting=await call('/api/jobs',a,'POST',{request_id:randomUUID(),provider:'claude',intent:'Reconnect before more work'});
    assert.equal(waiting.phase,'awaiting_connection');assert.equal(creates,4);
  });
});
