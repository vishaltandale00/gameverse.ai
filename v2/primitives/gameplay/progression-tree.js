// gameplay.progression.tree: perk/skill trees. Nodes cost points (the
// `points` var by default, which progression.level publishes), require other
// nodes, may have ranks, and apply var deltas (`stat.*`, `hp.max`, `res.*.max`)
// when unlocked. Use-based nodes unlock themselves after N matching events.
import { onEvents } from './ai-lib.js';

const ID = 'gameplay.progression.tree';
const st = rt => rt.store(ID);

export default {
  id: ID,
  card: {
    loop: { verbs: ['unlock_perk'], progress: ['perk_unlocked'] },
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { unlock_perk: { type: 'choice', of: 'an unlockable perk', from: 'options', emits: ['perk_unlocked'] } },
    intent: 'Perk/skill tree: nodes with point costs, prerequisites, ranks and var modifiers (stat.*, hp.max, res.*.max); use-based nodes unlock from usage events; unlock_perk/reset_perks effects, `perk` predicate and an unlock verb.',
    views: ['any'],
    params: {
      nodes: { type: 'list', default: [], of: { type: 'object', fields: {
        id: { type: 'string', required: true }, name: { type: 'string' }, desc: { type: 'string' },
        cost: { type: 'integer', default: 1, min: 0, max: 100 },
        requires: { type: 'list', default: [], of: { type: 'string' }, effect: 'node ids that must be unlocked first' },
        mods: { type: 'object', open: true, default: {}, effect: 'var → delta applied per rank' },
        ranks: { type: 'integer', default: 1, min: 1, max: 20 },
        when: { type: 'predicate', effect: 'extra unlock condition (level gate, quest...)' },
        use: { type: 'object', fields: { event: { type: 'string', required: true }, count: { type: 'integer', default: 1, min: 1 } }, effect: 'use-based: unlock (free) after this many matching events' },
        onUnlock: { type: 'effects', default: [] },
      } } },
      useBased: { type: 'boolean', default: false, effect: 'nodes with `use` unlock themselves from usage events' },
      pointsVar: { type: 'string', default: 'points', effect: 'var that holds spendable points' },
      respec: { type: 'boolean', default: true, effect: 'reset_perks refunds every point' },
    },
    // Events it emits when it refuses a player's verb, with a reason (graphics.ui.hud says why).
    denials: ['perk_blocked'],
    provides: { events: ['perk_blocked', 'perk_unlocked', 'perk_unlocked:*', 'perks_reset'], vars: ['perk.*'], actions: ['unlock_perk'] },
    defines: [{ kind: 'perk', in: 'nodes' }],
    reads: [],
  },
  logic(logic) {
    logic.predicate('perk', { refs: p => [['perk', p.perk]], test: (p, rt) => (st(rt).ranks?.[p.perk] ?? 0) >= (p.rank ?? 1) });
    logic.effect('unlock_perk', { refs: e => [['perk', e.perk]], run: (e, rt) => unlockPerk(rt, e.perk, Boolean(e.free)) });
    logic.effect('reset_perks', { run: (e, rt) => resetPerks(rt) });
  },
  validate(config) {
    const errors = [], ids = new Map(config.nodes.map((nd, i) => [nd.id, i]));
    config.nodes.forEach((nd, i) => {
      if (ids.get(nd.id) !== i) errors.push({ code: 'perk_duplicate', path: `nodes[${i}].id`, message: `duplicate node '${nd.id}'` });
      nd.requires.forEach((r, j) => { if (!ids.has(r)) errors.push({ code: 'ref_unknown', path: `nodes[${i}].requires[${j}]`, message: `unknown node '${r}'` }); });
    });
    // Prerequisite cycles make nodes unobtainable.
    const state = new Map(), byId = new Map(config.nodes.map(nd => [nd.id, nd]));
    const visit = (id, path) => {
      if (state.get(id) === 2) return; if (state.get(id) === 1) { errors.push({ code: 'perk_cycle', path: `nodes[${ids.get(id)}].requires`, message: `prerequisite cycle: ${[...path, id].join(' → ')}` }); return; }
      state.set(id, 1); for (const r of byId.get(id)?.requires || []) if (byId.has(r)) visit(r, [...path, id]); state.set(id, 2);
    };
    for (const nd of config.nodes) visit(nd.id, []);
    if (config.useBased && !config.nodes.some(nd => nd.use)) errors.push({ code: 'perk_use_missing', path: 'useBased', message: 'useBased needs at least one node with `use`', hint: 'add use: {event, count} to the nodes that level by use' });
    return errors;
  },
  install(rt, config) {
    rt.caches.treeCfg = config;
    if (config.useBased) onEvents(rt, [...new Set(config.nodes.filter(nd => nd.use).map(nd => nd.use.event))], (name, data, rt) => {
      const s = st(rt); s.uses ??= {};
      for (const nd of config.nodes) {
        if (!nd.use || !(nd.use.event === name || (nd.use.event.endsWith(':*') && name.startsWith(nd.use.event.slice(0, -1))))) continue;
        s.uses[nd.id] = (s.uses[nd.id] ?? 0) + 1;
        if (s.uses[nd.id] >= nd.use.count * ((s.ranks?.[nd.id] ?? 0) + 1)) unlockPerk(rt, nd.id, true);
      }
    });
    rt.action('unlock_perk', (id, rt) => unlockPerk(rt, id, false));
    rt.options(rt => config.nodes.filter(nd => canUnlock(rt, nd, false)).map(nd => ({ label: `unlock ${nd.id}`, actions: { unlock_perk: nd.id } })));
    rt.provide('perks', { rank: id => st(rt).ranks?.[id] ?? 0, available: () => config.nodes.filter(nd => canUnlock(rt, nd, false)).map(nd => nd.id) });
  },
};

