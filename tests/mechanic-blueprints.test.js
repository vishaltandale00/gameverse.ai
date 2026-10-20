import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {emptyAssembly,addMechanic} from '../src/mechanic-assembly-model.js';
import {applyRecordedBlueprint,blueprintCandidate} from '../src/mechanic-blueprints.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const patterns=JSON.parse(await readFile(new URL('../ontology/composition-contracts/patterns.json',import.meta.url))).patterns;
async function fill(pattern){let graph=emptyAssembly(),slots={};for(const role of pattern.roles){if(pattern.blueprint?.slots.find(s=>s.id===role.id)?.required===false)continue;if(!role.package_id)continue;const record=JSON.parse(await readFile(new URL(`../ontology/executable-components/${role.package_id}.json`,import.meta.url)));const result=addMechanic(graph,record);graph=result.graph;slots[role.id]=result.instance;}return {graph,slots};}
test('choosing actual role pieces keeps them unwired until explicit recorded wiring is requested',async()=>{
 const pattern=patterns[0],{graph,slots}=await fill(pattern);assert.equal(Object.keys(graph.state).length,0);assert.ok(Object.values(graph.components).every(c=>!Object.keys(c.bindings).length));
 const wired=applyRecordedBlueprint(graph,pattern,slots);assert.equal(Object.keys(graph.state).length,0);assert.ok(Object.keys(wired.state).length);assert.deepEqual(wired.invocations.map(i=>i.component),pattern.graph.invocations.map(i=>slots[i.component]));
 assert.ok(Object.values(wired.state).every(s=>s.owner==='external'||Object.hasOwn(wired.components,s.owner)));assert.ok(Object.values(wired.components).every(c=>Object.values(c.bindings).every(b=>Object.hasOwn(wired.state,b.slot))));
});
test('source-only and substituted roles cannot silently acquire recorded opaque state',async()=>{
 const pattern=patterns[0],{graph,slots}=await fill(pattern);graph.components[slots[pattern.roles[0].id]].package_id='other.package';assert.throws(()=>applyRecordedBlueprint(graph,pattern,slots),/Alternative pieces require explicit/);
 const sourceOnly=patterns.find(p=>p.status==='source-pattern');assert.throws(()=>applyRecordedBlueprint(emptyAssembly(),sourceOnly,{}),/no recorded binding graph/);
 const role=sourceOnly.roles.find(r=>!r.package_id);assert.equal(blueprintCandidate({id:'anything'},role,null).status,'unavailable');
});
test('recorded explicit blueprints, including optional diagnostic omission, pass real Composer bindings without native execution',async()=>{
 const inputs=[];for(const pattern of patterns.filter(p=>p.graph)){const {graph,slots}=await fill(pattern);inputs.push(applyRecordedBlueprint(graph,pattern,slots));}
 const code="import sys,json;sys.path.insert(0,'tools/behavior_ir');from assembly import validate;print(json.dumps([validate(g) for g in json.load(sys.stdin)]))";
 const reports=JSON.parse(execFileSync('python3',['-c',code],{cwd:root,input:JSON.stringify(inputs),encoding:'utf8',timeout:10000}));
 for(let i=0;i<reports.length;i++)assert.equal(reports[i].valid,true,`${patterns.filter(p=>p.graph)[i].id}: ${JSON.stringify(reports[i].errors)}`);
});
