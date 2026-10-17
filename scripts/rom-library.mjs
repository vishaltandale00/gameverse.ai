// Private, content-addressed originals. No model calls and no cartridge download API.
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,open,readFile,rename,unlink,readdir,lstat,realpath} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
const fail=(status,code,message)=>Object.assign(Error(message),{status,code});
const digest=s=>createHash('sha256').update(s).digest('hex');
const validHash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const validId=s=>typeof s==='string'&&/^[a-f0-9-]{36}$/.test(s);
const aliases={'pokemon-leafgreen':'pokemon-leafgreen-version','pokemon-emerald':'pokemon-emerald-version'};
export function createRomLibrary({root,runtimeRoot=root,storageRoot=process.env.GAMEVERSE_ROM_LIBRARY_ROOT||join(root,'local-data/rom-library'),prepareRecipe,maxUploadBytes=32*1024*1024,timeoutMs=180000}={}){
 if(!root||!Number.isSafeInteger(maxUploadBytes)||maxUploadBytes<192||maxUploadBytes>32*1024*1024||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw Error('Invalid ROM library limits');
 let registry,base,initialization,uploading=false,active=null,preparing=false;const verified=new Map();
 async function ready(){return initialization??=(async()=>{
  registry??=JSON.parse(await readFile(join(root,'games/rom-identities.json'),'utf8')).originals;
  if(!base){const requested=resolve(storageRoot);await mkdir(requested,{recursive:true,mode:0o700});const info=await lstat(requested);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Unsafe ROM storage root');base=await realpath(requested);for(const name of ['originals','receipts','jobs','fixtures']){const p=join(base,name);await mkdir(p,{recursive:true,mode:0o700});const s=await lstat(p);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Unsafe ROM storage directory');}}
 })();}
 async function safeFile(p){const s=await lstat(p);if(!s.isFile()||s.isSymbolicLink())throw Error('Unsafe ROM library record');const actual=await realpath(p);if(!actual.startsWith(base+sep))throw Error('Unsafe ROM library path');return actual;}
 async function read(p){await safeFile(p);return JSON.parse(await readFile(p,'utf8'));}
 async function save(p,data){const tmp=join(base,`.${randomUUID()}.tmp`);await writeExclusive(tmp,JSON.stringify(data,null,2)+'\n');await rename(tmp,p);}
 async function writeExclusive(p,bytes){const f=await open(p,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}}
 const receiptPath=sha=>join(base,'receipts',sha+'.json');
 async function receipt(sha){if(!validHash(sha))throw fail(404,'not_found','Original not found.');try{return await read(receiptPath(sha));}catch(e){if(e.code==='ENOENT')throw fail(404,'not_found','Original not found.');throw e;}}
 async function verifyStored(row){const p=join(base,'originals',row.sha256+'.gba');await safeFile(p);const f=await open(p,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await f.stat();if(info.size!==row.size_bytes)throw Error('Stored original size changed');const stamp=[info.size,info.mtimeMs,info.ctimeMs,info.ino].join(':');if(verified.get(row.sha256)===stamp)return p;const h=createHash('sha256');for await(const bytes of f.createReadStream())h.update(bytes);if(h.digest('hex')!==row.sha256)throw Error('Stored original digest changed');verified.set(row.sha256,stamp);}finally{await f.close();}return p;}
 async function upload(req){await ready();if(uploading)throw fail(409,'upload_busy','Another original is being validated.');if(!String(req.headers?.['content-type']||'').split(';')[0].trim().match(/^application\/(octet-stream|x-gameboy-advance-rom)$/))throw fail(415,'binary_required','Send the .gba file as application/octet-stream.');
  const declared=Number(req.headers?.['content-length']);if(Number.isFinite(declared)&&declared>maxUploadBytes)throw fail(413,'too_large','Original exceeds the 32 MiB upload limit.');
  uploading=true;const started=performance.now(),receivedAt=new Date().toISOString(),temp=join(base,'.upload-'+randomUUID());let f,size=0,header=Buffer.alloc(0);const sha1=createHash('sha1'),sha256=createHash('sha256');let timer;
  try{f=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);timer=setTimeout(()=>req.destroy?.(Error('Upload timed out')),60000);timer.unref?.();
   for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>maxUploadBytes)throw fail(413,'too_large','Original exceeds the upload limit.');if(header.length<192)header=Buffer.concat([header,bytes.subarray(0,192-header.length)]);sha1.update(bytes);sha256.update(bytes);await f.writeFile(bytes);}
   await f.sync();await f.close();f=null;const h1=sha1.digest('hex'),h256=sha256.digest('hex');
   const identity=registry.find(r=>r.sha1===h1&&r.size_bytes===size&&header.subarray(0xac,0xb0).toString('ascii')===r.game_code&&header[0xbc]===r.version&&header.subarray(0xa0,0xac).toString('ascii').replaceAll('\0','').trim()===r.title);
   if(!identity)throw fail(422,'unrecognized_original','Unrecognized or modified original. Only the listed exact game revisions have deterministic recipes.');
   try{const previous=await receipt(h256);await verifyStored(previous);return {...previous,duplicate:true};}catch(e){if(e.code!=='not_found')throw e;}
   const target=join(base,'originals',h256+'.gba');try{await verifyStored({sha256:h256,size_bytes:size});}catch(e){if(e.code!=='ENOENT')throw e;}
   try{await lstat(target);}catch(e){if(e.code!=='ENOENT')throw e;await rename(temp,target);}const row={schema:'gameverse.rom-original/1',sha256:h256,sha1:h1,game_id:identity.id,title:identity.title,game_code:identity.game_code,revision:identity.version,size_bytes:size,status:'available',received_at:receivedAt,model_calls:false,preparation:{status:'not-prepared'},timings:{upload_validation_ms:Math.round(performance.now()-started),queue_ms:null}};await save(receiptPath(h256),row);return {...row,duplicate:false};
  }finally{clearTimeout(timer);await f?.close();await unlink(temp).catch(()=>{});uploading=false;}
 }
 async function list(){await ready();const rows=[];for(const e of (await readdir(join(base,'receipts'))).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).slice(0,registry.length)){const row=await read(join(base,'receipts',e));try{await verifyStored(row);rows.push(row);}catch{}}
  return {schema:'gameverse.rom-library/1',model_calls:false,originals:registry.map(r=>{const row=rows.find(x=>x.sha1===r.sha1);return {id:r.id,title:r.title,game_code:r.game_code,revision:r.version,size_bytes:r.size_bytes,sha1:r.sha1,status:row?'available':'missing',...(row?{sha256:row.sha256,preparation:row.preparation}:{})};}),limits:{max_upload_bytes:maxUploadBytes,concurrent_uploads:1,concurrent_preparations:1,preparation_timeout_ms:timeoutMs},scope:'Known original identity and deterministic fixtures; source/toolchains are separate prerequisites. No behavior IR reconstruction is implied.'};
 }
 async function resolveOriginal(id){await ready();id=aliases[id]||id;const inventory=await list(),row=inventory.originals.find(r=>r.status==='available'&&(r.id===id||r.sha1===id));if(!row)return null;const stored=await receipt(row.sha256);return {path:await verifyStored(stored),sha1:stored.sha1,sha256:stored.sha256,game_id:stored.game_id,revision:stored.revision};}
 async function job(id){await ready();if(!validId(id))throw fail(404,'not_found','Preparation job not found.');let row;try{row=await read(join(base,'jobs',id+'.json'));}catch(e){if(e.code==='ENOENT')throw fail(404,'not_found','Preparation job not found.');throw e;}if(row.status==='running'&&active?.id!==id)return {...row,status:'interrupted',error:{code:'worker_interrupted',message:'Server stopped; retry explicitly.'}};return row;}
 async function prepare(sha){if(preparing)throw fail(409,'preparation_busy','Preparation admission is running.');preparing=true;try{await ready();const original=await receipt(sha),romPath=await verifyStored(original);if(active){if(active.sha===sha)return job(active.id);throw fail(409,'preparation_busy','A deterministic preparation is already running.');}
  const id=randomUUID(),started=performance.now(),directory=join(base,'fixtures',id),controller=new AbortController(),record={schema:'gameverse.rom-preparation/1',job_id:id,sha256:sha,game_id:original.game_id,status:'running',model_calls:false,started_at:new Date().toISOString(),artifacts:[],remaining_inputs:[],recipe:{id:'validated-original-source-binding',version:1},timings:{total_ms:null,queue_ms:null,build_ms:null,simulation_ms:null,evaluation_ms:null,attempts:1,accounting:'All preparation work is nested within total_ms; unsupported stage measurements are unavailable.'}};
  await mkdir(directory,{mode:0o700});await save(join(base,'jobs',id+'.json'),record);original.preparation={status:'running',job_id:id};await save(receiptPath(sha),original);active={id,sha,controller};
  const timer=setTimeout(()=>controller.abort('timeout'),timeoutMs);timer.unref?.();
  void(async()=>{try{if(!prepareRecipe){record.status='blocked';record.remaining_inputs=['Install a deterministic native asset recipe and its pinned source metadata.'];}else{const identity=registry.find(r=>r.sha1===original.sha1);const result=await prepareRecipe({identity,romPath,directory,runtimeRoot,signal:controller.signal});const {status,...evidence}=result;Object.assign(record,evidence,{status:['completed','blocked'].includes(status)?status:'failed'});}
   if(controller.signal.aborted){record.status=controller.signal.reason==='timeout'?'failed':'cancelled';record.error={code:String(controller.signal.reason),message:'Preparation stopped; evidence retained.'};}
  }catch(e){record.status=controller.signal.aborted&&controller.signal.reason!=='timeout'?'cancelled':'failed';record.error={code:e.code||'preparation_failed',message:String(e.message).replaceAll(directory,'[private fixture]').replaceAll(romPath,'[private original]').slice(0,500)};}
  finally{clearTimeout(timer);record.finished_at=new Date().toISOString();record.timings={...record.timings,total_ms:Math.round(performance.now()-started)};await save(join(base,'jobs',id+'.json'),record);original.preparation={status:record.status,job_id:id,artifact_count:record.artifacts?.length||0};await save(receiptPath(sha),original);active=null;}})().catch(()=>{active=null;});return record;}finally{preparing=false;}
 }
 async function cancel(id){const row=await job(id);if(active?.id===id)active.controller.abort('cancelled');return {...row,cancel_requested:active?.id===id};}
 return {upload,list,prepare,job,cancel,resolveOriginal,shutdown:()=>active?.controller.abort('shutdown')};
}
