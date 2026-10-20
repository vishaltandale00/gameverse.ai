import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyAssembly,parseAssembly} from '../src/mechanic-assembly-model.js';
const parse=graph=>parseAssembly(JSON.stringify(graph));
test('adapter declarations and ordered adapter invocations survive parsing without reinterpretation',()=>{
 const graph={...emptyAssembly(),components:{source:{package_id:'source'},consumer:{package_id:'consumer'}},adapters:{bridge:{source_slot:'held',target_slot:'mapped',mapping:{0:1}}},invocations:[{component:'source'},{adapter:'bridge'},{component:'consumer'}]};
 assert.deepEqual(parse(graph),graph);
});
test('parser rejects ambiguous, missing and unknown adapter invocation identities',()=>{
 for(const invocation of [{},{component:'source',adapter:'bridge'},{adapter:'unknown'},{adapter:3},{adapter:''},{component:3},{component:'source',adapter:null}])assert.throws(()=>parse({...emptyAssembly(),adapters:{bridge:{}},invocations:[invocation]}),/exactly one|unknown/);
});
test('adapter table must contain named objects',()=>{
 for(const adapters of [[],null,3,{bridge:[]},{bridge:null},{'':{}}])assert.throws(()=>parse({...emptyAssembly(),adapters}),/named objects/);
 assert.deepEqual(parse(emptyAssembly()),emptyAssembly());
});
