// Deterministic private fixtures from exact authorized originals; no model calls.
import {createHash} from 'node:crypto';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const hash=b=>createHash('sha256').update(b).digest('hex');
const extractor=new URL('./fixtures/extract-mzm-flyer.py',import.meta.url);
const registry=new URL('../games/rom-identities.json',import.meta.url);
const mzmHash='fc94f65380b65b870a30b9b04b39cca1dc63d6e46a4a373d3904adc0912ebc37';
function abort(signal){signal?.throwIfAborted();}
async function runExtractor(romPath,out,signal){
 abort(signal);
 await new Promise((resolve,reject)=>{
  const child=spawn('python3',[fileURLToPath(extractor),'--rom',romPath,'--out',out],{stdio:['ignore','ignore','ignore'],signal,env:{PATH:process.env.PATH,LANG:'C',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'}});
  const timer=setTimeout(()=>child.kill('SIGKILL'),15000);timer.unref();
  child.once('error',error=>{clearTimeout(timer);reject(error.code==='ENOENT'?Error('Python 3 is required for the pinned asset extractor.'):Error('Asset extraction interrupted.'));});
  child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Pinned asset extraction failed; no usable fixture was declared.'));});
 });
 abort(signal);
}
// Source declarations are hashed directly from the pinned commit, never imported
// from an unverified working tree and never confused with extracted ROM assets.
const sourceRecipes={
 'pokemon-leafgreen-version':{directory:'local/decomps/pokefirered',commit:'037335f4c725d7c9aecdac87066f2002b4bd7e14',files:['src/data/object_events/object_event_graphics_info.h','src/data/object_events/object_event_pic_tables.h','src/data/object_events/object_event_anims.h']},
 'pokemon-firered-version':{directory:'local/decomps/pokefirered',commit:'037335f4c725d7c9aecdac87066f2002b4bd7e14',files:['src/data/object_events/object_event_graphics_info.h','src/data/object_events/object_event_pic_tables.h','src/data/object_events/object_event_anims.h']},
 'pokemon-emerald-version':{directory:'local/decomps/pokeemerald',commit:'731ad5bfd6e6f265508d0efcca0ba42f9dcf5881',files:['src/data/object_events/object_event_graphics_info.h','src/data/object_events/object_event_pic_tables.h','src/data/object_events/object_event_anims.h']},
 'sonic-advance':{directory:'local/decomps/sa2',commit:'393357f7c9d46b5c10b6c41a57b80fe3b58f3c8d',files:['src/data/sa1/animations/animations.c','src/data/sa1/sprite_dimensions.c','src/data/sa1/oam_data.c']}
};
async function inspectSource(gameId,runtimeRoot,signal){
 const spec=sourceRecipes[gameId];
 const base={runtime_root_configured:Boolean(runtimeRoot),source_revision:null,toolchain_version:null,native_build_status:'not-run'};
 if(!spec)return {...base,status:'no-source-recipe'};
 if(!runtimeRoot)return {...base,status:'missing',expected_commit:spec.commit};
 const cwd=join(runtimeRoot,spec.directory);
 const git=async args=>(await execute('git',['-C',cwd,...args],{timeout:3000,maxBuffer:4*1024*1024,signal,encoding:'buffer'})).stdout;
 try{
  const commit=(await git(['rev-parse','HEAD'])).toString().trim();
  if(commit!==spec.commit)return {...base,status:'pin-mismatch',source_revision:commit,expected_commit:spec.commit};
  const tree=(await git(['rev-parse','HEAD^{tree}'])).toString().trim(),declarations=[];
  for(const path of spec.files){const bytes=await git(['show','HEAD:'+path]);declarations.push({ref:path,bytes:bytes.length,sha256:hash(bytes),declaration_count:(bytes.toString().match(/(?:const\s|INCBIN_|ANIMCMD_FRAME\()/g)||[]).length});}
  const dirty=(await git(['status','--porcelain','--untracked-files=no'])).length>0;
  return {...base,status:dirty?'pinned-metadata-working-tree-dirty':'pinned-metadata-available',source_revision:commit,source_tree:tree,expected_commit:spec.commit,declarations,working_tree_clean:!dirty,metadata_origin:'git HEAD blobs; exact expected commit',original_source_match:'not-built; declaration provenance does not prove a matching ROM build'};
 }catch(error){abort(signal);return {...base,status:'missing-or-unreadable',expected_commit:spec.commit};}
}
export async function prepareRomFixture({identity,romPath,directory,runtimeRoot,signal}){
 const started=performance.now();abort(signal);
 const rows=JSON.parse(await readFile(registry,'utf8')).originals;
 const trusted=rows.find(r=>r.id===identity?.id&&r.sha1===identity?.sha1);
 if(!trusted)throw Error('No pinned recipe identity exists for this original.');
 const stat=await lstat(romPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==trusted.size_bytes)throw Error('Original size or file type changed.');
 const rom=await readFile(romPath);abort(signal);
 const sha1=createHash('sha1').update(rom).digest('hex'),sha256=hash(rom);
 if(sha1!==trusted.sha1||rom.subarray(0xa0,0xac).toString('ascii').replaceAll('\0','').trim()!==trusted.title||rom.subarray(0xac,0xb0).toString('ascii')!==trusted.game_code||rom.subarray(0xb0,0xb2).toString('ascii')!==trusted.maker_code||rom[0xbc]!==trusted.version)throw Error('Original hash or header changed.');
 const artifacts=[];
 async function artifact(ref,type,count){const bytes=await readFile(join(directory,ref));artifacts.push({ref,type,count,bytes:bytes.length,sha256:hash(bytes)});}
 const exactMzm=trusted.id==='metroid-zero-mission'&&sha256===mzmHash;
 const recipe={id:exactMzm?'mzm-species-22-visual-assets':'validated-original-source-binding',version:1};
 if(exactMzm){
  recipe.extractor_sha256=hash(await readFile(extractor));
  await runExtractor(romPath,join(directory,'mzm-flyer'),signal);
  for(const [file,type,count] of [['tiles.4bpp','gba-4bpp-tiles',64],['palette.bgr555','gba-bgr555-palette',16],['animation.json','gba-oam-animation',5],['assets.c','c-source',1],['assets.h','c-header',1],['frames.png','image/png',5],['receipt.json','extraction-provenance',1]])await artifact('mzm-flyer/'+file,type,count);
 }
 const source_binding=await inspectSource(trusted.id,runtimeRoot,signal);
 const remaining_inputs=exactMzm?[]:[`Separate game-specific asset preparation has not run for ${trusted.id}; ROM identity and source declarations alone do not reconstruct game behavior.`,...(/pokemon-(firered|leafgreen|emerald)-version|sonic-advance/.test(trusted.id)?[source_binding.status.startsWith('pinned-metadata')?'Pinned source declaration metadata is available; run the separate bounded native fixture recipe with its validated toolchain to generate runnable assets.':'The matching pinned editable source tree and native toolchain are required for the separate native fixture build.']:[])];
 const binding={schema:'gameverse.original-fixture-binding/1',game_id:trusted.id,original:{sha1,sha256,size_bytes:rom.length,game_code:trusted.game_code,revision:trusted.version},recipe,model_calls:false,scope:exactMzm?'One species visual asset closure: 64 original 4bpp tiles, 16-color palette, five OAM frames and three animation scripts. No behavior IR, native build or gameplay qualification.':'Verified original identity and source binding only; semantic assets and runnable fixture are not prepared.',source_binding,artifacts,remaining_inputs};
 abort(signal);await writeFile(join(directory,'source-binding.json'),JSON.stringify(binding,null,2)+'\n',{flag:'wx',mode:0o600});await artifact('source-binding.json','original-fixture-binding',1);
 return {status:exactMzm?'completed':'blocked',recipe,artifacts,remaining_inputs,source_binding,scope:binding.scope,model_calls:false,fixture_capabilities:exactMzm?['visual-assets','native-c-assets']:['original-identity'],timings:{recipe_ms:Math.round(performance.now()-started),queue_ms:null,build_ms:null,simulation_ms:null,evaluation_ms:null,attempts:1,accounting:'recipe_ms is nested within preparation total_ms; no native build, simulation or evaluation ran.'}};
}
