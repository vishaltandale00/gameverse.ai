import {access,readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {runChild} from './mashup-pipeline.mjs';
const sources=['pokemon-leafgreen','pokemon-emerald'];
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const save=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n');
export function supportsPokemonIntent(intent='') {
 return /leaf\s*green[\s\S]*\b(?:with|but|using|and)\b[\s\S]*emerald/i.test(intent)&&!/emerald[\s\S]*\b(?:with|but|using)\b[\s\S]*leaf\s*green/i.test(intent)&&/leaf\s*green/i.test(intent)&&/emerald/i.test(intent)&&/overworld\s+(?:object\s+)?sprites?/i.test(intent)&&!/(?:battle\s+sprites?|tilesets?|new\s+(?:moves?|mechanics?|maps?)|change\s+(?:battle|combat|moves?|mechanics?))/i.test(intent);
}
export function createPokemonPipeline({root,runtimeRoot=process.env.GAMEVERSE_POKEMON_RUNTIME_ROOT,python=process.env.GAMEVERSE_PYTHON||'/opt/homebrew/bin/python3',child=runChild,nativeVerifier}={}) {
 if(!root)throw Error('pipeline_root_required');
 // The research source checkout is an explicit local-development prerequisite, never a distributed asset.
 runtimeRoot=runtimeRoot||'/Users/shishirtandale/Projects/gameverse.ai';
 const helper=join(root,'tools/pokemon_pipeline/runtime.py');
 async function capabilities(){
  const missing=[];let adapterReady=true;try{await access(join(root,'tools/pokemon_pipeline/assets.py'));}catch{adapterReady=false;}
  for(const path of ['local/decomps/pokefirered/leafgreen_rev1.sha1','local/decomps/pokeemerald/src/data/object_events/object_event_graphics_info.h','local/game-builds/toolchains/agbcc-sonic/agbcc','local/roms/Pokemon - LeafGreen Version (USA, Europe) (Rev 1).gba'])try{await access(join(runtimeRoot,path));}catch{missing.push(path);}
  return {schema:'gameverse.pokemon-pipeline-capabilities/1',available:missing.length===0&&adapterReady,source_available:missing.length===0,qualification:{outcome:'pending',reason:'per_run_baseline_build_and_native_graphics_verification_required'},base_game:'pokemon-leafgreen',donor_game:'pokemon-emerald',source_games:sources,missing_inputs:missing,runtime_required:'GAMEVERSE_POKEMON_RUNTIME_ROOT: local decompilation/asset/toolchain/cartridge prerequisites',source_baselines:[{id:'pokemon-leafgreen',revision:1,game_code:'BPGE',sha1:'7862c67bdecbe21d1d69ce082ce34327e1c6ed5e',source_commit:'037335f4c725d7c9aecdac87066f2002b4bd7e14'},{id:'pokemon-emerald',source_commit:'731ad5bfd6e6f265508d0efcca0ba42f9dcf5881'}],supported_operations:['leafgreen-rev1-exact-source-baseline','emerald-overworld-dependency-inventory',...(adapterReady?['emerald-overworld-supported-family-transfer']:[])],scope:'Native LeafGreen Rev1 retains its complete game. Import compatible Emerald overworld object families through graphics, frames, animations and palette dependencies. Both player roles use exact donor palettes; NPC colors adapt to native shared palettes. Per-run native consumer qualification is required.',gaps:['Unmatched Kanto identities and incompatible donor families retain native assets. LeafGreen-specific poses may retain native art or use reported animation aliases.','NPC colors are adapted to LeafGreen shared palettes; exact Emerald NPC colors are not promised.','Battle sprites, tilesets and mechanics changes are outside this adapter.'],limits:{build_seconds:180,jobs:2},supports:{arbitrary_game_pairs:false,checkpoint_resume:false,model_playtest:false,native_graphics_verification:typeof nativeVerifier==='function'}};
 }
 async function stage(name,work,signal,onEvent){
  onEvent?.({type:'pipeline-stage',stage:name,phase:name,message:{prepare:'Capturing exact LeafGreen Rev1 and Emerald source trees',inventory:'Resolving Emerald sprite frames, animations and palette dependencies',baseline:'Building and comparing the unmodified LeafGreen Rev1 cartridge',apply:'Binding supported Emerald graphics with explicit palette and animation dependencies',build:'Compiling LeafGreen with the supported Emerald sprite families'}[name]});
  let selectedHelper=helper;try{await access(join(work,'../.runner/runtime.py'));selectedHelper=join(work,'../.runner/runtime.py');}catch{}
  await child(python,[selectedHelper,name,'--workspace',work,...(name==='prepare'?['--runtime',resolve(runtimeRoot)]:[])],{cwd:root,signal,timeoutMs:['baseline','build'].includes(name)?185000:30000});
  return read(join(work,name+'-stage.json'));
 }
 async function run({id,intent='',source_games=sources,directory,signal,onEvent,budget,parent}={}){
  const started=Date.now();await mkdir(directory,{recursive:true});
  await save(join(directory,'intent.json'),{id,intent,source_games,budget});
  if(source_games.length!==2||sources.some(g=>!source_games.includes(g)))return {status:'blocked',reason:'unsupported_source_games',qualification:{outcome:'unavailable'}};
  if(!supportsPokemonIntent(intent))return {status:'blocked',reason:'unsupported_pokemon_operation',gaps:['This adapter preserves LeafGreen and imports Emerald overworld object sprites. The requested operation needs another source transformation.'],qualification:{outcome:'unavailable'}};
  if(parent)return {status:'blocked',reason:'pokemon_parent_refinement_unqualified',qualification:{outcome:'unavailable'}};
  const caps=await capabilities();if(!caps.source_available)return {status:'blocked',reason:'missing_runtime_inputs',gaps:caps.missing_inputs,qualification:{outcome:'unavailable'}};
  if(!caps.available)return {status:'blocked',reason:'pokemon_sprite_mapping_unqualified',gaps:caps.gaps,qualification:{outcome:'unavailable'}};
  const runner=join(directory,'.runner');await mkdir(runner,{recursive:true});
  for(const name of ['runtime.py','assets.py'])await copyFile(join(root,'tools/pokemon_pipeline',name),join(runner,name));
  const work=join(directory,'workspace');await stage('prepare',work,signal,onEvent);
  const baseline=(await stage('baseline',work,signal,onEvent)).result;
  await save(join(work,'recipe.json'),{schema:'gameverse.pokemon-overworld-recipe/1',base_game:'pokemon-leafgreen',base_revision:1,donor_game:'pokemon-emerald',palette_policy:{players:'exact-donor',npc:'adapt-to-host',unmatched:'preserve-native'},mapping_policy:'same-identity-and-explicit-player-role',requested_scope:'overworld-object-sprites',intent});
  const coverage=(await stage('apply',work,signal,onEvent)).result;
  const built=(await stage('build',work,signal,onEvent)).result;
  const artifact=join(directory,'game.gba');await copyFile(built.artifact.path,artifact);
  let verification={outcome:'unavailable',scope:'native-graphics-consumer',reason:'native_verifier_unconfigured'};
  if(nativeVerifier)verification=await nativeVerifier({id,artifact:{...built.artifact,path:artifact},workspace:work,directory,signal,onEvent,budget,coverage});
  const result={schema:'gameverse.pokemon-pipeline-result/1',run_id:id,status:'completed',artifact:{...built.artifact,path:artifact,title:'LeafGreen with supported Emerald overworld sprites'},user_intent_validated:verification.outcome==='pass'&&verification.request_satisfied===true,qualification:verification,gaps:coverage.gaps||[],design:{title:'LeafGreen with Emerald overworld sprites',scope:'Source-backed object graphics dependency transfer; original LeafGreen world and mechanics retained',request_satisfied:verification.request_satisfied===true,changes:coverage.object_mappings||coverage.mappings||[],gaps:coverage.gaps||[]},workspace:work,can_resume:false,provenance:{source_games:sources,baseline:await read(join(work,'baseline.json')),baseline_build:baseline,sprite_coverage:join(work,'sprite-coverage.json'),build:built,ir_scope:'Native decompilation and donor assets; no whole-game IR regeneration claim'},timings:{run_id:id,source_commit:'037335f4c725d7c9aecdac87066f2002b4bd7e14',adapter_version:'pokemon-source-overworld/1',loop_config:'deterministic-overworld-recipe/1',total_s:(Date.now()-started)/1000,queue_s:null,baseline_build_s:baseline.wall_s,sprite_build_s:built.wall_s,native_s:verification.wall_s??null,attempts:1,stage_accounting:'Setup, clean baseline, incremental sprite build and native verification are nested within total; no speedup claim between different build modes'}};
  await save(join(directory,'pipeline-result.json'),result);return result;
 }
 return {capabilities,run};
}
