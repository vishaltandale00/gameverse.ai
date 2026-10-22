import test from 'node:test';
import assert from 'node:assert/strict';
import kit from '../v2/kits/physics/index.js';
import { MODE_IMPL } from '../v2/kits/physics/game.js';
import { createWorld, addBody, stepWorld, addRevoluteJoint, addDistanceJoint, findBody } from '../v2/kits/physics/physics.js';
import { unreachableBricks } from '../v2/kits/physics/content.js';
import * as peggle from '../v2/kits/physics/modes/peggle.js';
import * as slingshot from '../v2/kits/physics/modes/slingshot.js';
import * as pinball from '../v2/kits/physics/modes/pinball.js';

const sample = () => structuredClone(kit.content.sample);
const N = { x: 0, y: 0, a: false, b: false };
const content = kit.validate(kit.content.sample).content;
function playing(c, level, seed = 1) {
  const game = kit.createGame(c, { seed });
  const S = game.createState();
  game.startLevel(S, level);
  S.phase = 'play'; S.events = [];
  return { game, S };
}
const run = (game, S, frames, inp = N) => { const events = []; for (let i = 0; i < frames && S.status === 'playing'; i++) { game.step(S, typeof inp === 'function' ? inp(S, i) : inp); events.push(...S.events); } return events; };

