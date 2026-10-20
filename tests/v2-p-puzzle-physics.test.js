import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import paddle from '../v2/primitives/gameplay/paddle.js';
import launcher from '../v2/primitives/gameplay/launcher.js';
import destructible from '../v2/primitives/gameplay/destructible.js';
import { centerOf } from '../v2/primitives/gameplay/puzzle-lib-body.js';

const PRIMS = [testSpace, paddle, launcher, destructible];
const base = (spaceWith, systems, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'phys', title: 'Phys', seed: 5,
  spaces: [{ id: 'f', use: 'engine.space.test', with: spaceWith }],
  systems,
  content: { archetypes: [
    { id: 'pad', components: { body: { size: [2.2, 0.4, 1] } } },
    { id: 'ball', components: { body: { size: [0.36, 0.36, 1] } } },
    { id: 'bird', kind: 'projectile', components: { body: { size: [0.8, 0.8, 1] } } },
    { id: 'shard', components: { body: { size: [0.2, 0.2, 1] } } },
  ] },
  ...extra,
});
const bricks = Array.from({ length: 13 }, (_, x) => [x, 17, 0]);
const breakout = (w = {}) => base({ size: [13, 20, 1], solid: bricks }, [{ use: 'gameplay.paddle', with: { ball: 'ball', motion: 'self', breakCells: true, bounds: [0, 13], ...w } }], { player: { archetype: 'pad', space: 'f', at: [5.4, 2, 0] } });
const pst = rt => rt.state.prim['gameplay.paddle'];
const follow = rt => { const s = pst(rt), b = s.balls[0] && rt.entity(s.balls[0]), api = rt.space('f'); if (!b) return {}; const d = centerOf(api, b)[0] - centerOf(api, rt.player())[0]; return { axes: { move: [Math.abs(d) < 0.2 ? 0 : Math.sign(d), 0] } }; };

test('paddle: serve, launch, break cells and return balls with a tracking paddle', () => {
  const { rt, checked } = compile(breakout(), { primitives: PRIMS });
  assert.ok(checked.ok);
  rt.step();
  assert.ok(pst(rt).held, 'ball is served onto the paddle');
  rt.step({ actions: { launch: true } });
  assert.equal(rt.state.counts.ball_launched, 1);
  for (let i = 0; i < 500; i++) rt.step(follow(rt));
  assert.ok(rt.state.counts['cell_broken:solid'] >= 1, 'bricks broke');
  assert.ok(rt.state.counts.paddle_hit >= 1, 'the paddle returned the ball');
  assert.ok(!rt.state.counts.ball_lost);
  assert.ok(rt.state.vars['paddle.speed'] > 10, 'speed ramps with broken bricks and time');
});

test('paddle: bounce angle comes from where the ball hits (off 0.5 -> 0.525 rad)', () => {
  const { rt } = compile(breakout(), { primitives: PRIMS });
  rt.step();
  const s = pst(rt), b = rt.entity(s.balls[0]), api = rt.space('f');
  s.held = null;
  api.setPos(b, [7.05 - 0.18, 2.4 + 0.18 + 0.05 - 0.18, 0], rt);
  b.components.body.vel = [0, -10];
  rt.step();
  const v = b.components.body.vel, ang = Math.atan2(v[0], v[1]);
  assert.equal(rt.state.counts.paddle_hit, 1);
  assert.ok(Math.abs(ang - 0.5 * 1.05) < 0.02, `angle ${ang}`);
  assert.ok(Math.abs(Math.hypot(...v) - 10) < 0.01);
});

test('paddle: lost balls re-serve until lives run out, then onNoLives', () => {
  const { rt } = compile(breakout({ lives: 2 }), { primitives: PRIMS });
  rt.step(); rt.step({ actions: { launch: true } });
  for (let i = 0; i < 1500 && rt.state.status === 'playing'; i++) { if (pst(rt).held) rt.step({ actions: { launch: true } }); else rt.step({ axes: { move: [-1, 0] } }); if (centerOf(rt.space('f'), rt.player())[0] < 1.2) rt.space('f').setPos(rt.player(), [10.5, 2, 0], rt); }
  assert.equal(rt.state.counts.ball_lost, 2);
  assert.equal(rt.state.status, 'lost');
});

