// gameplay.move.platformer on engine.space.test (side view: gravity, z size 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { doc, make, floor, run, move, testSpace } from './v2-p-move-helpers.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';

const plat = (w = {}, o = {}) => doc({ size: [40, 20, 1], gravity: 60, solid: floor(0, 39, o.extra || []), at: o.at || [2, 1, 0], zones: o.zones || [], blocks: o.blocks, systems: [{ use: 'gameplay.move.platformer', with: w }, ...(o.systems || [])] });
const wallAt = (x, y0, y1) => { const out = []; for (let y = y0; y <= y1; y++) out.push([x, y, 0]); return out; };
const apex = (rt, n, input) => { const p = rt.player(); let top = -Infinity; for (let i = 0; i < n; i++) { rt.step(typeof input === 'function' ? input(i) : input); top = Math.max(top, p.at[1]); } return top; };
const settleOn = rt => run(rt, 5, {});

// A stand-in for gameplay.progression.abilities (another workstream): `ability` predicate + unlock_ability.
const abilitiesStub = {
  id: 'gameplay.progression.abilities', card: { intent: 'test stub', params: { abilities: { type: 'json', default: [] }, start: { type: 'json', default: [] } } },
  logic(l) {
    l.predicate('ability', { test: (p, rt) => Boolean(rt.store('abilities').on?.[p.ability]) });
    l.effect('unlock_ability', { run: (e, rt) => { (rt.store('abilities').on ??= {})[e.ability] = true; } });
  },
};

test('platformer: variable jump: full hold reaches v²/2g, an early release cuts it', () => {
  const { rt } = make(plat());
  settleOn(rt);
  rt.step({ actions: { jump: true }, held: { jump: true } });
  const full = apex(rt, 50, { held: { jump: true } }) - 1;
  assert.ok(full > 3.8 && full <= 22 * 22 / 120 + 0.01, `full jump ${full}`);
  run(rt, 60, {});
  rt.step({ actions: { jump: true } });
  const cut = apex(rt, 50, {}) - 1;
  assert.ok(cut < full * 0.45, `tap jump ${cut} is cut by jumpCut 0.5`);
});

test('platformer: coyote time allows a jump just after running off a ledge, not later', () => {
  const ledge = []; for (let x = 0; x < 6; x++) ledge.push([x, 5, 0]);
  const mk = () => make(plat({ coyoteMs: 90 }, { extra: ledge, at: [2, 6, 0] })).rt;
  for (const [delay, expect] of [[2, 1], [12, 0]]) {
    const rt = mk(); settleOn(rt);
    const p = rt.player();
    let left = 0; while (p.components.body.grounded && left < 120) { rt.step({ held: { right: true } }); left++; }
    run(rt, delay, { held: { right: true } });
    rt.step({ actions: { jump: true }, held: { right: true, jump: true } });
    assert.equal(rt.state.counts.jumped ?? 0, expect, `jump ${delay} frames after the edge`);
  }
});

test('platformer: double jump is gated by the ability (flag store and progression grants)', () => {
  const air = rt => { rt.step({ actions: { jump: true }, held: { jump: true } }); run(rt, 15, { held: { jump: true } }); rt.step({}); rt.step({ actions: { jump: true }, held: { jump: true } }); };
  let { rt } = make(plat());
  settleOn(rt); air(rt);
  assert.equal(rt.state.counts.double_jumped, undefined, 'locked by default');
  ({ rt } = make(plat()));
  rt.run([{ do: 'set_flag', flag: 'ability.doubleJump' }]);
  settleOn(rt); air(rt);
  assert.equal(rt.state.counts.double_jumped, 1, 'flag store grants it');
  // gameplay.progression.abilities grants: unlocking moth_wings grants doubleJump.
  const d = plat({}, { systems: [{ use: 'gameplay.progression.abilities', with: { abilities: [{ id: 'moth_wings', grants: ['doubleJump'] }] } }] });
  ({ rt } = make(d, [abilitiesStub]));
  settleOn(rt); air(rt);
  assert.equal(rt.state.counts.double_jumped, undefined);
  rt.run([{ do: 'unlock_ability', ability: 'moth_wings' }]);
  run(rt, 60, {}); air(rt);
  assert.equal(rt.state.counts.double_jumped, 1, 'unlock_ability grant turns it on');
});

test('platformer: dash covers speed × sec without gravity and grants i-frames; once in the air', () => {
  const { rt } = make(plat({ abilities: { dash: true }, dash: { speed: 30, sec: 0.2, cooldown: 0.1, iframes: 0.1 } }));
  settleOn(rt);
  const p = rt.player();
  rt.step({ actions: { jump: true } }); run(rt, 6, {});
  const x0 = p.at[0], y0 = p.at[1];
  rt.step({ actions: { dash: true }, held: { right: true } });
  assert.equal(p.components.body.iframes, true);
  run(rt, 11, { held: { right: true } });
  assert.ok(Math.abs(p.at[0] - x0 - 6) < 0.6, `dash distance ${p.at[0] - x0}`);
  assert.ok(Math.abs(p.at[1] - y0) < 0.3, 'no gravity during a horizontal dash');
  assert.equal(p.components.body.iframes, false);
  rt.step({ actions: { dash: true }, held: { right: true } });
  assert.equal(rt.state.counts.dashed, 1, 'air dash only once');
});

