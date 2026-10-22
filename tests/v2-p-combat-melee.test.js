// gameplay.combat.melee, gameplay.combat.versus, gameplay.combat.knockback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { compileFighter, advantage, BUILD, SPECIAL_ARCHETYPES, SUPER_ARCHETYPES } from '../v2/primitives/gameplay/combat-lib-moves.js';

const ALL = [...PRIMITIVES, testSpace];
const reg = new Registry(ALL), lg = buildLogic(reg, Logic);
const codes = d => preflight(d, reg, lg).errors.map(e => e.code);
const make = d => compile(d, { primitives: ALL }).rt;
const same = (build, inputs) => { const a = build(), b = build(); for (const i of inputs) { a.step(i); b.step(i); } assert.deepEqual(a.snapshot(), b.snapshot()); return a; };
const count = (rt, n) => rt.state.counts[n] ?? 0;

// ---------- action melee ----------
const actionDoc = (melee = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'melee', title: 'Melee', seed: 2,
  spaces: [{ id: 'arena', use: 'engine.space.test', with: { size: [24, 12, 1] } }],
  systems: [
    { use: 'gameplay.resource', with: { pools: [{ id: 'stamina', max: 30, regen: 0, drainTags: ['attack', 'block'] }] } },
    { use: 'gameplay.combat.health', with: { types: ['phys'], iframes: 0 } },
    { use: 'gameplay.combat.status' },
    { use: 'gameplay.combat.melee', with: { comboWindowMs: 450, parry: { window: 150, stagger: 1, riposte: 2 }, block: { reduction: 0.6, staminaPerDmg: 0.5, arc: 180 }, pogo: true, pogoSpeed: 12, hitStopMs: 50, ...melee } },
  ],
  content: {
    items: [
      { id: 'sword', name: 'Sword', kind: 'weapon', weapon: { damage: 10, reach: 1.5, arc: 120, speed: 1, stamina: 4, combo: 3, type: 'phys' } },
      { id: 'claws', name: 'Claws', kind: 'weapon', weapon: { damage: 8, reach: 1.5, arc: 120, speed: 1, stamina: 0, combo: 1 } },
    ],
    statuses: [{ id: 'poise_broken', duration: 2, mods: { 'stat.vulnerable': 1 } }],
    archetypes: [
      { id: 'hero', kind: 'player', components: { health: { max: 100 }, melee: { weapon: 'sword' }, body: { facing: 1, grounded: true } } },
      { id: 'dummy', kind: 'enemy', components: { health: { max: 200 } } },
      { id: 'brute', kind: 'enemy', components: { health: { max: 200 }, poise: { max: 25 } } },
      { id: 'beast', kind: 'enemy', components: { health: { max: 60 }, melee: { weapon: 'claws' }, body: { facing: -1, grounded: true } } },
    ],
  },
  player: { archetype: 'hero', at: [2, 1, 0] },
});
const press = (rt, a, n = 1, input = {}) => { rt.step({ ...input, actions: { [a]: true } }); run(rt, n - 1, input); };

test('melee: weapon combo chain with windup/active/recovery, stamina, hit-stop and events', () => {
  const rt = make(actionDoc()), p = rt.player(), d = rt.spawn('dummy', { at: [3, 1, 0] });
  const mv = rt.service('melee').moves(p);
  assert.deepEqual(Object.keys(mv).sort(), ['heavy', 'plunge', 'w1', 'w2', 'w3']);
  assert.equal(mv.w1.startup, 13); assert.equal(mv.w3.damage, 12.5);
  press(rt, 'attack', 14); // the press frame starts the move; move frame 1 is the next step
  assert.equal(d.components.health.hp, 200, 'nothing during windup');
  run(rt, 1);
  assert.equal(d.components.health.hp, 190, 'hits on the first active frame');
  assert.equal(p.components.melee.hitstop > 0, true, 'hit-stop freezes the attacker');
  assert.equal(rt.state.vars['res.stamina'], 26);
  // Press again during recovery: the chain continues to w2, then w3.
  run(rt, 14); press(rt, 'attack', 30); press(rt, 'attack', 40);
  assert.equal(count(rt, 'attack_started'), 3);
  assert.equal(d.components.health.hp, 200 - 10 - 10 - 12.5);
  assert.equal(count(rt, 'hit'), 3);
  assert.ok(rt.test({ in_combat: true }));
  run(rt, 40); press(rt, 'attack', 30);
  assert.equal(p.components.melee.comboIdx, 1, 'combo window expired: restarts at w1');
});

