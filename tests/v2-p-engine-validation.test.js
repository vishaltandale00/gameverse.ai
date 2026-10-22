// Validation matrix over every registered engine.* primitive except engine.generate.* (listed from the
// catalogue, so a new engine primitive is covered or fails the coverage test). For each primitive:
//   1. preflight + boot of a minimal document built from its card defaults;
//   2. spaces: spaceConformance for each host configuration and capability variant;
//   3. the composition the planner produces (movement for the space, combat.health, collectible, race,
//      plot.storyboard; first playable furnishes the world): no crash problems (viability), a player who
//      can act (options, or some input changes state) and deterministic replay;
//   4. the browser path: withDefaultInput + withDefaultGraphics still preflight, and every defaulted binding
//      maps to a verb the document's primitives register (or an input axis they read), with no
//      input_verb_unread warning.
// Then one regression test per engine fix. Budgets are small: this is the routine check; the broad
// cross-host sweep (every primitive on every host) is v2/tools-style qualification work, not CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalogue, defaultsOf, spaceVariants, satisfying } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';
import { spaceConformance } from '../v2/kernel/testing.js';
import { verifyDocument, viability } from '../v2/planner/verify-adapter.js';
import { firstPlayable, replayCheck } from '../v2/planner/first-playable.js';
import { withDefaultInput } from '../v2/web/input-defaults.js';
import { withDefaultGraphics } from '../v2/primitives/graphics/ui-defaults.js';
import { boardOf } from '../v2/verify/strategies/common.js';
import { verify } from '../v2/verify/index.js';

const { registry, logic } = await loadCatalogue();
const prims = registry.ids().map(i => registry.get(i));
// Adapters (card.adapts) project one concept onto another: they exist only bound to a pair, configured by it, so they
// have no standalone defaults; tests/v2-p-adapt-*.test.js run them on real pairs.
const ENGINE = registry.ids().filter(id => id.startsWith('engine.') && !id.startsWith('engine.generate.') && !registry.get(id).card?.adapts);
const isSpace = id => id.startsWith('engine.space.');

