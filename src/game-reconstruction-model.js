import {discoverReconstructionAlternatives} from './reconstruction-interoperability.js';
// Project source-published core-loop maps into the same workspace role contract.
// A phase never becomes executable merely because a source reference exists.
const array=value=>Array.isArray(value)?value:[];
const explain=value=>typeof value==='string'?value:value?.scope||value?.description||value?.id||JSON.stringify(value);
export function gameReconstructionPlans({games=[],maps=[],bundles=[],systemPlans=[],adapters=[],pairings=[]}={}){
 const candidates=[...bundles,...systemPlans.flatMap(plan=>array(plan.roles).flatMap(role=>array(role.candidates)))];
 return maps.map(map=>{
  const game=games.find(game=>game.id===map.gameId),phases=array(map.coreLoop?.phases),roles=phases.map(phase=>{
   const internal=phase.status==='internal-consumed'||phase.internalConsumed===true,ids=new Set(array(phase.prefabIds)),options=[],seen=new Set();
   for(const candidate of candidates){
    if(phase.status!=='usable-prefab')continue;
    const variantMatches=array(candidate.assemblyVariants).filter(variant=>ids.has(variant.id)&&variant.readyToAdd===true);
    const directMatch=ids.has(candidate.recoveredAssembly?.id)&&candidate.recoveredAssembly?.readyToAdd===true;
    if(!directMatch&&!variantMatches.length)continue;
    const variant=variantMatches.find(v=>v.id===candidate.recoveredAssembly?.id)||variantMatches[0],assembly=directMatch?candidate.recoveredAssembly:{...candidate.recoveredAssembly,...variant};
    const key=`${candidate.moduleId||candidate.sourceSystemId||assembly.id}:${assembly.id}`;if(seen.has(key))continue;seen.add(key);
    options.push({...candidate,id:`${phase.id}__${candidate.id}`,sourceGame:map.gameId,availability:'published-subset',roleAvailability:'published-subset',recoveredAssembly:assembly,assemblyVariants:variantMatches.length>1?variantMatches:undefined,
     scope:phase.scope||candidate.scope,gaps:[...new Set([...array(candidate.gaps),...array(phase.gaps),...array(phase.requiredServices).map(service=>`Required service: ${explain(service)}`)])]});
   }
   if(internal)options.push({id:`${phase.id}__internal`,label:'Included inside its parent prefab',sourceGame:map.gameId,availability:'internal-consumed',packageIds:[],moduleId:phase.moduleId||`${map.gameId}.${phase.id}`,scope:phase.scope||phase.label,evidence:array(phase.sourceRefs),parentPrefabIds:array(phase.parentPrefabIds||phase.prefabIds),gaps:array(phase.gaps),runtimeQualified:false});
   if(!options.length){const source=phase.status!=='missing'&&array(phase.sourceRefs).length>0;options.push({id:`${phase.id}__source`,label:source?'Inspect recovered source responsibility':'Implementation still needed',sourceGame:map.gameId,availability:source?'source-only':'missing',packageIds:[],moduleId:phase.moduleId||`${map.gameId}.${phase.id}`,scope:phase.scope||phase.label,evidence:array(phase.sourceRefs),gaps:[...array(phase.gaps),...array(phase.requiredServices).map(service=>`Required service: ${explain(service)}`),...(ids.size?[phase.status==='usable-prefab'?`No currently published, ready prefab resolves ${[...ids].join(', ')}.`:`Referenced prefabs ${[...ids].join(', ')} do not close this source-only responsibility.`]:[])],runtimeQualified:false});}
   const originals=new Set(options.map(candidate=>candidate.recoveredAssembly?.id).filter(Boolean));
   if(!internal)options.push(...discoverReconstructionAlternatives({phase,candidates,sourceGame:map.gameId,adapters,pairings}).filter(candidate=>!originals.has(candidate.recoveredAssembly?.id)));
   return {id:phase.id,label:phase.label,description:phase.description||phase.scope||`Reconstruct this source core-loop responsibility: ${phase.label}.`,required:!internal&&phase.required!==false,minCount:1,maxCount:1,capability:phase.capability||phase.id,candidates:options,reconstructionStatus:internal?'internal-consumed':phase.status,prerequisites:array(phase.requiredServices).map(explain),sourceRefs:array(phase.sourceRefs)};
  });
  const ready=roles.filter(role=>role.candidates.some(candidate=>!candidate.reconstructionAlternative&&candidate.recoveredAssembly?.readyToAdd===true)).length,firstReady=roles.find(role=>role.candidates.some(candidate=>!candidate.reconstructionAlternative&&candidate.recoveredAssembly?.readyToAdd===true));
  return {id:`reconstruct:${map.gameId}`,kind:'game-reconstruction',sourceGame:map.gameId,label:game?.shortName||game?.name||map.gameId,description:map.coreLoop?.playerOutcome||'Source core-loop reconstruction; unresolved responsibilities remain explicit.',playerOutcome:map.coreLoop?.playerOutcome,roles,recommendedStartRoleId:firstReady?.id||roles[0]?.id,dependencies:array(map.coreLoop?.edges).map(edge=>({from:edge.from,to:edge.to,contract:edge.scope||edge.contract||edge.kind})),sharedState:array(map.sharedState||map.coreLoop?.sharedState),lifecycle:phases.map(phase=>phase.label),lifecycleScope:'Declared source reconstruction phases and dependencies, not a universal executable schedule.',completionRequirements:array(map.coreLoop?.missingForCoreGame),reconstruction:{readyRoles:ready,totalRoles:roles.length,internalRoles:roles.filter(role=>role.reconstructionStatus==='internal-consumed').length,sourceRoles:roles.filter(role=>role.candidates.some(candidate=>!candidate.reconstructionAlternative&&candidate.availability==='source-only')).length,descriptorRef:map.descriptorRef,internalSupportPhases:array(map.internalSupportPhases)},runtimeQualified:false,wholeGameReady:false};
 });
}
