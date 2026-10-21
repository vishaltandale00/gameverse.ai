// gameplay.progression.level: experience, levels, stat points and stats.
// XP comes from events (wildcards like `block_mined:*` allowed), from
// give_xp, and can be tracked per entity for party members. Scalars are vars
// for the player (`level`, `xp`, `xp.next`, `points`, `stat.<id>`); other
// entities read through the `level` predicate and components.level.
import { compare } from '../../kernel/logic.js';
import { onEvents, dead, objectParam } from './ai-lib.js';

const ID = 'gameplay.progression.level';
const st = rt => rt.store(ID);

export function xpToNext(curve, level) {
  if (curve.kind === 'table') return curve.table[Math.min(level - 1, curve.table.length - 1)] ?? Infinity;
  if (curve.kind === 'linear') return Math.round(curve.base + curve.growth * (level - 1));
  return Math.round(curve.base * curve.growth ** (level - 1));
}

export default {
  id: ID,
  card: {
    loop: { verbs: ['allocate'], progress: ['xp_gained', 'level_up'] },
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { allocate: { type: 'choice', of: 'a stat to raise', from: 'options', emits: ['stat_changed'] } },
    intent: 'XP and levels: an XP curve, level cap, stat points with per-point and per-level growth, XP sources keyed by events (with wildcards, level scaling and party sharing), level-up effects, and per-entity progress for party members.',
    views: ['any'],
    params: {
      curve: objectParam({ type: 'object', fields: {
        kind: { type: 'string', default: 'exp', options: ['exp', 'linear', 'table'] },
        base: { type: 'number', default: 100, min: 1, effect: 'XP from level 1 to 2' },
        growth: { type: 'number', default: 1.25, min: 0, effect: 'exp: ×growth per level; linear: +growth per level' },
        table: { type: 'list', of: { type: 'number', min: 1 }, effect: 'kind table: XP to the next level for each level' },
      } }),
      maxLevel: { type: 'integer', default: 50, min: 1, max: 200 },
      start: { type: 'integer', default: 1, min: 1, max: 200, effect: 'starting player level' },
      pointsPerLevel: { type: 'integer', default: 0, min: 0, max: 100 },
      autoAllocate: { type: 'boolean', default: false, effect: 'spend points round-robin over stats automatically' },
      stats: { type: 'list', default: [], of: { type: 'object', fields: { id: { type: 'string', required: true }, base: { type: 'number', default: 0 }, perPoint: { type: 'number', default: 1 }, perLevel: { type: 'number', default: 0 }, max: { type: 'number' } } } },
      xpSources: { type: 'list', default: [], of: { type: 'object', fields: {
        event: { type: 'string', required: true, effect: 'event name or prefix:* wildcard' },
        xp: { type: 'number', required: true, min: 0 },
        to: { type: 'string', default: 'player', options: ['player', 'actor', 'party', 'share'], effect: 'who earns it: the player, the event actor (data.by), everyone in the party, or the party split evenly' },
        scaleBy: { type: 'string', options: ['level'], effect: "level: multiply by the subject's level (data.who entity or data.level)" },
        actorOnly: { type: 'boolean', default: true, effect: 'skip events whose data.by is someone outside the recipients (NPC kills)' },
        when: { type: 'predicate' },
      } } },
      perEntity: { type: 'boolean', default: false, effect: 'track XP/levels for entities with a party component too' },
      partyTag: { type: 'string', default: 'party', effect: 'component marking party members' },
      onLevel: { type: 'list', default: [], of: { type: 'object', fields: { level: { type: 'integer', min: 1 }, every: { type: 'integer', min: 1 }, do: { type: 'effects', required: true } } } },
    },
    provides: { events: ['xp_gained', 'level_up', 'stat_changed'], vars: ['level', 'xp', 'xp.next', 'points', 'stat.*'], actions: ['allocate'] },
    reads: [],
    defines: [{ kind: 'level_stat', in: 'stats' }],
    rules: {
      level_curve_table: { fields: ['curve.kind', 'curve.table'], message: 'a table curve lists the XP per level in curve.table' },
      level_start: { fields: ['start', 'maxLevel'], message: 'start is at most maxLevel' },
      level_trigger: { fields: ['onLevel[].level', 'onLevel[].every'], message: 'an onLevel entry has level or every', example: { doc: { systems: [{ use: ID, with: { onLevel: [{ do: [] }] } }] } } },
    },
  },
  logic(logic) {
    logic.predicate('level', { test: (p, rt, c) => { const e = rt.resolve(p.level === true ? undefined : p.level, c); return compare(e ? recordOf(rt, e.id).level : 0, p); } });
    logic.effect('give_xp', { codes: [{ code: 'xp_amount', fields: ['amount'], message: 'amount is a number', example: { do: 'give_xp' } }], check: (e, path, errs) => { if (!Number.isFinite(e.amount)) errs.push({ code: 'xp_amount', path: `${path}.amount`, message: 'give_xp needs a numeric amount' }); },
      run: (e, rt, c) => { const who = rt.resolve(e.who, c); if (who) gain(rt, who.id, e.amount, 'effect'); } });
    logic.effect('add_stat', { run: (e, rt, c) => { const who = rt.resolve(e.who, c); if (who) addStat(rt, who.id, e.stat, e.delta ?? 1, Boolean(e.free)); } });
    logic.effect('set_level', { run: (e, rt, c) => { const who = rt.resolve(e.who, c); if (!who) return; const r = recordOf(rt, who.id), cfg = rt.caches.levelCfg; r.level = Math.max(1, Math.min(cfg.maxLevel, e.level)); r.xp = 0; publish(rt, who.id); } });
  },
  validate(config) {
    const errors = [];
    if (config.curve.kind === 'table' && !(config.curve.table?.length)) errors.push({ code: 'level_curve_table', path: 'curve.table', message: 'a table curve needs XP per level' });
    if (config.start > config.maxLevel) errors.push({ code: 'level_start', path: 'start', message: 'start level above maxLevel' });
    config.onLevel.forEach((o, i) => { if (o.level === undefined && o.every === undefined) errors.push({ code: 'level_trigger', path: `onLevel[${i}]`, message: 'needs level or every' }); });
    return errors;
  },
  install(rt, config) {
    rt.caches.levelCfg = config;
    const s = st(rt); s.ents ??= {};
    if (!rt.state.frame && !s.ents.player) { s.ents.player = { level: config.start, xp: 0, points: 0, alloc: {} }; }
    rt.on('game_start', (_, rt) => publish(rt, 'player'));
    onEvents(rt, config.xpSources.map(x => x.event), (name, data, rt) => {
      for (const src of config.xpSources) {
        if (!(src.event === name || (src.event.endsWith(':*') && name.startsWith(src.event.slice(0, -1))))) continue;
        if (src.when && !rt.test(src.when, { self: data.who })) continue;
        let amount = src.xp;
        if (src.scaleBy === 'level') amount *= data.level ?? (rt.entity(data.who) ? levelOfEntity(rt, rt.entity(data.who)) : 1);
        const party = partyOf(rt, config);
        let to;
        if (src.to === 'actor') to = data.by && rt.entity(data.by) ? [data.by] : [];
        else if (src.to === 'party' || src.to === 'share') to = party;
        else to = ['player'];
        if (src.actorOnly && data.by && src.to !== 'actor' && !(src.to === 'player' ? data.by === 'player' : party.includes(data.by))) continue;
        const each = src.to === 'share' ? amount / Math.max(1, to.length) : amount;
        for (const id of to) gain(rt, id, each, name);
      }
    });
    rt.action('allocate', (stat, rt) => addStat(rt, 'player', stat, 1, false));
    rt.options(rt => { const r = recordOf(rt, 'player'); return r.points > 0 ? config.stats.map(x => ({ label: `raise ${x.id}`, actions: { allocate: x.id } })) : []; });
    rt.provide('progression', { level: id => recordOf(rt, id).level, xp: id => recordOf(rt, id).xp, stat: (id, stat) => statValue(rt, id, stat), give: (id, amount) => gain(rt, id, amount, 'service') });
  },
};

