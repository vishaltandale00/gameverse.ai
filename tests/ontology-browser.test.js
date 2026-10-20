import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ontologyEntries, filterOntology, normalizeAnnotation, researchSelection, assemblySelection, compareContractPorts } from '../src/ontology-browser-model.js';
const catalog={games:[{id:'source-a',components:[{id:'move',label:'Move',facet:'movement',reads:['speed'],writes:['x'],evidence:[{kind:'decomp_source',ref:'source.c:12'}]}]}],executableComponents:[{id:'motion',source_game:'source-a',label:'Finite motion',role:'movement',qualification:{status:'pass',vectors:16,scope:'finite synthetic fields'},limitations:['No scene trace'],ports:[{id:'x',semantic_type:{quantity:'position'}}]}],recoveredSystems:{systems:[{id:'jump-system',gameId:'source-b',name:'Jump lifecycle',readiness:'source-backed-system',executable:false,capabilities:['jump'],callOrder:[{value:{before:'launch',after:'integrate',status:'unproven'},provenance:{ref:'packet.json',pointer:'/order'}}],coverage:{gaps:['Landing unproven']}}]}};
test('ontology preserves source scheduling evidence and distinguishes finite L1 subsets from static L2',()=>{
 const entries=ontologyEntries(catalog);assert.equal(entries.length,3);
 const l2=entries.find(e=>e.level==='L2');assert.deepEqual(l2.callOrder,catalog.recoveredSystems.systems[0].callOrder);assert.equal(l2.executable,false);assert.deepEqual(l2.coverage.gaps,['Landing unproven']);
 const qualified=entries.find(e=>e.readiness==='finite-qualified-subset');assert.equal(qualified.level,'L1');assert.equal(qualified.executable,false);assert.equal(qualified.qualification.vectors,16);assert.ok(qualified.coverage.gaps.some(g=>g.includes('availability')));
 const source=entries.find(e=>e.readiness==='source-record');assert.deepEqual(source.inputs,['speed']);assert.deepEqual(source.provenance,[{kind:'decomp_source',ref:'source.c:12'}]);
});
test('source, level, readiness, capability, evidence and local tag filters combine without inventing results',()=>{
 const entries=ontologyEntries(catalog),annotations={'system:jump-system':{tags:['review'],notes:'landing clock'}};
 assert.equal(filterOntology(entries,{game:'source-a',level:'L1',capability:'movement',readiness:'finite-qualified-subset'}).length,1);
 assert.equal(filterOntology(entries,{game:'source-b',taggedOnly:true,query:'clock'},annotations).length,1);
 assert.equal(filterOntology(entries,{game:'missing'}).length,0);
 assert.equal(filterOntology(entries,{query:'packet.json'}).length,1);
});
test('prior analyses stay separate from new source system contracts while preserving source readiness',()=>{
 const source=structuredClone(catalog);source.recoveredSystems.systems[0].recordKind='prior-source-analysis';const record=ontologyEntries(source)[0];assert.equal(record.readiness,'prior-source-analysis');assert.equal(record.sourceReadiness,'source-backed-system');assert.equal(filterOntology([record],{readiness:'source-backed-system'}).length,0);
});
test('annotation export retains exact inspected contracts and never creates a build request',()=>{
 const entries=ontologyEntries(catalog),a=normalizeAnnotation(' candidate, candidate, review, ','Port clock needed');assert.deepEqual(a.tags,['candidate','review']);
 const selection=researchSelection(entries,{'system:jump-system':a},['system:jump-system']);assert.equal(selection.records.length,1);assert.deepEqual(selection.records[0].callOrder,entries[0].callOrder);assert.deepEqual(selection.records[0].annotation,a);assert.ok(!('request' in selection));assert.match(selection.purpose,/no game creation/);
});

test('capture-only and model-only observations do not become ROM-derived L1 mechanics',()=>{
 const source=structuredClone(catalog);source.games[0].components.push({id:'visual-style',evidence:[{kind:'capture_frame',ref:'frame.png'}]},{id:'recalled',evidence:[{kind:'llm_knowledge'}]});assert.equal(ontologyEntries(source).length,3);
});
test('source library is additive to Mashup and performs no automatic compiler calls',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');const ui=await readFile(new URL('../src/ontology-browser.js',import.meta.url),'utf8');const workshop=await readFile(new URL('../src/workshop.js',import.meta.url),'utf8');
 assert.match(html,/id="ir-workbench"/);assert.match(html,/id="ontology-workbench"/);assert.match(html,/Mashup/);assert.match(workshop,/createIrWorkshop/);assert.match(workshop,/createOntologyBrowser/);
 assert.ok(!ui.includes('fetch('));assert.ok(!ui.includes('/api/ir/'));assert.match(html,/SOURCE LIBRARY \/ L1 \+ L2/);
});

test('assembly basket exports contracts outside preset roles and explicitly leaves bindings unresolved',()=>{
 const entries=ontologyEntries(catalog);const basket=assemblySelection(entries,{},entries.map(e=>e.key));assert.equal(basket.members.length,3);assert.equal(basket.status,'unbound-selection');assert.equal(basket.executable,false);assert.equal(basket.buildRequest,null);assert.equal(basket.presetGeneratorSupport,'not-evaluated');assert.equal(basket.compatibility.status,'not-validated');assert.ok(basket.compatibility.required.some(r=>r.includes('ownership')));
});
test('port comparison distinguishes declared candidates, adapters, incompatible frames and unknown semantics',()=>{
 const port=(direction,frame='world.x',denominator=1,storage_type='u16')=>({id:'p',direction,storage_type,semantic_type:{quantity:'position',frame,unit:{numerator:1,denominator}}});
 const compare=(a,b)=>compareContractPorts({ports:[a]},{ports:[b]})[0];
 assert.equal(compare(port('out'),port('in')).status,'candidate');assert.equal(compare(port('out'),port('in','world.x',256)).status,'adapter-required');assert.equal(compare(port('out'),port('in','screen.x')).status,'incompatible');assert.equal(compare(port('out'),{id:'unknown',direction:'in'}).status,'unknown');const signed=port('in');signed.semantic_type.signed_encoding='twos_complement';assert.equal(compare(port('out'),signed).status,'incompatible');assert.equal(compareContractPorts({ports:[port('in')]},{ports:[port('in')]}).length,0);
});
