import {voicePackage,voiceVerifier} from './voice-package.mjs';
import {createHash} from 'node:crypto';
import {assert,terminal,taskRequest,canonical} from '../../src/dev-manager-protocol.js';
import {fixtureRuntime,fixtureSource,fixtureVerifier} from './fixture.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const reason=e=>/^[a-z0-9_]{1,80}$/.test(e.message)?e.message:'operation_failed';
export class Runner {
  constructor({store,transport,daytona,now=()=>Date.now()}){Object.assign(this,{store,transport,daytona,now});this.jobs={};}
  async init(){this.jobs=await this.store.read('journal.json',{});}
  save(){return this.store.write('journal.json',this.jobs);}
  async reconcile(tasks=[]){for(const t of tasks){const j=this.jobs[t.id];if(!j)continue;j.task=t;j.sequence=Math.max(j.sequence,t.sequence);if(t.cleanup_manager_id&&t.cleanup_manager_id!==(this.transport.identity?.id||j.executor_id||j.task.manager_id)){j.phase='done';j.pending=null;}else if(terminal(t.phase)&&t.cleanup_confirmed){j.phase='done';j.pending=null;}else if(t.phase==='stopped'){j.phase='stopped';j.pending=null;}else if(t.cancel_requested){j.cancel=true;j.phase='cleaning';j.pending=null;}else if(j.pending&&j.pending.sequence<=t.sequence&&t.last_report===canonical(j.pending)){if(j.pending.phase==='running')j.running_announced=true;j.pending=null;}}await this.save();}
  async commands(commands){for(const c of commands){const t=c.task;taskRequest(t.request);let j=this.jobs[t.id];
      if(!j){j=this.jobs[t.id]={task:t,command_id:c.id,phase:c.op==='fixture'?'queued':'cleaning',sequence:t.sequence,executor_id:c.manager_id,start:this.now(),timings:{},cancel:false};}
      j.task=t;j.sequence=Math.max(j.sequence,t.sequence);
      if(t.cleanup_manager_id&&t.cleanup_manager_id!==(this.transport.identity?.id||c.manager_id)){j.phase='done';j.pending=null;continue;}
      if(c.op==='cancel'||c.op==='manage'||t.cancel_requested){j.cancel=true;j.action=c.op==='manage'?c.action:'delete';j.command_id=c.id;j.pending=null;j.phase='cleaning';}
    }await this.save();}
  async report(j,phase,extra={}){j.pending??={command_id:j.command_id,sequence:j.sequence+1,phase,...extra,...(j.sandbox_id?{sandbox_id:j.sandbox_id}:{})};await this.save();
    const result=await this.transport.device({op:'report',report:j.pending});j.sequence=result.sequence;if(j.pending.phase==='running')j.running_announced=true;j.pending=null;await this.save();return result;}
  async outputs(j,sandbox,root,{partial=false}={}){
    if(j.task.kind==='voice-agent'){
      const pkg=await voicePackage(j.task.source_commit),source=await this.daytona.download(sandbox,`${root}/source.json`,8192),bytes=await this.daytona.download(sandbox,`${root}/result.json`,24576);const retained=[];
      if(source){assert(new TextDecoder().decode(source)===pkg.manifest,'voice_source_mismatch');retained.push({kind:'source',data:Buffer.from(source).toString('base64url'),sha256:hash(source)});}
      if(bytes){let result;try{result=JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('voice_result_mismatch');}assert(result.schema==='gameverse.voice-worker-result/1'&&result.task_id===j.task.id&&result.source_commit===j.task.source_commit&&result.session_id===j.task.voice.session_id&&Number.isInteger(result.provider_attempts)&&result.provider_attempts<=100,'voice_result_mismatch');retained.push({kind:'result',data:Buffer.from(bytes).toString('base64url'),sha256:hash(bytes)});}
      j.retained=retained;j.collection_confirmed=true;await this.save();return partial?retained.length>0:retained.length===2;
    }
    const source=await this.daytona.download(sandbox,`${root}/addition.mjs`,4096);
    const retained=new Map((j.retained||[]).map(a=>[a.kind,a]));
    if(source){
      assert(new TextDecoder().decode(source)===fixtureSource,'fixture_source_mismatch');
      retained.set('source',{kind:'source',data:Buffer.from(source).toString('base64url'),sha256:hash(source)});
      j.retained=[...retained.values()];await this.save();
    }
    const bytes=await this.daytona.download(sandbox,`${root}/result.json`,8192);
    if(bytes){
      let result;try{result=JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('fixture_result_mismatch');}
      assert(result.schema==='gameverse.manager-fixture/1'&&result.task_id===j.task.id&&result.source_commit===j.task.source_commit&&result.source_sha256===hash(fixtureSource)&&result.model_calls===0,'fixture_result_mismatch');
      retained.set('result',{kind:'result',data:Buffer.from(bytes).toString('base64url'),sha256:hash(bytes)});
    }
    j.retained=[...retained.values()];j.collection_confirmed=true;await this.save();
    const complete=retained.has('source')&&retained.has('result');
    return partial?retained.size>0:complete;
  }
  async step(j,{allowNew=true}={}){const mayLaunch=()=>typeof allowNew==='function'?allowNew():allowNew;const t=j.task,root=`/home/daytona/gvm-${t.id}`;
    if(j.phase==='done')return;
    if(j.phase==='stopped'){const stopped=await this.daytona.get(j.sandbox_id||t.sandbox_name);if(stopped)return;await this.report(j,'cancelled',{cleanup_confirmed:true,reason:'stopped_sandbox_absent'});j.phase='done';await this.save();return;}
    if(this.now()>=t.deadline||j.started_at&&this.now()-j.started_at>=t.limits.job_wall_ms){j.cancel=true;j.reason='deadline_exceeded';j.phase='cleaning';j.pending=null;}
    if(j.pending){await this.report(j,j.pending.phase);return;}
    if(j.phase==='queued'){
      if(!mayLaunch())return;j.phase='creating';j.started_at=this.now();await this.save();await this.report(j,'creating');return;}
    if(j.phase==='creating'){
      let sandbox=await this.daytona.get(t.sandbox_name);
      if(!sandbox){if(j.create_sent){j.reason='provisioning_unconfirmed';await this.save();return;}
        if(!mayLaunch())return;j.create_sent=true;await this.save();if(!mayLaunch()){j.create_sent=false;await this.save();return;}sandbox=await this.daytona.createJob(t);}
      this.daytona.owned(sandbox,t);j.sandbox_id=sandbox.id;await this.save();
      if(sandbox.state!=='started')return;
      assert(sandbox.cpu===1&&sandbox.memory===1&&sandbox.disk===3,'unsupported_fixture_resources');
      assert(sandbox.public===false&&sandbox.networkBlockAll===(t.kind!=='voice-agent'),'unsafe_fixture_network');
      const expiry=Date.parse(sandbox.autoDestroyAt),created=Date.parse(sandbox.createdAt),ceiling=(Math.ceil(t.limits.job_wall_ms/60000)+1)*60000;
      assert(Number.isFinite(created)&&Number.isFinite(expiry)&&expiry>this.now()&&expiry<=created+ceiling+5000,'remote_deadline_unconfirmed');j.phase='preparing';j.timings.provision_ms=this.now()-j.started_at;await this.save();await this.report(j,'preparing');return;}
    const sandbox=await this.daytona.get(j.delete_target_id||j.sandbox_id||t.sandbox_id||t.sandbox_name);
    if(j.phase==='cleaning'&&j.delete_target_id&&sandbox){
      assert(sandbox.id===j.delete_target_id,'sandbox_identity_mismatch');
      // Deletion can rename the resource and remove its runtime. Only observe its recorded ID until absent.
      if(['destroying','destroyed'].includes(sandbox.state))return;
    }
    if(sandbox)this.daytona.owned(sandbox,t);
    if(j.phase==='preparing'){
      assert(sandbox?.state==='started','sandbox_not_ready');j.phase='setup_sent';await this.save();
      const r=await this.daytona.execute(sandbox,`mkdir -p ${root} && chmod 700 ${root}`,10);assert(r.exitCode===0,'fixture_setup_failed');
      if(t.kind==='voice-agent'){
        const pkg=await voicePackage(t.source_commit),permit=await this.transport.device({op:'voice-launch',id:t.id});
        const broker=new URL(this.daytona.voiceBroker||this.transport.url);assert(broker.origin==='https://gameverse.build'||this.daytona.allowVoiceTestBroker===true&&broker.protocol==='https:'&&broker.hostname.endsWith('.daytonaproxy01.net'),'untrusted_voice_broker');
        const launch={task_id:t.id,source_commit:t.source_commit,session_id:t.voice.session_id,deadline:Math.min(t.deadline,j.started_at+t.limits.job_wall_ms),url:new URL('/api/browser-voice/worker/'+t.id,broker).href,token:permit.token,synthetic:permit.synthetic===true};
        for(const [name,text] of [...pkg.files,['verify.mjs',voiceVerifier],['launch.json',JSON.stringify(launch)]])await this.daytona.upload(sandbox,`${root}/${name}`,new TextEncoder().encode(text));
      }else for(const [name,text] of [['worker.mjs',fixtureRuntime],['verify.mjs',fixtureVerifier],['request.json',JSON.stringify({id:t.id,source_commit:t.source_commit,limits:t.limits})]])await this.daytona.upload(sandbox,`${root}/${name}`,new TextEncoder().encode(text));
      j.phase='prepared';await this.save();return;}
    if(j.phase==='setup_sent'){j.reason='setup_outcome_unknown';j.phase='cleaning';await this.save();return;}
    if(j.phase==='prepared'){
      if(!mayLaunch())return;j.phase='announcing';await this.save();}
    if(j.phase==='announcing'){
      if(!mayLaunch())return;if(!j.running_announced)await this.report(j,'running');assert(sandbox?.state==='started','sandbox_not_ready');j.phase='executing';j.execute_sent=true;await this.save();if(!mayLaunch()){j.phase='announcing';j.execute_sent=false;await this.save();return;}
      const started=this.now(),r=await this.daytona.execute(sandbox,t.kind==='voice-agent'?`cd ${root} && nohup node voice-worker.mjs > worker.log 2>&1 < /dev/null &`:`cd ${root} && node worker.mjs`,Math.min(30,Math.max(1,Math.floor(t.limits.job_wall_ms/1000))));j.timings.execution_ms=this.now()-started;
      assert(r.exitCode===0,'fixture_execution_failed');j.phase=t.kind==='voice-agent'?'executing':'collecting';await this.save();return;}
    if(j.phase==='executing'){
      // A lost execute response is reconciled by output; never execute again.
      if(!sandbox){j.reason='sandbox_lost';j.phase='cleaning';await this.save();return;}
      const result=await this.daytona.download(sandbox,`${root}/result.json`,t.kind==='voice-agent'?24576:8192);if(result){j.phase='collecting';await this.save();}return;}
    if(j.phase==='collecting'){
      assert(sandbox,'sandbox_lost');assert(await this.outputs(j,sandbox,root),'fixture_output_missing');
      j.phase='verifying';j.verify_sent=true;await this.save();const start=this.now();const check=await this.daytona.execute(sandbox,`cd ${root} && node verify.mjs`,5);j.timings.verification_ms=this.now()-start;
      assert(check.exitCode===0,'fixture_verification_failed');j.phase='retaining';await this.save();return;}
    if(j.phase==='verifying'){
      const data=sandbox&&await this.daytona.download(sandbox,`${root}/verification.json`,1024);if(!data)return;assert(JSON.parse(new TextDecoder().decode(data)).passed===true,'verification_outcome_unknown');j.phase='retaining';await this.save();return;}
    if(j.phase==='retaining'){
      for(const a of j.retained)await this.transport.device({op:'artifact',task_id:t.id,...a});
      j.retention_confirmed=true;await this.save();await this.report(j,'retained',{timings:j.timings});j.success=true;j.phase='cleaning';await this.save();return;}
    if(j.phase==='cleaning'){
      // Give the fixed voice worker a bounded chance to write its cancellation receipt.
      if(t.kind==='voice-agent'&&sandbox&&!j.collection_confirmed){j.cleanup_wait_at??=this.now();await this.save();const receipt=await this.daytona.download(sandbox,`${root}/result.json`,24576);if(!receipt&&this.now()-j.cleanup_wait_at<3000)return;}
      // Harvest already completed remote output when cancellation arrives before collection.
      if(!j.collection_confirmed&&sandbox){try{await this.outputs(j,sandbox,root,{partial:true});}catch(e){if(!['fixture_source_mismatch','fixture_result_mismatch','voice_source_mismatch','voice_result_mismatch'].includes(e.message))throw e;j.reason=e.message;j.collection_confirmed=true;}}
      // Retain known local outputs before deletion even if the job was cancelled.
      if(j.retained&&!j.retention_confirmed){for(const a of j.retained)await this.transport.device({op:'artifact',task_id:t.id,...a});j.retention_confirmed=true;await this.save();}
      if(sandbox){
        if(j.action==='stop'){
          await this.daytona.stop(sandbox.id);const stopped=await this.daytona.get(sandbox.id);if(stopped&&stopped.state!=='stopped')return;
          await this.report(j,'stopped',{reason:'explicit_stop',cleanup_confirmed:false});j.phase='stopped';await this.save();return;}
        j.delete_target_id=sandbox.id;await this.save();
        await this.daytona.delete(j.delete_target_id);const after=await this.daytona.get(j.delete_target_id);if(after)return;
      }else if(j.create_sent&&!j.sandbox_id){
        // Creation may still be in flight. Request deletion by stable name; do not reuse the reservation.
        await this.daytona.delete(t.sandbox_name);const after=await this.daytona.get(t.sandbox_name);if(after)return;
      }
      await this.report(j,j.cancel?'cancelled':j.success?'succeeded':'failed',{cleanup_confirmed:true,reason:j.reason||undefined,timings:{...j.timings,total_ms:this.now()-j.start}});
      j.phase='done';j.finished_at=this.now();await this.save();return;}
  }
  async advance(options={}){for(const j of Object.values(this.jobs)){if(typeof options.allowNew==='function'&&!options.allowNew())break;try{await this.step(j,options);}catch(e){j.reason=reason(e);
      if(e.message==='task_cancelled'){j.pending=null;j.cancel=true;j.phase='cleaning';}
      else if(['unsupported_fixture_resources','unsafe_fixture_network','remote_deadline_unconfirmed','fixture_execution_failed','fixture_verification_failed','verification_outcome_unknown'].includes(e.message)){j.pending=null;j.phase='cleaning';}
      else if(j.pending||['creating','executing','verifying','retaining','cleaning'].includes(j.phase)){/* reconcile the same operation/receipt; no fresh dispatch */}
      else{j.pending=null;j.phase='cleaning';}
      await this.save();}}}
}