test('platformer: wall slide caps the fall and wall jump kicks away', () => {
  const { rt } = make(plat({ abilities: { wallSlide: true, wallJump: true } }, { extra: wallAt(10, 1, 18), at: [8, 1, 0] }));
  settleOn(rt);
  const p = rt.player();
  run(rt, 30, { held: { right: true } });
  rt.step({ actions: { jump: true }, held: { right: true, jump: true } });
  run(rt, 40, { held: { right: true, jump: true } });
  assert.equal(p.components.body.state, 'wall');
  assert.ok(p.components.body.vel[1] >= -3.5 - 1e-9, 'slide speed cap');
  assert.equal(rt.state.counts.wall_slide, 1);
  rt.step({ held: { right: true } });
  rt.step({ actions: { jump: true }, held: { right: true, jump: true } });
  assert.equal(rt.state.counts.wall_jumped, 1);
  assert.ok(p.components.body.vel[0] < 0, 'kicked away from the wall');
});

test('platformer: wall climb drains internal stamina and refills on landing', () => {
  const { rt } = make(plat({ abilities: { wallClimb: true }, wallClimbStamina: 50, climbStaminaMax: 20, wallClimb: { speed: 4 } }, { extra: wallAt(10, 1, 18), at: [8, 1, 0] }));
  settleOn(rt);
  const p = rt.player();
  run(rt, 30, { held: { right: true } });
  rt.step({ actions: { jump: true }, held: { right: true, jump: true } }); run(rt, 3, { held: { right: true } });
  const y0 = p.at[1];
  run(rt, 15, { held: { right: true, grab: true, up: true } });
  assert.equal(p.components.body.state, 'climb');
  assert.ok(p.at[1] > y0 + 0.5, 'climbs up');
  run(rt, 60, { held: { right: true, grab: true, up: true } });
  assert.notEqual(p.components.body.state, 'climb', 'stamina ran out');
  assert.equal(rt.state.counts['depleted:stamina'], 1);
  run(rt, 120, {});
  assert.equal(p.components.move.pools.stamina.value, 20, 'refilled on the ground');
});

test('platformer: glide caps the fall speed; swim in water zones', () => {
  let { rt } = make(plat({ abilities: { glide: true }, glide: { fall: 2 } }));
  settleOn(rt);
  rt.step({ actions: { jump: true }, held: { jump: true } }); run(rt, 40, { held: { jump: true } });
  const p = rt.player();
  assert.equal(p.components.body.state, 'glide');
  assert.ok(Math.abs(p.components.body.vel[1] + 2) < 1e-6);
  assert.equal(rt.state.counts.glide_start, 1);
  ({ rt } = make(plat({ abilities: { swim: true } }, { zones: [{ id: 'pool', rect: [0, 1, 40, 8], tags: ['water'] }], at: [5, 6, 0] })));
  run(rt, 60, {});
  const q = rt.player();
  assert.equal(q.components.body.state, 'swim');
  assert.ok(q.at[1] > 1.5, `buoyancy slows sinking (${q.at[1]})`);
  assert.equal(rt.state.counts.submerged, 1);
});

test('platformer: crouch slows, ledge grab hangs then climbs onto the top', () => {
  let { rt } = make(plat({ abilities: { crouch: true } }));
  settleOn(rt);
  run(rt, 30, { held: { right: true, crouch: true } });
  assert.ok(Math.abs(rt.player().components.body.vel[0] - 9 * 0.35) < 1e-6);
  const block = []; for (let x = 10; x < 14; x++) for (let y = 1; y <= 5; y++) block.push([x, y, 0]);
  ({ rt } = make(plat({ abilities: { ledgeGrab: true } }, { extra: block, at: [6, 1, 0] })));
  settleOn(rt);
  const p = rt.player();
  run(rt, 25, { held: { right: true } });
  rt.step({ actions: { jump: true }, held: { right: true, jump: true } });
  for (let i = 0; i < 60 && p.components.body.state !== 'ledge'; i++) rt.step({ held: { right: true, jump: true } });
  assert.equal(p.components.body.state, 'ledge');
  assert.equal(rt.state.counts.ledge_grab, 1);
  run(rt, 5, {}); run(rt, 20, { held: { up: true } });
  assert.equal(rt.state.counts.ledge_climb, 1);
  assert.ok(p.at[1] >= 6 - 0.01 && p.at[0] >= 10, `standing on top (${p.at})`);
});