test('paddle: physics-space contacts steer the ball; catch holds it; multiball splits', () => {
  const { rt } = compile(breakout({ motion: 'space', breakCells: false, catch: false }), { primitives: PRIMS });
  rt.step(); rt.step({ actions: { launch: true } });
  const id = pst(rt).balls[0];
  rt.emit('contact', { a: id, b: 'player', impulse: 1, begin: true, normal: [0, 1], at: [6, 2] });
  assert.equal(rt.state.counts.paddle_hit, 1);
  rt.run([{ do: 'multiball', count: 2 }]);
  assert.equal(pst(rt).balls.length, 3);
  rt.run([{ do: 'paddle_mode', mode: 'catch', sec: 5 }]);
  rt.emit('contact', { a: id, b: 'player', impulse: 1, begin: true });
  assert.equal(pst(rt).held?.id, id);
});

test('paddle: deterministic replay', () => {
  const play = () => { const { rt } = compile(breakout(), { primitives: PRIMS }); rt.step(); rt.step({ actions: { launch: true } }); for (let i = 0; i < 200; i++) rt.step(follow(rt)); return rt.snapshot(); };
  assert.deepEqual(play(), play());
});

// ---- launcher + destructible ----
const sling = (w = {}, entities = [], dw = {}) => {
  const d = base({ size: [40, 20, 1], gravity: 10 }, [
    { use: 'gameplay.launcher', with: { mode: 'sling', origin: [2, 3], forward: [1, 0], aim: [-0.5, 1.4], speed: 22, shots: [{ archetype: 'bird', count: 2 }], motion: 'self', ...w } },
    { use: 'gameplay.destructible', with: { ...dw } },
  ]);
  d.content.archetypes.push({ id: 'glass_block', components: { body: { size: [1, 2, 1] }, destructible: { material: 'glass' } } }, { id: 'tnt_block', components: { body: { size: [1, 1, 1] }, destructible: { material: 'tnt' } } }, { id: 'peg', components: { body: { size: [0.4, 0.4, 1], static: true }, destructible: { material: 'peg' } } });
  d.systems.push(...entities);
  return d;
};
const lst = rt => rt.state.prim['gameplay.launcher'];

test('launcher + destructible: a sling shot breaks glass by impact impulse and the turn ends', () => {
  const { rt, checked } = compile(sling(), { primitives: PRIMS });
  assert.ok(checked.ok);
  rt.spawn('glass_block', { space: 'f', at: [15, 0, 0] });
  rt.step({ actions: { aim: 0.05, power: 0.8 } });
  rt.step({ actions: { fire: true } });
  assert.equal(rt.state.counts.launched, 1);
  assert.equal(rt.state.vars['launcher.shots'], 1);
  rt.step({ actions: { fire: true } });
  assert.equal(rt.state.counts.launched, 1, 'one projectile per turn');
  for (let i = 0; i < 700 && !rt.state.counts.shot_end; i++) rt.step();
  assert.equal(rt.state.counts['destroyed:glass'], 1);
  assert.equal(rt.state.vars.score, 300);
  assert.equal(rt.state.counts.shot_end, 1);
  assert.equal(lst(rt).phase, 'aim');
  assert.ok(rt.availableOptions().length >= 9, 'aim/power fan for solvers');
});