const HEAD = { schema: 'gameverse.v2.game/0.2', id: 'ev', title: 'Engine validation', seed: 7 };
const hero = { id: 'hero', kind: 'player', components: { health: { max: 5 } } };
const coin = { id: 'coin', kind: 'pickup', components: { collectible: { counter: 'coins', value: 1 } } };
const car = { id: 'car', kind: 'vehicle', components: { vehicle: { seats: 2, health: 100, fuel: 50 }, car: {} } };
const crate = { id: 'crate', kind: 'prop', components: { body: { size: [0.8, 0.8, 0.8], solid: true }, rigid: { mass: 1 } } };
const crateRule = { id: 'crates', archetype: 'crate', near: 'player', spread: 2, count: [2, 2], activation: 'always', respawnSec: 0 };
/** Configurations that make a primitive do something (its defaults alone are often inert: no portals, no rules). */
const EXERCISE = {
  'engine.portal': { portals: [{ id: 'p1', from: { zone: 'start' }, to: { zone: 'goal' } }] },
  'engine.zones': { discoverRadius: 3, rules: [{ zone: 'mid', onEnter: [{ do: 'set_flag', flag: 'mid' }] }] },
  'engine.time': { dayLength: 60, timers: [{ id: 't', seconds: 0.5, autostart: true, repeat: true, do: [{ do: 'add_var', var: 'ticks', amount: 1 }] }] },
  'engine.spawner': { rules: [{ id: 'coins', archetype: 'coin', zone: 'mid', count: [3, 3], activation: 'always' }] },
  'engine.save': { intervalSec: 1 },
  'engine.weather': { states: [{ id: 'clear', minMin: 0.05, maxMin: 0.06 }, { id: 'rain', minMin: 0.05, maxMin: 0.06 }], initial: 'clear', transitionSec: 0.1 },
  'engine.physics.body': { separate: true },
};
const NEEDS_CRATES = new Set(['engine.physics.rigid', 'engine.physics.body', 'engine.physics.character']);
const stepN = (rt, n, input = {}) => { for (let i = 0; i < n && rt.state.status === 'playing'; i++) rt.step(structuredClone(input)); };
/** What the exercised primitive must have done in the composed world (true, or why not). */
const PROBES = {
  'engine.portal': rt => { rt.run([{ do: 'teleport', zone: 'start' }]); rt.step(); stepN(rt, 3, { actions: { use_portal: true } }); stepN(rt, 30); return (rt.state.counts.portal_used >= 1 && rt.test({ zone: 'goal' })) || `portal not used (zone ${rt.player().zone})`; },
  'engine.zones': rt => { rt.run([{ do: 'teleport', zone: 'mid' }]); stepN(rt, 30); return Boolean(rt.state.flags.mid) || `zone rule never fired (zone ${rt.player().zone})`; },
  'engine.time': rt => { stepN(rt, 90); return rt.state.vars.ticks >= 1 || 'timer never ran'; },
  'engine.spawner': rt => { stepN(rt, 30); const n = Object.values(rt.state.entities).filter(e => e.archetype === 'coin').length; return n >= 3 || `spawned ${n} of 3 coins`; },
  'engine.save': rt => { stepN(rt, 90); return rt.state.counts.saved >= 1 || 'never saved'; },
  'engine.weather': rt => { stepN(rt, 600); return rt.state.counts.weather_changed >= 1 || 'weather never changed'; },
  ...Object.fromEntries([...NEEDS_CRATES].map(id => [id, rt => {
    stepN(rt, 65);
    const cs = Object.values(rt.state.entities).filter(e => e.archetype === 'crate');
    return (cs.length === 2 && cs.every(c => !Array.isArray(c.at) || c.at.every(Number.isFinite))) || `crates: ${JSON.stringify(cs.map(c => c.at))}`;
  }])),
};
/** The extra systems that put an engine primitive into a composition (exercised, with what it acts on). */
const extraFor = id => isSpace(id) ? [] : [...(NEEDS_CRATES.has(id) ? [{ use: 'engine.spawner', with: { rules: [crateRule] } }] : []), { use: id, ...(EXERCISE[id] ? { with: EXERCISE[id] } : {}) }];
const BLOCKS = [{ id: 'stone', solid: true }, { id: 'grass', solid: true }, { id: 'dirt', solid: true }, { id: 'water', solid: false, tags: ['liquid'] }];
const rects = (w, h) => [{ id: 'start', rect: [1, 1, 8, 8] }, { id: 'mid', rect: [Math.floor(w / 2) - 4, 1, Math.floor(w / 2) + 4, Math.min(h - 1, 8)] }, { id: 'goal', rect: [w - 8, 1, w - 1, 8] }];
const exits = [{ id: 'start', exits: [{ to: 'mid' }] }, { id: 'mid', exits: [{ to: 'start' }, { to: 'goal' }] }, { id: 'goal', exits: [{ to: 'mid' }] }];
const lanes = [{ id: 'start', range: [0, 10] }, { id: 'mid', range: [80, 100] }, { id: 'goal', range: [180, 200] }];
const discs = [{ id: 'start', center: [20, 20], r: 10 }, { id: 'mid', center: [64, 64], r: 10 }, { id: 'goal', center: [108, 108], r: 10 }];
const boxes = [{ id: 'start', bounds: { min: [0, 0, 0], max: [16, 64, 16] } }, { id: 'mid', bounds: { min: [32, 0, 32], max: [48, 64, 48] } }, { id: 'goal', bounds: { min: [64, 0, 64], max: [80, 64, 80] } }];

