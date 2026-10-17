import test from 'node:test';import assert from 'node:assert/strict';
import {assessRenderSourceScope} from '../scripts/source-request-scope.mjs';
import {createSourceCandidateVerifier} from '../scripts/source-candidate-verifier.mjs';
const enemy={host:'sonic-advance',donor:'pokemon-leafgreen',role:'enemy-render'};
test('proof boundary preserves reverse host and rejects exclusions rather than swapping the wrong game',()=>{
 assert.equal(assessRenderSourceScope('sonic but the enemies are pokemon',enemy).verified,true);
 assert.equal(assessRenderSourceScope('sonic but the enemies are pokemon',{host:'pokemon-leafgreen',donor:'sonic-advance',role:'player-overworld'}).verified,false);
 for(const intent of ['Sonic but I do not want Pokemon enemies','Pokemon enemies, not in Sonic'])assert.equal(assessRenderSourceScope(intent,enemy).verified,false);
});
test('native artwork cannot satisfy an arbitrary intro/name requirement ID',async()=>{
 const core='sonic but the enemies are pokemon',extra='Refinement: skip introduction and name me Jeff';let calls=0;
 const verify=createSourceCandidateVerifier({enemy:{run:async()=>{calls++;return {artifact:{path:'/private/result.gba',sha256:'a'.repeat(64)},qualification:{schema:'gameverse.sonic-enemy-native-verification/1',outcome:'pass',scope:'native-enemy-graphics-consumer',artifact:{sha256:'a'.repeat(64)},transfer_manifest_sha256:'c'.repeat(64)},design:{scope:'Ordinary enemy rendering'},gaps:['Bosses unchanged'],provenance:{operation:'pokemon-enemies',transfer_manifest_sha256:'c'.repeat(64),coverage:{changed_bytes:30697,ordinary_enemy_families:20,native_variants:46,unique_modified_ranges:104}}};}}});
 const result=await verify({id:'test',intent:core+'\n'+extra,plan:{host:enemy.host,donors:[enemy.donor],requirements:[{id:'core',text:core},{id:'names',text:extra}]},receipt:{status:'ready-for-adapter',recipe:{operation:'pokemon-enemies',host:enemy.host,donor:enemy.donor,roles:['enemy-render'],applies_to_requirements:['names']}},directory:'/private/job'});
 assert.equal(calls,1);assert.equal(result.request_satisfied,false);assert.equal(result.requirement_ledger.requirements.find(r=>r.id==='core').status,'partial');assert.equal(result.requirement_ledger.requirements.find(r=>r.id==='names').status,'unmet');
});

test('agent-built known recipe requires independent candidate hash equality',async()=>{
 const core='sonic but the enemies are pokemon',hash='a'.repeat(64);
 const verify=createSourceCandidateVerifier({enemy:{run:async()=>({artifact:{path:'/private/result.gba',sha256:hash},qualification:{schema:'gameverse.sonic-enemy-native-verification/1',outcome:'pass',scope:'native-enemy-graphics-consumer',artifact:{sha256:'a'.repeat(64)},transfer_manifest_sha256:'c'.repeat(64)},design:{scope:'Ordinary enemy rendering'},provenance:{operation:'pokemon-enemies',transfer_manifest_sha256:'c'.repeat(64),coverage:{ordinary_enemy_families:20,native_variants:46,unique_modified_ranges:104}},gaps:[]})}});
 const args={id:'candidate',intent:core,artifact:{sha256:'b'.repeat(64)},plan:{host:enemy.host,donors:[enemy.donor],requirements:[{id:'core',text:core}]},receipt:{status:'candidate',recipe:{operation:'pokemon-enemies',host:enemy.host,donor:enemy.donor,roles:['enemy-render'],applies_to_requirements:['core']}},directory:'/private/job'};
 assert.equal((await verify(args)).outcome,'fail');
 const matched=await verify({...args,artifact:{sha256:hash}});assert.equal(matched.outcome,'pass');assert.equal(matched.request_satisfied,false);assert.equal(matched.meaningful_change_verified,true);
});
