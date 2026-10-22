import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace, run } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import overworld, { generateOverworld, checkMap } from '../v2/primitives/engine/generate-tilemap-overworld.js';
import { withDefaults, placeOn, spaceOf, cellOfEntity } from '../v2/primitives/engine/generate2d-lib.js';

const ALL = [...PRIMITIVES, testSpace];
const KEY = 'spaces.ow.generators[0]';
const AREAS = () => [
  { id: 'home', kind: 'town', services: ['heal', 'mart'], connects: [{ to: 'route1' }], npcs: [{ id: 'mom', name: 'Mom', lines: ['Be careful!'] }] },
  { id: 'route1', kind: 'route', length: 40, connects: [{ to: 'home' }, { to: 'city' }], trainers: [{ id: 'youngster' }, { id: 'lass' }], items: ['potion'] },
  { id: 'city', kind: 'town', services: ['heal'], connects: [{ to: 'route1' }, { to: 'gym1' }, { to: 'cave1', gate: { flag: 'badge_1' } }] },
  { id: 'gym1', kind: 'gym', connects: [{ to: 'city' }], leader: { id: 'leader_1' }, trainers: [{ id: 'gym_a' }, { id: 'gym_b' }, { id: 'gym_c' }] },
  { id: 'cave1', kind: 'cave', length: 30, connects: [{ to: 'city' }], items: ['rope'] },
];
const doc = ({ space = 'engine.space.tilemap', seed = 4, w = {} } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'ow', title: 'Overworld', seed,
  spaces: [{ id: 'ow', use: space, with: space === 'engine.space.test' ? { size: [256, 256, 1] } : { size: [256, 256], mode: 'topdown' }, generators: [{ use: 'engine.generate.tilemap.overworld', with: { areas: AREAS(), starters: ['sprout', 'ember', 'drop'], ...w } }] }],
  systems: [{ use: 'plot.storyboard' }],
  plot: { storyboard: { acts: [{ id: 'a1', beats: [{ id: 'left_town', when: { zone: 'route1' }, do: [{ do: 'set_flag', flag: 'outside' }] }] }] } },
  content: { archetypes: [{ id: 'hero', components: {} }], items: [{ id: 'potion', name: 'Potion' }, { id: 'rope', name: 'Rope' }] },
  player: { archetype: 'hero', space: 'ow' },
});

test('tilemap.overworld: every map passes its check and every map is reachable through warps', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const w = generateOverworld(withDefaults(overworld.card, { areas: AREAS() }), seed);
    assert.deepEqual(w.problems, [], `seed ${seed}`);
    assert.deepEqual(Object.keys(w.maps).sort(), ['cave1', 'city', 'city-center', 'city-house-1', 'gym1', 'home', 'home-center', 'home-house-1', 'home-lab', 'home-mart', 'route1', ...(Object.keys(w.maps).includes('city-house-2') ? ['city-house-2'] : []), ...(Object.keys(w.maps).includes('home-house-2') ? ['home-house-2'] : [])].sort());
    assert.ok(w.maps.gym1.puzzle, 'gyms get a switch puzzle');
    assert.ok(w.maps.city.entities.some(e => e.kind === 'guard' && e.gate?.flag === 'badge_1'), 'gated exits get a guard');
  }
  // The check is real: wall off a route's exit and it is reported.
  const w = generateOverworld(withDefaults(overworld.card, { areas: AREAS() }), 1), m = structuredClone(w.maps.route1);
  for (const o of m.openings) for (const [x, y] of o.inner) m.tiles[y][x] = 'tree';
  assert.ok(checkMap(m).some(p => p.code === 'exit_unreachable'));
});

test('tilemap.overworld: on the tilemap the player starts in the lab, warps between maps and zones are live', () => {
  const { rt } = compile(doc(), { primitives: ALL });
  run(rt, 1);
  const st = rt.store(KEY), api = rt.space('ow'), space = spaceOf(rt, { space: 'ow' }), svc = rt.service('overworld');
  assert.deepEqual(st.problems, []);
  assert.ok(rt.test({ zone: 'home-lab', who: 'player' }), 'spawned in the lab');
  assert.equal(rt.query('overworld').filter(e => e.components.overworld.kind === 'starter').length, 3);
  assert.ok(rt.entity('mom'));
  // Every lab tile the player can walk to includes the mat that warps out.
  const mat = st.warps.find(w => w.map === 'home-lab');
  assert.ok(api.canReach(rt.player().at, [mat.from[0] + 0.5, mat.from[1] + 0.5], rt, {}), 'the tilemap agrees the exit mat is reachable');
  placeOn(rt, space, rt.player(), mat.from); run(rt, 1);
  assert.ok(rt.test({ zone: 'home', who: 'player' }), 'the mat warped the player into town');
  assert.equal(rt.state.counts.warp, 1);
  const edge = st.warps.find(w => w.map === 'home' && w.kind === 'edge');
  placeOn(rt, space, rt.player(), edge.from); run(rt, 2);
  assert.ok(rt.test({ zone: 'route1', who: 'player' }));
  assert.equal(rt.state.flags.outside, true, 'story beats see generated zones');
  assert.deepEqual(cellOfEntity(space, rt.player()).slice(0, 2), edge.to);
  assert.equal(svc.warpAt(edge.from).toMap, 'route1');
  assert.ok(st.signs.length > 0 && typeof svc.signAt(st.signs[0].at) === 'string');
});

test('tilemap.overworld: works on the test space too and replays exactly', () => {
  const a = compile(doc({ space: 'engine.space.test' }), { primitives: ALL }).rt, b = compile(doc({ space: 'engine.space.test' }), { primitives: ALL }).rt;
  run(a, 5); run(b, 5);
  assert.deepEqual(a.store(KEY).problems, []);
  assert.deepEqual(a.snapshot(), b.snapshot());
  const c = compile(doc({ seed: 9 }), { primitives: ALL }).rt, d = compile(doc({ seed: 4 }), { primitives: ALL }).rt;
  assert.notDeepEqual(c.store(KEY).maps.map(m => m.size), d.store(KEY).maps.map(m => m.size));
});

test('tilemap.overworld: preflight sees area zones and rejects bad configs with stable codes', () => {
  const r = new Registry(ALL), logic = buildLogic(r, Logic), codes = d => preflight(d, r, logic).errors.map(e => e.code);
  assert.deepEqual(codes(doc()), [], 'the beat on zone route1 resolves through card.defines');
  const bad = doc({ w: { start: 'mars' } });
  bad.spaces[0].generators[0].with.areas.push({ id: 'home', kind: 'town' }, { id: 'gym2', kind: 'gym', connects: [{ to: 'nowhere' }] });
  const got = codes(bad);
  for (const c of ['start_unknown', 'id_duplicate', 'connect_unknown', 'gym_leader_missing']) assert.ok(got.includes(c), `${c} in ${got}`);
  const kind = doc(); kind.spaces[0].generators[0].with.areas[0].kind = 'castle';
  assert.ok(codes(kind).includes('param_option'));
});