/** Host spaces as the planner uses them: one per space kind and primary view, with the movement that fits. */
const HOSTS = {
  'tilemap-side': { view: 'side', space: { use: 'engine.space.tilemap', with: { size: [40, 16], mode: 'side' }, zones: rects(40, 16) }, at: [3.5, 3.5], move: ['gameplay.move.platformer'] },
  'tilemap-td': { view: 'td', space: { use: 'engine.space.tilemap', with: { size: [40, 30], mode: 'topdown' }, zones: rects(40, 30) }, at: [3.5, 3.5], move: ['gameplay.move.walk'] },
  'grid-board': { view: 'board', space: { use: 'engine.space.grid', with: { size: [16, 16] }, zones: rects(16, 16) }, at: [2, 2], move: ['gameplay.move.grid'] },
  'grid-td': { view: 'td', space: { use: 'engine.space.grid', with: { size: [16, 16], wrap: 'x' }, zones: rects(16, 16) }, at: [2, 2], move: ['gameplay.move.grid'] },
  'physics2d-side': { view: 'side', space: { use: 'engine.space.physics2d', with: { bounds: [40, 16] }, zones: rects(40, 16) }, at: [3.5, 1], move: ['gameplay.move.platformer'] },
  'physics2d-td': { view: 'td', space: { use: 'engine.space.physics2d', with: { bounds: [40, 30], gravity: [0, 0] }, zones: rects(40, 30) }, at: [3.5, 3.5], move: ['gameplay.move.walk'] },
  'arena2d-side': { view: 'side', space: { use: 'engine.space.arena2d', with: { size: [40, 12], gravity: -30, solids: [[0, 0, 40, 1]] }, zones: rects(40, 12) }, at: [3.5, 2], move: ['gameplay.move.platformer'] },
  'arena2d-td': { view: 'td', space: { use: 'engine.space.arena2d', with: { size: [40, 30] }, zones: rects(40, 30) }, at: [3.5, 3.5], move: ['gameplay.move.walk'] },
  'track-3p': { view: '3p', space: { use: 'engine.space.track', with: { length: 200 }, zones: lanes }, at: [2, 1, 0], move: ['gameplay.vehicle.core', 'gameplay.vehicle.car'], vehicle: true },
  'track-td': { view: 'td', space: { use: 'engine.space.track', with: { length: 200, loop: true }, zones: lanes }, at: [2, 1, 0], move: ['gameplay.move.lanes'] },
  'graph-text': { view: 'text', space: { use: 'engine.space.graph', zones: exits }, at: 'start', move: [] },
  'graph-map': { view: 'map', space: { use: 'engine.space.graph', zones: exits }, at: 'start', move: [] },
  'none-ui': { view: 'ui', space: { use: 'engine.space.none', zones: [{ id: 'start' }, { id: 'mid' }, { id: 'goal' }] }, at: 'start', move: ['plot.dialogue'], dialogue: true },
  'mesh3d-3p': { view: '3p', space: { use: 'engine.space.mesh3d', with: { size: [128, 128], baseHeight: 10 }, zones: discs }, at: [20, 20], move: ['gameplay.move.walk', 'gameplay.vehicle.core', 'gameplay.vehicle.car'], vehicle: true },
  'mesh3d-1p': { view: '1p', space: { use: 'engine.space.mesh3d', with: { size: [128, 128], baseHeight: 10 }, zones: discs }, at: [20, 20], move: ['gameplay.move.walk'] },
  'voxel-3p': { view: '3p', space: { use: 'engine.space.voxel', with: { chunk: [16, 32, 16], height: 64, ground: 4, groundBlock: 'stone' }, zones: boxes }, at: [8.5, 4.9, 8.5], move: ['gameplay.move.walk'] },
  'voxel-1p': { view: '1p', space: { use: 'engine.space.voxel', with: { chunk: [16, 32, 16], height: 64, ground: 4, groundBlock: 'stone' }, zones: boxes }, at: [8.5, 4.9, 8.5], move: ['gameplay.move.walk'] },
};
// Cheap hosts first: a non-space primitive is composed on the first host it fits.
const HOST_ORDER = ['tilemap-side', 'tilemap-td', 'grid-board', 'arena2d-side', 'physics2d-side', 'track-3p', 'graph-text', 'none-ui', 'mesh3d-3p', 'voxel-3p', ...Object.keys(HOSTS)];

const capsOf = host => { const p = registry.get(host.space.use), c = { ...defaultsOf(p.card), ...(host.space.with || {}) }; return new Set(p.capabilities ? p.capabilities(c) : p.card.provides?.capabilities || []); };
const fits = (id, host) => {
  const card = registry.get(id).card, caps = capsOf(host), views = card.views || ['any'];
  return (card.requires?.capabilities || []).every(c => caps.has(c)) && (views.includes('any') || views.includes(host.view));
};
const closure = (id, seen = new Set()) => { if (seen.has(id)) return []; seen.add(id); return (registry.get(id).card.requires?.primitives || []).flatMap(r => { const s = satisfying(registry, r); return s ? [...closure(s, seen), s] : []; }); };
const hostOf = id => isSpace(id) ? null : HOST_ORDER.find(n => fits(id, HOSTS[n])) || null;
const hostsOf = id => isSpace(id) ? Object.keys(HOSTS).filter(n => HOSTS[n].space.use === id) : [hostOf(id)].filter(Boolean);

