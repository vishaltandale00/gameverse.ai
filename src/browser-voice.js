import {VOICE_PROTOCOL,VOICE_LEASE_MS} from './browser-voice-protocol.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const plain=value=>JSON.parse(JSON.stringify(value));
// Browser authority stays local. Only the fixed tool catalog crosses this boundary.
export class BrowserVoice {
  constructor({shell,fetchImpl=(...args)=>fetch(...args),now=()=>Date.now(),onHandback=()=>{},isPlayable=()=>true,isVisible=()=>!globalThis.document?.hidden}){Object.assign(this,{shell,fetch:fetchImpl,now,onHandback,isPlayable,isVisible});this.enabled=false;this.binding=null;this.runs=new Set();this.cancelled=new Set();this.pendingCalls=new Map();this.acks=new Map();this.sequence=0;
    this.localStop=shell.stop.bind(shell);this.localStopAll=shell.stopAll.bind(shell);
    shell.stop=(id,reason)=>{const ours=this.runs.has(id),result=this.localStop(id,reason);if(ours)this.revoke(reason||'player stopped the simulated user');return result;};
    shell.stopAll=reason=>{const result=this.localStopAll(reason);this.revoke(reason||'player stopped every run');return result;};
    const close=shell.host.closeSession.bind(shell.host);shell.host.closeSession=(id,...args)=>{if(this.binding?.target.sessionId===id)this.revoke('session closed');return close(id,...args);};
    this.watchdog=setInterval(()=>{if(this.binding&&(!this.isVisible()||!this.isPlayable(this.binding.target.sessionId)||this.now()-this.lastSuccess>VOICE_LEASE_MS))this.revoke('remote voice connection expired');},250);this.watchdog.unref?.();
  }
  async post(path,value,signal){const r=await this.fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:signal||AbortSignal.timeout(5000)});const data=await r.json();if(!r.ok)throw Error(data.error?.code||'remote_voice_unavailable');return data;}
  valid(binding){return this.binding===binding&&!binding.revoked&&this.isVisible()&&this.isPlayable(binding.target.sessionId)&&this.now()-this.lastSuccess<=VOICE_LEASE_MS;}
  async prepare({context,config}){if(config.execution!=='daytona')return;this.enabled=true;if(!config.available)throw Error(config.reason||'Remote voice is unavailable.');
    if(context?.gameId!=='soccer')throw Error('Open a soccer match before requesting a takeover.');
    const sessionId=context.sessionId||this.shell.host.listSessions().find(s=>s.gameId===context.gameId&&s.displayed)?.sessionId;if(!sessionId)throw Error('Open a soccer match before requesting a takeover.');
    if(!this.isPlayable(sessionId))throw Error('Resume a healthy soccer match before requesting a takeover.');
    const session=this.shell.host.describeSession(sessionId);
    const game=this.shell.host.listGames().find(g=>g.gameId===session.gameId),target={sessionId:session.sessionId,gameId:session.gameId,version:session.version,profileId:session.identity.profileId,artifactSha256:game?.artifactSha256,sourceCommit:config.source_commit};
    if(this.binding&&JSON.stringify(this.binding.target)!==JSON.stringify(target))this.revoke('session changed');
    if(!this.binding){this.binding={id:crypto.randomUUID(),epoch:crypto.randomUUID(),manager_id:config.manager_id,target};this.acks.clear();this.sequence=0;}
    const b=this.binding,snapshot=this.shell.agent.snapshot({gameId:session.gameId,sessionId:session.sessionId});snapshot.games=snapshot.games.filter(g=>g.gameId===target.gameId);snapshot.sessions=snapshot.sessions.filter(s=>s.sessionId===target.sessionId);snapshot.runs=snapshot.runs.filter(r=>this.shell.host.runStatus(r.runId).sessionId===target.sessionId);
    this.lastSuccess=this.now();await this.post('/api/browser-voice/bind',{...b,snapshot});if(this.binding!==b)throw Error('voice_session_revoked');this.shell.remoteStatus({pending:true});if(this.polling!==b){this.polling=b;void this.poll(b);}
  }
  fetchVoice=(path,options={})=>{if(path==='/api/voice/transcriptions'){if(!this.binding)throw Error('Check your game session before speaking.');return this.fetch(path,{...options,headers:{...options.headers,'X-Gameverse-Voice-Session':this.binding.id}});}return this.fetch(path,options);};
  cancelRequest({requestId}){this.cancelled.add(requestId);this.shell.remoteStatus({pending:false});if(!this.runs.size)this.revoke('voice request cancelled');void this.fetch('/api/voice/requests/'+requestId,{method:'DELETE',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(5000)}).catch(()=>{});}
  async poll(b){while(this.binding===b){try{const view=await this.post('/api/browser-voice/poll',{id:b.id,epoch:b.epoch});if(this.binding!==b)break;this.lastSuccess=this.now();if(view.epoch!==b.epoch||view.task_id&&!view.active){this.revoke('remote voice worker ended');break;}
      for(const c of view.commands)await this.command(b,c);
      for(const row of view.calls){const p=this.pendingCalls.get(row.id);if(p){this.pendingCalls.delete(row.id);row.result.error?p.reject(Error(row.result.error)):p.resolve(row.result);}}
    }catch{if(this.now()-this.lastSuccess>VOICE_LEASE_MS){this.revoke('remote voice connection lost');break;}}await sleep(150);}}
  async command(b,c){let ack=this.acks.get(c.id);if(!ack){let created;
    try{if(!this.valid(b)||c.epoch!==b.epoch||c.session_id!==b.id||JSON.stringify(c.target)!==JSON.stringify(b.target)||c.expires_at<=this.now()||c.sequence!==this.sequence+1)throw Error('stale_voice_command');
      this.sequence=c.sequence;if(this.cancelled.has(c.request_id))throw Error('cancelled_voice_request');
      const current=this.shell.host.describeSession(b.target.sessionId),game=this.shell.host.listGames().find(g=>g.gameId===current.gameId);
      if(current.state!=='running'||current.version!==b.target.version||current.identity.profileId!==b.target.profileId||game?.artifactSha256!==b.target.artifactSha256)throw Error('voice_session_changed');
      this.sequence=c.sequence;
      if(c.name==='open_session'){
        if(c.args.gameId!==b.target.gameId||c.args.selection==='new'||c.args.sessionId&&c.args.sessionId!==b.target.sessionId)throw Error('remote_voice_requires_current_session');ack={ok:true,result:plain(current)};
      }else if(c.name==='list_games')ack={ok:true,result:{games:[plain(game)]}};
      else if(c.name==='list_sessions')ack={ok:true,result:{sessions:[plain(current)]}};
      else {
        if(!['start_simulated_user','run_status','stop_run'].includes(c.name))throw Error('unsupported_voice_tool');
        if(c.name==='start_simulated_user'&&(c.args.sessionId!==b.target.sessionId||c.args.role&&c.args.role!=='gameplay'))throw Error('wrong_voice_session');
        if(c.args.runId&&this.shell.host.runStatus(c.args.runId).sessionId!==b.target.sessionId)throw Error('wrong_voice_run');
        if(c.name==='run_status'&&!c.args.runId){ack={ok:true,result:{runs:this.shell.host.listRuns().filter(r=>r.sessionId===b.target.sessionId)}};}
        const result=ack?.result||await this.shell.agent.invoke(c.name,plain(c.args),{requestId:c.request_id,context:{sessionId:b.target.sessionId,gameId:b.target.gameId},lastSessionId:b.target.sessionId});
        if(c.name==='start_simulated_user')created=result.runId;
        if(!this.valid(b)||c.expires_at<=this.now()||this.cancelled.has(c.request_id)){if(created)this.localStop(created,'late remote start rejected');throw Error('stale_voice_command');}
        if(created)this.runs.add(created);if(c.name==='stop_run'){this.runs.delete(c.args.runId);this.onHandback(result);}ack={ok:true,result:plain(result)};
      }
    }catch(error){ack={ok:false,error:error.message};}this.acks.set(c.id,ack);}
    if(this.valid(b))await this.post('/api/browser-voice/ack',{id:b.id,epoch:b.epoch,command_id:c.id,result:ack});
  }
  async handleTranscript({requestId,text}){const b=this.binding;if(!b||!this.valid(b)||this.cancelled.has(requestId))throw Error('voice_session_revoked');this.shell.remoteStatus({pending:true});
    try{while(this.valid(b)){const r=await this.fetch('/api/voice/requests/'+requestId,{signal:AbortSignal.timeout(5000)}),row=await r.json();if(!r.ok||row.status==='cancelled')throw Error('voice_request_cancelled');if(row.record){this.shell.remoteStatus({acknowledgment:row.record.acknowledgment});return row.record;}await sleep(150);}throw Error('voice_session_revoked');}
    finally{this.shell.remoteStatus({pending:false});}
  }
  async modelFetch(path,options){const kind=String(path).split('/').pop();if(!['decisions','reflect'].includes(kind))throw Error('remote_voice_service_unsupported');const b=this.binding;if(!b||!this.valid(b))throw Error('voice_session_revoked');options.signal?.throwIfAborted();const payload=JSON.parse(options.body),id=crypto.randomUUID();let runId=payload.runId;
    if(!runId&&this.runs.size===1)runId=[...this.runs][0];
    const result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pendingCalls.delete(id);reject(Error('remote_voice_model_timeout'));},25000);this.pendingCalls.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});});
    result.catch(()=>{});const abort=()=>{this.pendingCalls.get(id)?.reject(Error('remote_voice_model_aborted'));this.pendingCalls.delete(id);};options.signal?.addEventListener('abort',abort,{once:true});
    try{await this.post('/api/browser-voice/model',{id,session_id:b.id,epoch:b.epoch,kind,payload,runId},options.signal);const value=await result;if(!this.valid(b))throw Error('voice_session_revoked');return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});}catch(error){abort();throw error;}finally{options.signal?.removeEventListener('abort',abort);}
  }
  revoke(reason='remote voice ended'){const b=this.binding;if(!b)return;this.binding=null;b.revoked=true;for(const id of this.runs){const run=this.shell.host.runStatus(id);if(run.state==='running'){const result=this.localStop(id,reason);this.onHandback(result);}}this.runs.clear();for(const p of this.pendingCalls.values())p.reject(Error('voice_session_revoked'));this.pendingCalls.clear();this.shell.remoteStatus({pending:false,acknowledgment:reason+'. Controls are yours.'});void this.post('/api/browser-voice/revoke',{id:b.id,epoch:b.epoch}).catch(()=>{});}
  dispose(){this.revoke('browser session closed');clearInterval(this.watchdog);}
}
