import test from 'node:test';
import assert from 'node:assert/strict';
import kit from '../v2/kits/runner/index.js';
import { SAMPLES } from '../v2/kits/runner/samples.js';
import { structural } from '../v2/kits/runner/verify.js';
import { LANES } from '../v2/kits/runner/modes/lanes.js';
import { physics as dashPhysics } from '../v2/kits/runner/modes/dash.js';
import { trainAt } from '../v2/kits/runner/modes/hop.js';
import { composeGame } from '../v2/kits/mods/compose.js';
import { G } from '../v2/kits/runner/world.js';

const valid = c => { const v = kit.validate(c); assert.equal(v.ok, true, JSON.stringify(v.errors)); return v.content; };
const variant = (mode, patch) => valid({ ...structuredClone(SAMPLES[mode]), ...patch });
const run = (game, s, n, input = {}) => { const ev = []; for (let i = 0; i < n && s.status === 'playing'; i++) { game.step(s, typeof input === 'function' ? input(i, s) : input); ev.push(...s.events.map(e => e.name)); } return ev; };
const trial = (content, i = 0, opts = {}) => { const game = kit.createGame(content, { seed: 1 }); return { game, s: game.trialState(i, { speed: opts.speed ?? content.speed.start, time: 0, entry: opts.entry ?? 0 }) }; };

