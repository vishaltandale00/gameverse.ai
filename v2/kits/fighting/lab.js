// Visual check for the fighting kit: paints art from a fallback direction, runs the game at a
// fixed 60 Hz with kit-player key mapping, and can overlay hitboxes and hurtboxes.
import kit from './index.js';
import { hurtboxes, activeHitbox } from './sim.js';
import { paintGameArt } from '/v2/art/paint.js';
import { fallbackDirection } from '/v2/art/direction.js';

const canvas = document.getElementById('view'), ctx = canvas.getContext('2d');
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
if (params.get('mode')) $('mode').value = params.get('mode');

let game, render, state, acc = 0, last = performance.now(), pending = [];
const keys = new Set();

function artFor(content) {
  const { brief, entities } = kit.cast(content);
  const design = { title: content.title, pitch: content.logline, view: 'side', artStyle: '', cast: brief, background: undefined };
  const painted = paintGameArt(fallbackDirection(design), { id: 'fighting-lab', title: content.title, entities });
  const urls = new Map(painted.assets.map(a => [a.key, URL.createObjectURL(new Blob([a.svg], { type: 'image/svg+xml' }))]));
  return painted.assemble(k => urls.get(k));
}

function boot({ quick = false, cvc = false } = {}) {
  const checked = kit.validate({ ...kit.content.sample, mode: $('mode').value });
  if (!checked.ok) { $('status').textContent = checked.errors.map(e => e.message).join('; '); return; }
  game = kit.createGame(checked.content, { seed: Number(params.get('seed') || 1) });
  render = kit.createRenderer(game, { art: artFor(checked.content) });
  state = game.createState();
  const p1 = Number(params.get('p1') ?? 0), p2 = Number(params.get('p2') ?? game.bossIdx);
  if (quick || cvc || params.get('phase') === 'fight') {
    game.startMatch(state, { p1, p2, stage: Number(params.get('stage') ?? 0), level: Number(params.get('level') || 2), cpuBoth: cvc, levels: cvc ? [3, 3] : null });
    if (params.get('skip') === '1') game.debug.skipIntro(state);
  }
  manual = false;
  window.labState = () => state;
  window.labGame = () => game;
  canvas.focus();
}

const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyZ', 'KeyX', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyJ', 'KeyK']);
addEventListener('keydown', e => {
  if (e.code === 'KeyR') { boot(); return; }
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
// Scripted input for automated checks: window.labPress([[x, y, a, b], ...]) feeds frames.
let scripted = [];
window.labPress = frames => { scripted.push(...frames); };

function drawBoxes() {
  const cam = render.fx?.lastCam;
  if (!cam || !state.fighters?.length) return;
  ctx.save(); ctx.lineWidth = 1.5;
  for (const f of state.fighters) {
    ctx.strokeStyle = 'rgba(80,160,255,.9)';
    for (const b of hurtboxes(game, f)) ctx.strokeRect(cam.sx(b.x), cam.sy(b.y + b.h), b.w * cam.zoom, b.h * cam.zoom);
    const hb = activeHitbox(game, f);
    if (hb) { ctx.strokeStyle = 'rgba(255,60,60,.95)'; ctx.fillStyle = 'rgba(255,60,60,.25)'; ctx.fillRect(cam.sx(hb.x), cam.sy(hb.y + hb.h), hb.w * cam.zoom, hb.h * cam.zoom); ctx.strokeRect(cam.sx(hb.x), cam.sy(hb.y + hb.h), hb.w * cam.zoom, hb.h * cam.zoom); }
  }
  for (const p of state.projectiles) { ctx.strokeStyle = 'rgba(255,200,60,.9)'; ctx.strokeRect(cam.sx(p.x - p.w / 2), cam.sy(p.y + p.h / 2), p.w * cam.zoom, p.h * cam.zoom); }
  ctx.restore();
}

function tick() {
  const i = scripted.length ? (([x, y, a, b]) => ({ x, y, a: !!a, b: !!b }))(scripted.shift()) : input();
  game.step(state, i);
  pending.push(...state.events);
}
// Headless-friendly stepping for automated checks (the pane may be hidden and rAF throttled).
let manual = false;
window.labAdvance = (frames = 1) => { manual = true; for (let n = 0; n < frames && state.status === 'playing'; n++) { tick(); if (n < frames - 1) paint(1 / 60); } paint(1 / 60); return { phase: state.phase, frame: state.frame }; };

function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  acc = Math.min(acc + dt, 0.25);
  const attract = $('attract').checked;
  while (acc >= 1 / 60) {
    acc -= 1 / 60;
    if (manual || attract || state.status !== 'playing') continue;
    tick();
  }
  if (!manual) paint(dt);
  requestAnimationFrame(frame);
}
function paint(dt) {
  const attract = $('attract').checked;
  const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render(ctx, state, { cssWidth: r.width, cssHeight: r.height, dt, events: pending, reducedMotion: $('reduced').checked, paused: false, attract });
  pending = [];
  if ($('boxes').checked && !attract) drawBoxes();
  if (state.status !== 'playing') $('status').textContent = `${state.status.toUpperCase()}${state.reason ? ` — ${state.reason}` : ''} · score ${state.score} · R to restart`;
}

$('mode').addEventListener('change', () => boot());
$('restart').addEventListener('click', () => boot());
$('quick').addEventListener('click', () => boot({ quick: true }));
$('cvc').addEventListener('click', () => boot({ cvc: true }));
boot();
requestAnimationFrame(frame);
