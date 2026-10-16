// Example local agent client: reviewed intent -> registered native plan -> retained run.
import { randomUUID, createHash } from 'node:crypto';
const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):value);
async function jsonRequest(server,path,options) {
  const response=await fetch(`${server}${path}`,options),body=await response.json();
  if(!response.ok)throw Error(JSON.stringify(body));return body;
}
function planFor(capabilities,recipeId,operation,profileId) {
  const recipe=capabilities.recipes.find(row=>row.id===recipeId);
  if(!recipe?.installed)throw Error('Recipe unavailable. Inspect capabilities missing_inputs.');
  const plan={recipe_id:recipe.id,request_sha256:recipe.request_sha256};
  if(['native-improve','native-campaign'].includes(operation)) {
    const profile=capabilities.iteration_profiles.find(row=>row.id===profileId && row.recipe_id===recipeId);
    if(!profile?.installed)throw Error('Iteration profile unavailable. Inspect capabilities iteration_profiles.');
    Object.assign(plan,{profile_id:profile.id,profile_sha256:profile.profile_sha256});
  }
  return plan;
}
function send(server,path,request) {
  return jsonRequest(server,path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)})
    .then(receipt=>({request,receipt,status:()=>jsonRequest(server,`/api/improvement/runs/${request.request_id}`)}));
}
export async function submitImprovement({server='http://127.0.0.1:4173',recipeId,operation='native-mod',profileId,intent,target,environment,voiceRequestId,loopConfig,adoptFrom,requestId=randomUUID()}) {
  const capabilities=await jsonRequest(server,'/api/improvement/capabilities');
  const request={schema:'gameverse.improvement-request/1',request_id:requestId,operation,intent,target,environment,loop_version:capabilities.loop_version,
    plan:planFor(capabilities,recipeId,operation,profileId),...(voiceRequestId?{voice_request_id:voiceRequestId}:{})};
  const selectedProfile=capabilities.iteration_profiles.find(row=>row.id===profileId);
  if(selectedProfile?.version_basis==='recipe-readset/1'){request.loop_version=selectedProfile.loop_version;request.version_basis=selectedProfile.version_basis;}
  if(operation==='native-campaign'){request.loop_config=loopConfig;request.plan.loop_config_sha256=createHash('sha256').update(canonical(loopConfig)).digest('hex');if(adoptFrom)request.plan.adopt_from=adoptFrom;}
  return send(server,'/api/improvement/runs',request);
}
export async function continueImprovement({server='http://127.0.0.1:4173',priorRunId,requestId=randomUUID()}) {
  const prior=await jsonRequest(server,`/api/improvement/runs/${priorRunId}`),caps=await jsonRequest(server,'/api/improvement/capabilities');
  const request={...prior.input,request_id:requestId,loop_version:caps.loop_version,
    plan:planFor(caps,prior.input.plan.recipe_id,'native-improve',prior.input.plan.profile_id),prior_report_sha256:prior.report_sha256};
  const profile=caps.iteration_profiles.find(row=>row.id===prior.input.plan.profile_id);if(profile?.version_basis==='recipe-readset/1'){request.loop_version=profile.loop_version;request.version_basis=profile.version_basis;}
  return send(server,`/api/improvement/runs/${priorRunId}/continue`,request);
}

export async function resumeCampaign({server='http://127.0.0.1:4173',requestId}) {
  const prior=await jsonRequest(server,`/api/improvement/runs/${requestId}`),caps=await jsonRequest(server,'/api/improvement/capabilities');
  const profile=caps.iteration_profiles.find(row=>row.id===prior.input.plan.profile_id),loop_version=profile?.version_basis==='recipe-readset/1'?profile.loop_version:caps.loop_version;
  return send(server,`/api/improvement/runs/${requestId}/resume`,{request_id:requestId,loop_version,campaign_report_sha256:prior.report_sha256});
}
