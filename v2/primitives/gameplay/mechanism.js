// Mechanisms: doors, levers, plates, breakables (including erodible cell
// bunkers), lifts, gates, traps and timers wired together by signals, plus
// physics toys for pinball tables and vertical climbers: flippers, bumpers,
// kickers/slingshots, plungers, rollovers, drop-target banks, ramps, springs
// and breaking / vanishing / moving platforms.
//
// Each mechanism has a box (`at` + `size` in the space's anchor convention),
// a `state` and an `active` flag. An active mechanism drives its `signal`;
// a mechanism listing inputs in `opens` follows them (`logic` any|all, `invert`).
// Inputs are read from the previous step, so wiring is order-independent and
// deterministic. Doors and gates can block cells (`cells` + `block`) and are
// locked while their `gate` predicate (or plot.gate id) fails. Entities whose
// `mechanism` component names a mechanism forward interactions to it; `entity`
// spawns such an entity (with a body box and an interact prompt) automatically.
// Physics toys act on entities with components.body.vel (velocities in space
// units per second).
import { compare } from '../../kernel/logic.js';
import { count, take } from './inventory.js';
import { addScore, runIf, boxAt, boxOf, boxesTouch, center, isVec, v3, add, sub, len, norm, dot, posForMin, whoKey, velocity, setVelocity } from './items-lib.js';

const KEY = 'gameplay.mechanism';
export const KINDS = ['door', 'lever', 'plate', 'breakable', 'lift', 'gate', 'trap', 'timer', 'flipper', 'bumper', 'kicker', 'plunger', 'rollover', 'drop_target', 'ramp', 'spring', 'platform'];
const PLATFORM_MODES = ['solid', 'moving', 'breaking', 'vanishing'];
const INITIAL = { door: 'closed', lever: 'off', plate: 'up', breakable: 'intact', lift: 'stop0', gate: 'closed', trap: 'armed', timer: 'idle', flipper: 'down', bumper: 'idle', kicker: 'idle', plunger: 'idle', rollover: 'off', drop_target: 'up', ramp: 'idle', spring: 'idle', platform: 'solid' };
const USABLE = new Set(['door', 'lever', 'lift', 'timer', 'breakable']);
const ENTITY_DEFAULT = new Set(['lift', 'platform', 'flipper', 'bumper', 'drop_target']);
/** Classic arcade bunker (shmup): 12 × 7 cells with cut corners and an arch underneath. */
export const BUNKER = ['..########..', '.##########.', '############', '############', '####....####', '####....####', '####....####'];

const F = (type, extra = {}) => ({ type, ...extra });
const MECH_FIELDS = {
  id: F('string', { required: true }), kind: F('string', { required: true, options: KINDS }),
  at: F('json', { required: true, effect: 'box position (space anchor convention)' }), size: F('json', { default: [1, 1, 1] }),
  space: F('ref', { to: 'space' }), name: F('string'), prompt: F('string', { effect: 'interact prompt for its entity' }),
  signal: F('string', { effect: 'signal driven while active' }),
  opens: F('list', { default: [], of: { type: 'string' }, effect: 'inputs: signals or mechanism ids this follows' }),
  logic: F('string', { default: 'any', options: ['any', 'all'] }), invert: F('boolean', { default: false, effect: 'active when the inputs are off (arena doors slam shut)' }),
  gate: F('json', { effect: 'predicate (or plot.gate id) required to open/use' }),
  hits: F('integer', { default: 0, min: 0, effect: 'hits needed to break/breach (0 = not breakable by hits)' }),
  hitsWith: F('object', { open: true, fields: {}, effect: 'item id → hits applied when used with that item (consumes one)' }),
  sec: F('number', { default: 0, min: 0, unit: 's', effect: 'lever/plate hold, trap firing time, timer duration, ramp ride time' }),
  cooldown: F('number', { default: 1, min: 0, unit: 's', effect: 'trap re-arm time' }),
  persist: F('boolean', { default: false, effect: 'once activated it stays active' }),
  cells: F('json', { effect: "cells it occupies in an editCells space: true (its box), [[x,y,z]...], or 'pattern'" }),
  block: F('ref', { to: 'block', effect: 'block written to its cells while closed/intact/up' }),
  pattern: F('list', { of: { type: 'string' }, effect: "erodible cell grid rows, top first ('#' solid)" }),
  preset: F('string', { options: ['bunker'], effect: 'built-in pattern' }),
  cellSize: F('number', { default: 1, min: 0.01, effect: 'size of a pattern cell in space units' }),
  blast: F('integer', { default: 0, min: 0, max: 8, effect: 'erosion radius per hit (Manhattan; the square ring beyond erodes with p 0.4)' }),
  stops: F('json', { effect: 'lift stop positions [[x,y,z]...] (default [at])' }),
  speed: F('number', { default: 2, min: 0, effect: 'lift/moving-platform speed (units/s), flipper swing (1/s)' }),
  axis: F('integer', { default: 0, min: 0, max: 2, effect: 'moving platform axis' }),
  range: F('number', { default: 0, min: 0, effect: 'moving platform half-travel' }),
  phase: F('number', { default: 0 }),
  mode: F('string', { default: 'solid', options: PLATFORM_MODES, effect: 'platform behaviour' }),
  bounce: F('number', { default: 0, min: 0, effect: 'platforms: launch speed on landing (auto-bounce climbers); 0 = stand on it' }),
  launch: F('number', { default: 24, min: 0, effect: 'spring launch speed' }),
  kick: F('number', { default: 12.5, min: 0, effect: 'bumper/kicker/flipper impulse speed' }),
  lift: F('number', { default: 0, effect: 'extra upward speed added by kickers' }),
  normal: F('json', { default: [0, 1, 0], effect: 'kicker/flipper/drop-target face direction' }),
  minSpeed: F('number', { default: 0, min: 0, effect: 'kicker/ramp minimum approach speed' }),
  verb: F('string', { effect: 'flipper/plunger input verb (held)' }),
  charge: F('number', { default: 1.15, min: 0.01, effect: 'plunger charge per second (to 1)' }),
  power: F('json', { default: [10, 14], effect: 'plunger launch speed [base, + per full charge]' }),
  dir: F('json', { default: [0, 1, 0], effect: 'plunger launch / ramp entry direction' }),
  path: F('json', { effect: 'ramp waypoints [[x,y,z]...]' }), exit: F('json', { effect: 'ramp exit position' }), exitVel: F('json', { default: [0, 0, 0] }),
  comboSec: F('number', { default: 4, min: 0 }),
  points: F('number', { default: 0, effect: 'score on hit/activation' }),
  group: F('string', { effect: 'rollover/drop-target group' }),
  by: F('list', { default: [], of: { type: 'string' }, effect: "who presses plates/traps/toys: entity ids or archetypes ([] = player and every body)" }),
  damage: F('number', { default: 0, min: 0, effect: 'trap damage to entities in its box when it fires' }),
  do: F('effects', { default: [], effect: 'effects when it activates (self = the mechanism entity if any)' }),
  undo: F('effects', { default: [], effect: 'effects when it deactivates' }),
  loot: F('ref', { to: 'table', effect: 'breakables drop this table' }),
  entity: F('boolean', { effect: 'spawn an entity for it (default for lifts, platforms, flippers, bumpers, drop targets)' }),
  archetype: F('ref', { to: 'archetype', effect: 'archetype for that entity' }),
  start: F('string', { effect: 'initial state' }),
  repeat: F('boolean', { default: false, effect: 'timers restart when done' }),
};

