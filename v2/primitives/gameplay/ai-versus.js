// gameplay.ai.versus: the fighting-game CPU, ported from v2/kits/fighting/ai.js.
// It plays through the same input path as a person: each frame it writes
// components.input = {axes:{move:[x,y]}, held, actions} on its fighter (read by
// engine.input.actions / engine.input.motions next frame, KERNEL_API §2 and the
// ws-runtime contract), so every special is a motion macro of directions and
// presses, every block is held back, and the CPU can only do what a player can.
// Difficulty levels 1-5 set reaction time and the odds of blocking, reading
// high/low, anti-airing, punishing, finishing combos, teching throws and
// making mistakes; style sets the preferred range. All rolls use rt.random().
//
// Fighter state is read from the combat contract: components.melee {st, move,
// mf, phase, stun, combo}, components.versus {meter, juggle, air, guard},
// components.body.facing, and rt.service('melee').moves(entity) for frame data.
import { round6, dead, spaceOf, continuous } from './ai-lib.js';

const ID = 'gameplay.ai.versus';
/** Kit difficulty table (index = level). */
export const LEVELS = [
  null,
  { react: 26, block: 0.16, read: 0.35, anti: 0.1, punish: 0.1, combo: 0.22, proj: 0.25, aggro: 0.3, tech: 0.05, wait: [16, 34], jumpIn: 0.1, mistake: 0.18, superUse: 0.15 },
  { react: 19, block: 0.36, read: 0.5, anti: 0.28, punish: 0.3, combo: 0.45, proj: 0.45, aggro: 0.42, tech: 0.15, wait: [11, 26], jumpIn: 0.14, mistake: 0.08, superUse: 0.4 },
  { react: 14, block: 0.56, read: 0.65, anti: 0.5, punish: 0.55, combo: 0.65, proj: 0.6, aggro: 0.52, tech: 0.3, wait: [8, 18], jumpIn: 0.17, mistake: 0.04, superUse: 0.6 },
  { react: 10, block: 0.72, read: 0.8, anti: 0.7, punish: 0.75, combo: 0.82, proj: 0.75, aggro: 0.58, tech: 0.45, wait: [6, 14], jumpIn: 0.2, mistake: 0.02, superUse: 0.8 },
  { react: 7, block: 0.85, read: 0.9, anti: 0.85, punish: 0.9, combo: 0.95, proj: 0.88, aggro: 0.64, tech: 0.6, wait: [4, 10], jumpIn: 0.22, mistake: 0, superUse: 0.95 },
];
/** Preferred distance by style, in kit units (a fighter is 100 tall). */
export const PREF = { zoner: 250, balanced: 150, rushdown: 95, grappler: 72 };
const CANCELLABLE = ['uppercut', 'fireball', 'spin_kick', 'flurry', 'slide', 'ground_wave'];
const MOVERS = ['charge_dash', 'slide', 'spin_kick', 'axe_kick', 'air_dive'];
const STUCK = ['hit', 'launch', 'knockdown', 'wakeup', 'ko', 'dazed', 'throw', 'land', 'climb', 'respawn', 'stagger'];
const FREE = new Set(['idle', 'walk', 'crouch', 'guard']);
const CHARGE = 40;
const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