test('melee: block reduces damage and drains stamina; guard breaks; parry staggers and riposte doubles damage', () => {
  const rt = make(actionDoc()), p = rt.player(), b = rt.spawn('beast', { at: [3, 1, 0] });
  const melee = rt.service('melee'), held = { held: { block: true } };
  melee.start(b, 'w1');
  run(rt, 16, held);
  assert.equal(count(rt, 'blocked'), 1);
  assert.equal(p.components.health.hp, 100 - 8 * 0.4);
  assert.equal(rt.state.vars['res.stamina'], 30 - 4);
  // Guard break: not enough stamina for the block.
  rt.service('resources').spend(p, 'stamina', 24, { force: true });
  run(rt, 30); melee.start(b, 'w1'); run(rt, 16, held);
  assert.equal(count(rt, 'guard_broken'), 1);
  assert.equal(p.components.health.stunKind, 'stagger');
  run(rt, 80);
  // Parry: press block just before the strike lands.
  melee.start(b, 'w1'); run(rt, 12);
  rt.step({ actions: { block: true } });
  run(rt, 3);
  assert.equal(count(rt, 'parried'), 1);
  assert.equal(b.components.health.stunKind, 'stagger');
  assert.equal(b.components.melee.st, 'stagger');
  rt.service('resources').refill(p);
  press(rt, 'attack', 16);
  assert.equal(count(rt, 'riposte'), 1);
  assert.equal(b.components.health.hp, 60 - 20, 'riposte ×2 on a staggered target');
});

test('melee: poise absorbs flinches until it breaks; pogo bounces off targets below', () => {
  const rt = make(actionDoc({ poise: true })), p = rt.player(), br = rt.spawn('brute', { at: [3, 1, 0] });
  const melee = rt.service('melee');
  melee.start(p, 'w1'); run(rt, 20);
  assert.equal(br.components.health.stun, 0, 'poise holds: no hit stun');
  run(rt, 30); melee.start(p, 'w1'); run(rt, 20); run(rt, 30); melee.start(p, 'w1'); run(rt, 20);
  assert.equal(count(rt, 'staggered'), 1, 'third hit breaks poise (10 × 3 > 25)');
  assert.equal(rt.service('status').has(br, 'poise_broken'), true);
  const rt2 = make(actionDoc()), q = rt2.player(), d = rt2.spawn('dummy', { at: [2, 2, 0] });
  rt2.space().setPos(q, [2, 3, 0], rt2); q.components.body.grounded = false;
  rt2.step({ actions: { attack: true }, axes: { move: [0, -1] } });
  assert.equal(q.components.melee.move, 'plunge');
  run(rt2, 8);
  assert.equal(count(rt2, 'pogo'), 1);
  assert.ok(q.components.body.vel[1] > 0, 'bounced up');
  assert.ok(d.components.health.hp < 200);
});

test('melee: exhausted stamina blocks attacks; NPC intents use the same input path', () => {
  const rt = make(actionDoc()), p = rt.player(), b = rt.spawn('beast', { at: [3, 1, 0] });
  rt.service('resources').spend(p, 'stamina', 30, { force: true });
  press(rt, 'attack', 2);
  assert.equal(count(rt, 'exhausted_attack'), 1);
  b.components.melee.intent = { press: 'light', dir: 5 };
  run(rt, 16);
  assert.equal(count(rt, 'attack_started'), 1);
  assert.ok(p.components.health.hp < 100);
});

