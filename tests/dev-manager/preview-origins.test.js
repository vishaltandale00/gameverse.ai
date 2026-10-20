import test from 'node:test';import assert from 'node:assert/strict';
import {Transport} from '../../scripts/dev-manager/transport.mjs';
import {GAMEVERSE_PREVIEW_ORIGIN,trustedGameverseOrigin} from '../../src/hosted-origins.js';
test('manager may pair with the exact reviewed preview, rejecting other hosts and credential-bearing URLs',()=>{
 assert.equal(new Transport({url:GAMEVERSE_PREVIEW_ORIGIN,identity:{}}).url.origin,GAMEVERSE_PREVIEW_ORIGIN);
 for(const url of ['https://evil.example','https://other.gameverse-environment.workers.dev',GAMEVERSE_PREVIEW_ORIGIN+'.evil.example',GAMEVERSE_PREVIEW_ORIGIN.replace('https:','http:'),'https://user:secret@'+new URL(GAMEVERSE_PREVIEW_ORIGIN).host])assert.throws(()=>new Transport({url,identity:{}}),/untrusted_manager_server/);
 assert.throws(()=>new Transport({url:GAMEVERSE_PREVIEW_ORIGIN+'/api',identity:{}}),/invalid_manager_url/);
});
test('voice broker shares the exact origin fence; HTTP loopback stays explicit and test-only',()=>{
 assert.equal(trustedGameverseOrigin(new URL(GAMEVERSE_PREVIEW_ORIGIN)),true);assert.equal(trustedGameverseOrigin(new URL('https://gameverse.build')),true);
 assert.equal(trustedGameverseOrigin(new URL('http://127.0.0.1:8788')),false);assert.equal(trustedGameverseOrigin(new URL('http://127.0.0.1:8788'),{allowLoopback:true}),true);
 assert.equal(trustedGameverseOrigin(new URL('https://other.gameverse-environment.workers.dev')),false);
});
