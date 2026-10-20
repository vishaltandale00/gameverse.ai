import {applicationVoiceCredential} from './hosted-voice-funding.js';
import {principal} from './phone-sign-in.js';
import {assert,digest,UUID,canonical} from '../../src/dev-manager-protocol.js';
import {VOICE_PROTOCOL} from '../../src/browser-voice-protocol.js';
import {agentConfiguration,agentProviders,toDecisionsWire} from '../../scripts/agent-api.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>Response.json(data,{status,headers});
async function bytes(request,max){const reader=request.body?.getReader();if(!reader)return new Uint8Array();let n=0;const chunks=[];try{while(true){const r=await reader.read();if(r.done)break;n+=r.value.length;assert(n<=max,'voice_payload_too_large',413);chunks.push(r.value);}}finally{reader.releaseLock();}const result=new Uint8Array(n);let pos=0;for(const c of chunks){result.set(c,pos);pos+=c.length;}return result;}
const read=async request=>JSON.parse(new TextDecoder().decode(await bytes(request,65536))||'{}');
export async function voiceCapability(env,task){assert(/^[a-f0-9]{64}$/.test(env.AGENT_CREDENTIAL_KEY||''),'voice_key_missing',503);const key=await crypto.subtle.importKey('raw',Uint8Array.from(env.AGENT_CREDENTIAL_KEY.match(/../g),x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);const value=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode([VOICE_PROTOCOL,task.id,task.owner,task.voice.session_id,task.deadline].join(':')));return Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join('');}
async function authWorker(request,env,registry,id){const t=await registry.task(id);assert(t.kind==='voice-agent','not_voice_task');const expected=await voiceCapability(env,t),actual=request.headers.get('Authorization')||'';assert(await digest(actual)===await digest('Bearer '+expected),'voice_worker_unauthorized',401);assert(t.deadline>Date.now(),'voice_worker_expired',410);return t;}
const hosted=env=>env.HOSTED_VOICE_ENABLED==='1';
const ready=env=>env.VOICE_AGENT_ENABLED==='1'&&Boolean(env.OPENAI_API_KEY||env.APP_ENV==='test'&&typeof env.VOICE_TEST_PROVIDER==='function');
async function provider(env,registry,task,input){
  const {id,kind,payload}=input;assert(typeof id==='string'&&['transcribe','plan','decisions','reflect','speech'].includes(kind),'invalid_voice_provider_call');assert(JSON.stringify(payload||{}).length<=26000,'voice_payload_too_large');
  const reserved=await registry.voice('reserveProvider',task.id,{id,kind,sha256:await digest(canonical(payload))});
  if(!reserved.reserved){assert(reserved.result,'voice_provider_outcome_unknown');return reserved.result;}
  let result;const started=Date.now();try{
    const signal=AbortSignal.timeout(Math.max(1,Math.min(25000,task.deadline-Date.now()))),config=agentConfiguration(env);if(task.executor==='hosted-api-key'){config.decisionsUrl='https://api.openai.com/v1/decisions';config.responsesUrl='https://api.openai.com/v1/responses';}let audio,row;
    const application=task.executor==='hosted-api-key'&&task.connection?.source==='application';
    const connections=task.executor==='hosted-api-key'&&!application?env.AGENT_CONNECTIONS.getByName(task.owner):null;
    const grant={...task.connection,task_id:task.id,parent_id:task.id,service:kind,expires_at:task.deadline};
    const apiKey=application?await applicationVoiceCredential(env,task,kind):connections?await connections.apiKeyCredential(grant):env.OPENAI_API_KEY;
    if(kind==='transcribe'){row=await registry.voice('request',task.owner,payload.request_id);assert(row.task_id===task.id&&row.phase!=='uploading'&&!row.cancelled,'voice_request_cancelled');const object=await env.ARTIFACTS.get(`voice/${task.executor==='hosted-api-key'?task.owner+'/':''}${task.id}/${row.sha256}`);assert(object,'voice_audio_not_found');audio=await object.arrayBuffer();assert(audio.byteLength===row.bytes&&await digest(audio)===row.sha256,'voice_audio_mismatch');}
    if(task.executor==='hosted-api-key')assert(task.synthetic===(env.APP_ENV==='test'&&typeof env.VOICE_TEST_PROVIDER==='function'),'voice_provider_mode_mismatch');
    if(env.APP_ENV==='test'&&typeof env.VOICE_TEST_PROVIDER==='function')result=await env.VOICE_TEST_PROVIDER({kind,payload,task});
    else {
      assert(apiKey,'voice_provider_unavailable',503);
      if(kind==='transcribe'){
        const form=new FormData();form.append('file',new Blob([audio],{type:row.mime}),'request.'+({'audio/webm':'webm','audio/wav':'wav','audio/mp4':'mp4','audio/ogg':'ogg'}[row.mime]));form.append('model',env.TRANSCRIPTION_MODEL||'gpt-4o-mini-transcribe');
        const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+apiKey},body:form,signal});assert(r.ok,'voice_transcription_failed',502);const value=await r.json();assert(typeof value.text==='string'&&value.text.trim()&&value.text.length<=4000,'invalid_voice_transcript');result={text:value.text.trim(),usage:value.usage||null};
      }else if(kind==='plan'||kind==='decisions'){
        assert(typeof payload.state==='string'&&Array.isArray(payload.questions)&&payload.questions.length<=24&&payload.questions.every(q=>['choice','predicate','score'].includes(q.type)),'invalid_voice_questions');
        result=await agentProviders.openai.decisions({body:{model:kind==='plan'?config.plannerModel:config.decisionsModel,input:payload.state,questions:toDecisionsWire(payload.questions)},config,apiKey,fetchImpl:fetch,signal});result={...result,model:kind==='plan'?config.plannerModel:config.decisionsModel,provider:'openai'};
      }else if(kind==='reflect'){
        assert(typeof payload.input==='string','invalid_voice_reflection');result=await agentProviders.openai.reflect({body:{model:config.reflectionModel,input:payload.input},config,apiKey,fetchImpl:fetch,signal});result={...result,model:config.reflectionModel,provider:'openai'};
      }else {assert(false,'voice_speech_not_supported',422);}
    }
    if(application)await applicationVoiceCredential(env,task,kind);else if(connections)await connections.apiKeyCredential(grant);
    // Reject a result that returned after local/session or connection revocation.
    assert((await registry.voice('work',task.id)).active,'voice_session_revoked');
    result={...result,wallMs:Date.now()-started};
  }catch{result={error:'voice_provider_failed',usage:result?.usage||null,wallMs:Date.now()-started};}
  await registry.voice('providerResult',task.id,id,result);return result;
}
export async function browserVoiceRoute(request,env){const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith('/api/browser-voice/')&&!path.startsWith('/api/voice/'))return null;
  try{
    assert(env.ARTIFACTS,'voice_setup_required',503);let registry;
    const worker=path.match(/^\/api\/browser-voice\/worker\/([a-f0-9-]{36})$/);
    if(worker&&request.method==='POST'){
      if(url.searchParams.get('executor')==='hosted-api-key'){assert(hosted(env)&&env.HOSTED_VOICE,'hosted_voice_unavailable',503);const owner=url.searchParams.get('account');assert(/^phone:[a-f0-9]{64}$/.test(owner||''),'invalid_account');registry=env.HOSTED_VOICE.getByName(owner);}else{assert(env.DEV_MANAGERS,'voice_setup_required',503);registry=env.DEV_MANAGERS.getByName('shared-daytona-development');}
      const task=await authWorker(request,env,registry,worker[1]);if(task.executor==='hosted-api-key')await registry.initialize(task.owner);const v=await read(request);
      if(v.op==='work')return json(await registry.voice('work',task.id));
      if(v.op==='claim')return json(await registry.voice('claimRequest',task.id,v.id));
      if(v.op==='transcript')return json(await registry.voice('transcript',task.id,v.id,v.text));
      if(v.op==='command')return json(await registry.voice('command',task.id,v.command));
      if(v.op==='command-result')return json(await registry.voice('commandResult',task.id,v.id));
      if(v.op==='record')return json(await registry.voice('record',task.id,v.id,v.record));
      if(v.op==='provider'){assert(task.executor==='hosted-api-key'||ready(env),'voice_provider_unavailable',503);return json(await provider(env,registry,task,v));}
      if(v.op==='claim-call')return json(await registry.voice('claimCall',task.id,v.id));
      if(v.op==='call-result')return json(await registry.voice('callResult',task.id,v.id,v.result));
      return json({error:{code:'invalid_voice_operation'}},400);
    }
    const account=await principal(request,env);assert(account,'sign_in_required',401);if(!hosted(env))assert(account.developer,'developer_invitation_required',403);
    if(request.method!=='GET')assert(request.headers.get('Origin')===url.origin,'origin_rejected',403);
    if(hosted(env)){
      assert(env.HOSTED_VOICE,'hosted_voice_unavailable',503);registry=env.HOSTED_VOICE.getByName(account.id);
      if(path==='/api/voice/config'&&request.method==='GET'){
        const base={protocol:VOICE_PROTOCOL,execution:'daytona',executor:'hosted-api-key',mode:'recorded',recordButton:11,maxSeconds:15,maxBytes:2097152,timeoutMs:120000};
        try{return json({...base,...await registry.configuration(account.id)});}catch(error){return json({...base,available:false,reason:'Hosted voice is unavailable on this server. Please try again later.'});}
      }
      await registry.initialize(account.id);
    }else {assert(env.DEV_MANAGERS,'voice_setup_required',503);registry=env.DEV_MANAGERS.getByName('shared-daytona-development');}
    if(path==='/api/voice/config'&&request.method==='GET'){
      const view=await registry.view(account.id),manager=view.managers.find(m=>m.owner===account.id&&m.online&&!m.revoked&&m.capabilities.includes('voice-agent'));
      return json({protocol:VOICE_PROTOCOL,execution:'daytona',mode:'recorded',available:ready(env)&&!!manager,manager_id:manager?.id||null,source_commit:manager?.source_commit||null,provider:'configured backend',recordButton:11,maxSeconds:15,maxBytes:2097152,timeoutMs:120000,reason:!ready(env)?'Configure the hosted voice provider.':!manager?'Start and pair the voice-capable manager.':null});
    }
    if(path==='/api/browser-voice/bind'&&request.method==='POST'){assert(hosted(env)||ready(env),'voice_provider_unavailable',503);return json(await registry.voice('bind',account.id,await read(request)));}
    if(path==='/api/voice/transcriptions'&&request.method==='POST'){
      assert(hosted(env)||ready(env),'voice_provider_unavailable',503);const audio=await bytes(request,2097152),session_id=request.headers.get('X-Gameverse-Voice-Session'),request_id=request.headers.get('X-Request-ID'),mime=(request.headers.get('Content-Type')||'').split(';')[0],sha256=await digest(audio);
      const args={session_id,request_id,mime,bytes:audio.length,sha256};const row=await registry.voice('upload',account.id,args,false);
      await env.ARTIFACTS.put(`voice/${hosted(env)?account.id+'/':''}${row.task_id}/${sha256}`,audio,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:mime}});await registry.voice('upload',account.id,args,true);
      return json({requestId:request_id,status:'queued',execution:'daytona'},202);
    }
    const retained=path.match(/^\/api\/voice\/requests\/([a-f0-9-]{36})\/artifacts\/([a-f0-9]{64})$/);
    if(retained&&request.method==='GET'&&hosted(env)){
      const task=await registry.task(retained[1]);assert(task.owner===account.id&&task.artifacts.some(a=>a.sha256===retained[2]),'voice_artifact_not_found',404);
      const object=await env.ARTIFACTS.get(`hosted-voice/${account.id}/${task.id}/${retained[2]}`);assert(object,'voice_artifact_not_found',404);const data=await object.arrayBuffer();assert(await digest(data)===retained[2],'voice_artifact_digest_mismatch');
      return new Response(data,{headers:{...headers,'Content-Type':'application/json','Content-Disposition':'attachment'}});
    }
    const match=path.match(/^\/api\/voice\/requests\/([a-f0-9-]{36})(\/agent)?$/);
    if(match){
      if(request.method==='DELETE'&&!match[2])return json(await registry.voice('cancelRequest',account.id,match[1]));
      const row=await registry.voice('request',account.id,match[1]);
      if(request.method==='GET'){const task=await registry.task(row.task_id);return json({requestId:row.id,status:row.cancelled||task.phase==='cancelled'||task.cancel_requested&&!task.failed?'cancelled':task.failed||!row.record&&['failed','succeeded'].includes(task.phase)?'failed':row.phase,reason:task.reason||null,worker:{id:task.id,phase:task.phase,cleanup_confirmed:task.cleanup_confirmed},artifacts:task.artifacts||[],text:row.text||null,record:row.record||null});}
      if(request.method==='POST'&&match[2]){assert(row.record,'voice_record_pending');return json({requestId:row.id,status:row.phase,agent:row.record});}
    }
    if(path==='/api/voice/requests'&&request.method==='POST'){const v=await read(request);return json(await registry.voice('approve',account.id,v.requestId,v.text,v.context));}
    if(path==='/api/browser-voice/poll'&&request.method==='POST'){const v=await read(request);return json(await registry.voice('browserPoll',account.id,v.id,v.epoch));}
    if(path==='/api/browser-voice/ack'&&request.method==='POST'){const v=await read(request);return json(await registry.voice('ack',account.id,v.id,v.epoch,v.command_id,v.result));}
    if(path==='/api/browser-voice/revoke'&&request.method==='POST'){const v=await read(request);return json(await registry.voice('revoke',account.id,v.id,v.epoch));}
    if(path==='/api/browser-voice/model'&&request.method==='POST')return json(await registry.voice('model',account.id,await read(request)),202);
    return json({error:{code:'not_found'}},404);
  }catch(e){return json({error:{code:/^[a-z0-9_]{1,80}$/.test(e.message)?e.message:'voice_operation_failed'}},e.status||409);}
}
