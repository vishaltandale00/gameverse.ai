import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
export async function voicePackage(source_commit) {
  if(!/^[a-f0-9]{40}$/.test(source_commit))throw Error('invalid_voice_source');
  const files=new Map();
  for(const [name,path] of [['voice-worker.mjs','scripts/voice-worker/main.mjs'],['voice-agent.js','src/voice-agent.js'],['agent-client.js','src/agent-client.js']]) {
    // Read immutable Git objects. Editing the manager checkout after startup
    // cannot change the source bound to an already admitted voice job.
    let data;
    try {data=execFileSync('git',['show',`${source_commit}:${path}`],{cwd:root,encoding:'utf8',maxBuffer:262144,stdio:['ignore','pipe','ignore']});}
    catch {throw Error('voice_source_unavailable');}
    files.set(name,data);
  }
  files.set('package.json','{"type":"module"}');
  const manifest=JSON.stringify({schema:'gameverse.voice-worker-package/1',source_commit,files:[...files].map(([name,data])=>({name,sha256:createHash('sha256').update(data).digest('hex')}))});
  files.set('source.json',manifest);
  return {files,manifest};
}
export const voiceVerifier=String.raw`import {readFileSync,writeFileSync,renameSync} from 'node:fs';import assert from 'node:assert/strict';const result=JSON.parse(readFileSync('result.json')),request=JSON.parse(readFileSync('launch.json'));assert.equal(result.schema,'gameverse.voice-worker-result/1');assert.equal(result.task_id,request.task_id);assert.equal(result.source_commit,request.source_commit);assert.equal(result.session_id,request.session_id);assert(Number.isInteger(result.provider_attempts)&&result.provider_attempts>=0&&result.provider_attempts<=100);assert(['completed','released','failed'].includes(result.outcome));assert.equal(result.synthetic,request.synthetic);assert.equal(result.model_calls,result.synthetic?0:result.provider_attempts);assert(result.finished_at>=result.started_at);writeFileSync('verification.tmp',JSON.stringify({passed:true}));renameSync('verification.tmp','verification.json');console.log('Voice worker identity and bounds verified; gameplay claims require browser evidence.');`;
