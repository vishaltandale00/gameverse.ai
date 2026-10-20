import {assert,digest} from '../../src/dev-manager-protocol.js';
const services=new Set(['transcribe','plan','decisions','reflect']);
// Funding is an operator choice, never an automatic fallback between payers.
export function voiceCredentialSource(env){const source=env.HOSTED_VOICE_CREDENTIALS||'application';assert(['application','account'].includes(source),'invalid_voice_credential_source');return source;}
export async function applicationVoiceStatus(env){
  const key=env.VOICE_OPENAI_API_KEY;
  return {source:'application',available:typeof key==='string'&&key.length>0,generation:key?await digest('voice-application:'+env.AGENT_CREDENTIAL_KEY+':'+key):null,revision:1};
}
export async function applicationVoiceCredential(env,task,service){
  assert(voiceCredentialSource(env)==='application'&&task.connection?.source==='application','voice_funding_changed');
  assert(task.kind==='voice-agent'&&task.parent_id===null&&task.deadline>Date.now()&&services.has(service),'invalid_voice_application_scope');
  const status=await applicationVoiceStatus(env);assert(status.available&&status.generation===task.connection.generation&&status.revision===task.connection.revision,'voice_application_grant_revoked');
  return env.VOICE_OPENAI_API_KEY;
}