function canUnlock(rt, nd, free) {
  const ranks = st(rt).ranks || {};
  if ((ranks[nd.id] ?? 0) >= nd.ranks) return false;
  if (!nd.requires.every(r => (ranks[r] ?? 0) > 0)) return false;
  if (nd.when && !rt.test(nd.when)) return false;
  return free || (rt.state.vars[rt.caches.treeCfg.pointsVar] ?? 0) >= nd.cost;
}
function unlockPerk(rt, id, free) {
  const cfg = rt.caches.treeCfg, nd = cfg.nodes.find(x => x.id === id);
  if (!nd || !canUnlock(rt, nd, free)) { rt.emit('perk_blocked', { perk: id }); return false; }
  const s = st(rt); s.ranks ??= {}; s.spent ??= 0;
  if (!free) { rt.state.vars[cfg.pointsVar] -= nd.cost; s.spent += nd.cost; syncPoints(rt, -nd.cost); }
  s.ranks[id] = (s.ranks[id] ?? 0) + 1;
  for (const [v, d] of Object.entries(nd.mods)) rt.state.vars[v] = Math.round(((rt.state.vars[v] ?? 0) + d) * 1e6) / 1e6;
  rt.state.vars[`perk.${id}`] = s.ranks[id];
  rt.emitTyped('perk_unlocked', id, { perk: id, rank: s.ranks[id] });
  rt.run(nd.onUnlock || []);
  return true;
}
function resetPerks(rt) {
  const cfg = rt.caches.treeCfg, s = st(rt); if (!cfg.respec) return;
  for (const [id, rank] of Object.entries(s.ranks || {})) {
    const nd = cfg.nodes.find(x => x.id === id); if (!nd) continue;
    for (const [v, d] of Object.entries(nd.mods)) rt.state.vars[v] = Math.round(((rt.state.vars[v] ?? 0) - d * rank) * 1e6) / 1e6;
    delete rt.state.vars[`perk.${id}`];
  }
  const refund = s.spent ?? 0;
  rt.state.vars[cfg.pointsVar] = (rt.state.vars[cfg.pointsVar] ?? 0) + refund; syncPoints(rt, refund);
  s.ranks = {}; s.spent = 0; s.uses = {};
  rt.emit('perks_reset', { refund });
}
/** Keep progression.level's own point count in step when it owns the points var. */
function syncPoints(rt, delta) {
  const lv = rt.state.prim['gameplay.progression.level']?.ents?.player;
  if (lv && rt.caches.treeCfg.pointsVar === 'points') lv.points += delta;
}
