import {assert,SOURCE,HASH,canonical} from './dev-manager-protocol.js';
export const HOSTED_VOICE_EXECUTOR='hosted-api-key';
// Explicit operator policy; no production quota or billing default is invented.
export function hostedVoicePolicy(env){
  let p;try{p=JSON.parse(env.HOSTED_VOICE_POLICY);}catch{throw Error('hosted_voice_policy_required');}
  const bounds={wall_ms:[1000,120000],model_calls:[1,100],account_active:[1,2],platform_active:[1,8],daily_jobs:[1,100]};
  assert(p&&Object.keys(p).sort().join(',')===Object.keys(bounds).sort().join(','),'invalid_hosted_voice_policy');
  for(const [k,[min,max]] of Object.entries(bounds))assert(Number.isInteger(p[k])&&p[k]>=min&&p[k]<=max,'invalid_hosted_voice_policy');
  return {...p};
}
export function hostedVoiceRelease(value){
  assert(value?.schema==='gameverse.hosted-voice-release/1'&&SOURCE.test(value.source_commit)&&HASH.test(value.sha256),'invalid_voice_release');
  assert(Array.isArray(value.games)&&value.games.length===1&&value.games[0].gameId==='soccer'&&HASH.test(value.games[0].artifactSha256),'invalid_voice_release');
  const names=['voice-worker.mjs','voice-agent.js','agent-client.js','package.json','source.json'];
  assert(value.files&&Object.keys(value.files).sort().join(',')===names.sort().join(','),'invalid_voice_release');
  assert(names.every(n=>typeof value.files[n]==='string'&&value.files[n].length<=262144),'invalid_voice_release');
  return value;
}
export const releaseContent=value=>canonical({schema:value.schema,source_commit:value.source_commit,games:value.games,files:value.files});
