// gameplay.rest, gameplay.checkpoint, gameplay.collectible, gameplay.hazard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { doc, make, steps, checkWith, codes, gameInstances } from './v2-p-items-fixtures.js';
const health = (max, start = max) => ({ max, start });

const goTo = (rt, at) => rt.space('world').setPos(rt.player(), at, rt);
const hero = { id: 'hero', kind: 'player', components: { body: { size: [1, 1, 1] }, health: health(10) } };

// ---------- rest + checkpoint ----------
const camp = () => doc({ combat: true, resources: [{ id: 'stamina', max: 50, startFull: false, start: 1 }],
  systems: [{ use: 'gameplay.inventory' }, { use: 'gameplay.interact' }, { use: 'gameplay.rest', with: { skipTo: 'dawn', safeRequired: true, safeRadius: 6, respawnsEnemies: true } },
    { use: 'gameplay.checkpoint', with: { restoreAll: true, fastTravelBetween: true } }],
  content: { archetypes: [hero,
    { id: 'bed', kind: 'prop', components: { body: { size: [1, 1, 1] }, interact: { prompt: 'Sleep' }, rest: true, checkpoint: {} } },
    { id: 'flag', kind: 'prop', components: { body: { size: [1, 1, 1] }, checkpoint: { id: 'flag_east', touch: true } } },
    { id: 'wolf', kind: 'enemy', components: { body: { size: [1, 1, 1] } } }] },
});

test('rest/checkpoint: preflight, rest at a bed, unsafe rest, checkpoint respawn and fast travel', () => {
  const r = checkWith(camp()); assert.ok(r.ok, JSON.stringify(r.errors));
  const { rt } = make(camp());
  rt.state.vars['time.hour'] = 22; rt.player().components.health.hp = 2; rt.step();
  assert.equal(rt.state.vars.hp, 2); assert.equal(rt.state.vars['res.stamina'], 1);
  rt.spawn('bed', { id: 'bed_home', at: [2, 1, 0] });
  rt.spawn('flag', { at: [20, 1, 0] });
  rt.step({ actions: { interact: true } });
  assert.equal(rt.state.counts.rested, 1);
  assert.equal(rt.state.vars['time.hour'], 6, 'slept until dawn');
  assert.equal(rt.state.vars['time.day'], 1);
  assert.equal(rt.player().components.health.hp, 10); assert.equal(rt.state.vars['res.stamina'], 50, 'rest refilled the real pool');
  assert.equal(rt.state.counts.respawn_enemies, 1, 'rest resets enemies (the checkpoint here does not)');
  assert.ok(rt.test({ at_checkpoint: 'bed_home' }));
  // A wolf nearby makes resting unsafe.
  const wolf = rt.spawn('wolf', { at: [4, 1, 0] });
  rt.step({ actions: { interact: true } });
  assert.equal(rt.state.events.find(e => e.name === 'rest_denied').reason, 'unsafe');
  rt.despawn(wolf.id);
  // Touch checkpoint, then respawn there; fast travel back.
  goTo(rt, [20, 1, 0]); rt.step();
  assert.ok(rt.test({ at_checkpoint: 'flag_east' }));
  assert.equal(rt.state.counts['checkpoint_set:flag_east'], 1);
  goTo(rt, [28, 5, 0]); rt.run([{ do: 'respawn_at_checkpoint' }]);
  assert.deepEqual(rt.player().at, [20, 1, 0]);
  const opt = rt.availableOptions().find(o => o.actions.fast_travel === 'bed_home');
  assert.ok(opt);
  rt.step({ actions: opt.actions });
  assert.deepEqual(rt.player().at, [1, 1, 0], 'where the player stood when resting');
  rt.run([{ do: 'rest', hours: 3 }]);
  assert.equal(rt.state.vars['time.hour'], 9);
});

