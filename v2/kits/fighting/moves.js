// Frame data. Every move is compiled from an archetype plus content params into one record:
// startup/active/recovery frames, damage, chip, hitstun/blockstun, pushback, hit level,
// knockdown/launch, cancel rules, the hitbox (relative to the fighter, facing right, y up from
// the feet) and behaviour flags the simulation reads. Fighters share the normal set, scaled by
// build and stats; specials and supers come from the fighter's content.

export const BUILD = {
  lean: { scale: 0.95, hw: 17, dmg: 0.92, startup: 0 },
  average: { scale: 1, hw: 19, dmg: 1, startup: 0 },
  heavy: { scale: 1.06, hw: 22, dmg: 1.08, startup: 0 },
  towering: { scale: 1.14, hw: 25, dmg: 1.14, startup: 1 },
};
export const HEIGHT = 100;            // standing height of an average fighter, in world units
export const SUPER_COST = 100;
export const LIGHT = 'light', HEAVY = 'heavy', SPECIAL = 'special', SUPER = 'super';
// Motion parse order: longer, more specific motions first so a dragon punch never reads as a quarter circle.
export const MOTION_ORDER = ['qcf2', 'hcb', 'hcf', 'dp', 'rdp', 'qcf', 'qcb', 'charge-bf', 'charge-du', 'tap-dd', 'tap-bf'];

const r = Math.round;

/** Physical stats from content stats and build. */
export function physique(fighter) {
  const b = BUILD[fighter.build] || BUILD.average, s = fighter.stats;
  return {
    scale: b.scale, hw: b.hw, h: HEIGHT * b.scale,
    walk: 1.6 + s.walkSpeed * 0.22, back: (1.6 + s.walkSpeed * 0.22) * 0.78,
    dash: 6.2 + s.walkSpeed * 0.35, jumpV: 9.6 + s.jump * 0.34, jumpX: 2.3 + s.walkSpeed * 0.13,
    gravity: 0.56 + s.weight * 0.012, weight: s.weight, hp: s.health,
  };
}

function base(id, name, kind, strength, o) {
  return {
    id, name, kind, strength, archetype: o.archetype || id, anim: o.anim || id,
    startup: o.startup, active: o.active, recovery: o.recovery,
    damage: o.damage || 0, chip: o.chip ?? (kind === 'normal' ? 0 : Math.round((o.damage || 0) * 0.15)),
    hitstun: o.hitstun ?? 16, blockstun: o.blockstun ?? 12, push: o.push ?? 18, blockPush: o.blockPush ?? 20,
    level: o.level || 'mid', knockdown: !!o.knockdown, launch: o.launch || null,
    chain: o.chain || [], specialCancel: !!o.specialCancel, superCancel: !!o.superCancel,
    box: o.box || null, hits: o.hits || 1, every: o.every || 0,
    invuln: o.invuln || null, air: !!o.air, airOk: !!o.airOk, lowProfile: !!o.lowProfile, lowInvuln: !!o.lowInvuln,
    hitstop: o.hitstop ?? (strength === LIGHT ? 7 : strength === HEAVY ? 10 : strength === SUPER ? 5 : 11),
    landRecovery: o.landRecovery ?? 0, unblockable: !!o.unblockable,
    behavior: o.behavior || 'strike', params: o.params || {},
    kb: o.kb || [1.5 + (o.damage || 0) / 30, (o.damage || 0) / 1100, 35],   // platform mode: [base, growth per %, angle°]
    meter: o.meter ?? Math.round((o.damage || 0) * 0.08),
  };
}

const box = (sc, x, y, w, h) => ({ x: r(x * sc), y: r(y * sc), w: r(w * sc), h: r(h * sc) });

