// Visual check page for the puzzle kit: paints the sample's art in code, runs
// the game at a fixed 60 Hz with kit-player key mapping, and renders it.
import kit from './index.js';
import { SAMPLES } from './sample.js';
import { fallingBot } from './falling.js';
import { chainBot } from './chain.js';
import { swapBot } from './swap.js';
import { slideBot } from './slide.js';
import { paintGameArt } from '../../art/paint.js';
import { fallbackDirection } from '../../art/direction.js';

const DT = 1 / 60;
const canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status'), reportEl = document.getElementById('report');
const botBox = document.getElementById('bot'), reducedBox = document.getElementById('reduced');
const params = new URLSearchParams(location.search);
let sampleKey = SAMPLES[params.get('mode')] ? params.get('mode') : 'falling';
botBox.checked = params.get('bot') === '1';
reducedBox.checked = params.get('reduced') === '1';

const keys = new Set();
addEventListener('keydown', e => {
  if (e.code === 'KeyR') { start(); return; }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
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

function artFor(content) {
  const { brief, entities } = kit.cast(content);
  const design = { title: content.title, pitch: content.logline, view: 'topdown', artStyle: content.artStyle, cast: brief, background: content.background };
  const painted = paintGameArt(fallbackDirection(design), { id: content.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title: content.title, entities });
  const urls = new Map(painted.assets.map(a => [a.key, URL.createObjectURL(new Blob([a.svg], { type: 'image/svg+xml' }))]));
  return painted.assemble(key => urls.get(key));
}

let game, render, state, bot, pending = [], acc = 0, last = performance.now();
const BOTS = { falling: fallingBot, chain: chainBot, swap: swapBot, slide: slideBot };
function start() {
  const checked = kit.validate(SAMPLES[sampleKey]);
  if (!checked.ok) { statusEl.textContent = `invalid: ${checked.errors.map(e => e.code).join(', ')}`; return; }
  game = kit.createGame(checked.content, { seed: Number(params.get('seed')) || 7 });
  render = kit.createRenderer(game, { art: artFor(checked.content) });
  state = game.createState();
  bot = BOTS[game.mode](game);
  pending = []; acc = 0;
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === sampleKey));
  canvas.focus();
}
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => { sampleKey = b.dataset.mode; history.replaceState(null, '', `?mode=${sampleKey}`); start(); });
document.getElementById('restart').addEventListener('click', start);
document.getElementById('verify').addEventListener('click', () => {
  const t = performance.now(), r = kit.verify(SAMPLES[sampleKey], { seed: 1, budgetMs: 2000 });
  reportEl.hidden = false;
  reportEl.textContent = `${r.ok ? 'OK' : 'FAILED'} in ${Math.round(performance.now() - t)} ms\n${JSON.stringify({ problems: r.problems, ...r.report }, null, 2)}`;
});
reportEl.addEventListener('click', () => { reportEl.hidden = true; });

function frame(now) {
  const real = Math.min((now - last) / 1000, 0.25); last = now;
  acc = Math.min(acc + real, 0.25);
  while (acc >= DT) {
    acc -= DT;
    if (state.status !== 'playing') break;
    game.step(state, botBox.checked ? bot(state) : input());
    if (state.events.length) pending.push(...state.events);
  }
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render(ctx, state, { cssWidth: rect.width, cssHeight: rect.height, dt: real, events: pending, reducedMotion: reducedBox.checked, paused: false, attract: false });
  pending = [];
  statusEl.textContent = `${game.mode} · ${state.status}${state.reason ? ` (${state.reason})` : ''} · level ${state.level + 1} · score ${state.score}`;
  requestAnimationFrame(frame);
}
// Debug hook for automated checks: advance n fixed steps (events are kept for the next render).
globalThis.labAdvance = (n = 60) => { for (let i = 0; i < n && state.status === 'playing'; i++) { game.step(state, botBox.checked ? bot(state) : input()); if (state.events.length) pending.push(...state.events); if (i < n - 12) pending = []; } return { status: state.status, phase: state.phase, level: state.level, score: state.score }; };
start();
requestAnimationFrame(frame);
