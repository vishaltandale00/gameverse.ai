import {assert,canonical,publicKey,taskRequest,terminal,UUID,HASH,inventoryEntry} from '../../src/dev-manager-protocol.js';
const fresh = () => ({devices:{},tasks:{},commands:{},inventory:{}});
// All mutation methods are synchronous: the Durable Object commits before yielding.
export class Registry {
  constructor({state=fresh(),save=()=>{},now=()=>Date.now(),id=()=>crypto.randomUUID()}={}) {Object.assign(this,{state,save,now,id});}
  commit(){this.save(this.state);}
  register({id,key,code_hash,capabilities=[],source_commit=null},proof) {
    assert(UUID.test(id)&&HASH.test(code_hash),'invalid_registration');key=publicKey(key);
    assert(Array.isArray(capabilities)&&capabilities.every(c=>['voice-agent'].includes(c)),'invalid_capabilities');
    assert(source_commit===null||/^[a-f0-9]{40}$/.test(source_commit),'invalid_source_commit');
    const old=this.state.devices[id];assert(!old?.owner||old.revoked,'already_paired');
    assert(!old||canonical(old.key)===canonical(key),'device_identity_conflict');
    const nonces=proof?this.nextNonces(old?.nonces||[],proof.nonce,proof.time):old?.nonces||[];
    for(const [other,d] of Object.entries(this.state.devices))if(other!==id&&!d.owner&&d.expires_at<=this.now())delete this.state.devices[other];
    assert(Object.keys(this.state.devices).length<100||old,'registry_limit');
    this.state.devices[id]={id,key,code_hash,capabilities,source_commit,expires_at:this.now()+300000,attempts:0,owner:old?.owner||null,revoked:old?.revoked||false,repair_pending:!!old?.revoked,nonces,last_seen:null};
    this.commit();return {id,expires_at:this.state.devices[id].expires_at};
  }
  device(id){const row=this.state.devices[id];assert(row,'manager_not_found',404);return row;}
  nextNonces(previous,nonce,time){assert(/^[a-f0-9]{32}$/.test(nonce)&&Math.abs(this.now()-Number(time))<=60000,'invalid_signature',401);
    const nonces=previous.filter(n=>n.at>this.now()-120000);assert(!nonces.some(n=>n.nonce===nonce),'signature_replayed',401);
    assert(nonces.length<2000,'device_rate_limit',429);return [...nonces,{nonce,at:this.now()}];}
  nonce(id,nonce,time){const row=this.device(id);row.nonces=this.nextNonces(row.nonces,nonce,time);this.commit();}
  pair(owner,id,code_hash){const row=this.device(id);assert(!row.revoked||row.repair_pending,'pairing_revoked',401);assert(!row.owner||row.owner===owner,'account_mismatch',403);
    if(row.owner&&!row.revoked)return this.summary(row);
    assert(row.expires_at>this.now()&&row.attempts<5,'pairing_expired');row.attempts++;this.commit();
    assert(row.code_hash===code_hash,'pairing_code_invalid');row.owner=owner;row.revoked=false;row.repair_pending=false;delete row.code_hash;row.paired_at=this.now();this.commit();return this.summary(row);}
  summary(row){return {id:row.id,owner:row.owner,paired_at:row.paired_at||null,last_seen:row.last_seen,revoked:row.revoked,online:row.last_seen!==null&&row.last_seen>this.now()-15000,protocol:1,capabilities:row.capabilities||[],source_commit:row.source_commit||null};}
  authorize(id){const row=this.device(id);assert(row.owner&&!row.revoked,'pairing_required',401);return row;}
  capabilities(id,list,source_commit){const row=this.authorize(id);assert(Array.isArray(list)&&list.every(c=>c==='voice-agent')&&/^[a-f0-9]{40}$/.test(source_commit),'invalid_capabilities');row.capabilities=list;row.source_commit=source_commit;this.commit();return this.summary(row);}
  revoke(owner,id){const row=this.device(id);assert(row.owner===owner,'account_mismatch',403);row.revoked=true;this.commit();return this.summary(row);}
  tree(id){const out=[id];for(let i=0;i<out.length;i++)for(const t of Object.values(this.state.tasks))if(t.parent_id===out[i]&&!out.includes(t.id))out.push(t.id);return out;}
  root(task){return task.parent_id?this.state.tasks[task.parent_id]:task;}
  active(task){return !terminal(task.phase)||!task.cleanup_confirmed;}
  submit(owner,input){const request=taskRequest(input),device=this.authorize(request.manager_id);assert(device.owner===owner,'account_mismatch',403);
    if(request.kind==='voice-agent'){const session=this.state.voice?.sessions[request.voice.session_id];assert(session?.owner===owner&&session.manager_id===request.manager_id&&!session.revoked&&device.capabilities?.includes('voice-agent'),'invalid_voice_session');}
    const existing=this.state.tasks[request.id];if(existing){assert(existing.owner===owner&&canonical(existing.request)===canonical(request),'request_conflict');return existing;}
    assert(Object.keys(this.state.tasks).length<500,'task_limit');
    if(request.parent_id){const parent=this.state.tasks[request.parent_id];assert(parent&&parent.owner===owner&&!parent.parent_id&&parent.manager_id===request.manager_id,'invalid_parent');
      assert(this.active(parent)&&!parent.cancel_requested&&!terminal(parent.phase),'parent_inactive');assert(parent.deadline>this.now(),'budget_exhausted');
      assert(!Object.values(this.state.tasks).some(t=>t.parent_id===parent.id&&this.active(t)),'inner_job_in_use');
      const tree=this.tree(parent.id).map(id=>this.state.tasks[id]);assert(tree.length<parent.request.limits.max_jobs,'budget_exhausted');
      assert(tree.filter(t=>this.active(t)).length<parent.request.limits.max_sandboxes,'sandbox_budget_exhausted');
      assert(request.limits.job_wall_ms<=parent.request.limits.job_wall_ms,'budget_exhausted');
    }else assert(!Object.values(this.state.tasks).some(t=>t.owner===owner&&this.active(t)),'parent_in_use');
    const at=this.now(),parent=request.parent_id?this.state.tasks[request.parent_id]:null;
    const row={...request,request,owner,phase:'queued',created_at:at,updated_at:at,deadline:Math.min(at+request.limits.wall_ms,parent?.deadline||Infinity),cancel_requested:false,cleanup_confirmed:false,sequence:0,artifacts:[],events:[],sandbox_name:`gvm-${request.id}`};
    this.state.tasks[row.id]=row;this.command(row.manager_id,'fixture',{task_id:row.id});this.commit();return row;}
  command(manager_id,op,data){const id=this.id();this.state.commands[id]={id,manager_id,op,...data,created_at:this.now(),done:false};return id;}
  task(id){const row=this.state.tasks[id];assert(row,'task_not_found',404);return row;}
  confirm(actor,owner,confirmation,resource,revision){if(actor!==owner)assert(confirmation?.owner===owner&&confirmation.resource_id===resource&&confirmation.revision===revision,'cross_owner_confirmation_required',409);}
  cancel(actor,id,confirmation){const root=this.task(id);this.confirm(actor,root.owner,confirmation,id,root.updated_at);
    for(const taskId of this.tree(id)){const row=this.task(taskId);if(terminal(row.phase)&&row.cleanup_confirmed)continue;
      row.cancel_requested=true;row.phase='cancelling';row.updated_at=this.now();
      if(!Object.values(this.state.commands).some(c=>c.op==='cancel'&&c.task_id===taskId&&!c.done))this.command(row.cleanup_manager_id||row.manager_id,'cancel',{task_id:taskId});}
    this.commit();return this.task(id);}
  sync(id,entries){const device=this.authorize(id);assert(Array.isArray(entries)&&entries.length<=100,'invalid_inventory');
    for(const raw of entries){const item=inventoryEntry(raw);const task=Object.values(this.state.tasks).find(t=>t.sandbox_id===item.id&&t.sandbox_name===item.name);
      this.state.inventory[item.id]={...item,seen_at:this.now(),reporter:id,managed:!!task,owner:task?.owner||null,task_id:task?.id||null,parent_id:task?.parent_id||null};}
    device.last_seen=this.now();this.commit();return {synced:entries.length};}
  manage(actor,{manager_id,sandbox_id,action,confirmation}){const device=this.authorize(manager_id);assert(device.owner===actor,'account_mismatch',403);
    assert(['stop','delete'].includes(action),'invalid_action');const item=this.state.inventory[sandbox_id];assert(item?.managed,'external_sandbox_read_only',403);
    const task=this.task(item.task_id);this.confirm(actor,task.owner,confirmation,sandbox_id,item.seen_at);
    // Management also fences this task's descendants. An online colleague can execute cleanup, not acquire provider access.
    this.cancel(task.owner,task.id);const ids=this.tree(task.id);
    for(const id of ids){const t=this.task(id);t.cleanup_manager_id=manager_id;for(const c of Object.values(this.state.commands))if(c.task_id===id)c.done=true;
      this.command(manager_id,'manage',{task_id:id,action:id===task.id?action:'delete'});}
    this.commit();return {accepted:true,task_id:task.id};}
  poll(id){const device=this.authorize(id);device.last_seen=this.now();this.commit();return {owner:device.owner,tasks:Object.values(this.state.tasks).filter(t=>t.owner===device.owner).slice(-80),commands:Object.values(this.state.commands).filter(c=>c.manager_id===id&&!c.done).slice(0,20).map(c=>({...c,task:this.task(c.task_id)}))};}
  report(id,input){const device=this.authorize(id),command=this.state.commands[input.command_id];assert(command&&command.manager_id===id,'command_not_found',404);
    const task=this.task(command.task_id);assert(device.owner===task.owner||command.op==='manage'||task.cleanup_manager_id===id&&task.cancel_requested,'account_mismatch',403);assert(!task.cleanup_manager_id||task.cleanup_manager_id===id,'cleanup_delegated',409);
    assert(Number.isSafeInteger(input.sequence)&&input.sequence>=1,'invalid_sequence');
    assert(Object.keys(input).every(k=>['command_id','sequence','phase','cleanup_confirmed','reason','sandbox_id','timings'].includes(k)),'invalid_report');
    if(input.timings)assert(Object.entries(input.timings).every(([k,v])=>['provision_ms','execution_ms','verification_ms','total_ms'].includes(k)&&Number.isFinite(v)&&v>=0),'invalid_timings');
    const reportHash=canonical(input);if(input.sequence===task.sequence){assert(task.last_report===reportHash,'report_conflict');return task;}
    assert(input.sequence===task.sequence+1,'report_out_of_order');
    assert(['creating','preparing','running','retained','cleaning','succeeded','failed','cancelled','stopped','cleanup_unknown'].includes(input.phase),'invalid_phase');
    assert(!task.cancel_requested||['cleaning','cancelled','stopped','cleanup_unknown'].includes(input.phase),'task_cancelled');
    if(input.phase==='succeeded')assert(task.artifacts.length>=2,'retention_required');
    if(terminal(input.phase))assert(input.cleanup_confirmed===true,'cleanup_unconfirmed');
    if(input.sandbox_id){assert(UUID.test(input.sandbox_id),'invalid_sandbox');assert(!task.sandbox_id||task.sandbox_id===input.sandbox_id,'sandbox_conflict');task.sandbox_id=input.sandbox_id;}
    task.sequence=input.sequence;task.last_report=reportHash;task.phase=input.phase;task.updated_at=this.now();
    task.reason=typeof input.reason==='string'&&/^[a-z0-9_]{1,80}$/.test(input.reason)?input.reason:null;
    task.cleanup_confirmed=input.cleanup_confirmed===true;const item=this.state.inventory[task.sandbox_id];if(item&&(task.cleanup_confirmed||input.phase==='stopped')){item.state=task.cleanup_confirmed?'deleted':'stopped';item.seen_at=this.now();}task.timings=input.timings||task.timings||null;
    task.events.push({phase:input.phase,at:this.now(),sequence:input.sequence});task.events=task.events.slice(-30);
    if(terminal(task.phase))for(const c of Object.values(this.state.commands))if(c.task_id===task.id)c.done=true;
    if(input.phase==='stopped')for(const c of Object.values(this.state.commands))if(c.task_id===task.id)c.done=true;
    this.commit();return task;}
  artifact(id,taskId,{sha256,kind,bytes},commit=true){const device=this.authorize(id),task=this.task(taskId);assert(device.owner===task.owner&&task.manager_id===id||task.cleanup_manager_id===id&&task.cancel_requested,'account_mismatch',403);
    assert(HASH.test(sha256)&&['result','source'].includes(kind)&&Number.isSafeInteger(bytes)&&bytes>0&&bytes<=65536,'invalid_artifact');
    const old=task.artifacts.find(a=>a.kind===kind);if(old)assert(old.sha256===sha256&&old.bytes===bytes,'artifact_conflict');else if(commit)task.artifacts.push({sha256,kind,bytes});if(commit)this.commit();return {stored:true};}
  view(owner){return {protocol:1,managers:Object.values(this.state.devices).filter(d=>d.owner===owner).map(d=>this.summary(d)),
    inventory:Object.values(this.state.inventory).map(item=>({...item,state:this.state.tasks[item.task_id]?.cleanup_confirmed?'deleted':item.state})),tasks:Object.values(this.state.tasks).map(({last_report,request,...t})=>t).sort((a,b)=>b.created_at-a.created_at).slice(0,60)};}
}
