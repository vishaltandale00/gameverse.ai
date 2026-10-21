// gameplay.combat.melee: hitbox attacks for any entity, driven by frame data.
// One move runner covers action games (weapon combos, heavy attacks, block,
// parry and riposte, poise and stagger, pogo, stamina costs, hit-stop) and
// fighting games (startup/active/recovery, hit/blockstun, pushback, levels,
// chains, special/super cancels on connect, invulnerability windows, multi-hit,
// grabs with tech, counters, teleports, dives, the BUILD table and the 12
// special + 4 super archetypes as presets; see combat-lib-moves.js).
//
// Movesets come from components.melee: `weapon` (item with item.weapon), `fighter`
// (preset {build, stats, specials, super}), `moves` (library ids from this
// instance's `moves`, or inline records) and `bind` (press -> move id).
// Input: player actions attack/heavy/special/super/throw/block (held); NPCs write
// components.melee.intent = {press, dir, hold, motion}, consumed every frame.
// Hits go through the combat service; block, parry, poise and counters are
// interceptors, so projectiles and contact damage respect them too.
import { inputOf, controlDir, frames, msFrames, invulnFrames, v3, sub, norm, dot, posOf, facingOf, facingSign, spaceOf, distance, statOf, hostile, resolveWho, intercept, hooks, hitShape, overlapping, displace, combat, service, held, setFacing, like, err, archetypes } from './combat-lib.js';
import { compileFighter, compileWeapon, base, phaseOf, advantage, MOTION_ORDER, BUILD, SPECIAL_ARCHETYPES, SUPER_ARCHETYPES, BEHAVIORS, LEVELS, HEIGHT, AIR_SPECIAL_OK } from './combat-lib-moves.js';

const KEY = 'gameplay.combat.melee';
const PRESSES = ['light', 'heavy', 'special', 'super', 'throw'];
const VERBS = ['attack', 'heavy', 'special', 'super', 'throw', 'block'];
const FREE = new Set(['idle', undefined]);
const TECH_WINDOW = 9;

const MOVE_FIELDS = { id: { type: 'string', required: true } };

