// Move records for gameplay.combat.melee. Every attack in every genre compiles to
// one record of frame data (60 Hz frames):
//   startup/active/recovery, damage, chip, hitstun, blockstun, push, blockPush,
//   level (mid|low|overhead|high), knockdown, launch {vx,vy}, chain [ids],
//   specialCancel, superCancel, box {x,y,w,h,d} or reach+arc, hits/every,
//   invuln [from, to, 'strike'|'all'|'proj'], air, airOk, lowProfile, lowInvuln,
//   hitstop, landRecovery, unblockable, behavior + params, kb [base, growth, angle°],
//   meter (gain), cost (meter), stamina, poise, type, status, pogo, armor.
// Sources: (1) the fighting presets ported from the fighting kit (BUILD table,
// shared normals, 12 special and 4 super archetypes), in fighting units where a
// standing fighter is HEIGHT=100 tall; (2) action weapons built from item.weapon
// {damage, reach, arc, speed, stamina, combo, type}; (3) explicit records.
export const BUILD = {
  lean: { scale: 0.95, hw: 17, dmg: 0.92, startup: 0 },
  average: { scale: 1, hw: 19, dmg: 1, startup: 0 },
  heavy: { scale: 1.06, hw: 22, dmg: 1.08, startup: 0 },
  towering: { scale: 1.14, hw: 25, dmg: 1.14, startup: 1 },
};
export const HEIGHT = 100;
export const SUPER_COST = 100;
export const LIGHT = 'light', HEAVY = 'heavy', SPECIAL = 'special', SUPER = 'super';
export const SPECIAL_ARCHETYPES = ['fireball', 'ground_wave', 'uppercut', 'spin_kick', 'charge_dash', 'slide', 'command_grab', 'teleport', 'counter', 'air_dive', 'flurry', 'axe_kick'];
export const SUPER_ARCHETYPES = ['beam', 'rush', 'rising', 'grab'];
export const BEHAVIORS = ['strike', 'projectile', 'rise', 'travel', 'grab', 'teleport', 'counter', 'dive', 'hop'];
export const LEVELS = ['mid', 'low', 'overhead', 'high'];
/** Motion parse order: longer, more specific motions first so a dragon punch never reads as a quarter circle. */
export const MOTION_ORDER = ['qcf2', 'hcb', 'hcf', 'dp', 'rdp', 'qcf', 'qcb', 'charge-bf', 'charge-du', 'tap-dd', 'tap-bf'];
/** Archetypes a platform fighter may use in the air. */
export const AIR_SPECIAL_OK = new Set(['fireball', 'uppercut', 'spin_kick', 'charge_dash', 'teleport', 'air_dive', 'axe_kick', 'flurry']);
/** Default hitstop (frames) by strength. */
export const HITSTOP = { light: 7, heavy: 10, super: 5, special: 11 };

const r = Math.round;
const STATS = { walkSpeed: 5, jump: 5, weight: 5, health: 1000 };

/** Physical stats from fighter stats and build (fighting units per frame). */
export function physique(fighter = {}) {
  const b = BUILD[fighter.build] || BUILD.average, s = { ...STATS, ...(fighter.stats || {}) };
  return {
    scale: b.scale, hw: b.hw, h: HEIGHT * b.scale,
    walk: 1.6 + s.walkSpeed * 0.22, back: (1.6 + s.walkSpeed * 0.22) * 0.78,
    dash: 6.2 + s.walkSpeed * 0.35, jumpV: 9.6 + s.jump * 0.34, jumpX: 2.3 + s.walkSpeed * 0.13,
    gravity: 0.56 + s.weight * 0.012, weight: s.weight, hp: s.health,
  };
}

