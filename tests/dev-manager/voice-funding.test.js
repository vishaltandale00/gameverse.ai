import test from 'node:test';import assert from 'node:assert/strict';
import {voiceCredentialSource,applicationVoiceStatus,applicationVoiceCredential} from '../../infra/cloudflare/hosted-voice-funding.js';
const env={VOICE_OPENAI_API_KEY:'sk-synthetic-application',AGENT_CREDENTIAL_KEY:'1'.repeat(64)};
async function task(){const status=await applicationVoiceStatus(env);return {kind:'voice-agent',parent_id:null,deadline:Date.now()+10000,connection:{...status}};}
test('application voice is the default explicit payer and never borrows a generic or personal key',async()=>{
 assert.equal(voiceCredentialSource({}),'application');assert.throws(()=>voiceCredentialSource({HOSTED_VOICE_CREDENTIALS:'fallback'}),/invalid_voice_credential_source/);
 assert.equal((await applicationVoiceStatus({OPENAI_API_KEY:'sk-other',AGENT_CREDENTIAL_KEY:env.AGENT_CREDENTIAL_KEY})).available,false);
 const t=await task();assert.equal(await applicationVoiceCredential(env,t,'transcribe'),env.VOICE_OPENAI_API_KEY);assert.equal(await applicationVoiceCredential(env,t,'decisions'),env.VOICE_OPENAI_API_KEY);
});
test('application capabilities reject changed funding/key, expiry, child jobs and unsupported services',async()=>{
 const t=await task();await assert.rejects(applicationVoiceCredential({...env,VOICE_OPENAI_API_KEY:'sk-rotated'},t,'plan'),/grant_revoked/);
 await assert.rejects(applicationVoiceCredential({...env,HOSTED_VOICE_CREDENTIALS:'account'},t,'plan'),/funding_changed/);
 await assert.rejects(applicationVoiceCredential(env,{...t,parent_id:'other'},'plan'),/invalid_voice_application_scope/);
 await assert.rejects(applicationVoiceCredential(env,{...t,deadline:Date.now()-1},'plan'),/invalid_voice_application_scope/);
 await assert.rejects(applicationVoiceCredential(env,t,'speech'),/invalid_voice_application_scope/);
});