test('melee: deterministic replay and bad configs', () => {
  same(() => { const rt = make(actionDoc()); rt.spawn('beast', { at: [3, 1, 0] }).components.melee.intent = { press: 'light' }; return rt; },
    Array.from({ length: 120 }, (_, i) => (i % 20 === 0 ? { actions: { attack: true } } : i % 33 === 0 ? { actions: { heavy: true } } : {})));
  const bad = actionDoc({ moves: [{ id: 'kick', startup: 2.5, behavior: 'spin', level: 'ankle', chain: ['nope'] }, { id: 'orb', behavior: 'projectile' }] });
  bad.content.items.push({ id: 'dummy_item', name: 'Dummy' }); // an item without a weapon block (an unknown id is the shape's ref_unknown)
  bad.content.archetypes.push({ id: 'oops', components: { melee: { weapon: 'dummy_item', fighter: { build: 'huge', specials: [{ archetype: 'hadouken' }], super: { archetype: 'nuke' } }, moves: { ghost: { from: 'ghost_move' } } } } });
  const c = codes(bad);
  for (const code of ['melee_move_unknown', 'melee_weapon_unknown', 'melee_projectile_needs_projectile']) assert.ok(c.includes(code), `${code} in ${c}`);
  // Frame counts, behaviours, levels and fighter presets are the move and component shapes' closed sets and ranges
  // (card.params moves, card.components melee): param_type / param_option where melee_move_invalid and
  // melee_preset_invalid were.
  const r = preflight(bad, reg, lg), at = [...r.errors, ...r.warnings].map(e => `${e.code}@${e.path}`), lib = 'systems[' + bad.systems.findIndex(s => s.use === 'gameplay.combat.melee') + '].with.moves[0]', oops = 'content.archetypes[' + (bad.content.archetypes.length - 1) + '].components.melee.fighter';
  for (const x of [`param_type@${lib}.startup`, `param_option@${lib}.behavior`, `param_option@${lib}.level`, `param_option@${oops}.build`, `param_option@${oops}.specials[0].archetype`, `param_option@${oops}.super.archetype`]) assert.ok(at.includes(x), `${x} in ${at}`);
  assert.ok(codes(actionDoc({ hitStopMs: -1 })).includes('param_range'));
});

// ---------- fighting frame data (presets ported from the fighting kit) ----------
test('melee presets: BUILD table, normals, 12 specials and 4 supers compile with kit frame data', () => {
  assert.deepEqual(Object.keys(BUILD), ['lean', 'average', 'heavy', 'towering']);
  assert.equal(SPECIAL_ARCHETYPES.length, 12); assert.equal(SUPER_ARCHETYPES.length, 4);
  for (const sup of SUPER_ARCHETYPES) {
    const f = compileFighter({ build: 'towering', specials: SPECIAL_ARCHETYPES.map((a, i) => ({ archetype: a, name: a, power: 5, speed: 5, motion: ['qcf', 'qcb', 'dp', 'hcf'][i % 4] })), super: { archetype: sup } });
    assert.equal(Object.keys(f.moves).length, 7 + 24 + 1);
    assert.equal(f.moves['5A'].startup, 5, 'towering adds a startup frame');
    for (const m of Object.values(f.moves)) assert.equal(m.total, m.startup + m.active + m.recovery);
  }
  const avg = compileFighter({ build: 'average', specials: [{ archetype: 'uppercut', power: 5, speed: 5, motion: 'dp' }] });
  assert.deepEqual(advantage(avg.moves['5A']), { hit: 5, block: 2 });
  assert.equal(avg.moves['5A'].hitstop, 7); assert.equal(avg.moves['5B'].hitstop, 10); assert.equal(avg.moves.sp0a.hitstop, 11);
  assert.deepEqual(avg.moves.sp0a.invuln, [1, 5, 'strike']);
  assert.equal(avg.moves.sp0b.hits, 2);
});

