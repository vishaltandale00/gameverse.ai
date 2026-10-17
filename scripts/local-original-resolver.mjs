import {readFile,readdir,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const aliases={'pokemon-leafgreen':'pokemon-leafgreen-version','pokemon-firered':'pokemon-firered-version','pokemon-emerald':'pokemon-emerald-version','pokemon-ruby':'pokemon-ruby-version','pokemon-sapphire':'pokemon-sapphire-version'};
export function createLocalOriginalResolver({root,runtimeRoot,romLibrary}={}){
 if(!root||!runtimeRoot)throw Error('original_resolver_roots_required');
 let identities;const cache=new Map(),inflight=new Map();
 async function inspect(path){
  const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32*1024*1024)return null;
  const stamp=[info.ino,info.size,info.mtimeMs,info.ctimeMs].join(':');if(cache.get(path)?.stamp===stamp)return cache.get(path).value;
  const bytes=await readFile(path),after=await lstat(path);if([after.ino,after.size,after.mtimeMs,after.ctimeMs].join(':')!==stamp)throw Error('original_changed_during_capture');
  const value={path:await realpath(path),sha1:createHash('sha1').update(bytes).digest('hex'),sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,header:Buffer.from(bytes.subarray(0xa0,0xc0))};cache.set(path,{stamp,value});return value;
 }
 async function find(id){
  const uploaded=await romLibrary?.resolveOriginal(id);if(uploaded)return uploaded;
  identities??=JSON.parse(await readFile(join(root,'games/rom-identities.json'),'utf8')).originals;
  const row=identities.find(r=>r.id===(aliases[id]||id)||r.sha1===id);if(!row)return null;
  let files;try{files=await readdir(join(runtimeRoot,'local/roms'),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}
  for(const file of files.filter(x=>x.isFile()&&x.name.toLowerCase().endsWith('.gba')).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,128)){
   const path=join(runtimeRoot,'local/roms',file.name),info=await lstat(path);if(info.size!==row.size_bytes)continue;
   const original=await inspect(path);if(!original||original.sha1!==row.sha1||original.header.subarray(12,16).toString('ascii')!==row.game_code||original.header[28]!==row.version)continue;
   return {path:original.path,sha1:original.sha1,sha256:original.sha256,game_id:row.id,revision:row.version,source:'validated-local-original'};
  }
  return null;
 }
 return async id=>{if(!inflight.has(id))inflight.set(id,find(id).finally(()=>inflight.delete(id)));return inflight.get(id);};
}