/** Fill a move record with defaults (works for any source). */
export function base(id, name, kind, strength, o) {
  const dmg = o.damage || 0;
  const m = {
    id, name: name || id, kind, strength, archetype: o.archetype || id, anim: o.anim || id,
    startup: o.startup ?? 6, active: o.active ?? 3, recovery: o.recovery ?? 10,
    damage: dmg, chip: o.chip ?? (kind === 'normal' || kind === 'action' ? 0 : r(dmg * 0.15)),
    hitstun: o.hitstun ?? 16, blockstun: o.blockstun ?? 12, push: o.push ?? 18, blockPush: o.blockPush ?? 20,
    level: o.level || 'mid', knockdown: !!o.knockdown, launch: o.launch || null,
    chain: o.chain || [], specialCancel: !!o.specialCancel, superCancel: !!o.superCancel,
    box: o.box || null, reach: o.reach ?? null, arc: o.arc ?? null, hits: o.hits || 1, every: o.every || 0,
    invuln: o.invuln || null, air: !!o.air, airOk: !!o.airOk, lowProfile: !!o.lowProfile, lowInvuln: !!o.lowInvuln,
    hitstop: 'hitstop' in o ? o.hitstop : HITSTOP[strength] ?? 8, // null: the melee instance's hitStopMs
    landRecovery: o.landRecovery ?? 0, unblockable: !!o.unblockable,
    behavior: o.behavior || 'strike', params: o.params || {},
    kb: o.kb || [1.5 + dmg / 30, dmg / 1100, 35],
    meter: o.meter ?? r(dmg * 0.08), cost: o.cost ?? (kind === 'super' ? SUPER_COST : 0),
    stamina: o.stamina ?? 0, poise: o.poise ?? dmg, type: o.type || null, status: o.status || null,
    pogo: !!o.pogo, armor: o.armor ?? 0, knockback: o.knockback ?? null, units: o.units || 'world', tags: o.tags || [],
  };
  m.total = m.startup + m.active + m.recovery;
  return m;
}

const box = (sc, x, y, w, h) => ({ x: r(x * sc), y: r(y * sc), w: r(w * sc), h: r(h * sc) });

/** The shared fighting normal set, adjusted by build. */
export function normals(phys, build = 'average') {
  const sc = phys.scale, d = (BUILD[build] || BUILD.average).dmg, su = (BUILD[build] || BUILD.average).startup, H = HEIGHT, u = { units: 'fighter' };
  return {
    '5A': base('5A', 'Jab', 'normal', LIGHT, { ...u, anim: 'jab', startup: 4 + su, active: 3, recovery: 7, damage: r(30 * d), hitstun: 14, blockstun: 11, push: 14, box: box(sc, 8, H * 0.6, 46, 18), chain: ['5A', '2A', '5B'], specialCancel: true, superCancel: true, kb: [2.2, 0.025, 30] }),
    '5B': base('5B', 'High kick', 'normal', HEAVY, { ...u, anim: 'kick', startup: 8 + su, active: 4, recovery: 15, damage: r(80 * d), hitstun: 21, blockstun: 15, push: 26, blockPush: 26, box: box(sc, 10, H * 0.5, 66, 24), specialCancel: true, superCancel: true, kb: [4.4, 0.085, 40] }),
    '2A': base('2A', 'Low jab', 'normal', LIGHT, { ...u, anim: 'cjab', startup: 4 + su, active: 3, recovery: 7, damage: r(25 * d), hitstun: 13, blockstun: 10, push: 14, level: 'low', box: box(sc, 8, H * 0.24, 48, 16), chain: ['2A', '5A', '2B'], specialCancel: true, superCancel: true, kb: [2, 0.02, 20] }),
    '2B': base('2B', 'Sweep', 'normal', HEAVY, { ...u, anim: 'sweep', startup: 7 + su, active: 4, recovery: 19, damage: r(70 * d), hitstun: 20, blockstun: 12, push: 20, level: 'low', knockdown: true, box: box(sc, 4, 0, 76, 16), superCancel: true, kb: [4, 0.07, 18] }),
    jA: base('jA', 'Air punch', 'normal', LIGHT, { ...u, anim: 'jpunch', startup: 4, active: 8, recovery: 6, damage: r(45 * d), hitstun: 16, blockstun: 12, level: 'overhead', box: box(sc, 4, H * 0.18, 46, 34), air: true, landRecovery: 2, kb: [2.6, 0.04, 35] }),
    jB: base('jB', 'Flying kick', 'normal', HEAVY, { ...u, anim: 'jkick', startup: 6, active: 9, recovery: 8, damage: r(70 * d), hitstun: 19, blockstun: 14, push: 22, level: 'overhead', box: box(sc, 6, 0, 58, 34), air: true, landRecovery: 3, kb: [4, 0.075, 40] }),
    throw: base('throw', 'Throw', 'throw', HEAVY, { ...u, anim: 'throw', startup: 3, active: 2, recovery: 22, damage: r(110 * d), behavior: 'grab', params: { range: r(phys.hw * 2 + 24), techable: true }, unblockable: true, kb: [5, 0.08, 45] }),
  };
}

