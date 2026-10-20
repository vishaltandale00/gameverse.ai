// Default polish layer: pure helpers behind animation, particles, camera,
// screens and checkpoints. Rendering itself is checked in the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRegistry } from '../v2/modules/index.js';
import { preflight, SPEC_SCHEMA } from '../v2/engine/spec.js';
import { compose } from '../v2/engine/compose.js';
import {
  createAnim, stepAnim, pickFrame, particlesFor, hitStopFor, shakeFor, ambientTheme, paletteFrom, stepCamera,
  lossReason, recordBest, bestKey, tally, objective, rand, createParticles, addParticles, stepParticles, luminance,
} from '../v2/engine/juice.js';
import { initialCheckpoint, updateCheckpoint, canRespawn, respawn } from '../v2/web/checkpoint.js';
import { gameOverScreen, victoryScreen, controlRows, titleParts, titleScreen, pauseScreen } from '../v2/web/arcade-overlay.js';

const DT = 1 / 60;
const run = (anim, e, ctx, frames) => { for (let i = 0; i < frames; i++) anim = stepAnim(anim, e, { dt: DT, ...ctx }); return anim; };

test('animation state machine picks idle, run, jump and hurt poses', () => {
  const still = { vx: 0, vy: 0 };
  assert.equal(run(createAnim(), still, { grounded: true }, 10).pose, 'idle');
  const poses = new Set();
  let a = createAnim();
  for (let i = 0; i < 60; i++) { a = stepAnim(a, { vx: 8, vy: 0 }, { dt: DT, grounded: true, runSpeed: 8 }); poses.add(a.pose); }
  assert.deepEqual([...poses].sort(), ['runA', 'runB'], 'running alternates two stride frames');
  // Faster running strides more often.
  const strides = vx => { let s = createAnim(), flips = 0, last = null; for (let i = 0; i < 120; i++) { s = stepAnim(s, { vx, vy: 0 }, { dt: DT, grounded: true }); if (s.pose !== last) flips++; last = s.pose; } return flips; };
  assert.ok(strides(14) > strides(5));
  assert.equal(run(createAnim(), { vx: 3, vy: -5 }, { grounded: false }, 2).pose, 'jump');
  assert.equal(run(createAnim(), { vx: 3, vy: 0 }, { grounded: true, invuln: true }, 2).pose, 'hurt');
  assert.equal(run(createAnim(), { vx: 0, vy: 0 }, { grounded: true, side: false }, 2).pose, 'idle');
});

test('takeoff stretches, landing squashes by impact, and both spring back', () => {
  let a = run(createAnim(), { vx: 0, vy: 0 }, { grounded: true }, 5);
  a = stepAnim(a, { vx: 0, vy: -14 }, { dt: DT, grounded: false });
  assert.equal(a.event, 'takeoff');
  assert.ok(a.sy > 1.1 && a.sx < 0.9);
  a = run(a, { vx: 0, vy: 20 }, { grounded: false }, 30);
  const hard = stepAnim(a, { vx: 0, vy: 0 }, { dt: DT, grounded: true });
  assert.equal(hard.event, 'land');
  assert.ok(hard.sx > 1.2 && hard.sy < 0.8);
  const soft = stepAnim({ ...a, vy: 4 }, { vx: 0, vy: 0 }, { dt: DT, grounded: true });
  assert.ok(soft.impact < hard.impact);
  const settled = run(hard, { vx: 0, vy: 0 }, { grounded: true }, 40);
  assert.ok(Math.abs(settled.sx - 1) < 0.03 && Math.abs(settled.sy - 1) < 0.03);
  // A short hop off a bump (no real air time) does not squash.
  const blip = stepAnim(stepAnim(run(createAnim(), { vx: 0, vy: 0 }, { grounded: true }, 3), { vx: 0, vy: 2 }, { dt: DT, grounded: false }), { vx: 0, vy: 0 }, { dt: DT, grounded: true });
  assert.equal(blip.event, null);
});

