// Gameverse Studio: describe a game, answer a few questions, watch it get
// built on the drafting table, play it, change it. Everything updates from
// the /api/v2/events stream; new versions hot-load into the running game.
// New games are kernel documents (one kernel, primitives only); versions made by
// the retired arcade/kit engines still play here but are not changed any more.
import { mountGame, loadPromoted } from '/v2/web/player.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KERNEL = 'gameverse.v2.game/0.2';
const isKernel = record => record?.doc?.schema === KERNEL;
const promotedReady = loadPromoted();
// Legacy records keep their own players; every new game mounts on the kernel player.
// (loaded on demand, so the default flow never loads the retired engines).
const mount = async (el, record) => record.doc?.schema === 'gameverse.v2.game-spec/0.1' ? (await import('/v2/web/arcade-player.js')).mountArcade(el, record)
  : record.doc?.schema === 'gameverse.v2.kit-game/0.1' ? (await import('/v2/web/kit-player.js')).mountKit(el, record) : mountGame(el, record);
const STAGES = { decomposing: 'Reading the idea', decomposed: 'Idea decomposed', selected: 'Primitives chosen', outlining: 'Outlining the game', outlined: 'Outline checked', first_playable: 'First playable', detail: 'Detailing zones', detail_rejected: 'Detail rejected', gap: 'Building a new primitive', revising: 'Working on the change', tweaked: 'Tweaked', revised: 'Revised', experimenting: 'Writing an experiment', experimented: 'Experiment checked', complete: 'Done' };
// Changes any kernel game understands: params are tweaked without a model; the rest is revised or offered as an experiment.
const QUICK = ['Make it faster', 'Make it harder', 'Make it easier', 'Bigger world', 'More characters', 'Add a time limit'];

let games = [], selected = null, player = null, selecting = 0, shownVersion = null, tickTimer = 0;
const builds = new Map(); // gameId -> { started, stage, detail, partial, art: [], log: [] }
const build = id => { if (!builds.has(id)) builds.set(id, { started: performance.now(), stage: 'decomposing', detail: '', partial: null, art: [], log: [], plan: {} }); return builds.get(id); };

