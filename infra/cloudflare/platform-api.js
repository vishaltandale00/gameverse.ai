import {voiceCredentialSource} from './hosted-voice-funding.js';
import { phoneSignInRoute,phoneConfigured,principal } from './phone-sign-in.js';

const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const error=(code,status)=>json({error:{code}},status);
async function readJson(request) {
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error('invalid_request');
  const reader=request.body?.getReader();if(!reader)throw Error('invalid_request');
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
    if(size>65536){await reader.cancel();throw Error('invalid_request');}chunks.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('invalid_request');}
}
async function verifyApiKey(provider,key,env) {
  if(typeof key!=='string'||!key.startsWith('sk-')||key.length<20||key.length>2048)throw Error('invalid_api_key');
  if(env.APP_ENV==='test'&&typeof env.VERIFY_API_KEY_TEST==='function'){await env.VERIFY_API_KEY_TEST(provider,key);return;}
  const url=provider==='claude'?'https://api.anthropic.com/v1/models?limit=1':'https://api.openai.com/v1/models';
  const headers=provider==='claude'?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{Authorization:`Bearer ${key}`};
  const response=await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(10000)});
  await response.body?.cancel();if(!response.ok)throw Error('provider_authentication_failed');
}
export async function platformRoute(request,env) {
  const url=new URL(request.url);
  const auth=await phoneSignInRoute(request,env);if(auth)return auth;
  if(url.pathname==='/api/auth/config'&&request.method==='GET')return json({sign_in:{method:'phone',configured:phoneConfigured(env),default_country:/^[A-Z]{2}$/.test(request.cf?.country||'')?request.cf.country:null},
    pilot:true,hosted_voice:env.HOSTED_VOICE_ENABLED==='1',voice_credentials:voiceCredentialSource(env),providers:{claude:{browser:true,api_key:true,job_enabled:true},codex:{browser:false,api_key:true,job_enabled:false,
      reason:'Hosted ChatGPT connection requires a registered Sign in with ChatGPT client.'}}});
  if(!/^\/api\/(me$|agent-connections(?:\/|$)|jobs(?:\/|$))/.test(url.pathname))return null;
  const account=await principal(request,env);
  if(url.pathname==='/api/me'&&request.method==='GET')return json({account});
  if(!account)return error('sign_in_required',401);
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('Origin')!==url.origin)return error('origin_rejected',403);
  const connections=env.AGENT_CONNECTIONS.getByName(account.id);
  const jobs=env.ACCOUNT_JOBS.getByName(account.id);await jobs.initialize(account.id);
  if(url.pathname==='/api/agent-connections'&&request.method==='GET')return json(await connections.getConnections());
  const action=url.pathname.match(/^\/api\/agent-connections\/(codex|claude)\/(default|disconnect|browser|api-key)$/);
  if(action&&request.method==='POST') {
    const [,provider,operation]=action;
    if(operation==='default')return json(await connections.setDefault(provider));
    if(operation==='disconnect')return json(await jobs.disconnect(provider));
    if(operation==='browser'){
      if(!account.developer)return error('developer_invitation_required',403);
      if(provider!=='claude')return error('registered_chatgpt_client_required',409);
      const body=await readJson(request);return json(await jobs.requestConnection(body.request_id),202);
    }
    const body=await readJson(request);await verifyApiKey(provider,body.key,env);
    const login=await connections.startConnection(provider,'api-key');
    const settings=await connections.completeConnection(provider,login.login_id,body.key);
    await jobs.continuePending();return json(settings);
  }
  if(url.pathname==='/api/jobs'){
    if(request.method==='GET')return json({jobs:await jobs.list()});
    if(request.method==='POST'){
      if(!account.developer)return error('developer_invitation_required',403);
      const body=await readJson(request);return json(await jobs.requestJob(body.request_id,body.intent,body.provider),202);
    }
  }
  const job=url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})(?:\/(cancel|code|result))?$/);
  if(job){
    if(!job[2]&&request.method==='GET'){const row=await jobs.get(job[1]);return row?json(row):error('job_not_found',404);}
    if(job[2]==='result'&&request.method==='GET'){const result=await jobs.result(job[1]);return result?json(result):error('result_not_found',404);}
    if(job[2]==='cancel'&&request.method==='POST'){const row=await jobs.cancel(job[1]);return row?json(row):error('job_not_found',404);}
    if(job[2]==='code'&&request.method==='POST'){
      if(!account.developer)return error('developer_invitation_required',403);
      const body=await readJson(request);return json(await jobs.submitLoginCode(job[1],body.code));
    }
  }
  return error('not_found',404);
}
