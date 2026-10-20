import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionView} from '../../src/agent-connection-view.js';

test('connection progress distinguishes preparation, authorization, verification and saved success',()=>{
  const running={type:'connect',phase:'running',auth_url:'https://claude.ai/oauth/authorize'};
  assert.equal(connectionView(null,null,{step:'starting'}).step,'preparing');
  assert.equal(connectionView(null,running).step,'authorize');
  assert.equal(connectionView(null,running,{step:'verifying'}).step,'verifying');
  const verifying={...running,auth_url:null,connection_step:'verifying'};
  assert.equal(connectionView(null,verifying).busy,true);
  assert.equal(connectionView({status:'connected'},verifying,{step:'verifying'}).step,'connected');
  assert.equal(connectionView(null,{...running,cancellation_requested:true}).step,'cancelling');
  assert.equal(connectionView(null,{phase:'failed',reason:'deadline_or_access_expired'}).step,'failed');
  assert.match(connectionView(null,{phase:'failed',reason:'deadline_or_access_expired'}).detail,/expired/);
  assert.equal(connectionView({status:'reconnect_required'},null).step,'reconnect');
});
