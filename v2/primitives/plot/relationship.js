// Faction reputation and character affinity (plot.factions:
// { id, name, rep?, ranks?: [{at, title}], hostileBelow? }). Values are vars
// (`rep.<faction>`, `affinity.<character>`) clamped to repRange, so any
// predicate reads them with `var`. Crossing a rank threshold emits
// rank_changed; dropping below hostileBelow emits faction_hostile:<id>.
// decayPerDay pulls every value toward 0 on each engine.time `new_day`.
import { err, checkKeys, cached } from './story-lib.js';

const ID = 'plot.relationship';
const factions = rt => cached(rt, 'plot.relationship.index', doc => new Map((doc.plot?.factions || []).map(f => [f.id, f])));
const st = rt => { const s = rt.store(ID); s.rank ??= {}; s.hostile ??= {}; return s; };
export const rankOf = (f, rep) => [...(f?.ranks || [])].sort((a, b) => a.at - b.at).filter(r => rep >= r.at).pop()?.title ?? null;

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['rep_changed', 'affinity_changed'] },
    intent: 'Faction reputation (rep.<faction>) and character affinity (affinity.<character>) as clamped vars, with named ranks, hostility thresholds and optional daily decay.',
    views: ['any'],
    params: {
      repRange: { type: 'list', of: { type: 'integer', min: -100000, max: 100000 }, min: 2, max: 2, default: [-100, 100], effect: '[min, max] for reputation and affinity' },
      decayPerDay: { type: 'number', default: 0, min: 0, max: 1000, effect: 'points every value moves toward 0 per in-game day (needs engine.time new_day)' },
    },
    provides: { events: ['rep_changed', 'rep_changed:*', 'affinity_changed', 'affinity_changed:*', 'rank_changed', 'rank_changed:*', 'faction_hostile', 'faction_hostile:*', 'faction_calm', 'faction_calm:*'], vars: ['rep.*', 'affinity.*'], services: ['relationship'] },
    reads: ['plot.factions'],
    defines: [{ kind: 'faction', at: 'plot.factions' }],
  },
  logic(logic) {
    const clampTo = (rt, v) => { const [lo, hi] = rt.caches[`${ID}.range`] || [-100, 100]; return Math.max(lo, Math.min(hi, v)); };
    const note = (rt, fid) => {
      const f = factions(rt).get(fid), rep = rt.state.vars[`rep.${fid}`] ?? 0, s = st(rt);
      const rank = rankOf(f, rep);
      if (rank !== (s.rank[fid] ?? rankOf(f, f?.rep ?? 0))) { s.rank[fid] = rank; rt.emitTyped('rank_changed', fid, { faction: fid, rank }); }
      if (f?.hostileBelow !== undefined) {
        const hostile = rep < f.hostileBelow;
        if (hostile !== Boolean(s.hostile[fid])) { s.hostile[fid] = hostile; rt.emitTyped(hostile ? 'faction_hostile' : 'faction_calm', fid, { faction: fid }); }
      }
    };
    logic.effect('add_rep', { refs: e => [['faction', e.faction], ['var', `rep.${e.faction}`]], check: (e, path, errors) => { if (typeof e.delta !== 'number') errors.push(err('effect_invalid', `${path}.delta`, 'delta must be a number')); }, run: (e, rt) => {
      const k = `rep.${e.faction}`, from = rt.state.vars[k] ?? 0, to = clampTo(rt, from + e.delta);
      rt.state.vars[k] = to; rt.emitTyped('rep_changed', e.faction, { faction: e.faction, from, to, delta: to - from }); note(rt, e.faction);
    } });
    logic.effect('add_affinity', { refs: e => [['character', e.character], ['var', `affinity.${e.character}`]], check: (e, path, errors) => { if (typeof e.delta !== 'number') errors.push(err('effect_invalid', `${path}.delta`, 'delta must be a number')); }, run: (e, rt) => {
      const k = `affinity.${e.character}`, from = rt.state.vars[k] ?? 0, to = clampTo(rt, from + e.delta);
      rt.state.vars[k] = to; rt.emitTyped('affinity_changed', e.character, { character: e.character, from, to, delta: to - from });
    } });
    logic.predicate('rank', { refs: p => [['faction', p.rank]], test: (p, rt) => rankOf(factions(rt).get(p.rank), rt.state.vars[`rep.${p.rank}`] ?? 0) === p.title });
    logic.predicate('hostile', { refs: p => [['faction', p.hostile]], test: (p, rt) => { const f = factions(rt).get(p.hostile); return f?.hostileBelow !== undefined && (rt.state.vars[`rep.${p.hostile}`] ?? 0) < f.hostileBelow; } });
  },
  validate(config, doc, ctx) {
    const errors = [], list = doc.plot?.factions;
    if (config.repRange?.[0] >= config.repRange?.[1]) errors.push(err('param_range', 'repRange', 'repRange min must be below max'));
    if (list === undefined) return errors;
    if (!Array.isArray(list)) return [...errors, err('param_type', 'plot.factions', 'must be a list of factions')];
    list.forEach((f, i) => {
      const path = `plot.factions[${i}]`;
      checkKeys(f, ['id', 'name', 'rep', 'ranks', 'hostileBelow', 'tags', 'desc'], path, errors);
      if (typeof f.name !== 'string') errors.push(err('faction_invalid', `${path}.name`, 'faction needs a name'));
      for (const k of ['rep', 'hostileBelow']) if (f[k] !== undefined && typeof f[k] !== 'number') errors.push(err('faction_invalid', `${path}.${k}`, `${k} must be a number`));
      (f.ranks || []).forEach((r, j) => { if (typeof r?.at !== 'number' || typeof r?.title !== 'string') errors.push(err('faction_invalid', `${path}.ranks[${j}]`, 'rank needs at:number and title:string')); });
    });
    return errors;
  },
  install(rt, config) {
    st(rt); // create the store at install: UI reads (view/list/known) must never write state
    rt.caches[`${ID}.range`] = config.repRange;
    if (!rt.state.frame) for (const f of factions(rt).values()) { const k = `rep.${f.id}`; if (rt.state.vars[k] === undefined) rt.state.vars[k] = f.rep ?? 0; const s = st(rt); s.rank[f.id] = rankOf(f, rt.state.vars[k]); if (f.hostileBelow !== undefined) s.hostile[f.id] = rt.state.vars[k] < f.hostileBelow; }
    rt.on('new_day', () => {
      if (!config.decayPerDay) return;
      for (const k of Object.keys(rt.state.vars).sort()) if (k.startsWith('rep.') || k.startsWith('affinity.')) {
        const v = rt.state.vars[k]; rt.state.vars[k] = v > 0 ? Math.max(0, v - config.decayPerDay) : Math.min(0, v + config.decayPerDay);
      }
    });
    rt.provide('relationship', {
      rep: id => rt.state.vars[`rep.${id}`] ?? 0,
      affinity: id => rt.state.vars[`affinity.${id}`] ?? 0,
      rank: id => rankOf(factions(rt).get(id), rt.state.vars[`rep.${id}`] ?? 0),
      hostile: id => Boolean(st(rt).hostile[id]),
      factions: () => [...factions(rt).keys()],
    });
  },
};