test('the sample validates and the schema is strict-mode shaped', () => {
  const r = kit.validate(kit.content.sample);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.content.levels.map(l => l.mode), ['breakout', 'peggle', 'slingshot', 'pinball']);
  const walk = (node, path) => {
    assert.ok(!('oneOf' in node) && !('anyOf' in node), path);
    for (const k of ['minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength']) assert.ok(!(k in node), `${path}.${k}`);
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, path);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path);
      for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}.${k}`);
    }
    if (node.type === 'array') walk(node.items, `${path}[]`);
  };
  walk(kit.content.schema, '$');
  const cast = kit.cast(r.content);
  assert.deepEqual(Object.keys(cast.brief).sort(), ['enemy', 'goal', 'hazard', 'pickup', 'player']);
  assert.ok(Object.values(cast.entities).every(e => e.tags.length === 1));
});

test('validation reports repairable errors', () => {
  const c = sample();
  c.levels[0].breakout = [];
  c.levels[1].mode = 'golf';
  c.levels[3].pinball[0].missions = [{ name: 'Lock it', kind: 'lock', count: 1 }];
  c.levels[3].pinball[0].lock = 0;
  const r = kit.validate(c);
  assert.equal(r.ok, false);
  const codes = r.errors.map(e => e.code);
  for (const code of ['missing_mode_settings', 'bad_mode', 'mission_needs_feature']) assert.ok(codes.includes(code), code);
  assert.ok(r.errors.every(e => e.path && e.message));
  assert.deepEqual(unreachableBricks(['mmm', 'mnm', 'mmm']), [[1, 1]]);
  assert.deepEqual(unreachableBricks(['mmm', 'mnm', 'm.m']), []);
});

test('the same seed and inputs give the same final state in every mode', () => {
  const play = () => {
    const game = kit.createGame(content, { seed: 9 });
    const S = game.createState();
    const out = [];
    for (let level = 0; level < 4; level++) {
      game.startLevel(S, level);
      run(game, S, 420, (s, i) => s.phase === 'play' ? MODE_IMPL[s.mode].bot(s) : { ...N, a: i % 30 === 5 });
      out.push(JSON.stringify(S));
    }
    return out;
  };
  const a = play(), b = play();
  a.forEach((s, i) => assert.equal(s, b[i], `level ${i} diverged`));
  // State is plain JSON: a structuredClone continues identically.
  const game = kit.createGame(content, { seed: 4 });
  const S = game.createState(); game.startLevel(S, 3); run(game, S, 200, { ...N, y: 1 });
  const C = structuredClone(S);
  run(game, S, 120, { ...N, a: true }); run(game, C, 120, { ...N, a: true });
  assert.equal(JSON.stringify(S), JSON.stringify(C));
});

test('the engine stacks, sleeps, sweeps bullets, and holds joints', () => {
  const w = createWorld({ gy: 10 });
  addBody(w, { shape: 'seg', x1: -10, y1: 0, x2: 10, y2: 0, mu: 0.8 });
  const boxes = [0, 1, 2, 3, 4].map(i => addBody(w, { shape: 'box', w: 1, h: 0.5, x: 0, y: -0.25 - i * 0.5, mu: 0.7 }));
  for (let i = 0; i < 300; i++) stepWorld(w, 1 / 60);
  assert.ok(Math.abs(boxes[4].x) < 0.1 && Math.abs(boxes[4].y + 2.25) < 0.05, 'the stack stands');
  assert.ok(boxes.every(b => b.sleeping), 'a settled stack sleeps');
  const g = createWorld({ gy: 0 });
  addBody(g, { shape: 'seg', x1: 5, y1: -5, x2: 5, y2: 5, e: 1, mu: 0 });
  const ball = addBody(g, { shape: 'circle', r: 0.2, x: 0, y: 0, vx: 400, bullet: true, e: 1, mu: 0 });
  for (let i = 0; i < 10; i++) stepWorld(g, 1 / 60);
  assert.ok(ball.x < 5 && ball.vx < 0, 'a 400 u/s ball bounces off a thin wall instead of tunneling');
  const j = createWorld({ gy: 10 });
  const fl = addBody(j, { shape: 'poly', verts: [[0, -0.2], [2, -0.08], [2, 0.08], [0, 0.2]], x: 0, y: 0, density: 4, gs: 0 });
  addRevoluteJoint(j, { b: fl.id, x: 0, y: 0, motor: true, speed: 20, maxTorque: 1000, limit: true, lower: -0.5, upper: 0.5 });
  const bob = addBody(j, { shape: 'circle', r: 0.3, x: 3, y: -6 });
  addDistanceJoint(j, { a: 0, la: [0, -6], b: bob.id, length: 3, rope: true });
  for (let i = 0; i < 60; i++) stepWorld(j, 1 / 60);
  assert.ok(Math.abs(fl.a - 0.5) < 0.02, 'the motor drives the flipper to its limit');
  assert.ok(Math.hypot(bob.x, bob.y + 6) < 3.05, 'the rope holds');
});

test('breakout: paddle angle control, hard, metal and explosive bricks, capsules', () => {
  const { game, S } = playing(content, 0);
  const m = S.m, paddle = findBody(S.world, m.paddle);
  run(game, S, 1, { ...N, a: true });
  const ball = findBody(S.world, m.balls[0]);
  // Drop the ball onto the paddle's right edge: it leaves up and to the right.
  Object.assign(ball, { x: paddle.x + m.pw * 0.42, y: paddle.y - 1.2, vx: 0, vy: 8 });
  run(game, S, 12);
  assert.ok(ball.vy < 0 && ball.vx > 2, `edge hit steers right (vx ${ball.vx.toFixed(2)})`);
  Object.assign(ball, { x: paddle.x - m.pw * 0.42, y: paddle.y - 1.2, vx: 0, vy: 8 });
  run(game, S, 12);
  assert.ok(ball.vy < 0 && ball.vx < -2, 'left edge hit steers left');
  const brick = kind => S.world.bodies.find(b => b.tag === 'brick' && !b.dead && b.data.kind === kind);
  const hitAt = b => { Object.assign(ball, { x: b.x, y: b.y + 0.9, vx: 0, vy: -10 }); return run(game, S, 8); };
  const hard = brick('2');
  hitAt(hard); assert.ok(!hard.dead && hard.data.hp === 1, 'a hard brick survives one hit');
  hitAt(hard); assert.ok(hard.dead, 'and breaks on the second');
  const metal = brick('m'); hitAt(metal); assert.ok(!metal.dead, 'metal is unbreakable');
  const boom = brick('x'), before = S.world.bodies.filter(b => b.tag === 'brick').length;
  const ev = hitAt(boom);
  assert.ok(ev.some(e => e.name === 'explode'));
  assert.ok(before - S.world.bodies.filter(b => b.tag === 'brick').length >= 4, 'explosive takes its neighbours');
  // Capsules: wide widens the paddle, multiball splits the ball.
  m.capsules.push({ kind: 'wide', x: paddle.x, y: paddle.y - 0.3, t: 0 }, { kind: 'multiball', x: paddle.x, y: paddle.y - 0.3, t: 0 });
  const got = run(game, S, 3);
  assert.ok(got.some(e => e.name === 'collect') && m.pw > 3, 'wide paddle');
  assert.ok(m.balls.length >= 3, 'multiball');
});

test('breakout: losing every ball costs a life and serves a new one; the narrow paddle is narrower', () => {
  const { game, S } = playing(content, 0);
  run(game, S, 1, { ...N, a: true });
  const ball = findBody(S.world, S.m.balls[0]);
  Object.assign(ball, { y: S.m.h - 0.5, vy: 12, vx: 0 });
  const lives = S.lives, ev = run(game, S, 30);
  assert.equal(S.lives, lives - 1);
  assert.ok(ev.some(e => e.name === 'hurt') && S.m.held, 'a new ball waits on the paddle');
  const c = sample(); c.levels[0].breakout[0].paddle = 'narrow';
  assert.ok(playing(kit.validate(c).content, 0).S.m.pw < S.m.pw);
});

test('peggle: lit oranges count down, pop after the shot, and the last one starts fever', () => {
  const { game, S } = playing(content, 1);
  const m = S.m, oranges = S.world.bodies.filter(b => b.data.kind === 'orange');
  assert.equal(oranges.length, m.total);
  // Aim the guide at an orange peg and shoot.
  const target = oranges.map(o => ({ o, aims: [] })).find(t => { for (let k = -140; k <= 140; k++) { const g = peggle.guide(S, k / 100); if (g.id === t.o.id) t.aims.push(k / 100); } return t.aims.length; });
  assert.ok(target, 'some orange peg is in direct sight');
  peggle.fire(S, target.aims[Math.floor(target.aims.length / 2)]);
  const ev = run(game, S, 60 * 12, () => N);
  assert.ok(ev.some(e => e.name === 'hit' && e.kind === 'orange'));
  assert.ok(m.orangeLeft < m.total);
  assert.ok(ev.some(e => e.name === 'pop'), 'lit pegs pop after the shot');
  assert.ok(target.o.dead, 'the hit orange is cleared');
  assert.equal(peggle.multiplierFor(10, 25), 2);
  assert.equal(peggle.multiplierFor(22, 25), 10);
  // Leave one orange, light it: Extreme Fever with bonus slots.
  const left = S.world.bodies.filter(b => b.data?.kind === 'orange' && !b.data.lit);
  for (const p of left.slice(1)) peggle.lightPeg(S, p);
  S.m.phase = 'shot'; S.m.ballIds = [];
  peggle.lightPeg(S, left[0]);
  assert.ok(m.fever && S.world.bodies.some(b => b.tag === 'slot'));
});

test('peggle: the bucket returns the ball as a free ball; bigger boards are bigger', () => {
  const { game, S } = playing(content, 1);
  const m = S.m;
  peggle.fire(S, 0);
  const ball = findBody(S.world, m.ballIds[0]);
  Object.assign(ball, { x: m.bucket.x, y: m.H - 1.1, vx: 0, vy: 2 });
  const balls = m.balls, ev = run(game, S, 20);
  assert.ok(ev.some(e => e.name === 'collect' && e.kind === 'free_ball'));
  assert.equal(m.balls, balls + 1);
  const c = sample(); c.levels[1].peggle[0].board = 'huge';
  const big = playing(kit.validate(c).content, 1).S;
  assert.ok(big.m.W > m.W && big.m.H > m.H);
});

test('slingshot: impacts damage by impulse, foes fall, stars at the end, failure retries', () => {
  const { game, S } = playing(content, 2);
  const m = S.m;
  assert.ok(S.world.bodies.filter(b => b.type === 'dynamic').every(b => b.sleeping), 'the fort settles before play');
  const t = S.world.bodies.find(b => b.tag === 'target');
  const [low] = slingshot.aimAt(t.x, t.y, 1, m.speedMax);
  slingshot.fire(S, low, 1);
  const ev = run(game, S, 60 * 10, () => N);
  assert.ok(ev.some(e => e.name === 'impact'));
  assert.ok(ev.some(e => e.name === 'break' || e.name === 'crack'), 'blocks take damage');
  assert.ok(ev.some(e => e.name === 'defeated'), 'a direct hit defeats a foe');
  // Finish them: the level clears with stars.
  for (const f of S.world.bodies.filter(b => b.tag === 'target' && !b.dead)) slingshot.damage(S, f, 99, 'test');
  const end = run(game, S, 200);
  assert.ok(end.some(e => e.name === 'stars') && m.stars >= 1 && m.stars <= 3);
  // Out of shots with foes standing: a life is lost and the level restarts.
  const g2 = playing(content, 2);
  g2.S.m.queue = ['normal'];
  slingshot.fire(g2.S, -0.3, 0.3);
  const lives = g2.S.lives, fail = run(g2.game, g2.S, 60 * 12, () => N);
  assert.equal(g2.S.lives, lives - 1);
  assert.ok(fail.some(e => e.name === 'hurt'));
  run(g2.game, g2.S, 200);
  assert.equal(g2.S.attempt, 1, 'the level restarts');
});

test('slingshot: abilities, TNT and far-reaching levels', () => {
  const { game, S } = playing(content, 2);
  S.m.queue = ['split', 'boost', 'bomb'];
  slingshot.fire(S, 0.6, 0.8); run(game, S, 20); run(game, S, 1, { ...N, a: true });
  assert.equal(S.m.active.length, 3, 'split makes three');
  const tnt = S.world.bodies.find(b => b.data?.material === 'tnt');
  slingshot.damage(S, tnt, 99, 'test');
  assert.ok(S.events.some(e => e.name === 'explode'));
  const c = sample();
  for (const b of c.levels[2].slingshot[0].blocks) b.x += 80;
  for (const t of c.levels[2].slingshot[0].targets) t.x += 80;
  const far = playing(kit.validate(c).content, 2).S;
  assert.ok(far.m.speedMax > S.m.speedMax, 'the slingshot is stronger for far forts');
  const t = far.world.bodies.find(b => b.tag === 'target');
  assert.ok(slingshot.aimAt(t.x, t.y, 1, far.m.speedMax).length === 2, 'far foes stay in range');
});

test('pinball: plunger, flippers, bumpers, drains, tilt and tall tables', () => {
  const { game, S } = playing(content, 3);
  const m = S.m;
  run(game, S, 50, { ...N, y: 1 });
  const ev = run(game, S, 90);
  assert.ok(ev.some(e => e.name === 'launch'));
  assert.equal(m.lane, null, 'the ball left the plunger lane');
  const left = findBody(S.world, m.flippers[0].body), rest = left.a;
  run(game, S, 8, { ...N, a: true });
  assert.ok(left.a < rest - 0.6, 'the left flipper swings up');
  const ball = findBody(S.world, m.balls[0]), bumper = S.world.bodies.find(b => b.tag === 'bumper');
  Object.assign(ball, { x: bumper.x, y: bumper.y + 1.2, vx: 0, vy: -6 });
  const kick = run(game, S, 20);
  assert.ok(kick.some(e => e.name === 'bumper') && m.bumperHits >= 1);
  // Drain after ball save: a life is lost and a new ball is served.
  m.saveT = 0;
  for (const id of m.balls) Object.assign(findBody(S.world, id), { x: 5.65, y: 20.4, vx: 0, vy: 10 });
  const lives = S.lives, drain = run(game, S, 10);
  assert.ok(drain.some(e => e.name === 'drain'));
  assert.equal(S.lives, lives - 1);
  assert.ok(m.lane, 'next ball in the lane');
  // Nudging too often tilts.
  for (let i = 0; i < 4; i++) { run(game, S, 1, { ...N, y: -1 }); run(game, S, 1); }
  assert.ok(m.tilted);
  const c = sample(); Object.assign(c.levels[3].pinball[0], { size: 'tall', slope: 'steep' });
  const tall = playing(kit.validate(c).content, 3).S;
  assert.ok(tall.m.H > m.H && tall.world.gy > S.world.gy);
  assert.ok(tall.m.pivots[0][1] > m.pivots[0][1]);
  assert.equal(pinball.PRESETS.classic.ramps.length, 2);
});

test('the renderer draws every mode and exposes its view; the world adapter reaches each mode', () => {
  const grad = { addColorStop() {} };
  const ctx = new Proxy({ canvas: { width: 900, height: 600 } }, { get: (t, k) => k in t ? t[k] : /Gradient/.test(k) ? () => grad : k === 'measureText' ? () => ({ width: 10 }) : () => {}, set: (t, k, v) => { t[k] = v; return true; } });
  const game = kit.createGame(content, { seed: 2 });
  const render = kit.createRenderer(game, { art: {} });
  const world = kit.world.adapter(game);
  const S = game.createState();
  for (let level = 0; level < 4; level++) {
    game.startLevel(S, level);
    for (let i = 0; i < 200; i++) { game.step(S, S.phase === 'play' ? MODE_IMPL[S.mode].bot(S) : { ...N, a: i === 5 }); if (i % 20 === 0) render(ctx, S, { cssWidth: 900, cssHeight: 600, dt: 1 / 60, events: S.events, reducedMotion: i % 40 === 0 }); }
    const v = render.view;
    assert.ok(v && Number.isFinite(v.X(1)) && Number.isFinite(v.Y(1)) && v.s > 0, `view for level ${level}`);
    const foes = world.enemies(S);
    assert.ok(foes.length > 0, `enemies in ${S.mode}`);
    const p = world.player(S);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.facing.y));
    const before = foes.length;
    world.defeat(S, foes.find(f => f.hittable).id, { by: 'test' });
    assert.ok(world.enemies(S).length < before || S.mode === 'peggle', `defeat works in ${S.mode}`);
  }
  assert.deepEqual(kit.world.buttons, ['a']);
});

test('verify proves the sample playable within budget', () => {
  // A generous budget: this test checks what verify proves, not machine speed (other work may be running).
  const r = kit.verify(kit.content.sample, { seed: 1, budgetMs: 10000 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.report.levels.length, 4);
  assert.ok(r.report.proven.length === 4);
  const [bo, pg, sl, pb] = r.report.levels;
  assert.ok(bo.cleared && bo.metrics.seconds > 0);
  assert.equal(pg.metrics.covered, pg.metrics.oranges);
  assert.ok(sl.cleared && sl.metrics.shotsUsed <= sl.metrics.shots);
  assert.equal(pb.metrics.stuck, 0);
  assert.ok(r.report.ms < 3000);
  // A sealed brick and an unwinnable fort fail.
  const c = sample();
  c.levels[2].slingshot[0].shots = ['normal'];
  c.levels[2].slingshot[0].targets.push({ x: 40, y: 0, size: 'large', armor: 'helmet' }, { x: 12, y: 0, size: 'small', armor: 'none' });
  const bad = kit.verify({ ...c, levels: [c.levels[2]] }, { seed: 1, budgetMs: 600 });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some(p => p.code === 'slingshot_unsolved'));
});
