// Creature kit lab: runs the sample game at a fixed 60 Hz with the keyboard, painting art in the
// browser from a fallback art direction (blob: URLs), with no host around it.
import { validate } from './content.js';
import { SAMPLE_CONTENT } from './fixtures/sample.js';
import { createGame } from './game.js';
import { createRenderer } from './ui/renderer.js';
import { cast, artDesign } from './cast.js';
import { paintGameArt } from '../../art/paint.js';
import { fallbackDirection } from '../../art/direction.js';
import { personLook } from './ui/looks.js';

const canvas = document.getElementById('screen'), ctx = canvas.getContext('2d'), status = document.getElementById('status');
const checked = validate(SAMPLE_CONTENT);
if (!checked.ok) status.textContent = `Sample failed validation: ${checked.errors.map(e => e.code).join(', ')}`;
const content = checked.content;

function paintArt() {
  const t0 = performance.now();
  // The offline direction knows nothing about the cast; dress the hero and rival from their descriptions.
  const direction = { ...fallbackDirection(artDesign(content)), player: personLook(content.player.look, 'player'), enemy: personLook(content.rival.look, 'rival') };
  const painted = paintGameArt(direction, { id: content.id, title: content.title, entities: cast(content).entities });
  const urls = new Map(painted.assets.map(a => [a.key, URL.createObjectURL(new Blob([a.svg], { type: 'image/svg+xml' }))]));
  const art = painted.assemble(key => urls.get(key));
  return { art, ms: Math.round(performance.now() - t0) };
}

const { art, ms: artMs } = paintArt();
const params = new URLSearchParams(location.search);
let seed = Number(params.get('seed') || 1);
let game, render, state;
function boot() {
  game = createGame(content, { seed });
  render = createRenderer(game, { art });
  state = game.createState();
  try { const saved = localStorage.getItem(`creature-lab:${seed}`); if (saved && params.has('continue')) state = game.restore(saved); } catch {}
  window.__creature = { game, get state() { return state; }, art };
}
boot();

const keys = new Set();
const MAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Space: 'a', KeyZ: 'a', KeyJ: 'a', KeyX: 'b', KeyK: 'b' };
addEventListener('keydown', e => {
  if (MAP[e.code]) { e.preventDefault(); keys.add(MAP[e.code]); }
  if (e.code === 'KeyR' && !e.repeat) boot();
  if (/^Digit[1-4]$/.test(e.code) && !e.repeat) { seed = Number(e.code.slice(5)); boot(); }
});
addEventListener('keyup', e => { if (MAP[e.code]) keys.delete(MAP[e.code]); });
addEventListener('blur', () => keys.clear());
canvas.focus();

const input = () => ({ x: (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0), y: (keys.has('down') ? 1 : 0) - (keys.has('up') ? 1 : 0), a: keys.has('a'), b: keys.has('b') });
let last = performance.now(), acc = 0, pending = [], frames = 0, fpsT = 0, fps = 0, stepMs = 0;
/** Draw once (also used by automation while the page is in the background). */
function draw(dt = 1 / 60) {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render(ctx, state, { cssWidth: rect.width, cssHeight: rect.height, dt, events: pending, reducedMotion: false, paused: false, attract: false });
  pending = [];
}
/** Step n frames with a held input, then draw (for automated checks). */
window.__creatureStep = (n = 1, inp = {}) => { for (let i = 0; i < n; i++) { game.step(state, inp); pending.push(...state.events); } draw(); return { mode: state.mode, map: state.player.map, x: state.player.x, y: state.player.y }; };
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  acc += dt;
  const t0 = performance.now();
  while (acc >= 1 / 60) {
    acc -= 1 / 60;
    game.step(state, input());
    if (state.events.length) pending.push(...state.events);
    if (state.events.some(e => e.name === 'save')) { try { localStorage.setItem(`creature-lab:${seed}`, JSON.stringify(state)); } catch {} }
  }
  stepMs = performance.now() - t0;
  draw(dt);
  frames++; fpsT += dt;
  if (fpsT > 0.5) {
    fps = Math.round(frames / fpsT); frames = 0; fpsT = 0;
    const p = state.player;
    status.textContent = `seed ${seed} · ${state.mode} · ${p.map} (${p.x},${p.y}) · party ${state.party.map(c => `${c.name} L${c.level} ${c.hp}hp`).join(', ') || '—'} · badges ${state.badges.length} · ₽${state.money} · ${fps} fps · step ${stepMs.toFixed(2)} ms · art ${artMs} ms`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
