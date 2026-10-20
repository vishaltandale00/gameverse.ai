import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {emptyAssembly,addMechanic,ownMechanicState,connectMechanics,reorderMechanic,parseAssembly} from '../src/mechanic-assembly-model.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=async path=>JSON.parse(await readFile(new URL(`../${path}`,import.meta.url)));
const a=await read('ontology/executable-components/mzm.combat.minimum_reaction2.json'),b=await read('ontology/executable-components/mzm.combat.minimum_reaction3.json');
function connected(){let graph=emptyAssembly();for(const record of [a,b]){const next=addMechanic(graph,record);graph=ownMechanicState(next.graph,next.instance,record);}return connectMechanics(graph,{source:'m1',output:'field_0',target:'m2',input:'field_0'},[a,b]);}
test('new mechanic instances preserve exact identities and connect through explicit owned shared state',()=>{
 const graph=connected(),slot=graph.components.m1.bindings.field_0.slot;
 assert.equal(graph.components.m2.bindings.field_0.slot,slot);assert.equal(graph.state[slot].owner,'m1');assert.equal(graph.state[slot].shared,true);assert.equal(graph.components.m1.behavior_sha256,a.behavior_sha256);assert.equal(graph.components.m1.package_sha256,a.package_sha256);assert.equal(graph.components.m2.behavior_sha256,b.behavior_sha256);assert.deepEqual(graph.invocations.map(c=>c.component),['m1','m2']);assert.deepEqual(parseAssembly(JSON.stringify(graph)),graph);
});
test('same package may have distinct instances and opaque storage is not automatically aliased',()=>{
 let graph=emptyAssembly();for(const record of [a,a]){const next=addMechanic(graph,record);graph=ownMechanicState(next.graph,next.instance,record);}assert.notEqual(graph.components.m1.bindings.field_0.slot,graph.components.m2.bindings.field_0.slot);assert.ok(Object.values(graph.state).every(s=>!s.shared));
 assert.throws(()=>connectMechanics(graph,{source:'m1',output:'missing',target:'m2',input:'field_0'},[a]),/declared output/);
});
test('invocation order and imported initialization remain explicit',()=>{
 const graph=connected(),reverse=reorderMechanic(graph,0,1);assert.deepEqual(reverse.invocations.map(c=>c.component),['m2','m1']);assert.deepEqual(graph.invocations.map(c=>c.component),['m1','m2']);assert.throws(()=>parseAssembly('{"schema":"old"}'),/versioned/);
 const noInitialize=structuredClone(graph);delete noInitialize.initialize;assert.ok(ownMechanicState(noInitialize,'m1',a).initialize);
});
let packagesAvailable=true;for(const record of[a,b])try{await access(new URL(`../${record.package_ref}`,import.meta.url));}catch{packagesAvailable=false;}
test('real Composer validates two new connected packages and rejects bad units, ownership and invocation order without building', {skip:!packagesAvailable},()=>{
 const graph=connected(),unit=structuredClone(graph),owner=structuredClone(graph),order=structuredClone(graph),reverse=reorderMechanic(graph,0,1),slot=graph.components.m1.bindings.field_0.slot;
 unit.state[slot].semantic_type.unit.numerator=2;owner.state[slot].owner='missing_owner';order.invocations=[{component:'m1',arguments:{}}];
 const code="import sys,json;sys.path.insert(0,'tools/behavior_ir');from assembly import validate;print(json.dumps([validate(g) for g in json.load(sys.stdin)]))";
 const receipts=JSON.parse(execFileSync('python3',['-c',code],{cwd:root,input:JSON.stringify([graph,unit,owner,order,reverse]),encoding:'utf8',timeout:10000}));
 assert.equal(receipts[0].valid,true,JSON.stringify(receipts[0].errors));assert.equal(receipts[0].status,'binding_valid_obligations_unproven');for(const receipt of receipts.slice(1,4)){assert.equal(receipt.valid,false);assert.ok(receipt.errors.length);}assert.equal(receipts[4].valid,true);assert.notEqual(receipts[0].statement_sha256,receipts[4].statement_sha256);
});
test('primary workspace keeps legacy presets secondary and validates only through the graph endpoint',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),ui=await readFile(new URL('../src/mechanic-assembly.js',import.meta.url),'utf8');assert.match(html,/id="mechanic-assembly-workbench"/);assert.match(html,/<details id="fixed-preset-workflow"/);assert.match(html,/id="ir-workbench"/);assert.match(ui,/\/api\/ir\/assembly\/validate/);assert.ok(!ui.includes('/api/ir/runs'));assert.match(ui,/Bindings accepted · obligations remain unproven/);
});