async function api(path, body, method) {
  const res = await fetch(path, body || method ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(data.error || res.statusText);
  return data;
}
function toast(text) { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = text; document.body.append(t); setTimeout(() => t.remove(), 3200); }

// ---------- library ----------
async function refreshLibrary() {
  ({ games } = await api('/api/v2/games'));
  $('#games').innerHTML = games.map(g => `<li class="${g.id === selected ? 'current' : ''}"><a href="#${g.id}" ${g.id === selected ? 'aria-current="page"' : ''}>
      <strong><span class="dot ${g.status}"></span>${esc(g.title)}</strong>
      <small>${g.sample ? 'sample, ' : ''}${g.status === 'generating' ? 'building…' : g.status === 'failed' ? 'failed' : `${g.versions} version${g.versions === 1 ? '' : 's'}`}</small></a>
      <button class="quiet remove" data-remove="${g.id}" aria-label="Delete ${esc(g.title)}" title="Delete">✕</button></li>`).join('') || '<li class="muted">Games you make appear here.</li>';
  $('#clear').hidden = !games.length;
}
$('#games').addEventListener('click', async e => {
  const id = e.target.closest('[data-remove]')?.dataset.remove; if (!id) return;
  e.preventDefault();
  try { await api(`/api/v2/games/${id}`, null, 'DELETE'); if (id === selected) location.hash = ''; refreshLibrary(); }
  catch (error) { toast(error.message); }
});
$('#clear').addEventListener('click', async () => {
  if (!confirm('Delete all your games? Games still being built are kept.')) return;
  for (const g of games) if (g.status !== 'generating') await api(`/api/v2/games/${g.id}`, null, 'DELETE').catch(() => {});
  location.hash = ''; refreshLibrary();
});

// ---------- create: idea -> questions -> build ----------
let pendingPrompt = '';
$('#create').addEventListener('submit', async e => {
  e.preventDefault();
  pendingPrompt = $('#prompt').value.trim(); if (!pendingPrompt) return;
  $('#make').disabled = true; $('#make').textContent = 'Thinking…';
  try {
    const { questions } = await api('/api/v2/questions', { prompt: pendingPrompt });
    if (!questions.length) return startBuild([]);
    $('#questions').hidden = false;
    $('#questions').innerHTML = `<p>A few choices shape the game. The first options are picked for you.</p>
      ${questions.map((q, i) => `<fieldset><legend>${esc(q.question)}</legend><div class="chips">${q.options.map((o, j) => `<label><input type="radio" name="q${i}" value="${esc(o)}" ${j ? '' : 'checked'}><span>${esc(o)}</span></label>`).join('')}</div></fieldset>`).join('')}
      <div class="actions"><button class="primary" id="build" type="button">Build it</button><button class="quiet" id="skip" type="button">Skip and build</button></div>`;
    $('#build').onclick = () => startBuild(questions.map((q, i) => ({ question: q.question, answer: document.querySelector(`input[name=q${i}]:checked`)?.value })).filter(a => a.answer));
    $('#skip').onclick = () => startBuild([]);
    $('#build').focus();
  } catch (error) { toast(error.message); }
  finally { $('#make').disabled = false; $('#make').textContent = 'Make it'; }
});
async function startBuild(answers) {
  $('#questions').hidden = true;
  try {
    const { gameId } = await api('/api/v2/games', { prompt: pendingPrompt, answers });
    const b = build(gameId); b.log.unshift({ label: 'Requested', ms: 0 }); // events may already have arrived
    $('#prompt').value = ''; location.hash = gameId;
  } catch (error) { toast(error.message); }
}

// ---------- stage views ----------
function welcome() {
  $('#stage').innerHTML = `<section class="welcome"><h1>What do you want to play?</h1><p>Describe any game, or a mashup of games. It's broken into mechanics, composed from shared primitives, checked, and playable as soon as the outline is; zones fill in while you play. Change it whenever you like.</p></section>`;
}

function constructionView(meta) {
  $('#stage').innerHTML = `<header class="game-head"><h1 id="ct-title">${esc(meta.title)}</h1><p id="ct-pitch">${esc(meta.prompt)}</p></header>
    <div class="board blueprint"><canvas id="ct-canvas" aria-label="Level being built"></canvas><div class="scan"></div></div>
    <div class="status" aria-live="polite"><span id="ct-stage"><strong>Designing the game</strong></span><span id="ct-time">0.0 s</span></div>
    <div class="cast" id="ct-cast"></div>`;
  renderConstruction();
}

function renderPlan(b) {
  const p = b.plan || {}, el = $('#ct-cast'); if (!el) return;
  el.classList.add('plan');
  el.innerHTML = [
    p.references?.length ? `<figure><figcaption>References</figcaption>${p.references.map(r => `<span class="chip">${esc(r)}</span>`).join(' ')}</figure>` : '',
    p.mechanics?.length ? `<figure><figcaption>Mechanics</figcaption><ul>${p.mechanics.map(m => `<li>${esc(m)}</li>`).join('')}</ul></figure>` : '',
    p.spaces?.length ? `<figure><figcaption>Primitives</figcaption>${[...p.spaces, ...(p.systems || [])].map(x => `<code>${esc(x)}</code>`).join(' ')}</figure>` : '',
    p.gaps?.length ? `<figure><figcaption>Not covered by any primitive yet</figcaption><ul>${p.gaps.map(g => `<li>${esc(g)}</li>`).join('')}</ul></figure>` : '',
  ].join('');
}

let revealRows = 0;
function renderConstruction() {
  const b = selected && builds.get(selected), canvas = $('#ct-canvas'); if (!b || !canvas) return;
  const p = b.partial || {};
  if (p.title) $('#ct-title').textContent = p.title;
  if (p.pitch) $('#ct-pitch').textContent = p.pitch;
  $('#ct-stage').innerHTML = `<strong>${esc(STAGES[b.stage] || b.stage)}</strong>${b.detail ? ` — ${esc(b.detail)}` : ''}`;
  const kinds = Object.entries(p.entities || {}).filter(([, d]) => !d.solid && d.glyph);
  $('#ct-cast').innerHTML = kinds.map(([k, d]) => { const art = b.art.find(a => a.key === `sprite:${k}`); return `<figure><div class="art">${art ? `<img src="${art.url}" alt="">` : esc(d.glyph)}</div>${esc(k.replace(/-/g, ' '))}</figure>`; }).join('');
  if (!p.rows) { renderPlan(b); return; }
  const rows = p.rows || [], ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
  if (!rows.length) return;
  revealRows = Math.min(rows.length, revealRows + 1);
  const cols = Math.max(...rows.map(r => r.length)), cell = Math.max(3, Math.min(rect.width / cols, rect.height / rows.length));
  const ox = (rect.width - cols * cell) / 2, oy = (rect.height - rows.length * cell) / 2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${Math.max(6, cell * 0.9)}px system-ui, "Apple Color Emoji", sans-serif`;
  rows.slice(0, revealRows).forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.' || ch === ' ') return;
    const def = (p.entities || {})[(p.legend || {})[ch]];
    if (!def || def.solid) { ctx.fillStyle = def?.color || '#5f8fb0'; ctx.fillRect(ox + x * cell, oy + y * cell, cell + .5, cell + .5); }
    else { ctx.fillStyle = '#fff'; ctx.fillText(def.glyph || ch, ox + (x + .5) * cell, oy + (y + .55) * cell); }
  }));
}

async function playView(meta, record) {
  await promotedReady;
  const legacy = !isKernel(record);
  const gaps = record?.report?.gaps || [];
  $('#stage').innerHTML = `<header class="game-head"><h1>${esc(meta.title)}</h1><p>${esc(record?.report?.summary || meta.prompt)}</p></header>
    ${legacy ? '<p class="notice">This game was made with the retired genre engine. It still plays, but changes need a new game.</p>' : ''}
    ${record?.report?.change && record.report.changes?.length ? `<p class="changed">Changed for “${esc(record.report.change)}”: ${record.report.changes.map(esc).join(' · ')}</p>` : ''}
    ${(record?.report?.gaps || []).filter(g => g.kind === 'renamed').map(g => `<p class="changed">${esc(g.why)}</p>`).join('')}
    ${gaps.filter(g => g.kind === 'partial').map(g => `<p class="notice">${esc(g.why)}${!legacy ? ` <button type="button" class="inline" data-experiment="${esc(g.capability)}">Try the rest as an experiment</button>` : ''}</p>`).join('')}
    ${gaps.filter(g => g.kind === 'unsupported' || g.kind === 'capability').length ? `<div class="notice">Not in this game yet (no primitive covers it):<ul>${gaps.filter(g => g.kind === 'unsupported' || g.kind === 'capability').slice(0, 6).map(g => `<li>${esc(g.capability)}${g.why ? ` <small>${esc(g.why)}</small>` : ''}${!legacy ? ` <button type="button" class="inline" data-experiment="${esc(g.capability)}" title="A code model writes it as a new primitive, checked in a sandbox and labelled experimental">Try it as an experiment</button>` : ''}</li>`).join('')}</ul></div>` : ''}
    ${experimentsList(record)}
    <div class="board" id="game"></div>
    ${legacy ? '' : `<form class="change" id="change"><input type="text" id="change-text" placeholder="Change this game, e.g. “faster, and add a lighthouse keeper who knows the way”" aria-label="Change this game"><button class="primary" type="submit">Change it</button><button type="button" id="experiment" title="A new primitive written by a code model, sandboxed and labelled experimental">Try as experiment</button></form>
    <div class="quick">${QUICK.map(q => `<button type="button" data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div>`}`;
  player = await mount($('#game'), record); shownVersion = record.version;
  if ($('#change')) $('#change').onsubmit = e => { e.preventDefault(); requestChange($('#change-text').value); };
  if ($('#experiment')) $('#experiment').onclick = () => requestExperiment($('#change-text').value);
  $('#stage').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.experiment) requestExperiment(b.dataset.experiment);
    else if (b.dataset.promote) promote(b.dataset.promote);
    else if (b.dataset.removeExperiment) api(`/api/v2/games/${selected}/experiments/${b.dataset.removeExperiment}`, null, 'DELETE').then(() => toast('Removing that experiment.')).catch(error => toast(error.message));
    else if (b.dataset.apply) applyPromotion(b.dataset.apply);
  };
  pollPromotions();
  if ($('.quick')) $('.quick').onclick = e => { const q = e.target.closest('[data-quick]')?.dataset.quick; if (q) requestChange(q); };
}

