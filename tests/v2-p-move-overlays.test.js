// Overlay movement modes that take over from a base controller while active:
// climb, swim, glide, fly, dodge, grapple. Engine.space.test, side and 3D views.
import test from 'node:test';
import assert from 'node:assert/strict';
import { doc, make, floor, run, move, testSpace } from './v2-p-move-helpers.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import combat from '../v2/primitives/gameplay/combat.index.js';

const health = combat.find(p => p.id === 'gameplay.combat.health');

const wallAt = (x, y0, y1) => { const out = []; for (let y = y0; y <= y1; y++) out.push([x, y, 0]); return out; };
const sys = (...list) => [{ use: 'gameplay.move.walk', with: {} }, ...list.map(([use, w]) => ({ use, with: w || {} }))];
const side = (systems, o = {}) => doc({ size: [30, 20, 1], gravity: 30, solid: floor(0, 29, o.extra || []), zones: o.zones || [], at: o.at || [2, 1, 0], systems });
const damageStub = { id: 'gameplay.test.damage', card: { ambient: true, intent: 'test damage' }, logic(l) { l.effect('damage', { run: (e, rt) => { rt.state.vars.hurt = (rt.state.vars.hurt || 0) + e.amount; } }); } };
const codes = (d, extra = []) => { const r = new Registry([testSpace, ...move, ...extra]); return preflight(d, r, buildLogic(r, Logic)).errors.map(e => e.code); };

test('climb: pushing into a wall climbs, stamina drains, mantles over the top with ledgeGrab', () => {
  const block = []; for (let x = 10; x < 14; x++) for (let y = 1; y <= 6; y++) block.push([x, y, 0]);
  const { rt } = make(side(sys(['gameplay.move.climb', { surfaces: 'any', speed: 3, staminaCost: 10, ledgeGrab: true }]), { extra: block, at: [6, 1, 0] }));
  run(rt, 5, {});
  const p = rt.player();
  run(rt, 40, { axes: { move: [1, 0] } });
  assert.equal(p.components.move.mode, 'climb');
  assert.equal(rt.state.counts.climb_start, 1);
  run(rt, 150, { axes: { move: [1, 1] } });
  assert.equal(rt.state.counts.ledge_grab, 1, 'mantled at the top');
  assert.ok(p.at[1] >= 7 - 0.01 && p.at[0] > 9.9, `on top (${p.at})`);
  assert.ok(p.components.move.pools.stamina.value < 100, 'stamina spent');
  run(rt, 20, {});
  assert.equal(rt.state.counts.climb_end, 1);
});

test('climb: stamina exhaustion makes you slip; a jump pushes off the wall', () => {
  let { rt } = make(side(sys(['gameplay.move.climb', { surfaces: 'any', speed: 1, staminaCost: 60 }]), { extra: wallAt(10, 1, 18), at: [8, 1, 0] }));
  run(rt, 60, { axes: { move: [1, 1] } });
  run(rt, 120, { axes: { move: [1, 1] } });
  assert.ok(rt.state.counts.climb_end >= 1);
  assert.ok(rt.state.events.length >= 0);
  ({ rt } = make(side(sys(['gameplay.move.climb', { surfaces: 'any', speed: 2 }]), { extra: wallAt(10, 1, 18), at: [8, 1, 0] })));
  run(rt, 60, { axes: { move: [1, 1] } });
  assert.equal(rt.player().components.move.mode, 'climb');
  rt.step({ actions: { jump: true }, axes: { move: [0, 0] } });
  run(rt, 2, {});
  assert.notEqual(rt.player().components.move.mode, 'climb');
  assert.ok(rt.player().components.body.vel[0] < 0, 'jumped away from the wall');
});

