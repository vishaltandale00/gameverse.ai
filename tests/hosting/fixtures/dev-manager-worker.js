import {HostedVoiceState as HostedBase} from '../../../infra/cloudflare/hosted-voice-state.js';
import {voiceCapability} from '../../../infra/cloudflare/browser-voice-api.js';
import {principal} from '../../../infra/cloudflare/phone-sign-in.js';
export class HostedVoiceState extends HostedBase { inspect(){return this.core.state;} launchToken(id){return voiceCapability(this.env,this.core.task(id));} async tick(){await this.alarm();return this.core.state;} }
import {scriptedVoiceProvider} from './voice-test-provider.js';
// Synthetic local qualification entrypoint. Never deploy this login bypass.
import worker from '../../../infra/cloudflare/worker.js';
export {ProjectState,AgentConnections,AccountJobs,SandboxAdmission} from '../../../infra/cloudflare/worker.js';
export {IdentityState} from '../../../infra/cloudflare/identity-state.js';
import {DevManagerState as Base} from '../../../infra/cloudflare/dev-manager-state.js';
import {sha256} from '../../../infra/cloudflare/phone-sign-in.js';
export class DevManagerState extends Base { inspect(){return this.sql.exec('SELECT value FROM registry WHERE id=1').toArray();} }
export default {async fetch(request,env){const url=new URL(request.url);
  if(env.APP_ENV==='test'&&env.VOICE_BROWSER_COLLECTION==='1'&&url.pathname==='/games/configs/gameverse-v1.json')return Response.json({schemaVersion:1,id:'gameverse',version:'v1',title:'Gameverse voice qualification',base:{kind:'collection',entryPath:'/v1'},subgames:[{id:'soccer',catalogId:'soccer',adapter:'gameverse-custom-sports/1.0.0'}]});
  if(env.APP_ENV==='test'&&url.pathname.startsWith('/test/login/')){
    const actor=url.pathname.split('/').pop(),phone={a:'+12025550101',b:'+12025550102',n:'+12025550103'}[actor];if(!phone)return new Response('invalid fixture actor',{status:400});
    const key=await crypto.subtle.importKey('raw',Uint8Array.from(env.ACCOUNT_ID_KEY.match(/../g),x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const account={id:'phone:'+Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(phone))),b=>b.toString(16).padStart(2,'0')).join(''),name:actor};
    await env.AGENT_CONNECTIONS.getByName(account.id).initialize(account.id);
    const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
    await env.IDENTITY.getByName('session:'+await sha256(token)).putRecord({kind:'session',account,expires_at:Date.now()+3600000});
    return Response.json({account},{headers:{'Set-Cookie':`__Host-gameverse=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`}});
  }
  if(env.APP_ENV==='test'&&url.pathname.startsWith('/test/hosted/')){const account=await principal(request,env);if(!account)return new Response(null,{status:401});const object=env.HOSTED_VOICE.getByName(account.id);await object.initialize(account.id);const op=url.pathname.split('/').pop();if(op==='inspect')return Response.json(await object.inspect());if(op==='tick')return Response.json(await object.tick());if(op==='token')return Response.json({token:await object.launchToken(url.searchParams.get('id'))});if(op==='reserve-audio'){const args=await request.json(),row=await object.voice('upload',account.id,args,false);await env.ARTIFACTS.put(`voice/${account.id}/${row.task_id}/${row.sha256}`,new TextEncoder().encode('pending synthetic audio'));return Response.json(row);}if(op==='audio'){const state=await object.inspect(),row=state.voice.requests[url.searchParams.get('id')];if(!row)return new Response(null,{status:404});const audio=await env.ARTIFACTS.get(`voice/${account.id}/${row.task_id}/${row.sha256}`);return audio?new Response(audio.body,{headers:{'Content-Type':row.mime}}):new Response(null,{status:404});}}
  if(env.APP_ENV==='test'&&url.pathname==='/test/context')return Response.json({origin:url.origin,header:request.headers.get('Origin')});
  if(env.APP_ENV==='test'&&url.pathname==='/test/inspect')return Response.json(await env.DEV_MANAGERS.getByName('shared-daytona-development').inspect());
  return worker.fetch(request,env.VOICE_AGENT_ENABLED==='1'||env.HOSTED_VOICE_ENABLED==='1'?{...env,VOICE_TEST_PROVIDER:scriptedVoiceProvider,VERIFY_API_KEY_TEST:async(provider,key)=>{if(provider!=='codex'||!key.startsWith('sk-hosted-fixture-'))throw Error('provider_authentication_failed');}}:env);
}};
