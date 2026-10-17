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
