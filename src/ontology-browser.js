import { preserveView } from './view-state.js';
import { ontologyEntries, filterOntology, normalizeAnnotation } from './ontology-browser-model.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pretty = value => String(value ?? '').replaceAll('_',' ').replaceAll('-',' ');
const values = value => Array.isArray(value) ? value : [];
const storageKey = 'gameverse-ontology-annotations-v1';
const fields = [['summary','Behavior'],['inputs','Inputs / reads'],['outputs','Outputs / writes'],['ports','Typed ports'],['collection_ports','Collection ports'],['state','State and ownership'],['state_owners','State owners'],['parameters','Parameters and domains'],['builderEligibility','Binding eligibility'],['events','Events'],['callOrder','Original call order / phase constraints'],['units','Units and frames'],['dependencies','Dependencies'],['serviceEffects','Service effects'],['preconditions','Preconditions'],['lifecycle','Lifecycle and clock'],['qualification','Finite qualification'],['qualificationEvidence','Qualification evidence'],['graph','Dependency graph and edge support'],['source_contract','Recovered component source contract'],['sourceEvidence','Original source identity and pins'],['provenance','Evidence packet provenance'],['coverage','Coverage, gaps and unknowns']];
const compactEvidence = value => {
 if(Array.isArray(value))return value.map(compactEvidence);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='traceback'?'Detailed diagnostic retained in complete source record.':compactEvidence(item)]));
 return typeof value==='string'&&value.length>1600?value.slice(0,1600)+'… [full value in complete source record]':value;
};
const detail = (value,compact=true) => `${Array.isArray(value)&&!value.length?'<p class="ontology-unknown">No entries recorded. This does not establish absence; review coverage and unknowns.</p>':''}<pre>${esc(typeof value === 'string' ? value : JSON.stringify(compact?compactEvidence(value):value,null,2))}</pre>`;
export async function createOntologyBrowser({ element, catalog, onSelectSource }) {
 let entries=ontologyEntries(catalog), filters={}, active='', annotations={}, storageAvailable=true;
 try{const stored=JSON.parse(localStorage.getItem(storageKey)||'{}');if(stored&&typeof stored==='object'&&!Array.isArray(stored))annotations=stored;}catch{storageAvailable=false;}
 element.innerHTML=`<section class="ontology-browser" aria-label="Source mechanics and systems"><div class="ontology-toolbar"><label>Search behavior, evidence or tags<input type="search" data-search placeholder="Try movement, lifecycle, collision…"></label><label>Source game<select data-filter="game"></select></label><label>Level<select data-filter="level"><option value="">L1 + L2</option><option>L1</option><option>L2</option></select></label><label>Capability<select data-filter="capability"></select></label><label>Readiness<select data-filter="readiness"></select></label><label class="ontology-tagged"><input type="checkbox" data-tagged> Tagged only</label></div><div class="ontology-actions"><p data-count role="status"></p></div><div class="ontology-layout"><div data-list class="ontology-list" aria-label="Matching ontology records"></div><article data-detail class="ontology-detail" aria-live="polite"></article></div><p data-message role="status">Inspect source evidence and record your research tags and notes locally.</p></section>`;
 const $=s=>element.querySelector(s);
 function options(){
  for(const key of ['game','capability','readiness']){
   const vals=[...new Set(entries.flatMap(e=>key==='game'?[e.gameId]:key==='capability'?values(e.capabilities):[e.readiness]).filter(Boolean))].sort();
   if(key==='game')for(const game of values(catalog.games))if(!vals.includes(game.id))vals.push(game.id);
   $(`[data-filter="${key}"]`).innerHTML='<option value="">All '+({game:'source games',capability:'capabilities',readiness:'readiness states'})[key]+'</option>'+vals.map(v=>`<option value="${esc(v)}">${esc(key==='game'?(catalog.games.find(g=>g.id===v)?.shortName||v):pretty(v))}</option>`).join('');
   $(`[data-filter="${key}"]`).value=filters[key]||'';
  }
 }
 function render(){return preserveView(element,()=>{
  const matches=filterOntology(entries,filters,annotations);if(!matches.some(e=>e.key===active))active=matches[0]?.key||'';
  $('[data-count]').textContent=`${matches.length} records · ${matches.filter(e=>e.recordKind==='source-system-contract').length} source system contracts`;
  $('[data-list]').innerHTML=matches.length?matches.map(e=>`<div class="ontology-row ${e.key===active?'active':''}"><button data-open="${esc(e.key)}" aria-pressed="${e.key===active}"><small>${esc(e.level)}${e.recordKind==='prior-source-analysis'?' candidate analysis':''} · ${esc(catalog.games.find(g=>g.id===e.gameId)?.shortName||e.gameId)}</small><strong>${esc(e.name)}</strong><span>${esc(pretty(e.readiness))}</span>${values(annotations[e.key]?.tags).length?`<span class="ontology-tags">${esc(annotations[e.key].tags.join(' · '))}</span>`:''}</button></div>`).join(''):'<p class="empty-note">No matching records. This source or capability may still need extraction; clear a filter to explore available evidence.</p>';
  for(const button of element.querySelectorAll('[data-open]'))button.onclick=()=>{active=button.dataset.open;render();};
  renderDetail();
 });}
 function renderDetail(){
  const entry=entries.find(e=>e.key===active);if(!entry){$('[data-detail]').innerHTML='<h3>No record to inspect</h3><p>Choose another source game or clear a filter. Missing records do not establish missing behavior in the original game.</p>';return;}
  const annotation=annotations[entry.key]||{};
  $('[data-detail]').innerHTML=`<p class="eyebrow">${esc(entry.level)} / ${esc(pretty(entry.readiness))}</p><h3>${esc(entry.name)}</h3><code>${esc(entry.id)}</code>${onSelectSource?'<p><button data-use-source>Use this source world in Mashup ↗</button></p>':''}<p class="ontology-status">${entry.level==='L2'?(entry.recordKind==='prior-source-analysis'?'Prior static source analysis for an L2 candidate. This is not a newly recovered coherent system contract.':'Static source-derived system contract. Original sequencing and missing dependencies must be reviewed before assembly.'):entry.readiness==='finite-qualified-subset'?'Finite original/native qualification is recorded below. It establishes only that bounded subset.':'Static source mechanic record. Executable behavior has not been established by this record.'} No runnable probe is exposed for this record.</p>${fields.map(([key,label])=>`<details ${['summary','inputs','outputs','callOrder','coverage'].includes(key)?'open':''}><summary>${label}</summary>${entry[key]!=null?detail(entry[key]):'<p class="ontology-unknown">Not recorded in this source contract. This is an open evidence gap.</p>'}</details>`).join('')}<details><summary>Complete source record</summary>${detail(entry,false)}</details><section class="ontology-annotation"><h4>Your research tags & notes</h4><label>Tags, separated by commas<input data-tags maxlength="1200" value="${esc(values(annotation.tags).join(', '))}" placeholder="reuse candidate, needs clock review"></label><label>Notes<textarea data-notes rows="4" maxlength="4000" placeholder="What makes this useful? What must be resolved?">${esc(annotation.notes||'')}</textarea></label><button data-save>Save locally</button><p data-save-status role="status"></p></section>`;
  if(onSelectSource)$('[data-use-source]').onclick=()=>onSelectSource(entry.gameId);
  $('[data-save]').onclick=()=>{annotations[entry.key]=normalizeAnnotation($('[data-tags]').value,$('[data-notes]').value);try{localStorage.setItem(storageKey,JSON.stringify(annotations));storageAvailable=true;}catch{storageAvailable=false;}render();$('[data-save-status]')?.append(document.createTextNode(storageAvailable?'Saved in this browser.':'Browser storage unavailable; annotations stay in this tab.'));};
 }
 $('[data-search]').oninput=e=>{filters.query=e.target.value;render();};
 for(const select of element.querySelectorAll('[data-filter]'))select.onchange=()=>{filters[select.dataset.filter]=select.value;render();};
 $('[data-tagged]').onchange=e=>{filters.taggedOnly=e.target.checked;render();};
 options();render();
 if(!storageAvailable)$('[data-message]').textContent='Browser storage unavailable. Research annotations remain in this tab.';
 return {setGame(game){filters.game=game;options();render();element.scrollIntoView({block:'start'});},updateCatalog(next){catalog=next;entries=ontologyEntries(catalog);options();render();}};
}
