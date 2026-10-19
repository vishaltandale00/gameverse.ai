// Fixed public fixture. No request text, provider or management credentials.
export const fixtureSource='export const add = (a, b) => a + b;\n';
export const fixtureRuntime=String.raw`import {writeFileSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import request from './request.json' with {type:'json'};
const started=Date.now();
const source='export const add = (a, b) => a + b;\n';
writeFileSync('addition.mjs',source);
const result={schema:'gameverse.manager-fixture/1',task_id:request.id,source_commit:request.source_commit,source_sha256:createHash('sha256').update(source).digest('hex'),started_at:started,finished_at:Date.now(),node:process.version,platform:process.platform,arch:process.arch,fixture_version:'1',adapter_version:'dev-manager/1',config:request.limits,model_calls:0};
writeFileSync('result.tmp',JSON.stringify(result));renameSync('result.tmp','result.json');
`;
export const fixtureVerifier=String.raw`import {add} from './addition.mjs';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(add(2,3),5);assert.equal(add(-2,3),1);assert.equal(add(0,0),0);assert.equal(add(1.5,2.25),3.75);
writeFileSync('verification.json',JSON.stringify({passed:true,cases:4}));
`;
