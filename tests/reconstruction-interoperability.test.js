import test from 'node:test';
import assert from 'node:assert/strict';
import {assessReconstructionCompatibility, discoverReconstructionAlternatives, reconstructionContractDifferences} from '../src/reconstruction-interoperability.js';

// Isolated interface fixture tests the matcher, not a newly qualified game bridge.
const contract = () => ({id:'test.input/1',capability:'held-to-pressed-u16',ports:[{name:'held',direction:'inout',type:'u16',unit:'bitmask',frame:'input.sample',ownership:'canonical-input'},{name:'pressed',direction:'out',type:'u16',unit:'bitmask',frame:'input.sample',ownership:'canonical-input'}],eventOrder:['sample','edge','consume'],services:[],domain:{mask:1023,invocationsPerSample:1},evidence:['fixture:explicit-interface']});
const phase = () => ({id:'input',interoperabilityContract:contract()});
const candidate = () => ({id:'input-prefab',sourceGame:'other-game',availability:'published-subset',packageIds:['input.edge'],recoveredAssembly:{id:'input.edge',readyToAdd:true},interoperabilityContract:contract(),evidence:['fixture:source']});

test('complete matching explicit interfaces allow crossgame discovery without changing provenance',()=>{
 const original=candidate(),[choice]=discoverReconstructionAlternatives({phase:phase(),candidates:[original],sourceGame:'target-game'});
 assert.equal(choice.compatibility.state,'directly-compatible');assert.equal(choice.compatibility.selectable,true);assert.equal(choice.sourceGame,'other-game');assert.equal(choice.originalCandidateId,original.id);assert.equal(choice.sourceFaithful,false);assert.equal(choice.runtimeQualified,false);assert.equal(original.recoveredAssembly.readyToAdd,true);
});
test('each semantic dimension rejects superficial capability agreement',()=>{
 for(const dimension of ['direction','type','unit','frame','ownership']){const other=candidate();other.interoperabilityContract.ports[0][dimension]='different';const result=assessReconstructionCompatibility({phase:phase(),candidate:other,sourceGame:'target-game'});assert.equal(result.state,'adapter-required');assert.equal(result.selectable,false);assert.ok(result.missingBridge.some(reason=>reason.includes(dimension)));}
 for(const field of ['eventOrder','services','domain']){const other=candidate();other.interoperabilityContract[field]=field==='domain'?{mask:65535}:['different'];assert.equal(assessReconstructionCompatibility({phase:phase(),candidate:other}).selectable,false);}
});
test('absent contracts and missing dimensions fail closed, including extra unbound ports',()=>{
 const other=candidate();delete other.interoperabilityContract.ports[0].unit;assert.ok(reconstructionContractDifferences(contract(),other.interoperabilityContract).some(reason=>reason.includes('unit is missing')));
 delete other.interoperabilityContract;assert.equal(assessReconstructionCompatibility({phase:phase(),candidate:other}).state,'adapter-required');
 const extra=contract();extra.ports.push({...extra.ports[0],name:'private-state'});assert.ok(reconstructionContractDifferences(contract(),extra).some(reason=>reason.includes('extra port')));
 const malformed=contract();malformed.domain=null;malformed.eventOrder=null;assert.ok(reconstructionContractDifferences(malformed,malformed).some(reason=>reason.includes('explicit constraint record')));assert.ok(reconstructionContractDifferences(malformed,malformed).some(reason=>reason.includes('explicit list')));
});
test('source qualifications do not make an unavailable whole responsibility addable',()=>{
 const other=candidate();other.availability='source-only';other.runtimeQualified=true;const result=assessReconstructionCompatibility({phase:phase(),candidate:other});assert.equal(result.state,'source-only');assert.equal(result.selectable,false);assert.equal(result.runtimeQualified,false);
 const facet=candidate();facet.roleFacets=[{capability:contract().capability,status:'source-only'}];assert.equal(assessReconstructionCompatibility({phase:phase(),candidate:facet}).selectable,false);
});
test('discovery requires explicit exact capability; shared words and game genres do not match',()=>{
 const other=candidate();other.interoperabilityContract.capability='vehicle-movement';other.label='Input movement';assert.deepEqual(discoverReconstructionAlternatives({phase:phase(),candidates:[other]}),[]);
 assert.deepEqual(discoverReconstructionAlternatives({phase:{id:'movement'},candidates:[other]}),[]);
});
test('prose adapter claims cannot admit differing frames; concrete checked adapter remains explicit',()=>{
 const other=candidate();other.interoperabilityContract.id='test.other-input/1';other.interoperabilityContract.ports[0].frame='other-input';
 const adapter={id:'input-bridge',fromCandidateId:other.id,toPhaseId:'input',fromContractId:'test.other-input/1',toContractId:'test.input/1',status:'implemented',readyToAdd:true};
 assert.equal(assessReconstructionCompatibility({phase:phase(),candidate:other,adapters:[adapter]}).selectable,false);
 Object.assign(adapter,{validationRef:'fixture:checked-adapter',evidence:['fixture:adapter'],mappings:[{from:'held',to:'held',frame:'explicit sample correspondence'}],outputContract:contract()});
 const result=assessReconstructionCompatibility({phase:phase(),candidate:other,adapters:[adapter]});assert.equal(result.state,'adapter-required');assert.equal(result.adapterId,'input-bridge');assert.equal(result.selectable,false);
});
test('real source input opportunity stays adapter-required with missing physical and lifecycle bridges',()=>{
 const db={id:'db-input',sourceGame:'dragon-ball-advanced-adventure',capability:'held-to-pressed-u16',availability:'published-subset',recoveredAssembly:{id:'db.actor_input_edges_repeat',readyToAdd:true},evidence:['research/deep-extraction/resume/dragon-ball-advanced-adventure/prefab-pass/delivery.json']};
 const target={id:'input-capture',capability:'held-to-pressed-u16',sourceRefs:['research/deep-extraction/resume/driv3r/next-extraction/system.json']};
 const [choice]=discoverReconstructionAlternatives({phase:target,candidates:[db],sourceGame:'driv3r'});assert.equal(choice.compatibility.state,'adapter-required');assert.equal(choice.recoveredAssembly.readyToAdd,false);assert.equal(choice.sourceGame,db.sourceGame);assert.ok(choice.compatibility.missingBridge.some(reason=>reason.includes('contract is missing')));
});
test('reviewed exact source pairing discovers unpublished interfaces without promoting a full role',()=>{
 const source={id:'db-bundle',sourceGame:'dragon-ball-advanced-adventure',availability:'published-subset',packageIds:['db.input.actor_edges_repeat'],recoveredAssembly:{id:'db.actor-input.sample-edges-repeat',readyToAdd:true}};
 const pair={targetGame:'driv3r',sourceGame:source.sourceGame,roleId:'input-capture',state:'adapter-required',candidateIds:['db.input.actor_edges_repeat'],evidence:['research/deep-extraction/resume/driv3r/system-prefab/input-sampling.source.c'],reasons:['Same rising-edge subset; source repeat stays private.'],missingBridge:['Live 08004d08 invocation and original 08004dd4 consumer remain external.']};
 const options=discoverReconstructionAlternatives({phase:{id:'input-capture'},sourceGame:'driv3r',candidates:[source],pairings:[pair]});assert.equal(options.length,1);assert.equal(options[0].compatibility.selectable,false);assert.equal(options[0].sourceGame,source.sourceGame);assert.ok(options[0].gaps.some(gap=>gap.includes('08004dd4')));
 const wrong={...pair,targetGame:'other'};assert.equal(discoverReconstructionAlternatives({phase:{id:'input-capture'},sourceGame:'driv3r',candidates:[source],pairings:[wrong]}).length,0);
});
