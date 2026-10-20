// Studio shell: create games, browse the library, play the selected game and
// watch it build. Subscribes to /api/v2/events; new versions hot-load into
// the running game and the library/timeline update without a reload.
import { mountGame } from '/v2/web/player.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let games = [], selected = null, player = null, selecting = 0;
const timeline = new Map(); // gameId -> [{label, ms}]

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json(); if (!res.ok) throw Error(data.error || res.statusText); return data;
}
function toast(text) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = text; document.body.append(t); setTimeout(() => t.remove(), 3500); }

async function refreshLibrary() {
  ({ games } = await api('/api/v2/games'));
  $('#games').innerHTML = games.map(g => `<li><a href="#${g.id}" ${g.id === selected ? 'aria-current="page"' : ''}><span class="dot ${g.status}"></span>${esc(g.title)}<small>${g.versions} version${g.versions === 1 ? '' : 's'} · ${esc(g.status)}</small></a></li>`).join('') || '<li class="muted">No games yet.</li>';
}

function renderInspector(record) {
  $('#inspector').hidden = !selected;
  const steps = timeline.get(selected) || [];
  $('#timeline').innerHTML = steps.map(s => `<li><b>${esc(s.label)}</b><span>${s.ms != null ? (s.ms / 1000).toFixed(1) + ' s' : ''}</span></li>`).join('') || '<li>Waiting for events…</li>';
  if (!record) { $('#checks').innerHTML = ''; return; }
  const r = record.report || {}, solve = r.solve || {};
  $('#checks').innerHTML = [
    `<div class="${r.preflight?.ok ? 'ok' : 'bad'}">Preflight ${r.preflight?.ok ? 'passed' : 'failed'} in ${r.preflight?.ms ?? '?'} ms</div>`,
    solve.completable != null ? `<div class="${solve.completable ? 'ok' : 'bad'}">${solve.completable ? `Completable: ${Object.keys(solve.endings || {}).length} ending(s) reachable` : 'Not completable yet'} (${solve.states} states)</div>` : '',
    (solve.beatsNeverFired || []).length ? `<div class="warn">Story beats never reached: ${solve.beatsNeverFired.length}</div>` : '',
    ...(r.preflight?.warnings || []).slice(0, 4).map(w => `<div class="warn">${esc(w.message)}</div>`),
    `<div class="muted">v${record.version} · ${esc(record.provenance?.planner || '')} · seed ${esc(record.provenance?.seed ?? '')} · ${record.docHash?.slice(0, 10)}</div>`,
  ].join('');
}

async function select(id) {
  const token = ++selecting; // ignore results from superseded selections
  selected = id || null; player?.dispose(); player = null;
  await refreshLibrary();
  if (token !== selecting) return;
  if (!selected) { $('#stage').innerHTML = '<section class="empty"><h1>Describe a game.</h1><p>It\'s playable in seconds, and keeps growing while you play.</p></section>'; renderInspector(null); return; }
  const { meta, latest } = await api(`/api/v2/games/${selected}`);
  if (token !== selecting) return;
  $('#stage').innerHTML = `<header class="game-head"><h1>${esc(meta.title)}</h1><span>${esc(meta.prompt)}</span></header><div class="game" id="game"></div>`;
  if (latest) { player = mountGame($('#game'), latest); }
  else $('#game').innerHTML = '<section class="empty"><h1>Building…</h1><p>The first playable version appears here automatically.</p></section>';
  renderInspector(latest);
}

const events = new EventSource('/api/v2/events');
const note = (e, label) => { const list = timeline.get(e.gameId) || []; list.push({ label, ms: e.ms }); timeline.set(e.gameId, list); };
events.addEventListener('stage', ev => { const e = JSON.parse(ev.data); note(e, e.stage + (e.task ? ` · ${e.task}` : '')); if (e.gameId === selected) renderInspector(null); });
events.addEventListener('version', async ev => {
  const e = JSON.parse(ev.data); note(e, `v${e.version} ready`);
  refreshLibrary();
  if (e.gameId !== selected) { toast(`A game you made has a new version (v${e.version}).`); return; }
  const record = await api(`/api/v2/games/${e.gameId}/v/${e.version}`);
  if (!player) { if (!$('#game')) return select(e.gameId); $('#game').innerHTML = ''; player = mountGame($('#game'), record); toast('Your game is playable.'); }
  else if (player.update(record)) toast(`New content loaded (v${e.version}).`);
  renderInspector(record);
});
for (const type of ['job_done', 'job_failed']) events.addEventListener(type, ev => { const e = JSON.parse(ev.data); note(e, type === 'job_done' ? 'done' : 'failed: ' + e.error); refreshLibrary(); if (e.gameId === selected) renderInspector(null); });

$('#create').addEventListener('submit', async e => {
  e.preventDefault();
  const prompt = $('#prompt').value.trim(); if (!prompt) return;
  try { const { gameId } = await api('/api/v2/games', { prompt }); timeline.set(gameId, [{ label: 'requested', ms: 0 }]); location.hash = gameId; $('#prompt').value = ''; }
  catch (error) { toast(error.message); }
});
addEventListener('hashchange', () => select(location.hash.slice(1)));
select(location.hash.slice(1));
