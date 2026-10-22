// Visual check for the runner kit: paints art from a fallback direction,
// runs the chosen mode's sample at a fixed 60 Hz with kit-player key mapping.
import kit from './index.js';
import { paintGameArt } from '../../art/paint.js';
import { fallbackDirection } from '../../art/direction.js';
import { composeGame, composeRenderer } from '../mods/compose.js';
import { plan, BOT } from './verify.js';

const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
for (const m of Object.keys(kit.samples)) $('mode').append(new Option(m, m));
$('mode').value = params.get('mode') || 'lanes';
if (params.get('attract')) $('attract').checked = true;
if (params.get('bot')) $('bot').checked = true;

const urls = [];
function artFor(content) {
  for (const u of urls.splice(0)) URL.revokeObjectURL(u);
  const { brief, entities } = kit.cast(content);
  const design = { title: content.title, pitch: content.logline, view: 'topdown', artStyle: content.artStyle, cast: brief, background: content.background };
  const painted = paintGameArt(fallbackDirection(design), { id: content.title, title: content.title, entities });
  const map = {};
  for (const a of painted.assets) { const u = URL.createObjectURL(new Blob([a.svg], { type: 'image/svg+xml' })); urls.push(u); map[a.key] = u; }
  return painted.assemble(k => map[k]);
}

let game, render, state, pending = [], botQueue = [];
function load() {
  const content = kit.validate(kit.samples[$('mode').value]).content;
  const art = artFor(content);
  const mods = $('blaster').checked ? { weapon: { kind: 'projectile', name: 'blaster', ammoFrom: 'unlimited', reloadOn: 'power_up', ammo: 5, effect: 'defeat', color: '#7fe3ff' } } : {};
  game = composeGame(kit, content, { seed: Number($('seed').value) || 1, mods });
  render = composeRenderer(kit, game, { art });
  state = game.createState(); pending = []; botQueue = [];
  canvas.focus();
}
for (const id of ['mode', 'seed', 'blaster']) $(id).addEventListener('change', load);
$('restart').addEventListener('click', load);

const keys = new Set();
addEventListener('keydown', e => { if (e.code === 'KeyR') { load(); return; } if (/^(Arrow|Space|Key[ZXWASDJK])/.test(e.code)) { e.preventDefault(); keys.add(e.code); } });
addEventListener('keyup', e => keys.delete(e.code));
const input = () => {
  const k = c => keys.has(c);
  return { x: (k('ArrowRight') || k('KeyD') ? 1 : 0) - (k('ArrowLeft') || k('KeyA') ? 1 : 0), y: (k('ArrowDown') || k('KeyS') ? 1 : 0) - (k('ArrowUp') || k('KeyW') ? 1 : 0), a: k('Space') || k('KeyZ') || k('KeyJ'), b: k('KeyX') || k('KeyK') };
};
function botInput() {
  const sv = game.impl.solver;
  if (state.frame % sv.every === 0) { const cfg = BOT[state.mode]; if (botQueue.length <= cfg.depth - cfg.replan) botQueue = plan(game, state, cfg); state.botAct = sv.actions[botQueue.shift() ?? 0]; }
  const a = state.botAct || {};
  return a.tap && state.frame % sv.every !== 0 ? {} : a;
}

let last = performance.now(), acc = 0, endT = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  const attract = $('attract').checked;
  if (!attract) {
    acc += dt;
    while (acc >= 1 / 60) {
      acc -= 1 / 60;
      if (state.status !== 'playing') { endT += 1 / 60; if (endT > 2) { endT = 0; load(); } break; }
      game.step(state, $('bot').checked ? botInput() : input());
      pending.push(...state.events);
    }
  }
  const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render(ctx, state, { cssWidth: r.width, cssHeight: r.height, dt, events: pending, reducedMotion: $('reduced').checked, paused: false, attract });
  pending = [];
  $('info').textContent = `${state.mode} · ${state.status}${state.reason ? ` (${state.reason})` : ''} · t=${state.time.toFixed(1)}s · speed ${state.speed.toFixed(1)} · score ${state.score} · coins ${state.coins} · near misses ${state.stats.near_misses}\ncontrols: ${(game.controls || []).map(c => `${c.input}: ${c.label}`).join(' · ')}`;
  requestAnimationFrame(frame);
}
load();
requestAnimationFrame(frame);
