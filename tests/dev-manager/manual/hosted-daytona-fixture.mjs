// Local-only Daytona transport fixture. Never used by production or deployed.
import {createServer} from 'node:http';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {spawn} from 'node:child_process';
export async function fakeDaytona({runWorker=false,directory}={}){
 const dir=directory||await mkdtemp(join(tmpdir(),'gv-fake-daytona-')),sandboxes=new Map(),children=new Set(),stats={creates:0,executes:0,deletes:0,uploads:0,launches:[]};let base;
 const reply=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 const server=createServer(async(req,res)=>{try{const url=new URL(req.url,base),path=url.pathname;
  if(path==='/sandbox'&&req.method==='POST'){let text='';for await(const c of req)text+=c;const body=JSON.parse(text),id=crypto.randomUUID(),row={...body,id,state:'started',cpu:1,memory:1,disk:3,createdAt:new Date().toISOString(),autoDestroyAt:new Date(Date.now()+body.ttlMinutes*60000).toISOString(),toolboxProxyUrl:base};sandboxes.set(id,row);stats.creates++;return reply(res,row);}
  if(path.startsWith('/sandbox/')){const name=decodeURIComponent(path.slice(9)),row=[...sandboxes.values()].find(s=>s.id===name||s.name===name);if(!row)return reply(res,{},404);if(req.method==='DELETE'){sandboxes.delete(row.id);stats.deletes++;return reply(res,{});}return reply(res,row);}
  const [,id,...parts]=path.split('/'),row=sandboxes.get(id);if(!row)return reply(res,{},404);const op='/'+parts.join('/');
  const local=p=>{if(!/^\/home\/daytona\/gv-hosted-[0-9a-f-]{36}\/[a-z.-]+$/.test(p))throw Error('invalid fixture path');return join(dir,id,p);};
  if(op==='/files/upload-v2'){const request=new Request(url,{method:'POST',body:req,duplex:'half',headers:req.headers}),form=await request.formData(),bytes=new Uint8Array(await form.get('file').arrayBuffer()),file=local(url.searchParams.get('path'));await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes);stats.uploads++;return reply(res,{});}
  if(op==='/files/download'){try{const bytes=await readFile(local(url.searchParams.get('path')));res.writeHead(200);return res.end(bytes);}catch(e){if(e.code==='ENOENT')return reply(res,{},404);throw e;}}
  if(op==='/process/execute'){let text='';for await(const c of req)text+=c;const body=JSON.parse(text);if(body.command.includes('nohup')){stats.executes++;const match=body.command.match(/^cd (\/home\/daytona\/gv-hosted-[0-9a-f-]{36}) && nohup node voice-worker.mjs/);if(!match)throw Error('invalid fixture execution');const cwd=dirname(local(match[1]+'/launch.json')),launch=JSON.parse(await readFile(join(cwd,'launch.json')));stats.launches.push(launch);if(runWorker){const child=spawn(process.execPath,['voice-worker.mjs'],{cwd,stdio:'ignore'});children.add(child);child.once('exit',()=>children.delete(child));}}return reply(res,{exitCode:0,result:''});}
  return reply(res,{error:'fixture_route'},404);
 }catch(e){return reply(res,{error:'fixture_error'},500);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 return {base,stats,sandboxes,directory:dir,async stop(){for(const child of children)child.kill('SIGTERM');await new Promise(r=>server.close(r));server.closeAllConnections();if(!directory)await rm(dir,{recursive:true,force:true});}};
}
