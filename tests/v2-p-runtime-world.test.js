// engine.time, engine.weather, engine.blocks, engine.zones over the reference test space.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { checkFields } from '../v2/kernel/params.js';
import runtime from '../v2/primitives/engine/runtime.index.js';
import storyboard from '../v2/primitives/plot/storyboard.js';

const PRIMS = [testSpace, ...runtime];
const doc = (systems, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'rt-world', title: 'Runtime world', seed: 3,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [32, 16, 1] }, zones: [{ id: 'yard', rect: [0, 0, 8, 8], rules: { safe: true, music: 'yard' } }, { id: 'woods', rect: [8, 0, 32, 16], rules: { music: 'woods' } }] }],
  content: { archetypes: [{ id: 'hero', components: {} }], ...(extra.content || {}) },
  player: { archetype: 'hero', at: [1, 1, 0] }, systems, ...extra.doc,
});
const make = (systems, extra) => compile(doc(systems, extra), { primitives: PRIMS });
const codes = (d, prims = PRIMS) => { const r = new Registry(prims); return preflight(d, r, buildLogic(r, Logic)).errors.map(e => e.code); };
const games = ['blockport', 'emberfall', 'hollow-lantern', 'quiet-manor'].map(id => JSON.parse(readFileSync(new URL(`../v2/games/${id}.json`, import.meta.url))));
export function gameInstances(ids) {
  const out = [];
  for (const g of games) (g.systems || []).forEach((s, i) => { if (ids.includes(s.use)) out.push({ game: g.id, path: `systems[${i}]`, inst: s }); });
  return out;
}

test('engine.time: clock, phases, days, seasons and vars advance deterministically', () => {
  // 24 s per day: 1 game hour per real second (60 frames).
  const { rt } = make([{ use: 'engine.time', with: { dayLength: 24, startHour: 4, daysPerSeason: 1, seasons: ['wet', 'dry'], weekdays: ['mon', 'tue'] } }]);
  run(rt, 1);
  assert.equal(rt.state.vars['time.phase'], 'night');
  assert.equal(rt.state.vars['time.day'], 1);
  run(rt, 60);
  assert.equal(rt.state.vars['time.phase'], 'dawn');
  assert.equal(rt.state.counts['phase:dawn'], 1);
  assert.equal(rt.state.counts.dawn, 1);
  run(rt, 60 * 20);
  assert.equal(rt.state.vars['time.day'], 2);
  assert.equal(rt.state.vars['time.season'], 'dry');
  assert.equal(rt.state.vars['time.weekday'], 'tue');
  assert.equal(rt.state.counts.new_day, 1);
  assert.equal(rt.state.counts['season_change:dry'], 1);
  assert.ok(rt.test({ daytime: [0, 6] }));
  rt.run([{ do: 'skip_time', hours: 24 }]);
  assert.equal(rt.state.vars['time.day'], 3);
  assert.equal(rt.state.vars['time.year'], 2);
  assert.equal(rt.state.counts.new_year, 1);
  rt.run([{ do: 'set_time', hour: 6 }]);
  assert.equal(rt.state.vars['time.day'], 3, 'a later hour is today');
  rt.run([{ do: 'set_time', hour: 5 }]);
  assert.equal(rt.state.vars['time.day'], 4, 'an earlier hour means the next day');
  assert.equal(rt.state.vars['time.hour'], 5);
  rt.run([{ do: 'set_time', hour: 2, back: true }]);
  assert.equal(rt.state.vars['time.day'], 4);
  assert.equal(rt.state.vars['time.phase'], 'night');
});

test('engine.time: timers run effects, repeat, cancel, and stop while pauseWhen holds', () => {
  const { rt } = make([{ use: 'engine.time', with: { pauseWhen: { flag: 'menu' }, timers: [{ id: 'bomb', seconds: 1, do: [{ do: 'set_flag', flag: 'boom' }] }, { id: 'tick', seconds: 0.5, repeat: true, autostart: true, do: [{ do: 'add_var', var: 'ticks' }] }] } }]);
  run(rt, 2);
  rt.run([{ do: 'start_timer', timer: 'bomb' }]);
  assert.ok(rt.test({ timer: 'bomb' }));
  assert.ok(rt.test({ timer: 'bomb', gt: 0.9 }));
  rt.state.flags.menu = true; const hour = rt.state.vars['time.hour'];
  run(rt, 120);
  assert.equal(rt.state.flags.boom, undefined, 'paused');
  assert.equal(rt.state.vars['time.hour'], hour, 'clock paused');
  assert.equal(rt.state.vars['time.paused'], true);
  delete rt.state.flags.menu;
  run(rt, 61);
  assert.equal(rt.state.flags.boom, true);
  assert.ok(rt.test({ timer: 'bomb', state: 'done' }));
  assert.ok(rt.state.vars.ticks >= 2);
  rt.run([{ do: 'start_timer', timer: 'adhoc', seconds: 0.1, then: [{ do: 'set_flag', flag: 'adhoc' }] }, { do: 'cancel_timer', timer: 'tick' }]);
  const ticks = rt.state.vars.ticks; run(rt, 60);
  assert.equal(rt.state.vars.ticks, ticks);
  assert.equal(rt.state.flags.adhoc, true);
  assert.equal(rt.state.counts['timer:adhoc'], 1);
});