// ---------- canonical motion macros (kit input.js motionFrames) ----------
// Frames of [relX, y, a, b]: relX +1 = toward where the fighter faces; y -1 up, +1 down (kit convention).
export const MOTION_NAMES = ['qcf', 'qcb', 'dp', 'rdp', 'hcf', 'hcb', 'qcf2', 'charge-bf', 'charge-du', 'tap-dd', 'tap-bf'];
const hold = (n, x, y) => Array.from({ length: n }, () => [x, y, 0, 0]);
const press = (x, y, btn) => [x, y, btn === 'a' ? 1 : 0, btn === 'b' ? 1 : 0];
export function motionFrames(motion, button) {
  const A = button === 'a' ? 1 : 0, B = button === 'b' ? 1 : 0, p = (x, y) => [x, y, A, B];
  switch (motion) {
    case 'qcf': return [[0, 1, 0, 0], [1, 1, 0, 0], p(1, 0)];
    case 'qcb': return [[0, 1, 0, 0], [-1, 1, 0, 0], p(-1, 0)];
    case 'dp': return [[1, 0, 0, 0], [0, 1, 0, 0], p(1, 1)];
    case 'rdp': return [[-1, 0, 0, 0], [0, 1, 0, 0], p(-1, 1)];
    case 'hcf': return [[-1, 0, 0, 0], [-1, 1, 0, 0], [0, 1, 0, 0], [1, 1, 0, 0], p(1, 0)];
    case 'hcb': return [[1, 0, 0, 0], [1, 1, 0, 0], [0, 1, 0, 0], [-1, 1, 0, 0], p(-1, 0)];
    case 'qcf2': return [[0, 1, 0, 0], [1, 1, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [1, 1, 0, 0], p(1, 0)];
    case 'charge-bf': return [...hold(CHARGE + 4, -1, 1), p(1, 0)];
    case 'charge-du': return [...hold(CHARGE + 4, 0, 1), p(0, -1)];
    case 'tap-dd': return [[0, 1, 0, 0], [0, 0, 0, 0], p(0, 1)];
    case 'tap-bf': return [[-1, 0, 0, 0], [0, 0, 0, 0], p(1, 0)];
    default: return [p(0, 0)];
  }
}

/**
 * Canonical frames for a motion: engine.input.motions' frames() when that primitive is installed
 * (so document-defined motions and leniency are honored), else the kit table above.
 */
export function macroFrames(rt, config, motion, btn) {
  const verb = btn === 'a' ? config.buttons.a : config.buttons.b;
  const fr = rt.hasService('motions') ? rt.service('motions').frames(motion, verb, 1) : null;
  if (!fr) return motionFrames(motion, btn);
  return fr.map(f => { const ax = f.axes.move ?? Object.values(f.axes)[0] ?? [0, 0]; return [ax[0], -ax[1], f.held[config.buttons.a] ? 1 : 0, f.held[config.buttons.b] ? 1 : 0]; });
}

const CPU = {
  level: { type: 'integer', min: 1, max: 5 }, style: { type: 'string', options: Object.keys(PREF) },
  opponent: { type: 'string' },
  specials: { type: 'list' }, super: { type: 'object' }, throwRange: { type: 'number', min: 0 }, platform: { type: 'boolean' },
};
const st = rt => rt.store(ID);

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['cpu_intent'] },
    // It plays every fighter with a `cpu` component through the real input path: moves and the button verbs (defaults).
    drives: { control: 'ai', components: ['cpu'], actions: ['attack', 'heavy', 'block', 'throw'], movement: true, events: ['cpu_intent'] },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "archetypes", "component": "cpu", "min": 1, "placed": 1, "why": "the CPU opponent is an archetype with a cpu component {level, style}", "example": {"id": "rival", "kind": "npc", "components": {"cpu": {"level": 3}}}},
    ],
    intent: 'Fighting-game CPU for entities with a `cpu` component: five difficulty levels (reaction, block, high/low read, anti-air, punish, combo confirm, throw tech, mistakes), styles with preferred range, special/super motion macros, jump-ins, juggles, platform recovery — all played through the real input path (components.input), never by setting fighter state.',
    views: ['side'],
    params: {
      buttons: { type: 'object', default: { a: 'attack', b: 'heavy' }, fields: { a: { type: 'string', default: 'attack' }, b: { type: 'string', default: 'heavy' } }, effect: 'verbs for the two attack buttons of the motion notation' },
      blockVerb: { type: 'string', default: 'block', effect: "held verb while blocking (besides holding back); '' to block by direction only" },
      throwVerb: { type: 'string', default: 'throw', effect: "throw/tech verb ('' = press both attack buttons, the kit default)" },
      level: { type: 'integer', default: 3, min: 1, max: 5, effect: 'default difficulty' },
      levelVar: { type: 'string', effect: 'var overriding the difficulty (difficulty menus)' },
      unit: { type: 'number', min: 0, effect: 'space units per kit unit; default = fighter height / 100' },
      fightWhen: { type: 'predicate', effect: 'the CPU acts only while this holds (round live)' },
      stage: { type: 'object', fields: { x0: { type: 'number', required: true }, x1: { type: 'number', required: true } }, effect: 'platform mode: main stage edges for recovery and edge safety' },
    },
    provides: { events: ['cpu_intent'] },
    requires: { capabilities: ['position', 'distance'] },
    reads: ['content.archetypes'],
  },
  validate(config, doc) {
    const errors = [];
    (doc.content?.archetypes || []).forEach((a, i) => {
      const c = a.components?.cpu; if (c === undefined) return;
      const path = `content.archetypes[${i}].components.cpu`;
      if (!c || typeof c !== 'object') { errors.push({ code: 'param_type', path, message: 'cpu must be an object' }); return; }
      for (const k of Object.keys(c)) if (!(k in CPU)) errors.push({ code: 'param_unknown', path: `${path}.${k}`, message: `unknown cpu field '${k}'`, hint: Object.keys(CPU).join(', ') });
      if (c.level !== undefined && !(Number.isInteger(c.level) && c.level >= 1 && c.level <= 5)) errors.push({ code: 'param_range', path: `${path}.level`, message: 'level is 1-5' });
      if (c.style !== undefined && !PREF[c.style]) errors.push({ code: 'param_option', path: `${path}.style`, message: `style is one of ${Object.keys(PREF).join('|')}` });
      (c.specials || []).forEach((s, j) => { if (!s?.motion || !s?.archetype) errors.push({ code: 'cpu_special', path: `${path}.specials[${j}]`, message: 'a special needs {archetype, motion}' }); else if (!MOTION_NAMES.includes(s.motion)) errors.push({ code: 'cpu_motion_unknown', path: `${path}.specials[${j}].motion`, message: `unknown motion '${s.motion}'`, hint: MOTION_NAMES.join(' ') }); });
    });
    return errors;
  },
  install(rt, config) {
    rt.system('ai', rt => {
      if (config.fightWhen && !rt.test(config.fightWhen)) { for (const e of rt.query('cpu')) neutral(e); return; }
      for (const e of rt.query('cpu')) {
        if (e.id === 'player' || dead(e)) continue;
        const opp = opponentOf(rt, e); if (!opp) { neutral(e); continue; }
        const brain = ((st(rt).agents ??= {})[e.id] ??= newBrain());
        const frame = think(rt, config, e, opp, brain);
        write(rt, config, e, brain, frame);
      }
    }, ID);
  },
};

