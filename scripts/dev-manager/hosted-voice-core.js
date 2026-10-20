import {assert,canonical,terminal,UUID} from '../../src/dev-manager-protocol.js';
import {VOICE_LEASE_MS} from '../../src/browser-voice-protocol.js';
import {HOSTED_VOICE_EXECUTOR} from '../../src/hosted-voice-protocol.js';
export class HostedVoiceCore {
  constructor({state,save,history,now=()=>Date.now()}){this.state=state||{tasks:{},voice:{sessions:{},requests:{},commands:{},calls:{}}};this.persist=save;this.history=history;this.now=now;this.execution=HOSTED_VOICE_EXECUTOR;}
  commit(){this.persist(this.state);}
  configure(owner,release,policy,connection,synthetic=false){
    assert(!this.state.owner||this.state.owner===owner,'account_mismatch',403);const first=!this.state.owner;this.state.owner=owner;const policyChanged=canonical(this.state.policy)!==canonical(policy);this.state.policy={...policy};
    Object.assign(this,{owner,release,policy,connection,synthetic});
    this.voiceLimits={wall_ms:policy.wall_ms,job_wall_ms:policy.wall_ms,max_jobs:1,max_sandboxes:1,model_calls:policy.model_calls};if(first||policyChanged)this.commit();this.compact();
  }
  authorizeTarget(owner,target){assert(owner===this.state.owner,'account_mismatch',403);assert(target.sourceCommit===this.release.source_commit&&this.release.games.some(g=>g.gameId===target.gameId&&g.version===target.version&&g.artifactSha256===target.artifactSha256),'voice_release_mismatch');}
  task(id){const t=this.state.tasks[id]||this.history?.get('task',id);assert(t,'voice_task_not_found',404);return t;}
  submit(owner,input){assert(owner===this.owner&&this.connection?.available,'hosted_voice_key_required',403);assert(UUID.test(input.id),'invalid_voice_task');
    const prior=this.state.tasks[input.id]||this.history?.get('task',input.id);if(prior){assert(prior.owner===owner&&prior.voice.session_id===input.voice.session_id&&prior.source_commit===input.source_commit,'voice_request_conflict');return prior;}
    const tasks=Object.values(this.state.tasks),now=this.now();
    assert(tasks.filter(t=>!t.cleanup_confirmed).length<this.policy.account_active,'hosted_voice_account_capacity',429);
    assert((tasks.filter(t=>t.created_at>=now-86400000).length+(this.history?.countTasksSince(now-86400000)||0))<this.policy.daily_jobs,'hosted_voice_daily_limit',429);
    // H3 admits voice roots only. Construction children are a separate adapter.
    const t={id:input.id,kind:'voice-agent',executor:this.execution,synthetic:this.synthetic,owner,parent_id:null,voice:input.voice,source_commit:input.source_commit,release_sha256:this.release.sha256,limits:this.voiceLimits,phase:'queued',created_at:now,deadline:now+this.policy.wall_ms,sandbox_name:'gv-hv-'+owner.slice(-16)+'-'+input.id,connection:{provider:'codex',generation:this.connection.generation,revision:this.connection.revision},cancel_requested:false,cleanup_confirmed:false,timings:{queued_at:now},artifacts:[]};
    this.state.tasks[t.id]=t;this.commit();return t;
  }
  compact(){
    if(!this.history)return;let changed=false;const voice=this.state.voice,now=this.now();
    for(const task of Object.values(this.state.tasks)){
      // Keep a bounded grace period for in-flight provider receipts after Stop.
      // Cleanup must already be confirmed; archival never releases capacity.
      if(!task.cleanup_confirmed||now<task.deadline+30000)continue;
      for(const [kind,table] of [['request',voice.requests],['command',voice.commands],['call',voice.calls]])for(const [id,row] of Object.entries(table))if(row.task_id===task.id){this.history.put(kind,id,row);delete table[id];}
      const session=voice.sessions[task.voice.session_id];for(const [id,row] of Object.entries(session?.provider_calls||{}))if(row.task_id===task.id){this.history.put('provider',task.id+'/'+id,row);delete session.provider_calls[id];}
      this.history.put('task',task.id,task);delete this.state.tasks[task.id];changed=true;
    }
    for(const [id,session] of Object.entries(voice.sessions))if(!this.state.tasks[session.task_id]&&(session.revoked||session.last_seen<=now-VOICE_LEASE_MS)){
      const {snapshot,provider_calls,...tombstone}=session;this.history.put('session',id,{...tombstone,revoked:true});delete voice.sessions[id];changed=true;
    }
    if(changed)this.commit();
  }
  cancel(owner,id){const t=this.task(id);assert(t.owner===owner,'account_mismatch',403);if(terminal(t.phase)&&t.cleanup_confirmed)return t;
    t.cancel_requested=true;for(const child of Object.values(this.state.tasks))if(child.parent_id===id)this.cancel(owner,child.id);this.commit();return t;}
  reconcileConnection(status){let changed=false;for(const t of Object.values(this.state.tasks))if(!t.cleanup_confirmed&&!t.cancel_requested&&(!status.available||t.connection.generation!==status.generation||t.connection.revision!==status.revision)){t.cancel_requested=true;t.reason='api_key_grant_revoked';changed=true;}if(changed)this.commit();}
}