/** One special variant (`a` light or `b` heavy) from its archetype, power and speed (1-10). */
export function special(spec, idx, variant, phys) {
  const p = (spec.power ?? 5) / 10, s = (spec.speed ?? 5) / 10, heavy = variant === 'b', sc = phys.scale, H = HEIGHT;
  const id = `sp${idx}${variant}`, name = spec.name || spec.archetype, k = 'special';
  const common = { archetype: spec.archetype, anim: spec.archetype, superCancel: true, units: 'fighter' };
  const dmg = (lo, span) => r((lo + span * p) * (heavy ? 1.12 : 1));
  switch (spec.archetype) {
    case 'fireball': return base(id, name, k, SPECIAL, { ...common, startup: r(14 - s * 3), active: 2, recovery: heavy ? 32 : 30, damage: dmg(55, 50), hitstun: 20, blockstun: 18, behavior: 'projectile',
      params: { kind: 'fireball', speed: (heavy ? 5 : 3.2) + s * (heavy ? 2.6 : 2), w: 30, h: 26, y: H * 0.56 * sc, hits: 1, life: 240, level: 'mid', single: true }, kb: [3.2, 0.05, 35] });
    case 'ground_wave': return base(id, name, k, SPECIAL, { ...common, startup: r(16 - s * 3), active: 2, recovery: 28, damage: dmg(50, 45), hitstun: 20, blockstun: 16, level: 'low', behavior: 'projectile',
      params: { kind: 'wave', speed: (heavy ? 3.6 : 2.6) + s * 1.6, w: 34, h: 18, y: 0, hits: 1, life: heavy ? 110 : 80, level: 'low', single: true }, kb: [3.4, 0.05, 60] });
    case 'uppercut': return base(id, name, k, SPECIAL, { ...common, startup: heavy ? 4 : 3, active: heavy ? 14 : 10, recovery: heavy ? 26 : 20, damage: dmg(85, 60), hitstun: 30, blockstun: 18, launch: { vx: 1.6, vy: heavy ? 10 : 8.5 },
      knockdown: true, hits: heavy ? 2 : 1, every: 6, invuln: [1, (heavy ? 7 : 4) + r(s * 2), 'strike'], behavior: 'rise', box: box(sc, 0, H * 0.45, 40, 70), landRecovery: heavy ? 14 : 10,
      params: { vx: 1.4 + s * 0.6, vy: (heavy ? 11.5 : 9.5) + p * 1.2 }, kb: [5.5, 0.105, 80] });
    case 'spin_kick': return base(id, name, k, SPECIAL, { ...common, startup: 8, active: heavy ? 44 : 30, recovery: 12, damage: dmg(28, 22), hitstun: 18, blockstun: 12, push: 10, hits: heavy ? 5 : 3, every: 9,
      knockdown: true, lowInvuln: true, behavior: 'travel', box: box(sc, -10, H * 0.42, 70, 30), landRecovery: 6, params: { vx: 2.6 + s * 2.2, hover: 26 }, kb: [3.6, 0.06, 35] });
    case 'charge_dash': return base(id, name, k, SPECIAL, { ...common, startup: r(9 - s * 3), active: heavy ? 26 : 18, recovery: 16, damage: dmg(75, 60), hitstun: 22, blockstun: 14, push: 24,
      knockdown: heavy, behavior: 'travel', box: box(sc, 6, H * 0.3, 48, 50), params: { vx: 5.4 + s * 3.2, stopOnHit: true }, kb: [5, 0.09, 30] });
    case 'slide': return base(id, name, k, SPECIAL, { ...common, startup: 6, active: heavy ? 24 : 18, recovery: 14, damage: dmg(65, 40), hitstun: 20, blockstun: 12, level: 'low', knockdown: true, lowProfile: true,
      behavior: 'travel', box: box(sc, 4, 0, 60, 20), params: { vx: 4.6 + s * 2.4, stopOnHit: true }, kb: [4.4, 0.075, 15] });
    case 'command_grab': return base(id, name, k, SPECIAL, { ...common, startup: heavy ? 7 : 5, active: 2, recovery: 34, damage: dmg(130, 90), unblockable: true, behavior: 'grab',
      params: { range: r(phys.hw * 2 + (heavy ? 52 : 34) + s * 14), techable: false, slam: true }, kb: [6, 0.1, 70] });
    case 'teleport': return base(id, name, k, SPECIAL, { ...common, startup: 6, active: r(16 - s * 5), recovery: 12, damage: 0, behavior: 'teleport', invuln: [1, 22, 'all'], params: { behind: !heavy } });
    case 'counter': return base(id, name, k, SPECIAL, { ...common, startup: 3, active: heavy ? 26 : 20, recovery: 20, damage: dmg(95, 60), hitstun: 30, knockdown: true, behavior: 'counter',
      box: box(sc, 0, H * 0.3, 64, 56), launch: { vx: 3.5, vy: 6 }, params: { strike: { startup: 2, active: 4, recovery: 18 } }, kb: [6, 0.1, 45] });
    case 'air_dive': return base(id, name, k, SPECIAL, { ...common, startup: 4, active: 60, recovery: 4, damage: dmg(65, 40), hitstun: 19, blockstun: 14, level: 'overhead', behavior: 'dive', airOk: true,
      box: box(sc, 6, -4, 48, 34), landRecovery: 10, params: { vx: 4.4 + s * 2, vy: -(6 + s * 2.4), hop: heavy ? 9 : 8 }, kb: [4.5, 0.08, -60] });
    case 'flurry': return base(id, name, k, SPECIAL, { ...common, startup: r(8 - s * 3), active: heavy ? 40 : 28, recovery: 14, damage: dmg(16, 10), hitstun: 14, blockstun: 10, push: 6, blockPush: 7, hits: heavy ? 7 : 5, every: 6,
      chip: 4, behavior: 'strike', box: box(sc, 8, H * 0.5, 54, 34), params: { vx: 0.25 }, kb: [1.8, 0.02, 30] });
    case 'axe_kick': return base(id, name, k, SPECIAL, { ...common, startup: r((heavy ? 22 : 18) - s * 4), active: 10, recovery: 14, damage: dmg(80, 50), hitstun: 22, blockstun: 16, level: 'overhead', knockdown: heavy, behavior: 'hop',
      box: box(sc, 8, H * 0.1, 50, 60), params: { vx: 2 + s, vy: 6.5 }, kb: [5, 0.09, -45] });
    default: throw Error(`unknown special archetype '${spec.archetype}'`);
  }
}

