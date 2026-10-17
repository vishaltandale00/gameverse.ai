import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreationRouter,resolveCreationRoute} from '../scripts/creation-router.mjs';
const intent='Build Pokemon Leaf Green but with Pokemon Emerald overworld sprites';
test('recovered failing request selects LeafGreen/Emerald before any Sonic capture',async()=>{
 const calls=[];const sonic={capabilities:async()=>({available:true,source_games:['sonic-advance','metroid-zero-mission']}),run:async()=>{throw Error('wrong compiler');}};
 const pokemon={capabilities:async()=>({available:false,source_games:['pokemon-leafgreen','pokemon-emerald']}),run:async args=>{calls.push(args);return {status:'blocked',reason:'missing_runtime_inputs'};}};
 const router=createCreationRouter({sonic,pokemon}),events=[];
 const result=await router.run({intent,source_games:[],onEvent:async event=>events.push(event)});
 assert.equal(result.routing.backend,'pokemon-overworld');assert.deepEqual(calls[0].source_games,['pokemon-leafgreen','pokemon-emerald']);assert.equal(events[0].routing.backend,'pokemon-overworld');assert.equal(result.reason,'missing_runtime_inputs');
 const caps=await router.capabilities();assert.equal(caps.backends.find(b=>b.id==='pokemon-overworld').available,false);assert.equal(caps.available,true);
});
test('conflicting selected games and unavailable game backends never launch fallback',async()=>{
 let calls=0;const backend={capabilities:async()=>({}),run:async()=>{calls++;}};
 const router=createCreationRouter({sonic:backend,pokemon:backend});
 const conflict=await router.run({intent,source_games:['sonic-advance','metroid-zero-mission']});assert.equal(conflict.reason,'source_selection_conflict');
 const unavailable=await router.run({intent:'Build Pokemon FireRed with Emerald graphics'});assert.equal(unavailable.reason,'source_backend_not_integrated');assert.deepEqual(unavailable.routing.source_games,['pokemon-emerald','pokemon-firered']);
 const ambiguous=await router.run({intent:'Build an adventure'});assert.equal(ambiguous.reason,'source_identity_required');assert.equal(calls,0);
});
test('Sonic request and exact parent continuation retain their own source backend',()=>{
 assert.equal(resolveCreationRoute({intent:'Combine Sonic and MZM'}).backend,'sonic-metroid');
 assert.equal(resolveCreationRoute({intent:'Move the first trainer',parent:{pipeline_result:{routing:{source_games:['pokemon-leafgreen','pokemon-emerald']}}}}).backend,'pokemon-overworld');
 assert.equal(resolveCreationRoute({intent,source_games:['pokemon-leaf-green','pokemon-emerald']}).backend,'pokemon-overworld');
});
test('exact Pokemon-as-Sonic request selects reusable host character operation',()=>{
 const route=resolveCreationRoute({intent:'I want to play Pokemon but as Sonic the main character',source_games:['sonic-advance','pokemon-leafgreen']});
 assert.equal(route.backend,null);assert.equal(route.reason,'source_roles_require_planning');assert.deepEqual(route.candidate_operations.map(o=>o.id),['sonic-player','pokemon-enemies']);
});
test('generic Pokemon character request uses pinned host while library citations do not add games',()=>{
 assert.equal(resolveCreationRoute({intent:'I want to play Pokemon but as Sonic the main character'}).reason,'source_roles_require_planning');
 assert.equal(resolveCreationRoute({intent:'Combine Sonic and MZM\nLibrary reference: Mario Emerald [system:sample] — context only.'}).backend,'sonic-metroid');
});

test('free text reaches actual source planning before selecting same-pair roles or ignoring refinements',async()=>{
 let planned,legacy=0;const backend={capabilities:async()=>({available:true}),run:async()=>{legacy++;return {status:'completed'};}};
 const agentSource={capabilities:async()=>({available:true}),run:async args=>{planned=args;return {status:'blocked',reason:'actual_source_attempt_retained'};}};
 const router=createCreationRouter({sonic:backend,pokemon:backend,agentSource});
 await router.run({intent:'sonic but the enemies are pokemon',source_games:[]});assert.deepEqual(planned.source_games,['sonic-advance','pokemon-leafgreen']);assert.equal(legacy,0);
 await router.run({intent:'Build LeafGreen with Emerald overworld sprites\nRefinement: skip introduction and name me Jeff',source_games:['pokemon-leafgreen','pokemon-emerald']});assert.match(planned.intent,/skip introduction/);assert.equal(legacy,0);
});

test('catalog source discovery investigates ambiguous Mario without copying a selected family and rejects explicit conflicts',async()=>{
 const games=[{id:'super-mario-advance',name:'Super Mario Advance'},{id:'super-mario-advance-2-super-mario-world',name:'Super Mario Advance 2: Super Mario World'},{id:'metroid-fusion',name:'Metroid Fusion'}],calls=[];
 const backend={capabilities:async()=>({available:true}),run:async()=>({status:'blocked'})};
 const router=createCreationRouter({sonic:backend,pokemon:backend,catalog:{summary:async()=>({games}),context:async()=>({items:[]})},agentSource:{run:async args=>{calls.push(args);return {status:'blocked'};}}});
 await router.run({intent:'Mario with new enemies',source_games:[]});assert.deepEqual(calls[0].source_games,[]);assert.equal(calls[0].request_plan.source_candidates.length,2);
 await router.run({intent:'SMA2 with new enemies',source_games:[]});assert.deepEqual(calls[1].source_games,['super-mario-advance-2-super-mario-world']);
 const conflict=await router.run({intent:'Super Mario Advance 2 with Metroid Fusion',source_games:['super-mario-advance','metroid-fusion']});assert.equal(conflict.reason,'source_selection_conflict');assert.equal(calls.length,2);
});
