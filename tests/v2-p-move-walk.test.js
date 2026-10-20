// gameplay.move.walk and the shared move core (intent, moveTo following, mode
// arbitration, macro travel options), exercised on engine.space.test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { doc, make, floor, run, move, testSpace } from './v2-p-move-helpers.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';

const walkSys = (w = {}) => [{ use: 'gameplay.move.walk', with: w }];
const side = (extra = {}) => doc({ systems: walkSys(extra.with), ...extra });

test('walk: preflight fills presets and the card declares envelope and verbs', () => {
  const { checked } = make(side());
  const w = checked.doc.systems[0].with;
  assert.equal(w.preset, 'arcade');
  assert.equal(w.accel, undefined, 'preset-controlled params stay unset unless given');
  const card = move.find(p => p.id === 'gameplay.move.walk').card;
  assert.equal(typeof card.envelope, 'function');
  const env = card.envelope({ ...w }, new Set(), { gravity: 30 });
  assert.ok(env.jumpHeight > 0.5 && env.jumpHeight < 0.7, `jump 6 at g 30 reaches 0.6 (${env.jumpHeight})`);
});

test('walk: falls under space gravity, lands, runs, stops at walls', () => {
  const { rt } = make(side({ solid: floor(0, 23, [[12, 1, 0], [12, 2, 0]]), at: [2, 4, 0] }));
  run(rt, 40, {});
  const p = rt.player(), b = p.components.body;
  assert.ok(Math.abs(p.at[1] - 1) < 0.01, `landed on the floor (${p.at[1]})`);
  assert.equal(b.grounded, true);
  assert.equal(rt.state.counts.landed, 1);
  run(rt, 30, { axes: { move: [1, 0] } });
  assert.ok(p.at[0] > 4 && b.vel[0] === 6, `runs at run speed (${b.vel[0]})`);
  run(rt, 120, { axes: { move: [1, 0] } });
  assert.ok(Math.abs(p.at[0] - 11.2) < 0.01, `stopped flush at the wall (${p.at[0]})`);
  assert.equal(b.vel[0], 0);
});

test('walk: jump height follows jump speed and gravity; coyote and buffer', () => {
  const { rt } = make(side({ with: { jump: 9 } }));
  run(rt, 5, {});
  const p = rt.player();
  rt.step({ actions: { jump: true } });
  let top = 0; for (let i = 0; i < 60; i++) { rt.step({}); top = Math.max(top, p.at[1]); }
  // v²/2g = 81/60 = 1.35 above the floor (discrete integration lands slightly under).
  assert.ok(top - 1 > 1.2 && top - 1 < 1.4, `apex ${top - 1}`);
  assert.equal(rt.state.counts.jumped, 1);
  // Buffer: a press just before landing still jumps.
  rt.step({ actions: { jump: true } });
  let pressed = false;
  for (let i = 0; i < 120 && !pressed; i++) { const falling = p.components.body.vel[1] < 0 && p.at[1] < 1.4; rt.step(falling ? { actions: { jump: true } } : {}); pressed = falling; }
  assert.equal(p.components.body.grounded, false, 'pressed while still airborne');
  run(rt, 10, {});
  assert.equal(rt.state.counts.jumped, 3, 'buffered press fired on landing');
});

test('walk: sprint drains the resource var through the spend effect and stops when empty', () => {
  const spend = { id: 'gameplay.test.spend', card: { intent: 'test spend' }, logic(l) { l.effect('spend', { run: (e, rt) => { rt.state.vars[`res.${e.resource}`] -= e.amount; } }); } };
  const { rt } = make(side({ with: { sprintCost: 30, sprintMin: 5 } }), [spend]);
  rt.state.vars['res.stamina'] = 10; rt.state.vars['res.stamina.max'] = 100;
  run(rt, 3, {});
  run(rt, 30, { axes: { move: [1, 0] }, held: { sprint: true } });
  assert.equal(rt.state.counts.sprint_start, 1);
  assert.equal(rt.state.counts.sprint_end, 1, 'sprint ended when stamina ran out');
  assert.ok(rt.state.vars['res.stamina'] <= 0.5);
  assert.equal(rt.player().components.body.vel[0], 6, 'back to run speed');
});

test('walk: top-down plane, virtual hop and crouch speed (no gravity)', () => {
  const { rt } = make(doc({ gravity: 0, solid: [], size: [16, 16, 1], at: [4, 4, 0], systems: walkSys() }));
  const p = rt.player();
  run(rt, 30, { axes: { move: [0, 1] } });
  assert.ok(p.at[1] > 6 && Math.abs(p.at[0] - 4) < 1e-9, 'stick y moves along +y on a top-down plane');
  rt.step({ actions: { jump: true } });
  run(rt, 5, {});
  assert.ok(p.components.body.lift > 0, 'virtual hop height');
  run(rt, 40, {});
  assert.equal(p.components.body.lift, 0);
  run(rt, 30, { axes: { move: [1, 0] }, held: { crouch: true } });
  assert.ok(Math.abs(p.components.body.vel[0] - 1.5) < 1e-6, 'crouch speed');
});