const fighter = (specials = [], sup = { archetype: 'rush', name: 'Rush' }) => ({ build: 'average', stats: { walkSpeed: 5, jump: 5, weight: 5, health: 1000 }, specials, super: sup });
const fightDoc = (versus = {}, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'fight', title: 'Fight', seed: 4,
  spaces: [{ id: 'stage', use: 'engine.space.test', with: { size: [12, 6, 1] } }],
  systems: [
    { use: 'gameplay.combat.health', with: { types: ['phys'], iframes: 0 } },
    { use: 'gameplay.combat.melee', with: { fighterScale: 0.01 } },
    ...(extra.projectile ? [{ use: 'gameplay.combat.projectile' }] : []),
    { use: 'gameplay.combat.versus', with: { walls: [0, 9.2], maxSep: 3.6, floor: 0, locomotion: true, ...versus } },
    ...(extra.systems || []),
  ],
  content: { archetypes: [
    { id: 'ryu', kind: 'player', components: { health: { max: 1000 }, melee: { fighter: fighter(extra.specials || [{ archetype: 'charge_dash', motion: 'qcf', power: 5, speed: 5 }, { archetype: 'counter', motion: 'qcb', power: 5, speed: 5 }, { archetype: 'uppercut', motion: 'dp', power: 5, speed: 5 }]) }, versus: {}, body: { facing: 1, size: [0.38, 1, 1] } } },
    { id: 'ken', kind: 'enemy', components: { health: { max: 1000 }, melee: { fighter: fighter(extra.cpuSpecials || [{ archetype: 'counter', motion: 'qcb', power: 5, speed: 5 }]) }, versus: {}, body: { facing: -1, size: [0.38, 1, 1] } } },
  ] },
  player: { archetype: 'ryu', at: [4, 0, 0] },
});
const duel = (versus, extra) => { const rt = make(fightDoc(versus, extra)); const cpu = rt.spawn('ken', { at: [4.45, 0, 0] }); return { rt, p: rt.player(), cpu, m: rt.service('melee') }; };

test('versus: normals connect on frame data; chains and special cancels need a connect; hitstun and meter', () => {
  const { rt, p, cpu, m } = duel();
  press(rt, 'attack', 5);
  assert.equal(cpu.components.health.hp, 1000, 'startup 4');
  rt.step();
  assert.equal(cpu.components.health.hp, 970, '5A: 30 damage on frame 5');
  assert.equal(cpu.components.melee.st, 'hit');
  assert.equal(cpu.components.health.stun, 14 + 7 - 1, 'hitstun + hitstop, one frame already elapsed');
  assert.equal(p.components.versus.meter, 2);
  // Chain 5A -> 5B within the cancel window.
  rt.step({ actions: { heavy: true } });
  run(rt, 25);
  assert.equal(count(rt, 'attack_started'), 2);
  assert.equal(cpu.components.health.hp, 970 - 80, '5B is unscaled as the 2nd hit (SCALING[1] = 1)');
  assert.equal(count(rt, 'combo'), 1);
  // Whiffed 5A cannot cancel into a special.
  run(rt, 60);
  rt.space().setPos(cpu, [7.5, 0, 0], rt);
  press(rt, 'attack', 6); rt.step({ actions: { special: 'qcf' } }); run(rt, 5);
  assert.equal(p.components.melee.move, '5A', 'no cancel on whiff');
});

