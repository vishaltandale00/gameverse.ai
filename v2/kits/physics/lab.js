// Visual check for the physics kit: paints the sample's art from its cast brief,
// runs the game at a fixed 60 Hz with kit-player keyboard mapping, and renders it.
import kit from './index.js';
import { MODE_IMPL } from './game.js';
import { paintGameArt } from '../../art/paint.js';
import { fallbackDirection } from '../../art/direction.js';

const DT = 1 / 60;
const canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status'), levelsEl = document.getElementById('levels');
const reducedBox = document.getElementById('reduced'), botBox = document.getElementById('bot');

const content = kit.validate(kit.content.sample).content;
const { brief, entities } = kit.cast(content);
const design = { title: content.title, pitch: content.logline, view: 'side', artStyle: content.artStyle, cast: brief, background: content.background };
const painted = paintGameArt(fallbackDirection(design), { id: 'physics-lab', title: content.title, entities });
const urls = new Map(painted.assets.map(a => [a.key, URL.createObjectURL(new Blob([a.svg], { type: 'image/svg+xml' }))]));
const art = painted.assemble(key => urls.get(key));

const params = new URLSearchParams(location.search || location.hash.slice(1));
const game = kit.createGame(content, { seed: Number(params.get('seed')) || 1 });
const render = kit.createRenderer(game, { art });
let state = game.createState(), paused = false, pending = [];
if (params.get('level')) game.startLevel(state, Number(params.get('level')) - 1);
if (params.get('bot')) botBox.checked = true;

levelsEl.innerHTML = content.levels.map((l, i) => `<button type="button" data-level="${i}">${i + 1}. ${l.name}</button>`).join(' ');
levelsEl.addEventListener('click', e => { const b = e.target.closest('[data-level]'); if (b) { state = game.createState(); game.startLevel(state, Number(b.dataset.level)); pending = []; canvas.focus(); } });

const keys = new Set();
addEventListener('keydown', e => {
  if (e.code === 'KeyR') { state = game.createState(); pending = []; return; }
  if (e.code === 'KeyP') { paused = !paused; return; }
  if (/^Digit[1-9]$/.test(e.code)) { const i = Number(e.code.slice(5)) - 1; if (i < content.levels.length) { state = game.createState(); game.startLevel(state, i); pending = []; } return; }
  if (/^(Arrow|Key[WASDZXJK]$|Space)/.test(e.code)) e.preventDefault();
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

let last = performance.now(), acc = 0;
function frame(now) {
  const real = Math.min(0.25, (now - last) / 1000); last = now;
  if (!paused) {
    acc = Math.min(acc + real, 0.25);
    while (acc >= DT) {
      acc -= DT;
      if (state.status !== 'playing') break;
      const human = input();
      const inp = botBox.checked && state.phase === 'play' ? MODE_IMPL[state.mode].bot(state) : state.phase === 'intro' && botBox.checked ? { x: 0, y: 0, a: state.frame % 20 === 0, b: false } : human;
      game.step(state, inp);
      pending.push(...state.events);
    }
  }
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render(ctx, state, { cssWidth: rect.width, cssHeight: rect.height, dt: real, events: pending, reducedMotion: reducedBox.checked, paused, attract: false });
  pending = [];
  statusEl.textContent = `${state.status} · level ${state.level + 1} (${state.mode}) · phase ${state.phase} · score ${state.score} · lives ${state.lives}${state.reason ? ' · ' + state.reason : ''}`;
  requestAnimationFrame(frame);
}
// Inspection hook: advance the simulation without waiting for frames (background tabs throttle them).
globalThis.physicsLab = {
  game, get state() { return state },
  advance(frames, inp = { x: 0, y: 0, a: false, b: false }, bot = false) {
    for (let i = 0; i < frames && state.status === 'playing'; i++) { game.step(state, bot && state.phase === 'play' ? MODE_IMPL[state.mode].bot(state) : inp); pending.push(...state.events); }
    return { phase: state.phase, level: state.level, score: state.score };
  },
};
canvas.focus();
requestAnimationFrame(frame);