export default {
  id: 'gameplay.mechanism',
  card: {
    intent: 'Signal-wired world mechanisms: doors, levers, pressure plates, breakables and erodible cell bunkers, lifts, gates, traps, timers, and physics toys (flippers, bumpers, kickers, plungers, rollovers, drop-target banks, ramps, springs, breaking/vanishing/moving platforms).',
    views: ['any'],
    params: {
      mechanisms: { type: 'list', default: [], of: { type: 'object', fields: MECH_FIELDS }, effect: 'mechanisms' },
      groups: { type: 'list', default: [], of: { type: 'object', fields: { id: F('string', { required: true }), points: F('number', { default: 0 }), resetSec: F('number', { default: 1.5, min: 0 }), onComplete: F('effects', { default: [] }), rotateLeft: F('string', { effect: 'verb rotating lit rollovers left' }), rotateRight: F('string') } }, effect: 'rollover / drop-target banks' },
      reach: { type: 'number', default: 2.5, min: 0, max: 50, effect: 'how close a mechanism entity must be to use it (gameplay.interact range)' },
    },
    provides: { events: ['triggered', 'triggered:*', 'opened', 'opened:*', 'closed', 'closed:*', 'broken', 'broken:*', 'deactivated', 'deactivated:*', 'mechanism_denied', 'chip', 'flip', 'bumper', 'kicked', 'launched', 'rollover', 'group_complete', 'group_complete:*', 'ramp', 'ramp_exit', 'ramp_combo', 'sprung', 'landed_on', 'timer_done', 'timer_done:*', 'trap_fired', 'trap_fired:*'], services: ['mechanisms'] },
    requires: { capabilities: ['position'] },
    reads: ['content.archetypes'],
    defines: [{ kind: 'mechanism', in: 'mechanisms' }],
  },
  logic(logic) {
    const api = rt => rt.caches.mechanisms;
    logic.predicate('mechanism', { refs: p => [['mechanism', p.mechanism]], test: (p, rt) => {
      const m = rt.state.prim[KEY]?.m?.[p.mechanism]; if (!m) return false;
      if (p.state === 'active') return m.active; if (p.state === 'inactive') return !m.active;
      return p.state ? m.state === p.state : compare(m.hits ?? 0, p);
    } });
    logic.predicate('signal', { test: (p, rt) => Boolean(rt.state.prim[KEY]?.sig?.[p.signal]) === (p.eq ?? true) });
    logic.effect('trigger', { refs: e => [['mechanism', e.mechanism]], run: (e, rt, c) => api(rt)?.use(e.mechanism, whoKey(e.who, c), { force: true }) });
    logic.effect('set_mechanism', { refs: e => [['mechanism', e.mechanism]], check: (e, path, errors) => { if (!e.state) errors.push({ code: 'effect_invalid', path, message: 'set_mechanism needs a state' }); }, run: (e, rt) => api(rt)?.set(e.mechanism, e.state) });
    logic.effect('hit_mechanism', { refs: e => [['mechanism', e.mechanism]], run: (e, rt, c) => api(rt)?.hit(e.mechanism, e.amount ?? 1, e.at ?? null, whoKey(e.who, c)) });
    logic.effect('signal', { check: (e, path, errors) => { if (!e.signal) errors.push({ code: 'effect_invalid', path, message: 'signal needs a signal name' }); }, run: (e, rt) => api(rt)?.force(e.signal, e.on ?? true) });
  },
  validate(config, doc, ctx, inst = {}) {
    const W = inst.path ? `${inst.path}.with` : undefined, at = (i, f) => (W ? `${W}.mechanisms[${i}]${f ? `.${f}` : ""}` : undefined);
    const errors = [], ids = new Set(), sigs = new Set(config.mechanisms.map(m => m.signal).filter(Boolean)), groups = new Set(config.groups.map(g => g.id));
    for (const m of config.mechanisms) { if (ids.has(m.id)) errors.push({ code: 'id_duplicate', message: `duplicate mechanism '${m.id}'` }); ids.add(m.id); }
    const vec = v => Array.isArray(v) && v.length >= 2 && v.length <= 3 && v.every(Number.isFinite);
    config.mechanisms.forEach((m, i) => {
      const bad = msg => errors.push({ code: 'mechanism_invalid', path: at(i), message: `mechanism '${m.id}': ${msg}` });
      if (!vec(m.at)) bad('at must be [x,y] or [x,y,z]');
      if (!vec(m.size)) bad('size must be [w,h] or [w,h,d]');
      for (const k of ['normal', 'dir', 'exitVel']) if (m[k] !== undefined && !vec(m[k])) bad(`${k} must be a vector`);
      for (const inp of m.opens) if (!sigs.has(inp) && !ids.has(inp)) errors.push({ code: 'signal_unknown', path: at(i, 'opens'), message: `mechanism '${m.id}' listens to '${inp}', which no mechanism drives`, hint: [...sigs, ...ids].join(', ') });
      if (m.gate !== undefined) ctx.checkPredicate(typeof m.gate === 'string' ? { gate: m.gate } : m.gate, at(i, 'gate') ?? `mechanisms[${i}].gate`, errors);
      if (m.group && !groups.has(m.group)) errors.push({ code: 'group_unknown', path: at(i, 'group'), message: `mechanism '${m.id}' is in unknown group '${m.group}'` });
      if ((m.kind === 'flipper' || m.kind === 'plunger') && !m.verb) bad(`${m.kind} needs a verb`);
      if (m.kind === 'ramp' && !(Array.isArray(m.path) && m.path.length >= 2 && m.path.every(vec)) ) bad('ramp needs a path of at least two points');
      if (m.kind === 'lift' && m.stops !== undefined && !(Array.isArray(m.stops) && m.stops.length >= 1 && m.stops.every(vec))) bad('stops must be a list of positions');
      if (m.cells === 'pattern' && !m.pattern && !m.preset) bad("cells 'pattern' needs a pattern or preset");
      if (m.cells !== undefined && m.cells !== true && m.cells !== 'pattern' && !(Array.isArray(m.cells) && m.cells.every(vec))) bad("cells must be true, 'pattern' or a list of cells");
      if (m.pattern && !m.pattern.every(r => typeof r === 'string' && r.length === m.pattern[0].length)) bad('pattern rows must be strings of equal length');
      for (const it of Object.keys(m.hitsWith || {})) if (!(doc.content?.items || []).some(x => x.id === it)) errors.push({ code: 'ref_unknown', path: at(i, 'hitsWith'), message: `mechanism '${m.id}' hitsWith unknown item '${it}'` });
    });
    (doc.content?.archetypes || []).forEach((a, i) => { const id = a.components?.mechanism; if (typeof id === 'string' && !ids.has(id)) errors.push({ code: 'ref_unknown', path: `content.archetypes[${i}].components.mechanism`, message: `unknown mechanism '${id}'`, hint: [...ids].slice(0, 20).join(', ') }); });
    return errors;
  },
  install(rt, config, instance) {
    const defs = new Map(config.mechanisms.map(m => [m.id, m])), groups = new Map(config.groups.map(g => [g.id, g]));
    const spaceOf = m => m.space ?? instance.space ?? rt.doc.spaces[0].id;
    const st = () => { const s = rt.store(KEY); s.m ??= {}; s.sig ??= {}; s.forced ??= {}; s.prev ??= {}; s.contact ??= {}; s.rides ??= []; s.groups ??= {}; s.init ??= false; return s; };
    st(); // created at install, so reads later never add state
    const frames = sec => Math.max(1, Math.round(sec / rt.dt));
    const gateOk = (m, who) => m.gate === undefined || rt.test(typeof m.gate === 'string' ? { gate: m.gate } : m.gate, { actor: who, self: entIdOf(m) });
    const entIdOf = m => `mech_${m.id}`;
    const pattern = m => m.pattern ?? (m.preset === 'bunker' ? BUNKER : null);

    // ----- geometry -----
    const posOf = m => st().m[m.id]?.pos ?? v3(m.at);
    const boxM = m => boxAt(rt, spaceOf(m), posOf(m), m.size);
    const cellsOf = m => {
      if (m.cells === true) { const b = boxM(m), out = []; for (let x = Math.floor(b.min[0]); x < Math.ceil(b.max[0]); x++) for (let y = Math.floor(b.min[1]); y < Math.ceil(b.max[1]); y++) for (let z = Math.floor(b.min[2]); z < Math.max(Math.ceil(b.max[2]), Math.floor(b.min[2]) + 1); z++) out.push([x, y, z]); return out; }
      if (Array.isArray(m.cells)) return m.cells.map(v3);
      return [];
    };
    const writeCells = (m, solid) => {
      const sp = rt.space(spaceOf(m)); if (!m.block || typeof sp.setCell !== 'function') return;
      for (const c of cellsOf(m)) sp.setCell(c, solid ? m.block : null, rt, m.id);
    };
    const toyFilter = m => e => !e.components.mechanism && (m.by.length ? m.by.includes(e.id) || m.by.includes(e.archetype) : e.id === 'player' || Boolean(e.components.body));
    const touching = m => {
      const sid = spaceOf(m), b = boxM(m), f = toyFilter(m), out = [];
      for (const e of Object.values(rt.state.entities)) if (e.space === sid && isVec(e.at) && f(e) && boxesTouch(boxOf(rt, e), b)) out.push(e);
      return out.sort((a, b2) => (a.id < b2.id ? -1 : 1));
    };
    const velOf = e => velocity(rt, e);
    const setVel = (e, v) => setVelocity(rt, e, v);
    const speedOf = e => len(velOf(e));

    // ----- state transitions -----
    function setActive(m, active, state, who = null) {
      const s = st().m[m.id], was = s.active;
      if (state) s.state = state;
      s.active = active;
      if (active === was) return;
      if (active) {
        rt.emitTyped('triggered', m.id, { mechanism: m.id, kind: m.kind, who });
        if (m.kind === 'door' || m.kind === 'gate') { rt.emitTyped('opened', m.id, { mechanism: m.id, who }); writeCells(m, false); }
        if (m.points) addScore(rt, m.points);
        if (m.do.length) rt.run(m.do, { self: rt.entity(entIdOf(m)) ? entIdOf(m) : undefined, actor: who, mechanism: m.id });
      } else {
        rt.emitTyped('deactivated', m.id, { mechanism: m.id, kind: m.kind });
        if (m.kind === 'door' || m.kind === 'gate') { rt.emitTyped('closed', m.id, { mechanism: m.id }); writeCells(m, true); }
        if (m.undo.length) rt.run(m.undo, { actor: who, mechanism: m.id });
      }
      syncEntity(m);
    }
    function breakIt(m, who) {
      const s = st().m[m.id]; if (s.state === 'broken') return;
      s.state = 'broken';
      writeCells(m, false);
      if (s.cells) { s.cells = s.cells.map(() => 0); mirror(m); }
      rt.emitTyped('broken', m.id, { mechanism: m.id, who });
      if (m.loot) runIf(rt, { do: 'drop_loot', table: m.loot, ...(who ? { who } : {}) }, { self: rt.entity(entIdOf(m)) ? entIdOf(m) : undefined });
      setActive(m, true, 'broken', who);
    }
    function hit(id, amount = 1, at = null, who = null) {
      const m = defs.get(id), s = st().m[id]; if (!m || !s) return false;
      if (s.cells && at) return erode(m, at);
      if (!m.hits) return false;
      if (s.state === 'broken' || (m.kind === 'door' && s.active)) return false;
      s.hits = (s.hits || 0) + amount;
      rt.emit('mechanism_hit', { mechanism: id, hits: s.hits, of: m.hits });
      if (s.hits >= m.hits) { if (m.kind === 'door' || m.kind === 'gate') { s.breached = true; setActive(m, true, 'open', who); } else breakIt(m, who); }
      return true;
    }
    // Erodible pattern cells (shmup bunkers): the hit cell plus a Manhattan blast; the square ring beyond with p 0.4.
    function erode(m, at) {
      const s = st().m[m.id], pat = pattern(m), rows = pat.length, cols = pat[0].length, b = boxM(m);
      const p = v3(at), c = Math.floor((p[0] - b.min[0]) / m.cellSize), r = rows - 1 - Math.floor((p[1] - b.min[1]) / m.cellSize);
      if (c < 0 || r < 0 || c >= cols || r >= rows || !s.cells[r * cols + c]) return false;
      for (let dr = -m.blast; dr <= m.blast; dr++) for (let dc = -m.blast; dc <= m.blast; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < rows && cc < cols && (Math.abs(dr) + Math.abs(dc) <= m.blast || rt.random() < 0.4)) s.cells[rr * cols + cc] = 0;
      }
      mirror(m);
      rt.emit('chip', { mechanism: m.id, at: p });
      if (!s.cells.some(Boolean)) breakIt(m, null);
      return true;
    }
    // With cells: 'pattern' and a block, pattern cells are mirrored into the space's cells.
    function mirror(m) {
      const s = st().m[m.id], sp = rt.space(spaceOf(m)); if (m.cells !== 'pattern' || !m.block || typeof sp.setCell !== 'function') return;
      const pat = pattern(m), rows = pat.length, cols = pat[0].length, b = boxM(m);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const cell = [Math.floor(b.min[0] + c * m.cellSize), Math.floor(b.min[1] + (rows - 1 - r) * m.cellSize), Math.floor(b.min[2])];
        const want = s.cells[r * cols + c] ? m.block : null;
        if (sp.getCell(cell) !== want) sp.setCell(cell, want, rt, m.id);
      }
    }
    function solidAt(id, at) {
      const m = defs.get(id), s = st().m[id]; if (!m || !s?.cells) return false;
      const pat = pattern(m), rows = pat.length, cols = pat[0].length, b = boxM(m), p = v3(at);
      const c = Math.floor((p[0] - b.min[0]) / m.cellSize), r = rows - 1 - Math.floor((p[1] - b.min[1]) / m.cellSize);
      return c >= 0 && r >= 0 && c < cols && r < rows && Boolean(s.cells[r * cols + c]);
    }

    /** Use a mechanism (interaction or trigger effect). */
    function use(id, who = 'player', { force = false, item = null } = {}) {
      const m = defs.get(id), s = st().m[id]; if (!m || !s) return false;
      const deny = reason => { rt.emit('mechanism_denied', { mechanism: id, who, reason }); return false; };
      // Items that breach (thermite on a vault door).
      const tool = item ?? Object.keys(m.hitsWith || {}).sort().find(it => count(rt, who, it) > 0);
      if (m.hits && tool && m.hitsWith?.[tool] && s.state !== 'broken' && !s.active) {
        if (!force && !gateOk(m, who)) return deny('locked');
        take(rt, who, tool, 1); hit(id, m.hitsWith[tool], null, who); return true;
      }
      if (!force && !gateOk(m, who)) return deny('locked');
      switch (m.kind) {
        case 'door': if (m.opens.length && !force) return deny('wired'); if (s.active && m.persist) return deny('stuck'); if (m.hits && !s.breached && !force) return deny('sealed'); setActive(m, !s.active, s.active ? 'closed' : 'open', who); return true;
        case 'lever': if (s.active && m.persist) return deny('stuck'); setActive(m, !s.active, s.active ? 'off' : 'on', who); if (s.active && m.sec) s.until = rt.state.frame + frames(m.sec); return true;
        case 'timer': s.state = 'running'; s.until = rt.state.frame + frames(m.sec); rt.emit('timer_started', { mechanism: id }); return true;
        case 'lift': { const n = (m.stops || [m.at]).length; s.target = (s.target + 1) % n; return true; }
        case 'trap': fireTrap(m, who); return true;
        case 'breakable': if (force) { breakIt(m, who); return true; } return deny('needs_hits');
        default: setActive(m, true, null, who); return true;
      }
    }
    function set(id, state) {
      const m = defs.get(id), s = st().m[id]; if (!m || !s) return;
      if (state === 'broken') { breakIt(m, null); return; }
      if (state === 'intact' || state === 'up' || state === 'armed' || state === 'idle') {
        s.hits = 0; s.breached = false;
        if (s.cells) { s.cells = initCells(m); mirror(m); }
        if (m.kind === 'drop_target' || m.kind === 'breakable') writeCells(m, true);
      }
      const on = ['open', 'on', 'down', 'broken', 'active', 'lit', 'running', 'done', 'firing'].includes(state);
      setActive(m, on, state);
    }
    const initCells = m => { const pat = pattern(m); return pat ? pat.join('').split('').map(ch => (ch === '#' ? 1 : 0)) : null; };
    function fireTrap(m, who) {
      const s = st().m[m.id]; if (s.state !== 'armed') return;
      s.state = 'firing'; s.until = rt.state.frame + frames(m.sec || rt.dt);
      const victims = touching(m);
      rt.emitTyped('trap_fired', m.id, { mechanism: m.id, victims: victims.map(e => e.id) });
      for (const e of victims) if (m.damage) runIf(rt, { do: 'damage', who: e.id, amount: m.damage, type: m.id }, { self: e.id });
      setActive(m, true, 'firing', who);
    }
    function groupCheck(gid) {
      if (!gid) return;
      const g = groups.get(gid), members = config.mechanisms.filter(x => x.group === gid);
      if (!members.every(x => st().m[x.id].active)) return;
      const gs = (st().groups[gid] ??= { done: 0 }); gs.done++;
      rt.emitTyped('group_complete', gid, { group: gid, times: gs.done });
      if (g.points) addScore(rt, g.points);
      if (g.onComplete.length) rt.run(g.onComplete, { group: gid });
      gs.resetAt = rt.state.frame + (g.resetSec > 0 ? frames(g.resetSec) : 0);
    }
    function syncEntity(m) {
      const e = rt.entity(entIdOf(m)); if (!e) return;
      const s = st().m[m.id];
      e.components.mechanismState = { state: s.state, active: s.active };
      e.components.blocker = ['door', 'gate'].includes(m.kind) ? !s.active : m.kind === 'drop_target' ? !s.active : m.kind === 'platform' ? s.state !== 'broken' && s.state !== 'gone' : m.kind === 'lift' || m.kind === 'bumper' || m.kind === 'flipper';
    }

    // ----- init: state, cells, entities (first step, so spaces and the player exist) -----
    function init() {
      const s = st(); if (s.init) return; s.init = true;
      for (const m of config.mechanisms) {
        const start = m.start ?? INITIAL[m.kind];
        s.m[m.id] ??= { state: start, active: false, hits: 0, pos: v3(m.at), target: 0, t: 0 };
        const ms = s.m[m.id];
        const cells = initCells(m); if (cells) ms.cells = cells;
        if (['door', 'gate', 'breakable', 'drop_target'].includes(m.kind)) writeCells(m, true);
        if (ms.cells) mirror(m);
        const wantEntity = m.entity ?? (ENTITY_DEFAULT.has(m.kind) || USABLE.has(m.kind) && m.prompt != null);
        if (wantEntity && !rt.entity(entIdOf(m))) {
          const sid = spaceOf(m), body = { size: v3(m.size).slice(0, isVec(m.at) ? Math.max(2, m.at.length) : 3) };
          const comps = { mechanism: m.id, body };
          if (USABLE.has(m.kind) && !m.opens.length) comps.interact = { prompt: m.prompt ?? m.name ?? m.kind, range: config.reach, kind: m.kind === 'lever' ? 'pull' : 'use' };
          rt.spawn(m.archetype ?? null, { id: entIdOf(m), space: sid, at: [...m.at], components: comps });
        }
        if (['open', 'on', 'down', 'broken', 'lit'].includes(start)) { ms.active = true; if (m.kind === 'door' || m.kind === 'gate') writeCells(m, false); }
        syncEntity(m);
      }
    }

    // Forwarded interactions and hits.
    rt.on('interacted', d => { const t = rt.entity(d.target), id = t?.components.mechanism; if (typeof id === 'string' && defs.has(id)) use(id, d.who); });
    const onHit = d => {
      const t = d.target && rt.entity(d.target), id = t?.components.mechanism;
      if (typeof id === 'string' && defs.has(id)) { hit(id, 1, d.at ?? null, d.by ?? d.who ?? null); return; }
      if (!isVec(d.at)) return;
      for (const m of config.mechanisms) if (st().m[m.id]?.cells && solidAt(m.id, d.at)) { erode(m, d.at); return; }
    };
    rt.on('hit', onHit); rt.on('projectile_hit', onHit);
    for (const g of config.groups) for (const [verb, dirn] of [[g.rotateLeft, 1], [g.rotateRight, -1]]) if (verb) rt.action(verb, () => {
      const members = config.mechanisms.filter(x => x.group === g.id && x.kind === 'rollover'); if (members.length < 2) return;
      const lit = members.map(x => st().m[x.id].active), rot = dirn > 0 ? [...lit.slice(1), lit[0]] : [lit[lit.length - 1], ...lit.slice(0, -1)];
      members.forEach((x, i) => { const ms = st().m[x.id]; ms.active = rot[i]; ms.state = rot[i] ? 'lit' : 'off'; syncEntity(x); });
    });

    // Entities landing on a mechanism's top this step (falling, horizontally over it).
    function landers(m) {
      const s = st(), b = boxM(m), top = b.max[1], out = [];
      for (const e of touchingLoose(m)) {
        const eb = boxOf(rt, e), prevBottom = s.prev[e.id];
        if (prevBottom == null) continue;
        const v = velOf(e);
        if ((v[1] ?? 0) <= 0 && prevBottom >= top - 1e-6 && eb.min[1] <= top + 1e-6) out.push(e);
      }
      return out;
    }
    // Horizontal overlap with the box, vertically from just below the top to anywhere above the box bottom.
    function touchingLoose(m) {
      const b = boxM(m), sid = spaceOf(m), f = toyFilter(m), out = [];
      for (const e of Object.values(rt.state.entities)) {
        if (e.space !== sid || !isVec(e.at) || !f(e)) continue;
        const eb = boxOf(rt, e);
        const horiz = [0, 2].every(i => eb.min[i] < b.max[i] + (eb.min[i] === eb.max[i] ? 1e-9 : 0) && b.min[i] < eb.max[i] + (b.min[i] === b.max[i] ? 1e-9 : 0) || (b.min[i] === b.max[i] && eb.min[i] === eb.max[i]));
        if (horiz && eb.min[1] <= b.max[1] + 1e-6 && eb.max[1] >= b.min[1]) out.push(e);
      }
      return out.sort((a, c) => (a.id < c.id ? -1 : 1));
    }
    const standOn = (e, top) => { const eb = boxOf(rt, e), d = top - eb.min[1]; if (d) rt.space(e.space).setPos(e, add(rt.space(e.space).pos(e), [0, d, 0]).slice(0, e.at.length), rt); };
    const carry = (m, delta) => {
      if (!delta.some(Boolean)) return;
      const b = boxM(m);
      for (const e of touchingLoose(m)) {
        const eb = boxOf(rt, e); if (Math.abs(eb.min[1] - (b.max[1] - delta[1])) >= 0.05) continue;
        rt.space(e.space).setPos(e, add(rt.space(e.space).pos(e), delta).slice(0, e.at.length), rt);
        standOn(e, b.max[1]); // no drift: riders stay exactly on top
      }
    };
    const movePos = (m, to) => {
      const s = st().m[m.id], from = s.pos, delta = sub(to, from);
      s.pos = v3(to).map(x => +x.toFixed(6));
      const e = rt.entity(entIdOf(m)); if (e) rt.space(e.space).setPos(e, s.pos.slice(0, e.at.length), rt);
      return delta;
    };

    rt.system('physics', rt => {
      init();
      const s = st(), f = rt.state.frame;
      const input = m => { if (!m.opens.length) return null; const vals = m.opens.map(k => (k in s.forced ? s.forced[k] : s.sig[k] ?? s.m[k]?.active ?? false)); const v = m.logic === 'all' ? vals.every(Boolean) : vals.some(Boolean); return m.invert ? !v : v; };
      for (const m of config.mechanisms) {
        const ms = s.m[m.id], inp = input(m);
        switch (m.kind) {
          case 'door': case 'gate':
            if (inp !== null && !ms.breached) { const want = inp && gateOk(m, null); if (want !== ms.active && !(ms.active && m.persist)) setActive(m, want, want ? 'open' : 'closed'); }
            else if (m.kind === 'door' && !m.opens.length && m.hits === 0 && m.gate !== undefined && ms.state === 'closed' && !gateOk(m, null)) ms.state = 'locked';
            else if (ms.state === 'locked' && gateOk(m, null)) ms.state = 'closed';
            break;
          case 'lever':
            if (inp !== null && inp !== ms.active) setActive(m, inp, inp ? 'on' : 'off');
            if (ms.active && ms.until != null && f >= ms.until) { ms.until = null; setActive(m, false, 'off'); }
            break;
          case 'plate': {
            const pressed = touching(m).length > 0;
            if (pressed) { ms.release = null; if (!ms.active) setActive(m, true, 'down', touching(m)[0].id); }
            else if (ms.active && !m.persist) { if (m.sec > 0) { ms.release ??= f + frames(m.sec); if (f >= ms.release) { ms.release = null; setActive(m, false, 'up'); } } else setActive(m, false, 'up'); }
            break;
          }
          case 'breakable': if (inp && ms.state !== 'broken') breakIt(m, null); break;
          case 'trap':
            if (ms.state === 'armed' && (inp || (!m.opens.length && touching(m).length))) fireTrap(m, null);
            else if (ms.state === 'firing' && f >= ms.until) { ms.state = 'cooldown'; ms.until = f + frames(m.cooldown); setActive(m, false, 'cooldown'); }
            else if (ms.state === 'cooldown' && f >= ms.until) ms.state = 'armed';
            break;
          case 'timer':
            if (inp && !ms.lastInput && ms.state !== 'running') { ms.state = 'running'; ms.until = f + frames(m.sec); rt.emit('timer_started', { mechanism: m.id }); }
            ms.lastInput = Boolean(inp);
            if (ms.state === 'running' && f >= ms.until) { rt.emitTyped('timer_done', m.id, { mechanism: m.id }); setActive(m, true, 'done'); if (m.repeat) { ms.state = 'running'; ms.until = f + frames(m.sec); setActive(m, false, 'running'); } }
            break;
          case 'lift': {
            const stops = (m.stops || [m.at]).map(v3);
            if (inp !== null) ms.target = inp ? stops.length - 1 : 0;
            const goal = stops[ms.target], d = sub(goal, ms.pos), dl = len(d), step = m.speed * rt.dt;
            if (dl > 1e-9) { const delta = movePos(m, dl <= step ? goal : add(ms.pos, d.map(x => x / dl * step))); carry(m, delta); ms.state = 'moving'; }
            else if (ms.state !== `stop${ms.target}`) { ms.state = `stop${ms.target}`; setActive(m, ms.target > 0, ms.state); rt.emit('lift_arrived', { mechanism: m.id, stop: ms.target }); }
            break;
          }
          case 'platform': {
            if (ms.state === 'broken' || ms.state === 'gone') break;
            if (m.range > 0 && m.speed > 0) { // port of the climb kit's xOf: centre + range·sin(t·speed/range + phase)
              const base = v3(m.at), to = base.slice(); to[m.axis] = base[m.axis] + m.range * Math.sin((rt.state.time * m.speed) / m.range + m.phase);
              carry(m, movePos(m, to));
            }
            for (const e of landers(m)) {
              if (m.mode === 'breaking') { breakIt(m, e.id); break; }
              standOn(e, boxM(m).max[1]);
              const v = velOf(e); if (m.bounce > 0) v[1] = m.bounce; else { v[1] = 0; (e.components.body ??= {}).grounded = true; } setVel(e, v);
              rt.emit('landed_on', { mechanism: m.id, who: e.id });
              if (m.points) addScore(rt, m.points);
              if (m.mode === 'vanishing') { ms.state = 'gone'; rt.emitTyped('broken', m.id, { mechanism: m.id, who: e.id }); setActive(m, true, 'gone', e.id); }
            }
            break;
          }
          case 'spring':
            for (const e of landers(m)) { standOn(e, boxM(m).max[1]); { const v = velOf(e); v[1] = m.launch; setVel(e, v); } rt.emit('sprung', { mechanism: m.id, who: e.id }); if (m.points) addScore(rt, m.points); ms.t = f; }
            break;
          case 'flipper': {
            const up = Boolean(rt.input.held?.[m.verb] || rt.input.actions?.[m.verb]) || Boolean(inp);
            const was = ms.state === 'up', angle = ms.angle ?? 0, next = Math.max(0, Math.min(1, angle + (up ? 1 : -1) * m.speed * rt.dt));
            ms.angle = +next.toFixed(6);
            if (up && !was) { ms.state = 'up'; rt.emit('flip', { mechanism: m.id }); } else if (!up && was) ms.state = 'down';
            if (up && next > angle) {
              const b = boxM(m), n = norm(m.normal), pivot = b.min[0], length = Math.max(1e-6, b.max[0] - b.min[0]);
              for (const e of touching(m)) { const u = Math.min(1, Math.abs(center(rt, e)[0] - pivot) / length); setVel(e, add(velOf(e).map(x => x * 0.2), n.map(x => x * m.kick * (0.5 + 0.5 * u)))); rt.emit('kicked', { mechanism: m.id, who: e.id }); }
            }
            break;
          }
          case 'bumper': case 'kicker': case 'drop_target': case 'rollover': case 'ramp': {
            const now = new Set(touching(m).map(e => e.id)), before = new Set(s.contact[m.id] || []);
            for (const id of now) {
              if (before.has(id)) continue;
              const e = rt.entity(id), c = center(rt, e), bc = boxM(m), mc = bc.min.map((x, i) => (x + bc.max[i]) / 2);
              if (m.kind === 'bumper') {
                const dir = norm(sub(c, mc)); setVel(e, dir.map(x => x * m.kick)); ms.hits = (ms.hits || 0) + 1;
                rt.emit('bumper', { mechanism: m.id, who: id }); rt.emitTyped('triggered', m.id, { mechanism: m.id, kind: m.kind, who: id }); if (m.points) addScore(rt, m.points);
                if (m.signal) ms.pulse = f;
              } else if (m.kind === 'kicker') {
                const n = norm(m.normal);
                if (speedOf(e) >= m.minSpeed && dot(sub(c, mc), n) > 0) { setVel(e, add(n.map(x => x * m.kick), [0, m.lift, 0])); rt.emit('kicked', { mechanism: m.id, who: id }); rt.emitTyped('triggered', m.id, { mechanism: m.id, kind: m.kind, who: id }); if (m.points) addScore(rt, m.points); }
              } else if (m.kind === 'drop_target') {
                if (ms.active) continue;
                const n = norm(m.normal), v = velOf(e), vn = dot(v, n); if (vn < 0) setVel(e, v.map((x, i) => x - 2 * vn * (n[i] ?? 0)));
                writeCells(m, false); setActive(m, true, 'down', id); groupCheck(m.group);
              } else if (m.kind === 'rollover') {
                if (!ms.active) { setActive(m, true, 'lit', id); rt.emit('rollover', { mechanism: m.id, who: id, lit: true }); groupCheck(m.group); }
                else { rt.emit('rollover', { mechanism: m.id, who: id, lit: false }); addScore(rt, Math.round(m.points / 10)); }
              } else if (m.kind === 'ramp') {
                const v = velOf(e); if (dot(v, norm(m.dir)) < m.minSpeed) continue;
                const combo = ms.last != null && (f - ms.last) * rt.dt < m.comboSec; ms.last = f;
                s.rides.push({ who: id, ramp: m.id, t: 0, n: frames(m.sec || 1) });
                setVel(e, v.map(() => 0));
                rt.emit('ramp', { mechanism: m.id, who: id, combo }); if (combo) rt.emit('ramp_combo', { mechanism: m.id, who: id });
                rt.emitTyped('triggered', m.id, { mechanism: m.id, kind: m.kind, who: id }); if (m.points) addScore(rt, m.points * (combo ? 2 : 1));
              }
            }
            s.contact[m.id] = [...now].sort();
            break;
          }
          case 'plunger': {
            const held = Boolean(rt.input.held?.[m.verb] || rt.input.actions?.[m.verb]);
            if (held) { ms.charge = Math.min(1, (ms.charge ?? 0) + m.charge * rt.dt); ms.state = 'pulling'; }
            else if (ms.state === 'pulling') {
              const [base, extra] = m.power, sp = base + extra * (ms.charge ?? 0), d = norm(m.dir);
              for (const e of touching(m)) { setVel(e, d.map(x => x * sp)); rt.emit('launched', { mechanism: m.id, who: e.id, power: +(ms.charge ?? 0).toFixed(4) }); }
              ms.charge = 0; ms.state = 'idle';
            }
            break;
          }
          default: break;
        }
      }
      // Ramp rides: carried along the path, then released at the exit.
      for (const r of s.rides) {
        const m = defs.get(r.ramp), e = rt.entity(r.who); if (!e) { r.done = true; continue; }
        r.t++;
        const path = m.path.map(v3), k = Math.min(1, r.t / r.n) * (path.length - 1), i = Math.min(path.length - 2, Math.floor(k)), u = k - i;
        const p = path[i].map((x, j) => x + (path[i + 1][j] - x) * u);
        if (r.t >= r.n) { rt.space(e.space).setPos(e, posForMin(rt, e, sub(v3(m.exit ?? path[path.length - 1]), [0, 0, 0])).slice(0, e.at.length), rt); setVel(e, m.exitVel); r.done = true; rt.emit('ramp_exit', { mechanism: m.id, who: e.id }); }
        else { rt.space(e.space).setPos(e, posForMin(rt, e, p).slice(0, e.at.length), rt); setVel(e, velOf(e).map(() => 0)); }
      }
      s.rides = s.rides.filter(r => !r.done);
      // Group resets (drop-target banks rise again, rollovers go dark).
      for (const [gid, gs] of Object.entries(s.groups)) if (gs.resetAt != null && f >= gs.resetAt) {
        gs.resetAt = null;
        for (const m of config.mechanisms.filter(x => x.group === gid)) set(m.id, m.kind === 'drop_target' ? 'up' : 'off');
      }
      // Signals: driven by active mechanisms (bumper hits pulse for one step), or forced by the signal effect.
      const sig = {};
      for (const m of config.mechanisms) if (m.signal) sig[m.signal] = Boolean(sig[m.signal] || s.m[m.id].active || s.m[m.id].pulse === f);
      for (const [k, v] of Object.entries(s.forced)) sig[k] = v;
      s.sig = sig;
    }, KEY);
    rt.system('late', rt => {
      const s = st(), prev = {};
      for (const e of Object.values(rt.state.entities)) if (isVec(e.at) && !e.components.mechanism) prev[e.id] = +boxOf(rt, e).min[1].toFixed(6);
      s.prev = prev;
    }, KEY);
    rt.caches.mechanisms = { use, set, hit: (id, n, at, who) => hit(id, n, at, who), force: (k, on) => { st().forced[k] = on; } };
    rt.provide('mechanisms', {
      state: id => { const m = rt.state.prim[KEY]?.m?.[id]; return m ? { state: m.state, active: m.active, hits: m.hits ?? 0 } : null; },
      signal: k => Boolean(rt.state.prim[KEY]?.sig?.[k]),
      solidAt: (id, at) => solidAt(id, at),
      box: id => (defs.has(id) ? boxM(defs.get(id)) : null),
      cells: id => (rt.state.prim[KEY]?.m?.[id]?.cells ? [...rt.state.prim[KEY].m[id].cells] : null),
    });
  },
};