// ---------- experiments (tier 3) and promotion into real mods (tier 4) ----------
function experimentsList(record) {
  const list = record?.doc?.experiments || [];
  if (!list.length) return '';
  return `<div class="experiments"><h3>Experiments</h3>${list.map(e => `<div class="experiment" data-id="${esc(e.id)}"><span class="badge">Experimental</span> <strong>${esc(e.label)}</strong> <small>${esc(e.request || '')}</small>
    <span class="promotion" id="promo-${esc(e.id)}"></span>
    ${e.card?.id ? `<code>${esc(e.card.id)}</code>` : ''}
    <button type="button" data-promote="${esc(e.id)}" title="A coding agent builds this as a native, tested primitive every game can use (minutes, in the background)">Build it properly</button>
    <button type="button" class="quiet" data-remove-experiment="${esc(e.id)}">Remove</button></div>`).join('')}</div>`;
}
async function requestExperiment(text) {
  text = String(text || '').trim(); if (!text || !selected) return toast('Say what the experiment should add.');
  try {
    await api(`/api/v2/games/${selected}/experiments`, { request: text });
    builds.set(selected, { started: performance.now(), stage: 'experimenting', detail: text, partial: null, art: [], log: [{ label: `Experiment: ${text}`, ms: 0 }] });
    $('#change-text').value = ''; toast('Writing that as an experiment (usually under 15 s). Keep playing.'); renderSheet();
  } catch (error) { toast(error.message); }
}
const promotions = new Map(); // experimentId -> improve job id
async function promote(experimentId) {
  try { const { job } = await api(`/api/v2/games/${selected}/promote`, { experimentId }); promotions.set(experimentId, job.id); toast('Building it properly in the background: a coding agent writes and tests a native primitive.'); pollPromotions(); }
  catch (error) { toast(error.message); }
}
let promoTimer = 0;
async function pollPromotions() {
  clearTimeout(promoTimer);
  try {
    const { jobs } = await api('/api/v2/improve');
    for (const j of jobs.filter(j => j.gameId === selected)) {
      const el = document.getElementById(`promo-${j.experiment?.id}`); if (!el) continue;
      const label = { queued: 'Queued', preparing: 'Preparing', coding: j.target === 'primitive' ? 'Coding the primitive' : 'Coding the mod', verifying: 'Verifying', succeeded: 'Built and verified', failed: 'Build failed', cancelled: 'Cancelled' }[j.state] || j.state;
      el.innerHTML = `<em>${esc(label)}${j.reason && j.state === 'failed' ? `: ${esc(String(j.reason).slice(0, 120))}` : ''}</em>${j.state === 'succeeded' && !j.applied ? ` <button type="button" data-apply="${esc(j.id)}">Apply</button>` : ''}${j.applied ? ' <em>· applied; restart the server to load it</em>' : ''}`;
    }
    if (jobs.some(j => j.gameId === selected && !['succeeded', 'failed', 'cancelled'].includes(j.state))) promoTimer = setTimeout(pollPromotions, 3000);
  } catch {}
}
async function applyPromotion(id) {
  try { await api(`/api/v2/improve/${id}/apply`, {}); toast('Applied to this checkout. Restart the server to load the new primitive.'); pollPromotions(); }
  catch (error) { toast(error.message); }
}

