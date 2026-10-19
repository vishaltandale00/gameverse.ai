import {principal} from './phone-sign-in.js';
import {assert,canonical,publicKey,digest,signatureInput,UUID} from '../../src/dev-manager-protocol.js';
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(value,status=200)=>Response.json(value,{status,headers});
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function body(request){const reader=request.body?.getReader();if(!reader)return new Uint8Array();let size=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();assert(false,'request_too_large',413);}chunks.push(value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}return bytes;}
async function verify(request,bytes,key,id){const time=request.headers.get('X-Gameverse-Time'),nonce=request.headers.get('X-Gameverse-Nonce'),signature=request.headers.get('X-Gameverse-Signature');
  assert(UUID.test(id)&&/^[0-9]{13}$/.test(time||'')&&/^[a-f0-9]{32}$/.test(nonce||'')&&/^[A-Za-z0-9_-]{86}$/.test(signature||''),'invalid_signature',401);
  assert(Math.abs(Date.now()-Number(time))<=60000,'signature_expired',401);const url=new URL(request.url);
  const imported=await crypto.subtle.importKey('jwk',publicKey(key),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const ok=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},imported,decode(signature),new TextEncoder().encode(signatureInput(id,time,nonce,request.method,url.pathname+url.search,await digest(bytes))));
  assert(ok,'invalid_signature',401);return {time,nonce};}
export async function devManagerRoute(request,env){const url=new URL(request.url);if(!url.pathname.startsWith('/api/dev-manager'))return null;
  try{
    assert(env.DEV_MANAGERS,'manager_setup_required',503);const registry=env.DEV_MANAGERS.getByName('shared-daytona-development');
    if(url.pathname==='/api/dev-manager/register'&&request.method==='POST'){
      const rate=env.IDENTITY?.getByName('manager-register-rate:'+await digest(request.headers.get('CF-Connecting-IP')||'unknown'));if(rate)assert(await rate.takeRateLimit(20,60000),'registration_rate_limit',429);
      const bytes=await body(request),input=JSON.parse(new TextDecoder().decode(bytes));const auth=await verify(request,bytes,input.key,input.id);
      const value=await registry.register(input);await registry.nonce(input.id,auth.nonce,auth.time);return json(value);}
    if(url.pathname==='/api/dev-manager/device'&&request.method==='POST'){
      const bytes=await body(request),id=request.headers.get('X-Gameverse-Manager'),device=await registry.device(id);
      const auth=await verify(request,bytes,device.key,id);await registry.nonce(id,auth.nonce,auth.time);await registry.authorize(id);
      const input=JSON.parse(new TextDecoder().decode(bytes));
      if(input.op==='poll')return json(await registry.poll(id));
      if(input.op==='view')return json(await registry.view(device.owner));
      if(input.op==='submit')return json(await registry.submit(device.owner,{...input.task,manager_id:id}),202);
      if(input.op==='cancel')return json(await registry.cancel(device.owner,input.id,input.confirmation),202);
      if(input.op==='inventory')return json(await registry.sync(id,input.entries));
      if(input.op==='report')return json(await registry.report(id,input.report));
      if(input.op==='artifact'){
        const payload=decode(input.data||'');assert(payload.length>0&&payload.length<=32768,'invalid_artifact');assert(await digest(payload)===input.sha256,'digest_mismatch',422);
        // Validate authorization/conflict before private R2 I/O, and revalidate after yielding.
        await registry.artifact(id,input.task_id,{sha256:input.sha256,kind:input.kind,bytes:payload.length},false);
        await env.ARTIFACTS.put(`development/${input.task_id}/${input.sha256}`,payload,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:input.kind==='result'?'application/json':'text/plain'}});
        await registry.authorize(id);await registry.artifact(id,input.task_id,{sha256:input.sha256,kind:input.kind,bytes:payload.length});return json({stored:true});}
      return json({error:{code:'invalid_operation'}},400);
    }
    const account=await principal(request,env);assert(account,'sign_in_required',401);assert(account.developer,'developer_invitation_required',403);
    if(request.method!=='GET')assert(request.headers.get('Origin')===url.origin,'origin_rejected',403);
    if(url.pathname==='/api/dev-manager'&&request.method==='GET')return json(await registry.view(account.id));
    const input=request.method==='POST'?JSON.parse(new TextDecoder().decode(await body(request))):{};
    if(url.pathname==='/api/dev-manager/pair'&&request.method==='POST')return json(await registry.pair(account.id,input.id,await digest(String(input.code||''))));
    if(url.pathname==='/api/dev-manager/revoke'&&request.method==='POST')return json(await registry.revoke(account.id,input.id));
    if(url.pathname==='/api/dev-manager/tasks'&&request.method==='POST')return json(await registry.submit(account.id,input),202);
    if(url.pathname==='/api/dev-manager/cancel'&&request.method==='POST')return json(await registry.cancel(account.id,input.id,input.confirmation),202);
    if(url.pathname==='/api/dev-manager/manage'&&request.method==='POST')return json(await registry.manage(account.id,input),202);
    const match=url.pathname.match(/^\/api\/dev-manager\/tasks\/([a-f0-9-]{36})\/artifacts\/([a-f0-9]{64})$/);
    if(match&&request.method==='GET'){const task=await registry.task(match[1]);assert(task.owner===account.id,'artifact_access_denied',403);assert(task.artifacts.some(a=>a.sha256===match[2]),'artifact_not_found',404);
      const object=await env.ARTIFACTS.get(`development/${task.id}/${match[2]}`);assert(object,'artifact_not_found',404);return new Response(object.body,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':'attachment'}});}
    return json({error:{code:'not_found'}},404);
  }catch(error){const code=/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:'manager_operation_failed';return json({error:{code}},error.status||409);}
}