test('pose frames fall back to the nearest painted frame', () => {
  const full = { idle: 'i', runA: 'a', runB: 'b', jump: 'j', hurt: 'h' };
  for (const pose of ['idle', 'runA', 'runB', 'jump', 'hurt']) assert.equal(pickFrame(full, pose), full[pose]);
  const enemy = { runA: 'a', runB: 'b' };
  assert.equal(pickFrame(enemy, 'idle'), 'a');
  assert.equal(pickFrame(enemy, 'hurt'), 'a');
  assert.equal(pickFrame({ idle: 'i' }, 'jump'), 'i');
  assert.equal(pickFrame(undefined, 'idle'), null);
  assert.equal(pickFrame({}, 'idle'), null);
});

test('events emit deterministic particles at the right places', () => {
  const enemy = { kind: 'bug', tags: ['enemy'], x: 5, y: 3, w: 1, h: 1 };
  const a = particlesFor({ events: [{ name: 'stomp', kind: 'bug' }], removed: [enemy], r: rand(3) });
  const b = particlesFor({ events: [{ name: 'stomp', kind: 'bug' }], removed: [enemy], r: rand(3) });
  assert.deepEqual(a, b);
  const debris = a.filter(p => p.shape === 'square');
  assert.ok(debris.length >= 8 && debris.every(p => p.g > 0 && Math.abs(p.x - 5.5) < 0.5));
  const gem = particlesFor({ removed: [{ kind: 'gem', tags: ['collectible'], x: 1, y: 1, w: 0.6, h: 0.6 }], r: rand(1) });
  assert.ok(gem.some(p => p.shape === 'star') && gem.some(p => p.shape === 'ring'));
  const player = { x: 2, y: 2, w: 0.8, h: 0.9, face: 1 };
  assert.ok(particlesFor({ events: [{ name: 'hurt' }], player, r: rand(1) }).every(p => p.shape === 'spark'));
  assert.ok(particlesFor({ events: [{ name: 'reach_goal' }], player, r: rand(1) }).filter(p => p.shape === 'confetti').length > 20);
  assert.deepEqual(particlesFor({ events: [{ name: 'jump' }, { name: 'tick' }], player, r: rand(1) }), []);
  // The pool is capped and particles expire.
  const ps = createParticles(50);
  addParticles(ps, gem.concat(gem, gem, gem, gem));
  assert.equal(ps.list.length, 50);
  for (let i = 0; i < 120; i++) stepParticles(ps, DT);
  assert.equal(ps.list.length, 0);
});

test('hit-stop is 2–4 frames and shake is bounded', () => {
  assert.equal(hitStopFor([{ name: 'stomp' }]), 3);
  assert.equal(hitStopFor([{ name: 'hit' }]), 2);
  assert.equal(hitStopFor([{ name: 'hit' }, { name: 'hurt' }]), 4);
  assert.equal(hitStopFor([{ name: 'collect' }, { name: 'jump' }]), 0);
  assert.equal(hitStopFor([]), 0);
  assert.ok(shakeFor([{ name: 'stomp' }]) > 0 && shakeFor([{ name: 'collect' }]) === 0);
  assert.equal(shakeFor(Array(9).fill({ name: 'defeated' })), 1);
});