export const newBrain = () => ({ macro: [], plan: null, key: null, seenAt: 0, choice: null, low: false, intent: 'approach', wait: 0, recKey: null, recSeen: -1, punishGo: false, techKey: null, techGo: false, techAt: 0, jugKey: null, pick: null, hopFlip: false, jumpFlip: false, prev: [0, 0, 0, 0], charge: { b: 0, d: 0, bm: 0, dm: 0 } });

function opponentOf(rt, e) {
  const id = e.components.cpu.opponent;
  if (id) return rt.entity(id) && !dead(rt.entity(id)) ? rt.entity(id) : null;
  const cands = [rt.player(), ...rt.query('cpu')].filter(o => o && o !== e && o.space === e.space && !dead(o) && (o.components.melee || o.components.health));
  return cands.sort((a, b) => Math.abs(a.at[0] - e.at[0]) - Math.abs(b.at[0] - e.at[0]) || (a.id < b.id ? -1 : 1))[0] || null;
}
function neutral(e) { e.components.input = { axes: { move: [0, 0] }, held: {}, actions: {} }; }

// ---------- fighter view (combat contract) ----------
function view(rt, e) {
  const m = e.components.melee || {}, v = e.components.versus || {}, b = e.components.body || {};
  const facing = Array.isArray(b.facing) ? sign(b.facing[0]) || 1 : sign(b.facing ?? 1) || 1;
  const moves = rt.hasService('melee') ? rt.service('melee').moves(e) || {} : {};
  const air = Boolean(v.air ?? (b.grounded === false));
  return { e, x: e.at[0], y: e.at[1], st: m.st ?? 'idle', move: m.move ? moves[m.move] ?? null : null, moveId: m.move ?? null, mf: m.mf ?? 0, phase: m.phase ?? null, stun: m.stun ?? 0,
    facing, air, vel: b.vel || [0, 0, 0], meter: v.meter ?? 0, juggle: v.juggle ?? 0, moves };
}
function specialsOf(rt, e, me) {
  const c = e.components.cpu;
  if (Array.isArray(c.specials)) return c.specials;
  return Object.entries(me.moves).filter(([, m]) => m.motion && m.archetype && m.kind !== 'super').map(([id, m]) => ({ id, archetype: m.archetype, motion: m.motion, air: Boolean(m.air) }));
}
const superOf = (e, me) => e.components.cpu.super ?? (Object.values(me.moves).find(m => m.kind === 'super') ? { motion: Object.values(me.moves).find(m => m.kind === 'super').motion ?? 'qcf2', button: 'b', cost: Object.values(me.moves).find(m => m.kind === 'super').cost ?? 100 } : null);
function reachOf(m, U) {
  if (!m) return 0;
  if (['travel', 'dive', 'hop'].includes(m.behavior)) return 260 * U;
  if (m.behavior === 'grab') return (m.params?.range ?? 60) * U;
  if (Number.isFinite(m.reach)) return m.reach + 20 * U;
  return m.box ? (m.box.x + m.box.w) * U + 20 * U : 70 * U;
}

