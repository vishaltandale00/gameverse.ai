// Trusted fixed worker. No arbitrary source or model-written command is executed here.
import {readFile,writeFile,rename} from 'node:fs/promises';
import {VoiceAgent} from './voice-agent.js';import {createPlanner} from './agent-client.js';
const launch=JSON.parse(await readFile(new URL('./launch.json',import.meta.url))),started=Date.now(),pending=new Set(),events=[];let attempts=0,stopping=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const record=(event,data={})=>{events.push({event,at:Date.now(),...data});if(events.length>80)events.shift();};
const call=async value=>{if(Date.now()>=launch.deadline)throw Error('voice_deadline');const r=await fetch(launch.url,{method:'POST',headers:{Authorization:'Bearer '+launch.token,'Content-Type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(Math.min(28000,Math.max(1,launch.deadline-Date.now())))});const data=await r.json();if(!r.ok)throw Error(data.error?.code||'voice_broker_failed');return data;};
const provide=async(id,kind,payload)=>{attempts++;record('provider-requested',{id,kind});const value=await call({op:'provider',id,kind,payload});if(value.error)throw Error(value.error);return value;};
async function request(row){
  const claimed=await call({op:'claim',id:row.id});if(!claimed.claimed)return;record('voice-request',{id:row.id});
  try{
    const transcription=await provide(row.id+':asr','transcribe',{request_id:row.id});await call({op:'transcript',id:row.id,text:transcription.text});
    let approved=false;while(!stopping&&Date.now()<launch.deadline){const work=await call({op:'work'});if(!work.active)throw Error('voice_session_revoked');const current=work.requests.find(r=>r.id===row.id);if(!current||current.cancelled)throw Error('voice_request_cancelled');if(current.approved){approved=true;break;}await sleep(100);}if(!approved)throw Error('voice_request_cancelled');
    let sequence=0,snapshot=claimed.snapshot;
    const invoke=async(name,args)=>{const id=row.id+':'+(++sequence),command=await call({op:'command',command:{id,request_id:row.id,name,args}});while(Date.now()<command.expires_at&&!stopping){const value=await call({op:'command-result',id});if(value.ack){if(!value.ack.ok)throw Error(value.ack.error||'browser_tool_rejected');record('browser-tool-ack',{request:row.id,name});return value.ack.result;}if(value.expired)break;await sleep(80);}throw Error('browser_ack_timeout');};
    const host={listGames:()=>snapshot.games,listSessions:filter=>snapshot.sessions.filter(s=>!filter?.gameId||s.gameId===filter.gameId),listRuns:()=>snapshot.runs,
      openSession:async args=>{const result=await invoke('open_session',args);snapshot={...snapshot,sessions:[result]};return result;},
      describeSession:id=>{const value=snapshot.sessions.find(s=>s.sessionId===id);if(!value)throw Error('unknown_session');return value;},
      startRun:({sessionId,surface,goal,role})=>invoke('start_simulated_user',{sessionId,surface,goal,role}),runStatus:runId=>invoke('run_status',{runId}),stopRun:(runId,args)=>invoke('stop_run',{runId,...args})};
    const agent=new VoiceAgent({host,runner:null,plan:createPlanner({fetchImpl:async(path,options)=>new Response(JSON.stringify(await provide(row.id+':plan','plan',JSON.parse(options.body))),{headers:{'Content-Type':'application/json'}})})});
    const result=await agent.handle({requestId:row.id,transcript:transcription.text,context:{gameId:claimed.target.gameId,sessionId:claimed.target.sessionId}});await call({op:'record',id:row.id,record:result});record('voice-completed',{id:row.id,outcome:result.outcome});
  }catch(error){record('voice-failed',{id:row.id,reason:error.message});const result={requestId:row.id,agent:'voice-agent-v1',outcome:'failed',acknowledgment:'The remote voice request could not complete.',toolCalls:[],runs:[],reason:/^[a-z0-9_]+$/.test(error.message)?error.message:'voice_request_failed'};await call({op:'record',id:row.id,record:result}).catch(()=>{});}
}
async function model(row){try{await call({op:'claim-call',id:row.id});const result=await provide(row.id,row.kind,row.payload);await call({op:'call-result',id:row.id,result});}catch(error){await call({op:'call-result',id:row.id,result:{error:'voice_model_failed'}}).catch(()=>{});}}
const dispatched=new Set();let outcome='completed';const deadline=setTimeout(()=>{stopping=true;},Math.max(1,launch.deadline-Date.now()));process.once('SIGTERM',()=>{stopping=true;});process.once('SIGINT',()=>{stopping=true;});
try{while(!stopping&&Date.now()<launch.deadline){const work=await call({op:'work'});if(!work.active){outcome='released';break;}
  for(const row of [...work.requests.filter(r=>!r.claimed).slice(0,1),...work.calls.slice(0,2)]){if(dispatched.has(row.id)||pending.size>=3)continue;dispatched.add(row.id);const p=(row.kind?model(row):request(row)).finally(()=>pending.delete(p));pending.add(p);}
  await sleep(100);
}}catch(error){outcome='failed';record('worker-failed',{reason:/^[a-z0-9_]+$/.test(error.message)?error.message:'voice_worker_failed'});}finally{
 stopping=true;clearTimeout(deadline);const result={schema:'gameverse.voice-worker-result/1',task_id:launch.task_id,source_commit:launch.source_commit,session_id:launch.session_id,started_at:started,finished_at:Date.now(),outcome,provider_attempts:attempts,model_calls:launch.synthetic?0:attempts,synthetic:launch.synthetic,events,node:process.version,platform:process.platform,arch:process.arch};await writeFile('result.tmp',JSON.stringify(result));await rename('result.tmp','result.json');process.exit(0);
}