test('climb: ladders in tagged zones; not climbable without the ability', () => {
  const zones = [{ id: 'ladder', rect: [5, 1, 6, 10], tags: ['ladder'] }];
  let { rt } = make(side(sys(['gameplay.move.climb', { surfaces: 'ladders', speed: 2 }]), { zones, at: [5, 1, 0] }));
  run(rt, 3, {});
  run(rt, 60, { held: { up: true } });
  const p = rt.player();
  assert.ok(p.at[1] > 2.5, `climbed the ladder (${p.at[1]})`);
  assert.equal(p.components.body.state, 'climb');
  ({ rt } = make(side(sys(['gameplay.move.climb', { surfaces: 'ladders', ability: 'climbing' }]), { zones, at: [5, 1, 0] })));
  run(rt, 30, { held: { up: true } });
  assert.equal(rt.state.counts.climb_start, undefined);
  rt.run([{ do: 'set_flag', flag: 'ability.climbing' }]);
  run(rt, 5, { held: { up: true } });
  assert.equal(rt.state.counts.climb_start, 1);
});

test('swim: float, dive, breath and drowning damage through the real combat.health damage effect', () => {
  const zones = [{ id: 'lake', rect: [0, 1, 30, 10], tags: ['water'] }];
  const d = side([{ use: 'gameplay.combat.health', with: {} }, ...sys(['gameplay.move.swim', { speed: 3, breath: 1, drownDps: 7, buoyancy: 2 }])], { zones, at: [5, 6, 0] });
  d.content.archetypes[0].components.health = { max: 100 };
  const { rt } = make(d, [health]);
  assert.equal(rt.canRun('damage'), true, 'combat owns damage here');
  run(rt, 90, {});
  const p = rt.player();
  assert.equal(p.components.move.mode, 'swim');
  assert.ok(p.at[1] > 7.5, `floated to the surface (${p.at[1]})`);
  assert.equal(rt.state.counts.swim_start, 1);
  assert.equal(p.components.health.hp, 100, 'no damage while breathing');
  run(rt, 200, { held: { dive: true } });
  assert.ok(p.at[1] < 3, `dove down (${p.at[1]})`);
  const ticks = rt.state.counts.drowning;
  assert.ok(ticks >= 1, 'drowned after breath ran out');
  assert.equal(p.components.health.hp, 100 - 7 * ticks, `combat applied 7 per drowning tick (${p.components.health.hp})`);
  assert.equal(rt.state.vars.hp, p.components.health.hp, 'mirrored to the hp var');
  assert.equal(rt.state.vars['move.breath'], 0);
  run(rt, 300, { held: { ascend: true } });
  assert.ok(rt.state.vars['move.breath'] > 0.5, 'breath refills at the surface');
});

test('dodge i-frames cancel combat hits through its interceptor chain; health.invulnerable is untouched', () => {
  const d = side([{ use: 'gameplay.combat.health', with: { iframes: 0 } }, ...sys(['gameplay.move.dodge', { distance: 3, sec: 0.4, iframes: [0.05, 0.25], recovery: 0.1 }])]);
  d.content.archetypes[0].components.health = { max: 30 };
  const { rt } = make(d, [health]);
  run(rt, 5, {});
  const p = rt.player(), hit = () => rt.run([{ do: 'damage', who: 'player', amount: 5 }]);
  rt.step({ actions: { dodge: true }, axes: { move: [1, 0] } });
  run(rt, 6, {});
  assert.equal(p.components.body.iframes, true);
  hit();
  assert.equal(p.components.health.hp, 30, 'inside the window: evaded');
  assert.equal(rt.state.counts.evaded, 1);
  assert.equal(p.components.health.invulnerable, 0, 'move never writes combat\'s own field');
  rt.run([{ do: 'damage', who: 'player', amount: 5, ignoreIframes: true }]);
  assert.equal(p.components.health.hp, 25, 'ignoreIframes hits still land');
  run(rt, 20, {});
  assert.equal(p.components.body.iframes, false);
  hit();
  assert.equal(p.components.health.hp, 20, 'after the window: hit');
});

