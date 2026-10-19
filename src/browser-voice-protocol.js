// Data-only boundary shared by the trusted browser host, registry and worker.
import {assert,UUID,HASH,SOURCE} from './dev-manager-protocol.js';
export const VOICE_PROTOCOL='gameverse.browser-voice/1';
export const TOOL_NAMES=['list_games','list_sessions','open_session','start_simulated_user','run_status','stop_run'];
export const VOICE_LIMITS={wall_ms:120000,job_wall_ms:120000,max_jobs:3,max_sandboxes:2,model_calls:100};
export const VOICE_CAPS={transcribe:4,plan:4,decisions:80,reflect:8,speech:4};
export const VOICE_LEASE_MS=5000;
export function voiceTarget(value){
  assert(value&&Object.keys(value).every(k=>['sessionId','gameId','version','artifactSha256','profileId','sourceCommit'].includes(k)),'invalid_voice_target');
  assert(/^ses_[a-z0-9]{1,40}$/.test(value.sessionId)&&value.gameId==='soccer'&&typeof value.version==='string'&&value.version.length<=64&&HASH.test(value.artifactSha256)&&typeof value.profileId==='string'&&value.profileId.length>0&&value.profileId.length<=100&&SOURCE.test(value.sourceCommit),'invalid_voice_target');return {...value};
}
export function voiceBinding(value){assert(UUID.test(value?.id)&&UUID.test(value.epoch)&&UUID.test(value.manager_id),'invalid_voice_binding');const target=voiceTarget(value.target);assert(JSON.stringify(value.snapshot||{}).length<=24000,'voice_snapshot_too_large');return {id:value.id,epoch:value.epoch,manager_id:value.manager_id,target,snapshot:value.snapshot};}
export function boundedJson(value,max=32768){assert(JSON.stringify(value).length<=max,'voice_payload_too_large');return value;}
