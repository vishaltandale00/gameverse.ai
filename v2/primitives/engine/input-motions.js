// Motion inputs (fighting-game specials, dashes, charge moves) over any
// verbs. Every step each tracked entity's direction (from axes.move, made
// relative to its facing) and button presses go into a ring buffer kept in
// state. Motions are sequences of direction sets read backwards from a
// press with leniency windows (numpad notation: 6 forward, 2 down, 3
// down-forward...), charge motions (hold a direction set for N frames,
// remembered for a grace period after release) and buttonless double taps.
// The highest-priority motion completed by an unconsumed recent press fires
// once: events `motion` and `motion:<id>` {who, motion, button, frame}.
// Ported from the fighting kit's input parser (40-frame buffer, charge
// 40 + 10 grace, 4-frame press buffer), generalized to any entity and verb.
const ID = 'engine.input.motions';

// Named direction sets (relative numpad digits).
export const SETS = {
  down: [1, 2, 3], fwd: [6, 9], fwdish: [3, 6, 9], back: [4, 7], backish: [1, 4, 7], up: [7, 8, 9], neutral: [5],
  notDown: [4, 5, 6, 7, 8, 9], notFwd: [1, 2, 4, 5, 7, 8], notBack: [2, 3, 5, 6, 8, 9], notUp: [1, 2, 3, 4, 5, 6], dpStart: [6, 3], rdpStart: [4, 1],
};
// Representative digit per set, for generating canonical input (CPU macros, verification).
const REP = { down: 2, fwd: 6, fwdish: 6, back: 4, backish: 4, up: 8, neutral: 5, notDown: 5, notFwd: 5, notBack: 5, notUp: 5, dpStart: 6, rdpStart: 4 };
/** The classic library (priority: higher wins when several complete on the same press). */
export const LIBRARY = [
  { id: 'qcf2', steps: ['2', '3', 'fwd', '2', '3', 'fwd'], window: 32, priority: 50 },
  { id: 'hcf', steps: ['back', '1', '2', 'fwd'], window: 24, priority: 40 },
  { id: 'hcb', steps: ['fwd', '3', '2', 'back'], window: 24, priority: 40 },
  // A dragon punch must not end in a plain forward (that is a quarter circle after walking forward).
  { id: 'dp', steps: ['dpStart', 'down', '3'], window: 18, last: 3, noAfter: [6], priority: 35 },
  { id: 'rdp', steps: ['rdpStart', 'down', '1'], window: 18, last: 3, noAfter: [4], priority: 35 },
  { id: 'qcf', steps: ['2', '3', 'fwd'], window: 16, priority: 30 },
  { id: 'qcb', steps: ['2', '1', 'back'], window: 16, priority: 30 },
  { id: 'charge-bf', charge: 'backish', release: 'fwdish', priority: 25 },
  { id: 'charge-du', charge: 'down', release: 'up', priority: 25 },
  { id: 'tap-dd', steps: ['down', 'notDown', 'down'], window: 16, priority: 20 },
  { id: 'tap-bf', steps: ['back', 'notBack', 'fwd'], window: 12, priority: 20 },
  { id: 'dash-f', steps: ['6', 'notFwd', '6'], window: 12, buttons: [], priority: 10 },
  { id: 'dash-b', steps: ['4', 'notBack', '4'], window: 12, buttons: [], priority: 10 },
];

/** Absolute numpad digit from an axis [x, y] (y up positive). */
export const numpad = (x, y) => 5 + Math.sign(x || 0) + 3 * Math.sign(y || 0);
export const mirror = d => (d % 3 === 1 ? d + 2 : d % 3 === 0 ? d - 2 : d);
const setOf = (name, sets) => sets[name] ?? (/^[1-9]$/.test(name) ? [Number(name)] : null);

