import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import AI from '../v2/primitives/gameplay/ai.index.js';

const P = [...AI, testSpace];
const doc = (motion = {}, archetypes = [], player = [150, 380, 0]) => ({
  schema: 'gameverse.v2.game/0.2', id: 'motion', title: 'Motion', seed: 4,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [320, 420, 1] } }],
  systems: [{ use: 'gameplay.ai.motion', with: motion }],
  content: { archetypes: [{ id: 'ship', components: {} }, ...archetypes] },
  player: { archetype: 'ship', at: player },
});
const mover = (id, motion) => ({ id, kind: 'enemy', components: { motion } });
const B = { min: [0, 0], max: [300, 400] };

test('straight and sine: scroller movers advance down the screen; sine sways ±amp around its base line', () => {
  const { rt } = compile(doc({ bounds: B }, [mover('a', { kind: 'straight', speed: 60 }), mover('b', { program: [{ kind: 'sine', amp: 30, period: 60 }], speed: 60 })]), { primitives: P });
  const a = rt.spawn('a', { at: [50, 0, 0] }), b = rt.spawn('b', { at: [150, 0, 0] });
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 120; i++) { rt.step(); lo = Math.min(lo, b.at[0]); hi = Math.max(hi, b.at[0]); }
  assert.ok(Math.abs(a.at[1] - 120) < 1e-3 && a.at[0] === 50, `1 unit per frame down: ${a.at}`);
  assert.ok(Math.abs(b.at[1] - 120) < 1e-3, 'sine base advances at speed');
  assert.ok(hi - lo > 58 && hi - lo <= 60.01, `swing ${lo}..${hi}`);
});

test('programs: a spline entry path, then hover, then leave; steps emit motion_step', () => {
  const prog = { program: [{ kind: 'path', pts: [[0, 0], [40, 60], [80, 80]], relative: true }, { kind: 'hover', hoverAt: 0, sec: 1 }, { kind: 'straight', ang: -90 }], speed: 120 };
  const { rt } = compile(doc({ bounds: B }, [mover('m', prog)]), { primitives: P });
  const m = rt.spawn('m', { at: [100, 20, 0] });
  run(rt, 90);
  assert.ok(rt.state.counts.motion_step >= 1, 'left the path');
  const there = m.at.slice();
  assert.ok(Math.abs(there[0] - 180) < 12 && Math.abs(there[1] - 100) < 12, `ended near the path end: ${there}`);
  run(rt, 70);
  assert.equal(rt.state.counts.motion_step, 2);
  const y = m.at[1]; run(rt, 30);
  assert.ok(m.at[1] < y - 50, 'flies up and away (ang -90°)');
});

test('chase steers toward the player with a turn-rate limit; dive aims then lunges', () => {
  const { rt } = compile(doc({ arena: true }, [mover('c', { kind: 'chase', speed: 90, ang: 0 }), mover('d', { kind: 'dive', speed: 60, ang: 90 })], [150, 300, 0]), { primitives: P });
  const c = rt.spawn('c', { at: [20, 20, 0] }), d = rt.spawn('d', { at: [280, 20, 0] });
  const dist = e => Math.hypot(e.at[0] - 150, e.at[1] - 300);
  const c0 = dist(c); run(rt, 90);
  assert.ok(dist(c) < c0 - 60, 'chaser closes in');
  const s = rt.service('motion').state(d.id);
  assert.equal(s.sub, 2, 'dive reached the lunge phase');
  const dx = 150 - d.at[0], dy = 300 - d.at[1];
  assert.ok(Math.abs(Math.atan2(dy, dx) - s.ang) < 0.3, 'lunging at the player');
});

