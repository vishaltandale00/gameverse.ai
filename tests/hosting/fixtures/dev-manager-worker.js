// Synthetic local qualification entrypoint. Never deploy this login bypass.
import worker from '../../../infra/cloudflare/worker.js';
export {ProjectState,AgentConnections,AccountJobs,SandboxAdmission} from '../../../infra/cloudflare/worker.js';
export {IdentityState} from '../../../infra/cloudflare/identity-state.js';
import {DevManagerState as Base} from '../../../infra/cloudflare/dev-manager-state.js';
import {sha256} from '../../../infra/cloudflare/phone-sign-in.js';
export class DevManagerState extends Base { inspect(){return this.sql.exec('SELECT value FROM registry WHERE id=1').toArray();} }
export default {async fetch(request,env){const url=new URL(request.url);
  if(env.APP_ENV==='test'&&url.pathname.startsWith('/test/login/')){
    const actor=url.pathname.split('/').pop(),phone={a:'+12025550101',b:'+12025550102',n:'+12025550103'}[actor];if(!phone)return new Response('invalid fixture actor',{status:400});
    const key=await crypto.subtle.importKey('raw',Uint8Array.from(env.ACCOUNT_ID_KEY.match(/../g),x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const account={id:'phone:'+Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(phone))),b=>b.toString(16).padStart(2,'0')).join(''),name:actor};
    await env.AGENT_CONNECTIONS.getByName(account.id).initialize(account.id);
    const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
    await env.IDENTITY.getByName('session:'+await sha256(token)).putRecord({kind:'session',account,expires_at:Date.now()+3600000});
    return Response.json({account},{headers:{'Set-Cookie':`__Host-gameverse=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`}});
  }
  if(env.APP_ENV==='test'&&url.pathname==='/test/context')return Response.json({origin:url.origin,header:request.headers.get('Origin')});
  if(env.APP_ENV==='test'&&url.pathname==='/test/inspect')return Response.json(await env.DEV_MANAGERS.getByName('shared-daytona-development').inspect());
  return worker.fetch(request,env);
}};
