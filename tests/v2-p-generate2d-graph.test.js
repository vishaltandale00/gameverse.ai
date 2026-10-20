import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import graphWorld, { generateGraph } from '../v2/primitives/engine/generate-graph-world.js';
import { withDefaults } from '../v2/primitives/engine/generate2d-lib.js';

const KEY = 'spaces.map.generators[0]';
const doc = (w = {}, seed = 2, zones = [{ id: 'camp', name: 'Camp', exits: [] }]) => ({
  schema: 'gameverse.v2.game/0.2', id: 'graph', title: 'Graph', seed,
  spaces: [{ id: 'map', use: 'engine.space.graph', zones, generators: [{ use: 'engine.generate.graph.world', with: { start: { kind: 'start', zone: 'camp' }, ...w } }] }],
  content: { archetypes: [{ id: 'hero', components: {} }, { id: 'boss_slime', components: {} }] },
  player: { archetype: 'hero', at: 'camp' },
});

test('graph.world: layered, web and linear maps pass their proofs for many seeds', () => {
  for (const layout of ['layered', 'web', 'linear']) for (let seed = 1; seed <= 8; seed++) {
    const g = generateGraph(withDefaults(graphWorld.card, { layout, nodes: 18, layers: 9, width: 5, paths: 5, branching: 0.4 }), seed);
    assert.deepEqual(g.problems, [], `${layout} seed ${seed}`);
    assert.equal(g.fallback, false);
    const ids = new Set(g.nodes.map(n => n.id));
    for (const n of g.nodes) for (const x of n.exits) assert.ok(ids.has(x.to));
    if (layout === 'layered') assert.ok(g.nodes.filter(n => n.kind === 'elite').every(n => n.t >= 0.35), 'templates honour their range');
  }
});

test('graph.world: the player walks a layered map from the bound start zone to the boss, one way', () => {
  const { rt } = compile(doc({ end: { kind: 'boss', archetype: 'boss_slime' } }), { primitives: PRIMITIVES });
  run(rt, 1);
  const st = rt.store(KEY), svc = rt.service('worldgraph');
  assert.deepEqual(st.problems, []);
  assert.equal(svc.start(), 'camp');
  assert.equal(rt.player().at, 'camp');
  assert.equal(rt.query('node').length, 1, 'the boss archetype spawns at the end');
  let steps = 0;
  while (rt.player().at !== svc.end() && steps++ < 40) { const opt = rt.availableOptions()[0]; rt.step({ actions: opt.actions }); }
  assert.equal(rt.player().at, svc.end());
  assert.ok(rt.state.counts['enter_zone'] >= 9);
  const prev = svc.nodes().find(n => n.exits.some(x => x.to === svc.end())).id;
  rt.step({ actions: { go: prev } });
  assert.equal(rt.player().at, svc.end(), 'layered exits are one-way');
});

test('graph.world: gates close every edge entering their stage until the predicate holds', () => {
  const { rt } = compile(doc({ layout: 'linear', nodes: 8, branching: 0, gates: [{ at: 0.5, gate: { flag: 'badge_1' } }] }), { primitives: PRIMITIVES });
  run(rt, 1);
  const nodes = rt.service('worldgraph').nodes(), gated = nodes.find(n => n.exits.some(x => x.gate)), target = gated.exits.find(x => x.gate).to;
  assert.ok(rt.service('worldgraph').node(target).t >= 0.5);
  for (let i = 0; rt.player().at !== gated.id && i < 10; i++) rt.step({ actions: { go: nodes.find(n => n.id === rt.player().at).exits.find(x => !x.gate && rt.service('worldgraph').node(x.to).t > rt.service('worldgraph').node(rt.player().at).t).to } });
  assert.equal(rt.player().at, gated.id);
  rt.step({ actions: { go: target } });
  assert.equal(rt.player().at, gated.id, 'blocked by the gate');
  rt.run([{ do: 'set_flag', flag: 'badge_1' }]);
  rt.step({ actions: { go: target } });
  assert.equal(rt.player().at, target);
});

test('graph.world: same seed replays exactly; another seed differs', () => {
  const a = compile(doc(), { primitives: PRIMITIVES }).rt, b = compile(doc(), { primitives: PRIMITIVES }).rt, c = compile(doc({}, 9), { primitives: PRIMITIVES }).rt;
  for (const rt of [a, b, c]) for (let i = 0; i < 5; i++) rt.step({ actions: rt.availableOptions()[0]?.actions || {} });
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.notDeepEqual(a.store(KEY).nodes, c.store(KEY).nodes);
});

test('graph.world: preflight rejects bad configs with stable codes', () => {
  const r = new Registry(PRIMITIVES), logic = buildLogic(r, Logic), codes = d => preflight(d, r, logic).errors.map(e => e.code);
  const a = doc({ templates: [{ kind: 'battle', layers: [0.8, 0.2] }, { kind: 'shop', min: 3, max: 1 }] });
  assert.equal(codes(a).filter(c => c === 'template_range_invalid').length, 2);
  const b = doc({ templates: [{ kind: 'a', zone: 'camp' }, { kind: 'b', zone: 'camp' }] });
  assert.ok(codes(b).includes('template_zone_reused'));
  const c = doc({ layout: 'web', nodes: 4, templates: [{ kind: 'battle', min: 9 }] });
  assert.ok(codes(c).includes('graph_too_small'));
  const d = doc({ layout: 'spiral' }); assert.ok(codes(d).includes('param_option'));
  const e = doc({ templates: [{ kind: 'x', zone: 'nowhere' }] }); assert.ok(codes(e).includes('ref_unknown'));
});