test('platformer presets: auto-bounce with springs, flap, jetpack thrust, runner auto-run', () => {
  let { rt } = make(plat({ preset: 'bounce' }, { blocks: [{ id: 'spring', solid: true, tags: ['spring'] }], at: [20, 3, 0] }));
  run(rt, 120, {});
  assert.ok(rt.state.counts.bounced >= 2);
  rt.space('w').setCell([20, 0, 0], 'spring', rt); rt.space('w').setCell([21, 0, 0], 'spring', rt);
  const top = apex(rt, 200, {});
  assert.ok(top - 1 > 15.5 * 15.5 / 60 + 1, `spring bounce reaches higher (${top})`);
  ({ rt } = make(plat({ preset: 'flap' }, { at: [2, 8, 0] })));
  for (let i = 0; i < 120; i++) rt.step(i % 20 === 0 ? { actions: { jump: true } } : {});
  assert.equal(rt.state.counts.flapped, 6);
  assert.ok(rt.player().at[1] > 3, 'flapping keeps it aloft');
  assert.ok(rt.player().at[0] > 2 + 4 * 1.5, 'flap preset drifts forward');
  ({ rt } = make(plat({ preset: 'jetpack' }, { at: [2, 1, 0] })));
  run(rt, 60, { held: { jump: true } });
  assert.ok(rt.player().components.body.vel[1] <= 11 + 1e-9 && rt.player().at[1] > 5, 'thrust is capped at up 11');
  ({ rt } = make(plat({ preset: 'runner' }, { at: [2, 1, 0] })));
  run(rt, 60, {});
  assert.ok(Math.abs(rt.player().components.body.vel[0] - 9) < 1e-6, 'auto-run');
  rt.step({ actions: { jump: true }, held: { jump: true } });
  const h = apex(rt, 40, { held: { jump: true } }) - 1;
  assert.ok(Math.abs(h - 3.3) < 0.3, `runner jump height 3.3 (${h})`);
});

test('platformer: NPC follows moveTo, jumping up onto a step', () => {
  const step = []; for (let x = 12; x < 40; x++) step.push([x, 1, 0]);
  const d = plat({}, { extra: step, zones: [{ id: 'top', rect: [20, 2, 24, 6] }] });
  d.content.archetypes.push({ id: 'imp', components: { body: { size: [0.8, 1.6, 1] }, move: {} } });
  const { rt } = make(d);
  const n = rt.spawn('imp', { at: [4, 1, 0] });
  rt.run([{ do: 'move_to', who: n.id, zone: 'top' }]);
  run(rt, 240, {});
  assert.ok(rt.test({ zone: 'top', who: n.id }), `imp reached the step top (${n.at})`);
  assert.equal(rt.state.counts['arrived:top'], 1);
});

test('platformer: envelope reflects abilities', () => {
  const card = move.find(p => p.id === 'gameplay.move.platformer').card;
  const base = card.envelope({}, new Set(), { gravity: 60 }), dj = card.envelope({}, new Set(['doubleJump', 'dash', 'glide', 'wallJump']), { gravity: 60 });
  assert.ok(Math.abs(base.jumpHeight - 22 * 22 / 120) < 1e-6);
  // Tilemap-navigation semantics: single-jump numbers plus doubleJump/dash; reach* combine them.
  assert.equal(dj.jumpHeight, base.jumpHeight);
  assert.ok(dj.doubleJump === true && dj.reachHeight > base.reachHeight && dj.jumpGap > base.jumpGap && dj.dash > 0 && dj.wallJump === true);
  assert.equal(base.climb, false); assert.equal(base.doubleJump, false);
});

test('platformer: deterministic replay with options', () => {
  const mk = () => make(plat({ abilities: { doubleJump: true, dash: true, wallSlide: true, wallJump: true } }, { extra: wallAt(15, 1, 10) })).rt;
  const a = mk(), b = mk();
  for (let i = 0; i < 400; i++) { const inp = { held: { right: i % 90 < 60, left: i % 90 >= 60, jump: i % 30 < 12 }, actions: { jump: i % 30 === 0, dash: i % 77 === 0 } }; a.step(inp); b.step(inp); }
  assert.deepEqual(a.snapshot(), b.snapshot());
  const labels = a.availableOptions().map(o => o.label);
  assert.ok(labels.includes('jump right') && labels.includes('dash left'));
});

test('platformer: preflight rejects bad config with stable codes', () => {
  const registry = new Registry([testSpace, ...move]), logic = buildLogic(registry, Logic);
  const codes = w => preflight(plat(w), registry, logic).errors.map(e => e.code);
  assert.ok(codes({ preset: 'mario' }).includes('param_option'));
  assert.ok(codes({ jump: 0 }).includes('platformer_no_lift'));
  assert.ok(codes({ abilities: { teleport: true } }).includes('param_unknown'));
  assert.ok(codes({ doubleJumps: 1.5 }).includes('param_type'));
  const d = plat(); d.spaces[0].with.gravity = 0;
  const flat = { id: 'engine.space.flat', card: { intent: 'no gravity', provides: { capabilities: ['position'] } }, install() {} };
  const d2 = plat(); d2.spaces[0].use = 'engine.space.flat'; delete d2.spaces[0].with;
  const r2 = preflight(d2, new Registry([flat, ...move]), buildLogic(new Registry([flat, ...move]), Logic));
  assert.ok(r2.errors.some(e => e.code === 'capability_missing'), 'needs gravity');
});
