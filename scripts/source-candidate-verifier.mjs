import {buildRenderProofLedger} from './render-proof-ledger.mjs';
import {assessRenderSourceScope} from './source-request-scope.mjs';
import {join} from 'node:path';
// Trusted native adapters execute only declared source roles. Agent plans are not proof.
export function createSourceCandidateVerifier({enemy,pokemon}={}){
 return async function verify(args){
  const {plan,receipt,id,intent,directory,signal,onEvent,budget}=args,recipe=receipt.recipe;
  if(!['ready-for-adapter','candidate'].includes(receipt.status)||!recipe)return {outcome:'unavailable',request_satisfied:false,gaps:['The source attempt and any built candidate are retained. This generated source transformation needs an independent native consumer/profile verifier before Play; an agent build receipt is insufficient.']};
  const operation=recipe.operation;
  const supported={
   'pokemon-enemies':{host:'sonic-advance',donor:'pokemon-leafgreen',role:'enemy-render',backend:enemy},
   'sonic-player':{host:'pokemon-leafgreen',donor:'sonic-advance',role:'player-overworld',backend:pokemon},
   'emerald-overworld':{host:'pokemon-leafgreen',donor:'pokemon-emerald',role:'overworld-objects',backend:pokemon},
  }[operation];
  const roles=Array.isArray(recipe.roles)?recipe.roles:[];
  if(!supported||!supported.backend)return {outcome:'unavailable',request_satisfied:false,gaps:[`No independent native verifier is installed for submitted operation ${String(operation)}. The actual agent investigation and proposed source edits remain available.`]};
  if(plan.host!==supported.host||!plan.donors.includes(supported.donor)||recipe.host!==supported.host||recipe.donor!==supported.donor||!roles.includes(supported.role))return {outcome:'fail',request_satisfied:false,gaps:['The submitted adapter roles do not match the requested host/donor/consumer plan. No substitute cartridge was built.']};
  const scope=assessRenderSourceScope(intent,{host:supported.host,donor:supported.donor,role:supported.role});
  if(!scope.verified)return {outcome:'fail',request_satisfied:false,gaps:['The native render recipe does not independently match an explicit host/donor/consumer statement in the original request. The agent attempt is retained; no substitute host was published.']};
  if(args.parent)return {outcome:'unavailable',request_satisfied:false,gaps:['This refinement must preserve the exact parent source changes. The fixed render recipe cannot reset that lineage; the agent source attempt is retained for a parent-aware verified build.']};
  const ids=Array.isArray(recipe.applies_to_requirements)?recipe.applies_to_requirements:[];
  if(!ids.length||ids.some(id=>!plan.requirements.some(r=>r.id===id)))return {outcome:'fail',request_satisfied:false,gaps:['The native recipe must explicitly identify which request requirements it implements; extra clauses cannot be silently absorbed.']};
  const result=await supported.backend.run({id,intent,source_games:[supported.host,supported.donor],directory:join(directory,'native-adapter'),signal,onEvent,budget,operation,plan});
  if(result.qualification?.outcome!=='pass'||!result.artifact)return {...(result.qualification||{outcome:'unavailable'}),request_satisfied:false,gaps:result.gaps||[result.reason||'The independent native adapter did not produce a qualified artifact.']};
  if(receipt.status==='candidate'&&args.artifact?.sha256!==result.artifact.sha256)return {outcome:'fail',request_satisfied:false,gaps:['The agent-built cartridge differs from the independently reproduced native render transformation. Both candidates remain retained; a matching verification profile is required before publication.']};
  const expectedParameters=operation==='pokemon-enemies'?{mapping_policy:'native-family-to-pokemon-icon',palette_policy:'adapt-to-host'}:{};
  const unsupported=Object.entries(recipe.parameters||{}).filter(([key,value])=>expectedParameters[key]!==value).map(([key])=>key);
  const gaps=[...(result.gaps||[]),...unsupported.map(key=>`Requested parameter ${key} was not applied by this render adapter.`),'Each requirement below reports only its native render contribution. Any requested behavior, names, intro, map or size changes outside that proof remain unmet or partial.'];
  const covered=r=>scope.core_clauses.includes(r.text)||ids.includes(r.id)&&assessRenderSourceScope(r.text,{host:supported.host,donor:supported.donor,role:supported.role}).verified;
  const requirement_ledger=operation==='pokemon-enemies'?buildRenderProofLedger({plan,core_clauses:scope.core_clauses,claimedIds:ids,qualification:result.qualification,artifact:result.artifact,provenance:result.provenance,designScope:result.design?.scope,covered}):{requirements:plan.requirements.map(r=>({...r,status:covered(r)?'partial':'unmet',evidence:covered(r)?[{scope:result.qualification.scope,artifact_sha256:result.artifact.sha256,proof:result.provenance}]:[],scope:covered(r)?result.design?.scope:'No verified transformation was applied for this requirement.'}))};
  return {...result.qualification,artifact:result.artifact,request_satisfied:false,allow_verified_partial:true,meaningful_change_verified:true,source_roles_verified:true,intent_coverage_verified:scope.unverified_clauses.every(text=>plan.requirements.some(r=>r.text===text)),requirement_ledger,gaps,adapter_provenance:result.provenance,adapter_timings:result.timings,source_roles:{host:supported.host,donor:supported.donor,roles:[supported.role]},core_transform_verified:true};
 };
}
