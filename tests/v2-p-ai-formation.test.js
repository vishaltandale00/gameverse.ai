import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import AI from '../v2/primitives/gameplay/ai.index.js';

const P = [...AI, testSpace];
const B = { min: [0, 0], max: [300, 400] };
const doc = (formation, waves) => ({
  schema: 'gameverse.v2.game/0.2', id: 'form', title: 'Formation', seed: 11,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [320, 420, 1] } }],
  systems: [{ use: 'gameplay.ai.formation', with: { bounds: B, formations: [{ id: 'f', ...formation }], waves } }],
  content: { archetypes: [{ id: 'ship', components: {} }, { id: 'bee', kind: 'enemy', components: {} }, { id: 'boss', kind: 'enemy', components: {} }] },
  player: { archetype: 'ship', at: [150, 370, 0] },
});
const inF = rt => Object.values(rt.state.entities).filter(e => e.components.formation?.st === 'formation');

test('waves fly in on entry paths and settle into their slots; Galaga formation sways', () => {
  const { rt } = compile(doc({ dives: false }, [{ formation: 'f', archetype: 'bee', count: 6, entry: 'left-arc' }, { formation: 'f', archetype: 'bee', count: 4, entry: 'top-line', at: 0.5 }]), { primitives: P });
  run(rt, 400);
  assert.equal(inF(rt).length, 10); assert.equal(rt.state.counts.formation_full, 1); assert.equal(rt.state.counts.formation_join, 10);
  const slots = inF(rt).map(e => e.components.formation.slot).sort((a, b) => a - b);
  assert.deepEqual(slots, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const sp = rt.service('formation'), a = inF(rt).find(e => e.components.formation.slot === 3);
  assert.deepEqual(a.at.slice(0, 2), sp.slotPos('f', 3), 'members sit exactly on their slot');
  const x0 = sp.state('f').x; run(rt, 40);
  assert.notEqual(sp.state('f').x, x0, 'the formation sways');
});

test('Invaders march: step time max(3, round(4 + 36·alive/used)), reverse and drop at the edge', () => {
  const { rt } = compile(doc({ march: true, dives: false }, [{ formation: 'f', archetype: 'bee', count: 10, entry: 'top-line' }]), { primitives: P });
  run(rt, 200);
  const f = rt.service('formation').state('f');
  const marches = () => rt.state.counts.march ?? 0;
  assert.ok(marches() > 0);
  // Full formation: 40-frame steps.
  let m0 = marches(); run(rt, 40); assert.equal(marches() - m0, 1);
  for (const e of inF(rt).slice(0, 5)) rt.despawn(e.id);
  run(rt, 40); m0 = marches(); run(rt, 66);
  assert.equal(marches() - m0, 3, 'half alive: 22-frame steps');
  const y0 = f.y; run(rt, 1500);
  assert.ok(f.y > y0, 'dropped after reaching an edge');
});

test('dives: a leader peels off with same-kind escorts and rejoins; formation_front picks column fronts', () => {
  const { rt } = compile(doc({ aggression: 3 }, [{ formation: 'f', archetype: 'bee', count: 20, entry: 'top-line' }]), { primitives: P });
  const escorts = []; rt.on('dive', d => escorts.push(d.escort));
  run(rt, 900);
  assert.ok(escorts.length >= 3, `dives: ${escorts.length}`);
  assert.ok(escorts.some(x => x > 0), 'leaders took escorts');
  assert.ok(Math.max(...escorts) <= 2, 'at most two escorts');
  assert.ok(rt.state.counts.formation_join > 20, 'divers rejoined their slots');
  // Settled fronts: exactly one per occupied column; divers count as out front.
  const settled = Object.values(rt.state.entities).filter(e => e.components.formation?.st === 'formation');
  const fronts = settled.filter(e => rt.test({ formation_front: true, who: e.id }));
  assert.equal(new Set(fronts.map(e => e.components.formation.slot % 10)).size, fronts.length);
  assert.equal(fronts.length, new Set(settled.map(e => e.components.formation.slot % 10)).size);
});

test('formation replays deterministically', () => {
  const make = () => compile(doc({ aggression: 2 }, [{ formation: 'f', archetype: 'bee', count: 12, entry: 'loop', dive: 'swoop' }, { formation: 'f', archetype: 'boss', count: 4, entry: 'v-formation', dive: 'chase', at: 1 }]), { primitives: P }).rt;
  const a = make(), b = make(); run(a, 600); run(b, 600);
  assert.deepEqual(a.snapshot(), b.snapshot());
  const snap = a.snapshot(); run(a, 120); const end = a.snapshot(); a.restore(snap); run(a, 120);
  assert.deepEqual(a.snapshot(), end);
});

test('preflight rejects bad formation configs with stable codes', () => {
  const { registry, logic } = catalogue([testSpace]);
  const d = doc({ cols: 0 }, [{ formation: 'g', archetype: 'ghost', entry: 'spiral' }]);
  d.systems[0].with.bounds = { min: [10, 10], max: [5, 50] };
  const codes = preflight(d, registry, logic).errors.map(e => e.code);
  for (const c of ['param_range', 'ref_unknown', 'param_option', 'formation_bounds']) assert.ok(codes.includes(c), c);
  const none = doc({}, []); delete none.systems[0].with.bounds;
  assert.ok(preflight(none, registry, logic).errors.some(e => e.code === 'param_missing'));
});
