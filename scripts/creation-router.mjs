import {discoverSourceIdentities} from './catalog-source-identities.mjs';
import {creationOperations,operationForSources,operationsForSources,creationIntentText} from './creation-operations.mjs';
// Route by requested game identity before capturing any compiler workspace.
const definitions = [
  ['pokemon-leafgreen', /\b(?:pok[eé]mon\s+)?leaf\s*green\b/i],
  ['pokemon-emerald', /\b(?:pok[eé]mon\s+)?emerald\b/i],
  ['pokemon-firered', /\b(?:pok[eé]mon\s+)?fire\s*red\b/i],
  ['pokemon-ruby', /\b(?:pok[eé]mon\s+)?ruby\b/i],
  ['pokemon-sapphire', /\b(?:pok[eé]mon\s+)?sapphire\b/i],
  ['sonic-advance', /\bsonic(?:\s+advance)?\b/i],
  ['metroid-zero-mission', /\b(?:metroid(?:\s+zero\s+mission)?|mzm)\b/i],
];
const aliases = new Map([['pokemon-leaf-green','pokemon-leafgreen'],['pokemon-fire-red','pokemon-firered']]);
const normalize = id => aliases.get(id) || id;
const same = (a,b) => a.length===b.length && a.every(id=>b.includes(id));
export function resolveCreationRoute({intent='',source_games=[],parent,prior}={}) {
  intent=creationIntentText(intent);
  const explicit=[...new Set(source_games.map(normalize))];
  const mentioned=definitions.filter(([,pattern])=>pattern.test(intent)).map(([id])=>id);
  // Text may narrow an explicit selection but cannot silently add an unrelated game.
  if(explicit.length && mentioned.some(id=>!explicit.includes(id)))return {backend:null,source_games:mentioned,requested_source_games:explicit,reason:'source_selection_conflict',gaps:['The game names in the request conflict with the selected source games. No substitute compiler was launched.']};
  if(!explicit.length&&mentioned.includes('sonic-advance')&&/\bpok[eé]mon\b/i.test(intent)&&!mentioned.some(id=>id.startsWith('pokemon-')))mentioned.push('pokemon-leafgreen');
  const inherited=prior?.routing?.source_games || parent?.pipeline_result?.routing?.source_games || parent?.pipeline_result?.provenance?.source_games || [];
  const sources=explicit.length?explicit:mentioned.length?mentioned:inherited;
  const common={source_games:sources,requested_source_games:explicit,inferred_from:explicit.length?'selection':mentioned.length?'request':inherited.length?'parent':'unresolved'};
  const candidates=operationsForSources(sources);
  const pinned=prior?.routing?.operation;
  const operation=operationForSources(sources,pinned);
  if(!operation&&candidates.length>1)return {...common,backend:null,reason:'source_roles_require_planning',candidate_operations:candidates.map(o=>({id:o.id,host:o.host,donor:o.donor,roles:o.roles,scope:o.scope})),gaps:['These games support different host and donor roles. The construction agent must plan the requested transformation before selecting a native adapter.']};
  if(operation)return {...common,backend:operation.backend,operation:operation.id,roles:{host:operation.host,donor:operation.donor,transfer:operation.roles}};
  return {...common,backend:null,reason:sources.length?'source_backend_not_integrated':'source_identity_required',gaps:[sources.length?`No installed creation backend covers the requested source set: ${sources.join(', ')}. Source availability and compiler integration are separate capabilities.`:'Name the base game and donor game so the correct source compiler can be selected.']};
}
export function createCreationRouter({sonic,pokemon,sonicPokemon,agentSource,catalog}={}) {
  if(!sonic||!pokemon)throw Error('creation_backends_required');
  const backends={'sonic-metroid':sonic,'pokemon-overworld':pokemon,'pokemon-character':pokemon,...(sonicPokemon?{'sonic-pokemon-enemies':sonicPokemon}:{})};
  async function capabilities(){
    const [s,p,c,e,a]=await Promise.all([sonic.capabilities(),pokemon.capabilities(),pokemon.capabilities('sonic-player'),sonicPokemon?.capabilities(),agentSource?.capabilities?.()]);
    return {schema:'gameverse.creation-router-capabilities/1',available:s.available||p.available||c.available||e?.available||a?.available,source_games:[...new Set([...(s.source_games||[]),...(p.source_games||[])])],operations:creationOperations,backends:[{id:'sonic-metroid',...s,required_inputs:creationOperations.find(o=>o.id==='sonic-metroid').required_inputs},{id:'pokemon-overworld',...p},{id:'pokemon-character',...c,source_games:['pokemon-leafgreen','sonic-advance']},...(e?[{id:'sonic-pokemon-enemies',...e}]:[]),...(a?[{id:'agent-source',...a}]:[])],limits:s.limits,scope:'Requests select a source-specific compiler. Installed decompositions are advertised separately from qualified creation capabilities.',presets:[{title:'LeafGreen with Emerald overworld sprites',intent:'Build Pokemon Leaf Green but with Pokemon Emerald overworld sprites',source_games:['pokemon-leafgreen','pokemon-emerald'],description:p.scope||'LeafGreen base with compatible Emerald overworld graphics.'},{title:'Sonic × Metroid',intent:'Combine Sonic Advance momentum with Metroid Zero Mission combat and ability gates.',source_games:['sonic-advance','metroid-zero-mission'],description:s.scope}]};
  }
  async function dispatchAgent(args,routing,continuation=false){
    const result=await agentSource[continuation?'resume':'run']({...args,source_games:routing.source_games,request_plan:{...routing,adapter_submission:{schema:'gameverse.source-role-recipe/1',operation:'one candidate operation id',host:'exact host id',donor:'exact donor id',roles:['one declared transfer role'],applies_to_requirements:['matching requirement ids'],parameters:{mapping_policy:'native-family-to-pokemon-icon for pokemon-enemies',palette_policy:'adapt-to-host for pokemon-enemies'}}}});
    const roles=result.qualification?.source_roles||{host:result.request_plan?.host,donors:result.request_plan?.donors,transfer:result.request_plan?.render_roles};
    const finalRouting={source_games:routing.source_games,requested_source_games:routing.requested_source_games||[],inferred_from:routing.inferred_from,backend:'agent-source',operation:result.evidence?.attempt?.recipe?.operation||null,roles};
    return {...result,routing:finalRouting};
  }
  async function dispatch(args,continuation=false){
    let routing=resolveCreationRoute(args);
    if(catalog&&!continuation){
      const identities=discoverSourceIdentities(creationIntentText(args.intent),(await catalog.summary()).games||[]);
      if(args.source_games?.length){
        routing=resolveCreationRoute({...args,intent:''});
        if(identities.resolved.some(id=>!args.source_games.map(normalize).includes(id)))routing={...routing,backend:null,reason:'source_selection_conflict',gaps:['The named catalog sources conflict with the selected games. Keep the intended sources selected before attempting a transformation.']};
      }else if(identities.source_candidates.length){
        routing=identities.ambiguous?{backend:null,source_games:[],requested_source_games:[],inferred_from:'catalog-candidates',reason:'source_roles_require_planning',source_candidates:identities.source_candidates,required_source_games:identities.resolved,gaps:['The request names a source family. Codex must inspect the catalog candidates and state which locally available game it selects and why before adapting it.']}: {...resolveCreationRoute({...args,source_games:identities.resolved}),requested_source_games:[],inferred_from:'catalog-name'};
      }
    }
    await args.onEvent?.({stage:'planning',type:'routing',routing,message:routing.backend?`Selected ${routing.backend} compiler for ${routing.source_games.join(' + ')}`:routing.gaps.join(' ')});
    if(agentSource&&!continuation&&routing.reason!=='source_selection_conflict')return dispatchAgent(args,routing);
    if(continuation&&agentSource?.canResume&&await agentSource.canResume(args.prior))return dispatchAgent(args,routing,true);
    if(!routing.backend){const discovery=catalog?await catalog.context({q:args.intent,limit:16}):null;return {status:'blocked',reason:routing.reason,gaps:routing.gaps,routing,discovery,implementation_gap:{kind:'host-adapter-required',source_games:routing.source_games,next_steps:['Inspect the discovered source systems, typed ports, prefab dependencies and source ownership before selecting a host transformation.','Implement and qualify explicit host/donor bindings; available source evidence alone does not establish native compatibility.']},qualification:{outcome:'unavailable'}};}
    const backend=backends[routing.backend];
    if(continuation&&typeof backend.resume!=='function')return {status:'blocked',reason:'resume_unavailable',routing,qualification:{outcome:'unavailable'}};
    const result=await backend[continuation?'resume':'run']({...args,source_games:routing.source_games,operation:routing.operation});
    if(result?.status==='blocked'&&agentSource&&!continuation&&['unsupported_pokemon_operation','pokemon_parent_refinement_unqualified','request_exceeds_supported_systems'].includes(result.reason))return agentSource.run({...args,source_games:routing.source_games,request_plan:{...routing,previous_attempt:{reason:result.reason,gaps:result.gaps||[]}}});
    return {...result,routing};
  }
  return {capabilities,run:args=>dispatch(args),resume:args=>dispatch(args,true),canResume:prior=>agentSource?.canResume?.(prior)||false};
}