export function superMove(spec, phys) {
  const sc = phys.scale, H = HEIGHT, common = { archetype: `super_${spec.archetype}`, anim: `super_${spec.archetype}`, meter: 0, chip: 12, units: 'fighter' };
  const name = spec.name || spec.archetype;
  switch (spec.archetype) {
    case 'beam': return base('super', name, 'super', SUPER, { ...common, startup: 6, active: 2, recovery: 40, damage: 46, hitstun: 22, blockstun: 16, behavior: 'projectile', invuln: [1, 8, 'all'],
      params: { kind: 'beam', speed: 8.5, w: 64, h: 54, y: H * 0.42 * sc, hits: 6, every: 4, life: 200, level: 'mid', final: { launch: { vx: 4, vy: 7 } } }, kb: [7, 0.14, 40] });
    case 'rush': return base('super', name, 'super', SUPER, { ...common, startup: 4, active: 30, recovery: 30, damage: 36, hitstun: 20, blockstun: 10, push: 4, blockPush: 6, hits: 8, every: 4, behavior: 'travel', invuln: [1, 12, 'all'],
      box: box(sc, 0, H * 0.25, 56, 60), params: { vx: 8.5, stopOnHit: true, final: { launch: { vx: 4, vy: 9 } } }, kb: [7, 0.14, 45] });
    case 'rising': return base('super', name, 'super', SUPER, { ...common, startup: 4, active: 26, recovery: 34, damage: 44, hitstun: 26, blockstun: 12, hits: 6, every: 4, behavior: 'rise', invuln: [1, 18, 'all'],
      box: box(sc, -6, H * 0.4, 56, 80), launch: { vx: 1.2, vy: 7 }, landRecovery: 16, params: { vx: 1.6, vy: 13.5, final: { launch: { vx: 3, vy: 10 } } }, kb: [7, 0.14, 80] });
    case 'grab': return base('super', name, 'super', SUPER, { ...common, startup: 3, active: 3, recovery: 50, damage: 300, unblockable: true, behavior: 'grab', invuln: [1, 6, 'all'],
      params: { range: r(phys.hw * 2 + 60), techable: false, slam: true, cinematic: 6 }, kb: [8, 0.16, 70] });
    default: throw Error(`unknown super archetype '${spec.archetype}'`);
  }
}

