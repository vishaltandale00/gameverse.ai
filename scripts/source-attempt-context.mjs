import {readFile,readdir,realpath} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';
import {captureLocalClosure} from './agent-source-pipeline.mjs';
const canonical=id=>/^pokemon-(leafgreen|firered|emerald|ruby|sapphire)$/.test(id)?id+'-version':id;
// Source discovery follows the installed survey, not a game-pair execution allowlist.
export function createSourceCapture({root}={}){
 return async function capture({source_games,discovery,selected,workspace,runtimeRoot,signal,metadata_only=false,source_candidates=[]}){
  const base=await realpath(runtimeRoot),sourceRefs=[],sourceInventory=[];
  // Installed adapter declarations prioritize their actual dependency closure before broad discovery.
  try{const spec=JSON.parse(await readFile(join(root,'tools/sonic_pokemon_pipeline/source-inputs.json'),'utf8'));if(spec.sources.every(s=>source_games.includes(s.game_id)))for(const source of spec.sources)sourceRefs.push(...source.refs.map(ref=>source.source_ref+'/'+ref));}catch{}let survey=[];
  try{survey=JSON.parse(await readFile(join(base,'local/decomps/survey.json'),'utf8'));}catch{}
  for(const game of source_games){
   const row=survey.find(r=>r.id===canonical(game));
   for(const path of row?.clone_paths||[]){
    let actual;try{actual=await realpath(path);}catch{continue;}if(!actual.startsWith(base+sep))continue;
    const ref=relative(base,actual).split(sep).join('/');let entries=[];try{entries=await readdir(actual,{withFileTypes:true});}catch{continue;}
    // Source, headers and declarations first; large bitmap collections remain bounded by capture limits.
    const priority=['src','include','asm','data','graphics','tools'];
    const refs=entries.filter(e=>e.isFile()&&/^(?:Makefile|README|INSTALL|[^.]+\.(?:mk|ld|sha1|json))$/i.test(e.name)).map(e=>ref+'/'+e.name);
    for(const dir of priority)if(entries.some(e=>e.isDirectory()&&e.name===dir)){
     const edition=game==='sonic-advance'&&['data','graphics'].includes(dir)?'/sa1':'';
     refs.push(ref+'/'+dir+edition);
    }
    sourceRefs.push(...refs);sourceInventory.push({game_id:game,source_ref:ref,selected_subtrees:refs});
   }
  }
  const reviewedRefs=['tools/sonic_pokemon_pipeline','tools/pokemon_pipeline','scripts/creation-operations.mjs','docs/LOCAL_CREATION.md'];
  const reviewed=await captureLocalClosure(root,workspace,reviewedRefs.map(ref=>({provenance:[{ref}]})),signal);
  const metadataItems=[...(discovery?.items||[]),...selected.filter(Boolean)].map(item=>({...item,provenance:(item.provenance||[]).filter(p=>/\.(?:json|md|txt)$/i.test(p.ref||''))}));
  const source=await captureLocalClosure(base,workspace,metadata_only?metadataItems:[...sourceRefs.map(ref=>({provenance:[{ref}]})),...(discovery?.items||[]),...selected.filter(Boolean)],signal);
  return {schema:'gameverse.agent-source-capture/1',reviewed_tools:reviewed,game_sources:source,source_inventory:sourceInventory,source_candidates,metadata_only,limits:source.limits,scope:'Isolated source/declaration/tool copies; unavailable or capped dependencies remain explicit. Originals are captured separately. A source checkout does not imply whole-game IR reconstruction.'};
 };
}
