import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import AI from '../v2/primitives/gameplay/ai.index.js';
import { motionFrames, LEVELS } from '../v2/primitives/gameplay/ai-versus.js';

// Test double for the combat/input side: the melee service's frame data, and a log of every
// input the CPU sends through components.input (consumed in the input phase, as engine.input does).
const MOVES = { '5A': { startup: 4, active: 3, recovery: 7, total: 14, damage: 30, level: 'mid', reach: 1 }, '5B': { startup: 8, active: 4, recovery: 15, total: 27, damage: 80, level: 'mid', reach: 1.2 },
  '2B': { startup: 7, active: 4, recovery: 19, total: 30, damage: 70, level: 'low', reach: 1.3 }, heavy_end: { startup: 10, active: 3, recovery: 40, total: 53, damage: 90, level: 'mid', reach: 1.2 } };
const fighter = { id: 'gameplay.test.fighter', card: { ambient: true, intent: 'test fighter', params: {}, provides: { services: ['melee'] } },
  install(rt) {
    rt.provide('melee', { moves: () => MOVES });
    rt.system('input', rt => { for (const e of rt.query('cpu')) { const i = e.components.input; if (!i) continue; (rt.store('test.log')[e.id] ??= []).push({ f: rt.state.frame, move: i.axes.move.slice(), held: { ...i.held }, actions: { ...i.actions } }); i.actions = {}; } });
  } };
const P = [...AI, testSpace, fighter];
const doc = (cpu = {}, { seed = 1, at = [12, 1, 0] } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'vs', title: 'Versus', seed,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [40, 8, 1] } }],
  systems: [{ use: 'gameplay.test.fighter' }, { use: 'gameplay.ai.versus', with: { level: cpu.level ?? 3 } }],
  content: { archetypes: [{ id: 'hero', components: { body: { size: [0.6, 1.8, 1], facing: 1 }, melee: { st: 'idle' } } },
    { id: 'cpu', kind: 'enemy', components: { body: { size: [0.6, 1.8, 1], facing: -1 }, melee: { st: 'idle' }, versus: { meter: 0 }, cpu: { style: 'balanced', ...cpu } } }] },
  player: { archetype: 'hero', at: [10, 1, 0] },
});
const make = (cpu, o) => { const { rt } = compile(doc(cpu, o), { primitives: P }); const c = rt.spawn('cpu', { at: o?.at ?? [11, 1, 0] }); return { rt, c, log: () => rt.store('test.log')[c.id] || [] }; };
const blocking = (frame, facing = -1) => frame.held.block || Math.sign(frame.move[0]) === -facing;

test('reaction and blocking scale with level: the CPU holds back + block after its reaction delay', () => {
  const rate = level => {
    let blocks = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { rt, c, log } = make({ level }, { seed });
      run(rt, 3);
      const p = rt.player();
      for (let f = 0; f < 34; f++) { p.components.melee = { st: 'attack', move: '5B', mf: f + 1, phase: f < 8 ? 'startup' : f < 12 ? 'active' : 'startup' }; rt.step(); }
      const after = log().filter(x => x.f >= log()[0].f + 3 + LEVELS[level].react);
      if (after.some(x => blocking(x))) blocks++;
      void c;
    }
    return blocks / 60;
  };
  const r5 = rate(5), r1 = rate(1);
  assert.ok(r5 > 0.7, `level 5 blocks ${r5}`); assert.ok(r1 < 0.4, `level 1 blocks ${r1}`);
});

test('reads lows: a level-5 CPU blocks a sweep crouching (down-back)', () => {
  let low = 0, n = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { rt, log } = make({ level: 5 }, { seed });
    run(rt, 3);
    for (let f = 0; f < 30; f++) { rt.player().components.melee = { st: 'attack', move: '2B', mf: f + 1, phase: 'startup' }; rt.step(); }
    const b = log().filter(x => blocking(x));
    if (b.length) { n++; if (b.at(-1).move[1] < 0) low++; }
  }
  assert.ok(n > 25 && low / n > 0.8, `low blocks ${low}/${n}`);
});