/** The planner-shaped document: the host's movement, the common gameplay primitives and a one-beat story. */
function composed(host, extra = []) {
  const sys = [];
  const add = (use, w) => {
    const have = sys.find(s => s.use === use);
    if (have && w?.rules && have.with?.rules) have.with.rules.push(...structuredClone(w.rules).filter(r => !have.with.rules.some(x => x.id === r.id)));
    else if (!have) sys.push(w ? { use, with: structuredClone(w) } : { use });
  };
  if (host.vehicle) add('engine.spawner', { rules: [{ id: 'car', archetype: 'car', near: 'player', spread: 1.5, unique: true, activation: 'always', respawnSec: 0 }] });
  const zones = host.space.zones;
  const wanted = [...host.move.map(use => ({ use })), { use: 'gameplay.combat.health' },
    ...(fits('gameplay.collectible', host) ? [{ use: 'gameplay.collectible', with: { counters: [{ id: 'coins', var: 'coins' }] } }] : []),
    ...(fits('gameplay.race', host) ? [{ use: 'gameplay.race', with: { checkpoints: zones.map(z => z.id), laps: 1, countdown: 0 } }] : []),
    { use: 'plot.storyboard' }, ...extra];
  for (const s of wanted) { for (const d of closure(s.use)) add(d); add(s.use, s.with); }
  const beats = [...(host.dialogue ? [{ id: 'open', do: [{ do: 'start_dialogue', dialogue: 'intro' }] }] : []), { id: 'arrive', when: { zone: 'goal' }, do: [{ do: 'end_game', ending: 'win' }] }];
  return {
    ...HEAD, views: { primary: host.view }, spaces: [{ id: 'world', ...structuredClone(host.space) }], systems: sys,
    plot: { storyboard: { acts: [{ id: 'a1', beats }] }, endings: [{ id: 'win', kind: 'win', title: 'Won' }],
      ...(host.dialogue ? { dialogue: { intro: { start: 'n1', nodes: { n1: { say: 'Where to?', choices: [{ text: 'Onward', do: [{ do: 'teleport', zone: 'goal' }], end: true }, { text: 'Wait', next: 'n1' }] } } } } } : {}) },
    content: { blocks: BLOCKS, archetypes: [hero, coin, car, crate] }, player: { archetype: 'hero', at: structuredClone(host.at) },
  };
}
const errs = r => r.errors.map(e => `${e.code} ${e.path}: ${e.message}`);
const boot = doc => { const r = preflight(doc, registry, logic); assert.deepEqual(errs(r), []); return { pre: r, rt: createWorld(r.doc, registry, logic, { seed: 7 }) }; };

test('coverage: every registered engine primitive (except generators) has a host in this matrix', () => {
  assert.ok(ENGINE.length >= 26, `engine primitives listed from the catalogue: ${ENGINE.length}`);
  assert.deepEqual(ENGINE.filter(id => !hostsOf(id).length), [], 'add a host for these (a space kind, or a space providing their capabilities and views)');
});

// ---------- 1. preflight from card defaults ----------
for (const id of ENGINE) {
  test(`${id}: preflights and boots from its card defaults`, () => {
    const card = registry.get(id).card;
    const host = isSpace(id) ? HOSTS[hostsOf(id)[0]] : HOSTS[hostOf(id)];
    const doc = isSpace(id)
      ? { ...HEAD, spaces: [{ id: 'world', use: id, with: defaultsOf(card) }], systems: [], content: { blocks: BLOCKS, archetypes: [hero] }, player: { archetype: 'hero', at: structuredClone(host.at) } }
      : { ...HEAD, views: { primary: host.view }, spaces: [{ id: 'world', ...structuredClone(host.space) }], systems: [...closure(id).map(use => ({ use })), { use: id, with: defaultsOf(card) }], content: { blocks: BLOCKS, archetypes: [hero] }, player: { archetype: 'hero', at: structuredClone(host.at) } };
    const { rt } = boot(doc);
    for (let i = 0; i < 5; i++) rt.step();
    assert.ok(rt.player(), 'the player spawned');
  });
}