test('rest/checkpoint: replay is deterministic and bad configs are rejected', () => {
  const play = () => { const { rt } = make(camp()); rt.spawn('bed', { id: 'b', at: [2, 1, 0] }); for (let i = 0; i < 30; i++) rt.step({ actions: { interact: i % 5 === 0 } }); return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const d = camp();
  d.systems[2].with.skipTo = 'teatime';
  d.systems[3].with.restoreAll = 'yes';
  d.systems.push({ use: 'gameplay.rest', with: { hours: -2 } });
  const c = codes(checkWith(d));
  for (const code of ['rest_invalid', 'param_type', 'param_range']) assert.ok(c.includes(code), code);
});

test('rest/checkpoint: v2/games instances preflight without param errors', () => {
  for (const use of ['gameplay.rest', 'gameplay.checkpoint']) {
    const found = gameInstances(use); assert.ok(found.length >= 2, use);
    for (const x of found) assert.deepEqual(x.paramErrors, [], `${use} ${x.game}`);
  }
});

// ---------- collectible (maze pellets, power pellets, timed prize) ----------
const maze = () => doc({
  systems: [{ use: 'gameplay.collectible', with: { counters: [
    { id: 'dots', var: 'dots_eaten', points: 10, includes: ['power'], clearsLevel: true, spawnAtCount: [{ count: 3, archetype: 'cherry', at: [16, 8, 0], sec: 1 }, { fraction: 0.8, archetype: 'cherry', at: [16, 8, 0], sec: 1 }] },
    { id: 'power', points: 50, onCollect: [{ do: 'set_flag', flag: 'frightened' }] },
    { id: 'bonus', total: 99, points: 100 },
    { id: 'gems', zone: 'field', total: 2 },
  ] } }],
  content: { archetypes: [hero,
    { id: 'pellet', kind: 'pickup', components: { collectible: { counter: 'dots' } } },
    { id: 'power_pellet', kind: 'pickup', components: { collectible: { counter: 'power' } } },
    { id: 'cherry', kind: 'pickup', components: { collectible: { counter: 'bonus' } } },
    { id: 'gem', kind: 'pickup', components: { collectible: { counter: 'gems', magnet: 2 } } }] },
});
function mazeWorld() {
  const { rt } = make(maze());
  for (let x = 2; x <= 5; x++) rt.spawn('pellet', { at: [x, 1, 0] });
  rt.spawn('power_pellet', { at: [6, 1, 0] });
  rt.spawn('gem', { at: [12, 3, 0] });
  return rt;
}

test('collectible: pellets, power pellets, prizes at counts, magnet and level clear', () => {
  const r = checkWith(maze()); assert.ok(r.ok, JSON.stringify(r.errors));
  const rt = mazeWorld();
  rt.step();
  assert.equal(rt.service('collectible').total('dots'), 5, 'pellets + included power pellets');
  for (let x = 2; x <= 4; x++) { goTo(rt, [x, 1, 0]); rt.step(); }
  assert.equal(rt.state.vars.dots_eaten, 3);
  assert.equal(rt.state.counts.prize_spawned, 1, 'prize at 3');
  assert.equal(rt.state.vars.score, 30);
  steps(rt, 61);
  assert.equal(rt.state.counts.prize_expired, 1, 'prize timed out');
  goTo(rt, [5, 1, 0]); rt.step();
  assert.equal(rt.state.counts.prize_spawned, 2, 'prize at 80%');
  goTo(rt, [16, 8, 0]); rt.step();
  assert.equal(rt.state.counts['collected:bonus'], 1);
  goTo(rt, [6, 1, 0]); rt.step();
  assert.equal(rt.state.flags.frightened, true);
  assert.equal(rt.state.counts['counter_complete:dots'], 1);
  assert.equal(rt.state.counts.level_cleared, 1);
  assert.equal(rt.state.vars.score, 40 + 100 + 50);
  assert.ok(rt.test({ collected: 'dots', gte: 5 }));
  // The gem is pulled in from 2 units away by the magnet.
  goTo(rt, [12, 1.5, 0]);
  steps(rt, 30);
  assert.equal(rt.state.counts['collected:gems'], 1);
  assert.ok(rt.test({ collected: 'gems', zone: 'field', eq: 1 }));
});

test('collectible: replay is deterministic and bad configs are rejected', () => {
  const play = () => { const rt = mazeWorld(); for (let x = 0; x < 40; x++) { goTo(rt, [2 + (x % 6), 1, 0]); rt.step(); } return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const d = maze();
  d.systems[0].with.counters[0].includes = ['nope'];
  d.systems[0].with.counters[1].spawnAtCount = [{ archetype: 'cherry' }];
  d.systems[0].with.counters[2].zone = 'atlantis';
  d.content.archetypes.push({ id: 'coin', components: { collectible: { counter: 'coins' } } });
  d.plot = { storyboard: { acts: [{ id: 'a', beats: [{ id: 'b', when: { collected: 'nothing' } }] }] } };
  d.systems.push({ use: 'plot.storyboard' });
  const c = codes(checkWith(d));
  for (const code of ['counter_invalid', 'ref_unknown']) assert.ok(c.includes(code), code);
  assert.ok(checkWith(d).errors.filter(e => e.code === 'ref_unknown').length >= 3);
});

test('collectible: v2/games instances preflight without param errors', () => {
  const found = gameInstances('gameplay.collectible'); assert.ok(found.length >= 3);
  for (const x of found) assert.deepEqual(x.paramErrors, [], x.game);
});

// ---------- hazard ----------
// With the real combat owners (damage, kill, apply_status), or without them (hazards then only emit events).
const cave = (combat = true) => doc({
  combat, space: { gravity: 0 },
  systems: [{ use: 'gameplay.checkpoint' }, { use: 'gameplay.hazard', with: {
    types: [{ id: 'spikes', damage: 1, respawn: 'nearest-safe' }, { id: 'lava', dps: 4, status: 'burning' }, { id: 'pit', kill: true, respawn: 'checkpoint' }],
    volumes: [{ type: 'spikes', at: [10, 1, 0], size: [2, 1, 1] }],
    fallDamage: { minHeight: 3, perMeter: 2 }, killY: -1, killType: 'pit', window: { margin: 0 },
  } }],
  zones: [{ id: 'yard', rect: [0, 0, 8, 16] }, { id: 'magma', rect: [20, 0, 24, 16], tags: ['hazard:lava'] }],
  content: { statuses: [{ id: 'burning', duration: 3 }], archetypes: [{ ...hero, components: { ...hero.components, health: health(100) } }, { id: 'spike_ball', kind: 'prop', components: { body: { size: [1, 1, 1] }, hazard: { type: 'spikes' } } }] },
});

test('hazard: volumes, entities, zones, falls and kill planes', () => {
  const r = checkWith(cave()); assert.ok(r.ok, JSON.stringify(r.errors));
  const { rt } = make(cave());
  const hp = () => rt.player().components.health.hp;
  goTo(rt, [8, 1, 0]); rt.step();             // safe footing recorded (testSpace grounded = solid below? no gravity: body.grounded default)
  goTo(rt, [10, 1, 0]); rt.step();
  assert.equal(rt.state.counts['hazard_hit:spikes'], 1);
  assert.equal(hp(), 99); assert.equal(rt.state.vars.hp, 99);
  assert.deepEqual(rt.player().at, [8, 1, 0], 'returned to safe footing');
  rt.spawn('spike_ball', { at: [4, 6, 0] });
  goTo(rt, [4, 6, 0]); rt.step();
  assert.equal(rt.state.counts['hazard_hit:spikes'], 2, 'hazard entity');
  assert.equal(hp(), 98);
  // Lava zone: status on entry, 4 dps in 0.5 s ticks.
  goTo(rt, [21, 1, 0]); steps(rt, 60);
  assert.equal(rt.state.counts['hazard_hit:lava'], 1);
  assert.ok(rt.player().components.status.burning > 0, 'burning applied by gameplay.combat.status');
  assert.equal(hp(), 98 - 4, 'two 0.5 s ticks of 4 dps');
  goTo(rt, [2, 1, 0]); rt.step();
  assert.equal(rt.state.counts.hazard_exit, 1, 'left the lava (instant hazards respawned the player out)');
  // Falls: airborne from y=9 to landing at y=1 is 8 units, 5 over the minimum.
  rt.player().components.body.grounded = false; goTo(rt, [2, 9, 0]); rt.step();
  goTo(rt, [2, 1, 0]); rt.player().components.body.grounded = true; rt.step();
  assert.equal(rt.state.events.find(e => e.name === 'fell').damage, 10);
  assert.equal(hp(), 84);
  // Kill plane respawns at the start point (no checkpoint activated).
  goTo(rt, [3, -3, 0]); rt.step();
  assert.equal(rt.state.counts['hazard_hit:pit'], 1);
  assert.equal(rt.player().components.health.dead, true, 'killed through gameplay.combat.health');
  assert.deepEqual(rt.player().at, [1, 1, 0]);
});

test('hazard: rising window and space bounds kill the player', () => {
  const d = cave(false); d.systems[1].with = { types: d.systems[1].with.types, window: { margin: 3 } };
  const { rt } = make(d);
  goTo(rt, [2, 10, 0]); rt.step(); goTo(rt, [2, 7.5, 0]); rt.step();
  assert.equal(rt.state.counts['hazard_hit:kill'] ?? 0, 0);
  goTo(rt, [2, 6, 0]); rt.step();
  assert.equal(rt.state.counts['hazard_hit:kill'], 1, 'no killType: plain kill');
  assert.equal(rt.state.counts.hazard_killed, 1, 'no kill effect registered: event only');
  // A space with a bounds() window.
  const { rt: b } = make(cave(false));
  b.space('world').bounds = () => ({ min: [0, 0], max: [10, 10], wrap: [false, false] });
  goTo(b, [14, 4, 0]); b.step();
  assert.equal(b.state.counts['hazard_hit:pit'], 1);
  b.emit('scrolled_out', { who: 'player' }); b.step();
  assert.equal(b.state.counts['hazard_hit:pit'], 2);
});

test('hazard: replay is deterministic and bad configs are rejected', () => {
  const play = () => { const { rt } = make(cave()); for (let i = 0; i < 60; i++) { goTo(rt, [(i * 3) % 30, 1, 0]); rt.step(); } return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const d = cave();
  d.systems[1].with.types[0].respawn = 'heaven';
  d.systems[1].with.volumes.push({ type: 'quicksand', at: [0, 0] });
  d.systems[1].with.interval = 0;
  const c = codes(checkWith(d));
  // Hazard types are a declared kind (card.defines hazard_type): an unknown volume type is ref_unknown (was hazard_unknown).
  for (const code of ['param_option', 'ref_unknown', 'param_range']) assert.ok(c.includes(code), code);
});

test('hazard: v2/games instances preflight without param errors', () => {
  const found = gameInstances('gameplay.hazard'); assert.ok(found.length >= 3);
  for (const x of found) assert.deepEqual(x.paramErrors, [], x.game);
});