test('specials are honest motion macros through components.input (facing-correct quarter circle)', () => {
  // Far away, a zoner with a fireball throws it: down, down-forward, forward + press.
  for (let seed = 1; seed <= 20; seed++) {
    const { rt, log } = make({ level: 5, style: 'zoner', specials: [{ archetype: 'fireball', motion: 'qcf' }] }, { seed, at: [30, 1, 0] });
    run(rt, 240);
    const L = log();
    for (let i = 2; i < L.length; i++) {
      // CPU faces -1 (left), so forward is -x; axes y is up-positive so down is -1.
      if (L[i - 2].move[0] === 0 && L[i - 2].move[1] === -1 && L[i - 1].move[0] === -1 && L[i - 1].move[1] === -1 && L[i].move[0] === -1 && L[i].move[1] === 0 && (L[i].actions.attack || L[i].actions.heavy)) return;
    }
  }
  assert.fail('no quarter-circle-forward + press found');
});

test('the real motion parser (engine.input.motions) recognizes the CPU specials', async () => {
  const { PRIMITIVES } = await import('../v2/primitives/index.js');
  const motions = PRIMITIVES.find(p => p.id === 'engine.input.motions');
  let seen = 0;
  for (let seed = 1; seed <= 10 && !seen; seed++) {
    const d = doc({ level: 5, style: 'zoner', specials: [{ archetype: 'fireball', motion: 'qcf' }] }, { seed });
    d.systems.unshift({ use: 'engine.input.motions', with: { buttons: ['attack', 'heavy'] } });
    const { rt } = compile(d, { primitives: [...P, motions] });
    const c = rt.spawn('cpu', { at: [30, 1, 0] });
    rt.on('motion:qcf', ev => { if (ev.who === c.id) seen++; });
    run(rt, 300);
  }
  assert.ok(seen >= 1, 'a CPU quarter-circle was parsed as motion:qcf');
});

test('punishes long recoveries with a combo, and techs throws by pressing the throw verb', () => {
  let punished = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { rt, log } = make({ level: 5 }, { seed });
    run(rt, 3);
    for (let f = 0; f < 30; f++) { rt.player().components.melee = { st: 'attack', move: 'heavy_end', mf: 14 + f, phase: 'recovery' }; rt.step(); }
    if (log().some(x => x.actions.attack || x.actions.heavy)) punished++;
  }
  assert.ok(punished >= 24, `punished ${punished}/30`);
  let teched = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { rt, c, log } = make({ level: 5 }, { seed });
    for (let f = 1; f <= 12; f++) { rt.player().components.melee = { st: 'throw', move: null, mf: f }; c.components.melee = { st: 'thrown', mf: f }; rt.step(); }
    if (log().some(x => x.actions.throw)) teched++;
  }
  assert.ok(teched > 12 && teched < 40, `teched ${teched}/40 (level 5 tech 0.6)`);
});

test('neutral game: approaches from far, keeps its style range; replays deterministically', () => {
  const { rt, c } = make({ level: 3, style: 'rushdown' }, { at: [25, 1, 0] });
  run(rt, 60);
  const L = rt.store('test.log')[c.id];
  assert.ok(L.filter(x => x.move[0] < 0).length > 20, 'walked toward the player (−x)');
  const a = make({ level: 4, specials: [{ archetype: 'fireball', motion: 'qcf' }, { archetype: 'uppercut', motion: 'dp' }] }, { seed: 9 }).rt;
  const b = make({ level: 4, specials: [{ archetype: 'fireball', motion: 'qcf' }, { archetype: 'uppercut', motion: 'dp' }] }, { seed: 9 }).rt;
  run(a, 300); run(b, 300);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.equal(motionFrames('dp', 'b').length, 3);
});

test('preflight rejects bad cpu components with stable codes', () => {
  const { registry, logic } = catalogue([testSpace, fighter]);
  const d = doc({ level: 9, style: 'turtle', specials: [{ archetype: 'fireball', motion: 'qcz' }, { motion: 'qcf' }], mood: 1 });
  const codes = preflight(d, registry, logic).errors.map(e => e.code);
  for (const c of ['param_range', 'param_option', 'cpu_motion_unknown', 'cpu_special', 'param_unknown']) assert.ok(codes.includes(c), c);
});
