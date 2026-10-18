import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV='false';
process.env.WRANGLER_SEND_METRICS='false';
process.env.WRANGLER_LOG_PATH=join(tmpdir(),'gameverse-phone-test-wrangler.log');
const { unstable_dev }=await import('wrangler');
const challengeCookie=response=>response.headers.get('set-cookie')?.match(/__Host-gameverse-phone=([0-9a-f]{64})/)?.[0];
const sessionCookie=response=>response.headers.get('set-cookie')?.match(/__Host-gameverse=([0-9a-f]{64})/)?.[0];

test('phone verification binds accounts to one-time browser proofs and isolates retained requests', {timeout:60000},async t=>{
  const state=await mkdtemp(join(tmpdir(),'gameverse-phone-'));
  const verifications=new Map();let sends=0,checks=0;
  const sms=http.createServer(async(req,res)=>{
    let body='';for await(const bytes of req)body+=bytes;
    const input=new URLSearchParams(body);res.setHeader('Content-Type','application/json');
    if(req.url.endsWith('/Verifications')){
      sends++;const sid='VE'+randomUUID().replaceAll('-','');verifications.set(sid,input.get('To'));
      res.end(JSON.stringify({sid,to:input.get('To'),status:'pending'}));return;
    }
    checks++;const sid=input.get('VerificationSid');
    // Yield so concurrent correct-code requests overlap at the provider boundary.
    await new Promise(resolve=>setTimeout(resolve,15));
    res.end(JSON.stringify({sid,status:verifications.has(sid)&&input.get('Code')==='123456'?'approved':'pending'}));
  });
  await new Promise(resolve=>sms.listen(0,'127.0.0.1',resolve));
  const vars={APP_ENV:'test',STAGING_API_TOKEN:'fixture-admin-token-with-32-or-more-characters',DAYTONA_API_KEY:'fake-not-used',
    ACCOUNT_ID_KEY:'11'.repeat(32),AGENT_CREDENTIAL_KEY:'22'.repeat(32),TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),
    TWILIO_AUTH_TOKEN:'fixture-only',TWILIO_VERIFY_SERVICE_SID:'VA'+'2'.repeat(32),
    GAMEVERSE_PILOT_PHONES:'+12025550101,+12025550102',GAMEVERSE_DEVELOPER_PHONES:'+12025550101',
    VERIFY_TEST_URL:`http://127.0.0.1:${sms.address().port}`};
  let worker;
  const start=async()=>{worker=await unstable_dev('infra/cloudflare/worker.js',{
    config:'tests/hosting/fixtures/wrangler.platform.jsonc',local:true,ip:'127.0.0.1',port:0,persistTo:state,vars,
    logLevel:'error',inspect:false,experimental:{disableExperimentalWarning:true,disableDevRegistry:true,watch:false}});};
  t.after(async()=>{await worker?.stop();await new Promise(resolve=>sms.close(resolve));await rm(state,{recursive:true,force:true});});
  await start();
  const request=(path,{method='GET',body,cookie,origin='http://localhost'}={})=>worker.fetch('http://localhost'+path,
    {method,headers:{...(cookie?{Cookie:cookie}:{}),...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'})},...(body?{body:JSON.stringify(body)}:{})});
  const send=phone=>request('/api/auth/phone/start',{method:'POST',body:{phone}});
  const check=(cookie,code='123456')=>request('/api/auth/phone/check',{method:'POST',cookie,body:{code}});
  let sessionA,sessionB,accountA,jobId;

  await t.test('anonymous access, origin, phone format and pilot allowlist fail closed',async()=>{
    assert.equal((await request('/api/agent-connections')).status,401);
    assert.equal((await request('/api/jobs')).status,401);
    assert.equal((await request('/api/auth/phone/start',{method:'POST',origin:'https://attacker.example',body:{phone:'+12025550101'}})).status,403);
    assert.equal((await send('2025550101')).status,400);
    assert.equal((await send('+12025550999')).status,403);
    assert.equal(sends,0);
    assert.equal((await check(undefined)).status,401);
  });
  await t.test('an approved verification creates a secure session with a private stable identity',async()=>{
    const sent=await send('+12025550101');assert.equal(sent.status,200,JSON.stringify({body:await sent.clone().text(),sends,checks}));
    assert.match(sent.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
    assert.ok(!JSON.stringify(await sent.json()).includes('+12025550101'));
    const challenge=challengeCookie(sent);assert.ok(challenge);
    const verified=await check(challenge);assert.equal(verified.status,200);sessionA=sessionCookie(verified);assert.ok(sessionA);
    accountA=(await (await request('/api/me',{cookie:sessionA})).json()).account;
    assert.match(accountA.id,/^phone:[0-9a-f]{64}$/);assert.equal(accountA.developer,true);
    assert.ok(!JSON.stringify(accountA).includes('+12025550101'));
    const before=checks;assert.equal((await check(challenge)).status,401);assert.equal(checks,before);
    assert.deepEqual((await (await request('/api/agent-connections',{cookie:sessionA})).json()).connections,[]);
  });
  await t.test('a pending request is durable, pinned and idempotent before connecting',async()=>{
    jobId=randomUUID();const body={request_id:jobId,intent:'Keep this exact request through login',provider:'claude'};
    const responses=await Promise.all(Array.from({length:3},()=>request('/api/jobs',{method:'POST',cookie:sessionA,body})));
    for(const response of responses){assert.equal(response.status,202);const row=await response.json();assert.equal(row.phase,'awaiting_connection');assert.equal(row.intent,body.intent);assert.equal(row.baseline,'addition-todo/1');assert.equal(row.provider,'claude');}
    assert.equal((await (await request('/api/jobs',{cookie:sessionA})).json()).jobs.length,1);
    assert.equal((await request('/api/jobs',{method:'POST',cookie:sessionA,body:{...body,intent:'Retargeted'}})).status,409);
  });
  await t.test('a second phone has separate connections and cannot access another account’s job or developer operations',async()=>{
    const sent=await send('+12025550102');const verified=await check(challengeCookie(sent));sessionB=sessionCookie(verified);assert.ok(sessionB);
    const accountB=(await (await request('/api/me',{cookie:sessionB})).json()).account;
    assert.notEqual(accountB.id,accountA.id);assert.equal(accountB.developer,false);
    assert.equal((await request(`/api/jobs/${jobId}`,{cookie:sessionB})).status,404);
    assert.equal((await request('/api/jobs',{method:'POST',cookie:sessionB,body:{request_id:randomUUID(),provider:'claude',intent:'forged developer'}})).status,403);
    assert.equal((await request('/api/agent-connections/claude/browser',{method:'POST',cookie:sessionB,body:{request_id:randomUUID()}})).status,403);
    assert.equal((await request('/api/agent-connections/claude/default',{method:'POST',cookie:sessionA,origin:'https://attacker.example',body:{}})).status,403);
  });
  await t.test('incorrect codes exhaust a challenge after five checks',async()=>{
    const sent=await send('+12025550101'),cookie=challengeCookie(sent),before=checks;
    for(let i=0;i<5;i++)assert.equal((await check(cookie,'000000')).status,401);
    assert.equal((await check(cookie)).status,401);assert.equal(checks-before,5);
  });
  await t.test('concurrent correct-code submissions create at most one session',async()=>{
    const sent=await send('+12025550101'),cookie=challengeCookie(sent),before=checks;
    const responses=await Promise.all([check(cookie),check(cookie)]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,401]);assert.equal(checks-before,1);
    const extra=await send('+12025550101');assert.equal(extra.status,429);assert.equal(sends,4);
  });
  await t.test('sessions and requests survive a real runtime restart; logout revokes only the selected session',async()=>{
    await worker.stop();worker=undefined;await start();
    assert.deepEqual((await (await request('/api/me',{cookie:sessionA})).json()).account,accountA);
    assert.equal((await (await request(`/api/jobs/${jobId}`,{cookie:sessionA})).json()).intent,'Keep this exact request through login');
    assert.equal((await request('/api/auth/logout',{method:'POST',cookie:sessionA,body:{}})).status,200);
    assert.equal((await (await request('/api/me',{cookie:sessionA})).json()).account,null);
    assert.ok((await (await request('/api/me',{cookie:sessionB})).json()).account);
  });
});
