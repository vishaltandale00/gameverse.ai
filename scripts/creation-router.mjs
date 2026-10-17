import {creationOperations,operationForSources,creationIntentText} from './creation-operations.mjs';
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
  const operation=operationForSources(sources);
  if(operation)return {...common,backend:operation.backend,operation:operation.id,roles:{host:operation.host,donor:operation.donor,transfer:operation.roles}};
  return {...common,backend:null,reason:sources.length?'source_backend_not_integrated':'source_identity_required',gaps:[sources.length?`No installed creation backend covers the requested source set: ${sources.join(', ')}. Source availability and compiler integration are separate capabilities.`:'Name the base game and donor game so the correct source compiler can be selected.']};
}
export function createCreationRouter({sonic,pokemon,catalog}={}) {
  if(!sonic||!pokemon)throw Error('creation_backends_required');
  const backends={'sonic-metroid':sonic,'pokemon-overworld':pokemon,'pokemon-character':pokemon};
  async function capabilities(){
    const [s,p,c]=await Promise.all([sonic.capabilities(),pokemon.capabilities(),pokemon.capabilities('sonic-player')]);
    return {schema:'gameverse.creation-router-capabilities/1',available:s.available||p.available||c.available,source_games:[...new Set([...(s.source_games||[]),...(p.source_games||[])])],operations:creationOperations,backends:[{id:'sonic-metroid',...s,required_inputs:creationOperations.find(o=>o.id==='sonic-metroid').required_inputs},{id:'pokemon-overworld',...p},{id:'pokemon-character',...c,source_games:['pokemon-leafgreen','sonic-advance']}],limits:s.limits,scope:'Requests select a source-specific compiler. Installed decompositions are advertised separately from qualified creation capabilities.',presets:[{title:'LeafGreen with Emerald overworld sprites',intent:'Build Pokemon Leaf Green but with Pokemon Emerald overworld sprites',source_games:['pokemon-leafgreen','pokemon-emerald'],description:p.scope||'LeafGreen base with compatible Emerald overworld graphics.'},{title:'Sonic × Metroid',intent:'Combine Sonic Advance momentum with Metroid Zero Mission combat and ability gates.',source_games:['sonic-advance','metroid-zero-mission'],description:s.scope}]};
  }
  async function dispatch(args,continuation=false){
    const routing=resolveCreationRoute(args);
    await args.onEvent?.({stage:'planning',type:'routing',routing,message:routing.backend?`Selected ${routing.backend} compiler for ${routing.source_games.join(' + ')}`:routing.gaps.join(' ')});
    if(!routing.backend){const discovery=catalog?await catalog.context({q:args.intent,limit:16}):null;return {status:'blocked',reason:routing.reason,gaps:routing.gaps,routing,discovery,implementation_gap:{kind:'host-adapter-required',source_games:routing.source_games,next_steps:['Inspect the discovered source systems, typed ports, prefab dependencies and source ownership before selecting a host transformation.','Implement and qualify explicit host/donor bindings; available source evidence alone does not establish native compatibility.']},qualification:{outcome:'unavailable'}};}
    const backend=backends[routing.backend];
    if(continuation&&typeof backend.resume!=='function')return {status:'blocked',reason:'resume_unavailable',routing,qualification:{outcome:'unavailable'}};
    const result=await backend[continuation?'resume':'run']({...args,source_games:routing.source_games,operation:routing.operation});
    return {...result,routing};
  }
  return {capabilities,run:args=>dispatch(args),resume:args=>dispatch(args,true)};
}