// ---------- 2. space conformance ----------
for (const id of ENGINE.filter(isSpace)) {
  for (const name of hostsOf(id)) for (const variant of spaceVariants(registry, id)) {
    const make = () => { const d = composed(HOSTS[name]); d.systems = []; delete d.plot; d.spaces[0].with = { ...(d.spaces[0].with || {}), ...variant.with }; return d; };
    const { rt } = boot(make());
    const free = structuredClone(rt.player().at), other = typeof free === 'string' ? 'mid' : free.map((v, i) => (i === 0 ? v + 2 : v));
    spaceConformance(test, assert, { name: `${id} [${name}${Object.keys(variant.with).length ? ' ' + JSON.stringify(variant.with) : ''}]`, primitives: prims, doc: make, free, other });
  }
}

// ---------- 3. planner composition: viable, the player acts, replay is deterministic ----------
function canAct(make) {
  const base = make(); for (let i = 0; i < 3; i++) base.step();
  if (base.availableOptions().length) return 'options';
  const snap = base.snapshot(), idle = make(); idle.restore(structuredClone(snap)); for (let i = 0; i < 10; i++) idle.step({});
  const still = JSON.stringify(idle.snapshot().entities.player);
  for (const input of [{ axes: { move: [1, 0] } }, { axes: { move: [0, 1] } }, ...base.actions().map(a => ({ actions: { [a]: true } }))]) {
    const t = make(); t.restore(structuredClone(snap));
    for (let i = 0; i < 10; i++) t.step(structuredClone(input));
    if (JSON.stringify(t.snapshot().entities.player) !== still) return Object.keys(input.axes || input.actions)[0];
  }
  return null;
}
for (const id of ENGINE) for (const name of hostsOf(id)) {
  test(`${id}: planner composition on ${name} is viable, playable and replays deterministically`, async () => {
    const doc = composed(HOSTS[name], extraFor(id));
    const fp = firstPlayable(doc, registry, logic, { seed: 7 });
    assert.ok(fp.ok, JSON.stringify(fp.errors));
    assert.deepEqual(fp.removed.map(r => `${r.use}: ${r.why}`), [], 'first playable isolated a primitive');
    const v = await verifyDocument(fp.doc, registry, logic, { budgetMs: 200, maxStates: 500, playtestMs: 150 });
    // These are engine test worlds, not games (no win by design): they must not crash; the game gate is tested elsewhere.
    const crash = viability(v.playtest, v.problems);
    assert.equal(crash.viable, true, crash.viability);
    const make = () => createWorld(fp.doc, registry, logic, { seed: 7 });
    assert.ok(make().player(), 'the player exists');
    assert.ok(canAct(make), 'the player can act: options, or some input changes the state');
    if (PROBES[id]) assert.equal(PROBES[id](make()), true, `${id} did its job in the composed world`);
    assert.equal(replayCheck(fp.doc, registry, logic, { seed: 7, steps: 60 }).deterministic, true, 'same doc, seed and inputs replay to the same state');
  });
}

// ---------- 4. browser path: defaulted input and graphics ----------
for (const id of ENGINE) for (const name of hostsOf(id)) {
  test(`${id}: browser defaults on ${name} preflight and bind only registered verbs`, () => {
    const host = HOSTS[name], d0 = composed(host, extraFor(id));
    const doc = { ...d0, systems: withDefaultInput(d0, registry), graphics: withDefaultGraphics(d0, registry) };
    const { pre, rt } = boot(doc);
    rt.step();
    assert.deepEqual(pre.warnings.filter(w => w.code === 'input_verb_unread').map(w => w.path), []);
    const input = pre.doc.systems.find(s => s.use === 'engine.input.actions');
    if (!input) { assert.ok(rt.availableOptions().length, 'no device input: the game must be option-driven'); return; }
    const registered = new Set(rt.actions()), axes = new Set(input.with.axes);
    const read = new Set(pre.doc.systems.flatMap(s => [...(registry.get(s.use).card.provides?.actions || []), ...Object.keys(registry.get(s.use).card.actionSpace || {})]));
    if (['1p', '3p', 'iso'].includes(host.view)) read.add('look'); // the 3D camera reads look
    const bound = Object.keys(input.with.bindings[host.view] || {});
    assert.deepEqual(bound.filter(v => !registered.has(v) && !(axes.has(v) && read.has(v))), [], `bound: ${bound.join(', ')}`);
    if (read.has('move')) assert.ok(bound.includes('move'), 'the move axis a primitive reads is bound');
  });
}

