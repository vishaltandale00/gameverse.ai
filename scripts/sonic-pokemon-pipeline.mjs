import {access,readFile,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runChild} from './mashup-pipeline.mjs';
const sourceGames=['sonic-advance','pokemon-leafgreen'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const save=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n');
export function createSonicPokemonPipeline({root,runtimeRoot=process.env.GAMEVERSE_POKEMON_RUNTIME_ROOT||'/Users/shishirtandale/Projects/gameverse.ai',originalResolver,python=process.env.GAMEVERSE_PYTHON||'/opt/homebrew/bin/python3',child=runChild}={}){
 if(!root)throw Error('pipeline_root_required');
 const original=async(id,ref)=>(await originalResolver?.(id))?.path||join(runtimeRoot,ref);
 async function inputs(){return {sonic:await original('sonic-advance','local/roms/Sonic Advance (USA) (En,Ja).gba'),leaf:await original('pokemon-leafgreen','local/roms/Pokemon - LeafGreen Version (USA, Europe) (Rev 1).gba'),sonicSource:join(runtimeRoot,'local/decomps/sa2'),pokemonSource:join(runtimeRoot,'local/decomps/pokefirered')};}
 async function capabilities(){
  const data=await inputs(),missing=[];
  for(const [id,path]of [['sonic-advance-original',data.sonic],['leafgreen-rev1-original',data.leaf],['sonic-source-animation-data',join(data.sonicSource,'src/data/sa1/animations/animations.c')],['leafgreen-source-icons',join(data.pokemonSource,'src/pokemon_icon.c')],['enemy-render-adapter',join(root,'tools/sonic_pokemon_pipeline/enemy_assets.py')],['native-render-verifier',join(root,'tools/sonic_pokemon_pipeline/native_verify.py')]])try{await access(path);}catch{missing.push(id);}
  return {schema:'gameverse.sonic-pokemon-capabilities/1',available:missing.length===0,source_games:sourceGames,base_game:'sonic-advance',donor_game:'pokemon-leafgreen',operation:'pokemon-enemies',missing_inputs:missing,scope:'Original Sonic ordinary enemy rendering with source Pokemon party-icon artwork; native Sonic campaign, enemy AI and collision remain unchanged.',gaps:['Native enemy palettes adapt donor colors; exact Pokemon colors are not promised.','Ordinary enemy render families are covered by the per-run manifest; bosses, projectiles and other excluded consumers retain native art.','Native consumer fixtures do not establish natural gameplay completion or observed in-stage encounter legibility.'],qualification:{outcome:'pending',reason:'per_run_original_range_and_native_render_verification'},supports:{arbitrary_game_pairs:false,checkpoint_resume:false,model_playtest:false,native_graphics_verification:true},limits:{asset_seconds:30,native_seconds:60}};
 }
 async function run({id,intent,source_games=sourceGames,directory,signal,onEvent,operation,plan,parent}={}){
  const started=Date.now();await mkdir(directory,{recursive:true});await save(join(directory,'intent.json'),{id,intent,source_games,operation,plan});
  if(operation!=='pokemon-enemies'||source_games.length!==2||sourceGames.some(game=>!source_games.includes(game)))return {status:'blocked',reason:'source_role_mismatch',qualification:{outcome:'unavailable'}};
  if(parent)return {status:'blocked',reason:'enemy_refinement_requires_explicit_recipe',gaps:['An existing enemy conversion needs a declared source-mapped parameter change; its accepted cartridge is preserved.'],qualification:{outcome:'unavailable'}};
  const caps=await capabilities();if(!caps.available)return {status:'blocked',reason:'missing_enemy_adapter_inputs',gaps:caps.missing_inputs,qualification:{outcome:'unavailable'}};
  const paths=await inputs(),work=join(directory,'workspace'),runner=join(directory,'.runner');await mkdir(work);await mkdir(runner);
  for(const name of ['runtime.py','enemy_assets.py','native_verify.py','native_verify.c.in'])await copyFile(join(root,'tools/sonic_pokemon_pipeline',name),join(runner,name));
  await onEvent?.({stage:'apply',message:'Mapping original Pokemon icon frames into original Sonic ordinary enemy render families'});
  await child(python,[join(runner,'runtime.py'),'--sonic',paths.sonic,'--leaf',paths.leaf,'--sonic-source',paths.sonicSource,'--pokemon-source',paths.pokemonSource,'--out',work],{cwd:root,signal,timeoutMs:30000});
  const transfer=await json(join(work,'enemy-transfer.json'));await onEvent?.({stage:'native',message:'Checking original Sonic sprite animation, OAM, tile uploads and native enemy behavior boundaries'});
  // Native verifier arguments follow the captured adapter manifest; no game or model is synthesized here.
  const expectedArtifact=sha(await readFile(join(work,'candidate.gba'))),expectedManifest=sha(await readFile(join(work,'enemy-transfer.json'))),expectedOriginal=sha(await readFile(paths.sonic));
  await child(python,[join(runner,'native_verify.py'),'--original',paths.sonic,'--artifact',join(work,'candidate.gba'),'--transfer-report',join(work,'enemy-transfer.json'),'--directory',join(work,'native'),'--timeout','60'],{cwd:root,signal,timeoutMs:62000});
  const verification=await json(join(work,'native/native-verification.json'));
  if(verification.schema!=='gameverse.sonic-enemy-native-verification/1'||verification.artifact?.sha256!==expectedArtifact||verification.original?.sha256!==expectedOriginal||verification.transfer_manifest_sha256!==expectedManifest||sha(await readFile(join(work,'candidate.gba')))!==expectedArtifact)throw Error('enemy_native_verification_identity_mismatch');
  const artifact=join(directory,'game.gba');await copyFile(join(work,'candidate.gba'),artifact);
  const result={status:'completed',artifact:{path:artifact,sha256:sha(await readFile(artifact)),title:'Sonic with Pokemon enemies'},qualification:verification,user_intent_validated:false,design:{title:'Sonic with Pokemon enemies',scope:caps.scope,request_satisfied:false,changes:transfer.families||transfer.mappings||[],gaps:[...caps.gaps,...(transfer.gaps||[])]},gaps:[...caps.gaps,...(transfer.gaps||[])],provenance:{source_games:sourceGames,operation,transfer_manifest:join(work,'enemy-transfer.json'),transfer_manifest_sha256:sha(await readFile(join(work,'enemy-transfer.json'))),source_identity:{sonic_sha256:transfer.original_sonic_sha256,leafgreen_sha256:transfer.original_leaf_sha256,source_commits:transfer.source_commits},coverage:transfer.coverage},workspace:work,can_resume:false,timings:{run_id:id,total_s:(Date.now()-started)/1000,queue_s:null,build_s:null,asset_transform_s:transfer.timings?.apply_wall_s??null,native_s:verification.wall_s??null,adapter_version:'sonic-native-enemy-render/1',loop_config:'deterministic-enemy-role-transfer/1',attempts:1,accounting:'Original asset transform and native fixtures nested within total; no source compilation or model evaluation. No comparable prior successful backend baseline.'}};
  await save(join(directory,'pipeline-result.json'),result);return result;
 }
 return {capabilities,run};
}
