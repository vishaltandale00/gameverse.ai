// Kit lab: plays a kit's sample content with procedural art, for visual review.
// /v2/web/kit-lab.html?seed=lab&style=pixel — arrows/WASD to move, R to restart.
import kit from '../kits/maze/index.js';
import { botInput } from '../kits/maze/verify.js';
import { paintGameArt } from '../art/paint.js';
import { fallbackDirection } from '../art/direction.js';

const params = new URLSearchParams(location.search);
const seed = params.get('seed') || 'lab';
const $ = id => document.getElementById(id);
const canvas = $('screen'), ctx = canvas.getContext('2d');
for (const k of ['bot', 'noart', 'reduced', 'attract']) if (params.get(k) === '1') $(k).checked = true;

const { content, errors } = kit.validate(kit.content.sample);
if (errors.length) console.error('sample content errors', errors);
const { brief, entities } = kit.cast(content);
const direction = fallbackDirection({ title: content.title, pitch: content.logline, view: 'topdown', artStyle: params.get('style') || '', cast: brief });
const painted = paintGameArt(direction, { id: `kit-lab-${kit.id}`, title: content.title, entities });
const urls = Object.fromEntries(painted.assets.map(a => [a.key, URL.createObjectURL(new Blob([a.svg], { type: 'image/svg+xml' }))]));
const art = painted.assemble(key => urls[key]);
$('title').textContent = `${kit.name} · ${content.title}`;

let game, render, state, high = 0, memo = {};
function start() {
  game = kit.createGame(content, { seed });
  render = kit.createRenderer(game, { art: $('noart').checked ? {} : art });
  state = game.createState({ high });
  memo = {};
}
$('restart').onclick = start;
$('noart').onchange = start;

// Held keys, plus taps latched until a step has seen them (a tap can start and end between steps).
const held = new Set(), tapped = new Set();
const KEYS = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', Space: 'a' };
addEventListener('keydown', e => {
  if (e.code === 'KeyR') { start(); return; }
  if (KEYS[e.code]) { held.add(KEYS[e.code]); tapped.add(KEYS[e.code]); e.preventDefault(); }
});
addEventListener('keyup', e => held.delete(KEYS[e.code]));
addEventListener('blur', () => held.clear());
function input() {
  const on = k => held.has(k) || tapped.has(k);
  const i = { x: (on('r') ? 1 : 0) - (on('l') ? 1 : 0), y: (on('d') ? 1 : 0) - (on('u') ? 1 : 0), a: on('a'), b: false };
  tapped.clear();
  return i;
}

function resize() {
  const dpr = devicePixelRatio || 1, { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  return { width, height, dpr };
}
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const { width, height, dpr } = resize();
  const attract = $('attract').checked, events = [];
  if (!attract && state.status === 'playing') {
    acc += dt;
    while (acc >= 1 / 60) {
      game.step(state, $('bot').checked ? botInput(game, state, memo) : input());
      events.push(...state.events);
      acc -= 1 / 60;
    }
  }
  if (state.status !== 'playing') high = Math.max(high, state.score);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render(ctx, state, { cssWidth: width, cssHeight: height, dt, events, reducedMotion: $('reduced').checked, paused: false, attract });
  $('status').textContent = `${state.status}${state.reason ? ` (${state.reason})` : ''} · phase ${state.phase} · score ${state.score} · level ${state.level + 1}/${game.levelCount} · lives ${state.lives} · pellets ${state.pelletsLeft}/${state.pelletsTotal}`;
  requestAnimationFrame(frame);
}
start();
requestAnimationFrame(frame);
window.kitLab = { get state() { return state; }, get game() { return game; }, art, direction };
