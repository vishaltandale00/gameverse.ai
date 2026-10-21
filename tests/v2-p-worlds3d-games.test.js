// Integration targets: Blockport (voxel) and Emberfall (mesh3d). Every
// instance of a worlds3d primitive in v2/games/*.json preflights with zero
// param errors, and the 3D worlds generate their starting area headless.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';
import WORLDS3D from '../v2/primitives/engine/worlds3d.index.js';
import { worldOnly, instanceParamErrors } from '../v2/primitives/engine/worlds3d-lib-testing.js';

const { registry, logic } = catalogue();
const OURS = WORLDS3D.map(p => p.id);
const load = name => JSON.parse(fs.readFileSync(new URL(`../v2/games/${name}`, import.meta.url), 'utf8'));
const games = fs.readdirSync(new URL('../v2/games/', import.meta.url)).filter(f => f.endsWith('.json'));

test('games: every worlds3d instance in v2/games has zero param errors', () => {
  let seen = 0;
  for (const g of games) {
    const doc = load(g);
    seen += doc.spaces.reduce((n, s) => n + (OURS.includes(s.use) ? 1 : 0) + (s.generators || []).filter(x => OURS.includes(x.use)).length, 0);
    assert.deepEqual(instanceParamErrors(doc, registry, OURS), [], g);
  }
  assert.ok(seen >= 20, `${seen} instances checked`);
});

const build = (name, opts = {}) => {
  const doc = worldOnly(load(name), registry, opts);
  const t0 = performance.now(), checked = preflight(doc, registry, logic), t1 = performance.now();
  assert.ok(checked.ok, JSON.stringify(checked.errors.slice(0, 5)));
  const rt = createWorld(checked.doc, registry, logic), t2 = performance.now();
  return { rt, ms: { preflight: +(t1 - t0).toFixed(1), world: +(t2 - t1).toFixed(1) } };
};

test('games: Blockport generates its starting chunks deterministically', t => {
  const { rt, ms } = build('blockport.json'), p = rt.player(), api = rt.space(p.space);
  const t0 = performance.now(), near = api.chunksNear(p.at, 2), counts = {};
  for (const c of near) { const ch = api.chunkCells(...c); for (const v of ch.cells) if (v) counts[ch.palette[v]] = (counts[ch.palette[v]] || 0) + 1; }
  t.diagnostic(`blockport: preflight ${ms.preflight} ms, world+lazy build ${ms.world} ms, ${near.length} start chunks ${(performance.now() - t0).toFixed(1)} ms`);
  assert.equal(p.zone, 'harbor_row');
  for (const b of ['stone', 'grass', 'dirt', 'bedrock', 'planks', 'asphalt']) assert.ok(counts[b] > 0, `${b}: ${counts[b]}`);
  const gen = rt.state.spaces.blockport.generated;
  assert.ok(gen.info.lots > 100 && gen.info.buildings > 50 && gen.info.roads === 8 && gen.info.structures > 30, JSON.stringify(gen.info));
  assert.ok(gen.problems.every(x => ['road_wet', 'rivers_short', 'lakes_short', 'structure_unplaced'].includes(x.code)), JSON.stringify(gen.problems));
  const s = rt.service('structures');
  assert.equal(s.get('lot_breakwater').kind, 'lot');
  assert.ok(s.get('tower_three').size[2] >= 88, `tall tower: ${JSON.stringify(s.get('tower_three').size)}`);
  assert.ok(s.get('deep_works_core').underground, `vault hall underground at ${s.get('deep_works_core').at}`);
  assert.equal(api.getCell([0, 20, -420]), null, 'the underground vault hall is hollow');
  assert.ok(rt.service('caves').rooms().some(r => r.zone === 'the_deep_works' && r.entrance));
  assert.ok(rt.service('lotAt').lots('old_quarter').some(l => l.building?.landmark === 'clocktower'), 'city landmark');
  assert.equal(rt.service('lotAt').lots('glass_heights').some(l => l.building?.landmark === 'radio_studio'), false, 'pinned structures provide their own landmarks');
  assert.ok(rt.service('roadgraph')().edges.some(e => e.surface === 'rail'));
  // Spatial verification: every Blockport zone is reachable on foot from the start (cell flood, then the coarse
  // surface flood, then the proven cave tunnel into the Deep Works).
  const reach = api.reachable(p.at, rt, {});
  assert.deepEqual(rt.doc.spaces[0].zones.map(z => z.id).filter(z => !reach.has(z)), []);
  assert.ok(reach.coarse && reach.has(api.cellOf(p)));
  const again = build('blockport.json').rt, A = again.space(p.space);
  assert.deepEqual(Array.from(A.chunkCells(...near[5]).cells), Array.from(api.chunkCells(...near[5]).cells));
  for (let i = 0; i < 20; i++) { rt.step(); again.step(); }
  assert.deepEqual(again.snapshot(), rt.snapshot());
});