test('engine.weather: weighted states with durations, forced and locked changes', () => {
  const states = [{ id: 'clear', weight: 3, minMin: 0.05, maxMin: 0.1, temp: 20 }, { id: 'rain', weight: 1, minMin: 0.05, maxMin: 0.1, wind: 0.5, vars: { wet: 1 } }, { id: 'snow', weight: 5, seasons: ['winter'] }];
  const { rt } = make([{ use: 'engine.weather', with: { states, initial: 'clear', season: 'summer' } }]);
  run(rt, 1);
  assert.equal(rt.state.vars.weather, 'clear');
  run(rt, 60 * 120);
  assert.ok(rt.state.counts.weather_changed > 3, 'changes over time');
  assert.equal(rt.state.counts['weather:snow'] ?? 0, 0, 'season filter');
  rt.run([{ do: 'change_weather', weather: 'rain', lock: true }]);
  run(rt, 600);
  assert.ok(rt.test({ weather: 'rain' }));
  assert.equal(rt.state.vars['weather.wet'], 1);
  assert.equal(rt.state.vars['weather.intensity'], 1);
});

test('engine.blocks: definitions, harvest rules, break times, drops and light', () => {
  const blocks = [{ id: 'stone', solid: true, hardness: 2, tool: 'pick', tier: 2, drops: [{ item: 'cobble' }] }, { id: 'torch', solid: false, light: 6 }, { id: 'bedrock', hardness: 9999 }];
  const { rt } = make([{ use: 'engine.blocks' }], { content: { blocks, items: [{ id: 'cobble' }] } });
  const b = rt.service('blocks');
  assert.equal(b.def('stone').tier, 2);
  assert.equal(b.canHarvest('stone', { kind: 'pick', tier: 'wood' }), false);
  assert.equal(b.canHarvest('stone', { kind: 'pick', tier: 'iron' }), true);
  assert.ok(b.breakTime('stone', { kind: 'pick', tier: 'iron' }) < b.breakTime('stone', { kind: 'pick', tier: 'stone' }));
  assert.ok(b.breakTime('stone', {}) > b.breakTime('stone', { kind: 'pick', tier: 'stone' }));
  assert.equal(b.breakTime('bedrock', { kind: 'pick', tier: 4 }), Infinity);
  assert.deepEqual(b.drops('stone', { kind: 'pick', tier: 2 }), [{ item: 'cobble', count: 1 }]);
  rt.space('w').setCell([5, 5, 0], 'torch', rt);
  assert.equal(rt.state.counts['block_changed:torch'], 1);
  assert.equal(rt.state.counts.light_changed, 1);
  assert.equal(b.lightAt([5, 5, 0]), 6);
  assert.equal(b.lightAt([7, 6, 0]), 3);
  assert.ok(rt.test({ block_light: [6, 5, 0], gte: 5 }));
  rt.space('w').setCell([2, 2, 0], 'stone', rt);
  assert.ok(rt.test({ block_tag: 'none', at: [2, 2, 0] }) === false);
});

test('engine.zones: discovery, rule vars, enter/leave effects and periodic effects', () => {
  const { rt } = make([{ use: 'engine.zones', with: { discoverRadius: 2, checkSec: 0, rulesDefault: { safe: false, music: 'none' }, rules: [{ zone: 'woods', onEnter: [{ do: 'add_var', var: 'entered' }], onDiscover: [{ do: 'set_flag', flag: 'found_woods' }], while: [{ do: 'add_var', var: 'ticks' }], everySec: 0.5 }] } }]);
  run(rt, 1);
  assert.equal(rt.state.vars['zone.current'], 'yard');
  assert.equal(rt.state.vars['zone.rule.safe'], true);
  assert.ok(rt.test({ discovered: 'yard' }));
  assert.equal(rt.state.flags.found_woods, undefined);
  rt.space('w').setPos(rt.player(), [6.5, 1, 0], rt); run(rt, 1);
  assert.ok(rt.test({ discovered: 'woods' }), 'radius discovery');
  assert.equal(rt.state.flags.found_woods, true);
  rt.space('w').setPos(rt.player(), [12, 1, 0], rt); run(rt, 61);
  assert.equal(rt.state.vars['zone.current'], 'woods');
  assert.equal(rt.state.vars['zone.previous'], 'yard');
  assert.equal(rt.state.vars['zone.rule.music'], 'woods');
  assert.equal(rt.state.vars['zone.rule.safe'], false, 'default when the zone does not set it');
  assert.equal(rt.state.vars.entered, 1);
  assert.equal(rt.state.vars.ticks, 2);
  assert.equal(rt.state.vars['zones.discovered'], 2);
});

