import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const workspace = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const terminal = new Set(['completed','blocked','failed','cancelled','interrupted']);
const fail = (status,code,message) => Object.assign(Error(message),{status,code});
export function createMashupApi({root=workspace,directory=resolve(root,'local-data/mashup-runs'),pipeline,agent,timeoutMs=1800000}={}) {
  if(!pipeline || !agent || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000) throw Error('Invalid mashup runtime configuration');
  let active=null, admitting=false;
  const folder=id=>resolve(directory,id), path=id=>resolve(folder(id),'run.json');
  async function save(record){const temp=`${path(record.request_id)}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(record,null,2),{mode:0o600});await rename(temp,path(record.request_id));}
  async function status(id){
    if(!uuid(id))throw fail(404,'not_found','Creation request not found.');
    let record;try{record=JSON.parse(await readFile(path(id),'utf8'));}catch(error){if(error.code==='ENOENT')throw fail(404,'not_found','Creation request not found.');throw error;}
    if(!terminal.has(record.status)&&active?.id!==id){record.status='interrupted';record.playable=false;record.error={code:'worker_interrupted',message:'The server stopped. Prior evidence is retained; start a new request to retry.'};}
    record.timings={...record.timings,execution_wall_s:record.timings?.total_s??null,elapsed_wall_s:record.received_at&&record.finished_at?(Date.parse(record.finished_at)-Date.parse(record.received_at))/1000:null};
    const {artifact_path,pipeline_result,...publicRecord}=record;return publicRecord;
  }
  async function capabilities(){const native=await pipeline.capabilities();return {...native,schema:'gameverse.mashup-capabilities/1',auth:await agent.status(),limits:{...native.limits,concurrent_runs:1,wall_ms:timeoutMs,queue:'reject-when-busy'},providers:{creation:'ChatGPT subscription through local Codex',testing:'Separately configured existing S1/S2 testing service'},continuation:typeof pipeline.resume==='function'};}
  async function submit(body, resumePrior=null){
    if(!uuid(body?.request_id)||typeof body.intent!=='string'||!body.intent.trim()||body.intent.length>12000)throw fail(400,'invalid_request','A request UUID and 1–12,000 character game description are required.');
    if(body.source_games!==undefined&&(!Array.isArray(body.source_games)||body.source_games.length>8||body.source_games.some(id=>typeof id!=='string'||!/^[a-z0-9-]{1,100}$/.test(id))))throw fail(400,'invalid_sources','Source games must be known game identifiers.');
    if(body.parent_request_id!==undefined&&!uuid(body.parent_request_id))throw fail(400,'invalid_parent','Invalid parent request.');
    const input={request_id:body.request_id,intent:body.intent.trim(),source_games:body.source_games||[],...(body.parent_request_id?{parent_request_id:body.parent_request_id}:{})},fingerprint=hash(JSON.stringify(input));
    try{if(resumePrior)throw fail(404,'not_found','Resume admitted.');const previous=await status(input.request_id);if(previous.input_sha256!==fingerprint)throw fail(409,'idempotency_conflict','This request ID belongs to another game description.');return previous;}catch(error){if(error.code!=='not_found')throw error;}
    if(active||admitting)throw fail(409,'busy','A game creation is already running. Wait or cancel it before starting another.');
    admitting=true;
    try{
      let parent=null;if(input.parent_request_id){await status(input.parent_request_id);parent=JSON.parse(await readFile(path(input.parent_request_id),'utf8'));}
      await mkdir(folder(input.request_id),{recursive:true});
      const started=performance.now(),controller=new AbortController(),record=resumePrior?{...resumePrior,error:null,finished_at:null,status:'playtesting',playable:false,can_resume:false,resume_count:(resumePrior.resume_count||0)+1}:{schema:'gameverse.mashup-run/1',...input,input_sha256:fingerprint,status:'planning',playable:false,can_resume:false,received_at:new Date().toISOString(),events:[],timings:{total_s:null,queue_s:null,accounting:'Stages are nested in accumulated chunk execution (total_s); elapsed_wall_s includes downtime between chunks. Queue unavailable because requests dispatch directly.'}};
      await save(record);active={id:input.request_id,controller};
      let writes=Promise.resolve();
      const onEvent=event=>{
        if(event?.type==='text')return writes; // Retain final agent response in pipeline evidence; avoid one disk write per token.
        if(event?.threadId)record.construction={threadId:event.threadId,turnId:event.turnId||record.construction?.turnId||null};
        const phase=event?.stage||event?.phase;const stage=({prepare:'planning',compose:'planning',build:'building',boot:'playtesting',model:'playtesting',repair:'repairing'})[phase]||phase||record.status||'planning';
        if(['planning','building','playtesting','repairing'].includes(stage))record.status=stage;
        record.events.push({at:new Date().toISOString(),stage,message:String(event?.message||event?.delta||(event?.itemType?`Construction agent: ${event.itemType}`:'Working')).slice(0,2000)});
        if(record.events.length>200)record.events.splice(0,record.events.length-200);
        writes=writes.then(()=>save(record));return writes;
      };
      const timer=setTimeout(()=>controller.abort('timeout'),timeoutMs);
      void (async()=>{
        try{
          const args={id:input.request_id,intent:input.intent,source_games:input.source_games,directory:folder(input.request_id),parent,prior:resumePrior?.pipeline_result,signal:controller.signal,onEvent};
          const result=await (resumePrior?pipeline.resume(args):pipeline.run(args));
          await writes;record.pipeline_result=result;
          record.status=controller.signal.aborted?'cancelled':result?.status==='playable'?'completed':terminal.has(result?.status)?result.status:'blocked';
          record.can_resume=result?.can_resume===true&&typeof pipeline.resume==='function';record.checkpoint=result?.checkpoint||null;
          record.qualification=result?.qualification||null;record.objective_validated=!controller.signal.aborted&&result?.qualification?.bot?.status==='success'&&result?.design?.request_satisfied===true;record.outcome=record.objective_validated?'native-objective-verified':'native-ready-objective-incomplete';record.evidence=result?.evidence||{design:result?.design||null,provenance:result?.provenance||null,gaps:result?.gaps||[]};record.pipeline_timings=result?.timings||result?.timing||null;record.chunks=[...(resumePrior?.chunks||[]),{number:(resumePrior?.resume_count||0)+(resumePrior?2:1),qualification:record.qualification,evidence:record.evidence,pipeline_timings:record.pipeline_timings,checkpoint:record.checkpoint}];
          record.error=result?.error||(result?.reason?{code:result.reason,message:[result.reason,...(result.gaps||[])].join(': ').slice(0,1500)}:null);
          if(!controller.signal.aborted && record.status==='completed' && result?.qualification?.outcome==='pass' && result.artifact?.path && /^[a-f0-9]{64}$/.test(result.artifact.sha256)){
            const candidate=await realpath(result.artifact.path),own=await realpath(folder(input.request_id)),bytes=await readFile(candidate);
            if(!candidate.startsWith(own+sep)||hash(bytes)!==result.artifact.sha256)throw fail(409,'artifact_mismatch','Candidate artifact could not be verified.');
            record.artifact_path=candidate;record.artifact={title:result.artifact.title||'Your mashup',sha256:hash(bytes),rom_url:`/api/mashup/runs/${input.request_id}/artifacts/rom`,url:`/create?play=${input.request_id}`};record.playable=true;record.outcome=record.objective_validated?'native-objective-verified':'native-ready-objective-incomplete';
          }else {record.outcome='no-playable-candidate';if(record.status==='completed'){record.status='blocked';record.error={code:'qualification_required',message:'A built candidate needs a passing native gameplay receipt before Play is available.'};}}
        }catch(error){record.status=controller.signal.aborted?'cancelled':error.code==='missing_inputs'?'blocked':'failed';record.error={code:controller.signal.aborted?String(controller.signal.reason||'cancelled'):error.code||'creation_failed',message:controller.signal.aborted?'Creation stopped; evidence is retained.':String(error.message||'Creation failed').slice(0,1000),...(error.threadId?{threadId:error.threadId,turnId:error.turnId||null}:{})};}
        finally{clearTimeout(timer);await writes.catch(()=>{});record.finished_at=new Date().toISOString();record.timings={...record.timings,last_chunk_s:(performance.now()-started)/1000,total_s:(resumePrior?.timings?.total_s||0)+(performance.now()-started)/1000};await save(record);if(active?.id===input.request_id)active=null;}
      })().catch(error=>{console.error('Creation receipt persistence failed:',error.code||'unknown');if(active?.id===input.request_id)active=null;});
      return status(input.request_id);
    }finally{admitting=false;}
  }
  async function resume(id){await status(id);const prior=JSON.parse(await readFile(path(id),'utf8'));if(!prior.can_resume||typeof pipeline.resume!=='function')throw fail(409,'resume_unavailable','This run has no verified resumable bot checkpoint.');return submit({request_id:prior.request_id,intent:prior.intent,source_games:prior.source_games,...(prior.parent_request_id?{parent_request_id:prior.parent_request_id}:{})},prior);}
  async function cancel(id){const record=await status(id);if(active?.id===id)active.controller.abort('cancelled');return {...record,cancel_requested:active?.id===id};}
  async function handle(req,res,pathname){
    if(!pathname.startsWith('/api/mashup/'))return false;
    const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    try{
      const host=req.headers.host||'',origin=req.headers.origin;
      if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)||(origin&&origin!==`http://${host}`)||req.headers['sec-fetch-site']==='cross-site')throw fail(403,'local_only','Use the local application origin.');
      const match=/^\/api\/mashup\/runs\/([^/]+)(\/artifacts\/rom|\/resume)?$/.exec(pathname);
      if(req.method==='GET'&&pathname==='/api/mashup/capabilities')json(200,await capabilities());
      else if(req.method==='POST'&&pathname==='/api/mashup/runs'){
        if(!(req.headers['content-type']||'').startsWith('application/json'))throw fail(415,'json_required','Send JSON.');
        let raw='',size=0;for await(const chunk of req){size+=chunk.length;if(size>32768)throw fail(413,'too_large','Request is too large.');raw+=chunk;}
        let body;try{body=JSON.parse(raw);}catch{throw fail(400,'invalid_json','Invalid JSON request.');}json(202,await submit(body));
      }else if(match&&req.method==='POST'&&match[2]==='/resume')json(202,await resume(match[1]));
      else if(match&&req.method==='GET'&&match[2]==='/artifacts/rom'){
        const record=await status(match[1]);if(!record.playable||record.status!=='completed')throw fail(409,'not_playable','This candidate has not passed native qualification.');
        const stored=JSON.parse(await readFile(path(match[1]),'utf8')),candidate=await realpath(stored.artifact_path),own=await realpath(folder(match[1])),bytes=await readFile(candidate);
        if(!candidate.startsWith(own+sep)||hash(bytes)!==record.artifact.sha256)throw fail(409,'artifact_changed','The artifact differs from its immutable receipt.');res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end(bytes);
      }else if(match&&req.method==='GET')json(200,await status(match[1]));
      else if(match&&!match[2]&&req.method==='DELETE')json(202,await cancel(match[1]));
      else json(404,{error:{code:'not_found',message:'Unknown creation route.'}});
    }catch(error){json(error.status||500,{error:{code:error.code||'internal_error',message:error.status?error.message:'Creation service unavailable.'}});}return true;
  }
  return {handle,capabilities,submit,status,cancel,resume,shutdown:async()=>{active?.controller.abort('shutdown');}};
}