// ---------- regressions ----------
const graphDoc = (beats = []) => ({ ...HEAD, spaces: [{ id: 'w', use: 'engine.space.graph', zones: [{ id: 'a', exits: [{ to: 'b' }] }, { id: 'b', exits: [{ to: 'a' }] }] }],
  systems: [{ use: 'plot.storyboard' }], plot: { storyboard: { acts: [{ id: 'a1', beats }] }, endings: [{ id: 'win', kind: 'win' }] }, content: { archetypes: [{ id: 'hero', components: {} }] }, player: { archetype: 'hero', at: 'a' } });

test('regression engine.space.graph: typed enter_zone/leave_zone, entity.zone kept current, go declared', () => {
  const r = preflight(graphDoc([{ id: 'x', when: { count: 'enter_zone:b', gte: 1 }, do: [{ do: 'end_game', ending: 'win' }] }]), registry, logic);
  assert.deepEqual(errs(r), []);
  assert.deepEqual(r.warnings.filter(w => w.code === 'event_never_emitted').map(w => w.message), [], 'the card declares enter_zone:*');
  assert.ok(registry.get('engine.space.graph').card.provides.actions.includes('go'), 'the go verb the space registers is declared');
  const rt = createWorld(r.doc, registry, logic, { seed: 1 });
  assert.equal(rt.player().zone, 'a', 'placement sets entity.zone');
  rt.step({ actions: { go: 'b' } }); rt.step();
  assert.equal(rt.player().zone, 'b');
  assert.equal(rt.state.counts['leave_zone:a'], 1);
  assert.equal(rt.state.status, 'won', 'a beat waiting on enter_zone:b fires');
});

test('regression engine.space.voxel / mesh3d: typed zone events are declared and leave_zone is typed', () => {
  for (const name of ['voxel-3p', 'mesh3d-1p']) {
    const host = HOSTS[name], doc = composed(host);
    doc.plot.storyboard.acts[0].beats.push({ id: 'left', when: { count: 'leave_zone:start', gte: 1 }, do: [{ do: 'set_flag', flag: 'left' }] }, { id: 'entered', when: { count: 'enter_zone:start', gte: 1 }, do: [{ do: 'set_flag', flag: 'in' }] });
    const r = preflight(doc, registry, logic);
    assert.deepEqual(r.warnings.filter(w => w.code === 'event_never_emitted').map(w => w.message), [], name);
    const rt = createWorld(r.doc, registry, logic, { seed: 7 }), api = rt.space('world');
    rt.step();
    const far = typeof host.at[1] === 'number' && host.at.length === 3 ? [100.5, host.at[1], 100.5] : [100, 100];
    api.setPos(rt.player(), far, rt); rt.step();
    assert.ok(rt.state.counts['leave_zone:start'] >= 1, `${name}: leave_zone:start`);
  }
});

test('regression engine.space.mesh3d: a map whose nav grid exactly fits reachNodes is not truncated, and repeated fills are memoised', () => {
  const doc = composed(HOSTS['mesh3d-1p']); doc.spaces[0].with = { size: [256, 256], baseHeight: 10 }; // 256 x 256 cells = reachNodes 65536
  doc.spaces[0].zones = [{ id: 'start', center: [20, 20], r: 10 }, { id: 'mid', center: [128, 128], r: 10 }, { id: 'goal', center: [220, 220], r: 10 }];
  const { rt } = boot(doc), api = rt.space('world');
  const a = api.reachable(rt.player().at, rt, {});
  assert.equal(a.truncated, false);
  assert.ok(a.has('goal'), 'the whole open map is reached');
  assert.equal(api.reachable([30, 30], rt, {}), a, 'a start in the same component reuses the fill');
  api.addObject({ at: [60, 60], shape: 'box', size: [4, 4, 4], collider: true }, rt);
  assert.notEqual(api.reachable(rt.player().at, rt, {}), a, 'a world change recomputes');
});

test('regression engine.space.voxel: reachable is memoised per start cell and invalidated by edits', () => {
  const { rt } = boot(composed(HOSTS['voxel-1p'])), api = rt.space('world');
  for (let i = 0; i < 10; i++) rt.step();
  const p = rt.player(), a = api.reachable(p.at, rt, {});
  assert.equal(api.reachable(p.at, rt, {}), a, 'same start, options and world: same fill');
  const snap = rt.snapshot();
  api.setCell([p.at[0] + 2, p.at[1], p.at[2]], 'stone', rt);
  const b = api.reachable(p.at, rt, {});
  assert.notEqual(b, a, 'an edit recomputes');
  rt.restore(snap);
  assert.deepEqual([...api.reachable(p.at, rt, {})].sort(), [...a].sort(), 'restore gives the original reachability');
});