// ---------- the decision (kit cpuInput) ----------
function think(rt, config, e, opp, br) {
  const R = () => rt.random();
  const level = Math.max(1, Math.min(5, (config.levelVar && rt.state.vars[config.levelVar]) || e.components.cpu.level || config.level));
  const L = LEVELS[level];
  const me = view(rt, e), op = view(rt, opp);
  const U = config.unit ?? ((e.components.body?.size?.[1] ?? 1) / 100);
  const out = (rx, y, a = 0, b = 0) => [rx, y, a ? 1 : 0, b ? 1 : 0];
  const NEUTRAL = [0, 0, 0, 0];
  const specials = specialsOf(rt, e, me), sup = superOf(e, me);
  const has = arch => specials.find(s => s.archetype === arch && !(s.air && !me.air && specials.some(o => !o.air && o.motion === s.motion)));
  const M = (motion, btn) => macroFrames(rt, config, motion, btn);
  const macroOf = (sp, btn) => {
    if (sp.raw) return M(sp.motion, btn);
    if (sp.motion === 'charge-bf' && (br.charge.b >= CHARGE || br.charge.bm > 0)) return [press(1, 0, btn)];
    if (sp.motion === 'charge-du' && (br.charge.d >= CHARGE || br.charge.dm > 0)) return [press(0, -1, btn)];
    return M(sp.motion, btn);
  };
  const queue = list => { br.macro = list.slice(); return br.macro.length ? next(br, me, op, L, R) : NEUTRAL; };
  br.blocking = false;
  const blockOut = low => { br.blocking = true; return out(-1, low ? 1 : 0); };
  const canSuper = sup && me.meter >= (sup.cost ?? 100);
  const projOut = shotsBy(rt, e).length > 0;

  // Macros run first: honest frame-by-frame inputs with hit-confirm checkpoints.
  if (br.macro.length) { const f = next(br, me, op, L, R); if (f) return f; }

  const dx = op.x - me.x, dist = Math.abs(dx) / U;
  const om = op.st === 'attack' ? op.move : null;

  if (config.stage && e.components.cpu.platform !== false) { const r = recover(config, me, br, has, queue, macroOf, out, U); if (r) return r; }

  // Stuck states: hold block for when control returns; tech throws.
  if (me.st === 'thrown') {
    const key = rt.state.frame - op.mf;
    if (br.techKey !== key) { br.techKey = key; br.techGo = R() < L.tech; br.techAt = 2 + Math.floor(R() * 6); br.techT = 0; }
    br.techT++;
    return br.techGo && br.techT === br.techAt ? ['tech'] : NEUTRAL;
  }
  if (STUCK.includes(me.st) || me.stun > 0) {
    if (br.plan === 'jumpin') br.plan = null;
    if (me.st === 'ledge') return out(1, 0);
    return br.choice === 'block' ? blockOut(br.low) : (R() < L.block * 0.5 ? blockOut(true) : NEUTRAL);
  }
  if (me.st === 'ledge') return me.mf > 6 + level * 2 ? out(1, 0) : NEUTRAL;

  // Jump-in plan: kick on the way down, then confirm into a combo on landing.
  if (br.plan === 'jumpin') {
    if (me.air) return (me.vel[1] ?? 0) < 1 && dist < 78 && !br.airUsed ? (br.airUsed = true, out(0, 0, 0, 1)) : out(0, 0);
    br.plan = null; br.airUsed = false;
    if ((op.st === 'hit' || op.st === 'block') && me.st !== 'attack') return queue(comboRoute(br, has, canSuper ? sup : null, 'heavy', macroOf));
  }
  if (me.st === 'attack' || me.st === 'prejump' || me.air) return NEUTRAL;

  // ---- threats: attacks, projectiles, jump-ins ----
  const proj = shotsBy(rt, opp).filter(p => sign(p.vel[0]) === sign(me.x - p.at[0])).sort((p, q) => Math.abs(p.at[0] - me.x) - Math.abs(q.at[0] - me.x))[0];
  let key = null, kind = null;
  if (om && op.phase !== 'recovery' && (om.damage ?? 1) > 0 && Math.abs(dx) < reachOf(om, U) + 40 * U) { key = `m${rt.state.frame - op.mf}`; kind = 'attack'; }
  else if (proj && Math.abs(proj.at[0] - me.x) < 280 * U) { key = `p${proj.id}`; kind = 'proj'; }
  else if (op.air && (op.st === 'air' || op.st === 'attack' || op.st === 'idle') && dist < 190 && sign(op.vel[0]) !== -sign(dx)) { key = `j${br.jumpSeen ?? (br.jumpSeen = rt.state.frame)}`; kind = 'jump'; }
  if (!op.air) br.jumpSeen = null;
  if (key !== br.key) { br.key = key; br.seenAt = rt.state.frame; br.choice = null; }
  if (key && rt.state.frame - br.seenAt >= L.react) {
    if (br.choice == null) {
      const r = R();
      if (kind === 'attack') {
        br.choice = r < L.block ? 'block' : 'none';
        const correct = R() < L.read, lowMove = om.level === 'low', over = om.level === 'overhead';
        br.low = correct ? (lowMove || (!over && R() < 0.6)) : R() < 0.5;
        if (over && correct) br.low = false;
      } else if (kind === 'proj') {
        if (r < L.proj) br.choice = has('fireball') && !projOut && R() < 0.3 ? 'counterfire' : dist > 150 && R() < 0.45 ? 'jump' : 'block';
        else br.choice = 'none';
        br.low = proj.level === 'low' || (proj.level === 'mid' && R() < 0.5);
      } else { br.choice = r < L.anti ? 'anti' : r < L.anti + L.block * 0.5 ? 'block' : 'none'; br.low = false; }
      rt.emit('cpu_intent', { who: e.id, threat: kind, choice: br.choice, low: br.low });
    }
    switch (br.choice) {
      case 'block': return blockOut(br.low);
      case 'jump': br.choice = 'none'; br.plan = 'jumpin'; return queue([[1, -1, 0, 0], [1, -1, 0, 0]]);
      case 'counterfire': br.choice = 'none'; return queue(macroOf(has('fireball'), 'a'));
      case 'anti': {
        const up = has('uppercut');
        if (up && dist < 150 && (op.y - me.y) / U < 150) { br.choice = 'none'; return queue(macroOf(up, 'b')); }
        if (!up && dist < 105 && (op.y - me.y) / U < 110) { br.choice = 'none'; return queue([press(0, 0, 'b')]); }
        return blockOut(false);
      }
    }
  }
  if (me.st === 'block') return blockOut(br.low);

  // ---- punish recovery and landing ----
  const recovering = (om && op.phase === 'recovery' && (om.total ?? 0) - op.mf >= 7) || (op.st === 'land' && op.stun >= 6) || op.st === 'fall';
  if (recovering) {
    const pk = `r${rt.state.frame - op.mf}`;
    if (br.recKey !== pk) { br.recKey = pk; br.recSeen = rt.state.frame; br.punishGo = R() < L.punish; }
    if (br.punishGo && rt.state.frame - br.recSeen >= Math.round(L.react * 0.5) && dist < 120 && !op.air) {
      br.punishGo = false;
      rt.emit('cpu_intent', { who: e.id, intent: 'punish' });
      if (canSuper && R() < L.superUse) return queue(M(sup.motion ?? 'qcf2', sup.button ?? 'b'));
      return queue(comboRoute(br, has, canSuper ? sup : null, dist < 70 ? 'light' : 'heavy', macroOf));
    }
  }
  // Juggle a launched opponent.
  if (op.st === 'launch' && op.juggle < 3 && dist < 110 && (op.vel[1] ?? 0) < 0 && !config.stage) {
    const up = has('uppercut'), jk = `l${rt.state.frame - op.mf}`;
    if (up && br.jugKey !== jk) { br.jugKey = jk; if (R() < L.combo * 0.6) return queue(macroOf(up, 'a')); }
  }
  if (op.st === 'knockdown' || op.st === 'wakeup') return dist > 80 ? out(1, 0) : out(-1, 1);

  // ---- platform pursuit ----
  if (config.stage && !op.air && FREE.has(me.st)) {
    const dy = (op.y - me.y) / U;
    if (dy > 40 && dist < 150) { br.hopFlip = !br.hopFlip; return br.hopFlip ? out(sign(dx) * me.facing, -1) : out(0, 0); }
    if (dy < -40 && e.components.body?.surface === 'soft' && dist < 220) return out(0, 1);
  }
  // ---- neutral game ----
  if (--br.wait <= 0) {
    br.wait = L.wait[0] + Math.floor(R() * (L.wait[1] - L.wait[0]));
    br.intent = chooseIntent(e, me, L, R, dist, has, projOut, br, canSuper ? sup : null, specials);
    rt.emit('cpu_intent', { who: e.id, intent: br.intent });
  }
  const pref = PREF[e.components.cpu.style] || 150;
  const chargeY = specials.some(s => s.motion === 'charge-bf' || s.motion === 'charge-du') ? 1 : 0;
  const edgeOk = rx => !config.stage || edgeSafe(config, me, rx, U);
  const throwRange = (e.components.cpu.throwRange ?? 70 * U) / U;
  switch (br.intent) {
    case 'approach': return dist > pref - 20 && edgeOk(1) ? out(1, chargeY) : (br.intent = 'wait', out(0, 0));
    case 'retreat': return dist < pref + 20 && edgeOk(-1) ? out(-1, chargeY) : (br.intent = 'wait', out(-1, chargeY));
    case 'dash': br.intent = 'approach'; return queue([[1, 0, 0, 0], [0, 0, 0, 0], [1, 0, 0, 0]]);
    case 'charge': return out(-1, 1);
    case 'jumpin': br.intent = 'wait'; br.plan = 'jumpin'; return queue([[1, -1, 0, 0], [1, -1, 0, 0]]);
    case 'hop': br.intent = 'wait'; return queue([[0, -1, 0, 0], [0, -1, 0, 0]]);
    case 'fireball': { br.intent = 'wait'; const sp = has('fireball') || has('ground_wave'); return sp && !projOut ? queue(macroOf(sp, R() < 0.5 ? 'a' : 'b')) : NEUTRAL; }
    case 'special': { br.intent = 'wait'; const sp = br.pick && specials.find(s => s.archetype === br.pick); return sp ? queue(macroOf(sp, R() < 0.5 ? 'a' : 'b')) : NEUTRAL; }
    case 'super': br.intent = 'wait'; return sup ? queue(M(sup.motion ?? 'qcf2', sup.button ?? 'b')) : NEUTRAL;
    case 'throw': br.intent = 'wait'; return dist < throwRange ? queue([['throw'], [0, 0, 0, 0]]) : out(1, 0);
    case 'grab': { br.intent = 'wait'; const g = has('command_grab'); return g ? queue(macroOf(g, dist < 70 ? 'a' : 'b')) : NEUTRAL; }
    case 'poke': br.intent = 'wait'; return queue(R() < 0.5 ? [press(0, 1, 'b'), ...hold(4, 0, 1)] : [press(0, 0, 'b')]);
    case 'combo': br.intent = 'wait'; return queue(comboRoute(br, has, canSuper ? sup : null, R() < 0.5 ? 'light' : 'heavy', macroOf));
    case 'mash': br.intent = 'wait'; return queue([press(0, R() < 0.5 ? 1 : 0, R() < 0.5 ? 'a' : 'b')]);
    case 'counter': { br.intent = 'wait'; const c = has('counter'); return c ? queue(macroOf(c, 'b')) : NEUTRAL; }
    default: return chargeY ? out(-1, 1) : NEUTRAL;
  }
}

