// Read-only source watcher: public derived summaries may be refreshed; canonical
// research, ROMs and the retained embedding coordinates are never changed here.
import { readdir, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { root } from './runtime.mjs';
const exec=promisify(execFile);
export function createResearchCache({sourceRoot=root,snapshotFile=new URL('games/research.json',root)}={}){
let snapshot, stamp, pending, checkedAt=0, error=null, checkWallMs=null, refreshWallMs=null;
async function sourceFiles(){
 const files=[];
 for(const [directory,suffix]of[['ontology/games/','.yaml'],['ontology/portraits/','.json']]){
  let names;try{names=await readdir(new URL(directory,sourceRoot));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  for(const name of names.filter(n=>n.endsWith(suffix)).sort()){
   const relative=directory+name,info=await stat(new URL(relative,sourceRoot));files.push({relative,size:info.size,mtimeMs:info.mtimeMs});
  }
 }
 try{const info=await stat(new URL('local/re/roms.json',sourceRoot));files.push({relative:'local/re/roms.json',size:info.size,mtimeMs:info.mtimeMs});}catch(e){if(e.code!=='ENOENT')throw e;}
 return files;
}
async function update(){
 const start=performance.now();
 if(!snapshot)snapshot=JSON.parse(await readFile(snapshotFile,'utf8'));
 const files=await sourceFiles(),next=createHash('sha256').update(JSON.stringify(files)).digest('hex');checkWallMs=performance.now()-start;
 if(stamp===undefined){const known=Object.keys(snapshot.inputs||{}).filter(p=>p.startsWith('ontology/')).sort(),current=files.filter(f=>f.relative.startsWith('ontology/')).map(f=>f.relative).sort();if(snapshot.researchVersion&&JSON.stringify(known)===JSON.stringify(current)&&files.every(f=>f.mtimeMs<=Date.parse(snapshot.exportedAt||0)))stamp=next;}
 if(next!==stamp){
  const refreshStart=performance.now();
  try{
   await exec(process.env.RESEARCH_PYTHON||(process.platform==='darwin'?'/usr/bin/python3':'python3'),[fileURLToPath(new URL('scripts/export-research.py',root)),fileURLToPath(sourceRoot),'--source-only','--output',fileURLToPath(snapshotFile)],{cwd:fileURLToPath(root),timeout:15000,maxBuffer:256*1024});
   const nextSnapshot=JSON.parse(await readFile(snapshotFile,'utf8'));
   if(!nextSnapshot.researchVersion||!Array.isArray(nextSnapshot.games)||!nextSnapshot.views)throw Error('Invalid research export');
   snapshot=nextSnapshot;stamp=next;error=null;
  }catch{error='Research refresh is unavailable. The last successful snapshot is retained.';}
  refreshWallMs=performance.now()-refreshStart;
 }
 checkedAt=Date.now();
}
async function researchState(force=false){
 if(pending)await pending;
 else if(force||!snapshot||Date.now()-checkedAt>2000){pending=update().catch(failure=>{if(!snapshot)throw failure;error='Research refresh is unavailable. The last successful snapshot is retained.';checkedAt=Date.now();});try{await pending;}finally{pending=null;}}
 return{snapshot,status:{version:snapshot.researchVersion||snapshot.sourceCommit,updatedAt:snapshot.updatedAt||null,exportedAt:snapshot.exportedAt||null,counts:snapshot.counts||null,embeddingSnapshotDate:snapshot.embeddingSnapshotDate||snapshot.snapshotDate,stale:Boolean(error),error,checkWallMs,refreshWallMs}};
}

return researchState;
}
export const researchState=createResearchCache();