test('glide: jump-hold while falling caps the sink rate and drains stamina; ability gate', () => {
  let { rt } = make(side(sys(['gameplay.move.glide', { fallSpeed: 2, speed: 6, staminaCost: 10 }]), { at: [2, 10, 0] }));
  run(rt, 10, {});
  run(rt, 30, { held: { jump: true }, axes: { move: [1, 0] } });
  const p = rt.player();
  assert.equal(p.components.body.state, 'glide');
  assert.ok(p.components.body.vel[1] >= -2 - 1e-9);
  assert.ok(p.components.move.pools.stamina.value < 100);
  run(rt, 400, { held: { jump: true }, axes: { move: [1, 0] } });
  assert.ok(rt.state.counts.glide_end >= 1);
  ({ rt } = make(side(sys(['gameplay.move.glide', { ability: 'glide' }]), { at: [2, 10, 0] })));
  run(rt, 30, { held: { glide: true } });
  assert.equal(rt.state.counts.glide_start, undefined, 'locked without the ability');
});

test('fly: toggle with the verb, ascend, burn fuel, fall when empty; always-on NPC fliers path in 3D', () => {
  let { rt } = make(side(sys(['gameplay.move.fly', { speed: 5, vertical: 4, fuel: 1 }])));
  run(rt, 3, {});
  rt.step({ actions: { fly: true } });
  run(rt, 30, { held: { jump: true } });
  const p = rt.player();
  assert.equal(p.components.body.state, 'fly');
  assert.ok(p.at[1] > 2, 'ascended');
  run(rt, 60, { held: { jump: true } });
  assert.equal(rt.state.counts.fuel_empty, 1);
  assert.equal(rt.state.counts.fly_end, 1);
  run(rt, 60, {});
  assert.ok(Math.abs(p.at[1] - 1) < 0.05, 'fell back down');
  const cube = doc({ size: [12, 12, 12], gravity: 30, solid: [], at: [1, 1, 1], systems: [{ use: 'gameplay.move.fly', with: { toggle: 'always', speed: 6 } }] });
  cube.content.archetypes.push({ id: 'bat', components: { body: { size: [0.5, 0.5, 0.5] }, move: {} } });
  ({ rt } = make(cube));
  const bat = rt.spawn('bat', { at: [1, 1, 1] });
  rt.run([{ do: 'move_to', who: bat.id, at: [8, 9, 6] }]);
  run(rt, 300, {});
  assert.equal(rt.state.counts.arrived, 1, `bat arrived (${bat.at})`);
});

test('fly: jetpack thrust style holds against gravity within up/down caps', () => {
  const { rt } = make(side(sys(['gameplay.move.fly', { style: 'thrust', toggle: 'double_jump' }])));
  run(rt, 3, {});
  rt.step({ actions: { jump: true } }); rt.step({}); rt.step({}); rt.step({ actions: { jump: true } });
  run(rt, 40, { held: { jump: true } });
  const p = rt.player();
  assert.equal(p.components.move.mode, 'fly');
  assert.ok(p.components.body.vel[1] <= 11 + 1e-9 && p.at[1] > 3);
});

test('dodge: distance, i-frame window, stamina cost, backstep, cooldown', () => {
  const { rt } = make(side(sys(['gameplay.move.dodge', { distance: 4, sec: 0.4, iframes: [0.05, 0.25], cost: 30, recovery: 0.1, cooldown: 0.2 }])));
  run(rt, 5, {});
  const p = rt.player(), x0 = p.at[0];
  rt.step({ actions: { dodge: true }, axes: { move: [1, 0] } });
  const inv = []; for (let i = 0; i < 35; i++) { rt.step({}); inv.push(p.components.body.iframes); }
  assert.ok(Math.abs(p.at[0] - x0 - 4) < 0.3, `rolled ${p.at[0] - x0}`);
  assert.equal(inv[0], false); assert.equal(inv[5], true); assert.equal(inv[20], false);
  assert.equal(p.components.move.pools.stamina.value, 70);
  run(rt, 20, {});
  const x1 = p.at[0];
  rt.step({ actions: { dodge: true } }); run(rt, 60, {});
  assert.ok(p.at[0] < x1 - 2 && p.at[0] > x1 - 2.8, `backstep 0.6 × 4 opposite facing (${p.at[0] - x1})`);
  rt.step({ actions: { dodge: true } }); run(rt, 60, {}); rt.step({ actions: { dodge: true } });
  assert.equal(rt.state.counts.dodge_failed, 1, 'stamina too low for a fourth dodge');
});

