import { componentKey, createAttempt, filterGames, resolveSelection } from './workshop-model.js';
const $ = selector => document.querySelector(selector);
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors = ['#dc7248','#6b8874','#8e80a3','#cc9a3d','#608ca2','#bf7f8f','#8e9364','#797b80'];
let catalog, byId, focused = 'metroid-zero-mission', axis = 'text:mechanics', selected = new Set(['metroid-zero-mission','pokemon-emerald-version']);
let picks = new Set(), adaptations = {}, evidenceOnly = false, query = '', showAll = false;
let lastSerialized = '', selectedFacet = 'all';
const msg = text => { $('#workshop-status').textContent = text; };
const pretty = value => value.replace(/_/g,' ').replace(/^text:/,'');
const short = (text, n=25) => text.length > n ? `${text.slice(0,n-1)}…` : text;
function tint(id) { return colors[(catalog.games.findIndex(g=>g.id===id)) % colors.length]; }
function go(id) {
  focused = id; selectedFacet = 'all';
  renderMap(); renderInspector();
}
function toggle(id) {
  selected.has(id) ? selected.delete(id) : selected.add(id);
  for (const key of [...picks]) if (!selected.has(key.split(':')[0])) picks.delete(key);
  renderCatalog(); renderInspector(); renderDraft(); renderMap();
}
function renderMap() {
  const previousFocus = document.activeElement?.closest('.map-node')?.dataset.game;
  const view = catalog.views[axis], ids = catalog.games.map(g=>g.id), xs=ids.map(id=>view.xy[id][0]), ys=ids.map(id=>view.xy[id][1]);
  const loX=Math.min(...xs), hiX=Math.max(...xs), loY=Math.min(...ys), hiY=Math.max(...ys);
  const pos = Object.fromEntries(ids.map(id=>[id,[68+(view.xy[id][0]-loX)/(hiX-loX||1)*600,65+(hiY-view.xy[id][1])/(hiY-loY||1)*365]]));
  const near = view.neighbors[focused]?.near || [], important = new Set([focused,...near.map(n=>n.id)]);
  const svg=$('#space-map');
  const links = near.map(n=>`<line x1="${pos[focused][0]}" y1="${pos[focused][1]}" x2="${pos[n.id][0]}" y2="${pos[n.id][1]}" class="map-link"/>`).join('');
  svg.innerHTML = `<defs><pattern id="dot-grid" width="23" height="23" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#d8d6cc"/></pattern></defs><rect width="760" height="500" fill="url(#dot-grid)"/><ellipse cx="375" cy="250" rx="285" ry="176" class="map-orbit"/><ellipse cx="375" cy="250" rx="184" ry="116" class="map-orbit"/>${links}${ids.map(id=>{
    const [x,y]=pos[id], g=byId[id], active=id===focused, isLow=Object.hasOwn(view.lowCoverage,id);
    return `<g data-game="${id}" class="map-node ${active?'active':''} ${selected.has(id)?'picked':''} ${isLow?'low':''}" transform="translate(${x},${y})" tabindex="0" role="button" aria-label="Inspect ${esc(g.name)}"><title>${esc(g.name)}${isLow?' · limited capture coverage':''}</title><circle class="node-hit" r="14" fill="transparent"/><circle class="node-halo" r="${active?18:12}" fill="${tint(id)}"/><circle class="node-core" r="${active?7:4.5}" fill="${tint(id)}"/><text x="${x>580?-12:12}" y="${active?-15:4}" text-anchor="${x>580?'end':'start'}" class="${id===focused?'show-label':''}">${esc(short(g.shortName,active?30:22))}</text></g>`;
  }).join('')}<text x="22" y="474" class="map-axis-note">2D PROJECTION · ${esc(pretty(axis).toUpperCase())}</text><text x="738" y="474" text-anchor="end" class="map-axis-note">33 WORLDS / MANY DIMENSIONS</text>`;
  [...svg.querySelectorAll('.map-node')].forEach((node,i)=>{
    node.onclick=()=>go(ids[i]); node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go(ids[i]);}};
  });
  if (previousFocus) svg.querySelector(`[data-game="${previousFocus}"]`)?.focus({preventScroll:true});
  const basisLabels={model_recall:'MODEL RECALL · EXPLORATORY',model_classification:'MODEL CLASSIFICATION · CAPTURE EVIDENCE',capture_embedding:'CAPTURE EMBEDDINGS',capture_telemetry:'HARDWARE TELEMETRY'};
  $('#map-basis').textContent = basisLabels[view.basis] || 'BASIS UNKNOWN';
  const explanations={model_recall:'This axis uses descriptions recalled by a local model. Similarity suggests ideas to investigate; it does not establish shared mechanics or a working combination.',model_classification:'A vision model classified captured screens. These are model-derived scene distributions over limited footage, not verified game mechanics or compatibility.',capture_embedding:'This axis embeds captured images or audio. It describes similarity in limited scenes or sounds; proximity is not a shared mechanic or compatibility score.',capture_telemetry:'This axis compares observed rendering hardware activity from captured sessions. It describes observed implementation patterns, not complete game behavior or compatibility.'};
  $('#map-explanation').textContent = explanations[view.basis] || 'See source provenance before interpreting this axis.';
  $('#axis-source').textContent = `${view.provenance} · mean-centered normalized distance, except standardized rendering telemetry. Lines show original-space neighbors; a 2D layout can distort distance. Cached model revision unavailable.`;
  renderNeighbors();
}
function renderNeighbors() {
  const view = catalog.views[axis];
  for (const kind of ['near','far']) $('#neighbors-'+kind).innerHTML = (view.neighbors[focused]?.[kind] || []).map(n=>`<button type="button" class="neighbor" data-id="${n.id}"><span>${esc(byId[n.id].shortName)}</span><span class="mono">${n.distance.toFixed(2)} <span aria-hidden="true">↗</span></span></button>`).join('');
  for (const button of document.querySelectorAll('.neighbor')) button.onclick=()=>go(button.dataset.id);
}
function renderInspector() {
  const game=byId[focused];
  const list=$('#component-list'), sameGame=list.dataset.game===game.id;
  const openComponents=new Set(sameGame?[...list.querySelectorAll('details[open]')].map(el=>el.dataset.componentId):[]);
  const previousComponentFocus=sameGame&&list.contains(document.activeElement)?document.activeElement.dataset.component:null;
  list.dataset.game=game.id;
  const facets=[...new Set(game.components.map(c=>c.facet))];
  $('#inspect-name').textContent=game.shortName; $('#inspect-code').textContent=game.gameCode;
  $('#inspect-summary').textContent=game.components.length ? `${game.components.length} component records · ${facets.length} dimensions · extraction in progress` : 'ROM indexed · component extraction in progress';
  $('#inspect-add').textContent=selected.has(game.id)?'Remove from mix −':'Add to mix +';
  $('#inspect-add').onclick=()=>toggle(game.id);
  $('#facet-filter').innerHTML = '<option value="all">All dimensions</option>'+facets.map(f=>`<option value="${esc(f)}">${esc(pretty(f))}</option>`).join('');
  $('#facet-filter').value=selectedFacet; $('#facet-filter').disabled=!facets.length;
  const shown=game.components.filter(c=>selectedFacet==='all'||c.facet===selectedFacet);
  $('#component-count').textContent=shown.length;
  $('#component-list').innerHTML=shown.length ? shown.map(c=>{
    const key=componentKey(game.id,c.id), chosen=picks.has(key);
    return `<details class="component" data-component-id="${esc(c.id)}" ${openComponents.has(c.id)?'open':''}><summary><span><span class="component-facet">${esc(pretty(c.facet))}</span>${esc(c.label)}</span><span class="expand-symbol">+</span></summary><div class="component-body"><p>${esc(c.summary)}</p>${c.reads.length||c.writes.length?`<dl class="component-io"><dt>Reads</dt><dd>${esc(c.reads.join(', ')||'Not recorded')}</dd><dt>Writes</dt><dd>${esc(c.writes.join(', ')||'Not recorded')}</dd></dl>`:''}<div class="evidence-refs">${c.evidence.length?c.evidence.map(e=>`<p><span>${esc(pretty(e.kind))}</span><code>${esc(e.ref)}</code></p>`).join(''):'<p>Evidence is recorded at parameter level or remains incomplete. Review the original ontology before use.</p>'}</div><button type="button" class="pick-component ${chosen?'chosen':''}" data-component="${esc(c.id)}" aria-pressed="${chosen}">${chosen?'Added to request ✓':'Use this component +'}</button></div></details>`;
  }).join('') : '<p class="empty-note">There are no component records in this snapshot yet. You can still include this game in a concept draft.</p>';
  for (const button of $('#component-list').querySelectorAll('[data-component]')) button.onclick=()=>{
    const key=componentKey(game.id,button.dataset.component);
    picks.has(key)?picks.delete(key):picks.add(key); selected.add(game.id);renderInspector();renderDraft();renderCatalog();renderMap();
  };
  if (previousComponentFocus) list.querySelector(`[data-component="${previousComponentFocus}"]`)?.focus({preventScroll:true});
  $('#inspect-source').replaceChildren();
  for (const ref of game.sourceReferences) {
    const p=document.createElement('p'); const url=ref.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/), pin=ref.match(/\b[a-f0-9]{40}\b/);
    if (url) {const a=document.createElement('a');a.href=url[0]+(pin?`/tree/${pin[0]}`:'');a.target='_blank';a.rel='noreferrer';a.textContent='Decompiled source ↗';p.append(a);}
    const small=document.createElement('span'); small.textContent=ref;p.append(small);$('#inspect-source').append(p);
  }
  if (game.ontologyPath) {const p=document.createElement('p');p.textContent=game.ontologyPath;$('#inspect-source').append(p);}
}
function renderCatalog() {
  const games=filterGames(catalog.games,query,evidenceOnly), visible=showAll||query||evidenceOnly?games:games.slice(0,12);
  $('#catalog-results').textContent=`${games.length} games`;
  $('#research-games').innerHTML=visible.map(game=>`<article class="research-card ${selected.has(game.id)?'in-mix':''}"><button class="card-inspect" data-inspect="${game.id}" aria-label="Inspect ${esc(game.name)}"><div class="mini-art palette-${catalog.games.findIndex(g=>g.id===game.id)%8}"><span class="mini-orbit"></span><span class="mini-block block-one"></span><span class="mini-block block-two"></span><span class="mini-code">${game.gameCode}</span><span class="mini-star">✳</span></div><span class="card-evidence">${game.components.length?`${game.components.length} COMPONENT RECORDS`:'ROM INDEXED'}</span><h3>${esc(game.shortName)}</h3><span class="game-genre">${esc(short(game.genres.map(pretty).slice(0,2).join(' · ')||'Extraction in progress',53))}</span></button><div class="research-card-bottom"><span>${game.id==='pokemon-firered-version'?'Source-build integration':'Research catalog'}</span><button data-mix="${game.id}" aria-label="${selected.has(game.id)?'Remove':'Add'} ${esc(game.shortName)} ${selected.has(game.id)?'from':'to'} mix" aria-pressed="${selected.has(game.id)}">${selected.has(game.id)?'✓ Added':'+ Mix'}</button></div></article>`).join('');
  for(const b of $('#research-games').querySelectorAll('[data-inspect]'))b.onclick=()=>{go(b.dataset.inspect);$('#game-space').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});};
  for(const b of $('#research-games').querySelectorAll('[data-mix]'))b.onclick=()=>toggle(b.dataset.mix);
  $('#show-all-games').hidden=!!(showAll||query||evidenceOnly);$('#show-all-games').textContent=`Explore all ${catalog.games.length} games ↓`;
}
function renderDraft() {
  $('#mix-count').textContent=String(selected.size).padStart(2,'0');
  $('#mix-sources').innerHTML=selected.size?[...selected].map(id=>`<div class="mix-source"><span class="mix-source-mark source-color-${catalog.games.findIndex(g=>g.id===id)%8}">✳</span><span><strong>${esc(byId[id].shortName)}</strong><small>${byId[id].components.length} component records</small></span><button data-remove="${id}" aria-label="Remove ${esc(byId[id].shortName)} from mix">×</button></div>`).join(''):'<p class="empty-note">Add games from the map or the collection to start your mix.</p>';
  for(const b of $('#mix-sources').querySelectorAll('[data-remove]'))b.onclick=()=>toggle(b.dataset.remove);
  const components=resolveSelection(catalog,picks);
  $('#mix-components').innerHTML=components.length?components.map(({game,component})=>{const key=componentKey(game.id,component.id);return `<label class="adaptation"><span>${esc(game.shortName)} <span aria-hidden="true">↳</span> ${esc(component.label)}</span><textarea rows="2" maxlength="1500" data-adaptation="${esc(key)}" placeholder="How should this component change in your game?">${esc(adaptations[key]||'')}</textarea></label>`;}).join(''):'<p class="empty-note">Open a game’s component record above and choose “Use this component” to anchor your request.</p>';
  for(const field of $('#mix-components').querySelectorAll('[data-adaptation]'))field.oninput=()=>{adaptations[field.dataset.adaptation]=field.value;updateRequest();};
  updateRequest();
}
function updateRequest() {
  const intent=$('#mix-intent').value;
  let validationError = '';
  try { createAttempt(catalog,picks,intent,adaptations); } catch(error) { validationError=error.message; }
  const anchored=!validationError;
  $('#export-attempt').disabled=!anchored;
  $('#draft-type').textContent=anchored?'COMPONENT REQUEST READY':'CONCEPT DRAFT';
  $('#draft-readiness').textContent=anchored?'Your request references actual component IDs from two or more games. Review adaptations before handing it to Codex.':validationError;
  const draft={schema_version:1,kind:'gameverse_concept_draft',intent,game_ids:[...selected],component_ids:[...picks],adaptations:Object.fromEntries([...picks].map(key=>[key,adaptations[key]||''])),research_snapshot:catalog.snapshotDate,status:'unbuilt',notes:'A design prompt, not a playable artifact. Similarity is exploratory; selected rules require implementation.'};
  lastSerialized=JSON.stringify(draft,null,2);
  $('#copy-draft').disabled=selected.size<2||!intent.trim();
}
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function initTabs(){
  for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>{
    const view=b.dataset.view;
    for(const btn of document.querySelectorAll('[data-view]')){btn.classList.toggle('active',btn===b);btn.setAttribute('aria-current',btn===b?'page':'false');}
    $('#discover-view').hidden=view==='play';$('#play-view').hidden=view!=='play';
    if(view==='workshop')$('#workshop').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    else window.scrollTo({top:0,behavior:'instant'});
  };
  $('#jump-workshop').onclick=()=>document.querySelector('[data-view="workshop"]').click();
}
initTabs();
try {
  const response=await fetch('/games/research.json');if(!response.ok)throw Error('Research catalog unavailable.');catalog=await response.json();byId=Object.fromEntries(catalog.games.map(g=>[g.id,g]));
  $('#research-count').textContent=catalog.games.length;$('#ontology-count').textContent=catalog.games.filter(g=>g.components.length).length;$('#all-components-count').textContent=catalog.games.reduce((n,g)=>n+g.components.length,0);
  $('#map-axis').innerHTML=Object.entries(catalog.views).map(([key,v])=>`<option value="${esc(key)}">${esc(v.label)}</option>`).join('');$('#map-axis').value=axis;$('#map-axis').onchange=e=>{axis=e.target.value;renderMap();};
  $('#facet-filter').onchange=e=>{selectedFacet=e.target.value;renderInspector();};
  $('#game-search').oninput=e=>{query=e.target.value;renderCatalog();};
  $('#evidence-only').onchange=e=>{evidenceOnly=e.target.checked;renderCatalog();};
  $('#show-all-games').onclick=()=>{showAll=true;renderCatalog();};
  $('#mix-intent').oninput=updateRequest;
  $('#copy-draft').onclick=async()=>{try{await navigator.clipboard.writeText(lastSerialized);msg('Concept draft copied. Hand it to Codex to develop the idea.');}catch{download(JSON.parse(lastSerialized),'gameverse-concept.json');msg('Clipboard unavailable. Your concept draft was downloaded.');}};
  $('#export-attempt').onclick=()=>{try{download(createAttempt(catalog,picks,$('#mix-intent').value,adaptations),'gameverse-request.json');msg('Request exported. Run it with python3 -m tools.game_attempt --request gameverse-request.json in the research checkout.');}catch(error){msg(error.message);}};
  $('#seed-example').onclick=()=>{
    selected=new Set(['pokemon-emerald-version','metroid-zero-mission']);picks=new Set(['pokemon-emerald-version:grid_step_locomotion','metroid-zero-mission:ability_gating_graph']);
    adaptations={'pokemon-emerald-version:grid_step_locomotion':'Use simplified four-direction one-cell movement, without Emerald’s turn-in-place, frame timing or speed variants.','metroid-zero-mission:ability_gating_graph':'Use a collectible key to unlock a barrier; this does not reproduce Zero Mission’s equipment flags or native movement gates.'};
    $('#mix-intent').value='Create a small top-down exploration game: find an upgrade, return to a locked route, open the barrier and reach a new area. Use original abstract geometry and no copied assets.';renderDraft();renderCatalog();renderMap();renderInspector();msg('Loaded the key-and-gate reference request. The current harness implements this simplified grid template.');
  };
  $('#research-provenance').textContent=`Snapshot ${catalog.snapshotDate} · source ${catalog.sourceCommit.slice(0,8)} · ${Object.keys(catalog.views).length} views · cached embedding model revision unavailable`;
  renderMap();renderInspector();renderCatalog();renderDraft();
}catch(error){msg(error.message);$('#research-load-error').hidden=false;}