test('engine.zones: dynamic zones open, move, expire and drive enter/leave events', () => {
  const { rt } = make([{ use: 'engine.zones', with: { checkSec: 0, dynamic: [{ id: 'bonus', at: [20, 4, 0], r: 1.5, open: false, lifetimeSec: 2, rules: { mult: 2 } }], rules: [{ zone: 'bonus', onEnter: [{ do: 'set_flag', flag: 'in_bonus' }], onLeave: [{ do: 'clear_flag', flag: 'in_bonus' }] }] } }]);
  run(rt, 2);
  assert.ok(!rt.test({ region_open: 'bonus' }));
  rt.run([{ do: 'open_zone', zone: 'bonus' }, { do: 'move_zone', zone: 'bonus', follow: 'player' }]);
  run(rt, 1);
  assert.ok(rt.test({ region: 'bonus' }));
  assert.equal(rt.state.flags.in_bonus, true);
  assert.equal(rt.state.vars['zone.rule.mult'], 2);
  assert.equal(rt.state.counts['enter_zone:bonus'], 1);
  run(rt, 130);
  assert.ok(!rt.test({ region_open: 'bonus' }), 'lifetime expired');
  assert.equal(rt.state.flags.in_bonus, undefined);
  assert.equal(rt.state.vars['zone.rule.mult'], undefined);
  assert.equal(rt.state.counts['zone_closed:bonus'], 1);
});

test('runtime world primitives replay deterministically across snapshot/restore', () => {
  const systems = [
    { use: 'engine.time', with: { dayLength: 30, timers: [{ id: 't', seconds: 0.7, repeat: true, autostart: true, do: [{ do: 'add_var', var: 'n' }] }] } },
    { use: 'engine.weather', with: { states: [{ id: 'a', minMin: 0.05, maxMin: 0.2 }, { id: 'b', minMin: 0.05, maxMin: 0.2, next: { a: 1 } }] } },
    { use: 'engine.zones', with: { discoverRadius: 3, dynamic: [{ id: 'ring', at: [3, 3, 0], r: 2 }] } },
  ];
  const a = make(systems).rt, b = make(systems).rt;
  run(a, 500); run(b, 250);
  const snap = b.snapshot(); run(b, 100); b.restore(snap); run(b, 250);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('preflight rejects bad runtime-world configs with stable codes', () => {
  const bad = doc([
    { use: 'engine.time', with: { phases: { dawn: 5, day: 5 }, timers: [{ id: 'x', seconds: 1 }, { id: 'x', seconds: 2 }] } },
    { use: 'engine.weather', with: { states: [{ id: 'a', minMin: 5, maxMin: 1, weight: 0, next: { zz: 1 } }], initial: 'nope' } },
    { use: 'engine.blocks', with: { tiers: ['hand'] } },
    { use: 'engine.zones', with: { dynamic: [{ id: 'yard', at: [1, 1] }], rules: [{ zone: 'mars' }] } },
    { use: 'plot.storyboard' },
  ], { content: { blocks: [{ id: 'ore', tier: 9, light: 20 }] } });
  bad.plot = { storyboard: { acts: [{ id: 'a', beats: [{ id: 'b', when: { daytime: 7 }, do: [{ do: 'skip_time' }, { do: 'start_timer', timer: 'Bad!' }] }] }] } };
  const c = codes(bad, [...PRIMS, storyboard]);
  for (const code of ['time_phases_invalid', 'id_duplicate', 'weather_duration', 'weather_unknown', 'weather_weights', 'block_tier_unknown', 'block_light_range', 'zone_dynamic_shape', 'ref_unknown', 'time_daytime_invalid', 'time_effect_invalid']) assert.ok(c.includes(code), code);
});

test('every engine.time/weather/blocks/zones instance in v2/games has valid params', () => {
  const ids = ['engine.time', 'engine.weather', 'engine.blocks', 'engine.zones'];
  const list = gameInstances(ids);
  assert.ok(list.length >= 9);
  for (const { game, path, inst } of list) {
    const card = runtime.find(p => p.id === inst.use).card, errors = [];
    checkFields(card.params, inst.with || {}, `${game}.${path}.with`, errors);
    assert.deepEqual(errors, [], `${game} ${path}`);
  }
});
