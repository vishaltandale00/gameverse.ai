import {assert,digest} from '../../src/dev-manager-protocol.js';
const encode=new TextEncoder(),decode=new TextDecoder();
// Cloud-owned lifecycle. Intent is persisted before each non-idempotent effect.
// Restart reconciles names/outputs; it never repeats uncertain paid execution.
export class HostedVoiceDispatch {
  constructor({core,daytona,admission,artifacts,release,launch,now=()=>Date.now()}){Object.assign(this,{core,daytona,admission,artifacts,release,launch,now});}
  save(){this.core.commit();}
  owned(s,t){assert(s.id===t.sandbox_id&&s.name===t.sandbox_name&&s.labels?.['gameverse.task']===t.id&&s.labels?.['gameverse.owner']===t.owner&&s.labels?.['gameverse.scope']==='hosted-voice-v1','sandbox_identity_mismatch');}
  async step(t){
    if(t.cleanup_confirmed)return;
    if(this.now()>=t.deadline&&!t.cancel_requested){t.cancel_requested=true;t.failed=true;t.reason||='deadline_exceeded';}
    if(t.cancel_requested)t.phase='cleaning';
    const root='/home/daytona/gv-hosted-'+t.id;
    if(t.phase==='queued'){
      if(!Object.values(this.core.state.voice.requests).some(r=>r.task_id===t.id&&r.phase==='audio'))return;
      if(!await this.admission.claimHosted(t.owner,t.id,this.core.policy.platform_active))return;
      t.admitted=true;t.phase='creating';t.timings.dispatch_at=this.now();this.save();return;
    }
    if(t.phase==='creating'){
      let s=await this.daytona.get(t.sandbox_id||t.sandbox_name);
      if(!s){
        if(t.create_sent){t.reason='provisioning_unconfirmed';this.save();return;}
        if(t.cancel_requested||this.now()>=t.deadline)return;
        t.create_sent=true;this.save();
        s=await this.daytona.request(`${this.daytona.base}/sandbox`,'POST',{name:t.sandbox_name,snapshot:'dad882b3-a047-4715-8713-bddec50bb7ca',target:'us',public:false,networkBlockAll:false,autoStopInterval:1,autoDeleteInterval:-1,ttlMinutes:Math.ceil(t.limits.job_wall_ms/60000)+1,labels:{'gameverse.scope':'hosted-voice-v1','gameverse.task':t.id,'gameverse.owner':t.owner}});
      }
      if(!s)return;t.sandbox_id=s.id;this.save();this.owned(s,t);
      if(s.state!=='started')return;
      assert(s.public===false&&s.networkBlockAll===false&&s.cpu===1&&s.memory===1&&s.disk===3,'unsafe_voice_worker');
      const created=Date.parse(s.createdAt),expiry=Date.parse(s.autoDestroyAt),ceiling=(Math.ceil(t.limits.job_wall_ms/60000)+1)*60000;
      assert(Number.isFinite(created)&&Number.isFinite(expiry)&&expiry>this.now()&&expiry<=created+ceiling+5000,'remote_deadline_unconfirmed');
      t.phase='preparing';t.timings.provisioned_at=this.now();this.save();return;
    }
    const s=await this.daytona.get(t.delete_target_id||t.sandbox_id||t.sandbox_name);
    if(t.phase==='cleaning'&&t.delete_target_id&&s){assert(s.id===t.delete_target_id,'sandbox_identity_mismatch');if(['destroying','destroyed'].includes(s.state))return;}
    if(s)this.owned(s,t);
    if(t.phase==='preparing'){
      assert(s?.state==='started','voice_worker_lost');
      // Setup is fixed and idempotent; only the actual execution is single-shot.
      const made=await this.daytona.execute(s,`mkdir -p ${root} && chmod 700 ${root}`,5);assert(made.exitCode===0,'voice_setup_failed');
      const permit=await this.launch(t);
      for(const [name,content] of Object.entries({...((await this.release(t)).files),'launch.json':JSON.stringify(permit)}))await this.daytona.upload(s,root+'/'+name,encode.encode(content));
      if(t.cancel_requested||this.now()>=t.deadline){t.phase='cleaning';this.save();return;}
      t.phase='executing';t.execute_sent=true;t.timings.started_at=this.now();this.save();
      const result=await this.daytona.execute(s,`cd ${root} && nohup node voice-worker.mjs > worker.log 2>&1 < /dev/null &`,5);
      assert(result.exitCode===0,'voice_execution_failed');return;
    }
    if(t.phase==='executing'){
      if(!s){t.reason='voice_worker_lost';t.phase='cleaning';this.save();return;}
      const bytes=await this.daytona.download(s,root+'/result.json',24576);
      if(bytes){await this.retain(t,bytes);t.phase='cleaning';this.save();}return;
    }
    if(t.phase==='cleaning'){
      if(s&&!t.retained){
        const bytes=t.result_rejected?null:await this.daytona.download(s,root+'/result.json',24576);
        if(t.result_rejected)await this.retainSource(t);else if(bytes)await this.retain(t,bytes);
        else {t.cleanup_wait_at??=this.now();this.save();if(t.execute_sent&&this.now()-t.cleanup_wait_at<3000)return;await this.retainSource(t);}
      }
      if(s){
        t.delete_target_id=s.id;this.save();await this.daytona.delete(s.id);
        if(await this.daytona.get(s.id))return;
      }else if(t.create_sent&&!t.sandbox_id){
        // A not-found read and elapsed TTL do not prove that a lost create
        // cannot materialize later. Keep the reservation until its exact ID is
        // observed and deletion confirmed, or explicit provider reconciliation.
        t.reason='provisioning_unconfirmed';this.save();await this.daytona.delete(t.sandbox_name);return;
      }
      await this.retainSource(t);
      await this.admission.releaseHosted(t.owner,t.id);
      t.cleanup_confirmed=true;t.phase=t.failed?'failed':t.cancel_requested?'cancelled':t.worker_outcome==='failed'||!t.retained?'failed':'succeeded';t.timings.finished_at=this.now();this.save();
    }
  }
  async retainSource(t){if(t.source_retained)return;const text=(await this.release(t)).files['source.json'],sha256=await digest(text);await this.artifacts.put(`hosted-voice/${t.owner}/${t.id}/${sha256}`,text);t.artifacts.push({kind:'source',sha256});t.source_retained=true;this.save();}
  async retain(t,bytes){
    let result;try{result=JSON.parse(decode.decode(bytes));}catch{assert(false,'voice_result_mismatch');}
    assert(result&&result.schema==='gameverse.voice-worker-result/1'&&result.task_id===t.id&&result.source_commit===t.source_commit&&result.session_id===t.voice.session_id&&['completed','released','failed'].includes(result.outcome)&&Number.isInteger(result.provider_attempts)&&result.provider_attempts>=0&&result.provider_attempts<=t.limits.model_calls&&result.synthetic===t.synthetic&&result.model_calls===(result.synthetic?0:result.provider_attempts),'voice_result_mismatch');
    assert(Number.isSafeInteger(result.started_at)&&Number.isSafeInteger(result.finished_at)&&result.finished_at>=result.started_at&&result.started_at>=t.created_at&&result.finished_at<=t.deadline+30000,'voice_result_mismatch');
    // Validate an allowlisted receipt; never retain arbitrary worker logs/source.
    const receipt={schema:result.schema,task_id:t.id,source_commit:t.source_commit,session_id:t.voice.session_id,started_at:result.started_at,finished_at:result.finished_at,outcome:result.outcome,provider_attempts:result.provider_attempts,model_calls:result.model_calls,synthetic:result.synthetic};
    const data=JSON.stringify(receipt),sha256=await digest(data);await this.artifacts.put(`hosted-voice/${t.owner}/${t.id}/${sha256}`,data);
    if(!t.artifacts.some(a=>a.sha256===sha256))t.artifacts.push({kind:'result',sha256});t.retained=true;t.worker_outcome=result.outcome;if(result.outcome==='failed')t.reason='voice_worker_failed';this.save();await this.retainSource(t);
  }
  async advance(){for(const t of Object.values(this.core.state.tasks)){
    if(t.cleanup_confirmed){if(t.admitted)await this.admission.releaseHosted(t.owner,t.id);continue;}
    try{await this.step(t);}catch(error){t.reason=/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:'voice_dispatch_unavailable';
      if(!/^daytona_(http|upload|download)/.test(t.reason)&&!['provisioning_unconfirmed','sandbox_identity_mismatch'].includes(t.reason)){t.cancel_requested=true;t.failed=true;t.phase='cleaning';if(['voice_result_mismatch','daytona_file_too_large'].includes(t.reason))t.result_rejected=true;}
      this.save();}
  }}
}