test('games: Emberfall generates its realm and the undercroft headless', t => {
  const { rt, ms } = build('emberfall.json'), p = rt.player(), api = rt.space('realm');
  const t0 = performance.now();
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) api.heightTile(Math.floor(p.at[0] / (64 * api.heightRes)) + dx, Math.floor(p.at[2] / (64 * api.heightRes)) + dz);
  const objs = api.objects({ min: [p.at[0] - 700, p.at[2] - 700], max: [p.at[0] + 700, p.at[2] + 700] });
  t.diagnostic(`emberfall: preflight ${ms.preflight} ms, world+lazy build ${ms.world} ms, 9 height tiles + ${objs.length} objects in the 1.4 km start square ${(performance.now() - t0).toFixed(1)} ms`);
  assert.equal(p.zone, 'hearth_vale');
  assert.ok(Math.abs(p.at[1] - p.components.body.size[1] / 2 - api.groundAt(p.at[0], p.at[2]).y) < 1e-6, 'player stands on the terrain');
  const s = rt.service('structures')();
  for (const id of ['vale_forge', 'gretch_hollow', 'broken_bridge', 'crown_spire_mouth', 'hollow_barrow_mouth']) assert.ok(s.some(x => x.id === id), id);
  assert.ok(s.filter(x => x.group === 'gildmere_city').length >= 60);
  assert.ok(rt.service('roadgraph')().edges.length >= 9);
  assert.ok(objs.some(o => o.model === 'campfire') || objs.some(o => o.model === 'chest'), 'scattered props near the start');
  assert.ok(rt.state.spaces.realm.generated.problems.every(x => ['rivers_short', 'scatter_density_capped', 'structure_unplaced', 'lakes_short'].includes(x.code)), JSON.stringify(rt.state.spaces.realm.generated.problems));
  const reach = api.reachable(p.at, rt, {});
  assert.deepEqual(rt.doc.spaces.find(x => x.id === 'realm').zones.map(z => z.id).filter(z => !reach.has(z)), [], 'every realm zone reachable (roads and bridges join the islands)');
  // The undercroft is a separate flat mesh3d space with its own structures.
  const u = rt.space('undercroft');
  assert.ok(u.objects().some(o => o.group?.startsWith('barrow_chambers')));
  assert.ok(rt.service('structures').of('undercroft').call().some(x => x.id === 'spire_atrium_1'));
  assert.ok(rt.service('biomeAt')(p.at[0], p.at[2]) === 'meadow');
});

test('games: generators on a non-3D space (Hollow Lantern tilemap) record why they did nothing', () => {
  const doc = worldOnly(load('hollow-lantern.json'), registry, { systems: ['gameplay.inventory', 'gameplay.progression.abilities', 'plot.gate'] }); // the gates' predicate owners are stated explicitly
  const checked = preflight(doc, registry, logic);
  assert.ok(checked.ok, JSON.stringify(checked.errors.slice(0, 5)));
  const rt = createWorld(checked.doc, registry, logic);
  const recorded = Object.values(rt.state.prim).filter(s => s.problems?.some(p => p.code === 'space_unsupported'));
  assert.equal(recorded.length, 2, 'structures and scatter');
});