test('versus: guard high/low/overhead, chip, counter hit, combo scaling and juggles', () => {
  const { rt, p, cpu, m } = duel({}, { cpuSpecials: [{ archetype: 'charge_dash', motion: 'qcf', power: 5, speed: 5 }] });
  const back = { axes: { move: [-1, 0] } }, downBack = { axes: { move: [-1, -1] } };
  const reset = (gap = 0.45) => { run(rt, 60); for (const e of [p, cpu]) { e.components.health.stun = 0; e.components.health.hp = 1000; } rt.space().setPos(p, [4, 0, 0], rt); rt.space().setPos(cpu, [4 + gap, 0, 0], rt); run(rt, 1); };
  reset(); m.start(cpu, '5A'); run(rt, 6, back);
  assert.equal(count(rt, 'guard'), 1, 'standing guard blocks a mid');
  assert.equal(p.components.health.hp, 1000, 'normals do no chip');
  reset(); m.start(cpu, '2A'); run(rt, 6, back);
  assert.equal(p.components.health.hp, 975, 'a low hits a standing guard');
  reset(); m.start(cpu, '2A'); run(rt, 6, downBack);
  assert.equal(count(rt, 'guard'), 2, 'crouch guard blocks the low');
  reset(); rt.space().setPos(cpu, [4.45, 0.3, 0], rt); cpu.components.body.grounded = false; m.start(cpu, 'jA'); run(rt, 6, downBack);
  assert.equal(p.components.health.hp, 1000 - 45, 'an overhead beats a crouch guard');
  reset(1.2); m.start(cpu, 'sp0a'); run(rt, 25, back);
  assert.equal(count(rt, 'guard'), 3);
  assert.equal(p.components.health.hp, 1000 - 16, 'specials chip through guard (15%)');
  // Counter hit: strike the CPU during its own startup.
  reset(); m.start(cpu, '5B'); run(rt, 1); m.start(p, '5A'); run(rt, 5);
  assert.equal(count(rt, 'counter_hit'), 1);
  assert.equal(cpu.components.health.hp, 1000 - 36, '30 × 1.2');
  // Scaling: the third hit of a combo takes SCALING[2] = 0.85.
  reset(); const before = count(rt, 'hit');
  m.start(p, '5A'); run(rt, 6); rt.step({ actions: { attack: true } }); run(rt, 12); rt.step({ actions: { heavy: true } }); run(rt, 20);
  assert.equal(count(rt, 'hit') - before, 3);
  assert.equal(cpu.components.health.hp, 1000 - 30 - 30 - Math.round(80 * 0.85));
  // Juggles: a launched fighter can be hit in the air until the limit.
  reset(); cpu.components.versus.st = 'launch'; cpu.components.versus.juggle = 3; rt.space().setPos(cpu, [4.45, 0.4, 0], rt); cpu.components.body.vel = [0, 1, 0];
  m.start(p, '5A'); run(rt, 6);
  assert.equal(count(rt, 'juggle_limit'), 1);
});

test('versus: throws need a grounded, throwable target; throw tech; counters absorb strikes', () => {
  const { rt, p, cpu, m } = duel();
  press(rt, 'throw', 1);
  run(rt, 4);
  assert.equal(count(rt, 'grabbed'), 1);
  cpu.components.melee.intent = { press: 'throw' };
  run(rt, 3);
  assert.equal(count(rt, 'tech'), 1, 'pressing throw early techs it');
  run(rt, 60);
  // A fighter in hitstun cannot be thrown.
  m.start(p, '5A'); run(rt, 5); assert.equal(cpu.components.melee.st, 'hit');
  run(rt, 12); m.start(p, 'throw'); run(rt, 4);
  assert.equal(count(rt, 'grabbed'), 1, 'no grab during hitstun/throw protection');
  run(rt, 60);
  // Counter stance (CPU qcb special) absorbs the player's strike.
  m.start(cpu, 'sp0a'); run(rt, 4); m.start(p, '5A'); run(rt, 6);
  assert.ok(count(rt, 'parried') >= 1);
  run(rt, 30);
  assert.ok(p.components.health.hp < 1000, 'the counter answers after its freeze');
});

