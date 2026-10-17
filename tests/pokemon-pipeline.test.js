import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {supportsPokemonIntent,createPokemonPipeline} from '../scripts/pokemon-pipeline.mjs';
test('LeafGreen overworld request does not reverse host/donor or absorb mechanics',()=>{
 assert.equal(supportsPokemonIntent('Build Pokemon Leaf Green but with Pokemon Emerald overworld sprites'),true);
 assert.equal(supportsPokemonIntent('Build Pokemon Emerald with Leaf Green overworld sprites'),false);
 assert.equal(supportsPokemonIntent('Build LeafGreen with Emerald battle sprites'),false);
 assert.equal(supportsPokemonIntent('Build LeafGreen with Emerald overworld sprites and new maps'),false);
});
test('Pokemon availability distinguishes local source prerequisites from qualification',async()=>{
 const pipeline=createPokemonPipeline({root:process.cwd(),runtimeRoot:'/nonexistent/pokemon-runtime'});
 const caps=await pipeline.capabilities();assert.equal(caps.available,false);assert.equal(caps.source_available,false);assert.equal(caps.base_game,'pokemon-leafgreen');assert.equal(caps.missing_inputs.length,4);assert.equal(caps.supports.arbitrary_game_pairs,false);
});
test('unsupported source roles stop before any compiler stage',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pokemon-direction-'));let called=false;
 try{
  const pipeline=createPokemonPipeline({root:process.cwd(),child:()=>{called=true;throw Error('must_not_compile');}});
  const result=await pipeline.run({id:'direction',intent:'Build Emerald with LeafGreen overworld sprites',directory});
  assert.equal(result.reason,'unsupported_pokemon_operation');assert.equal(result.qualification.outcome,'unavailable');assert.equal(called,false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('Sonic character artwork operation rejects unsupported physics requests before build',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pokemon-character-'));let called=false;
 try {
  const pipeline=createPokemonPipeline({root:process.cwd(),child:()=>{called=true;throw Error('must_not_compile');}});
  const result=await pipeline.run({id:'character',intent:'Pokemon as Sonic with spin dash physics',source_games:['sonic-advance','pokemon-leafgreen'],directory});
  assert.equal(result.reason,'unsupported_pokemon_operation');assert.equal(called,false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('uploaded immutable originals satisfy capabilities and are pinned into source preparation',async()=>{
 const {mkdir,writeFile}=await import('node:fs/promises');const runtime=await mkdtemp(join(tmpdir(),'pokemon-upload-resolver-'));const directory=join(runtime,'job');
 try{
  for(const ref of ['local/decomps/pokefirered/leafgreen_rev1.sha1','local/decomps/sa2/src/data/sa1/sprite_tables.c','local/game-builds/toolchains/agbcc-sonic/agbcc']){const p=join(runtime,ref);await mkdir(join(p,'..'),{recursive:true});await writeFile(p,'fixture');}
  const original=join(runtime,'uploaded-original.gba');await writeFile(original,'private fixture');let args;
  const pipeline=createPokemonPipeline({root:process.cwd(),runtimeRoot:runtime,originalResolver:async id=>({path:original,game_id:id}),child:async(command,arguments_)=>{args=arguments_;throw Error('stop_after_source_pin');}});
  assert.equal((await pipeline.capabilities('sonic-player')).available,true);
  await assert.rejects(pipeline.run({id:'upload',intent:'Pokemon as Sonic the main character',source_games:['pokemon-leafgreen','sonic-advance'],directory}),/stop_after_source_pin/);
  assert.equal(args[args.indexOf('--host-original')+1],original);assert.equal(args[args.indexOf('--donor-original')+1],original);
 }finally{await rm(runtime,{recursive:true,force:true});}
});