/** Next macro frame, resolving hit-confirm checkpoints: continue only on a hit, with the level's combo odds. */
function next(br, me, op, L, R) {
  while (br.macro.length && br.macro[0] === 'confirm') {
    br.macro.shift();
    const hit = op.st === 'hit' || op.st === 'launch';
    if (!(hit && R() < L.combo)) { br.macro = []; break; }
  }
  return br.macro.length ? br.macro.shift() : null;
}

function chooseIntent(e, me, L, R, dist, has, projOut, br, sup, specials) {
  const style = e.components.cpu.style, pref = PREF[style] || 150, r = R();
  if (R() < L.mistake) return dist < 120 ? 'mash' : 'hop';
  if (sup && R() < L.superUse * 0.25 && dist < 150) return 'super';
  const charged = br.charge.b >= CHARGE || br.charge.d >= CHARGE;
  const chargeMove = specials.find(s => s.motion === 'charge-bf' || s.motion === 'charge-du');
  if (chargeMove && charged && dist < (chargeMove.archetype === 'axe_kick' ? 120 : 200) && r < L.aggro) { br.pick = chargeMove.archetype; return 'special'; }
  if (dist <= 75) {
    if (has('command_grab') && R() < (style === 'grappler' ? 0.45 : 0.2) * L.aggro * 2) return 'grab';
    if (R() < (style === 'grappler' ? 0.3 : 0.12)) return 'throw';
    if (has('counter') && R() < 0.12) return 'counter';
    return r < L.aggro ? 'combo' : r < L.aggro + 0.2 ? 'poke' : style === 'zoner' ? 'retreat' : 'wait';
  }
  if (dist < 110) return r < L.aggro * 0.7 ? 'poke' : r < L.aggro ? 'approach' : (chargeMove && !charged ? 'charge' : 'wait');
  if ((has('fireball') || has('ground_wave')) && !projOut && dist > 170 && R() < (style === 'zoner' ? 0.6 : 0.3)) return 'fireball';
  if (dist > 120 && dist < 230 && R() < L.jumpIn) return 'jumpin';
  const mover = specials.find(s => MOVERS.includes(s.archetype) && !s.motion.startsWith('charge'));
  if (mover && dist < 200 && R() < L.aggro * 0.25) { br.pick = mover.archetype; return 'special'; }
  if (has('teleport') && dist > 220 && R() < 0.08) { br.pick = 'teleport'; return 'special'; }
  if (chargeMove && !charged && R() < 0.5) return 'charge';
  if (dist > pref + 40) return style === 'rushdown' && R() < 0.35 ? 'dash' : 'approach';
  if (dist < pref - 40) return 'retreat';
  return R() < 0.4 ? 'approach' : 'wait';
}