test('every sample validates and the schema is OpenAI strict', () => {
  for (const [mode, sample] of Object.entries(SAMPLES)) assert.equal(valid(sample).mode, mode);
  const walk = (node, path) => {
    assert.ok(!('oneOf' in node || 'anyOf' in node || 'minimum' in node || 'maximum' in node), path);
    if (node.type === 'object') { assert.equal(node.additionalProperties, false, path); assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path); for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}.${k}`); }
    if (node.type === 'array') walk(node.items, `${path}[]`);
  };
  walk(kit.content.schema, '$');
  assert.equal(kit.content.sample, SAMPLES.lanes);
  const { brief, entities } = kit.cast(kit.content.sample);
  assert.equal(brief.player.name, 'Pip'); assert.deepEqual(entities.hero.tags, ['player']);
});

test('validation explains broken rows with stable codes', () => {
  const codes = c => kit.validate(c).errors.map(e => e.code);
  const lanes = structuredClone(SAMPLES.lanes); lanes.chunks[0].rows[0] = 'oo';
  assert.ok(codes(lanes).includes('row_width'));
  const side = structuredClone(SAMPLES.side); side.chunks[0].rows[0] = '##';
  assert.ok(codes(side).includes('side_edge'));
  const climb = structuredClone(SAMPLES.climb); climb.chunks[0].rows = ['..==.....', '.........', '.........', '..==.....'];
  assert.ok(codes(climb).includes('climb_gap'));
  assert.ok(codes({ ...SAMPLES.flap, mode: 'kart' }).includes('mode'));
});

test('the same seed and inputs give the same final state', () => {
  for (const mode of ['lanes', 'hop']) {
    const play = () => { const g = kit.createGame(SAMPLES[mode], { seed: 42 }); const s = g.createState(); run(g, s, 900, i => ({ x: i % 50 === 0 ? 1 : i % 70 === 0 ? -1 : 0, y: i % 90 === 0 ? -1 : 0, a: i % 37 < 3 })); return JSON.stringify(s); };
    assert.equal(play(), play());
    assert.ok(structuredClone(kit.createGame(SAMPLES[mode]).createState()).objs.length > 0);
  }
  // Different seeds deal different chunk orders.
  const order = seed => { const g = kit.createGame(SAMPLES.lanes, { seed }); const s = g.createState(); s.time = 70; for (let i = 0; i < 30; i++) { s.p.z += 60; g.step(s, {}); s.status = 'playing'; } return s.chunkLog.join(); };
  assert.notEqual(order(1), order(2));
});

test('the bot verifies the sample and every chunk in every mode is passable at its max speed', () => {
  const r = kit.verify(kit.content.sample, { seed: 1 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.ok(r.report.bot.seconds >= 60 && r.report.bot.bestDistance >= r.report.threshold);
  assert.ok(r.report.wallMs < 2000, `verify took ${r.report.wallMs} ms`);
  for (const [mode, sample] of Object.entries(SAMPLES)) for (const c of structural(valid(sample))) assert.equal(c.passable, true, `${mode}/${c.id}`);
  // An impossible chunk fails the proof: a gap at the top, then one at the bottom, too close to dive between.
  const bad = variant('flap', { chunks: [{ id: 'drop', tier: 1, spacing: 3, rows: ['....########', '########....'] }, ...SAMPLES.flap.chunks.slice(1)] });
  assert.equal(structural(bad)[0].passable, false);
});

test('lanes: jump low barriers, slide under gates, a second stumble lets the chaser catch you', () => {
  const c = variant('lanes', { chunks: [{ id: 'j', tier: 1, spacing: 10, rows: ['.J.', '...'] }, { id: 's', tier: 1, spacing: 10, rows: ['.S.', '...'] }, { id: 't', tier: 1, spacing: 10, rows: ['T.T', '...'] }] });
  let { game, s } = trial(c, 0, { entry: 1 });
  let ev = run(game, s, 120);
  assert.ok(ev.includes('stumble') && s.p.chaseT > 0, 'standing still trips over a low barrier');
  ({ game, s } = trial(c, 0, { entry: 1 }));
  const low = s.objs.find(o => o.t === 'low');
  ev = run(game, s, 120, (i, st) => ({ a: Math.abs(low.z - st.p.z - 5) < 0.3 }));
  assert.ok(ev.includes('jump') && !ev.includes('stumble'), 'a timed jump clears it');
  ({ game, s } = trial(c, 1, { entry: 1 }));
  run(game, s, 120);
  assert.equal(s.status, 'lost'); assert.match(s.reason, /Signal Gate/);
  ({ game, s } = trial(c, 1, { entry: 1 }));
  const high = s.objs.find(o => o.t === 'high');
  run(game, s, 120, (i, st) => ({ y: Math.abs(high.z - st.p.z - 4) < 0.3 ? 1 : 0 }));
  assert.equal(s.status, 'playing', 'sliding passes under');
  // Switching into a parked train's side is a stumble; twice is caught.
  ({ game, s } = trial(c, 2, { entry: 1 }));
  run(game, s, 60);
  const t = s.objs.find(o => o.t === 'wall');
  while (s.p.z < t.z + 1) game.step(s, {});
  game.step(s, { x: 1 }); assert.equal(s.p.lane, 1); assert.ok(s.p.chaseT > 0);
  for (let i = 0; i < 50; i++) game.step(s, {});
  game.step(s, { x: -1 });
  assert.equal(s.status, 'lost'); assert.match(s.reason, /Caught by Warden Drone/);
});

test('lanes: five lanes, magnet reach and the jetpack high path', () => {
  const c = variant('lanes', { rules: { width: 5, lives: 1, goalDistance: 0, density: 1 }, chunks: SAMPLES.lanes.chunks.map(k => ({ ...k, rows: k.rows.map(r => `.${r}.`) })) });
  const game = kit.createGame(c, { seed: 2 }); const s = game.createState();
  assert.equal(s.p.lane, 2); assert.equal(s.p.x, 0);
  for (let i = 0; i < 4; i++) { game.step(s, { x: 1 }); game.step(s, {}); }
  assert.equal(s.p.lane, 4);
  assert.ok(structural(c).every(k => k.passable), 'every five-lane chunk is passable');
  s.powers.jetpack = 3; game.impl.onPower(s, 'jetpack', G);
  for (let i = 0; i < 40; i++) game.step(s, {});
  assert.ok(s.p.y > 3.5 && s.objs.some(o => o.sky));
});

test('side: variable jump height, coyote time, buffering, gaps and crates', () => {
  const c = variant('side', { chunks: [{ id: 'gap', tier: 1, spacing: 2, rows: ['#', '#', '.', '.', '#'] }, { id: 'crate', tier: 1, spacing: 2, rows: ['#', '#x', '#', '#'] }, { id: 'flat', tier: 1, spacing: 2, rows: ['#', '#', '#', '#'] }] });
  const tap = (() => { const { game, s } = trial(c, 2); let top = 0; for (let i = 0; i < 60; i++) { game.step(s, { a: i < 2 }); top = Math.max(top, s.p.y); } return top; })();
  const held = (() => { const { game, s } = trial(c, 2); let top = 0; for (let i = 0; i < 60; i++) { game.step(s, { a: i < 40 }); top = Math.max(top, s.p.y); } return top; })();
  assert.ok(held - 1 > 2 * (tap - 1), `hold ${held} vs tap ${tap}`);
  // Running off a roof edge still allows a jump for a moment (coyote time).
  let { game, s } = trial(c, 0);
  while (s.p.ground) game.step(s, {});
  game.step(s, {}); game.step(s, { a: true });
  assert.ok(s.p.vy > 10, 'coyote jump');
  // A press just before landing jumps on touchdown (buffer).
  ({ game, s } = trial(c, 2));
  game.step(s, { a: true }); for (let i = 0; i < 4; i++) game.step(s, {});
  while (s.p.vy > -1 || s.p.y > 1.4) game.step(s, { a: false });
  game.step(s, { a: true });
  let jumped = false; for (let i = 0; i < 10; i++) { game.step(s, { a: true }); if (s.events.some(e => e.name === 'jump')) jumped = true; }
  assert.ok(jumped, 'buffered jump');
  // Not jumping a gap falls to death; a crate only slows you.
  ({ game, s } = trial(c, 0)); run(game, s, 300);
  assert.equal(s.status, 'lost'); assert.match(s.reason, /Fell/);
  ({ game, s } = trial(c, 1)); const ev = run(game, s, 200);
  assert.ok(ev.includes('crate') && s.status === 'playing');
});

test('flap: a press flaps against gravity and pipes kill', () => {
  const c = variant('flap', {});
  const { game, s } = trial(c, 0, { entry: 1 });
  game.step(s, { a: true }); assert.ok(s.p.vy > 9);
  for (let i = 0; i < 30; i++) game.step(s, {});
  assert.ok(s.p.vy < 0);
  run(game, s, 600);
  assert.equal(s.status, 'lost');
});

test('climb: auto-bounce, breaking and spring platforms, wraparound, rising camera, shooting', () => {
  const c = variant('climb', { chunks: [{ id: 'a', tier: 1, spacing: 1.6, rows: ['....=....', '....~....', '....s....', '....E....'] }, ...SAMPLES.climb.chunks.slice(1)] });
  const { game, s } = trial(c, 0);
  const ev = run(game, s, 200);
  assert.ok(ev.includes('jump') && ev.includes('break') && ev.includes('spring'));
  assert.ok(s.p.cam > 6, 'the spring launches high');
  const cam = s.p.cam; run(game, s, 30); assert.ok(s.p.cam >= cam, 'camera never drops');
  const w = trial(c, 0).s; w.p.x = 8.9; w.p.vx = 7; game.step(w, { x: 1 }); assert.ok(w.p.x < 1, 'wraps around');
  c.obstacles.find(o => o.char === 'E').speed = 0;
  const g2 = kit.createGame(c), t2 = g2.trialState(0, { speed: 1, time: 0 }); const enemy = t2.objs.find(o => o.t === 'enemy');
  t2.p.x = enemy.cx; t2.p.y = enemy.y - 3; t2.p.vy = 0; t2.p.cam = t2.p.y;
  const shots = []; for (let i = 0; i < 20; i++) { g2.step(t2, { a: i % 4 === 0 }); shots.push(...t2.events.map(e => e.name)); }
  assert.ok(shots.includes('shoot') && shots.includes('defeated'));
});

test('hop: trees block, cars kill, logs carry, trains warn, the eagle takes idlers', () => {
  const c = variant('hop', {});
  const game = kit.createGame(c, { seed: 1 }); let s = game.createState();
  const treeRow = s.objs.find(o => o.t === 'row' && o.kind === 'grass' && o.r > 0 && o.trees.some(Boolean));
  const col = treeRow.trees.findIndex(Boolean);
  Object.assign(s.p, { r: treeRow.r - 1, fr: treeRow.r - 1, tr: treeRow.r - 1, x: col, fx: col, tx: col, maxRow: treeRow.r - 1, cam: treeRow.r - 3 });
  const ev = run(game, s, 2, i => ({ y: i === 0 ? -1 : 0 }));
  assert.ok(ev.includes('bump') && s.p.r === treeRow.r - 1);
  const road = s.objs.find(o => o.t === 'row' && o.kind === 'road');
  Object.assign(s.p, { r: road.r, hopping: false, cam: road.r - 2, idleT: 0 });
  run(game, s, 600);
  assert.equal(s.status, 'lost'); assert.match(s.reason, /Flattened/);
  s = game.createState();
  const river = s.objs.find(o => o.t === 'row' && o.kind === 'river');
  Object.assign(s.p, { r: river.r, hopping: false, cam: river.r - 2, idleT: 0, x: river.off + river.dir * river.v * s.time });
  const x0 = s.p.x; game.step(s, {}); game.step(s, {});
  assert.ok(Math.abs(s.p.x - x0) > 0.01, 'the log carries you');
  const rail = { off: 0, period: 7, pass: 0.8, dir: 1, cols: 9, size: 12 };
  assert.equal(trainAt(rail, 6.5).warn, true); assert.notEqual(trainAt(rail, 0.2).front, null);
  s = game.createState(); run(game, s, 60 * 12);
  assert.match(s.reason, /Snatched by the Hawk/);
});

test('rhythm-dash: a jump lasts one beat, portals flip gravity, the goal wins', () => {
  const c = variant('rhythm-dash', {});
  const ph = dashPhysics(c), game = kit.createGame(c), s = game.createState();
  let air = 0; game.step(s, { a: true }); while (!s.p.ground) { game.step(s, {}); air++; }
  assert.ok(Math.abs(air / 60 - ph.beat) < 0.05, `airtime ${air / 60} vs beat ${ph.beat}`);
  const portal = game.level.objs.find(o => o.t === 'portal' && o.kind === 'gravity');
  s.p.x = portal.x - 0.1; s.p.y = 0.45; s.p.ground = true; game.step(s, {});
  assert.equal(s.p.grav, -1);
  const w = game.createState(); w.p.x = game.level.end - 0.05; game.step(w, {});
  assert.equal(w.status, 'won');
});

test('near misses, missions, power-ups, lives, a finish line and density are real', () => {
  // Near miss: clearing a barrier by a hair awards points and slows time.
  const c = variant('lanes', { chunks: [{ id: 'j', tier: 1, spacing: 10, rows: ['.J.', '...'] }, ...SAMPLES.lanes.chunks.slice(1)] });
  let { game, s } = trial(c, 0, { entry: 1 });
  const low = s.objs.find(o => o.t === 'low');
  let ev = []; for (let i = 0; i < 200 && s.status === 'playing'; i++) { const d = low.z - s.p.z; game.step(s, { a: d < 2.1 && d > 1.85 }); ev.push(...s.events.map(e => e.name)); }
  assert.ok(ev.includes('near_miss') && s.stats.near_misses === 1, ev.join());
  // Missions complete and pay out.
  const g = kit.createGame(SAMPLES.lanes), m = g.createState();
  m.stats.coins = 40; g.step(m, {});
  assert.ok(m.events.some(e => e.name === 'mission' && /bolts/.test(e.label)) && m.missions[0].done);
  // The magnet reaches coins in neighbouring lanes.
  const coin = m.objs.find(o => o.t === 'coin' && o.lane !== m.p.lane);
  m.powers.magnet = 5; m.p.z = coin.z - 2; g.step(m, {});
  assert.notEqual(m.gone[coin.id], undefined);
  // Lives: a crash spends a life and play goes on.
  const lc = variant('flap', { rules: { width: 0, lives: 3, goalDistance: 0, density: 1 } });
  const lg = kit.createGame(lc), ls = lg.createState();
  ev = run(lg, ls, 400);
  assert.ok(ev.includes('life_lost') && ls.lives < 3);
  // Finish line: goalDistance wins.
  const fc = variant('lanes', { rules: { width: 3, lives: 1, goalDistance: 100, density: 1 } });
  const fg = kit.createGame(fc), fs = fg.createState();
  for (let i = 0; i < 2000 && fs.status === 'playing'; i++) { fs.invuln = 1; fg.step(fs, {}); }
  assert.equal(fs.status, 'won'); assert.ok(fs.distance >= 100 && fs.distance < 101);
  assert.equal(kit.createGame(SAMPLES.lanes).content.rules.goalDistance, 0, 'the sample is endless');
  // Density changes the space between chunks.
  const gap = d => { const g = kit.createGame(variant('lanes', { rules: { width: 3, lives: 1, goalDistance: 0, density: d } })); const st = g.createState(); return Math.min(...st.objs.map(o => o.z)); };
  assert.ok(gap(0.5) > gap(2));
});

test('the world adapter lets a weapon mod shoot lanes barriers', () => {
  const c = variant('lanes', { chunks: [{ id: 'j', tier: 1, spacing: 10, rows: ['.J.', '...'] }, ...SAMPLES.lanes.chunks.slice(1)] });
  assert.ok(kit.world.capabilities.includes('enemies') && !kit.world.buttons.includes('b'));
  const game = composeGame(kit, c, { mods: { weapon: { kind: 'projectile', name: 'zapper', ammoFrom: 'unlimited', reloadOn: 'power_up', ammo: 5, effect: 'defeat', color: '#7fe3ff' } } });
  const s = game.createState();
  const ev = run(game, s, 600, i => ({ b: i > 60 && i % 10 === 0 }));
  assert.ok(ev.includes('shoot') && ev.includes('defeated'));
  const w = kit.world.adapter(game);
  assert.deepEqual(w.player(s).facing, { x: 0, y: 1 });
});

test('the renderer draws every mode headless and exposes render.view', () => {
  const ctx = new Proxy({}, { get: (t, k) => k in t ? t[k] : k === 'measureText' ? () => ({ width: 40 }) : ['createLinearGradient', 'createRadialGradient'].includes(k) ? () => ({ addColorStop() {} }) : () => {}, set: (t, k, v) => { t[k] = v; return true; } });
  for (const sample of Object.values(SAMPLES)) {
    const game = kit.createGame(sample), render = kit.createRenderer(game, { art: {} }), s = game.createState();
    for (let i = 0; i < 40; i++) { game.step(s, { a: i % 9 === 0 }); render(ctx, s, { cssWidth: 800, cssHeight: 450, dt: 1 / 60, events: s.events, reducedMotion: i % 2 === 0, paused: false, attract: i < 5 }); }
    assert.equal(typeof render.view.X(1), 'number');
    assert.ok(Number.isFinite(render.view.Y(1)) && render.view.s > 0);
  }
  assert.ok(kit.stats(kit.createGame(SAMPLES.lanes).createState()).length >= 3);
  assert.match(kit.goal(SAMPLES.hop), /Hawk/);
});
