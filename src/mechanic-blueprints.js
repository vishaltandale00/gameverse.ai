const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const blueprintPatterns=catalog=>Array.isArray(catalog.assemblyPatterns)?catalog.assemblyPatterns:catalog.assemblyPatterns?.patterns||[];
const semantic=s=>JSON.stringify([s?.quantity,s?.frame,s?.unit?.numerator,s?.unit?.denominator,s?.signed_encoding||null]);
export function blueprintCandidate(record,role,anchor){
 if(!role.package_id)return {status:'unavailable',reason:'This role is source-only. No published mechanic can fill it yet.'};
 if(record.id===role.package_id)return {status:'recorded',reason:'Recorded source implementation for this role. Its evidenced state, parameters and order are available; fresh validation is required.'};
 if(!anchor||record.role!==anchor.role)return {status:'blocked',reason:'This mechanic declares a different capability from the selected role.'};
 const required=anchor.ports||[],collections=anchor.collection_ports||[];
 if(!required.length&&!collections.length)return {status:'blocked',reason:'This role has private source state without a transferable public port contract. Substitution needs a source-specific mapping.'};
 const missing=required.filter(p=>!record.ports?.some(q=>q.id===p.id&&q.direction===p.direction));
 if(missing.length)return {status:'blocked',reason:`Missing required named ports: ${missing.map(p=>p.id).join(', ')}. No mapping is evidenced.`};
 for(const p of required){const q=record.ports.find(q=>q.id===p.id&&q.direction===p.direction);if(semantic(q.semantic_type)!==semantic(p.semantic_type)||q.storage_type!==p.storage_type){if(q.semantic_type?.quantity===p.semantic_type?.quantity&&q.semantic_type?.frame===p.semantic_type?.frame)return {status:'adapter-required',reason:`${p.id} has the expected quantity/frame but different storage, units or encoding. An evidenced conversion and domain mapping are required.`};return {status:'blocked',reason:`${p.id} differs in semantic quantity or coordinate frame. It cannot fill this role without an evidenced mapping.`};}}
 if(collections.some(p=>!record.collection_ports?.some(q=>q.id===p.id&&q.storage_type===p.storage_type&&q.count===p.count&&semantic(q.semantic_type)===semantic(p.semantic_type))))return {status:'blocked',reason:'Required collection shape or units differ. Opaque storage cannot be automatically shared.'};
 return {status:'candidate',reason:'Declared named ports and collection shapes match. Domain, ownership, private state, services and invocation order still need review and Composer validation.'};
}
export function applyRecordedBlueprint(graph,pattern,slots){
 if(!pattern.graph)throw Error('This source pattern has no recorded binding graph. Complete source recovery and map state explicitly.');
 for(const role of pattern.roles){const required=pattern.blueprint?.slots?.find(s=>s.id===role.id)?.required??role.required??true;if(!required&&!slots[role.id])continue;if(!slots[role.id]||graph.components[slots[role.id]]?.package_id!==role.package_id)throw Error('Recorded wiring requires the recorded implementation in every role. Alternative pieces require explicit state and port mapping.');}
 const next=structuredClone(graph),stateMap={};next.initialize||={};let prefix=pattern.id.replace(/[^a-z0-9_]/gi,'_');while(Object.keys(pattern.graph.state).some(name=>next.state[`${prefix}_${name}`]))prefix+='_';
 const used=new Set(Object.entries(pattern.graph.components).filter(([role])=>slots[role]).flatMap(([,c])=>[...Object.values(c.bindings||{}).map(b=>b.slot),...Object.values(c.collection_bindings||{}).map(b=>typeof b==='string'?b:b.slot)]));
 for(const name of used)stateMap[name]=`${prefix}_${name}`;
 for(const [name,state]of Object.entries(pattern.graph.state)){if(!used.has(name))continue;if(pattern.roles.some(r=>r.id===state.owner)&&!slots[state.owner])throw Error('A remaining state slot needs the omitted role owner. Add that role or map ownership explicitly.');next.state[stateMap[name]]={...structuredClone(state),owner:slots[state.owner]||state.owner};next.initialize[stateMap[name]]=structuredClone(pattern.graph.initialize?.[name]??0);}
 for(const [role,c]of Object.entries(pattern.graph.components)){if(!slots[role])continue;const component=structuredClone(c);for(const b of Object.values(component.bindings||{}))b.slot=stateMap[b.slot]||b.slot;for(const [port,b]of Object.entries(component.collection_bindings||{}))component.collection_bindings[port]=typeof b==='string'?(stateMap[b]||b):{...b,slot:stateMap[b.slot]||b.slot};next.components[slots[role]]=component;}
 const members=new Set(Object.values(slots));next.invocations=next.invocations.filter(i=>!members.has(i.component));next.invocations.push(...pattern.graph.invocations.filter(i=>slots[i.component]).map(i=>({...structuredClone(i),component:slots[i.component]})));
 return next;
}
