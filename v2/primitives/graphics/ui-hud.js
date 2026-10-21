// graphics.ui.hud: the heads-up display for any game, declaratively bound to
// vars, items and the documented state of other primitives: meters (hp, any
// res.<pool>), counters (vars or items; hearts/masks as icons), score, lives,
// wanted stars, interact prompt, compass, clock, status icons, boss bar,
// combo/chain popups, crosshair, tracked objective, toasts and zone titles.
// hudModel() is the pure view model; install() renders it and animates changes.
import { THEMES, resolveTheme } from './ui-theme.js';
import { tellsOf, tellWords, uiHost, later, setText, setStyle, setClass, setHidden, keyed, fill, pulse, clamp, isNum, fmtInt, fmtHour, fmtClock, titleCase, itemName, zoneName, docItem, docSystem, docZone } from './ui-lib.js';
import { icon, itemIcon } from './ui-icons.js';
import { glyph } from './ui-input.js';
import * as S from './ui-sources.js';
import { spaceGeometry, heading, bearing } from './ui-spatial.js';
import { entityPos } from './ui-cartography.js';
import { sideOf } from './allegiance.js';
import { declaredDenials, deniesPlayer } from '../engine/runtime-lib-controls.js';

export const POSITIONS = ['top-left', 'top-center', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom-center', 'bottom-right'];
const pos = (d = 'top-left') => ({ type: 'string', default: d, options: POSITIONS, effect: 'screen anchor' });

const card = {
  intent: 'Heads-up display bound declaratively to game state: meters for hp and resource pools, counters for vars or items (hearts as icons), score, lives, wanted stars, interact prompt, compass, clock, status icons, boss bar, combo popups, crosshair, tracked objective, notifications and zone titles.',
  // Says why a press was refused: the denials the document's primitives declare (card.denials), as toasts.
  feedback: { denials: true },
  views: ['any'],
  params: {
    style: { type: 'string', default: 'auto', options: ['auto', ...THEMES], effect: 'visual theme; auto follows the game look' },
    auto: { type: 'boolean', default: true, effect: 'also show well-known vars that appear (hp, score, lives, boss) when not configured' },
    meters: { type: 'list', default: [], of: { type: 'object', fields: {
      pool: { type: 'string', effect: "'hp' or a gameplay.resource pool id (reads res.<pool> and res.<pool>.max)" },
      var: { type: 'string', effect: 'explicit var to show instead of a pool' },
      max: { type: 'json', effect: 'max as a number or a var name (default <var>.max)' },
      label: { type: 'string' }, color: { type: 'string', default: '' }, icon: { type: 'string' },
      pos: pos('top-left'), style: { type: 'string', default: 'bar', options: ['bar', 'pips'], effect: 'continuous bar or one pip per point' },
      low: { type: 'number', default: 0.25, min: 0, max: 1, effect: 'fraction under which the meter pulses' },
    } }, effect: 'bars bound to pools or vars' },
    counters: { type: 'list', default: [], of: { type: 'object', fields: {
      var: { type: 'string' }, item: { type: 'ref', to: 'item' }, icon: { type: 'string' }, label: { type: 'string' },
      max: { type: 'json', effect: 'max as a number or var name (enables icon rows)' },
      pos: pos('top-right'), style: { type: 'string', default: 'auto', options: ['auto', 'number', 'icons'], effect: 'auto: icon row when the max is small (hearts), else a number' },
    } }, effect: 'numbers or icon rows bound to vars or inventory items' },
    score: { type: 'object', default: null, fields: { var: { type: 'string', default: 'score' }, label: { type: 'string', default: 'Score' }, pos: pos('top-center') }, effect: 'big score readout' },
    lives: { type: 'object', default: null, fields: { var: { type: 'string', default: 'lives' }, icon: { type: 'string', default: 'heart' }, pos: pos('top-left') }, effect: 'lives as icons' },
    stars: { type: 'object', default: null, fields: { var: { type: 'string', default: 'wanted' }, max: { type: 'integer', default: 5, min: 1, max: 10 }, icon: { type: 'string', default: 'star' }, pos: pos('top-right') }, effect: 'wanted-level style stars' },
    readouts: { type: 'list', default: [], of: { type: 'object', fields: {
      var: { type: 'string', required: true }, label: { type: 'string' }, pos: pos('top-center'),
      format: { type: 'string', default: 'number', options: ['number', 'clock', 'percent', 'ordinal', 'speed'], effect: 'how the value is written' },
      max: { type: 'json', effect: 'optional max (number or var) shown as value/max' },
    } }, effect: 'labelled values: timers, laps, positions, speed, moves' },
    goals: { type: 'list', default: [], of: { type: 'object', fields: {
      end: { type: 'string', options: ['win', 'lose'], effect: 'the loop end this quantity is what a person watches for' },
      use: { type: 'string', effect: 'the primitive whose loop end it is' },
      var: { type: 'string', effect: "a var (a name ending in '.*': the scoreboard of its per-team vars)" },
      count: { type: 'string', effect: 'an event, shown as how many times it happened' },
      component: { type: 'string', effect: 'a component of entities, shown for the entities `of` names' },
      of: { type: 'string', options: ['opponents', 'player'], default: 'opponents' },
      bar: { type: 'string', options: ['boss'], effect: 'a bar widget that shows it (the boss bar)' },
      max: { type: 'json', effect: 'the target: a number or a var name' },
      label: { type: 'string' }, pos: pos('top-right'),
    } }, effect: 'the quantities the loops\' win and lose read (ui-defaults.js hudGoals, from card.loop win/lose reads)' },
    prompt: { type: 'boolean', default: true, effect: 'contextual interact prompt with the device glyph' },
    compass: { type: 'boolean', default: false, effect: 'heading strip with the tracked objective marker' },
    clock: { type: 'boolean', default: false, effect: 'time of day and day count (engine.time vars)' },
    status: { type: 'boolean', default: true, effect: 'status effect icons with time left' },
    bossBar: { type: 'boolean', default: true, effect: 'boss name and health bar while a boss fight runs' },
    combo: { type: 'boolean', default: true, effect: 'combo / chain counter popups' },
    objective: { type: 'boolean', default: true, effect: 'tracked quest objective line' },
    toasts: { type: 'boolean', default: true, effect: 'notifications: notify effect, quests, items, level ups' },
    zoneTitles: { type: 'string', default: 'first', options: ['off', 'first', 'always'], effect: 'zone name banner on entering a zone' },
    damageNumbers: { type: 'boolean', default: true, effect: 'floating damage/heal numbers (needs a renderer camera service with project())' },
    crosshair: { type: 'string', default: 'none', options: ['none', 'dot', 'cross'], effect: 'aim reticle' },
    comboWindow: { type: 'number', default: 1.2, min: 0.2, max: 5, unit: 's', effect: 'time between hits that keeps a combo going' },
  },
  requires: { primitives: [] },
  reads: ['content.items', 'content.statuses', 'plot.quests'],
};

/** Meter/counter source vars and max. */
export function meterVars(m) {
  const v = m.var || (m.pool === 'hp' || m.pool === 'health' ? 'hp' : m.pool ? `res.${m.pool}` : null);
  return { value: v, max: typeof m.max === 'string' ? m.max : (isNum(m.max) ? m.max : v ? `${v}.max` : null) };
}
function maxOf(rt, maxRef, fallbackVar) {
  if (isNum(maxRef)) return maxRef;
  const v = typeof maxRef === 'string' ? rt.state.vars[maxRef] : undefined;
  if (isNum(v)) return v;
  // Archetype defaults: components.health.max, components.resources[pool].max.
  const p = rt.player(); if (!p) return null;
  if (fallbackVar === 'hp') return S.health(p)?.max ?? null;
  if (fallbackVar?.startsWith('res.')) return p.components?.resources?.[fallbackVar.slice(4)]?.max ?? null;
  return null;
}
const DEFAULT_COLORS = { hp: '#ff5d6c', stamina: '#7ac060', mana: '#5aa8ff', focus: '#5a9ae0', hunger: '#d8a030', flame: '#ffb347', oxygen: '#7ad8ff', fuel: '#c8a060', soul: '#e8e4ff' };
const poolColor = (id, explicit) => explicit || DEFAULT_COLORS[id] || ['#7ac060', '#5aa8ff', '#d8a030', '#c06cff', '#3ad0e8'][[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % 5];

/** How to draw a counter with a max: icons (one per point or per two) or a number. */
export function counterDisplay(style, max) {
  if (style === 'number' || !isNum(max) || max <= 0) return { kind: 'number' };
  if (style === 'icons' || max <= 12) return { kind: 'icons', per: 1, slots: Math.ceil(max) };
  if (max <= 40) return { kind: 'icons', per: 2, slots: Math.ceil(max / 2) };
  return { kind: 'number' };
}
/** Fill fraction (0, 0.5, 1 …) of each icon slot. */
export const iconFills = (value, per, slots) => Array.from({ length: slots }, (_, i) => clamp((value - i * per) / per, 0, 1));

/** Vars other primitives publish that the HUD shows by itself when auto is on (catalog/var conventions). */
export const AUTO_READOUTS = [
  { var: 'round.timer', label: 'Time', format: 'clock', pos: 'top-center' }, { var: 'round', label: 'Round', format: 'number', pos: 'top-center' },
  { var: 'race.position', label: 'Pos', format: 'ordinal', pos: 'top-right' }, { var: 'race.lap', label: 'Lap', format: 'number', pos: 'top-right', max: 'race.laps' },
  { var: 'race.time', label: 'Time', format: 'clock', pos: 'top-right' }, { var: 'vehicle.speed', label: 'km/h', format: 'speed', pos: 'bottom-right' },
  { var: 'stage.number', label: 'Stage', format: 'number', pos: 'top-center' }, { var: 'stage.moves', label: 'Moves', format: 'number', pos: 'top-right' },
  { var: 'stage.time', label: 'Time', format: 'clock', pos: 'top-right' }, { var: 'wave', label: 'Wave', format: 'number', pos: 'top-center' },
  { var: 'level', label: 'Level', format: 'number', pos: 'top-left' }, { var: 'minigame.progress', label: 'Progress', format: 'percent', pos: 'top-center' },
];
const ordinal = n => { const v = Math.round(n), s = ['th', 'st', 'nd', 'rd'], m = v % 100; return `${v}${s[(m - 20) % 10] || s[m] || s[0]}`; };
export function formatReadout(value, format) {
  if (format === 'clock') return fmtClock(value);
  if (format === 'percent') return `${Math.round(value <= 1 ? value * 100 : value)}%`;
  if (format === 'ordinal') return ordinal(value);
  if (format === 'speed') return fmtInt(Math.abs(value));
  return fmtInt(value);
}
/** Readouts to show: configured ones, then auto ones whose vars exist and are not already shown elsewhere. */
export function readoutsFor(rt, config) {
  const vars = rt.state.vars, shown = new Set([...config.meters.map(m => meterVars(m).value), ...config.counters.map(c => c.var), config.score?.var, config.lives?.var, config.stars?.var]);
  const list = [...config.readouts, ...(config.auto ? AUTO_READOUTS.filter(a => !config.readouts.some(r => r.var === a.var)) : [])];
  return list.filter(r => isNum(vars[r.var]) && !shown.has(r.var)).map(r => { const max = isNum(r.max) ? r.max : typeof r.max === 'string' ? vars[r.max] : undefined; return { key: `r:${r.var}`, var: r.var, label: r.label ?? titleCase(r.var.split('.').pop()), text: formatReadout(vars[r.var], r.format) + (isNum(max) ? `/${fmtInt(max)}` : ''), pos: r.pos || 'top-center', format: r.format || 'number', low: r.format === 'clock' && vars[r.var] <= 10 }; });
}

/**
 * The HUD view model: everything the HUD shows for this state. `local` holds
 * UI-only memory fed by events (prompt fallback, boss name, combo).
 */
export function hudModel(rt, config, local = {}) {
  const vars = rt.state.vars, player = rt.player();
  const out = { meters: [], counters: [], score: null, lives: null, stars: null, prompt: null, boss: null, status: [], clock: null, compass: null, objective: null, crosshair: config.crosshair };
  const bound = new Set();
  for (const [i, m] of config.meters.entries()) {
    const ref = meterVars(m), value = vars[ref.value];
    if (ref.value) bound.add(ref.value);
    if (!isNum(value)) continue;
    const max = maxOf(rt, ref.max, ref.value) ?? Math.max(value, 1);
    const id = m.pool || ref.value;
    out.meters.push({ key: `m${i}`, id, label: m.label ?? titleCase(id === 'hp' ? 'health' : id), value, max, frac: clamp(value / (max || 1), 0, 1), color: poolColor(id, m.color), pos: m.pos, style: m.style, low: value / (max || 1) <= m.low, icon: m.icon });
  }
  for (const [i, c] of config.counters.entries()) {
    let value, max = null, ic;
    if (c.item) { value = S.bag(rt)[c.item] || 0; ic = c.icon ? { name: c.icon } : itemIcon(docItem(rt.doc, c.item)); }
    else { value = vars[c.var]; bound.add(c.var); if (!isNum(value)) continue; max = c.max !== undefined ? maxOf(rt, c.max, c.var) : maxOf(rt, `${c.var}.max`, c.var); ic = { name: c.icon || c.var }; }
    const display = counterDisplay(c.style, max);
    out.counters.push({ key: `c${i}`, value, max, icon: ic, label: c.label ?? (c.item ? itemName(rt.doc, c.item) : titleCase(c.var)), pos: c.pos, display, fills: display.kind === 'icons' ? iconFills(value, display.per, display.slots) : null });
  }
  if (config.auto && isNum(vars.hp) && !bound.has('hp')) {
    const max = maxOf(rt, 'hp.max', 'hp'), display = counterDisplay('auto', max);
    if (display.kind === 'icons') out.counters.push({ key: 'auto-hp', value: vars.hp, max, icon: { name: 'heart' }, label: 'Health', pos: 'top-left', display, fills: iconFills(vars.hp, display.per, display.slots) });
    else out.meters.push({ key: 'auto-hp', id: 'hp', label: 'Health', value: vars.hp, max: max ?? vars.hp, frac: clamp(vars.hp / (max || vars.hp || 1), 0, 1), color: DEFAULT_COLORS.hp, pos: 'top-left', style: 'bar', low: vars.hp / (max || 1) <= 0.25 });
  }
  const sc = config.score || (config.auto && isNum(vars.score) ? { var: 'score', label: 'Score', pos: 'top-center' } : null);
  if (sc && isNum(vars[sc.var])) out.score = { value: vars[sc.var], label: sc.label, pos: sc.pos, best: vars[`${sc.var}.best`] };
  const lv = config.lives || (config.auto && isNum(vars.lives) ? { var: 'lives', icon: 'heart', pos: 'top-left' } : null);
  if (lv && isNum(vars[lv.var])) out.lives = { value: vars[lv.var], icon: lv.icon, pos: lv.pos };
  out.readouts = readoutsFor(rt, config);
  const teams = Object.keys(vars).filter(k => /^score\.[^.]+$/.test(k));
  if (config.auto && teams.length >= 2) out.scoreboard = { teams: teams.slice(0, 2).map(k => ({ id: k.slice(6), name: titleCase(k.slice(6)), value: vars[k] })), clock: isNum(vars['match.clock']) ? fmtClock(vars['match.clock']) : null, period: vars['match.period'] ?? null };
  if (config.stars && isNum(vars[config.stars.var] ?? 0)) out.stars = { value: clamp(Math.round(vars[config.stars.var] ?? 0), 0, config.stars.max), max: config.stars.max, icon: config.stars.icon, pos: config.stars.pos };
  if (config.prompt) {
    const f = S.interactFocus(rt, 'player', local.focus || null);
    if (f && (f.label || f.target)) out.prompt = { label: f.label || `Use ${titleCase(f.target)}`, verb: f.verb || 'interact', hold: isNum(f.hold) ? clamp(f.hold, 0, 1) : null, kind: f.kind || null };
  }
  if (config.bossBar) {
    const b = S.boss(rt);
    if (b && b.hp > 0) {
      const def = docSystem(rt.doc, 'gameplay.combat.boss')?.with?.bosses?.find(x => x.id === b.id);
      const arch = def && rt.doc.content?.archetypes?.find(a => a.id === def.archetype);
      out.boss = { id: b.id, name: local.bossNames?.[b.id] || arch?.name || def?.name || titleCase(def?.archetype || b.id || 'Boss'), frac: clamp(b.hp / b.max, 0, 1), phase: b.phase, notches: (def?.phases || []).map(p => p.at).filter(a => a > 0 && a < 1) };
    }
  }
  if (config.status && player) {
    const defs = rt.doc.content?.statuses || [];
    out.status = S.statuses(rt, player).map(s => { const d = defs.find(x => x.id === s.id); const dur = d?.duration; return { id: s.id, name: d?.name || titleCase(s.id), icon: d?.icon || s.id, remaining: s.remaining, frac: isNum(dur) && dur > 0 && isNum(s.remaining) ? clamp(s.remaining / dur, 0, 1) : 1, stacks: s.stacks || 1, good: (s.tags || d?.tags || []).includes('buff') }; });
  }
  if (config.clock && isNum(vars['time.hour'])) {
    const hr = vars['time.hour'];
    out.clock = { hour: hr, text: fmtHour(hr), day: vars['time.day'] ?? null, season: vars['time.season'] ?? null, phase: vars['time.phase'] ?? (hr >= 6 && hr < 18 ? 'day' : 'night'), night: hr < 6 || hr >= 19 };
  }
  const q = config.objective || config.compass ? S.trackedQuest(S.quests(rt)) : null;
  if (config.objective && q) {
    const open = (q.objectives || []).filter(x => x.state !== 'done' && x.state !== 'failed' && !x.hidden);
    const o = open.find(x => x.state === 'active' && !x.optional) || open.find(x => !x.optional) || open[0] || null;
    if (o) out.objective = { quest: q.id, title: q.title || titleCase(q.id), text: o.text || titleCase(o.id), progress: S.objectiveProgress(o), zone: o.zone || null };
  }
  if (config.compass && player?.space) {
    const space = rt.doc.spaces.find(s => s.id === player.space);
    const geo = local.geometry?.(space) || spaceGeometry(space);
    if (!geo.graph) {
      const here = entityPos(rt, player, geo), hdg = heading(player, geo.plane) ?? 0;
      const markers = [];
      const target = q && (q.objectives || []).find(x => x.state !== 'done' && x.zone)?.zone;
      const tz = target && geo.zones.find(z => z.id === target);
      if (tz && here) markers.push({ kind: 'quest', bearing: bearing(here, tz.center), icon: 'quest', dist: Math.hypot(tz.center[0] - here[0], tz.center[1] - here[1]) });
      out.compass = { heading: hdg, markers };
    }
  }
  out.goals = goalsFor(rt, config, out, bound, local);
  return out;
}

const countOf = (rt, name) => { const c = rt.state.counts || {}; if (c[name] !== undefined) return c[name]; let n = 0; for (const k in c) if (k.startsWith(name + ':')) n += c[k]; return n; };
const deadOf = e => { const h = e.components?.health; return Boolean(h && (h.dead || (isNum(h.hp) && h.hp <= 0))); };
/**
 * The loops' goal quantities (config.goals): each is shown as a readout, meter or bar of the model unless another
 * widget already binds it. Returns [{ ...goal, shown }]: shown is whether the HUD shows it now.
 */
export function goalsFor(rt, config, out, bound = new Set(), local = {}) {
  const vars = rt.state.vars, res = [];
  const valueShown = v => bound.has(v) || out.score?.value !== undefined && (config.score?.var ?? 'score') === v || (out.lives && (config.lives?.var ?? 'lives') === v) || out.readouts.some(r => r.var === v);
  const maxOf2 = m => (isNum(m) ? m : typeof m === 'string' && isNum(vars[m]) ? vars[m] : null);
  for (const [i, g] of (config.goals || []).entries()) {
    const key = `g${i}`, pos = g.pos || 'top-right';
    if (g.var && g.var.endsWith('.*')) { res.push({ ...g, shown: Boolean(out.scoreboard) }); continue; }
    if (g.var || g.count) {
      // An absent var is 0, as the kernel's var predicate reads it (the win tests it from 0).
      const v = g.var ? vars[g.var] ?? 0 : countOf(rt, g.count);
      if (g.var && valueShown(g.var)) { res.push({ ...g, shown: true }); continue; }
      if (!isNum(v)) { res.push({ ...g, shown: false }); continue; }
      const max = maxOf2(g.max);
      out.readouts.push({ key, var: g.var || `count:${g.count}`, label: titleCase(g.label ?? String(g.var || g.count).split('.').pop().replace(/:/g, ' ')), text: fmtInt(v) + (isNum(max) ? `/${fmtInt(max)}` : ''), pos, format: 'number', low: false });
      res.push({ ...g, shown: true }); continue;
    }
    if (g.bar === 'boss') { res.push({ ...g, shown: Boolean(config.bossBar) }); continue; }
    if (g.component) {
      if ((g.of || 'opponents') === 'player') {
        const p = rt.player(), h = p?.components?.[g.component];
        if (g.component === 'health' && (bound.has('hp') || out.meters.some(m => m.id === 'hp') || out.counters.some(c => c.key === 'auto-hp'))) { res.push({ ...g, shown: true }); continue; }
        if (h && isNum(h.hp)) { out.meters.push({ key, id: g.component, label: g.label ?? 'Health', value: h.hp, max: h.max ?? h.hp, frac: clamp(h.hp / (h.max || h.hp || 1), 0, 1), color: DEFAULT_COLORS.hp, pos: 'top-left', style: 'bar', low: h.hp / (h.max || 1) <= 0.25 }); res.push({ ...g, shown: true }); continue; }
        res.push({ ...g, shown: false }); continue;
      }
      // The opponents a win counts: entities carrying the component that are not the player's or on its side (allegiance.js).
      const foes = Object.values(rt.state.entities).filter(e => e.id !== 'player' && e.components?.[g.component] !== undefined && !sideOf(rt, e)?.mine).sort((a, b) => (a.id < b.id ? -1 : 1));
      const seen = (local.foes ??= new Set()); for (const e of foes) seen.add(e.id);
      const alive = foes.filter(e => !deadOf(e));
      if (g.component === 'health' && alive.length >= 1 && alive.length <= 3 && seen.size <= 3) for (const e of alive) {
        const h = e.components.health, max = h.max ?? h.hp ?? 1, hp = h.hp ?? max;
        out.meters.push({ key: `${key}:${e.id}`, id: e.id, label: S.entityName(rt, e.id), value: hp, max, frac: clamp(hp / (max || 1), 0, 1), color: '#e8404a', pos, style: 'bar', low: hp / (max || 1) <= 0.25 });
      }
      else out.readouts.push({ key, var: `foes:${g.component}`, label: g.label ?? 'Foes', text: `${fmtInt(alive.length)}/${fmtInt(seen.size)}`, pos, format: 'number', low: false });
      res.push({ ...g, shown: true }); continue;
    }
    res.push({ ...g, shown: false });
  }
  return res;
}

export default {
  id: 'graphics.ui.hud',
  card,
  validate(config) {
    const errors = [];
    config.meters?.forEach((m, i) => { if (!m.pool && !m.var) errors.push({ code: 'ui_meter_unbound', path: `with.meters[${i}]`, message: 'a meter needs a pool or a var', hint: "e.g. { pool: 'stamina' } or { var: 'hp' }" }); });
    config.counters?.forEach((c, i) => { if (!c.var && !c.item) errors.push({ code: 'ui_counter_unbound', path: `with.counters[${i}]`, message: 'a counter needs a var or an item' }); });
    return errors;
  },
  install(rt, config) {
    const host = uiHost(rt); if (!host) return;
    const el = host.el, layer = host.layer('hud');
    const root = el('div.gv-hud', { attrs: { 'data-theme': resolveTheme(rt.doc, config.style), 'aria-hidden': 'false' } });
    layer.append(root);
    const anchors = Object.fromEntries(POSITIONS.map(p => { const a = el('div.gv-anchor', { data: { pos: p } }); root.append(a); return [p, a]; }));
    const prompt = el('div.gv-prompt', { role: 'status' }, el('span.gv-kbd', {}, el('span.gv-prompt-ring'), el('span.gv-prompt-key')), el('span.gv-prompt-label'));
    const boss = el('div.gv-boss', { role: 'status' }, el('div.gv-boss-name', {}, el('span.gv-boss-title'), el('span.gv-boss-phase')), el('div.gv-meter-track', {}, el('div.gv-meter-chip'), el('div.gv-meter-fill', { style: { '--fill': '#e8404a' } })));
    const combo = el('div.gv-combo', {}, el('div.gv-combo-count'), el('div.gv-combo-label'), el('div.gv-combo-bar'));
    const cross = el('div.gv-crosshair', { data: { kind: config.crosshair } }, el('i'), el('i'), el('i'), el('i'));
    const toasts = el('div.gv-toasts', { aria: { live: 'polite' } });
    const banner = el('div.gv-banner');
    const floaters = el('div.gv-floaters');
    root.append(prompt, boss, combo, toasts, banner, floaters);
    if (config.crosshair !== 'none') root.append(cross);
    const nodes = new Map(); // widget key -> element
    const local = { focus: null, bossNames: {}, combo: { count: 0, at: -1, label: 'hits' }, seenZones: new Set(), geoCache: new Map() };
    local.geometry = space => { if (!local.geoCache.has(space?.id) || local.geoCache.get(space?.id).doc !== rt.doc) local.geoCache.set(space?.id, { doc: rt.doc, geo: spaceGeometry(space) }); return local.geoCache.get(space?.id).geo; };

    // ---------------------------------------------------------- events -> local presentation memory
    rt.on('interact_focus', e => { local.focus = { target: e.target, label: e.label, verb: e.verb, hold: e.hold }; });
    rt.on('interact_blur', () => { local.focus = null; });
    rt.on('boss_start', e => { const t = e.title ?? e.name; if (e.boss && t) local.bossNames[e.boss] = t; pulse(boss, 'is-intro'); }); // display names travel as `title` (a `name` key would clobber the event name)
    const comboShow = (count, label) => { local.combo = { count, at: rt.state.time, label }; setText(combo.children[0], count); setText(combo.children[1], label); pulse(combo.children[0], 'is-pop'); };
    if (config.combo) {
      rt.on('combo', e => { if (e.by === 'player' || e.by === undefined) comboShow(e.count, 'combo'); });
      rt.on('chain', e => comboShow(`×${e.mult ?? e.chain}`, e.points ? `chain +${fmtInt(e.points)}` : 'chain'));
      rt.on('hit', e => {
        if (e.by !== 'player') return;
        const c = local.combo, t = rt.state.time;
        const n = t - c.at <= config.comboWindow && c.label === 'hits' ? c.count + 1 : 1;
        local.combo = { count: n, at: t, label: 'hits' };
        if (n >= 2) comboShow(n, 'hits');
      });
    }
    if (config.crosshair !== 'none') for (const ev of ['fired', 'attack_started']) rt.on(ev, e => { if ((e.by ?? e.who ?? 'player') === 'player') pulse(cross, 'is-fire'); });

    // Toasts: aggregated per key, at most 4 visible.
    const live = [];
    const toast = ({ key, kind = 'info', kicker, text, iconName, iconColor, count }) => {
      if (!config.toasts) return;
      const now = host.now();
      const same = key && live.find(t => t.key === key && now - t.at < 2.5);
      if (same) { same.count += count || 1; same.at = now; setText(same.countEl, `×${same.count}`); pulse(same.el, 'is-pop'); clearTimeout(same.timer); same.timer = later(() => drop(same), 3200); return; }
      const countEl = el('span.gv-toast-count', { text: count > 1 ? `×${count}` : '' });
      const node = el('div.gv-toast.gv-panel', { data: { kind } }, iconName ? icon(iconName, { color: iconColor }) : null, el('div', {}, kicker ? el('span.gv-toast-kicker', { text: kicker }) : null, el('span', { text })), countEl);
      const t = { key, el: node, countEl, count: count || 1, at: now };
      t.timer = later(() => drop(t), 3600);
      live.push(t); toasts.append(node);
      while (live.length > 4) drop(live[0]);
    };
    const drop = t => { const i = live.indexOf(t); if (i < 0) return; live.splice(i, 1); clearTimeout(t.timer); t.el.classList.add('is-out'); later(() => t.el.remove(), 420); };
    const qTitle = id => rt.doc.plot?.quests?.find(q => q.id === id)?.title || titleCase(id);
    host.on('notify', e => toast({ kind: e.kind || 'info', text: e.text, iconName: e.icon || 'check' }));
    rt.on('notify', e => toast({ kind: e.kind, text: e.text, iconName: e.kind === 'warn' ? 'skull' : e.kind === 'quest' ? 'quest' : null }));
    // What the document's primitives declare their events tell a person (card.tells), as notices: the same declaration
    // the story log reads. An event naming who it happened to (`who`) is told only when that is the player.
    for (const t of tellsOf(rt.doc, rt.registry)) rt.on(t.event, e => {
      if (e?.who !== undefined && e.who !== 'player') return;
      const w = tellWords(rt.doc, t, e), id = t.entry ? e?.[t.entry.by] : null;
      toast({ key: `${t.event}:${id ?? ''}`, kind: 'info', kicker: w.title ? w.label : '', text: w.title || w.label, count: Number.isFinite(e?.count) ? e.count : 1 });
    });
    rt.on('gate_blocked', e => { if ((e.who ?? 'player') === 'player' && e.hint) toast({ key: `gate:${e.gate}`, kind: 'warn', text: e.hint, iconName: 'lock' }); });
    rt.on('inventory_full', () => toast({ kind: 'warn', text: 'Inventory full', iconName: 'bag' }));
    // Refusals: every event the document's primitives declare as a denial (card.denials) says why a press did nothing.
    for (const ev of declaredDenials(rt.doc, rt.registry)) rt.on(ev, e => { if (deniesPlayer(rt, e)) toast({ key: `denied:${ev}`, kind: 'warn', kicker: titleCase(ev), text: titleCase(e.reason ?? '') || 'Not now', iconName: 'lock' }); });
    rt.on('saved', e => { if (!e.auto) toast({ kind: 'info', text: 'Game saved', iconName: 'book' }); });

    // Zone titles.
    rt.on('enter_zone', e => {
      if (config.zoneTitles === 'off' || (e.who ?? 'player') !== 'player' || !e.zone || rt.state.frame < 1) return;
      const first = !local.seenZones.has(e.zone);
      local.seenZones.add(e.zone);
      if (config.zoneTitles === 'first' && !first) return;
      const z = docZone(rt.doc, e.zone);
      fill(banner, host.el('div.gv-banner-kicker', { text: first ? 'Discovered' : (z?.tags?.[0] ? titleCase(z.tags[0]) : '') }), host.el('div.gv-banner-line'), host.el('div.gv-banner-title', { text: zoneName(rt.doc, e.zone) }), host.el('div.gv-banner-line'));
    });

    // Damage numbers, when a renderer offers screen projection.
    const project2 = (id, at) => S.svc(rt, 'camera', 'projectEntity', id) || S.svc(rt, 'camera', 'project', at);
    if (config.damageNumbers) for (const [ev, cls] of [['damaged', ''], ['healed', 'is-heal']]) rt.on(ev, e => {
      const who = rt.entity(e.who); if (!who || !Array.isArray(who.at)) return;
      const p = project2(who.id, who.at); if (!p) return;
      const f = host.el(`div.gv-floater${cls ? '.' + cls : ''}`, { text: `${ev === 'healed' ? '+' : ''}${fmtInt(e.amount)}`, style: { left: `${p[0]}px`, top: `${p[1]}px`, color: ev === 'damaged' && e.who === 'player' ? 'var(--gv-bad)' : null } });
      floaters.append(f); later(() => f.remove(), 950);
    });
    rt.on('damaged', e => { if (e.who === 'player') for (const n of nodes.values()) if (n.dataset?.var === 'hp') pulse(n, n.classList.contains('gv-meter') ? 'is-hit' : 'is-shake'); });

    // ---------------------------------------------------------- per-frame render
    const prev = {};
    const place = (key, p, make) => { let n = nodes.get(key); if (!n) { n = make(); nodes.set(key, n); anchors[p].append(n); } else if (n.parentNode !== anchors[p]) anchors[p].append(n); return n; };
    const seen = new Set();
    rt.view.onFrame(() => {
      const vm = hudModel(rt, config, local);
      seen.clear();
      for (const m of vm.meters) {
        const n = place(m.key, m.pos, () => m.style === 'pips'
          ? el('div.gv-meter', { data: { var: m.id === 'hp' ? 'hp' : m.id } }, el('span.gv-meter-label'), el('div.gv-meter-pips'), el('span.gv-meter-value'))
          : el('div.gv-meter', { data: { var: m.id === 'hp' ? 'hp' : m.id } }, el('span.gv-meter-label'), el('div.gv-meter-track', {}, el('div.gv-meter-chip'), el('div.gv-meter-fill')), el('span.gv-meter-value')));
        seen.add(m.key);
        setStyle(n, '--fill', m.color);
        setText(n.children[0], m.icon ? '' : m.label);
        if (m.icon && !n.children[0].firstChild) n.children[0].append(icon(m.icon, { color: m.color }));
        if (m.style === 'pips') keyed(n.children[1], [Math.ceil(m.max), Math.round(m.value)], pips => fill(pips, ...Array.from({ length: Math.ceil(m.max) }, (_, i) => el(`i.gv-pip${i < Math.round(m.value) ? '.is-on' : ''}`))));
        else {
          const [chip, bar] = n.children[1].children, before = prev[m.key];
          setClass(n, 'is-gain', isNum(before) && m.frac > before);
          setStyle(bar, 'transform', `scaleX(${m.frac.toFixed(4)})`);
          setStyle(chip, 'transform', `scaleX(${m.frac.toFixed(4)})`);
        }
        prev[m.key] = m.frac;
        setText(n.children[2], `${fmtInt(m.value)}/${fmtInt(m.max)}`);
        setClass(n, 'is-low', m.low && m.value > 0); setClass(n, 'is-empty', m.value <= 0);
      }
      for (const c of vm.counters) {
        if (c.display.kind === 'icons') {
          const n = place(c.key, c.pos, () => el('div.gv-icons', { data: { var: c.key === 'auto-hp' ? 'hp' : '' }, aria: { label: c.label } }));
          seen.add(c.key);
          const old = prev[c.key] || [];
          keyed(n, c.fills.length, () => fill(n, ...c.fills.map(() => el('span.gv-pipicon', {}, icon(c.icon.name, { color: c.icon.color }), icon(c.icon.name, { color: c.icon.color })))));
          c.fills.forEach((f, i) => {
            const slot = n.children[i]; if (!slot) return;
            setStyle(slot, '--f', f);
            if (old.length && f < (old[i] ?? f)) pulse(slot, 'is-lost'); else if (old.length && f > (old[i] ?? f)) pulse(slot, 'is-gained');
          });
          setClass(n, 'is-low', c.value <= c.display.per && c.value > 0);
          n.setAttribute('aria-label', `${c.label} ${c.value} of ${c.max}`);
          prev[c.key] = c.fills;
        } else {
          const n = place(c.key, c.pos, () => el('div.gv-counter', { title: c.label }, icon(c.icon.name, { color: c.icon.color, label: c.label }), el('span.gv-counter-value'), el('span.gv-counter-delta')));
          seen.add(c.key);
          const before = prev[c.key];
          if (isNum(before) && before !== c.value) {
            pulse(n.children[1], 'is-pop');
            const d = n.children[2]; setText(d, `${c.value > before ? '+' : ''}${fmtInt(c.value - before)}`); setClass(d, 'is-neg', c.value < before); d.classList.add('is-on');
            clearTimeout(d._t); d._t = later(() => d.classList.remove('is-on'), 1100);
          }
          setText(n.children[1], fmtInt(c.value));
          prev[c.key] = c.value;
        }
      }
      if (vm.score) {
        const n = place('score', vm.score.pos, () => el('div.gv-score', {}, el('span.gv-score-label'), el('span.gv-score-value.gv-display')));
        seen.add('score'); setText(n.children[0], vm.score.label);
        if (prev.score !== undefined && prev.score !== vm.score.value) pulse(n.children[1], 'is-pop');
        setText(n.children[1], fmtInt(vm.score.value)); prev.score = vm.score.value;
      }
      for (const r of vm.readouts) {
        const n = place(r.key, r.pos, () => el(`div.gv-readout${r.format === 'speed' ? '.is-speed' : ''}`, { data: { var: r.var } }, el('span.gv-readout-label'), el('span.gv-readout-value.gv-display')));
        seen.add(r.key); setText(n.children[0], r.label);
        if (prev[r.key] !== undefined && prev[r.key] !== r.text && r.format !== 'clock' && r.format !== 'speed') pulse(n.children[1], 'is-pop');
        setText(n.children[1], r.text); setClass(n, 'is-low', r.low); prev[r.key] = r.text;
      }
      if (vm.scoreboard) {
        const n = place('scoreboard', 'top-center', () => el('div.gv-scoreboard.gv-panel', {}, el('span.gv-sb-a'), el('b.gv-sb-score.gv-display'), el('span.gv-sb-b'), el('small.gv-sb-clock')));
        seen.add('scoreboard'); const [a, b] = vm.scoreboard.teams;
        setText(n.children[0], a.name); setText(n.children[2], b.name);
        const sig = `${a.value} – ${b.value}`; if (prev.scoreboard && prev.scoreboard !== sig) pulse(n.children[1], 'is-pop'); setText(n.children[1], sig); prev.scoreboard = sig;
        setText(n.children[3], [vm.scoreboard.period ? `P${vm.scoreboard.period}` : '', vm.scoreboard.clock || ''].filter(Boolean).join(' · '));
      }
      if (vm.lives) {
        const n = place('lives', vm.lives.pos, () => el('div.gv-icons.gv-lives'));
        seen.add('lives');
        keyed(n, vm.lives.value, () => fill(n, ...Array.from({ length: Math.min(vm.lives.value, 10) }, () => icon(vm.lives.icon)), vm.lives.value > 10 ? el('b', { text: `×${vm.lives.value}` }) : null));
      }
      if (vm.stars) {
        const n = place('stars', vm.stars.pos, () => el('div.gv-stars', { aria: { label: 'Wanted level' } }, ...Array.from({ length: vm.stars.max }, () => icon(vm.stars.icon))));
        seen.add('stars');
        [...n.children].forEach((s, i) => setClass(s, 'is-on', i < vm.stars.value));
        if (prev.stars !== undefined && prev.stars !== vm.stars.value) { pulse(n, 'is-pop'); }
        setClass(n, 'is-flash', vm.stars.value > 0 && (rt.state.vars['wanted.searching'] || rt.state.vars['wanted.decay'] > 0));
        prev.stars = vm.stars.value;
      }
      if (vm.clock) {
        const n = place('clock', 'top-right', () => el('div.gv-clock', {}, el('span.gv-clock-icon'), el('span.gv-clock-time'), el('span.gv-clock-day')));
        seen.add('clock');
        keyed(n.children[0], vm.clock.night ? 'moon' : 'sun', e => fill(e, icon(vm.clock.night ? 'moon' : 'sun')));
        setText(n.children[1], vm.clock.text);
        setText(n.children[2], [vm.clock.day != null ? `Day ${vm.clock.day}` : '', vm.clock.season ? titleCase(vm.clock.season) : ''].filter(Boolean).join(' · '));
      }
      if (vm.compass) {
        const n = place('compass', 'top-center', () => { const strip = el('div.gv-compass-strip'); for (let d = 0; d < 360; d += 15) strip.append(el(`span.gv-compass-tick${d % 90 === 0 ? '.is-cardinal' : d % 45 === 0 ? '' : '.is-minor'}`, { data: { deg: d }, text: d % 90 === 0 ? 'NESW'[d / 90] : d % 45 === 0 ? ['NE', 'SE', 'SW', 'NW'][(d - 45) / 90] : '' })); return el('div.gv-compass', { aria: { hidden: 'true' } }, strip, el('div.gv-compass-markers')); });
        seen.add('compass');
        const px = 3.2, hd = (vm.compass.heading * 180) / Math.PI;
        const rel = deg => { let d = ((deg - hd + 540) % 360) - 180; return d * px; };
        for (const t of n.children[0].children) setStyle(t, 'left', `${rel(Number(t.getAttribute('data-deg'))).toFixed(1)}px`);
        const marks = n.children[1];
        keyed(marks, vm.compass.markers.map(m => m.kind), () => fill(marks, ...vm.compass.markers.map(m => el('span.gv-compass-marker', {}, icon(m.icon)))));
        vm.compass.markers.forEach((m, i) => marks.children[i] && setStyle(marks.children[i], 'left', `calc(50% + ${rel((m.bearing * 180) / Math.PI).toFixed(1)}px)`));
      }
      if (vm.objective) {
        const n = place('objective', 'top-left', () => el('div.gv-objective', { role: 'status' }, el('div.gv-objective-title'), el('div', {}, el('span.gv-objective-text'), el('span.gv-objective-progress'))));
        seen.add('objective');
        const sig = `${vm.objective.quest}|${vm.objective.text}|${vm.objective.progress}`;
        if (prev.objective && prev.objective !== sig) pulse(n, 'is-updated');
        prev.objective = sig;
        setText(n.children[0], vm.objective.title); setText(n.children[1].children[0], vm.objective.text); setText(n.children[1].children[1], vm.objective.progress);
      }
      if (vm.status.length || nodes.has('status')) {
        const n = place('status', 'top-left', () => el('div.gv-status'));
        seen.add('status');
        keyed(n, vm.status.map(s => `${s.id}:${s.stacks}`), () => fill(n, ...vm.status.map(s => el('div.gv-status-icon', { title: s.name, data: { status: s.id } }, icon(s.icon, { label: s.name }), s.stacks > 1 ? el('span.gv-status-stacks', { text: s.stacks }) : null))));
        vm.status.forEach((s, i) => { const c = n.children[i]; if (!c) return; setStyle(c, '--p', s.frac.toFixed(3)); setClass(c, 'is-ending', isNum(s.remaining) && s.remaining < 2); });
      }
      for (const [key, n] of nodes) setHidden(n, !seen.has(key));
      // Singletons.
      setClass(prompt, 'is-on', Boolean(vm.prompt) && !host.input.modal);
      if (vm.prompt) { setText(prompt.querySelector('.gv-prompt-key'), glyph(host, vm.prompt.verb)); setText(prompt.lastChild, vm.prompt.label); setStyle(prompt.querySelector('.gv-prompt-ring'), '--p', vm.prompt.hold ?? 0); }
      setClass(boss, 'is-on', Boolean(vm.boss));
      if (vm.boss) {
        setText(boss.querySelector('.gv-boss-title'), vm.boss.name);
        setText(boss.querySelector('.gv-boss-phase'), vm.boss.notches.length ? `Phase ${vm.boss.phase + 1}` : '');
        const track = boss.querySelector('.gv-meter-track');
        setStyle(track.children[0], 'transform', `scaleX(${vm.boss.frac.toFixed(4)})`); setStyle(track.children[1], 'transform', `scaleX(${vm.boss.frac.toFixed(4)})`);
        keyed(track, vm.boss.notches, () => { track.querySelectorAll('.gv-boss-notch').forEach(x => x.remove()); vm.boss.notches.forEach(a => track.append(el('i.gv-boss-notch', { style: { left: `${a * 100}%` } }))); });
      }
      setClass(combo, 'is-on', config.combo && local.combo.at >= 0 && rt.state.time - local.combo.at <= config.comboWindow * 1.6 && (local.combo.label !== 'hits' || local.combo.count >= 2));
      if (config.combo && local.combo.at >= 0) setStyle(combo.children[2], 'transform', `scaleX(${clamp(1 - (rt.state.time - local.combo.at) / (config.comboWindow * 1.6), 0, 1).toFixed(3)})`);
      setHidden(root, rt.state.status !== 'playing' && !host.held());
    });
  },
};