/** Compile a fighter preset {build, stats, specials[], super} into moves + physique. */
export function compileFighter(fighter = {}) {
  const phys = physique(fighter), moves = normals(phys, fighter.build);
  const specials = [];
  (fighter.specials || []).forEach((spec, i) => {
    moves[`sp${i}a`] = special(spec, i, 'a', phys);
    moves[`sp${i}b`] = special(spec, i, 'b', phys);
    specials.push({ index: i, name: spec.name, archetype: spec.archetype, motion: spec.motion || 'qcf', a: `sp${i}a`, b: `sp${i}b`, air: spec.archetype === 'air_dive' });
  });
  specials.sort((x, y) => (MOTION_ORDER.indexOf(x.motion) + 99) % 99 - (MOTION_ORDER.indexOf(y.motion) + 99) % 99);
  for (const sp of specials) sp.shadowed = sp.air && specials.some(o => !o.air && o.motion === sp.motion);
  if (fighter.super) moves.super = superMove(fighter.super, phys);
  for (const m of Object.values(moves)) if (m.kind === 'special') m.chain = [];
  return { phys, moves, specials };
}

/**
 * Action weapon moveset from item.weapon {damage, reach, arc, speed, stamina, combo, type}:
 * a light combo chain w1..wN, a heavy, and a plunge (downward pogo strike).
 * Timings scale with 1/speed; the last combo hit hits harder.
 */
export function compileWeapon(item, { pogo = false } = {}) {
  const w = item.weapon || {}, sp = Math.max(0.2, w.speed ?? 1), dmg = w.damage ?? 10, reach = w.reach ?? 1.2, arc = w.arc ?? 100, n = Math.max(1, w.combo ?? 1);
  const f = s => Math.max(1, Math.round(s * 60 / sp));
  const common = { reach, arc, type: w.type || null, tags: item.tags || [], kind: 'action', units: 'world' };
  const moves = {};
  for (let i = 1; i <= n; i++) {
    const last = i === n && n > 1;
    moves[`w${i}`] = base(`w${i}`, `${item.name || item.id} ${i}`, 'action', LIGHT, { ...common, startup: f(i === 1 ? 0.22 : 0.16), active: f(0.1), recovery: f(last ? 0.45 : 0.3),
      damage: Math.round(dmg * (last ? 1.25 : 1) * 100) / 100, hitstun: f(0.3), blockstun: f(0.2), stamina: w.stamina ?? 0, poise: dmg * (last ? 1.2 : 1), chain: i < n ? [`w${i + 1}`] : [], hitstop: null });
  }
  moves.heavy = base('heavy', `${item.name || item.id} heavy`, 'action', HEAVY, { ...common, reach: reach * 1.15, startup: f(0.5), active: f(0.14), recovery: f(0.55),
    damage: Math.round(dmg * 1.8 * 100) / 100, hitstun: f(0.5), blockstun: f(0.35), stamina: (w.stamina ?? 0) * 1.6, poise: dmg * 2.2, hitstop: null, knockback: 1 });
  if (pogo) moves.plunge = base('plunge', `${item.name || item.id} down`, 'action', LIGHT, { ...common, arc: 120, startup: f(0.08), active: f(0.14), recovery: f(0.2),
    damage: dmg, hitstun: f(0.3), stamina: w.stamina ?? 0, pogo: true, air: true, hitstop: null, params: { down: true } });
  for (const m of Object.values(moves)) m.total = m.startup + m.active + m.recovery;
  return moves;
}

/** Phase of move frame mf (1-based). */
export function phaseOf(m, mf) {
  if (mf <= 0) return null;
  if (mf <= m.startup) return 'startup';
  if (mf <= m.startup + m.active) return 'active';
  if (mf <= m.total) return 'recovery';
  return 'done';
}
/** Frame advantage on hit/block when the first active frame connects (no hitstop). */
export function advantage(m) {
  const rest = m.active - 1 + m.recovery;
  return { hit: m.hitstun - rest, block: m.blockstun - rest };
}