export default {
  id: KEY,
  card: {
    loop: { verbs: ['attack', 'heavy', 'special', 'super', 'throw', 'block'], progress: ['hit', 'combo', 'parried', 'staggered'] },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "archetypes", "component": "health", "kinds": ["enemy", "boss", "creature", "npc"], "min": 1, "placed": 3, "zones": 2, "why": "melee needs opponents with health to hit, placed where the player meets them", "example": {"id": "thornling", "kind": "enemy", "components": {"health": {"max": 6}, "touch": {"damage": 1}, "ai": {"brain": [{"do": "chase", "when": {"near": "player", "within": 6}}, {"do": "patrol", "range": 5}], "speed": 2.5}}}},
    ],
    // A basic swing (attack) and heavy blow for a player the document gave no moveset; selected like a weapon's w1/heavy.
    engage: { player: { components: { melee: { moves: {
      w1: { name: 'Strike', damage: 3, reach: 1.2, arc: 100, startup: 8, active: 6, recovery: 14, hitstun: 18, units: 'world' },
      heavy: { name: 'Heavy strike', strength: 'heavy', damage: 6, reach: 1.4, arc: 100, startup: 24, active: 8, recovery: 30, hitstun: 30, knockback: 1, units: 'world' },
    } } } } },
    intent: 'Melee attacks with frame data for any entity: windup/active/recovery hitboxes, combos and chains, heavy attacks, block, parry and riposte, poise and stagger, pogo strikes, stamina costs, hit-stop, and full fighting-game moves (hit/blockstun, push, high/low/overhead levels, cancels, invulnerability, grabs and tech, counters) with BUILD and special/super presets.',
    views: ['3p', 'side', 'td', '1p'],
    params: {
      comboWindowMs: { type: 'number', default: 450, min: 0, max: 3000, unit: 'ms', effect: 'time after a combo hit ends to press for the next one' },
      bufferMs: { type: 'number', default: 100, min: 0, max: 1000, unit: 'ms', effect: 'presses are remembered this long and fire as soon as the entity can act' },
      parry: { type: 'object', default: { window: 0, stagger: 1, riposte: 2 }, fields: {
        window: { type: 'number', default: 0, min: 0, max: 1000, unit: 'ms', effect: 'block pressed this soon before a hit parries it; 0 disables' },
        stagger: { type: 'number', default: 1, min: 0, max: 10, unit: 's', effect: 'how long a parried attacker (or poise-broken target) is staggered' },
        riposte: { type: 'number', default: 2, min: 1, max: 20, unit: '×', effect: 'damage multiplier on staggered targets' },
      } },
      block: { type: 'object', default: { reduction: 0.6, staminaPerDmg: 0.5, arc: 180 }, fields: {
        reduction: { type: 'number', default: 0.6, min: 0, max: 1, effect: 'damage blocked' },
        staminaPerDmg: { type: 'number', default: 0.5, min: 0, max: 20, effect: 'stamina spent per point of damage blocked; running out breaks the guard' },
        arc: { type: 'number', default: 180, min: 0, max: 360, unit: 'deg', effect: 'blocking covers attacks from within this arc in front' },
      } },
      pogo: { type: 'boolean', default: false, effect: 'downward air strikes (plunge) bounce the attacker up on hit (side view)' },
      pogoSpeed: { type: 'number', default: 12, min: 0, max: 200, unit: 'units/s', effect: 'upward speed of a pogo bounce' },
      hitStopMs: { type: 'number', default: 60, min: 0, max: 500, unit: 'ms', effect: 'freeze on hit for moves without their own hitstop (action weapons)' },
      poise: { type: 'boolean', default: false, effect: 'hits drain poise (a poise pool or components.poise); targets with poise left do not flinch, breaking it staggers' },
      poiseResetSec: { type: 'number', default: 3, min: 0, max: 60, unit: 's', effect: 'component poise refills after this long without hits' },
      staminaTag: { type: 'string', default: 'attack', effect: 'resource pool or drain tag paid by move stamina costs' },
      blockTag: { type: 'string', default: 'block', effect: 'resource pool or drain tag paid while blocking' },
      fighterScale: { type: 'number', default: 0.01, min: 0.0001, max: 100, unit: 'units', effect: 'world units per fighting unit (a preset fighter is 100 fighting units tall)' },
      combatSec: { type: 'number', default: 5, min: 0, max: 60, unit: 's', effect: 'in_combat stays true this long after attacking or being hit' },
      friendlyFire: { type: 'boolean', default: false },
      moves: { type: 'list', default: [], of: { type: 'object', fields: MOVE_FIELDS, open: true }, effect: 'move library: frame-data records any archetype can list in components.melee.moves' },
    },
    provides: { events: ['attack_started', 'hit', 'blocked', 'parried', 'staggered', 'guard_broken', 'riposte', 'combo', 'pogo', 'grabbed', 'tech', 'whiff', 'exhausted_attack', 'teleported', 'counter_stance'], services: ['melee'], actions: ['attack', 'heavy', 'special', 'super', 'throw', 'block'] },
    requires: { primitives: ['gameplay.combat.health'], capabilities: ['overlap'] },
    reads: ['content.items'],
    defines: [{ kind: 'move', in: 'moves' }],
    actionSpace: { special: { type: 'enum', options: MOTION_ORDER } },
  },
  logic(logic) {
    logic.predicate('in_combat', { test: (p, rt, c) => { const e = resolveWho(rt, p.in_combat === true ? undefined : p.in_combat ?? p.who, c); const m = e?.components.melee; return Boolean(m && m.lastCombat != null && rt.state.frame - m.lastCombat <= (rt.caches.meleeCombatFrames ?? 300)); } });
    logic.effect('attack', { run: (e, rt, c) => { const t = resolveWho(rt, e.who, c); if (t) rt.service('melee').start(t, e.move); } });
    logic.effect('set_weapon', { refs: e => [['item', e.item]], run: (e, rt, c) => { const t = resolveWho(rt, e.who, c); if (t) { (t.components.melee ??= {}).weapon = e.item; t.components.melee.compiled = null; } } });
  },
  validate(config, doc) {
    const errors = [], lib = new Map(), items = new Map((doc.content?.items || []).map(i => [i.id, i]));
    const projectileOn = (doc.systems || []).some(s => s.use === 'gameplay.combat.projectile');
    const checkMove = (m, path) => {
      for (const k of ['startup', 'active', 'recovery']) if (m[k] !== undefined && !(Number.isInteger(m[k]) && m[k] >= 0)) errors.push(err('melee_move_invalid', `${path}.${k}`, `${k} must be a whole number of frames`));
      if (m.behavior && !BEHAVIORS.includes(m.behavior)) errors.push(err('melee_move_invalid', `${path}.behavior`, `behavior must be ${BEHAVIORS.join('|')}`));
      if (m.level && !LEVELS.includes(m.level)) errors.push(err('melee_move_invalid', `${path}.level`, `level must be ${LEVELS.join('|')}`));
      if (m.behavior === 'projectile' && !projectileOn) errors.push(err('melee_projectile_needs_projectile', path, 'projectile moves need gameplay.combat.projectile'));
    };
    config.moves.forEach((m, i) => { lib.set(m.id, m); checkMove(m, `with.moves[${i}]`); });
    config.moves.forEach((m, i) => (m.chain || []).forEach(c => { if (!lib.has(c)) errors.push(err('melee_move_unknown', `with.moves[${i}].chain`, `unknown move '${c}'`)); }));
    archetypes(doc).forEach((a, i) => {
      const c = a.components?.melee, path = `content.archetypes[${i}].components.melee`;
      if (!c) return;
      if (c.weapon !== undefined && !items.get(c.weapon)?.weapon) errors.push(err('melee_weapon_unknown', `${path}.weapon`, `'${c.weapon}' is not an item with a weapon block`));
      if (c.fighter) {
        const f = c.fighter;
        if (f.build && !BUILD[f.build]) errors.push(err('melee_preset_invalid', `${path}.fighter.build`, `build must be ${Object.keys(BUILD).join('|')}`));
        (f.specials || []).forEach((s, j) => { if (!SPECIAL_ARCHETYPES.includes(s.archetype)) errors.push(err('melee_preset_invalid', `${path}.fighter.specials[${j}].archetype`, `unknown special '${s.archetype}'`, SPECIAL_ARCHETYPES.join(', '))); });
        if (f.super && !SUPER_ARCHETYPES.includes(f.super.archetype)) errors.push(err('melee_preset_invalid', `${path}.fighter.super.archetype`, `unknown super '${f.super.archetype}'`, SUPER_ARCHETYPES.join(', ')));
        if (!projectileOn && [...(f.specials || []).map(s => s.archetype), f.super?.archetype].some(x => ['fireball', 'ground_wave', 'beam'].includes(x))) errors.push(err('melee_projectile_needs_projectile', `${path}.fighter`, 'projectile specials need gameplay.combat.projectile'));
      }
      if (Array.isArray(c.moves)) c.moves.forEach((id, j) => { if (!lib.has(id)) errors.push(err('melee_move_unknown', `${path}.moves[${j}]`, `unknown move '${id}'`, `library: ${[...lib.keys()].join(', ') || 'empty'}`)); });
      else if (c.moves && typeof c.moves === 'object') for (const [id, m] of Object.entries(c.moves)) checkMove(m, `${path}.moves.${id}`);
    });
    return errors;
  },
  install(rt, config) {
    const scaleOf = m => (m.units === 'fighter' ? config.fighterScale : 1);
    const bufferF = msFrames(config.bufferMs), comboF = msFrames(config.comboWindowMs), parryF = msFrames(config.parry.window), staggerF = frames(config.parry.stagger);
    rt.caches.meleeCombatFrames = frames(config.combatSec);
    const lib = new Map(config.moves.map(m => [m.id, m]));
    const record = (id, m) => base(id, m.name, m.kind || 'action', m.strength || 'light', m);

    /** Compiled moveset for an entity: { moves, specials, phys }. Cached per archetype+weapon+doc. */
    const setOf = e => {
      const c = e.components.melee; if (!c) return null;
      const key = `${e.archetype}|${c.weapon ?? ''}`;
      const cache = (rt.caches.meleeSets ??= { doc: null, map: new Map() });
      if (cache.doc !== rt.doc) { cache.doc = rt.doc; cache.map = new Map(); }
      if (cache.map.has(key)) return cache.map.get(key);
      const out = { moves: {}, specials: [], phys: null };
      if (c.fighter) { const f = compileFighter(c.fighter); Object.assign(out.moves, f.moves); out.specials = f.specials; out.phys = f.phys; }
      if (c.weapon) { const item = rt.doc.content?.items?.find(i => i.id === c.weapon); if (item?.weapon) Object.assign(out.moves, compileWeapon(item, { pogo: config.pogo })); }
      if (Array.isArray(c.moves)) for (const id of c.moves) { if (lib.has(id)) out.moves[id] = record(id, lib.get(id)); }
      else if (c.moves) for (const [id, m] of Object.entries(c.moves)) out.moves[id] = record(id, m);
      cache.map.set(key, out);
      return out;
    };
    const st = e => { const m = e.components.melee; m.st ??= 'idle'; m.combo ??= 0; m.comboDmg ??= 0; m.comboIdx ??= 0; return m; };
    const grounded = e => {
      const b = e.components.body;
      if (typeof b?.grounded === 'boolean') return b.grounded;
      const api = spaceOf(rt, e);
      if (api?.gravityAt && api.grounded && Array.isArray(e.at)) { const g = v3(api.gravityAt(e.at)); if (g[0] || g[1] || g[2]) return api.grounded(e); }
      return true;
    };
    const stunned = e => (e.components.health?.stun ?? 0) > 0;
    const setVel = (e, v) => { const b = (e.components.body ??= {}); b.vel = like(Array.isArray(b.vel) ? b.vel : e.at?.length === 2 ? [0, 0] : [0, 0, 0], v3(v)); if (v[1] > 0) b.grounded = false; };
    /** Show a pose on spaces with box sets (arena2d) when the archetype authored it. */
    const pose = (e, name) => { const api = spaceOf(rt, e), b = e.components.body; if (!api?.setPose || !b?.poses) return; const p = b.poses[name] ? name : b.poses.idle ? 'idle' : null; if (b.pose !== p) api.setPose(e, p); };
    const mhooks = () => (rt.caches.meleeHooks ??= { canStart: [], onStart: [], onConnect: [], select: [], canGrab: [] });

    /** numpad direction (1-9) the entity holds relative to facing: its controls, or an NPC's melee intent. */
    const dirOf = e => controlDir(rt, e);
    const press = (e, kind, value) => {
      const m = st(e);
      m.buffer = { press: kind, value: value === true ? null : value, dir: dirOf(e), at: rt.state.frame };
      if (kind === 'block') m.blockAt = rt.state.frame;
    };
    for (const a of VERBS) rt.action(a, (v, rt) => { const p = rt.player(); if (p?.components.melee) press(p, a === 'attack' ? 'light' : a, v); });
    // An NPC with controls (components.input, written by a CPU such as gameplay.ai.versus in the ai phase) presses the
    // same verbs a person does, on the step the input layer and the motion parser see them (the next step's input
    // phase, KERNEL_API §2): engine.input.actions' resolved view when it is installed, else the presses as they stood
    // in this step's input phase (taken here, before the CPU writes again).
    rt.system('input', rt => {
      if (rt.hasService('input')) return;
      for (const e of Object.values(rt.state.entities)) if (e.id !== 'player' && e.components.melee && e.components.input) st(e).pressed = { ...(e.components.input.actions || {}) };
    }, KEY);
    const npcPresses = e => {
      if (e.id === 'player' || !e.components.input || e.components.melee.intent?.press) return;
      const m = st(e), actions = rt.hasService('input') ? inputOf(rt, e)?.actions : m.pressed;
      m.pressed = null;
      for (const a of VERBS) { const v = actions?.[a]; if (v !== undefined && v !== null && v !== false) press(e, a === 'attack' ? 'light' : a, v); }
    };
    // A motion completed with a button (engine.input.motions, for the player and every entity with controls) is the
    // special (or, for qcf2, the super) of that motion: the button's verb picks the variant, as a special press does.
    rt.on('motion', ev => {
      const e = rt.entity(ev.who), set = e?.components.melee && ev.button ? setOf(e) : null; if (!set) return;
      const kind = ev.motion === 'qcf2' && set.moves.super ? 'super' : set.specials.some(sp => sp.motion === ev.motion) ? 'special' : null;
      if (kind) st(e).motionPress = { kind, motion: ev.motion, button: ev.button === 'heavy' ? 'heavy' : 'light', at: rt.state.frame };
    });
    const motionPress = e => {
      const m = st(e), mp = m.motionPress; if (!mp) return;
      m.motionPress = null;
      if (mp.at === rt.state.frame) press(e, mp.kind, { motion: mp.motion, button: mp.button });
    };

    const select = (e, set, buf, cancelFrom) => {
      for (const fn of mhooks().select) { const id = fn(e, set, buf, cancelFrom); if (id) return id; }
      const c = e.components.melee, m = st(e), moves = set.moves, air = !grounded(e), dir = buf.dir ?? 5, crouch = dir >= 1 && dir <= 3;
      const val = buf.value;
      if (typeof val === 'string' && moves[val]) return val;
      const bound = c.bind?.[`${air ? 'air_' : crouch ? 'crouch_' : ''}${buf.press}`] ?? c.bind?.[buf.press];
      if (bound && moves[bound]) return bound;
      if (buf.press === 'super' || (buf.press === 'special' && (val?.motion ?? val) === 'qcf2')) return moves.super ? 'super' : null;
      if (buf.press === 'special') {
        const motion = typeof val === 'string' ? val : val?.motion, heavy = (val?.button ?? 'light') === 'heavy';
        for (const sp of set.specials) {
          if (air ? !(sp.air || AIR_SPECIAL_OK.has(sp.archetype) && c.fighter?.airSpecials) : sp.shadowed) continue;
          if (motion && sp.motion !== motion) continue;
          return heavy ? sp.b : sp.a;
        }
        return null;
      }
      if (buf.press === 'throw') return moves.throw ? 'throw' : null;
      if (moves.w1 || moves.heavy) { // action weapon set
        if (buf.press === 'heavy') return moves.heavy ? 'heavy' : null;
        if (air && crouch && moves.plunge) return 'plunge';
        const next = `w${m.comboIdx + 1}`;
        if (m.comboIdx > 0 && moves[next] && (rt.state.frame <= m.comboUntil || cancelFrom)) return next;
        return moves.w1 ? 'w1' : null;
      }
      const id = air ? (buf.press === 'heavy' ? 'jB' : 'jA') : (crouch ? '2' : '5') + (buf.press === 'heavy' ? 'B' : 'A');
      return moves[id] ? id : null;
    };
    const canCancel = (from, to) => from.chain.includes(to.id) || (to.kind === 'special' && from.specialCancel) || (to.kind === 'super' && (from.superCancel || from.kind === 'special'));

    const start = (e, id, { force = false } = {}) => {
      const set = setOf(e); if (!set) return false;
      const mv = set.moves[id]; if (!mv) return false;
      const m = st(e);
      if (!force && (stunned(e) || e.components.health?.dead)) return false;
      if (mv.air && grounded(e) && !mv.airOk) return false;
      for (const fn of mhooks().canStart) if (fn(e, mv) === false) return false;
      if (mv.stamina > 0 && service(rt, 'resources')?.has(e, config.staminaTag)) {
        if (!rt.service('resources').spend(e, config.staminaTag, mv.stamina)) { rt.emit('exhausted_attack', { who: e.id, move: id }); m.buffer = null; return false; }
      }
      pose(e, mv.anim);
      Object.assign(m, { st: 'attack', move: id, mf: 0, phase: 'startup', connect: null, hitList: {}, hitsDone: 0, lastHitMf: -99, counterStrike: 0, diving: false, inv: null, hidden: false, landT: 0 });
      if (mv.kind === 'action' && /^w\d+$/.test(id)) m.comboIdx = Number(id.slice(1));
      else if (mv.kind === 'action') m.comboIdx = 0;
      if (!grounded(e)) m.airUsed = true;
      m.lastCombat = rt.state.frame;
      for (const fn of mhooks().onStart) fn(e, mv);
      rt.emit('attack_started', { who: e.id, move: id, kind: mv.kind, strength: mv.strength });
      if (mv.kind === 'action' && e.components.melee.weapon) rt.emit('weapon_used', { who: e.id, item: e.components.melee.weapon });
      return true;
    };

    // ---- hits ----
    const hurtOk = (a, d, mv) => {
      if (d.id === a.id || !d.components.health || !combat(rt)?.canHit(a, d) || !hostile(rt, a, d, config.friendlyFire)) return false;
      const dm = d.components.melee;
      if (dm?.hidden) return false;
      if (dm?.inv === 'all' || (dm?.inv === 'strike')) return false;
      if (dm?.st === 'attack') { const dmv = setOf(d)?.moves[dm.move]; const ph = dmv && phaseOf(dmv, dm.mf);
        if (dmv?.lowInvuln && ph === 'active' && mv.level === 'low') return false;
        if (dmv?.lowProfile && ph !== 'startup' && mv.level !== 'low') return false; }
      return true;
    };
    const connect = (a, d, mv) => {
      const sc = scaleOf(mv), am = st(a), dm = d.components.melee ? st(d) : null;
      const dmv = dm?.st === 'attack' ? setOf(d)?.moves[dm.move] : null;
      const counter = Boolean(dmv && phaseOf(dmv, dm.mf) === 'startup');
      const stop = mv.hitstop ?? msFrames(config.hitStopMs);
      const final = mv.params?.final && am.hitsDone >= mv.hits ? mv.params.final : null;
      const fwd = facingOf(a);
      const hit = {
        amount: mv.damage, type: mv.type ?? undefined, by: a.id, source: 'melee', move: mv.id, kind: mv.kind, strength: mv.strength, level: mv.level,
        unblockable: mv.unblockable, chip: mv.chip, stun: mv.hitstun + stop, blockstun: mv.blockstun + stop, push: mv.push * sc, blockPush: mv.blockPush * sc,
        knockback: mv.knockback ?? (mv.units === 'fighter' ? mv.push * sc * 0.22 * 5 : undefined), dir: fwd, tags: mv.tags, poise: mv.poise, status: mv.status,
        launch: final?.launch ?? mv.launch, knockdown: final ? true : mv.knockdown, kb: mv.kb, counter, hitstop: stop, frame: mv, units: mv.units, scale: sc,
      };
      const wasStunned = (d.components.health?.stun ?? 0) > 0;
      const res = combat(rt).hit(d, hit);
      am.lastCombat = rt.state.frame;
      if (!res.applied) {
        if (res.parried) am.connect = 'parried';
        return res;
      }
      const x = res.hit, blocked = Boolean(x.blocked);
      am.connect = blocked ? 'block' : 'hit';
      am.hitstop = blocked ? Math.max(0, stop - 3) : stop;
      if (dm) {
        dm.lastCombat = rt.state.frame; dm.hitstop = am.hitstop;
        const armored = dm.st === 'attack' && dmv?.armor > 0 && phaseOf(dmv, dm.mf) !== 'recovery';
        if ((x.stun ?? 0) > 0 && !armored && d.components.health.stun > 0) { dm.st = d.components.health.stunKind || 'hit'; dm.move = null; dm.phase = null; dm.inv = null; dm.hidden = false; dm.buffer = null; }
        if (!blocked) {
          dm.combo = (wasStunned ? dm.combo : 0) + 1; dm.comboDmg = (dm.comboDmg ?? 0) + res.damage;
          if (dm.combo >= 2) rt.emit('combo', { by: a.id, target: d.id, count: dm.combo, damage: dm.comboDmg });
        }
      }
      if (!blocked && x.launch && !d.components.versus && d.components.body && !res.killed) {
        const s = scaleOf(mv) * (mv.units === 'fighter' ? 60 : 1);
        setVel(d, [x.launch.vx * facingSign(a) * s, x.launch.vy * s, 0]);
      }
      if (mv.status && !blocked && service(rt, 'status')) rt.service('status').apply(d, mv.status, { by: a.id });
      if (mv.pogo && config.pogo) { setVel(a, [v3(a.components.body?.vel)[0], config.pogoSpeed, 0]); am.airUsed = false; rt.emit('pogo', { who: a.id, target: d.id }); }
      for (const fn of mhooks().onConnect) fn(a, d, mv, res);
      rt.emit('hit', { by: a.id, target: d.id, at: d.at, move: mv.id, damage: res.damage, blocked, counter, killed: res.killed });
      return res;
    };
    const strike = (e, mv) => {
      const m = st(e);
      if (m.hitsDone >= mv.hits && !mv.every) return;
      // Spaces with the `boxes` capability (arena2d): authored per-pose hit boxes win, and targets are hit on their hurt boxes.
      const api = spaceOf(rt, e), boxes = Boolean(api?.boxesOf), posed = boxes && e.components.body?.poses?.[mv.anim]?.hit?.length;
      let shapes;
      if (posed) shapes = api.boxesOf(e, 'hit').map(r => ({ kind: 'aabb', at: [r[0], r[1]], size: [r[2] - r[0], r[3] - r[1]] }));
      else {
        const shape = hitShape(rt, e, mv.box ? { box: mv.box } : { reach: mv.reach ?? 1, arc: mv.arc ?? 90 }, scaleOf(mv));
        if (mv.params?.down && !mv.box) shape.dir = [0, -1, 0];
        shapes = [shape];
      }
      const ids = [...new Set(shapes.flatMap(shape => overlapping(rt, e.space, shape, o => o.id !== e.id && Boolean(o.components.health), boxes ? 'hurt' : undefined)))];
      for (const id of ids) {
        const d = rt.entity(id); if (!d || !hurtOk(e, d, mv)) continue;
        const h = (m.hitList[id] ??= { n: 0, last: -99 });
        if (h.n >= mv.hits || (h.n > 0 && (!mv.every || m.mf - h.last < mv.every))) continue;
        h.n++; h.last = m.mf; m.hitsDone = Math.max(m.hitsDone, h.n); m.lastHitMf = m.mf;
        connect(e, d, mv);
        if (st(e).st !== 'attack') return;
      }
    };
    const nearestFoe = (e, range = Infinity) => {
      let best = null, bd = range;
      for (const o of Object.values(rt.state.entities)) if (o.space === e.space && o.id !== e.id && o.components.health && combat(rt)?.canHit(e, o) && hostile(rt, e, o, config.friendlyFire)) { const d = distance(rt, e, o); if (d <= bd) { bd = d; best = o; } }
      return best;
    };
    const tryGrab = (e, mv) => {
      const sc = scaleOf(mv), range = (mv.params.range ?? 40) * sc, d = nearestFoe(e, range);
      if (!d || !grounded(d) || stunned(d) || d.components.melee?.inv === 'all' || d.components.melee?.hidden || invulnFrames(d) > 0) { rt.emit('whiff', { who: e.id, move: mv.id }); return; }
      for (const fn of mhooks().canGrab) if (fn(e, d, mv) === false) { rt.emit('whiff', { who: e.id, move: mv.id }); return; }
      const m = st(e), len = mv.params.cinematic ? 14 + mv.params.cinematic * 8 : 26;
      m.st = 'throw'; m.grab = { target: d.id, move: mv.id, len, t: 0, techable: Boolean(mv.params.techable), hits: 0, back: (m.buffer?.dir ?? 5) % 3 === 1 };
      d.components.health.stun = len + 2; d.components.health.stunKind = 'thrown';
      if (d.components.melee) Object.assign(st(d), { st: 'thrown', move: null, phase: null });
      rt.emit('grabbed', { by: e.id, target: d.id, move: mv.id });
    };
    const runThrow = e => {
      const m = st(e), g = m.grab, d = g && rt.entity(g.target), mv = setOf(e)?.moves[g?.move];
      if (!g || !d || !mv || d.components.health?.dead) { m.st = 'idle'; m.grab = null; return; }
      g.t++;
      if (g.techable && g.t <= TECH_WINDOW && d.components.melee?.buffer?.press === 'throw' && rt.state.frame - d.components.melee.buffer.at <= bufferF) {
        d.components.melee.buffer = null; m.grab = null; m.st = 'idle';
        for (const x of [e, d]) { x.components.health.stun = 16; x.components.health.stunKind = 'block'; if (x.components.melee) x.components.melee.st = 'block'; }
        rt.emit('tech', { who: d.id, by: e.id }); return;
      }
      if (mv.params.cinematic && g.t > 10 && (g.t - 10) % 8 === 0 && g.hits < mv.params.cinematic) {
        g.hits++; combat(rt).hit(d, { amount: Math.round(mv.damage * 0.08), by: e.id, source: 'melee', move: mv.id, unblockable: true, ignoreIframes: true, noIframes: true, nonLethal: true });
        d.components.health.stun = Math.max(d.components.health.stun, g.len - g.t + 2);
      }
      if (g.t >= g.len) {
        const rest = mv.params.cinematic ? Math.round(mv.damage * (1 - 0.08 * mv.params.cinematic)) : mv.damage;
        if (g.back) { setFacing(e, -facingSign(e)); }
        m.grab = null; m.st = 'land'; m.landT = 10;
        if (d.components.health) d.components.health.stun = 0;
        const launch = mv.params.slam ? { vx: 2, vy: 4 } : { vx: 4.2, vy: 6.5 };
        combat(rt).hit(d, { amount: rest, by: e.id, source: 'melee', move: mv.id, kind: mv.kind, unblockable: true, ignoreIframes: true, stun: 30, stunKind: 'knockdown', launch, knockdown: true, kb: mv.kb, units: mv.units, scale: scaleOf(mv), dir: facingOf(e), frame: mv, thrown: true });
        if (d.components.melee && !d.components.health.dead) st(d).st = 'knockdown';
      }
    };
    const teleport = (e, mv) => {
      const d = nearestFoe(e), api = spaceOf(rt, e); if (!api?.setPos || !Array.isArray(e.at)) return;
      const sc = scaleOf(mv), p = v3(e.at);
      let x;
      if (d && mv.params.behind && posOf(d)) { const s = Math.sign(posOf(d)[0] - p[0]) || facingSign(e); x = posOf(d)[0] + s * (40 + (setOf(e).phys?.hw ?? 19)) * sc; }
      else x = p[0] - facingSign(e) * 230 * sc;
      p[0] = x; api.setPos(e, like(e.at, p), rt);
      if (d && posOf(d)) setFacing(e, Math.sign(posOf(d)[0] - p[0]) || facingSign(e));
      rt.emit('teleported', { who: e.id, at: e.at });
    };

    const runMove = e => {
      const m = st(e), set = setOf(e), mv = set.moves[m.move];
      if (!mv) { m.st = 'idle'; m.move = null; return; }
      m.mf++;
      const ph = phaseOf(mv, m.mf), P = mv.params || {}, sc = scaleOf(mv), fwd = facingSign(e), fu = mv.units === 'fighter';
      m.phase = ph === 'done' ? null : ph;
      m.inv = mv.invuln && m.mf >= mv.invuln[0] && m.mf <= mv.invuln[1] ? mv.invuln[2] : null;
      // Cancels: buffered presses during active (+8) once connected; action combos chain from recovery.
      const buf = m.buffer && rt.state.frame - m.buffer.at <= bufferF ? m.buffer : null;
      if (buf && m.mf > mv.startup) {
        const fighterWindow = m.connect && m.connect !== 'parried' && m.mf <= mv.startup + mv.active + 8;
        const actionWindow = mv.kind === 'action' && m.mf > mv.startup + mv.active;
        if ((fighterWindow || actionWindow) && (mv.chain.length || mv.specialCancel || mv.superCancel)) {
          const id = select(e, set, buf, mv), to = id && set.moves[id];
          if (to && canCancel(mv, to) && start(e, id)) { m.buffer = null; return; }
        }
      }
      switch (mv.behavior) {
        case 'strike': if (P.vx && ph === 'active') displace(rt, e, [P.vx * fwd * sc * (fu ? 1 : 1 / 60), 0, 0]); break;
        case 'projectile':
          if (m.mf === mv.startup + 1) {
            const proj = service(rt, 'projectiles');
            if (proj) proj.fire(e, {
              speed: (P.speed ?? 4) * sc * (fu ? 60 : 1), damage: mv.damage, type: mv.type ?? undefined, life: (P.life ?? 120) / 60, radius: Math.max(P.w ?? 20, P.h ?? 20) / 2 * sc, hits: P.hits ?? 1, every: P.every ?? 0,
              single: P.single ? `${e.id}:${P.kind ?? mv.id}` : null, offset: [((set.phys?.hw ?? 19) + 14) * sc, (P.y ?? 0) * sc], gravity: 0, kind: P.kind ?? mv.id,
              hit: { stun: mv.hitstun, blockstun: mv.blockstun, level: P.level ?? mv.level, chip: mv.chip, strength: mv.strength, kind: mv.kind, knockdown: mv.knockdown, launch: mv.launch, move: mv.id, kb: mv.kb, units: mv.units, scale: sc, final: P.final ?? null, frame: mv },
            }, { dir: [fwd, 0, 0] });
          }
          break;
        case 'rise': if (m.mf === mv.startup + 1) setVel(e, [(P.vx ?? 0) * fwd * sc * (fu ? 60 : 1), (P.vy ?? 8) * sc * (fu ? 60 : 1), 0]); break;
        case 'travel':
          if (ph === 'active') {
            const vx = (P.stopOnHit && m.connect ? 1.2 : P.vx ?? 4) * fwd * sc * (fu ? 1 : 1 / 60);
            displace(rt, e, [vx, 0, 0]);
          }
          break;
        case 'grab': if (m.mf === mv.startup + 1) tryGrab(e, mv); break;
        case 'teleport': m.hidden = ph === 'active'; if (m.mf === mv.startup + mv.active) teleport(e, mv); break;
        case 'counter':
          if (ph === 'active' && m.mf === mv.startup + 1) rt.emit('counter_stance', { who: e.id, move: mv.id });
          if (m.counterStrike > 0 && ++m.counterStrike === 4) { const d = rt.entity(m.counterTarget); if (d) connect(e, d, { ...mv, behavior: 'strike' }); }
          break;
        case 'dive':
          if (m.mf === mv.startup && grounded(e)) { setVel(e, [2.4 * fwd * sc * (fu ? 60 : 1), (P.hop ?? 8) * sc * (fu ? 60 : 1), 0]); m.diveAt = m.mf + 11; }
          else if (m.mf === mv.startup) m.diveAt = m.mf + 1;
          if (m.diveAt && m.mf === m.diveAt) { m.diving = true; setVel(e, [(P.vx ?? 4) * fwd * sc * (fu ? 60 : 1), (P.vy ?? -6) * sc * (fu ? 60 : 1), 0]); }
          if (m.diving) { if (grounded(e) && m.mf > m.diveAt + 1) { m.diving = false; m.st = 'land'; m.landT = mv.landRecovery + (m.connect ? 0 : 6); m.move = null; m.phase = null; return; } m.mf = Math.min(m.mf, mv.startup + mv.active - 1); }
          break;
        case 'hop': if (m.mf === 4 && grounded(e)) setVel(e, [(P.vx ?? 2) * fwd * sc * (fu ? 60 : 1), (P.vy ?? 6) * sc * (fu ? 60 : 1), 0]); break;
      }
      if (st(e).st !== 'attack' || st(e).move !== mv.id) return;
      if (ph === 'active' && !['projectile', 'grab', 'counter', 'teleport'].includes(mv.behavior) && (mv.behavior !== 'dive' || m.diving)) strike(e, mv);
      if (st(e).st !== 'attack') return;
      if (ph === 'active' && m.mf === mv.startup + mv.active && !m.connect && mv.behavior === 'strike') rt.emit('whiff', { who: e.id, move: mv.id });
      if (mv.air && m.mf > mv.startup && grounded(e) && !mv.airOk && mv.behavior === 'strike') { m.st = 'land'; m.landT = mv.landRecovery; m.move = null; m.phase = null; return; }
      if (phaseOf(mv, m.mf) === 'done') {
        pose(e, 'idle');
        m.inv = null; m.hidden = false; m.move = null; m.phase = null; m.diving = false;
        if (mv.kind === 'action' && /^w\d+$/.test(mv.id)) m.comboUntil = rt.state.frame + comboF; else m.comboIdx = 0;
        if (!grounded(e) && mv.landRecovery) { m.st = 'fall'; m.landT = mv.landRecovery; } else m.st = 'idle';
      }
    };

    const api = {
      setFor: setOf,
      moves: e => setOf(e)?.moves ?? {},
      specials: e => setOf(e)?.specials ?? [],
      physique: e => setOf(e)?.phys ?? null,
      phaseOf, advantage,
      start: (e, id, o) => start(e, id, o),
      press: (e, kind, value, dir = 5) => { press(e, kind, value); st(e).buffer.dir = dir; },
      busy: e => { const m = e?.components.melee; return Boolean(m && (m.st && m.st !== 'idle')) || stunned(e); },
      grounded,
      hooks: mhooks,
      connect,
      scaleOf,
    };
    rt.provide('melee', api);

    // Counter stances absorb melee strikes; parries and blocks absorb melee, projectile and contact hits.
    intercept(rt, 15, (d, hit) => {
      const dm = d.components.melee; if (!dm || dm.st !== 'attack' || hit.source !== 'melee') return hit;
      const dmv = setOf(d)?.moves[dm.move];
      if (dmv?.behavior !== 'counter' || phaseOf(dmv, dm.mf) !== 'active' || dm.counterStrike) return hit;
      const a = rt.entity(hit.by); if (!a) return hit;
      dm.counterStrike = 1; dm.counterTarget = a.id; dm.mf = dmv.startup + dmv.active; dm.inv = 'all';
      a.components.health && (a.components.health.stun = 26, a.components.health.stunKind = 'hit');
      if (a.components.melee) Object.assign(st(a), { st: 'hit', move: null, phase: null });
      dm.hitstop = 14;
      rt.emit('parried', { who: d.id, by: a.id, counter: true });
      return { cancel: true, reason: 'countered', parried: true };
    }, KEY);
    intercept(rt, 20, (d, hit) => {
      const dm = d.components.melee;
      if (!dm || d.components.versus || hit.unblockable || !['melee', 'projectile', 'contact'].includes(hit.source)) return hit;
      if (dm.st === 'attack' || dm.st === 'throw' || dm.st === 'thrown' || (stunned(d) && d.components.health.stunKind !== 'block')) return hit;
      const a = hit.by ? rt.entity(hit.by) : null, pa = posOf(a), pd = posOf(d);
      const toward = pa && pd ? norm(sub(pa, pd)) : hit.dir ? norm(v3(hit.dir)).map(v => -v) : facingOf(d);
      const facingOk = dot(facingOf(d), toward) >= Math.cos(config.block.arc / 2 * Math.PI / 180) - 1e-9;
      if (!facingOk) return hit;
      if (parryF > 0 && dm.blockAt != null && rt.state.frame - dm.blockAt <= parryF && hit.source !== 'contact') {
        dm.blockAt = null;
        if (a?.components.health) { a.components.health.stun = staggerF; a.components.health.stunKind = 'stagger'; }
        if (a?.components.melee) Object.assign(st(a), { st: 'stagger', move: null, phase: null });
        rt.emit('parried', { who: d.id, by: a?.id ?? null });
        rt.emit('staggered', { who: a?.id ?? null, by: d.id, reason: 'parry' });
        return { cancel: true, reason: 'parried', parried: true };
      }
      if (!held(rt, d, 'block')) return hit;
      const res = service(rt, 'resources'), cost = hit.amount * config.block.staminaPerDmg;
      if (cost > 0 && res?.has(d, config.blockTag) && !res.spend(d, config.blockTag, cost, { partial: false })) {
        res.spend(d, config.blockTag, cost, { force: true });
        rt.emit('guard_broken', { who: d.id, by: hit.by ?? null });
        rt.emit('staggered', { who: d.id, by: hit.by ?? null, reason: 'guard_break' });
        return { ...hit, amount: hit.amount * (1 - config.block.reduction), stun: staggerF, stunKind: 'stagger', guardBreak: true };
      }
      rt.emit('blocked', { who: d.id, by: hit.by ?? null, amount: hit.amount * config.block.reduction, move: hit.move ?? null });
      return { ...hit, amount: hit.amount * (1 - config.block.reduction), blocked: true, stun: hit.blockstun ?? msFrames(200), stunKind: 'block', knockback: (hit.knockback ?? 0) * 0.5, status: null };
    }, KEY);
    // Poise: hits with poise left do not flinch; breaking it staggers.
    if (config.poise) intercept(rt, 30, (d, hit) => {
      if (hit.blocked || !['melee', 'projectile'].includes(hit.source)) return hit;
      const amount = hit.poise ?? hit.amount, res = service(rt, 'resources');
      let broken;
      if (res?.has(d, 'poise')) { res.spend(d, 'poise', amount, { force: true }); broken = res.get(d, 'poise') <= 0; if (broken) res.refill(d, 'poise'); }
      else if (d.components.poise && typeof d.components.poise === 'object') {
        const p = d.components.poise; p.value ??= p.max ?? 0; p.value -= amount; p.lastHit = rt.state.frame; broken = p.value <= 0; if (broken) p.value = p.max ?? 0;
      } else return hit;
      if (!broken) return { ...hit, stun: 0, knockback: 0, poised: true };
      rt.emit('staggered', { who: d.id, by: hit.by ?? null, reason: 'poise' });
      if (service(rt, 'status')?.defs().some(s => s.id === 'poise_broken')) rt.service('status').apply(d, 'poise_broken', { by: hit.by });
      return { ...hit, stun: Math.max(hit.stun ?? 0, staggerF), stunKind: 'stagger' };
    }, KEY);
    // Riposte: staggered targets take more melee damage.
    hooks(rt).dmgMult.push((d, hit) => {
      const h = d.components.health;
      if (hit.source === 'melee' && h?.stunKind === 'stagger' && h.stun > 0) { rt.emit('riposte', { who: d.id, by: hit.by ?? null }); return config.parry.riposte; }
      return 1;
    });

    rt.system('interaction', rt => {
      for (const e of Object.values(rt.state.entities)) {
        if (!e.components.melee) continue;
        const m = st(e), set = setOf(e); if (!set) continue;
        npcPresses(e); motionPress(e);
        if (m.intent) { if (m.intent.press) { press(e, m.intent.press, m.intent.value ?? m.intent.move ?? m.intent.motion ?? true); m.buffer.dir = m.intent.dir ?? 5; if (m.intent.press === 'block') m.blockAt = rt.state.frame; } m.intent.press = null; }
        if (e.components.poise?.lastHit != null && rt.state.frame - e.components.poise.lastHit > frames(config.poiseResetSec)) { e.components.poise.value = e.components.poise.max; e.components.poise.lastHit = null; }
        if (e.components.health?.dead) { Object.assign(m, { st: 'idle', move: null, phase: null, buffer: null, grab: null }); continue; }
        if (m.hitstop > 0) { m.hitstop--; if (m.buffer) m.buffer.at++; continue; } // presses survive the freeze
        if (m.st === 'throw') { runThrow(e); continue; }
        if (stunned(e)) { if (m.st === 'attack') { m.move = null; m.phase = null; pose(e, e.components.health.stunKind || 'hit'); } if (m.st !== 'thrown' || e.components.health.stunKind !== 'thrown') m.st = e.components.health.stunKind || 'hit'; m.inv = null; m.hidden = false; continue; }
        if (m.st !== 'attack' && m.st !== 'land' && m.st !== 'fall' && m.st !== 'idle') { m.st = 'idle'; m.combo = 0; m.comboDmg = 0; }
        if (m.st === 'idle' && m.combo) { m.combo = 0; m.comboDmg = 0; }
        if (m.st === 'attack') { runMove(e); continue; }
        if (m.st === 'fall') { if (grounded(e)) { m.st = 'land'; } continue; }
        if (m.st === 'land') { if (--m.landT <= 0) m.st = 'idle'; else continue; }
        if (grounded(e)) m.airUsed = false;
        if (rt.state.frame > (m.comboUntil ?? -1) && m.comboIdx) m.comboIdx = 0;
        const buf = m.buffer && rt.state.frame - m.buffer.at <= bufferF ? m.buffer : null;
        if (!buf || buf.press === 'block') continue;
        const id = select(e, set, buf, null);
        if (id && start(e, id)) m.buffer = null;
      }
    }, KEY);
  },
};
export { HEIGHT };