/** The shared normal set, adjusted by build. */
function normals(phys, build) {
  const sc = phys.scale, d = BUILD[build].dmg, su = BUILD[build].startup, H = HEIGHT;
  return {
    '5A': base('5A', 'Jab', 'normal', LIGHT, { anim: 'jab', startup: 4 + su, active: 3, recovery: 7, damage: r(30 * d), hitstun: 14, blockstun: 11, push: 14, box: box(sc, 8, H * 0.6, 46, 18), chain: ['5A', '2A', '5B'], specialCancel: true, superCancel: true, kb: [2.2, 0.025, 30] }),
    '5B': base('5B', 'High kick', 'normal', HEAVY, { anim: 'kick', startup: 8 + su, active: 4, recovery: 15, damage: r(80 * d), hitstun: 21, blockstun: 15, push: 26, blockPush: 26, box: box(sc, 10, H * 0.5, 66, 24), specialCancel: true, superCancel: true, kb: [4.4, 0.085, 40] }),
    '2A': base('2A', 'Low jab', 'normal', LIGHT, { anim: 'cjab', startup: 4 + su, active: 3, recovery: 7, damage: r(25 * d), hitstun: 13, blockstun: 10, push: 14, level: 'low', box: box(sc, 8, H * 0.24, 48, 16), chain: ['2A', '5A', '2B'], specialCancel: true, superCancel: true, kb: [2, 0.02, 20] }),
    '2B': base('2B', 'Sweep', 'normal', HEAVY, { anim: 'sweep', startup: 7 + su, active: 4, recovery: 19, damage: r(70 * d), hitstun: 20, blockstun: 12, push: 20, level: 'low', knockdown: true, box: box(sc, 4, 0, 76, 16), superCancel: true, kb: [4, 0.07, 18] }),
    'jA': base('jA', 'Air punch', 'normal', LIGHT, { anim: 'jpunch', startup: 4, active: 8, recovery: 6, damage: r(45 * d), hitstun: 16, blockstun: 12, level: 'overhead', box: box(sc, 4, H * 0.18, 46, 34), air: true, landRecovery: 2, kb: [2.6, 0.04, 35] }),
    'jB': base('jB', 'Flying kick', 'normal', HEAVY, { anim: 'jkick', startup: 6, active: 9, recovery: 8, damage: r(70 * d), hitstun: 19, blockstun: 14, push: 22, level: 'overhead', box: box(sc, 6, 0, 58, 34), air: true, landRecovery: 3, kb: [4, 0.075, 40] }),
    'throw': base('throw', 'Throw', 'throw', HEAVY, { anim: 'throw', startup: 3, active: 2, recovery: 22, damage: r(110 * d), behavior: 'grab', params: { range: r(phys.hw * 2 + 24), techable: true }, unblockable: true, kb: [5, 0.08, 45] }),
  };
}

/** One special variant (`a` light or `b` heavy) from its archetype and params. */
function special(spec, idx, variant, phys) {
  const p = spec.power / 10, s = spec.speed / 10, heavy = variant === 'b', sc = phys.scale, H = HEIGHT;
  const id = `sp${idx}${variant}`, name = spec.name, k = 'special';
  const common = { archetype: spec.archetype, anim: spec.archetype, superCancel: true };
  const dmg = (lo, span) => r((lo + span * p) * (heavy ? 1.12 : 1));
  switch (spec.archetype) {
    case 'fireball': return base(id, name, k, SPECIAL, { ...common, startup: r(14 - s * 3), active: 2, recovery: heavy ? 32 : 30, damage: dmg(55, 50), hitstun: 20, blockstun: 18, behavior: 'projectile',
      params: { kind: 'fireball', speed: (heavy ? 5 : 3.2) + s * (heavy ? 2.6 : 2), w: 30, h: 26, y: H * 0.56 * sc, hits: 1, life: 240, level: 'mid' }, kb: [3.2, 0.05, 35] });
    case 'ground_wave': return base(id, name, k, SPECIAL, { ...common, startup: r(16 - s * 3), active: 2, recovery: 28, damage: dmg(50, 45), hitstun: 20, blockstun: 16, level: 'low', behavior: 'projectile',
      params: { kind: 'wave', speed: (heavy ? 3.6 : 2.6) + s * 1.6, w: 34, h: 18, y: 0, hits: 1, life: heavy ? 110 : 80, level: 'low' }, kb: [3.4, 0.05, 60] });
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
    default: throw Error(`unknown archetype ${spec.archetype}`);
  }
}