test('versus: launches, juggle limit, knockdown, wakeup, supers cost meter, walls and separation', () => {
  const { rt, p, cpu, m } = duel();
  m.start(p, 'sp2a'); run(rt, 6);
  assert.equal(cpu.components.versus.st, 'launch', 'uppercut launches');
  assert.ok(cpu.at[1] > 0);
  run(rt, 120);
  assert.equal(count(rt, 'knockdown'), 1);
  assert.equal(count(rt, 'wakeup') >= 1, true);
  assert.equal(m.start(p, 'super'), false, 'super needs meter');
  p.components.versus.meter = 100;
  assert.equal(m.start(p, 'super'), true);
  assert.equal(p.components.versus.meter, 0); assert.equal(count(rt, 'super'), 1);
  run(rt, 80);
  // Walls and screen separation.
  rt.space().setPos(p, [0.5, 0, 0], rt); rt.space().setPos(cpu, [8, 0, 0], rt); run(rt, 1);
  assert.ok(cpu.at[0] - p.at[0] <= 3.6 + 1e-6, 'max separation');
  rt.space().setPos(p, [4, 0, 0], rt); rt.space().setPos(cpu, [4.1, 0, 0], rt); run(rt, 1);
  assert.ok(cpu.at[0] - p.at[0] >= 0.38 - 1e-6, 'bodies separate');
});

test('versus: locomotion, deterministic replay and bad configs', () => {
  const { rt, p } = duel();
  const x0 = p.at[0]; run(rt, 10, { axes: { move: [1, 0] } });
  assert.ok(p.at[0] > x0, 'walks forward');
  run(rt, 3, { axes: { move: [0, 1] } }); run(rt, 3);
  assert.equal(count(rt, 'jump'), 1);
  same(() => duel().rt, Array.from({ length: 150 }, (_, i) => ({ actions: i % 9 === 0 ? { attack: true } : i % 13 === 0 ? { heavy: true } : {}, axes: { move: [i % 40 < 20 ? 1 : -1, 0] } })));
  const c = codes(fightDoc({ walls: [5, 1], maxSep: 99 }));
  assert.ok(c.includes('versus_walls_invalid'), c); assert.ok(c.includes('versus_maxsep_invalid'), c);
  const d = fightDoc(); d.content.archetypes.push({ id: 'ghost', components: { versus: {} } });
  assert.ok(codes(d).includes('versus_needs_melee'));
  const noProj = fightDoc({}, { specials: [{ archetype: 'fireball', motion: 'qcf' }] });
  assert.ok(codes(noProj).includes('melee_projectile_needs_projectile'));
});

test('versus: fireballs through gameplay.combat.projectile, one at a time, clash and block', () => {
  const { rt, p, cpu, m } = duel({}, { projectile: true, specials: [{ archetype: 'fireball', motion: 'qcf', power: 5, speed: 5 }], cpuSpecials: [{ archetype: 'fireball', motion: 'qcf', power: 5, speed: 5 }] });
  rt.space().setPos(cpu, [7, 0, 0], rt);
  rt.step({ actions: { special: 'qcf' } }); run(rt, 14);
  assert.equal(count(rt, 'fired'), 1);
  m.start(p, 'sp0a'); run(rt, 14);
  assert.equal(count(rt, 'fired'), 1, 'one fireball on screen at a time');
  run(rt, 60);
  assert.ok(cpu.components.health.hp < 1000);
  run(rt, 60);
  m.start(p, 'sp0a'); m.start(cpu, 'sp0a'); run(rt, 60);
  assert.ok(count(rt, 'clash') >= 1, 'opposing fireballs cancel');
});

// ---------- platform knockback ----------
const kbDoc = (k = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'kb', title: 'Knockback', seed: 9,
  spaces: [{ id: 'stage', use: 'engine.space.test', with: { size: [40, 30, 1] } }],
  systems: [
    { use: 'gameplay.combat.health', with: { types: ['phys'], iframes: 0 } },
    { use: 'gameplay.combat.knockback', with: { kb: [5, 0.1, 45], speedScale: 1, gravity: 10, floor: 1, bounds: { min: [0, -5], max: [30, 25] }, stocks: 2, respawnAt: [15, 5, 0], ...k } },
  ],
  content: { archetypes: [{ id: 'hero', kind: 'player', components: { health: { max: 100 }, body: { facing: 1 } } }, { id: 'puff', kind: 'enemy', components: { health: { max: 100 }, knockback: { weight: 5 }, body: {} } }] },
  player: { archetype: 'hero', at: [14, 1, 0] },
});