export default {
  id: ID,
  card: {
    interactions: ['avatar-realtime'],
    intent: 'Recognizes motion inputs (quarter circles, dragon punch, half circles, charge moves, double-tap dashes, custom sequences) for the player and any AI-driven entity, relative to facing, with buffers, leniency windows and priority, and emits motion:<id> events for gameplay to turn into special moves.',
    views: ['side', '3p', 'td', 'any'],
    params: {
      motions: { type: 'list', effect: 'motions to recognize (default: the classic library)', default: LIBRARY.map(m => structuredClone(m)),
        of: { type: 'object', fields: {
          id: { type: 'string', required: true },
          steps: { type: 'list', of: { type: 'string' }, effect: 'direction sets in order: digits 1-9 or set names (down fwd back up fwdish backish notDown notFwd notBack notUp dpStart rdpStart, or custom sets)' },
          window: { type: 'integer', default: 16, min: 1, max: 120, unit: 'frames', effect: 'first step to press' },
          last: { type: 'integer', default: 6, min: 0, max: 30, unit: 'frames', effect: 'how long before the press the last direction may be' },
          noAfter: { type: 'list', of: { type: 'integer', min: 1, max: 9 }, effect: 'directions that cancel the motion between its last step and the press' },
          charge: { type: 'string', effect: 'charge motion: direction set to hold' }, release: { type: 'string', effect: 'charge motion: direction set at the press' },
          chargeFrames: { type: 'integer', min: 1, max: 240, effect: 'override the charge time' },
          buttons: { type: 'list', of: { type: 'string' }, effect: 'verbs that complete it; [] = directional only (completes on the last step)' },
          priority: { type: 'integer', default: 0, effect: 'higher wins on the same press' },
        } } },
      buttons: { type: 'list', of: { type: 'string' }, default: ['attack', 'alt_attack'], min: 1, max: 8, effect: 'verbs that can complete motions' },
      sets: { type: 'object', open: true, default: {}, effect: 'extra named direction sets: name -> [digits]' },
      buffer: { type: 'integer', default: 40, min: 8, max: 240, unit: 'frames', effect: 'input history length' },
      pressBuffer: { type: 'integer', default: 4, min: 0, max: 30, unit: 'frames', effect: 'a press this recent still completes a motion' },
      chargeFrames: { type: 'integer', default: 40, min: 1, max: 240, unit: 'frames' },
      chargeGrace: { type: 'integer', default: 10, min: 0, max: 60, unit: 'frames', effect: 'charge remembered after releasing the direction' },
      who: { type: 'string', options: ['player', 'all'], default: 'all', effect: 'all: also entities with components.input' },
      axis: { type: 'string', default: 'move', effect: 'axis verb that carries direction' },
    },
    provides: { events: ['motion', 'motion:*'], services: ['motions'] },
    requires: {},
  },
  logic(logic) {
    // {motion: id, who?, within?: frames}: that motion completed within the last `within` frames (default 0 = this step).
    logic.predicate('motion', { test: (p, rt, c) => { const e = rt.resolve(p.who, c); const last = e && rt.store(ID).last?.[e.id]; return Boolean(last && last.motion === p.motion && rt.state.frame - last.frame <= (p.within ?? 0)); } });
  },
  validate(config) {
    const errors = [], sets = { ...SETS, ...config.sets }, ids = new Set();
    for (const [k, v] of Object.entries(config.sets)) if (!Array.isArray(v) || !v.length || !v.every(d => Number.isInteger(d) && d >= 1 && d <= 9)) errors.push({ code: 'motion_set_invalid', path: `sets.${k}`, message: 'a direction set is a list of numpad digits 1-9' });
    config.motions.forEach((m, i) => {
      const path = `motions[${i}]`;
      if (ids.has(m.id)) errors.push({ code: 'motion_duplicate', path: `${path}.id`, message: `duplicate motion '${m.id}'` }); ids.add(m.id);
      if (!m.steps === !m.charge) errors.push({ code: 'motion_invalid', path, message: 'a motion has steps or charge (+ release), not both' });
      if (m.steps && m.steps.length < 1) errors.push({ code: 'motion_invalid', path: `${path}.steps`, message: 'steps needs at least one direction set' });
      for (const [j, s] of (m.steps || []).entries()) if (!setOf(s, sets)) errors.push({ code: 'motion_set_unknown', path: `${path}.steps[${j}]`, message: `unknown direction set '${s}'` });
      if (m.charge && (!setOf(m.charge, sets) || !setOf(m.release ?? '', sets))) errors.push({ code: 'motion_set_unknown', path, message: 'charge and release must be direction sets' });
      for (const [j, b] of (m.buttons || []).entries()) if (!config.buttons.includes(b)) errors.push({ code: 'motion_button_unknown', path: `${path}.buttons[${j}]`, message: `'${b}' is not in buttons` });
      if (m.buttons && !m.buttons.length && m.charge) errors.push({ code: 'motion_invalid', path, message: 'a charge motion needs a button' });
    });
    return errors;
  },
  install(rt, config) {
    const sets = { ...SETS, ...config.sets }, B = config.buttons, NB = B.length;
    const motions = config.motions.map(m => ({ ...m, steps: m.steps?.map(s => setOf(s, sets)), charge: m.charge && setOf(m.charge, sets), release: m.release && setOf(m.release, sets), chargeName: m.charge })).sort((a, b) => b.priority - a.priority);
    const chargeSets = [...new Set(motions.filter(m => m.chargeName).map(m => m.chargeName))];
    // Packed history entry: absolute digit (4 bits) | held buttons << 4 | pressed buttons << (4 + NB).
    const dirOf = v => v & 15, held = v => (v >> 4) & ((1 << NB) - 1), pressedMask = v => (v >> (4 + NB)) & ((1 << NB) - 1);
    const facingOf = e => { const f = e.components.body?.facing; const x = Array.isArray(f) ? f[0] : f; return Number.isFinite(x) && x < 0 ? -1 : 1; };
    const raw = e => (e.id === 'player' ? rt.input || {} : e.components.input || {});
    const st = () => { const s = rt.store(ID); s.f ??= {}; s.last ??= {}; return s; };
    const fighter = id => (st().f[id] ??= { buf: [], n: 0, consumed: -1, prevHeld: 0, charge: Object.fromEntries(chargeSets.map(c => [c, { t: 0, mem: 0 }])), dirDone: -1 });
    const rel = (f, d) => (f.facing < 0 ? mirror(d) : d);
    const record = (e, f) => {
      const r = raw(e), ax = r.axes?.[config.axis] || [0, 0];
      let h = 0, p = 0;
      B.forEach((b, i) => { const on = Boolean(r.held?.[b] || r.actions?.[b]); if (on) h |= 1 << i; if ((r.actions?.[b]) || (on && !(f.prevHeld & (1 << i)))) p |= 1 << i; });
      f.prevHeld = h; f.facing = facingOf(e);
      const v = numpad(ax[0], ax[1]) | (h << 4) | (p << (4 + NB));
      f.buf.push(v); if (f.buf.length > config.buffer) f.buf.shift(); f.n++;
      const d = rel(f, numpad(ax[0], ax[1]));
      for (const name of chargeSets) {
        const c = f.charge[name] ??= { t: 0, mem: 0 }, set = sets[name] ?? setOf(name, sets);
        if (set.includes(d)) c.t++; else { if (c.t >= config.chargeFrames) c.mem = config.chargeGrace; else if (c.mem > 0) c.mem--; c.t = 0; }
      }
    };
    const absFrame = (f, i) => f.n - (f.buf.length - 1 - i);
    // Index of the most recent unconsumed press within pressBuffer frames, and which button.
    const recentPress = f => {
      for (let i = f.buf.length - 1; i >= Math.max(0, f.buf.length - 1 - config.pressBuffer); i--) {
        if (absFrame(f, i) <= f.consumed) return null;
        const m = pressedMask(f.buf[i]); if (m) return { i, mask: m };
      }
      return null;
    };
    // Steps are matched backwards; each must be a different direction from the step after it, so one held
    // direction cannot satisfy two steps (holding down-back does not make a reverse dragon punch).
    const steps = (f, m, pi) => {
      let at = pi, next = null;
      for (let s = m.steps.length - 1; s >= 0; s--) {
        const set = m.steps[s], limit = s === m.steps.length - 1 ? Math.max(0, pi - (m.last ?? 6)) : Math.max(0, pi - m.window);
        let found = -1;
        for (let i = at; i >= limit; i--) { const d = rel(f, dirOf(f.buf[i])); if (set.includes(d) && d !== next) { found = i; next = d; break; } }
        if (found < 0) return false;
        if (s === m.steps.length - 1 && m.noAfter) for (let i = found + 1; i <= pi; i++) if (m.noAfter.includes(rel(f, dirOf(f.buf[i])))) return false;
        at = found - 1;
        if (at < 0 && s > 0) return false;
      }
      return pi - (at + 1) <= m.window;
    };
    const charged = (f, m, pi) => {
      const c = f.charge[m.chargeName], need = m.chargeFrames ?? config.chargeFrames;
      return m.release.includes(rel(f, dirOf(f.buf[pi]))) && (c.mem > 0 || c.t >= need);
    };
    const fire = (e, f, m, button, frame) => {
      st().last[e.id] = { motion: m.id, frame: rt.state.frame, button };
      rt.emitTyped('motion', m.id, { who: e.id, motion: m.id, button, frame });
    };
    const detect = (e, f) => {
      const press = recentPress(f);
      if (press) {
        const names = B.filter((_, i) => press.mask & (1 << i));
        for (const m of motions) {
          if (m.buttons && !m.buttons.length) continue;
          const button = names.find(b => !m.buttons || m.buttons.includes(b)); if (!button) continue;
          if (m.charge ? charged(f, m, press.i) : steps(f, m, press.i)) { f.consumed = absFrame(f, press.i); if (m.charge) f.charge[m.chargeName] = { t: 0, mem: 0 }; fire(e, f, m, button, absFrame(f, press.i)); return; }
        }
      }
      // Directional motions complete on a fresh last direction (this step, not the previous one).
      const n = f.buf.length; if (n < 2) return;
      for (const m of motions) {
        if (!m.buttons || m.buttons.length || !m.steps) continue;
        const lastSet = m.steps[m.steps.length - 1];
        if (!lastSet.includes(rel(f, dirOf(f.buf[n - 1]))) || lastSet.includes(rel(f, dirOf(f.buf[n - 2]))) || f.dirDone >= f.n) continue;
        if (steps(f, { ...m, last: 0 }, n - 1)) { f.dirDone = f.n; fire(e, f, m, null, f.n); return; }
      }
    };
    /** Canonical frames entering `motion` with `button`, as entity input {axes, held, actions} for facing ±1 (CPU macros, verification). */
    const framesFor = (id, button = B[0], facing = 1) => {
      const m = motions.find(x => x.id === id); if (!m) return null;
      const dig = d => { const x = ((d - 1) % 3) - 1, y = Math.floor((d - 1) / 3) - 1; return [x * facing, y]; };
      const rep = set => { const name = Object.keys(sets).find(k => sets[k] === set); return name && REP[name] ? REP[name] : set[0]; };
      const frame = (d, press) => ({ axes: { [config.axis]: dig(d) }, held: press ? { [button]: true } : {}, actions: press ? { [button]: true } : {} });
      if (m.charge) return [...Array.from({ length: (m.chargeFrames ?? config.chargeFrames) + 4 }, () => frame(rep(m.charge) === 4 ? 1 : rep(m.charge), false)), frame(rep(m.release), true)];
      const ds = m.steps.map(rep), buttonless = m.buttons && !m.buttons.length;
      return [frame(5, false), ...ds.slice(0, -1).map(d => frame(d, false)), frame(ds[ds.length - 1], !buttonless), frame(5, false)];
    };
    rt.provide('motions', { frames: framesFor, last: id => st().last[id ?? 'player'] ?? null, list: () => motions.map(m => m.id), buffer: id => (st().f[id ?? 'player']?.buf || []).slice() });
    rt.system('input', rt => {
      const ids = config.who === 'player' ? ['player'] : ['player', ...Object.values(rt.state.entities).filter(e => e.id !== 'player' && e.components.input).map(e => e.id)];
      for (const id of ids) { const e = rt.entity(id); if (!e) continue; const f = fighter(id); record(e, f); detect(e, f); }
      for (const id of Object.keys(st().f)) if (!rt.entity(id)) delete st().f[id];
    }, ID);
  },
};
