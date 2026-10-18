const encoder=new TextEncoder();
const sessionCookie='__Host-gameverse', challengeCookie='__Host-gameverse-phone';
const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
export const randomToken=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha256=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
const cookie=(name,value,age)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const readCookie=(request,name)=>{
  const values=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(`${name}=`));
  return values.length===1&&/^[0-9a-f]{64}$/.test(values[0].slice(name.length+1))?values[0].slice(name.length+1):null;
};
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(body,status=200,setCookie)=>Response.json(body,{status,headers:{...headers,...(setCookie?{'Set-Cookie':setCookie}:{})}});
const error=(code,status)=>json({error:{code}},status);
const numbers=value=>(value||'').split(',').map(x=>x.trim()).filter(Boolean);
export const validPhone=value=>typeof value==='string'&&/^\+[1-9][0-9]{7,14}$/.test(value);
export function phoneConfigured(env) {
  return /^AC[0-9a-fA-F]{32}$/.test(env.TWILIO_ACCOUNT_SID||'')&&!!env.TWILIO_AUTH_TOKEN
    &&/^VA[0-9a-fA-F]{32}$/.test(env.TWILIO_VERIFY_SERVICE_SID||'')
    &&/^[0-9a-f]{64}$/.test(env.ACCOUNT_ID_KEY||'')&&numbers(env.GAMEVERSE_PILOT_PHONES).some(validPhone);
}
async function accountId(phone,env) {
  if(!/^[0-9a-f]{64}$/.test(env.ACCOUNT_ID_KEY||''))throw Error('account_key_not_configured');
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(env.ACCOUNT_ID_KEY.match(/../g),v=>parseInt(v,16)),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  return `phone:${hex(await crypto.subtle.sign('HMAC',key,encoder.encode(phone)))}`;
}
export async function developerAccount(id,env) {
  const ids=await Promise.all(numbers(env.GAMEVERSE_DEVELOPER_PHONES).filter(validPhone).map(p=>accountId(p,env)));
  return ids.includes(id);
}
export async function principal(request,env) {
  const token=readCookie(request,sessionCookie);if(!token)return null;
  const session=await env.IDENTITY.getByName(`session:${await sha256(token)}`).readSession();
  if(!session)return null;
  const admitted=await Promise.all(numbers(env.GAMEVERSE_PILOT_PHONES).filter(validPhone).map(p=>accountId(p,env)));
  return admitted.includes(session.account.id)?{...session.account,developer:await developerAccount(session.account.id,env)}:null;
}
async function readJson(request) {
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return null;
  const reader=request.body?.getReader();if(!reader)return null;
  let text='',length=0;const decoder=new TextDecoder();
  try {
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;
      if(length>4096){await reader.cancel();return null;}text+=decoder.decode(value,{stream:true});}
    text+=decoder.decode();return JSON.parse(text);
  }catch{return null;}finally{reader.releaseLock();}
}
async function verifyApi(env,path,body) {
  const base=env.APP_ENV==='test'&&env.VERIFY_TEST_URL?env.VERIFY_TEST_URL:'https://verify.twilio.com/v2';
  if(base!=='https://verify.twilio.com/v2'&&!(env.APP_ENV==='test'&&/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(base)))throw Error('untrusted_verify_endpoint');
  const response=await fetch(`${base}/Services/${env.TWILIO_VERIFY_SERVICE_SID}/${path}`,{method:'POST',redirect:'manual',
    headers:{Authorization:`Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams(body),signal:AbortSignal.timeout(10000)});
  if(!response.ok){await response.body?.cancel();throw Error('phone_provider_unavailable');}
  const bytes=await response.text();if(bytes.length>16384)throw Error('phone_provider_unavailable');
  return JSON.parse(bytes);
}
async function allowedSend(request,phone,env) {
  const ip=request.headers.get('CF-Connecting-IP')||'local-unknown';
  const scopes=[['global',20,86400000],[`number:${await accountId(phone,env)}`,3,600000],
    [`ip:${await accountId(ip,env)}`,5,600000]];
  for(const [scope,limit,window]of scopes)if(!await env.IDENTITY.getByName(`sms-rate:${scope}`).takeRateLimit(limit,window))return false;
  return true;
}
export async function phoneSignInRoute(request,env) {
  const url=new URL(request.url);
  if(!['/api/auth/phone/start','/api/auth/phone/check','/api/auth/logout'].includes(url.pathname))return null;
  if(request.method!=='POST')return error('method_not_allowed',405);
  if(request.headers.get('Origin')!==url.origin)return error('origin_rejected',403);
  if(url.pathname==='/api/auth/logout'){
    const token=readCookie(request,sessionCookie);
    if(token)await env.IDENTITY.getByName(`session:${await sha256(token)}`).revoke();
    return json({signed_out:true},200,cookie(sessionCookie,'',0));
  }
  if(!phoneConfigured(env))return error('phone_setup_required',503);
  const input=await readJson(request);if(!input||typeof input!=='object')return error('invalid_request',400);
  if(url.pathname==='/api/auth/phone/start'){
    if(!validPhone(input.phone))return error('international_phone_required',400);
    if(!numbers(env.GAMEVERSE_PILOT_PHONES).includes(input.phone))return error('pilot_invitation_required',403);
    if(!await allowedSend(request,input.phone,env))return error('try_again_later',429);
    const prior=readCookie(request,challengeCookie);
    if(prior)await env.IDENTITY.getByName(`phone-challenge:${await sha256(prior)}`).revoke();
    try {
      const verification=await verifyApi(env,'Verifications',{To:input.phone,Channel:'sms'});
      if(!/^VE[0-9a-fA-F]{32}$/.test(verification.sid||'')||verification.to!==input.phone||verification.status!=='pending')throw Error('phone_provider_unavailable');
      const token=randomToken();
      await env.IDENTITY.getByName(`phone-challenge:${await sha256(token)}`).putRecord({kind:'phone-challenge',
        binding:await sha256(token),verification_sid:verification.sid,account_id:await accountId(input.phone,env),
        masked_phone:`••• ${input.phone.slice(-4)}`,attempts:0,check_id:null,expires_at:Date.now()+600000});
      return json({sent:true,masked_phone:`••• ${input.phone.slice(-4)}`,expires_in:600},200,cookie(challengeCookie,token,600));
    }catch{return error('phone_provider_unavailable',503);}
  }
  if(typeof input.code!=='string'||!/^[0-9]{4,10}$/.test(input.code))return error('invalid_code',400);
  const token=readCookie(request,challengeCookie);if(!token)return error('start_sign_in_again',401);
  const object=env.IDENTITY.getByName(`phone-challenge:${await sha256(token)}`);
  const challenge=await object.reservePhoneCheck(await sha256(token));
  if(!challenge)return error('start_sign_in_again',401);
  let approved=false;
  try {
    const check=await verifyApi(env,'VerificationCheck',{VerificationSid:challenge.verification_sid,Code:input.code});
    approved=check.status==='approved'&&check.sid===challenge.verification_sid;
  }catch{await object.finishPhoneCheck(challenge.check_id,false);return error('phone_provider_unavailable',503);}
  if(!await object.finishPhoneCheck(challenge.check_id,approved))return error('start_sign_in_again',401);
  if(!approved)return error('invalid_code',401);
  const account={id:challenge.account_id,name:challenge.masked_phone};
  const session=randomToken();
  await env.IDENTITY.getByName(`session:${await sha256(session)}`).putRecord({kind:'session',account,expires_at:Date.now()+7*86400000});
  await env.AGENT_CONNECTIONS.getByName(account.id).initialize(account.id);
  const response=json({signed_in:true},200,cookie(sessionCookie,session,7*86400));
  response.headers.append('Set-Cookie',cookie(challengeCookie,'',0));
  return response;
}
