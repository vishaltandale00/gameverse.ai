import {GAME_SYSTEM_PLANS} from './game-system-assembly-plans.js';
import {attachCapabilityBundles} from './game-system-capability-bundles.js';
import {gameReconstructionPlans} from './game-reconstruction-model.js';
export function workspaceSystemPlans(catalog={}){
 const deliveries=Array.isArray(catalog.recoveredPrefabDeliveries)?catalog.recoveredPrefabDeliveries:[],registered=new Set((catalog.recoveredPrefabManifest?.prefabs||[]).map(row=>row.id));
 const bundles=deliveries.flatMap(delivery=>delivery.bundles||[]).map(bundle=>{const value=structuredClone(bundle);if(value.recoveredAssembly?.readyToAdd&&!registered.has(value.recoveredAssembly.id))value.recoveredAssembly.readyToAdd=false;for(const variant of value.assemblyVariants||[])if(variant.readyToAdd&&!registered.has(variant.id))variant.readyToAdd=false;return value;});
 const blueprints=attachCapabilityBundles(structuredClone(GAME_SYSTEM_PLANS),bundles);
 return [...blueprints,...gameReconstructionPlans({games:catalog.games,maps:deliveries,bundles,systemPlans:blueprints,pairings:catalog.reconstructionPairings||[],adapters:catalog.reconstructionAdapters||[]})];
}
export function selectedSystemVariant(candidate,id){
 const variant=candidate?.assemblyVariants?.find(variant=>variant.id===(id||candidate.recoveredAssembly?.id));
 return variant?{...candidate,recoveredAssembly:{...candidate.recoveredAssembly,...variant}}:candidate;
}

export const isReadyGamePrefab=candidate=>candidate?.availability==='published-subset'&&candidate?.roleAvailability!=='source-only'&&candidate?.recoveredAssembly?.readyToAdd===true;

// Canonical source identity alone does not establish installed phase coverage.
export function systemBundleRelationship(candidate,choice){
 if(!choice||!candidate?.moduleId||choice.moduleId!==candidate.moduleId)return 'unrelated';
 if(!isReadyGamePrefab(candidate))return 'reference';
 if(!choice.instances?.length)return 'upgrade';
 const requested=candidate.recoveredAssembly.id;
 if(choice.prefabId===requested||(choice.coveredPrefabIds||[]).includes(requested))return 'reuse';
 const variants=candidate.assemblyVariants||[];
 if(variants.some(v=>v.id===requested)&&variants.some(v=>v.id===choice.prefabId))return 'replace-variant';
 return 'integration-required';
}
export const canSelectSystemCandidate=candidate=>!['missing','internal-consumed'].includes(candidate?.availability)&&candidate?.compatibility?.selectable!==false&&!candidate?.compatibility?.adapterId;
