// Visual check for the shmup kit: paints the sample's art in code, runs the
// game at a fixed 60 Hz with the kit-player key mapping, and renders it.
import kit from './index.js';
import { botInput } from './verify.js';
import { paintGameArt } from '../../art/paint.js';
import { fallbackDirection } from '../../art/direction.js';

const DT = 1 / 60;
const $ = id => document.getElementById(id);
const canvas = $('view'), ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
const content = kit.validate(kit.content.sample).content;
const urls = [];

function paint(pixel) {
  for (const u of urls.splice(0)) URL.revokeObjectURL(u);
  const { brief, entities } = kit.cast(content);
  const design = { title: content.title, pitch: content.logline, view: 'topdown', artStyle: pixel ? 'crisp 16-bit pixel art' : content.artStyle, cast: brief, background: content.background };
  const painted = paintGameArt(fallbackDirection(design), { id: 'shmup-lab', title: content.title, entities });
  const byKey = new Map(painted.assets.map(a => { const u = URL.createObjectURL(new Blob([a.svg], { type: 'image/svg+xml' })); urls.push(u); return [a.key, u]; }));
  return painted.assemble(k => byKey.get(k));
}

content.stages.forEach((s, i) => $('stage').append(new Option(`${i + 1}. ${s.name} (${s.mode})`, String(i))));
$('stage').value = params.get('stage') || '0';
$('bot').checked = params.has('bot');
$('pixel').checked = params.has('pixel');

let game, render, state, paused = false, art = paint($('pixel').checked);
function start() {
  game = kit.createGame(content, { seed: Number(params.get('seed') || 1) });
  render = kit.createRenderer(game, { art });
  state = game.createState({ stage: Number($('stage').value) });
  canvas.focus();
}
start();

const keys = new Set();
const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyZ', 'KeyX', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyJ', 'KeyK']);
addEventListener('keydown', e => {
  if (e.target.tagName === 'SELECT') return;
  if (e.code === 'KeyR') { start(); return; }
  if (e.code === 'KeyP' || e.code === 'Escape') { paused = !paused; return; }
  if (KEYS.has(e.code)) { e.preventDefault(); keys.add(e.code); }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const k = c => keys.has(c);
const input = () => ({
  x: (k('ArrowRight') || k('KeyD') ? 1 : 0) - (k('ArrowLeft') || k('KeyA') ? 1 : 0),
  y: (k('ArrowDown') || k('KeyS') ? 1 : 0) - (k('ArrowUp') || k('KeyW') ? 1 : 0),
  a: k('Space') || k('KeyZ') || k('KeyJ'),
  b: k('KeyX') || k('KeyK'),
});
$('restart').onclick = start;
$('pause').onclick = () => { paused = !paused; canvas.focus(); };
$('stage').onchange = start;
$('pixel').onchange = () => { art = paint($('pixel').checked); render = kit.createRenderer(game, { art }); canvas.focus(); };

let last = performance.now(), acc = 0, pending = [], stepMs = 0, frames = 0, fpsT = 0, fps = 0;
function frame(now) {
  const real = Math.min((now - last) / 1000, 0.25); last = now;
  if (!paused && !$('attract').checked) {
    acc = Math.min(acc + real, 0.25);
    const t0 = performance.now();
    while (acc >= DT) {
      acc -= DT;
      if (state.status !== 'playing') break;
      game.step(state, $('bot').checked ? botInput(state, game) : input());
      if (state.events.length) pending.push(...state.events);
    }
    stepMs = stepMs * 0.9 + (performance.now() - t0) * 0.1;
  }
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r0 = performance.now();
  render(ctx, state, { cssWidth: rect.width, cssHeight: rect.height, dt: real, events: pending, reducedMotion: $('reduced').checked, paused, attract: $('attract').checked });
  const renderMs = performance.now() - r0;
  pending = [];
  frames++; fpsT += real;
  if (fpsT > 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  $('stats').textContent = `${state.status} | ${state.phase} | stage ${state.stage + 1} | score ${state.score} | lives ${state.lives} | enemies ${state.enemies.length} | bullets ${state.ebullets.length} | step ${stepMs.toFixed(2)}ms render ${renderMs.toFixed(1)}ms | ${fps} fps${state.reason ? ` | ${state.reason}` : ''}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Debug hook: fast-forward the simulation (bot-driven) when the tab is throttled.
window.__shmup = {
  get state() { return state; },
  game: () => game,
  advance(seconds, { bot = true, keepEvents = 30 } = {}) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n && state.status === 'playing'; i++) {
      game.step(state, bot ? botInput(state, game) : input());
      if (i >= n - keepEvents) pending.push(...state.events);
    }
    return { phase: state.phase, stage: state.stage, score: state.score, lives: state.lives, enemies: state.enemies.length, bullets: state.ebullets.length };
  },
};
