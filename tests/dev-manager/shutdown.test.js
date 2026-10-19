import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../../scripts/dev-manager/store.mjs';
import {identity} from '../../scripts/dev-manager/transport.mjs';

test('SIGTERM holds the journal lock until in-flight work drains and prevents fresh dispatch',{timeout:15000},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'gvm-shutdown-'));
  const store=new Store(directory);await store.init();
  const ident=await identity(store);ident.paired=true;await store.write('identity.json',ident);
  const input={id:crypto.randomUUID(),manager_id:ident.id,parent_id:null,role:'parent',source_commit:'6dc3a480c254b9a07ba6979ada68bc9ec992539f',limits:{wall_ms:300000,job_wall_ms:60000,max_jobs:3,max_sandboxes:2,model_calls:0}};
  const task={...input,request:input,owner:'test-owner',phase:'queued',sequence:0,deadline:Date.now()+60000,sandbox_name:'gvm-'+input.id};
  const command={id:crypto.randomUUID(),manager_id:ident.id,op:'fixture',task};
  let releaseResponse,reportHeld,output='',daytonaCalls=0;
  const holding=new Promise(resolve=>{reportHeld=resolve;});
  const server=http.createServer(async(req,res)=>{
    let text='';for await(const part of req)text+=part;const value=text?JSON.parse(text):{};
    const send=result=>{if(res.writableEnded)return;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));};
    if(value.op==='poll')return send({owner:task.owner,tasks:[task],commands:[command]});
    if(value.op==='report'){releaseResponse=()=>send({sequence:value.report.sequence});reportHeld();return;}
    if(req.url.startsWith('/sandbox')){daytonaCalls++;return send([]);}send({});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const reservation=http.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const child=spawn(process.execPath,['scripts/dev-manager.mjs'],{env:{...process.env,DAYTONA_API_KEY:'synthetic',APP_ENV:'test',DAYTONA_API_URL:url,GAMEVERSE_MANAGER_URL:url,GAMEVERSE_MANAGER_ALLOW_HTTP:'1',GAMEVERSE_MANAGER_DIR:directory,GAMEVERSE_MANAGER_PORT:String(port),GAMEVERSE_MANAGER_SOURCE_COMMIT:input.source_commit}});
  child.stdout.on('data',bytes=>{output+=bytes;});child.stderr.on('data',bytes=>{output+=bytes;});
  const exited=once(child,'exit');
  t.after(async()=>{releaseResponse?.();if(child.exitCode===null)child.kill('SIGKILL');await exited;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
  await holding;child.kill('SIGTERM');await new Promise(resolve=>setTimeout(resolve,100));
  await assert.rejects(store.lock(),/manager_already_running/);
  assert.equal(output.includes('"status":"stopped"'),false);
  releaseResponse();const [code]=await exited;assert.equal(code,0,output);assert.equal(daytonaCalls,0);
  const unlock=await store.lock();await store.write('journal.json',{replacement:true});await unlock();assert.equal((await store.read('journal.json')).replacement,true);
});