async function requestChange(text) {
  text = text.trim(); if (!text || !selected) return;
  try {
    await api(`/api/v2/games/${selected}/revise`, { change: text });
    builds.set(selected, { started: performance.now(), stage: 'revising', detail: text, partial: null, art: [], log: [{ label: `Change: ${text}`, ms: 0 }] });
    $('#change-text').value = ''; toast('Working on that change. Keep playing; it loads in when ready.'); renderSheet();
  } catch (error) { toast(error.message); }
}

// ---------- build sheet ----------
async function renderSheet(record) {
  $('#sheet').hidden = !selected; if (!selected) return;
  const b = builds.get(selected);
  $('#timeline').innerHTML = (b?.log || []).map((s, i, all) => `<li class="${i === all.length - 1 ? 'now' : ''}"><span>${esc(s.label)}</span><span>${s.ms != null ? (s.ms / 1000).toFixed(1) + ' s' : ''}</span></li>`).join('') || '<li>Built earlier.</li>';
  if (record) {
    const r = record.report || {}, pt = r.playtest;
    if (isKernel(record)) { $('#checks').innerHTML = kernelChecks(record); }
    else $('#checks').innerHTML = pt ? [
      `<div class="${r.verified ? 'ok' : 'warn'}">${r.verified ? `Winnable: the test player finished in ${pt.win?.seconds ?? '?'} s` : 'Playable, but the test player did not finish'}</div>`,
      `<div class="muted">It explored ${pt.explored} spots, ${Math.round(pt.simulatedSeconds)} s of play, in ${pt.wallMs} ms</div>`,
      ...(pt.issues || []).filter(i => i.code !== 'mechanic_unused').map(i => `<div class="${i.severity === 'error' ? 'bad' : 'warn'}">${esc(i.message)}</div>`),
      ...(r.gaps || []).map(g => `<div class="warn">Not possible yet: ${esc(g.capability)}</div>`),
      r.art ? `<div class="muted">Art: ${r.art.generated} painted, ${r.art.reused} reused</div>` : '',
      `<div class="muted">Model ${esc(record.provenance?.model || '')}, seed ${esc(record.provenance?.seed ?? '')}, design ${esc((record.provenance?.designHash || record.docHash || '').slice(0, 8))}</div>`,
    ].join('') : `<div class="${r.preflight?.ok ? 'ok' : 'bad'}">Checks ${r.preflight?.ok ? 'passed' : 'failed'}</div>`;
  }
  const { versions } = await api(`/api/v2/games/${selected}/versions`).catch(() => ({ versions: [] }));
  $('#versions').innerHTML = versions.map(v => `<li><button type="button" data-version="${v.version}" ${v.version === shownVersion ? 'aria-current="true"' : ''}>v${v.version}: ${esc(v.stage)}</button></li>`).join('') || '<li class="muted">None yet.</li>';
}
$('#versions').addEventListener('click', async e => {
  const v = Number(e.target.closest('[data-version]')?.dataset.version); if (!v || !selected) return;
  const record = await api(`/api/v2/games/${selected}/v/${v}`);
  player?.dispose(); player = await mount($('#game'), record); shownVersion = v; renderSheet(record);
});

