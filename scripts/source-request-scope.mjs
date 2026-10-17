// This checks explicit source-role statements at the native proof boundary.
// It is not the free-text planner: every request has already reached Codex.
const names={
 'sonic-advance':/\bsonic(?:\s+advance)?\b/i,
 'pokemon-leafgreen':/\b(?:pok[eé]mon|leaf\s*green)\b/i,
 'pokemon-emerald':/\bemerald\b/i,
};
export const verbatimIntentClauses=intent=>String(intent).split(/\r?\n/).map(text=>text.trim()).filter(Boolean);
export function assessRenderSourceScope(intent,{host,donor,role}){
 const clauses=verbatimIntentClauses(intent),matches=[];
 for(const text of clauses){
  if(/\b(?:no|not|never|without)\b|\bdon['’]?t\b/i.test(text))continue; // Exclusions need stronger semantic proof; never publish their opposite.
  const hostMatch=names[host]?.exec(text),donorMatch=names[donor]?.exec(text);if(!hostMatch||!donorMatch)continue;
  const forward=hostMatch.index<donorMatch.index;
  const inHost=new RegExp('\\b(?:in|inside|within)\\s+(?:the\\s+)?'+(host==='sonic-advance'?'sonic(?:\\s+advance)?':'(?:pok[eé]mon|leaf\\s*green)')+'\\b','i').test(text);
  const enemy=/\b(?:enemy|enemies|badniks|opponents)\b/i.test(text);
  const character=/\b(?:as|character|player|sprite|look)\b/i.test(text);
  const sprites=/\boverworld\s+(?:object\s+)?sprites?\b/i.test(text);
  const valid=role==='enemy-render'?enemy&&(forward||inHost):role==='player-overworld'?!enemy&&character&&(forward||inHost):role==='overworld-objects'?sprites&&forward:false;
  if(valid)matches.push(text);
 }
 return {verified:matches.length>0,core_clauses:matches,unverified_clauses:clauses.filter(text=>!matches.includes(text)),scope:'Explicit host/donor/render-role contribution only. Other clauses are not proved by graphics consumers.'};
}