test('ambient theme comes from the game words; palette keeps contrast', () => {
  assert.equal(ambientTheme({ title: 'Penguin Ninja: Ice Fortress', pitch: 'slide through a frozen fortress', entities: { 'lava-pit': {} } }), 'snow');
  assert.equal(ambientTheme({ title: 'Magma Run', pitch: 'escape the volcano' }), 'embers');
  assert.equal(ambientTheme({ title: 'Reef Rescue', pitch: 'swim the coral sea' }), 'bubbles');
  assert.equal(ambientTheme({ title: 'Grove Keeper', pitch: 'guard the autumn forest' }), 'leaves');
  assert.equal(ambientTheme({ title: 'Haunted Manor', pitch: 'ghosts at midnight' }), 'stars');
  assert.equal(ambientTheme({ title: 'Box', background: '#05070a' }), 'stars');
  assert.equal(ambientTheme({ title: 'Box', background: '#c8b48a' }), 'dust');
  const p = paletteFrom('#001022');
  assert.match(p.accent, /^#[0-9a-f]{6}$/);
  assert.ok(Math.abs(luminance(p.accent) - luminance('#001022')) > 0.3, 'accent stands out from a dark background');
  assert.equal(paletteFrom('#808080').accent, '#ffcf4a');
  assert.equal(paletteFrom('#ffe066').accentInk === '#1a1206' || paletteFrom('#ffe066').accentInk === '#ffffff', true);
});

test('camera looks ahead, holds a vertical dead-zone and stays in the level', () => {
  const view = { viewW: 20, viewH: 12, width: 100, height: 18 };
  const snap = stepCamera(null, { tx: 50, ty: 9, vx: 8, ...view });
  assert.ok(snap.cx > 50, 'looks ahead in the direction of travel');
  assert.equal(snap.x, snap.cx - 10);
  let cam = snap;
  for (let i = 0; i < 20; i++) cam = stepCamera(cam, { tx: 50, ty: 9.6, vx: 0, face: 1, dt: DT, grounded: false, ...view });
  assert.equal(cam.fy, snap.fy, 'small vertical moves stay inside the dead-zone');
  cam = stepCamera(cam, { tx: 60, ty: 9, vx: 8, dt: DT, ...view });
  assert.ok(cam.cx > snap.cx && cam.cx < 60, 'follows smoothly, not instantly');
  const edge = stepCamera(null, { tx: 1, ty: 1, vx: -8, ...view });
  assert.equal(edge.x, 0); assert.equal(edge.y, 0);
});

test('loss reasons, tallies, best times and objectives', () => {
  const spec = { title: 'Ice Fort', pitch: 'frozen', entities: { 'walrus-guard': { tags: ['enemy'] }, spikes: { tags: ['hazard'] }, throne: { tags: ['goal'] }, gem: { tags: ['collectible'] } }, win: { all: [{ count: 'reach_goal', gte: 1 }, { var: 'remaining', lte: 0 }] } };
  assert.equal(lossReason([{ name: 'jump' }, { name: 'fell' }], spec), 'Fell through the ice');
  assert.equal(lossReason([{ name: 'hurt', from: 'spikes' }, { name: 'hurt', from: 'walrus-guard' }, { name: 'defeated' }], spec), 'Taken down by the walrus guard');
  assert.equal(lossReason([{ name: 'hurt', from: 'spikes' }, { name: 'defeated' }], spec), 'Hit the spikes');
  assert.equal(lossReason([{ name: 'time_up' }], spec), 'Time ran out');
  assert.equal(objective(spec), 'Collect every gem, then reach the throne');
  const t = tally({ time: 12.345, vars: { collected: 3, remaining: 2, defeated_enemies: 1, shots_hit: 2, hp: 2 } }, { entities: [{ tags: ['enemy'] }, { tags: ['enemy'] }, { tags: ['enemy'] }, { tags: ['player'] }] });
  assert.deepEqual(t, { seconds: 12.35, pickups: 3, pickupsTotal: 5, enemies: 3, enemiesTotal: 3, hp: 2 });
  const memory = new Map(), storage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
  assert.deepEqual(recordBest(storage, 'g', 30), { best: 30, isNew: true });
  assert.deepEqual(recordBest(storage, 'g', 40), { best: 30, isNew: false });
  assert.deepEqual(recordBest(storage, 'g', 20), { best: 20, isNew: true });
  assert.equal(memory.get(bestKey('g')), '20');
  const broken = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  assert.deepEqual(recordBest(broken, 'g', 5), { best: 5, isNew: true });
  assert.deepEqual(recordBest(null, 'g', 5), { best: 5, isNew: true });
});

// A ledge, a pit and a far ledge with the goal.
const pitSpec = hp => {
  const r = preflight({
    schema: SPEC_SCHEMA, id: 'pit', title: 'Pit',
    level: { rows: ['..............G.', '................', '.P..............', '#####...########', '#####...########'], legend: { '#': 'wall', P: 'hero', G: 'flag' } },
    entities: { wall: { solid: true }, hero: { tags: ['player'] }, flag: { tags: ['goal'] } },
    modules: [{ use: 'platformer' }, { use: 'health', with: { hp } }, { use: 'goal' }],
    win: { count: 'reach_goal', gte: 1 }, lose: { var: 'hp', lte: 0 },
  }, defaultRegistry());
  assert.ok(r.ok, JSON.stringify(r.errors));
  return compose(r.spec, defaultRegistry());
};
function runIntoPit(game) {
  let state = game.createState(), cp = initialCheckpoint(state), respawned = null;
  for (let i = 0; i < 240 && state.status === 'playing'; i++) {
    game.step(state, { x: 1, y: 0, a: false, b: false });
    if (canRespawn(state, cp)) { respawned = respawn(state, cp); break; }
    cp = updateCheckpoint(cp, state, game);
  }
  return { state, cp, respawned };
}

test('a pit fall with health to spare respawns at the last safe ground', () => {
  const game = pitSpec(3);
  const { state, cp, respawned } = runIntoPit(game);
  assert.ok(state.events.some(e => e.name === 'fell'), 'the engine still reports the fall');
  assert.ok(cp.x > 2 && cp.x + 0.8 <= 5.05, 'checkpoint is the last spot with both feet on the ledge');
  assert.ok(respawned, 'respawned');
  const p = respawned.entities.find(e => e.tags.includes('player'));
  assert.equal(respawned.status, 'playing');
  assert.equal(respawned.vars.hp, 2);
  assert.deepEqual([p.x, p.y, p.vx, p.vy], [cp.x, cp.y, 0, 0]);
  assert.ok(respawned.modules.health.invuln > 0);
  assert.equal(state.status, 'lost', 'the original state is untouched');
  // The respawned state keeps simulating normally and deterministically.
  const again = runIntoPit(pitSpec(3)).respawned;
  assert.deepEqual(JSON.stringify(again), JSON.stringify(respawned));
  for (let i = 0; i < 30; i++) game.step(respawned, { x: 0, y: 0, a: false, b: false });
  assert.equal(respawned.status, 'playing');
});

test('a pit fall on the last heart is game over', () => {
  const { state, respawned } = runIntoPit(pitSpec(1));
  assert.equal(respawned, null);
  assert.equal(state.status, 'lost');
});

test('screens escape text and match the input device', () => {
  const over = gameOverScreen({ reason: '<img src=x>', stats: { seconds: 3, pickups: 1, pickupsTotal: 2, enemies: 0, enemiesTotal: 0 } });
  assert.ok(!over.includes('<img') && over.includes('&lt;img'));
  assert.match(over, /data-action="restart"/); assert.match(over, /data-action="title"/);
  assert.match(victoryScreen({ stats: { seconds: 61.5 }, best: 61.5, isNew: true }), /1:01\.50[\s\S]*New best!/);
  assert.doesNotMatch(victoryScreen({ stats: { seconds: 70 }, best: 61.5, isNew: false }), /New best/);
  const kb = controlRows('keyboard', { side: true, shoot: true }).map(r => r[1]).join(' ');
  const pad = controlRows('gamepad', { side: true, shoot: true }).map(r => r[1]).join(' ');
  assert.match(kb, /Space/); assert.match(kb, /Esc/); assert.doesNotMatch(kb, /Start/);
  assert.match(pad, /Start/); assert.doesNotMatch(pad, /Space/);
  assert.equal(controlRows('keyboard', { side: false }).some(([l]) => l.startsWith('Jump')), false);
  assert.deepEqual(titleParts('Penguin Ninja: Ice Fortress'), ['Penguin Ninja', 'Ice Fortress']);
  assert.deepEqual(titleParts('Turbo Trigger'), ['Turbo Trigger', '']);
  const spec = { title: 'A "quoted" <b>game</b>', pitch: 'p', view: 'side', modules: [], entities: {} };
  assert.ok(!titleScreen({ spec, device: 'keyboard', art: '' }).includes('<b>'));
  assert.match(pauseScreen({ spec, device: 'keyboard', muted: true }), /Sound: Off/);
});