/** Hit-confirmed combo macro: light chain into a cancel, or heavy into a special (or super with meter). */
function comboRoute(br, has, sup, kind, macroOf) {
  const sp = CANCELLABLE.map(a => has(a)).find(Boolean);
  const finish = sup ? macroOf({ motion: sup.motion ?? 'qcf2', raw: true }, sup.button ?? 'b') : sp ? macroOf(sp, 'b') : [];
  if (kind === 'light') return [press(0, 1, 'a'), ...hold(5, 0, 1), 'confirm', press(0, 1, 'a'), ...hold(5, 0, 1), 'confirm', press(0, 1, 'b'), ...hold(4, 0, 1)];
  return [press(0, 0, 'a'), ...hold(5, 0, 0), 'confirm', press(0, 0, 'b'), ...hold(14, 0, 0), 'confirm', ...finish];
}

/** Shots fired by e (combat projectiles or ai shots), as read-only views. */
function shotsBy(rt, e) {
  const out = [];
  for (const o of Object.values(rt.state.entities)) { const s = o.components.projectile ?? o.components.aiShot; if (o.space === e.space && Array.isArray(s?.vel) && s.by === e.id) out.push({ id: o.id, at: o.at, vel: s.vel, level: s.level ?? null }); }
  return out;
}

// ---------- platform mode ----------
function edgeSafe(config, me, rx, U) {
  const dir = rx * me.facing, { x0, x1 } = config.stage;
  if (me.e.components.body?.surface === 'soft') return true;
  return !(dir < 0 && me.x < x0 + 34 * U) && !(dir > 0 && me.x > x1 - 34 * U);
}
function recover(config, me, br, has, queue, macroOf, out, U) {
  if (!me.air || !['air', 'fall', 'attack', 'idle'].includes(me.st)) return null;
  const { x0, x1 } = config.stage, center = (x0 + x1) / 2, off = me.x < x0 + 4 * U || me.x > x1 - 4 * U;
  if (!off) return null;
  const toward = sign(center - me.x) * me.facing;
  if (me.st === 'attack') return out(toward, 0);
  const jumps = me.e.components.versus?.jumps ?? 0, vy = me.vel[1] ?? 0;
  if (jumps > 0 && vy < 0.5) { br.jumpFlip = !br.jumpFlip; return br.jumpFlip ? out(toward, -1) : out(toward, 0); }
  if (!me.e.components.versus?.airSpecial && jumps <= 0 && vy < 0) {
    const rec = has('uppercut') || has('teleport') || ['charge_dash', 'spin_kick'].map(a => has(a)).find(Boolean);
    if (rec) return queue(macroOf(rec, 'b'));
  }
  return out(toward, 0);
}