function kernelChecks(record) {
  const r = record.report || {}, v = r.verification || {}, t = r.timings || {}, sec = x => (x == null ? '—' : `${(x / 1000).toFixed(2)} s`);
  return [
    `<div class="${v.ok ? 'ok' : 'bad'}">Preflight ${v.ok ? 'passed' : 'failed'}${v.preflightMs != null ? ` in ${v.preflightMs} ms` : ''}${v.warnings ? `, ${v.warnings} warnings` : ''}</div>`,
    v.completable === true ? `<div class="ok">Completable: the solver reached ${esc((v.endings || []).join(', ') || 'an ending')} (${v.states ?? '?'} states, ${v.ms} ms)</div>` : v.completable === false ? `<div class="${v.exhaustive ? 'bad' : 'warn'}">${v.exhaustive ? 'No ending is reachable' : 'The solver found no ending within its budget'}</div>` : '',
    v.beatsNeverFired?.length ? `<div class="warn">Beats the solver never reached: ${esc(v.beatsNeverFired.join(', '))}</div>` : '',
    r.outline ? `<div class="muted">Outline: ${esc(r.outline.source)}${r.outline.fellBack ? ' (fell back to the procedural skeleton)' : ''}, ${r.outline.rounds?.length ?? 0} rounds</div>` : '',
    t.requestToFirstPlayableMs != null ? `<div class="muted">Request → first playable ${sec(t.requestToFirstPlayableMs)} (decompose ${sec(t.decomposeMs)}, select ${sec(t.selectMs)}, outline ${sec(t.outlineMs)}, build ${t.firstPlayableBuildMs} ms)</div>` : '',
    r.detail ? `<div class="muted">Detail ${esc(r.detail.task)}: ${r.detail.ok ? 'accepted' : `rejected (${esc(r.detail.reason)})`} in ${sec(r.detail.ms)}</div>` : '',
    r.path ? `<div class="muted">Change made by ${r.path === 'tweak' ? 'a parameter tweak (no model)' : r.path === 'model' ? 'targeted model edits' : 'nothing'}${t.totalMs != null ? ` in ${sec(t.totalMs)}` : ''}</div>` : '',
    ...(r.selection?.mechanics || []).slice(0, 8).map(m => `<div class="muted">${esc(m.description)} → ${m.primitives?.length ? m.primitives.map(x => `<code>${esc(x)}</code>`).join(' ') : '<em>no primitive</em>'}</div>`),
    `<div class="muted">Seed ${esc(record.provenance?.seed ?? '')}, doc ${esc((record.docHash || '').slice(0, 8))}, ${esc(record.provenance?.pipeline || '')}</div>`,
  ].join('');
}