function superMove(spec, phys) {
  const sc = phys.scale, H = HEIGHT, common = { archetype: `super_${spec.archetype}`, anim: `super_${spec.archetype}`, meter: 0, chip: 12 };
  switch (spec.archetype) {
    case 'beam': return base('super', spec.name, 'super', SUPER, { ...common, startup: 6, active: 2, recovery: 40, damage: 46, hitstun: 22, blockstun: 16, behavior: 'projectile', invuln: [1, 8, 'all'],
      params: { kind: 'beam', speed: 8.5, w: 64, h: 54, y: H * 0.42 * sc, hits: 6, every: 4, life: 200, level: 'mid', final: { launch: { vx: 4, vy: 7 } } }, kb: [7, 0.14, 40] });
    case 'rush': return base('super', spec.name, 'super', SUPER, { ...common, startup: 4, active: 30, recovery: 30, damage: 36, hitstun: 20, blockstun: 10, push: 4, blockPush: 6, hits: 8, every: 4, behavior: 'travel', invuln: [1, 12, 'all'],
      box: box(sc, 0, H * 0.25, 56, 60), params: { vx: 8.5, stopOnHit: true, final: { launch: { vx: 4, vy: 9 } } }, kb: [7, 0.14, 45] });
    case 'rising': return base('super', spec.name, 'super', SUPER, { ...common, startup: 4, active: 26, recovery: 34, damage: 44, hitstun: 26, blockstun: 12, hits: 6, every: 4, behavior: 'rise', invuln: [1, 18, 'all'],
      box: box(sc, -6, H * 0.4, 56, 80), launch: { vx: 1.2, vy: 7 }, landRecovery: 16, params: { vx: 1.6, vy: 13.5, final: { launch: { vx: 3, vy: 10 } } }, kb: [7, 0.14, 80] });
    case 'grab': return base('super', spec.name, 'super', SUPER, { ...common, startup: 3, active: 3, recovery: 50, damage: 300, unblockable: true, behavior: 'grab', invuln: [1, 6, 'all'],
      params: { range: r(phys.hw * 2 + 60), techable: false, slam: true, cinematic: 6 }, kb: [8, 0.16, 70] });
    default: throw Error(`unknown super ${spec.archetype}`);
  }
}

/** Compile a content fighter into the record the simulation runs. */
export function compileFighter(fighter, index) {
  const phys = physique(fighter);
  const moves = normals(phys, fighter.build);
  const specials = [];
  fighter.specials.forEach((spec, i) => {
    moves[`sp${i}a`] = special(spec, i, 'a', phys);
    moves[`sp${i}b`] = special(spec, i, 'b', phys);
    specials.push({ index: i, name: spec.name, archetype: spec.archetype, motion: spec.motion, a: `sp${i}a`, b: `sp${i}b`, air: spec.archetype === 'air_dive' });
  });
  specials.sort((x, y) => MOTION_ORDER.indexOf(x.motion) - MOTION_ORDER.indexOf(y.motion));
  // An air-only special sharing a motion with a ground special only comes out in the air.
  for (const sp of specials) sp.shadowed = sp.air && specials.some(o => !o.air && o.motion === sp.motion);
  const airSpecials = [...specials.filter(s => s.air), ...specials.filter(s => !s.air)];
  moves.super = superMove(fighter.super, phys);
  for (const m of Object.values(moves)) {
    m.total = m.startup + m.active + m.recovery;
    if (m.kind === 'special') m.chain = [];
  }
  return { index, id: fighter.id, name: fighter.name, style: fighter.style, build: fighter.build, look: fighter.look, phys, moves, specials, airSpecials, fighter };
}

/** Phase of move frame mf (1-based): 'startup' | 'active' | 'recovery' | 'done'. */
export function phaseOf(m, mf) {
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
