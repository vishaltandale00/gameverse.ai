import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrivInputBridge,DB_DRIV_INPUT_BRIDGE} from '../src/reconstruction-input-bridge.js';
test('bridge uses canonical previous held, active-low normalization and newly pressed lane',()=>{
 const canonical={held:16,pressed:0},seen=[];
 const bridge=createDrivInputBridge(canonical,state=>{seen.push({...state});state.field_2=state.field_6;state.field_3=32;state.field_5=240;});
 assert.deepEqual(bridge.step(0xffff^32),{held:32,pressed:32});assert.equal(seen[0].field_2,16);assert.equal(seen[0].field_0,0);assert.equal(seen[0].field_1,16);assert.equal(seen[0].field_6,32);assert.equal(canonical.pressed,32);assert.equal(DB_DRIV_INPUT_BRIDGE.readyToAdd,false);
});
test('bridge fails before canonical publication for absent or asynchronous recovered execution',()=>{
 assert.throws(()=>createDrivInputBridge({held:0,pressed:0}),/required/);
 const canonical={held:1,pressed:1},bridge=createDrivInputBridge(canonical,state=>{state.field_2=0;return Promise.resolve();});assert.throws(()=>bridge.step(65535),/synchronously/);assert.deepEqual(canonical,{held:1,pressed:1});
 const invalid=createDrivInputBridge(canonical,state=>{state.field_2=1024;});assert.throws(()=>invalid.step(65535),/low-ten/);assert.deepEqual(canonical,{held:1,pressed:1});assert.throws(()=>invalid.step(-1),/u16/);
});