test('grapple: hook the ceiling, swing within rope length, release with momentum; pull style', () => {
  const ceiling = []; for (let x = 0; x < 30; x++) ceiling.push([x, 12, 0]);
  let { rt } = make(side(sys(['gameplay.move.grapple', { range: 15, ropeLen: 6, aim: 'up' }]), { extra: ceiling, at: [10, 1, 0] }));
  run(rt, 3, {});
  rt.step({ actions: { grapple: true }, held: { grapple: true } });
  assert.equal(rt.state.counts.grapple_attach, 1);
  const p = rt.player(), s = p.components.move.grapple;
  run(rt, 60, { held: { grapple: true }, axes: { move: [1, 0] } });
  const c = [p.at[0] + 0.4, p.at[1] + 0.8], d = Math.hypot(c[0] - s.anchor[0], c[1] - s.anchor[1]);
  assert.ok(d <= s.len + 0.05, `rope constraint (${d} ≤ ${s.len})`);
  assert.equal(p.components.body.state, 'grapple');
  run(rt, 2, {});
  assert.equal(rt.state.counts.grapple_release, 1);
  ({ rt } = make(side(sys(['gameplay.move.grapple', { range: 15, style: 'pull', aim: 'up', pullSpeed: 20 }]), { extra: ceiling, at: [10, 1, 0] })));
  run(rt, 3, {});
  rt.step({ actions: { grapple: true }, held: { grapple: true } });
  run(rt, 40, { held: { grapple: true } });
  assert.ok(rt.player().at[1] > 9, `pulled up to the ceiling (${rt.player().at[1]})`);
  ({ rt } = make(side(sys(['gameplay.move.grapple', { range: 5, aim: 'up' }]), { extra: ceiling, at: [10, 1, 0] })));
  run(rt, 3, {}); rt.step({ actions: { grapple: true } });
  assert.equal(rt.state.counts.grapple_miss, 1, 'out of range');
});

test('overlays: deterministic replay of a mixed run', () => {
  const zones = [{ id: 'lake', rect: [18, 1, 30, 6], tags: ['water'] }];
  const mk = () => make(side(sys(['gameplay.move.climb', { surfaces: 'any' }], ['gameplay.move.swim', {}], ['gameplay.move.glide', {}], ['gameplay.move.dodge', {}], ['gameplay.move.fly', {}]), { zones, extra: wallAt(12, 1, 4) })).rt;
  const a = mk(), b = mk();
  for (let i = 0; i < 500; i++) { const inp = { axes: { move: [Math.sign(Math.sin(i / 50)), i % 100 < 50 ? 1 : 0] }, actions: { jump: i % 45 === 0, dodge: i % 97 === 0, fly: i === 300 }, held: { jump: i % 45 < 20 } }; a.step(inp); b.step(inp); }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('overlays: preflight rejects bad config with stable codes', () => {
  const one = (use, w) => side(sys([use, w]));
  assert.ok(codes(one('gameplay.move.climb', { surfaces: 'walls' })).includes('param_option'));
  assert.ok(codes(one('gameplay.move.climb', { surfaces: 'tagged', tags: [] })).includes('climb_no_tags'));
  assert.ok(codes(one('gameplay.move.glide', { fallSpeed: 20 })).includes('param_range'));
  assert.ok(codes(one('gameplay.move.dodge', { iframes: [0.4, 0.1] })).includes('dodge_iframes_order'));
  assert.ok(codes(one('gameplay.move.dodge', { iframes: [0.1, 2] })).includes('dodge_iframes_long'));
  assert.ok(codes(one('gameplay.move.grapple', { minLen: 20, ropeLen: 5 })).includes('grapple_rope_order'));
  assert.ok(codes(one('gameplay.move.swim', { breath: 0 })).includes('param_range'));
  assert.ok(codes(one('gameplay.move.fly', { style: 'warp' })).includes('param_option'));
  const noRay = { id: 'engine.space.flat', card: { intent: 'flat', provides: { capabilities: ['position'] } }, install() {} };
  const d = one('gameplay.move.grapple', {}); d.spaces[0].use = 'engine.space.flat'; delete d.spaces[0].with;
  assert.ok(codes(d, [noRay]).includes('capability_missing'), 'grapple needs raycast');
});
