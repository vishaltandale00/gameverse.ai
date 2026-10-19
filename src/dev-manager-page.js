// Discovery is exclusively a user action. Cloud history polling never probes loopback.
const node=(tag,value,cls)=>{const n=document.createElement(tag);if(value)n.textContent=value;if(cls)n.className=cls;return n;};
export function createDevManagerPanel({root,api}){
  let account=null,model=null,found=null,last='',busy=false;
  const status=node('p','Start the manager from the repo, then check for it.','small');status.setAttribute('role','status');
  const check=node('button','Check for dev app','primary'),pair=node('form'),code=node('input'),connect=node('button','Connect','primary');
  code.autocomplete='off';code.placeholder='Pairing code from terminal';code.setAttribute('aria-label','Dev app pairing code');code.maxLength=32;code.required=true;connect.type='submit';
  pair.append(code,connect);pair.hidden=true;const list=node('div'),tasks=node('div'),header=node('div');header.append(node('h2','Cloud sandboxes'),node('p','Inspect development work and run a model-free lifecycle check.','small'));
  root.replaceChildren(header,check,status,pair,list,tasks);
  const action=fn=>async e=>{e?.preventDefault();if(busy)return;busy=true;try{await fn();}catch(error){status.textContent=error.message||'Operation unavailable.';}finally{busy=false;}};
  check.addEventListener('click',action(async()=>{
    status.textContent='Checking for dev app…';found=null;pair.hidden=true;
    try{const r=await fetch('http://127.0.0.1:4177/health',{mode:'cors',cache:'no-store',signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error();const health=await r.json();
      if(health.protocol!==1){status.textContent='Update required. Restart the current repo version.';return;}
      found=health;const paired=model?.managers.some(m=>m.id===health.id&&!m.revoked);status.textContent=paired?'Dev app available. Pairing is saved.':'Dev app available. Enter the pairing code printed in its terminal.';pair.hidden=paired;if(model)render();
    }catch{status.textContent='Couldn’t reach dev app. Start it from the repo, allow local-network access if requested, then retry.';}
  }));
  pair.addEventListener('submit',action(async()=>{if(!found)throw Error('Check for dev app first.');await api('/api/dev-manager/pair','POST',{id:found.id,code:code.value.trim()});code.value='';pair.hidden=true;status.textContent='Connected. Pairing survives restarts.';await refresh(account,true);}));
  const confirmation=(owner,id,revision,description)=>{
    if(owner===account.id)return undefined;
    if(!window.confirm(`${description}\nOwner: ${owner}\nThis affects another developer’s work and its active job tree.`))throw Error('Cancelled.');
    return {owner,resource_id:id,revision};};
  function render(){list.replaceChildren();tasks.replaceChildren();
    const manager=model.managers.find(m=>m.id===found?.id&&!m.revoked)||model.managers.find(m=>m.online&&!m.revoked),run=node('button','Run lifecycle check','text-button');run.disabled=!manager?.online||found?.id!==manager.id||!found?.source_commit;
    run.addEventListener('click',action(async()=>{await api('/api/dev-manager/tasks','POST',{id:crypto.randomUUID(),manager_id:manager.id,role:'parent',source_commit:found.source_commit,limits:{wall_ms:300000,job_wall_ms:60000,max_jobs:3,max_sandboxes:2,model_calls:0}});status.textContent='Lifecycle check queued. No model calls.';await refresh(account,true);}));
    list.append(run);
    for(const m of model.managers){const row=node('div',`${m.id.slice(0,8)} · ${m.revoked?'Disconnected':m.online?'Online':'Offline / last known'}`,'run-card');
      if(!m.revoked){const revoke=node('button','Disconnect','text-button');revoke.addEventListener('click',action(async()=>{await api('/api/dev-manager/revoke','POST',{id:m.id});status.textContent='Pairing revoked. Existing jobs remain bounded; new launches are blocked.';await refresh(account,true);}));row.append(revoke);}list.append(row);}
    for(const item of model.inventory){const row=node('article',null,'run-card');row.append(node('strong',item.name||item.id),node('p',`${item.state} · ${item.managed?'Managed development sandbox':'External · read only'} · last seen ${new Date(item.seen_at).toLocaleTimeString()}`,'small'));
      if(item.managed&&manager?.online&&!['deleted','absent','destroyed'].includes(item.state))for(const type of ['stop','delete']){const button=node('button',type==='stop'?'Stop':'Delete','text-button');button.addEventListener('click',action(async()=>{const proof=confirmation(item.owner,item.id,item.seen_at,`${type} ${item.name}?`);await api('/api/dev-manager/manage','POST',{manager_id:manager.id,sandbox_id:item.id,action:type,confirmation:proof});status.textContent='Management requested. Waiting for confirmed outcome.';await refresh(account,true);}));row.append(button);}list.append(row);}
    for(const task of model.tasks){const row=node('article',null,'run-card');row.append(node('strong',`Lifecycle ${task.id.slice(0,8)} · ${task.phase}`),node('p',`${task.role} · ${task.cleanup_confirmed?'Cleanup confirmed':'Cleanup pending'}${task.reason?' · '+task.reason:''}`,'small'));
      if(!['succeeded','failed','cancelled'].includes(task.phase)){const cancel=node('button','Cancel job tree','text-button');cancel.addEventListener('click',action(async()=>{const proof=confirmation(task.owner,task.id,task.updated_at,'Cancel this job tree?');await api('/api/dev-manager/cancel','POST',{id:task.id,confirmation:proof});await refresh(account,true);}));row.append(cancel);}
      if(task.owner===account.id)for(const a of task.artifacts){const link=node('a',`Download ${a.kind}`,'text-button');link.href=`/api/dev-manager/tasks/${task.id}/artifacts/${a.sha256}`;row.append(link);}tasks.append(row);}
  }
  async function refresh(next,force=false){account=next;root.hidden=!account?.developer;if(root.hidden){model=null;last='';return;}
    try{const value=await api('/api/dev-manager');const fingerprint=JSON.stringify(value);model=value;if(force||fingerprint!==last){last=fingerprint;render();}}
    catch{status.textContent='Sandbox manager backend is not configured on this host yet.';}
  }
  return {refresh};
}