test('walk: 3D steering follows body.look yaw (forward = [sin, 0, cos])', () => {
  const { rt } = make(doc({ size: [16, 4, 16], solid: (() => { const f = []; for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) f.push([x, 0, z]); return f; })(), at: [8, 1, 8], body: { size: [0.6, 1.8, 0.6], look: [Math.PI / 2, 0] }, systems: walkSys() }));
  run(rt, 30, { axes: { move: [0, 1] } });
  const p = rt.player();
  assert.ok(p.at[0] > 10 && Math.abs(p.at[2] - 8) < 1e-6, `yaw 90° forward is +x (${p.at})`);
  assert.deepEqual(p.components.body.facing, [1, 0, 0], 'frozen 3D facing is a unit vector');
});

test('walk: NPC with components.move follows a kernel move_to through space.path and emits arrived', () => {
  const d = side({ zones: [{ id: 'far', rect: [16, 1, 20, 5] }], archetypes: [{ id: 'villager', components: { body: { size: [0.8, 1.6, 1] }, move: {} } }] });
  const { rt } = make(d);
  const v = rt.spawn('villager', { at: [3, 1, 0] });
  rt.run([{ do: 'move_to', who: v.id, zone: 'far', run: true }]);
  run(rt, 200, {});
  assert.ok(rt.test({ zone: 'far', who: v.id }), `villager arrived (${v.at})`);
  assert.equal(v.components.moveTo, undefined, 'intent cleared');
  assert.equal(rt.state.counts['arrived:far'], 1);
  // An unreachable target fails cleanly.
  rt.run([{ do: 'move_to', who: v.id, at: [5, 30, 0] }]);
  run(rt, 3, {});
  assert.equal(rt.state.counts.move_failed, 1);
});

test('walk: AI intents (by:"ai") are followed without arrival/failure events', () => {
  const { rt } = make(side({ archetypes: [{ id: 'npc', components: { body: { size: [0.8, 1.6, 1] }, move: {} } }] }));
  const n = rt.spawn('npc', { at: [3, 1, 0] });
  n.components.moveTo = { at: [8, 1, 0], run: true, by: 'ai' };
  run(rt, 120, {});
  assert.ok(Math.abs(n.at[0] - 8) < 0.4, `reached (${n.at})`);
  assert.ok(n.components.moveTo, 'AI owns clearing');
  assert.equal(rt.state.counts.arrived, undefined);
});

test('walk: steer intents drive NPCs; entities without components.move are left alone', () => {
  const { rt } = make(side({ archetypes: [{ id: 'npc', components: { body: { size: [0.8, 1.6, 1] }, move: {} } }, { id: 'rock', components: { body: { size: [1, 1, 1] } } }] }));
  const n = rt.spawn('npc', { at: [3, 1, 0] }), r = rt.spawn('rock', { at: [6, 1, 0] });
  n.components.steer = { dir: [1, 0, 0], speed: 2 };
  r.components.moveTo = { at: [12, 1, 0] };
  run(rt, 60, {});
  assert.ok(Math.abs(n.components.body.vel[0] - 2) < 1e-6, 'steer speed honored');
  assert.deepEqual(r.at, [6, 1, 0], 'not driven');
});

test('walk: discrete stepping on a navigate-only space follows input and moveTo', () => {
  const grid = {
    id: 'engine.space.grid-stub', card: { intent: 'stub grid', provides: { capabilities: ['position', 'navigate', 'pathfind'] } },
    install(rt, c, inst) {
      const api = { anchor: 'cell', place(e) { e.at ??= [0, 0]; }, remove() {}, pos: e => e.at, setPos(e, at) { e.at = at; }, entitiesAt: () => [], inZone: (e, z) => z === 'goal' && e.at[0] === 5 && e.at[1] === 0, zoneAt: () => null, teleport() {}, nearest: () => null,
        neighbors: c => [[c[0] + 1, c[1]], [c[0] - 1, c[1]], [c[0], c[1] + 1], [c[0], c[1] - 1]].filter(n => n[0] >= 0 && n[1] >= 0 && n[0] < 8 && n[1] < 8),
        canMove: (e, to) => Math.abs(e.at[0] - to[0]) + Math.abs(e.at[1] - to[1]) === 1 && to[0] >= 0 && to[1] >= 0 && to[0] < 8 && to[1] < 8,
        move(e, to, rt) { if (!api.canMove(e, to)) return false; e.at = to; return true; },
        path(a, b) { const out = [a.slice()]; const p = a.slice(); while (p[0] !== b[0]) { p[0] += Math.sign(b[0] - p[0]); out.push(p.slice()); } while (p[1] !== b[1]) { p[1] += Math.sign(b[1] - p[1]); out.push(p.slice()); } return out; } };
      rt.defineSpace(inst.id, api);
    },
  };
  const d = { schema: 'gameverse.v2.game/0.2', id: 'g', title: 'G', spaces: [{ id: 'board', use: 'engine.space.grid-stub', zones: [{ id: 'goal' }] }], systems: walkSys({ run: 6 }), content: { archetypes: [{ id: 'hero', components: {} }] }, player: { archetype: 'hero', at: [0, 0] } };
  const { compile } = { compile: (doc) => make(doc, [grid]) };
  const { rt } = compile(d);
  run(rt, 15, { axes: { move: [1, 0] } });
  assert.deepEqual(rt.player().at, [2, 0], 'one cell per 1/6 s');
  rt.run([{ do: 'move_to', zone: 'goal' }]);
  run(rt, 120, {});
  assert.deepEqual(rt.player().at, [5, 0]);
  assert.equal(rt.state.counts['arrived:goal'], 1);
});