// ---------- selection ----------
async function select(id) {
  const token = ++selecting;
  selected = id || null; player?.dispose(); player = null;
  await refreshLibrary(); if (token !== selecting) return;
  if (!selected) { welcome(); renderSheet(); return; }
  const { meta, latest } = await api(`/api/v2/games/${selected}`).catch(() => ({}));
  if (token !== selecting) return;
  if (!meta) { welcome(); return; }
  if (latest) await playView(meta, latest); else { build(selected); revealRows = 0; constructionView(meta); }
  renderSheet(latest);
}
clearInterval(tickTimer);
tickTimer = setInterval(() => {
  const b = selected && builds.get(selected);
  if (b && $('#ct-time')) { $('#ct-time').textContent = `${((performance.now() - b.started) / 1000).toFixed(1)} s`; renderConstruction(); }
}, 100);

// ---------- live events ----------
const events = new EventSource('/api/v2/events');
events.addEventListener('stage', ev => {
  const e = JSON.parse(ev.data), b = build(e.gameId);
  b.stage = e.stage;
  b.detail = e.stage === 'detail' ? e.task?.split(':').pop() : e.stage === 'detail_rejected' ? `${e.task?.split(':').pop()}: ${e.reason}` : e.stage === 'gap' ? e.mechanic : e.stage === 'revising' ? b.detail : e.stage === 'outlined' ? `${e.source}${e.fellBack ? ' (procedural fallback)' : ''}` : '';
  if (e.stage === 'decomposed') Object.assign(b.plan, { references: e.references, mechanics: e.mechanics });
  if (e.stage === 'selected') Object.assign(b.plan, { spaces: e.spaces, systems: e.systems, gaps: e.gaps });
  b.log.push({ label: (STAGES[e.stage] || e.stage) + (e.stage === 'painted' || e.stage === 'animated' ? ` ${e.done}/${e.of}` : ''), ms: e.ms });
  if (e.gameId === selected) renderSheet();
});
events.addEventListener('draft', ev => {
  const e = JSON.parse(ev.data), b = build(e.gameId);
  if (e.partial) b.partial = e.partial;
  if (e.art) b.art.push(e.art);
});
events.addEventListener('version', async ev => {
  const e = JSON.parse(ev.data), b = build(e.gameId);
  b.log.push({ label: `Version ${e.version} ready`, ms: e.ms });
  refreshLibrary();
  if (e.gameId !== selected) { toast('One of your games has a new version.'); return; }
  const record = await api(`/api/v2/games/${e.gameId}/v/${e.version}`);
  if (!player || !$('#game')) { const { meta } = await api(`/api/v2/games/${e.gameId}`); await playView(meta, record); toast('Your game is ready. Play!'); }
  else if (player.update(record)) { shownVersion = e.version; toast(String(record.stage).startsWith('detail:') ? `New detail in ${record.stage.slice(7)}.` : `Version ${e.version} loaded.`); }
  else { const { meta } = await api(`/api/v2/games/${e.gameId}`); player?.dispose(); await playView(meta, record); toast(`Version ${e.version} loaded (restarted).`); }
  renderSheet(record);
});
for (const type of ['job_done', 'job_failed']) events.addEventListener(type, ev => {
  const e = JSON.parse(ev.data), b = build(e.gameId);
  b.log.push({ label: type === 'job_done' ? 'Done' : `Failed: ${e.error}`, ms: e.ms });
  if (type === 'job_failed' && e.gameId === selected) toast(`That build failed: ${e.error}`);
  refreshLibrary(); if (e.gameId === selected) renderSheet();
});

addEventListener('hashchange', () => select(location.hash.slice(1)));
select(location.hash.slice(1));

// Theater view: collapse the side panels and give the game the window. Remembered per browser.
{
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'theater-toggle';
  const set = on => {
    document.body.classList.toggle('theater', on);
    toggle.innerHTML = `${on ? 'Exit theater' : 'Theater'} <kbd>T</kbd>`;
    toggle.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem('gv-theater', on ? '1' : '0'); } catch {}
    dispatchEvent(new Event('resize')); // let the player re-fit its canvas
  };
  toggle.addEventListener('click', () => set(!document.body.classList.contains('theater')));
  addEventListener('keydown', e => {
    if (e.key !== 't' && e.key !== 'T') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    set(!document.body.classList.contains('theater'));
  });
  document.body.append(toggle);
  let saved = false; try { saved = localStorage.getItem('gv-theater') === '1'; } catch {}
  set(saved);
}
