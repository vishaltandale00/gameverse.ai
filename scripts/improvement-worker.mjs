// Private local supervisor: restart control uses an authenticated endpoint, never a persisted PID.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile,writeFile,rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const save=async(path,value)=>{const temporary=`${path}.${randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,path);};
export async function ownerState(path){
  let owner;try{owner=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(owner.state==='terminal')return owner;
  if(owner.state!=='running'||!Number.isInteger(owner.port)||typeof owner.token!=='string')return {...owner,state:'unknown'};
  try{const response=await fetch(`http://127.0.0.1:${owner.port}/status`,{headers:{authorization:`Bearer ${owner.token}`},signal:AbortSignal.timeout(1000)});if(!response.ok)throw Error();const live=await response.json();if(live.token!==owner.token)throw Error();return {...owner,...live};}catch{return {...owner,state:'unknown'};}
}
export async function stopOwner(path,reason='cancelled'){
  let owner=await ownerState(path);
  for(let attempt=0;owner?.state==='unknown'&&owner.port===undefined&&attempt<40;attempt++){await new Promise(resolve=>setTimeout(resolve,25));owner=await ownerState(path);}
  if(!owner||owner.state==='terminal')return false;
  if(owner.state!=='running')throw Error('Worker ownership cannot be safely verified.');
  const response=await fetch(`http://127.0.0.1:${owner.port}/cancel`,{method:'POST',headers:{authorization:`Bearer ${owner.token}`,'content-type':'application/json'},body:JSON.stringify({reason}),signal:AbortSignal.timeout(1000)});
  if(!response.ok)throw Error('Worker did not accept cancellation.');return true;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [path,command,...args]=process.argv.slice(2),token=process.env.GAMEVERSE_WORKER_TOKEN;
  if(!path||!command||!token)process.exit(2);
  let child,stopping=null,finished=false;
  const stop=reason=>{stopping=reason;if(child&&child.exitCode===null&&child.signalCode===null){try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}};
  const server=http.createServer((req,res)=>{
    if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(403).end();return;}
    if(req.method==='GET'&&req.url==='/status'){res.setHeader('content-type','application/json');res.end(JSON.stringify({token,state:'running'}));}
    else if(req.method==='POST'&&req.url==='/cancel'){let body='';req.on('data',chunk=>{body+=chunk;if(body.length>256)req.destroy();});req.on('end',()=>{let reason='cancelled';try{const requested=JSON.parse(body).reason;if(['shutdown','timeout','cancelled'].includes(requested))reason=requested;}catch{}res.end('{}');stop(reason);});}
    else res.writeHead(404).end();
  });
  const finish=async(code,error)=>{if(finished)return;finished=true;clearTimeout(timer);await save(path,{schema:'gameverse.worker-owner/1',state:'terminal',token,exit_code:code,stop_reason:stopping,error:!!error,finished_at:new Date().toISOString()});server.close(()=>process.exit(error?1:code??(stopping?143:1)));};
  let timer;
  server.on('error',error=>{void finish(2,error);});
  server.listen(0,'127.0.0.1',async()=>{
    await save(path,{schema:'gameverse.worker-owner/1',state:'running',token,port:server.address().port});
    child=spawn(command,args,{cwd:process.cwd(),detached:true,stdio:'ignore',env:{...process.env,GAMEVERSE_WORKER_TOKEN:''}});
    child.on('error',error=>{void finish(null,error);});child.on('close',code=>{void finish(code);});
    timer=setTimeout(()=>stop('timeout'),Number(process.env.GAMEVERSE_WORKER_TIMEOUT_MS)||300000);
  });
  process.on('SIGTERM',()=>stop('shutdown'));process.on('SIGINT',()=>stop('shutdown'));
}
