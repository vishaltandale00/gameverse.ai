import test from 'node:test';import assert from 'node:assert/strict';import{gameplayRows}from'../src/takeover-panel.js';
const soccer={runId:'s',sessionId:'soccer-session',gameId:'soccer',role:'gameplay',state:'running',displayed:true};
const world={runId:'w',sessionId:'world-session',gameId:'overworld',role:'gameplay',state:'running',displayed:true};
test('one row per active gameplay user; a speech requester is never a player row',()=>{const r=gameplayRows({running:[soccer,world,{...world,role:'requester'},{...soccer,state:'released'}]},'world-session');assert.equal(r.length,2);assert.equal(r[0].status,'Playing in background');assert.equal(r[1].watching,true);});
test('watching is derived from the current view instead of stale host flags',()=>{const r=gameplayRows({running:[soccer,world]},'soccer-session');assert.equal(r[0].watching,true);assert.equal(r[1].watching,false);assert.match(r[1].status,/background/);assert.deepEqual(r.map(x=>x.title),['Soccer','Overworld']);});
