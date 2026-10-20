// A late prefab response must not overwrite a newer role choice or a plan edit.
export function createSelectionRequests(){
 let epoch=0;const generations=new Map(),key=(plan,role)=>`${plan}:${role}`;
 return {begin(plan,role){const id=key(plan,role),generation=(generations.get(id)||0)+1;generations.set(id,generation);return {id,generation,epoch};},isCurrent(token){return token.epoch===epoch&&generations.get(token.id)===token.generation;},invalidateRole(plan,role){const id=key(plan,role);generations.set(id,(generations.get(id)||0)+1);},invalidateAll(){epoch++;generations.clear();}};
}