test('knockback: percent builds, launches scale with percent and weight, blast zones cost stocks then KO', () => {
  const rt = make(kbDoc()), c = rt.service('combat'), puff = rt.spawn('puff', { at: [15, 1, 0] });
  c.hit(puff, { amount: 20, by: 'player', kb: [5, 0.1, 45] });
  assert.equal(puff.components.knockback.percent, 2);
  assert.equal(puff.components.health.hp, 100, 'percent instead of hp');
  assert.equal(count(rt, 'launched'), 1);
  const v1 = Math.hypot(...puff.components.body.vel.slice(0, 2));
  assert.ok(Math.abs(v1 - (5 + 0.1 * 2) * (1.4 - 0.3)) < 1e-6);
  run(rt, 30); assert.ok(puff.at[0] > 15 && puff.at[1] > 1, 'flies up and away');
  puff.components.knockback.percent = 150;
  c.hit(puff, { amount: 50, by: 'player', kb: [5, 0.1, 45] });
  const v2 = Math.hypot(...puff.components.body.vel.slice(0, 2));
  assert.ok(v2 > v1 * 2, 'more percent, more knockback');
  puff.components.body.vel = [90, 20, 0]; puff.components.knockback.launch = 60;
  run(rt, 60);
  assert.equal(count(rt, 'blast_ko'), 1); assert.equal(puff.components.knockback.stocks, 1);
  assert.deepEqual(puff.at, [15, 5, 0]); assert.equal(puff.components.knockback.percent, 0);
  rt.space().setPos(puff, [35, 5, 0], rt); run(rt, 1);
  assert.equal(count(rt, 'defeated:puff'), 1, 'last stock KOs');
});

test('knockback: weak grounded hits only flinch; replay; bad config', () => {
  const rt = make(kbDoc()), puff = rt.spawn('puff', { at: [15, 1, 0] });
  rt.service('combat').hit(puff, { amount: 1, by: 'player', kb: [1, 0, 30] });
  assert.equal(count(rt, 'launched'), 0); assert.equal(puff.components.health.stunKind, 'hit');
  same(() => { const r = make(kbDoc()); const q = r.spawn('puff', { at: [15, 1, 0] }); r.service('combat').hit(q, { amount: 30, by: 'player' }); return r; }, Array.from({ length: 90 }, () => ({})));
  assert.ok(codes(kbDoc({ bounds: { min: [10, 10], max: [0, 20] } })).includes('knockback_bounds_invalid'));
  assert.ok(codes(kbDoc({ kb: [1, 2] })).includes('param_range'));
});

// ---------- cell spaces ----------
test('melee: a sweep on the grid reaches the cell on every side (cell anchors are cell centres)', () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const rt = make({ schema: 'gameverse.v2.game/0.2', id: 'sweep', title: 'Sweep', seed: 2,
      spaces: [{ id: 'g', use: 'engine.space.grid', with: { size: [9, 9] } }],
      systems: [{ use: 'gameplay.combat.health', with: { iframes: 0 } }, { use: 'gameplay.combat.melee' }, { use: 'engine.spawner', with: { intervalSec: 0, rules: [{ id: 'foe', archetype: 'dummy', at: [4 + dx, 4 + dy], unique: true, activation: 'always', respawnSec: 0 }] } }],
      content: { archetypes: [{ id: 'hero', components: { health: { max: 10 }, melee: { moves: { w1: { name: 'Sweep', damage: 2, reach: 1.2, arc: 360, startup: 2, active: 4, recovery: 4, units: 'world' } } } } }, { id: 'dummy', kind: 'enemy', components: { health: { max: 9 } } }] },
      player: { archetype: 'hero', at: [4, 4] } });
    run(rt, 2);
    const foe = rt.query('health').find(e => e.archetype === 'dummy');
    rt.step({ actions: { attack: true } }); run(rt, 12);
    assert.equal(foe.components.health.hp, 7, `the foe at ${dx},${dy} was hit`);
  }
});