test('edges: bounce keeps arena movers inside, wrap carries them across, exit removes scroller leavers', () => {
  const w = m => compile(doc({ bounds: B, arena: true, edges: m }, [mover('r', { kind: 'rock', vel: [-200, 0] }), mover('wd', { kind: 'wander', speed: 150 })]), { primitives: P }).rt;
  const bo = w('bounce'); const r = bo.spawn('r', { at: [100, 100, 0] }), wd = bo.spawn('wd', { at: [150, 150, 0] });
  for (let i = 0; i < 300; i++) { bo.step(); for (const e of [wd]) assert.ok(e.at[0] >= 0 && e.at[0] <= 300 && e.at[1] >= 0 && e.at[1] <= 400); }
  const wr = w('wrap'); const r2 = wr.spawn("r", { at: [20, 100, 0] }); run(wr, 20);
  assert.ok(r2.at[0] > 280, `wrapped to the right side: ${r2.at}`);
  const ex = compile(doc({ bounds: B, edges: 'exit' }, [mover('s', { kind: 'straight', speed: 300 })]), { primitives: P }).rt;
  ex.spawn('s', { at: [100, 10, 0] }); run(ex, 120);
  assert.equal(ex.state.counts.motion_exit, 1); assert.equal(ex.entity('e1'), undefined);
});

test('gravity wells pull the player; snakes trail segments', () => {
  const { rt } = compile(doc({ arena: true }, [mover('g', { kind: 'gravity', speed: 0, reach: 150 }), mover('sn', { program: [{ kind: 'snake', segments: 6, spacing: 9 }], speed: 80 })], [150, 300, 0]), { primitives: P });
  rt.spawn('g', { at: [150, 200, 0] });
  const sn = rt.spawn('sn', { at: [20, 20, 0] });
  run(rt, 60);
  assert.ok(rt.player().at[1] < 299, `player pulled toward the well: ${rt.player().at}`);
  const segs = rt.service('motion').segments(sn.id);
  assert.equal(segs.length, 12);
  for (let k = 2; k < segs.length; k += 2) assert.ok(Math.hypot(segs[k] - segs[k - 2], segs[k + 1] - segs[k - 1]) <= 9 + 1e-6);
});

test('motion replays deterministically', () => {
  const make = () => { const { rt } = compile(doc({ bounds: B, arena: true, edges: 'bounce' }, [mover('wd', { kind: 'wander', speed: 120 }), mover('sa', { kind: 'saucer', speed: 80 }), mover('h', { kind: 'hover', speed: 70 })]), { primitives: P }); for (const id of ['wd', 'sa', 'h']) rt.spawn(id, { at: [150, 200, 0] }); return rt; };
  const a = make(), b = make(); run(a, 240); run(b, 240);
  assert.deepEqual(a.snapshot(), b.snapshot());
  const snap = a.snapshot(); run(a, 60); const end = a.snapshot(); a.restore(snap); run(a, 60);
  assert.deepEqual(a.snapshot(), end);
});

test('preflight rejects bad motion configs with stable codes', () => {
  const { registry, logic } = catalogue([testSpace]);
  const bad = doc({ edges: 'wrap' }, [mover('x', { program: [{ kind: 'teleport' }, { kind: 'path' }], wobble: 1 }), mover('y', { speed: 3 })]);
  const codes = preflight(bad, registry, logic).errors.map(e => e.code);
  for (const c of ['motion_bounds_missing', 'param_option', 'motion_path_points', 'param_unknown', 'motion_program_missing']) assert.ok(codes.includes(c), c);
});

test('v2/games motion instances (if any) preflight without param errors', () => {
  const { registry, logic } = catalogue();
  for (const f of fs.readdirSync('v2/games')) {
    const d = JSON.parse(fs.readFileSync(`v2/games/${f}`, 'utf8'));
    const errs = preflight(d, registry, logic).errors.filter(e => /components\.motion\b/.test(e.path || '') || (d.systems || []).some((s, i) => s.use === 'gameplay.ai.motion' && e.path?.startsWith(`systems[${i}]`)));
    assert.deepEqual(errs.filter(e => e.code !== 'capability_missing'), [], f);
  }
});
