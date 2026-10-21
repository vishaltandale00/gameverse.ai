import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { catalogue, PRIMITIVES } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import AI from '../v2/primitives/gameplay/ai.index.js';
import { slotAt } from '../v2/primitives/gameplay/ai-schedule.js';

const P = [...AI, testSpace];
const ROUTINE = [{ from: 6, to: 12, at: [10, 2, 0], doing: 'bake' }, { from: 12, to: 20, zone: 'market', doing: 'sell' }, { from: 20, to: 6, at: [2, 10, 0], doing: 'sleep' }];
const doc = ({ schedule = {}, brain = false, viewDistance = 100, player = [1, 1, 0] } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'sched', title: 'Schedule', seed: 2,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [24, 24, 1] }, zones: [{ id: 'market', rect: [16, 16, 20, 20] }] }],
  systems: [...(brain ? [{ use: 'gameplay.ai.brain', with: { tick: 0.1 } }] : []), { use: 'gameplay.ai.schedule', with: { viewDistance, speed: 4, ...schedule } }],
  plot: { characters: [{ id: 'baker', name: 'Bea', schedule: ROUTINE }] },
  content: { archetypes: [{ id: 'hero', components: {} }, { id: 'npc', kind: 'npc', components: brain ? { ai: { brain: [{ do: 'work' }], speed: 4 } } : {} }] },
  player: { archetype: 'hero', at: player },
});
const hour = (rt, h) => { rt.state.vars['time.hour'] = h; };

test('slots wrap around midnight', () => {
  assert.equal(slotAt(ROUTINE, 7), 0); assert.equal(slotAt(ROUTINE, 12), 1); assert.equal(slotAt(ROUTINE, 23), 2); assert.equal(slotAt(ROUTINE, 3), 2);
});

test('NPCs walk to each slot, report arrival/departure, and expose the activity', () => {
  const { rt } = compile(doc(), { primitives: P });
  hour(rt, 7);
  const b = rt.spawn('npc', { id: 'baker', at: [2, 2, 0] });
  run(rt, 30);
  assert.equal(b.components.schedule.state, 'travel'); assert.ok(b.at[0] > 3 && b.at[0] < 10, `walking: ${b.at}`);
  run(rt, 120);
  assert.equal(b.components.schedule.state, 'there'); assert.deepEqual(b.at.map(Math.round), [10, 2, 0]);
  assert.ok(rt.test({ doing: 'bake', who: 'baker' })); assert.equal(rt.state.counts['arrived:baker'], 1);
  hour(rt, 13); run(rt, 420);
  assert.equal(rt.state.counts['departed:baker'], 1);
  assert.ok(rt.test({ zone: 'market', who: 'baker' }), `went to market: ${b.at}`);
  assert.ok(rt.test({ doing: 'sell', who: 'baker' }));
});

test('offscreen NPCs are placed at once; set_schedule replaces a routine', () => {
  const { rt } = compile(doc({ viewDistance: 3 }), { primitives: P });
  hour(rt, 21);
  const b = rt.spawn('npc', { id: 'baker', at: [20, 2, 0] });
  run(rt, 2);
  assert.deepEqual(b.at, [2, 10, 0]); assert.equal(b.components.schedule.state, 'there');
  rt.run([{ do: 'set_schedule', character: 'baker', schedule: [{ from: 0, to: 24, at: [5, 5, 0], doing: 'hide' }] }]);
  run(rt, 2);
  assert.deepEqual(b.at, [5, 5, 0]); assert.ok(rt.test({ doing: 'hide', who: 'baker' }));
});

test('with a brain, the work behavior walks the routine; teleportOffscreen travel', () => {
  const { rt } = compile(doc({ brain: true }), { primitives: P });
  hour(rt, 8);
  const b = rt.spawn('npc', { id: 'baker', at: [2, 2, 0] });
  run(rt, 200);
  assert.equal(b.components.schedule.state, 'there'); assert.ok(Math.abs(b.at[0] - 10) < 0.3);
  const t = compile(doc({ schedule: { travel: 'teleportOffscreen' }, viewDistance: 3 }), { primitives: P }).rt;
  hour(t, 13); t.spawn('npc', { id: 'baker', at: [10, 10, 0] }); run(t, 1);
  assert.ok(t.test({ zone: 'market', who: 'baker' }), 'placed in its zone immediately');
});

test('drives characters spawned by plot.character (routine seeded into components.schedule)', () => {
  const d = doc({ brain: true });
  d.systems.unshift({ use: 'plot.character' });
  d.plot.characters[0].archetype = 'npc'; d.plot.characters[0].at = [2, 2, 0];
  const { rt } = compile(d, { primitives: [...PRIMITIVES, testSpace] });
  hour(rt, 9); run(rt, 200);
  const b = rt.entity('baker');
  assert.ok(Array.isArray(b.components.schedule.routine), 'routine kept on the component');
  assert.equal(b.components.schedule.doing, 'bake'); assert.equal(b.components.schedule.state, 'there');
  assert.ok(Math.abs(b.at[0] - 10) < 0.3);
});

test('fallback clock and deterministic replay', () => {
  const make = () => { const { rt } = compile(doc({ schedule: { hourLength: 1, startHour: 5 } }), { primitives: P }); rt.spawn('npc', { id: 'baker', at: [2, 2, 0] }); return rt; };
  const a = make(), b = make();
  run(a, 60 * 20); run(b, 60 * 20);
  assert.ok(a.state.counts['departed:baker'] >= 2, 'the routine advanced with the fallback clock');
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('preflight rejects bad schedules with stable codes', () => {
  const { registry, logic } = catalogue([testSpace]);
  const d = doc();
  d.plot.characters[0].schedule = [{ from: 25, to: 3, at: [1, 1, 0] }, { from: 1, to: 4, zone: 'nowhere' }, { from: 5, to: 6 }, { from: 7, to: 8, at: [1, 1, 0], mood: 'x' }];
  const errors = preflight(d, registry, logic).errors, codes = errors.map(e => e.code);
  for (const c of ['ref_unknown', 'schedule_place', 'schedule_overlap', 'param_unknown']) assert.ok(codes.includes(c), c);
  // A slot's hours are declared 0..24 (card.data plot.characters schedule): hour 25 is the kernel's param_range at it (was schedule_hour).
  assert.ok(errors.some(e => e.code === 'param_range' && e.path === 'plot.characters[0].schedule[0].from'), JSON.stringify(errors));
});

test('every character schedule and ai.schedule instance in v2/games preflights without errors', () => {
  const { registry, logic } = catalogue();
  for (const f of fs.readdirSync('v2/games')) {
    const d = JSON.parse(fs.readFileSync(`v2/games/${f}`, 'utf8'));
    const mine = (d.systems || []).map((s, i) => [s, `systems[${i}]`]).filter(([s]) => s.use === 'gameplay.ai.schedule').map(x => x[1]);
    const errs = preflight(d, registry, logic).errors.filter(e => mine.some(p => e.path === p || e.path?.startsWith(p + '.')) || /\.schedule\b/.test(e.path || ''));
    assert.deepEqual(errs.filter(e => e.code !== 'capability_missing'), [], f);
  }
});
