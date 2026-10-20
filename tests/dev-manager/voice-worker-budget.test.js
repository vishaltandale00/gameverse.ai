import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {mkdtemp,cp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawn} from 'node:child_process';
test('fixed worker cannot exceed a smaller admitted provider-attempt budget',{timeout:8000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'gv-voice-budget-'));let providers=0,results=0,child;
 const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const value=JSON.parse(text);let result={};
  if(value.op==='work')result={active:results<2,requests:[],calls:[{id:'one',kind:'decisions',payload:{}},{id:'two',kind:'decisions',payload:{}}]};
  if(value.op==='provider'){providers++;result={answers:[]};}if(value.op==='call-result')results++;
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{child?.kill('SIGTERM');server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 for(const [from,to] of [['scripts/voice-worker/main.mjs','voice-worker.mjs'],['src/voice-agent.js','voice-agent.js'],['src/agent-client.js','agent-client.js']])await cp(from,join(dir,to));
 await writeFile(join(dir,'package.json'),'{"type":"module"}');await writeFile(join(dir,'launch.json'),JSON.stringify({task_id:'fixture',source_commit:'a'.repeat(40),session_id:'fixture-session',deadline:Date.now()+4000,model_calls:1,synthetic:true,url:'http://127.0.0.1:'+server.address().port,token:'public-fixture'}));
 child=spawn(process.execPath,['voice-worker.mjs'],{cwd:dir,stdio:'ignore'});assert.equal(await new Promise(r=>child.once('exit',r)),0);
 const receipt=JSON.parse(await readFile(join(dir,'result.json')));assert.equal(providers,1);assert.equal(receipt.provider_attempts,1);assert.equal(receipt.model_calls,0);assert.equal(results,2);
});