test('regression verify on engine.space.voxel: an unbounded cell space is not taken for a board (the verifier used to hang)', async () => {
  const { rt, pre } = boot(composed(HOSTS['voxel-3p']));
  assert.equal(boardOf(rt), null, 'voxel size is [Infinity, H, Infinity]');
  const t = performance.now();
  const r = await verify(pre.doc, registry, logic, { seed: 7, budgetMs: 400, plot: false, spatial: false, playtest: false, invariants: false });
  assert.ok(performance.now() - t < 10000, 'strategy selection finishes');
  assert.ok(r.strategies, 'the strategies stage ran');
});

test('regression verify on engine.space.none: options a start beat opens count as something to do (no stuck_state)', async () => {
  const fp = firstPlayable(composed(HOSTS['none-ui']), registry, logic, { seed: 7 });
  const r = await verify(fp.doc, registry, logic, { seed: 7, budgetMs: 400, plot: false, spatial: false, playtest: false, strategies: false });
  assert.deepEqual(r.problems.filter(p => p.code === 'stuck_state').map(p => p.message), []);
});

test('regression engine.space.track + gameplay.move.lanes: the runner advances along progress (x) and switches lanes on y, not up the height axis', () => {
  const { rt } = boot(composed(HOSTS['track-td'])), p = rt.player();
  stepN(rt, 2);
  const start = p.at.slice();
  stepN(rt, 30);
  assert.ok(p.at[0] > start[0] + 1, `progress grows: ${start} -> ${p.at}`);
  assert.ok(Math.abs(p.at[2] - start[2]) < 1e-6, `stays on the ground: ${p.at}`);
  stepN(rt, 1, { actions: { right: true } }); stepN(rt, 30);
  assert.ok(p.at[1] > start[1] + 0.5, `a lane switch moves across lanes (y): ${p.at}`);
  rt.run([{ do: 'teleport', zone: 'goal' }]); stepN(rt, 2);
  assert.ok(rt.test({ zone: 'goal' }), 'a teleport along the track is kept');
});

test('regression browser path: a car on a track gets the move axis it steers with (vehicle.core declares actionSpace.move)', () => {
  const d0 = composed(HOSTS['track-3p']);
  const input = withDefaultInput(d0, registry).find(s => s.use === 'engine.input.actions');
  assert.ok(input.with.verbs.includes('move'));
  assert.ok(input.with.bindings['3p'].move?.length, 'move is bound in the primary view');
  const { rt } = boot({ ...d0, systems: withDefaultInput(d0, registry) });
  for (let i = 0; i < 5; i++) rt.step();
  rt.step({ actions: { enter_vehicle: true } });
  const before = rt.player().at.slice();
  for (let i = 0; i < 30; i++) rt.step({ axes: { move: [0, 1] } });
  assert.notDeepEqual(rt.player().at, before, 'the move axis drives the car');
});

test('regression browser path: option-driven graph/none documents with an input instance bind no dead move axis', () => {
  for (const name of ['graph-text', 'none-ui']) {
    const d0 = composed(HOSTS[name]); d0.systems.unshift({ use: 'engine.input.actions' });
    const input = withDefaultInput(d0, registry).find(s => s.use === 'engine.input.actions');
    assert.deepEqual(input.with.verbs, ['menu'], name);
    assert.deepEqual(input.with.bindings, {}, name);
  }
});

test('regression engine.input.actions: preflight warns (input_verb_unread) when a bound verb is declared by no primitive', () => {
  const d = composed(HOSTS['tilemap-side']);
  d.systems.unshift({ use: 'engine.input.actions', with: { verbs: ['move', 'jump', 'teleport_home'], bindings: { side: { move: ['arrows'], jump: ['space'], teleport_home: ['t'] } } } });
  const r = preflight(d, registry, logic);
  assert.deepEqual(errs(r), []);
  assert.deepEqual(r.warnings.filter(w => w.code === 'input_verb_unread').map(w => w.path), ['systems[0].with.bindings.side.teleport_home']);
});
