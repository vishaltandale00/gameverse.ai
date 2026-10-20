import {trustedGameverseOrigin} from '../../src/hosted-origins.js';
import {DurableObject} from 'cloudflare:workers';
import {HostedVoiceHistory} from './hosted-voice-history.js';
import {HostedVoiceCore} from '../../scripts/dev-manager/hosted-voice-core.js';
import {HostedVoiceDispatch} from '../../scripts/dev-manager/hosted-voice-dispatch.js';
import {VoiceRegistry} from '../../scripts/dev-manager/voice-registry.js';
import {hostedVoicePolicy,hostedVoiceRelease,releaseContent} from '../../src/hosted-voice-protocol.js';
import {assert,digest} from '../../src/dev-manager-protocol.js';
import {Daytona} from './daytona.js';
import {voiceCapability} from './browser-voice-api.js';
const operations=new Set(['bind','upload','request','approve','cancelRequest','revoke','browserPoll','ack','model','work','claimRequest','transcript','command','commandResult','record','reserveProvider','providerResult','claimCall','callResult']);
export class HostedVoiceState extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.env=env;this.storage=ctx.storage;this.sql=ctx.storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS hosted_voice (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');const row=this.sql.exec('SELECT value FROM hosted_voice WHERE id=1').toArray()[0];
    this.core=new HostedVoiceCore({history:new HostedVoiceHistory(this.sql),state:row&&JSON.parse(row.value),save:value=>this.sql.exec('INSERT INTO hosted_voice(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',JSON.stringify(value))});}
  async release(){if(!this.package){const r=await this.env.ASSETS.fetch(new Request('https://gameverse.build/runtime/voice-worker.json'));assert(r.ok,'hosted_voice_release_unavailable',503);const p=hostedVoiceRelease(await r.json());assert(await digest(releaseContent(p))===p.sha256,'voice_release_digest_mismatch');await this.env.ARTIFACTS.put('hosted-voice/releases/'+p.sha256,JSON.stringify(p),{onlyIf:{etagDoesNotMatch:'*'}});this.package=p;}return this.package;}
  async initialize(owner){assert(/^[a-f0-9]{64}$/.test(this.env.AGENT_CREDENTIAL_KEY||''),'voice_key_missing',503);assert(this.env.APP_ENV==='test'||this.env.DAYTONA_API_KEY,'hosted_voice_dispatch_unavailable',503);assert(typeof owner==='string'&&/^phone:[a-f0-9]{64}$/.test(owner),'invalid_account');const [release,status]=await Promise.all([this.release(),this.env.AGENT_CONNECTIONS.getByName(owner).apiKeyStatus('codex')]);this.core.configure(owner,release,hostedVoicePolicy(this.env),status,this.env.APP_ENV==='test'&&this.env.HOSTED_VOICE_SYNTHETIC==='1');this.core.reconcileConnection(status);return status;}
  async configuration(owner){const status=await this.initialize(owner);return {available:status.available,source_commit:this.package.source_commit,release_sha256:this.package.sha256,services:['transcribe','plan','decisions','reflect'],provider:'OpenAI API key',inference_qualified:false,reason:status.available?null:'Add an OpenAI API key in Account. Voice requires transcription and Decisions access; saving a key does not verify those services.'};}
  async voice(method,...args){assert(operations.has(method),'invalid_voice_operation');assert(this.core.owner,'account_not_initialized');const status=await this.env.AGENT_CONNECTIONS.getByName(this.core.owner).apiKeyStatus('codex');this.core.reconcileConnection(status);this.core.connection=status;
    if(['bind','upload'].includes(method))assert(status.available,'hosted_voice_key_required',403);
    const result=new VoiceRegistry(this.core)[method](...args);await this.schedule();return result;}
  task(id){return this.core.task(id);}
  async schedule(){if(Object.values(this.core.state.tasks).some(t=>!t.cleanup_confirmed)){const next=Date.now()+1000,existing=await this.storage.getAlarm();if(!existing||existing>next)await this.storage.setAlarm(next);}}
  async alarm(){if(this.advancing)return this.advancing;this.advancing=this.advance();try{return await this.advancing;}finally{this.advancing=null;await this.schedule();}}
  async advance(){
    if(!this.core.state.owner)return;
    try{
      try{await this.initialize(this.core.state.owner);}catch(error){
        // Disabling/removing launch configuration must still permit cleanup of
        // previously admitted jobs using their retained immutable packages.
        this.core.owner=this.core.state.owner;this.core.policy=this.core.state.policy;
        for(const t of Object.values(this.core.state.tasks))if(!t.cleanup_confirmed){t.cancel_requested=true;t.failed=true;t.reason='hosted_voice_configuration_unavailable';}this.core.commit();
      }
      if(this.env.HOSTED_VOICE_ENABLED!=='1'){for(const t of Object.values(this.core.state.tasks))if(!t.cleanup_confirmed){t.cancel_requested=true;t.reason='hosted_voice_disabled';}this.core.commit();}

      const launch=async t=>({task_id:t.id,source_commit:t.source_commit,session_id:t.voice.session_id,deadline:t.deadline,model_calls:t.limits.model_calls,url:this.broker(t),token:await voiceCapability(this.env,t),synthetic:t.synthetic});
      const dispatcher=new HostedVoiceDispatch({core:this.core,daytona:new Daytona(this.env),admission:this.env.SANDBOX_ADMISSION.getByName('hosted-voice'),artifacts:this.env.ARTIFACTS,release:async t=>{const object=await this.env.ARTIFACTS.get('hosted-voice/releases/'+t.release_sha256);assert(object,'voice_release_unavailable');const p=hostedVoiceRelease(await object.json());assert(p.sha256===t.release_sha256&&await digest(releaseContent(p))===t.release_sha256&&p.source_commit===t.source_commit,'voice_release_digest_mismatch');return p;},launch});
      await dispatcher.advance();
    }catch(error){this.core.state.recovery_reason=/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:'voice_recovery_unavailable';this.core.commit();}
  }
  broker(t){const base=this.env.HOSTED_VOICE_BROKER_URL||'https://gameverse.build',url=new URL(base);assert(trustedGameverseOrigin(url,{allowLoopback:this.env.APP_ENV==='test'}),'untrusted_voice_broker');return new URL(`/api/browser-voice/worker/${t.id}?executor=hosted-api-key&account=${encodeURIComponent(t.owner)}`,base).href;}
}