test('core: overlays outrank the base controller and hand back (mode events)', () => {
  const { rt } = make(side({ systems: [{ use: 'gameplay.move.walk', with: {} }, { use: 'gameplay.move.dodge', with: { distance: 3, sec: 0.3, iframes: [0, 0.2], recovery: 0.1 } }] }));
  run(rt, 5, {});
  rt.step({ actions: { dodge: true }, axes: { move: [1, 0] } });
  const p = rt.player();
  assert.equal(p.components.move.mode, 'dodge');
  run(rt, 40, {});
  assert.equal(p.components.move.mode, 'walk');
  const modes = rt.state.events; void modes;
  assert.ok(rt.state.counts.move_mode >= 3);
});

test('core: macro travel options walk the real controller to each zone', () => {
  const d = side({ zones: [{ id: 'start', rect: [0, 0, 4, 6] }, { id: 'far', rect: [16, 1, 20, 5] }] });
  const { rt } = make(d);
  run(rt, 3, {});
  const opts = rt.availableOptions().filter(o => o.macro);
  assert.deepEqual(opts.map(o => o.label), ['travel to far']);
  // Solver path: repeat the option's actions for its steps.
  const snap = rt.snapshot();
  const o = opts[0];
  for (let i = 0; i < o.steps && !rt.test({ zone: 'far' }); i++) rt.step({ actions: o.actions });
  assert.ok(rt.test({ zone: 'far' }), 'travel by repeated actions arrives');
  rt.restore(snap);
  const res = o.apply(rt);
  assert.equal(res.ok, true); assert.equal(res.mode, 'steps');
  assert.ok(rt.test({ zone: 'far' }));
});

test('walk: deterministic replay', () => {
  const script = i => ({ axes: { move: [Math.sin(i / 7), 0] }, actions: i % 40 === 0 ? { jump: true } : {}, held: i % 40 < 10 ? { jump: true } : {} });
  const a = make(side({ solid: floor(0, 23, [[12, 1, 0]]) })).rt, b = make(side({ solid: floor(0, 23, [[12, 1, 0]]) })).rt;
  for (let i = 0; i < 300; i++) { a.step(script(i)); b.step(script(i)); }
  assert.deepEqual(a.snapshot(), b.snapshot());
  const snap = a.snapshot();
  for (let i = 0; i < 50; i++) a.step(script(i));
  const after = a.snapshot();
  a.restore(snap); for (let i = 0; i < 50; i++) a.step(script(i));
  assert.deepEqual(a.snapshot(), after, 'restore then replay matches');
});

test('walk: preflight rejects bad config with stable codes', () => {
  const registry = new Registry([testSpace, ...move]), logic = buildLogic(registry, Logic);
  const bad = w => preflight(side({ with: w }), registry, logic).errors.map(e => e.code);
  assert.ok(bad({ walk: 50 }).includes('param_range'));
  assert.ok(bad({ preset: 'bouncy' }).includes('param_option'));
  assert.ok(bad({ walk: 7, run: 5 }).includes('walk_speed_order'));
  assert.ok(bad({ nope: 1 }).includes('param_unknown'));
  const d = side(); d.systems[0].with = {}; d.spaces[0].use = 'engine.space.none';
  assert.ok(preflight(d, registry, logic).errors.some(e => e.code === 'primitive_unknown'));
});

test('walk: moving predicate', () => {
  const { rt } = make(side());
  run(rt, 3, {});
  assert.equal(rt.test({ moving: true }), false);
  run(rt, 20, { axes: { move: [1, 0] } });
  assert.equal(rt.test({ moving: true }), true);
  assert.equal(rt.test({ moving: 'player', gte: 5 }), true);
});