const partyOf = (rt, config) => ['player', ...(config.perEntity ? Object.values(rt.state.entities).filter(e => e.id !== 'player' && e.components[config.partyTag] && !dead(e)).map(e => e.id).sort() : [])];
function levelOfEntity(rt, e) { const rec = st(rt).ents?.[e.id]; return rec?.level ?? (typeof e.components.level === 'number' ? e.components.level : e.components.level?.level ?? 1); }
function recordOf(rt, id) {
  const s = st(rt); s.ents ??= {};
  if (!s.ents[id]) { const e = rt.entity(id); s.ents[id] = { level: e ? levelOfEntity(rt, e) : 1, xp: 0, points: 0, alloc: {} }; }
  return s.ents[id];
}
function statValue(rt, id, stat) {
  const def = rt.caches.levelCfg.stats.find(s => s.id === stat); if (!def) return 0;
  const r = recordOf(rt, id), v = def.base + def.perPoint * (r.alloc[stat] ?? 0) + def.perLevel * (r.level - 1);
  return def.max !== undefined ? Math.min(def.max, v) : v;
}
function publish(rt, id) {
  const cfg = rt.caches.levelCfg, r = recordOf(rt, id), e = rt.entity(id);
  if (e) e.components.level = r.level; // components.level is the entity's current level (a number)
  if (id !== 'player') return;
  const v = rt.state.vars;
  v.level = r.level; v.xp = r.xp; v['xp.next'] = r.level >= cfg.maxLevel ? 0 : xpToNext(cfg.curve, r.level); v.points = r.points;
  for (const s of cfg.stats) v[`stat.${s.id}`] = statValue(rt, id, s.id);
}
function gain(rt, id, amount, source) {
  const cfg = rt.caches.levelCfg; if (!(amount > 0) || (id !== 'player' && !rt.entity(id))) return;
  const r = recordOf(rt, id);
  if (r.level >= cfg.maxLevel) return;
  r.xp = Math.round((r.xp + amount) * 1e6) / 1e6;
  rt.emit('xp_gained', { who: id, amount, source });
  while (r.level < cfg.maxLevel && r.xp >= xpToNext(cfg.curve, r.level)) {
    r.xp = Math.round((r.xp - xpToNext(cfg.curve, r.level)) * 1e6) / 1e6; r.level++; r.points += cfg.pointsPerLevel;
    if (cfg.autoAllocate && cfg.stats.length) for (let k = 0; k < cfg.pointsPerLevel; k++) { const s = cfg.stats[(r.autoI = ((r.autoI ?? -1) + 1)) % cfg.stats.length]; r.alloc[s.id] = (r.alloc[s.id] ?? 0) + 1; r.points--; }
    publish(rt, id);
    rt.emit('level_up', { who: id, level: r.level });
    for (const o of cfg.onLevel) if (o.level === r.level || (o.every && r.level % o.every === 0)) rt.run(o.do, { self: id });
  }
  if (r.level >= cfg.maxLevel) r.xp = 0;
  publish(rt, id);
}
function addStat(rt, id, stat, delta, free) {
  const cfg = rt.caches.levelCfg, def = cfg.stats.find(s => s.id === stat); if (!def) return false;
  const r = recordOf(rt, id);
  if (!free) { if (r.points < delta) return false; r.points -= delta; }
  r.alloc[stat] = (r.alloc[stat] ?? 0) + delta;
  publish(rt, id);
  rt.emit('stat_changed', { who: id, stat, value: statValue(rt, id, stat) });
  return true;
}
