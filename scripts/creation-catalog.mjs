// Local metadata discovery. No ROM, source-code, generated-byte or arbitrary-file API.
import {readFile,stat,realpath,readdir,access} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {creationOperations} from './creation-operations.mjs';
const schema='gameverse.creation-library/1';
const kinds=['system','typed-ir','prefab','capability','asset','template','tool','source'];
const names={system:'Recovered systems','typed-ir':'Typed behavior IR',prefab:'Dependency-linked prefabs',capability:'Capability groups',asset:'Asset families',template:'Native templates and recipes',tool:'Installed tools',source:'Source definitions'};
const indexes={systems:'ontology/recovered-systems/index.json',ir:'ontology/executable-components/index.json',prefabs:'ontology/game-system-prefabs/manifest.json',capabilities:'ontology/ir-capability-groups/index.json',contracts:'ontology/composition-contracts/index.json',sources:'games/sources.json'};
const limits={index:12*1024*1024,record:512*1024,files:500,items:10000};
const text=(v,n=1500)=>typeof v==='string'?v.slice(0,n):'';
const array=v=>Array.isArray(v)?v:[];
const refs=v=>array(v).slice(0,12).map(x=>typeof x==='string'?{ref:text(x,500)}:{ref:text(x?.ref||x?.path,500),...(x?.sha256?{sha256:text(x.sha256,64)}:{})}).filter(x=>x.ref&&!x.ref.startsWith('/')&&!x.ref.split('/').includes('..'));
const title=id=>id.replaceAll('-',' ').replaceAll('_',' ');
const short=v=>array(v).slice(0,20).map(x=>typeof x==='string'?text(x,300):text(x?.id||x?.scope||x?.label||x?.kind,300)).filter(Boolean);
const hash=s=>createHash('sha256').update(s).digest('hex');
export function createCreationCatalog({root,runtimeRoot=process.env.GAMEVERSE_LIBRARY_ROOT||process.env.GAMEVERSE_MASHUP_RUNTIME_ROOT||process.env.GAMEVERSE_POKEMON_RUNTIME_ROOT||root,ttlMs=15000}={}) {
 if(!root)throw Error('catalog_root_required');
 let cached=null,inflight=null,expires=0;const details=new Map(),readDigests=new Map();
 async function safeRead(ref,max=limits.record){
  if(typeof ref!=='string'||ref.includes('\\')||ref.startsWith('/')||ref.split('/').some(p=>p==='..'||p.startsWith('.')))throw Error('catalog_reference_rejected');
  const base=await realpath(runtimeRoot),p=await realpath(resolve(base,ref));if(!p.startsWith(base+sep))throw Error('catalog_reference_rejected');
  const info=await stat(p);if(!info.isFile()||info.size>max)throw Error('catalog_record_limit');
  const content=await readFile(p,'utf8');readDigests.set(ref,hash(content));return JSON.parse(content);
 }
 async function load(){
  const started=performance.now(),items=[],games=new Map(),missing=[],versions={};
  const add=(kind,id,game_ids,label,scope,extra={})=>{if(items.length>=limits.items)return;items.push({id:`${kind}:${id}`,kind,game_ids:game_ids.filter(Boolean),label:text(label||title(id)),scope:text(scope),readiness:'adapter-required',executable:false,dependencies:[],gaps:[],provenance:[],...extra});};
  const loaded=await Promise.all(Object.entries(indexes).map(async([key,ref])=>{try{const d=await safeRead(ref,limits.index);versions[ref]=readDigests.get(ref);return [key,d];}catch(e){missing.push({ref,reason:e.code==='ENOENT'?'unavailable':'unreadable-or-over-limit'});return [key,{}];}}));
  const data=Object.fromEntries(loaded);
  for(const g of array(data.systems.games))games.set(g.gameId,{id:g.gameId,name:text(g.name)||title(g.gameId)});
  for(const s of array(data.systems.systems))add('system',s.id,[s.gameId],s.name,s.capabilities?.join('; '),{readiness:s.readiness||'research-evidence',provenance:refs(s.provenance),dependencies:short(s.dependencies),gaps:short(s.preconditions),evidence_level:text(s.evidenceLevel),complete:s.complete===true});
  for(const s of array(data.ir.entries)){const ref=`ontology/executable-components/${s.record}`;add('typed-ir',s.id,[s.source_game],s.id,s.role,{readiness:s.qualified?'finite-function-qualified':'research-evidence',provenance:[{ref,behavior_sha256:s.behavior_sha256}],detail_ref:ref,assembly_status:s.assembly_status,gaps:['Qualified original-function subset; host ownership, services, cadence and bindings still require explicit integration.']});}
  for(const s of array(data.prefabs.prefabs))add('prefab',s.id,[s.gameId],s.moduleId||s.id,s.scope,{readiness:'published-assembly-subset',provenance:refs([{ref:s.path,sha256:s.sha256},{ref:s.validation,sha256:s.validationSha256},{ref:s.descriptorRef}]),detail_ref:s.descriptorRef,dependencies:[s.moduleId].filter(Boolean),gaps:['Publication is bounded assembly evidence, not a whole-game runtime qualification.']});
  for(const s of array(data.capabilities.entries))add('capability',s.id,[s.game_id],s.module_id,s.id,{readiness:'capability-proposal',provenance:refs([s.record]),detail_ref:s.record?.path});
  for(const [id,s]of Object.entries(data.sources.games||{}))add('source',id,[({firered:'pokemon-firered-version',sma4:'super-mario-advance-4-super-mario-bros-3'})[id]||id],s.name,s.sourceKind,{readiness:'source-defined',provenance:refs([{ref:s.directory}]),source_commit:s.commit,dependencies:[s.buildRecipe,s.compositionPlan].filter(Boolean),gaps:['Source definition does not verify installed assets or build compatibility.']});
  for(const [id,s]of Object.entries(data.sources.tools||{}))add('tool',id,[],id,'Pinned source toolchain definition',{readiness:'source-defined',source_commit:s.commit,provenance:refs([{ref:s.directory}]),gaps:['Toolchain definition is not an installation check.']});
  // Original inventory metadata is not the cartridge payload and does not verify its current digest.
  let originals=[];try{originals=await safeRead('local/re/roms.json');}catch{}
  for(const s of array(originals)){
   if(typeof s.file!=='string'||s.file.includes('/')||s.file.includes('\\'))continue;
   let present=false;try{await safeAccess(`local/roms/${s.file}`);present=true;}catch{}
   add('source',`original-${s.id}`,[s.id],`${games.get(s.id)?.name||title(s.id)} original inventory`,'Locally indexed original cartridge identity; metadata only.',{readiness:present?'original-present-digest-unverified':'original-indexed-not-present',original_present:present,game_code:text(s.game_code,12),inventory_sha1:text(s.sha1,40),provenance:[{ref:'local/re/roms.json'}],gaps:['Presence check only; exact content digest and build source readiness are checked by the operation before use.']});
  }
  // Installed decompilation directories are discoverable without reading or copying source trees.
  try{
   const base=await realpath(runtimeRoot),dir=await realpath(join(base,'local/decomps'));
   if(dir.startsWith(base+sep))for(const e of (await readdir(dir,{withFileTypes:true})).filter(e=>e.isDirectory()&&!e.name.startsWith('.')).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,128)){
    const ref=`local/decomps/${e.name}`;
    add('source',`decomp-${e.name}`,[],`Installed source: ${e.name}`,'Local source checkout; consult its pinned identity, README and build configuration before selecting an original or target edition.',{source_tree_present:true,readiness:'source-tree-present-build-unverified',provenance:[{ref}],gaps:['Directory presence does not verify source revision, edition, dependencies, original identity, matching build, or runnable application adapter.']});
   }
  }catch{}
  // Shallow, bounded scans of known metadata folders only. Never recurse into source or artifacts.
  for(const dir of ['tools/composition/packages','tools/composition/worlds','tools/composition/plans','tools/composition/native','tools/gba_mashup/recipes']){
   let entries;try{const base=await realpath(runtimeRoot),actual=await realpath(join(base,dir));if(!actual.startsWith(base+sep))throw Error('outside');entries=await readdir(actual,{withFileTypes:true});}catch{continue;}
   for(const e of entries.filter(e=>e.isFile()&&e.name.endsWith('.json')).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,limits.files)){
    const ref=`${dir}/${e.name}`;let s;try{s=await safeRead(ref);}catch{continue;}
    const kind=/assets/.test(e.name)?'asset':'template';const game=s.native_implementation?.game_id||s.foundation?.game||s.game_id||s.source_game;
    add(kind,s.id||e.name,[game].filter(Boolean),s.label||s.name||s.id||e.name,s.concept?.pattern||s.scope||s.authorship?.recovered||s.description,{readiness:'native-metadata-available',provenance:[{ref}],detail_ref:ref,dependencies:short(s.dependencies||s.requires),gaps:['Native template requires its exact source, host ABI, asset and toolchain prerequisites; no automatic game-pair compatibility inferred.']});
   }
  }
  // Existing tooling is discoverable independently of the small installed creation-router backend set.
  const tools=[['scripts/sources.mjs','Pinned source setup and build','Use node scripts/sources.mjs setup <source-id> or build <source-id> with the exact required asset inputs.'],['tools/prefab_pipeline/composition_cli.py','Prefab composition CLI','Inspect, validate and package recovered component composition.'],['tools/prefab_pipeline/native_cli.py','Native prefab CLI','Inspect exact native host composition prerequisites.'],['tools/whole_game/build_sources.py','Whole-game source builder','Build pinned source trees; retained native behavior is distinct from generated IR.'],['tools/whole_game/single_pipeline.py','Single source-game pipeline','Inspect single-game source, artifact and adapter workflow.'],['tools/roundtrip/asset_batch.py','Typed asset batch validator','Classify/rebuild exact private assets with consumer dependency pins.'],['tools/roundtrip/qc.py','Roundtrip qualification','Qualify declared private source/IR/native reconstruction boundaries.'],['tools/roundtrip/ir_bundle.py','Roundtrip typed IR bundle','Inspect exact original-derived IR package dependency closure.'],['tools/behavior_ir/qualify.py','Finite function native qualifier','Compare regenerated function behavior against original function subset.'],['tools/behavior_ir/assembly.py','Typed IR assembly validation and generation','Validate canonical state bindings and explicit services before lowering an assembly.'],['tools/behavior_ir/compose.py','Typed component Composer','Compose recovered components with explicit typed ports and source identities.'],['tools/behavior_ir/lower.py','Typed IR lowering','Lower supported typed behavior to generated code; finite subset evidence only.'],['tools/composition/native_build.py','Native composition builder','Build a native composition plan with exact host and source dependencies.'],['tools/gba_mashup/build.py','GBA source recipe builder','Build a configured native source recipe.'],['tools/prefab_pipeline/__main__.py','Recovered prefab pipeline','Inspect and validate recovered prefab artifacts.'],['tools/whole_game/pipeline.py','Whole-game source pipeline','Inspect source reconstruction and retained native ownership boundaries.'],['tools/roundtrip/__main__.py','Roundtrip tooling','Inspect existing roundtrip extraction and reconstruction evidence.']];
  for(const [ref,label,scope]of tools){try{await safeAccess(ref);add('tool',ref,[],label,scope,{readiness:'entrypoint-installed',provenance:[{ref}],invocation:{interpreter:ref.endsWith('.mjs')?'node':'python3',entrypoint:ref,discovery:'Read entrypoint CLI help locally before use; not remotely executable.'},gaps:['Read-only discovery; execution requires task-specific inputs and explicit resource limits.']});}catch{}}
  // Exact private asset batches expose classification/counts only, never original bytes or source paths.
  for(const [ref,game,label]of [
   ['local/roundtrip/coverage-next-firered-icon-assets-003/asset-pack.json','pokemon-firered-version','FireRed creature icons'],
   ['local/roundtrip/coverage-next-emerald-icon-assets-003/asset-pack.json','pokemon-emerald-version','Emerald creature icons'],
   ['local/roundtrip/coverage-next-mzm-audio32-assets-001/asset-overlay.json','metroid-zero-mission','Metroid Zero Mission audio samples'],
   ['local/playable-mashups/assets/manifest.json',null,'Private presentation asset closure']]){
   let a;try{a=await safeRead(ref,2*1024*1024);}catch{continue;}
   add('asset',ref,game?[game]:[],label,'Private local asset evidence with exact source/consumer dependencies; retained or rebuilt bytes, not regenerated behavior IR.',{readiness:'private-local-evidence',provenance:[{ref}],asset_count:a.asset_count??(Array.isArray(a.assets)?a.assets.length:a.files?Object.keys(a.files).length:null),asset_bytes:a.asset_bytes??a.asset_data_bytes??null,regenerated_ir_bytes:0,semantic_consumer_reexecuted:a.semantic_consumer_reexecuted===true,redistribution:'not-authorized-by-catalog',dependencies:['Exact source and consumer table/linked-object pins in original manifest'],gaps:['No general sprite, palette, animation or tileset compatibility implied.']});
  }
  // Attach exact published contract dependencies to their corresponding finite IR entries.
  const contracts=new Map(array(data.contracts.components).map(c=>[c.id,c]));
  for(const item of items){const c=contracts.get(item.id.replace(/^typed-ir:/,''));if(item.kind==='typed-ir'&&c){item.label=text(c.label)||item.label;item.dependencies=short(c.dependencies);item.port_count=array(c.publicPorts).length;item.qualification_scope=text(c.qualification?.scope);}}
  for(const item of items)for(const id of item.game_ids)if(!games.has(id))games.set(id,{id,name:title(id)});
  for(const item of items){
   const sourceDefinition=data.sources.games?.[item.id.replace(/^source:/,'')];
   if(item.kind==='source'&&sourceDefinition?.directory){item.source_tree_present=false;try{await safeAccess(sourceDefinition.directory);item.source_tree_present=true;}catch{}item.readiness=item.source_tree_present?'source-tree-present-build-unverified':'source-defined-tree-not-installed';}
   item.operations=creationOperations.filter(op=>item.game_ids.some(g=>[op.host,op.donor].some(s=>g===s||g===s+'-version'))).map(op=>({id:op.id,backend:op.backend,host:op.host,donor:op.donor,scope:op.scope,required_inputs:op.required_inputs||[],readiness:'declared-operation-runtime-check-required',executable:false}));
  }
  const counts=Object.fromEntries(kinds.map(k=>[k,items.filter(i=>i.kind===k).length]));counts.games=games.size;counts.original_games=array(data.systems.games).length;
  const result={schema,available:items.length>0,items,games:[...games.values()].map(g=>({...g,counts:Object.fromEntries(kinds.map(k=>[k,items.filter(i=>i.kind===k&&i.game_ids.includes(g.id)).length])),readiness:'research-available',executable:false})).sort((a,b)=>a.name.localeCompare(b.name)),counts,categories:kinds.map(id=>({id,label:names[id],count:counts[id]})),missing_indexes:missing,provenance:{index_sha256:versions},limitations:['Catalog entries are local research/source metadata, not installed executable creation adapters.','Finite function, authored bridge, retained native owner and captured-byte evidence remain distinct; none implies full IR regeneration.','Asset families retain exact dependencies. Compatibility requires canonical state, units, lifecycle, service and native consumer checks.'],timing:{load_ms:Math.round((performance.now()-started)*100)/100,cache_ttl_ms:ttlMs,source_commit:null,source_commit_note:'Working-tree indexes hashed; commit alone would not identify dirty research inputs.',queue_ms:null,accounting:'Metadata reads and shallow scans nested in load_ms; no builds, simulations or model evaluations.'}};
  if(!array(data.systems.games).length||!array(data.ir.entries).length){
   const fallback=await metadataSnapshot();if(fallback){fallback.missing_indexes=missing;fallback.timing={...result.timing,load_ms:Math.round((performance.now()-started)*100)/100};return fallback;}
  }
  return {...result,discovery_mode:'local-indexes',local_enrichment_available:true,runtime_inputs_checked:false};
 }
 async function metadataSnapshot(){
  try{
   const base=await realpath(root),p=await realpath(join(base,'games/creation-library.snapshot.json'));
   if(!p.startsWith(base+sep)||(await stat(p)).size>2*1024*1024)return null;
   const data=JSON.parse(await readFile(p,'utf8'));
   if(data.schema!=='gameverse.creation-library-snapshot/1'||!Array.isArray(data.items)||data.items.length>limits.items)return null;
   const items=data.items.filter(i=>kinds.includes(i.kind)&&typeof i.id==='string').map(i=>{
    const {original_present,source_tree_present,operations,...record}=i;
    return {...record,evidence_readiness:text(i.evidence_readiness||i.readiness),readiness:'metadata-only',executable:false,runtime_inputs_checked:false,
     ...(original_present!==undefined?{original_present:null}:{}),...(source_tree_present!==undefined?{source_tree_present:null}:{}),
     operations:creationOperations.filter(op=>array(i.game_ids).some(g=>[op.host,op.donor].some(s=>g===s||g===s+'-version'))).map(op=>({id:op.id,backend:op.backend,host:op.host,donor:op.donor,scope:op.scope,required_inputs:op.required_inputs||[],readiness:'declared-operation-runtime-check-required',executable:false}))};
   });
   const counts=Object.fromEntries(kinds.map(k=>[k,items.filter(i=>i.kind===k).length]));
   const games=array(data.games).map(g=>({id:text(g.id),name:text(g.name),counts:Object.fromEntries(kinds.map(k=>[k,items.filter(i=>i.kind===k&&array(i.game_ids).includes(g.id)).length])),readiness:'metadata-only',executable:false}));counts.games=games.length;counts.original_games=data.original_games??null;
   return {schema,available:items.length>0,discovery_mode:'snapshot',local_enrichment_available:false,runtime_inputs_checked:false,items,games,counts,categories:kinds.map(id=>({id,label:names[id],count:counts[id]})),provenance:{snapshot_ref:'games/creation-library.snapshot.json',snapshot_sha256:hash(await readFile(p)),generated_at:data.generated_at,index_sha256:data.index_sha256},limitations:['Checked-in metadata snapshot is browsable without originals, source trees, extracted assets or installed research tools.','Snapshot evidence is historical metadata; local runtime inputs and executable operation readiness have not been checked.','Source, assets, ROM bytes and tool binaries are not included. Dependencies and original evidence must be supplied and verified before execution.']};
  }catch{return null;}
 }
 async function safeAccess(ref){const base=await realpath(runtimeRoot),p=await realpath(join(base,ref));if(!p.startsWith(base+sep))throw Error('outside');await access(p);}
 async function snapshot(){if(cached&&Date.now()<expires)return cached;if(!inflight)inflight=load().then(d=>{cached=d;expires=Date.now()+ttlMs;details.clear();return d;}).finally(()=>{inflight=null;});return inflight;}
 async function summary(){const {items,...rest}=await snapshot();return rest;}
 async function search({q='',game='',kind='',offset=0,limit=40}={}){const started=performance.now(),d=await snapshot();offset=Math.max(0,Math.min(10000,Number.parseInt(offset)||0));limit=Math.max(1,Math.min(100,Number.parseInt(limit)||40));const terms=String(q).slice(0,500).toLowerCase().split(/\s+/).filter(Boolean);const found=d.items.filter(i=>(!game||i.game_ids.includes(game))&&(!kind||i.kind===kind)&&terms.every(t=>`${i.label} ${i.scope} ${i.id} ${i.game_ids.join(' ')} ${i.dependencies.join(' ')}`.toLowerCase().includes(t)));return {schema,items:found.slice(offset,offset+limit),total:found.length,offset,limit,timing:{response_ms:Math.round((performance.now()-started)*100)/100}};}
 async function detail(id){const d=await snapshot(),item=d.items.find(i=>i.id===id);if(!item)return null;if(details.has(id))return details.get(id);let record=null;if(item.detail_ref&&d.discovery_mode!=='snapshot')try{record=await safeRead(item.detail_ref);}catch{}const result={...item,...(record?{dependencies:short(record.dependencies||record.package_ids||item.dependencies),gaps:short(record.gaps||record.limitations||item.gaps),qualification:record.qualification?{status:record.qualification.status,scope:text(record.qualification.scope),kind:text(record.qualification.kind)}:null,ports:array(record.ports).slice(0,80).map(p=>({id:p.id,direction:p.direction,storage_type:p.storage_type,quantity:p.semantic_type?.quantity,frame:p.semantic_type?.frame})),prerequisites:short(record.preconditions||record.originalhostprerequisites),evidence_status:text(record.proposal_status||record.availability),package_ids:short(record.package_ids)}:{})};details.set(id,result);return result;}
 async function context({q='',game='',limit=20}={}){
  const d=await snapshot(),stop=new Set(['the','and','with','from','this','that','make','build','game','want','have','but','using','into','like','please','can','you','all','available','useful','things']);
  const terms=[...new Set(String(q).toLowerCase().match(/[a-z0-9]+/g)||[])].filter(t=>t.length>2&&!stop.has(t)).slice(0,100);
  const compact=String(q).toLowerCase().replace(/[^a-z0-9]/g,'');
  const namedGames=d.games.filter(g=>g.id.split('-').some(t=>t.length>4&&!['pokemon','version','super','advance','mission'].includes(t)&&compact.includes(t))).map(g=>g.id);
  const ranked=d.items.filter(i=>!game||i.game_ids.includes(game)).map(item=>{const body=`${item.label} ${item.scope} ${item.id} ${item.game_ids.join(' ')}`.toLowerCase();const matches=terms.filter(t=>body.includes(t));return {item,score:matches.length*10+(item.game_ids.some(g=>namedGames.includes(g))?100:0)+(['system','prefab','capability','template','tool'].includes(item.kind)?2:0)};}).filter(x=>!terms.length||x.score>=10).sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id));
  const selected=ranked.slice(0,Math.max(1,Math.min(Number(limit)||20,30))).map(x=>x.item);
  return {schema,items:selected,total:ranked.length,limitations:d.limitations,recommendation:'Prefer coherent system/prefab candidates; inspect details and exact dependencies before invoking local tools. Catalog evidence does not expand executable router compatibility.',tools:{search:'GET /api/mashup/library?q=<terms>&game=<id>&kind=<category>&limit=20',details:'GET /api/mashup/library?id=<entry-id>',execution:'Use exact local entrypoint and its CLI help with explicit task resource limits; this endpoint does not execute code.'},catalog_provenance:d.provenance};
 }
 return {summary,search,detail,context};
}
