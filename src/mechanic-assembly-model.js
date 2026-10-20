export const ASSEMBLY_SCHEMA='gameverse.mechanic-assembly/0.1';
const clone=value=>structuredClone(value);
export function emptyAssembly(){return {schema:ASSEMBLY_SCHEMA,components:{},state:{},invocations:[],initialize:{},services:[]};}
export function addMechanic(graph,record){
 const next=clone(graph);let i=1;while(next.components[`m${i}`])i++;const id=`m${i}`;
 next.components[id]={package_id:record.id,behavior_sha256:record.behavior_sha256,...(record.package_sha256?{package_sha256:record.package_sha256}:{}),bindings:{},collection_bindings:{}};
 next.invocations.push({component:id,arguments:Object.fromEntries((record.parameters||[]).map(p=>[p.name,{op:'const',type:p.storage_type,value:0}]))});
 return {graph:next,instance:id};
}
export function portState(port,owner){return {storage_type:port.storage_type,semantic_type:clone(port.semantic_type||{quantity:'unknown',unit:{numerator:1,denominator:1},frame:'unknown'}),owner,shared:false,...(port.count!=null?{count:port.count}:{})};}
export function ownMechanicState(graph,instance,record){
 const next=clone(graph),component=next.components[instance];next.initialize||={};if(!component)throw Error('Unknown mechanic instance.');
 for(const [ports,key]of [[record.ports||[],'bindings'],[record.collection_ports||[],'collection_bindings']])for(const port of ports){
  if(component[key]?.[port.id])continue;
  let slot=`${instance}_${port.id}`,suffix=1;while(next.state[slot])slot=`${instance}_${port.id}_${suffix++}`;
  next.state[slot]=portState(port,instance);next.initialize[slot]=port.count!=null?Array(port.count).fill(0):0;
  component[key]||={};component[key][port.id]=key==='bindings'?{slot}:slot;
 }
 return next;
}
export function connectMechanics(graph,{source,output,target,input},records){
 const next=clone(graph),a=next.components[source],b=next.components[target];next.initialize||={};if(!a||!b)throw Error('Choose two mechanic instances.');a.bindings||={};b.bindings||={};
 const sourceRecord=records.find(r=>r.id===a.package_id),targetRecord=records.find(r=>r.id===b.package_id);
 const out=sourceRecord?.ports?.find(p=>p.id===output&&['out','inout'].includes(p.direction));
 const incoming=targetRecord?.ports?.find(p=>p.id===input&&['in','inout'].includes(p.direction));
 if(!out||!incoming)throw Error('Choose a declared output and input port.');
 let slot=a.bindings[output]?.slot;if(!slot){slot=`${source}_${output}`;let n=1;while(next.state[slot])slot=`${source}_${output}_${n++}`;next.state[slot]=portState(out,source);next.initialize[slot]=0;a.bindings[output]={slot};}
 if(!next.state[slot])throw Error('The output binding refers to missing state.');
 next.state[slot].shared=true;b.bindings[input]={...(b.bindings[input]||{}),slot};return next;
}
export function reorderMechanic(graph,index,delta){const next=clone(graph),target=index+delta;if(target<0||target>=next.invocations.length)return next;[next.invocations[index],next.invocations[target]]=[next.invocations[target],next.invocations[index]];return next;}
export function parseAssembly(text){
 const graph=JSON.parse(text),object=value=>value&&typeof value==='object'&&!Array.isArray(value);
 if(graph.schema!==ASSEMBLY_SCHEMA||!object(graph.components)||!object(graph.state)||!Array.isArray(graph.invocations))throw Error('Use a versioned mechanic assembly with components, state and invocations.');
 if(Object.values(graph.components).some(c=>!object(c)||typeof c.package_id!=='string')||Object.values(graph.state).some(s=>!object(s)))throw Error('Components and state slots must contain named objects.');
 if(graph.adapters!==undefined&&(!object(graph.adapters)||Object.entries(graph.adapters).some(([name,adapter])=>!name.trim()||!object(adapter))))throw Error('Adapters must be named objects.');
 for(const invocation of graph.invocations){
  if(!object(invocation))throw Error('Invocations must contain exactly one component or adapter name.');
  const component=Object.hasOwn(invocation,'component'),adapter=Object.hasOwn(invocation,'adapter');
  if(component===adapter||typeof invocation[component?'component':'adapter']!=='string'||!invocation[component?'component':'adapter'].trim())throw Error('Invocations must contain exactly one component or adapter name.');
  if(adapter&&!Object.hasOwn(graph.adapters||{},invocation.adapter))throw Error('Adapter invocation refers to an unknown named adapter.');
 }
 for(const c of Object.values(graph.components))if(c.bindings&&(!object(c.bindings)||Object.values(c.bindings).some(b=>!object(b))))throw Error('Field bindings must be objects containing a slot name.');
 return graph;
}