test('launcher: pull sets aim and power; split and bomb abilities', () => {
  const { rt } = compile(sling({ shots: [{ archetype: 'bird', ability: 'split' }, { archetype: 'bird', ability: 'bomb' }] }), { primitives: PRIMS });
  rt.step({ actions: { pull: [-1.9 * Math.cos(0.4), -1.9 * Math.sin(0.4)] } });
  assert.ok(Math.abs(lst(rt).aim - 0.4) < 1e-9);
  assert.ok(Math.abs(lst(rt).power - 1) < 1e-9);
  rt.step({ actions: { fire: true } }); run(rt, 10);
  rt.step({ actions: { ability: true } });
  assert.equal(lst(rt).active.length, 3, 'split into three');
  for (let i = 0; i < 700 && rt.state.counts.shot_end !== 1; i++) rt.step();
  rt.step({ actions: { fire: true } }); run(rt, 10);
  rt.step({ actions: { ability: true } });
  assert.equal(rt.state.counts['ability_used:bomb'], 1);
  assert.equal(rt.state.counts.explosion, 1);
  for (let i = 0; i < 700 && rt.state.counts.shot_end !== 2; i++) rt.step();
  assert.equal(rt.state.counts.shots_empty, 1);
});

test('destructible: impulse floor, projectile bonus, TNT chain and lit pegs', () => {
  const { rt } = compile(sling({}, [], { materials: { glass: { hp: 1.8, score: 300 }, tnt: { hp: 2.2, score: 500, explode: { r: 3.4, strength: 13 } }, peg: { hp: 1, score: 10, lit: true } } }), { primitives: PRIMS });
  rt.step();
  const g = rt.spawn('glass_block', { space: 'f', at: [20, 0, 0] });
  rt.emit('contact', { a: g.id, b: null, impulse: 0.8 });
  assert.ok(!rt.state.counts.damaged, 'below the floor');
  rt.emit('contact', { a: g.id, b: null, impulse: 1.9 });
  assert.ok(Math.abs(g.components.destructible.hp - (1.8 * Math.SQRT2 - 1)) < 1e-9);
  const t1 = rt.spawn('tnt_block', { space: 'f', at: [30, 0, 0] }), t2 = rt.spawn('tnt_block', { space: 'f', at: [31.5, 0, 0] });
  rt.run([{ do: 'break', who: t1.id }]);
  assert.equal(rt.state.counts['destroyed:tnt'], 2, 'the blast set off the second TNT');
  assert.equal(rt.state.counts.explosion, 2);
  assert.ok(!rt.entity(t2.id));
  const p = rt.spawn('peg', { space: 'f', at: [10, 10, 0] });
  rt.emit('contact', { a: 'x', b: p.id, impulse: 5 });
  assert.equal(rt.state.counts['lit:peg'], 1);
  assert.ok(rt.entity(p.id), 'lit pegs wait for the end of the shot');
  rt.emit('shot_end', {});
  assert.ok(!rt.entity(p.id));
});

test('launcher + destructible: deterministic replay', () => {
  const play = () => { const { rt } = compile(sling(), { primitives: PRIMS }); rt.spawn('glass_block', { space: 'f', at: [15, 0, 0] }); rt.step({ actions: { aim: 0.05, power: 0.8 } }); rt.step({ actions: { fire: true } }); run(rt, 300); return rt.snapshot(); };
  assert.deepEqual(play(), play());
});

test('physics primitives: preflight rejects bad configs with stable codes', () => {
  const registry = new Registry(PRIMS), logic = buildLogic(registry, Logic);
  const codes = d => preflight(d, registry, logic).errors.map(e => e.code);
  assert.ok(codes(breakout({ up: [0, 2] })).includes('paddle_up'));
  assert.ok(codes(breakout({ bounds: [5, 1] })).includes('paddle_bounds'));
  assert.ok(codes(breakout({ motion: 'space', breakCells: true })).includes('paddle_break_cells'));
  const noBall = breakout(); delete noBall.systems[0].with.ball;
  assert.ok(codes(noBall).includes('param_missing'));
  assert.ok(codes(sling({ forward: [1, 1] })).includes('launcher_forward'));
  assert.ok(codes(sling({ aim: [1, -1] })).includes('launcher_aim'));
  assert.ok(codes(sling({ shots: [{ archetype: 'nope' }] })).includes('ref_unknown'));
  assert.ok(codes(sling({}, [], { materials: { mud: { hp: -1 } } })).includes('material_invalid'));
});