// ---------- the real input path ----------
/** Write one kit frame [relX, y, a, b] (or ['tech'] / ['throw']) as components.input; track charge like the motion buffer. */
function write(rt, config, e, br, f) {
  const facing = view(rt, e).facing;
  const input = { axes: { move: [0, 0] }, held: {}, actions: {} };
  if (f[0] === 'tech' || f[0] === 'throw') {
    if (config.throwVerb) { input.actions[config.throwVerb] = 1; input.held[config.throwVerb] = true; }
    else { input.actions[config.buttons.a] = 1; input.actions[config.buttons.b] = 1; input.held[config.buttons.a] = true; input.held[config.buttons.b] = true; }
    br.prev = [0, 0, 1, 1]; e.components.input = input; return;
  }
  const [rx, y, a, b] = f;
  input.axes.move = [round6(rx * facing), -y]; // absolute x; axes y is up-positive
  if (a) { input.held[config.buttons.a] = true; if (!br.prev[2]) input.actions[config.buttons.a] = 1; }
  if (b) { input.held[config.buttons.b] = true; if (!br.prev[3]) input.actions[config.buttons.b] = 1; }
  if (config.blockVerb && br.blocking && !a && !b) input.held[config.blockVerb] = true;
  // Charge bookkeeping (kit input.js record): back or down held for CHARGE frames, remembered 10 frames.
  const back = rx < 0, down = y > 0, ch = br.charge;
  if (back) ch.b++; else { if (ch.b >= CHARGE) ch.bm = 10; ch.b = 0; }
  if (down) ch.d++; else { if (ch.d >= CHARGE) ch.dm = 10; ch.d = 0; }
  if (ch.bm > 0 && !back) ch.bm--; if (ch.dm > 0 && !down) ch.dm--;
  br.prev = [rx, y, a, b];
  e.components.input = input;
}
