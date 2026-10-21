// Collectibles and counters: coins, shards, pages, maze pellets and power
// pellets, timed bonus prizes. A pickup is an entity with a `collectible`
// component ("counter" | { counter, value?, points?, item?, fx?, magnet? }) or a
// cell holding a counter's `block`. Touch collects (entities that also carry an
// `interact` component are collected by using them instead). Each counter keeps
// a var, per-zone tallies, a total (given or counted at start), and can clear the
// level, run effects on completion and spawn timed prizes at chosen counts.
import { ENTITY_KINDS } from '../../kernel/params.js';
import { compare } from '../../kernel/logic.js';
import { give } from './inventory.js';
import { addScore, boxOf, boxesTouch, center, isVec, len, sub, pull, entityByRef, whoKey, cellPoint } from './items-lib.js';

const KEY = 'gameplay.collectible';
const counterOf = e => { const c = e.components.collectible; return typeof c === 'string' ? { counter: c } : c || null; };

export default {
  id: 'gameplay.collectible',
  card: {
    // What an entity carrying these components reads as on screen (graphics/flat-art.js roleOf; never its name).
    presents: { collectible: { role: 'pickup' } },
    loop: { shows: ['entities'], verbs: [], progress: ['collected', 'counter_complete'] },
    // Shapes of the archetype components this primitive owns (the planner's schemas and repair read them).
    components: { collectible: { type: 'json', effect: 'a counter id, or {counter, value?, points?, item?}' } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "archetypes", "component": "collectible", "kinds": ["pickup", "prop"], "min": 1, "placed": 8, "zones": 3, "why": "pickups are entities with a collectible component (counter id or {counter, value, points}), placed through every zone", "example": {"id": "coin", "kind": "pickup", "components": {"collectible": {"counter": "coins", "points": 10}}}},
    ],
    // Collect mode (only when a counter clears the level): gather every pickup while threats chase. Touch and use
    // collect whatever moves the collector (box overlap, radius, the cell it is on), so it is played stepping or in real time.
    mode: { loop: 'collect', applies: { param: 'counters', field: 'clearsLevel', is: true }, interaction: ['avatar-grid', 'avatar-realtime'], opponent: 'hazards', space: ['engine.space.grid', 'engine.space.tilemap', ['navigate']], needs: { content: ['content.archetypes'], participants: null }, win: { param: 'counters.onComplete', shown: { each: { param: 'counters', where: { clearsLevel: true } }, var: 'collected.$id', max: 'collected.$id.total', label: '$id' }, reads: { event: 'collected', by: { effects: ['collect'], events: ['interacted'], movement: true } } }, lose: { param: null }, bot: 'danger-field' },
    intent: 'Pickups and counters (coins, shards, pages, pellets): touch or use to collect, magnet pull, per-zone totals, a var per counter, level clear when a counter completes, and timed bonus prizes spawned at chosen counts.',
    views: ['any'],
    params: {
      magnet: { type: 'number', default: 0, min: 0, max: 100, unit: 'space units', effect: 'pickups within this radius drift to a collector (player adds var stat.magnet)' },
      magnetSpeed: { type: 'number', default: 8, min: 0, max: 200, unit: 'units/s', effect: 'drift speed of magnetised pickups' },
      radius: { type: 'number', default: 0.25, min: 0, max: 20, unit: 'space units', effect: 'centre distance that also counts as touching' },
      collectors: { type: 'list', default: ['player'], of: { type: 'string', selects: ENTITY_KINDS }, effect: 'entity ids or archetypes that collect by touch' },
      counters: { type: 'list', default: [], of: { type: 'object', fields: {
        id: { type: 'string', required: true },
        var: { type: 'string', effect: "var holding the count (default 'collected.<id>')" },
        total: { type: 'integer', min: 0, effect: 'pickups needed to complete; default = pickups present at start (+ included counters)' },
        zone: { type: 'ref', to: 'zone', effect: 'only pickups in this zone count toward the total' },
        block: { type: 'ref', to: 'block', effect: 'cells holding this block are pickups of this counter (needs editCells)' },
        value: { type: 'integer', default: 1, min: 0, effect: 'count added per pickup' },
        points: { type: 'number', default: 0, effect: 'score per pickup (add_score, else var score)' },
        includes: { type: 'list', default: [], of: { type: 'string' }, effect: 'other counters whose pickups also count here (pellets include power pellets)' },
        onCollect: { type: 'effects', default: [], effect: 'effects per pickup (self = the pickup, actor = the collector)' },
        onComplete: { type: 'effects', default: [], effect: 'effects when the counter reaches its total' },
        clearsLevel: { type: 'boolean', default: false, effect: 'reaching the total emits level_cleared' },
        spawnAtCount: { type: 'list', default: [], of: { type: 'object', fields: {
          count: { type: 'integer', min: 1, effect: 'count that spawns the prize' },
          fraction: { type: 'number', min: 0, max: 1, effect: 'or a fraction of the total' },
          archetype: { type: 'ref', to: 'archetype', required: true },
          at: { type: 'json', effect: 'where (space coordinates); default: the collector' },
          zone: { type: 'ref', to: 'zone' },
          sec: { type: 'number', default: 0, min: 0, unit: 's', effect: 'lifetime; 0 = until collected' },
        } }, effect: 'timed bonus prizes (maze fruit at 70 and 170 pellets)' },
      } }, effect: 'counters' },
    },
    provides: { events: ['collected', 'collected:*', 'counter_complete', 'counter_complete:*', 'level_cleared', 'prize_spawned', 'prize_expired'], vars: ['collected.*'] },
    requires: { capabilities: ['position'] },
    reads: ['content.archetypes'],
    defines: [{ kind: 'counter', in: 'counters' }],
  },
  logic(logic) {
    logic.predicate('collected', { refs: p => [['counter', p.collected]], test: (p, rt) => {
      const s = rt.store(KEY); return compare(p.zone ? s.byZone?.[p.collected]?.[p.zone] ?? 0 : s.count?.[p.collected] ?? 0, p);
    } });
    logic.effect('collect', { refs: e => (e.counter ? [['counter', e.counter]] : []), run: (e, rt, c) => {
      if (e.target) { const t = entityByRef(rt, e.target, c); if (t) rt.caches.collect?.(t, whoKey(e.who, c)); }
      else if (e.counter) rt.caches.collectCount?.(e.counter, whoKey(e.who, c), e.value ?? 1, null, null);
    } });
  },
  validate(config, doc, ctx, inst = {}) {
    const P = inst.path ? `${inst.path}.with` : undefined; // errors about this instance point at its `with`
    const errors = [], ids = new Set(config.counters.map(c => c.id));
    config.counters.forEach(c => {
      for (const inc of c.includes) if (!ids.has(inc) || inc === c.id) errors.push({ code: 'counter_invalid', path: P, message: `counter '${c.id}' includes unknown or itself: '${inc}'` });
      for (const s of c.spawnAtCount) if (s.count == null && s.fraction == null) errors.push({ code: 'counter_invalid', path: P, message: `counter '${c.id}' spawnAtCount entry needs count or fraction` });
    });
    (doc.content?.archetypes || []).forEach((a, i) => {
      const k = a.components?.collectible; if (k == null) return;
      const id = typeof k === 'string' ? k : k.counter;
      if (!ids.has(id)) errors.push({ code: 'ref_unknown', path: `content.archetypes[${i}].components.collectible`, message: `unknown counter '${id}'`, hint: [...ids].join(', ') || 'no counters' });
    });
    return errors;
  },
  /** Solver progress: fraction collected of every counter with a total. */
  progress(rt, config) { const s = rt.state.prim[KEY] || {}; return config.counters.reduce((v, c) => { const t = s.totals?.[c.id] ?? c.total ?? 0; return v + (t > 0 ? Math.min(1, (s.count?.[c.id] || 0) / t) : 0); }, 0); },
  install(rt, config) {
    const defs = new Map(config.counters.map(c => [c.id, c]));
    const st = () => { const s = rt.store(KEY); s.count ??= {}; s.byZone ??= {}; s.totals ??= null; s.done ??= {}; s.prizes ??= {}; s.spawned ??= {}; return s; };
    st(); // created at install, so reads later never add state
    const varOf = c => c.var || `collected.${c.id}`;
    const isCollector = e => config.collectors.includes(e.id) || config.collectors.includes(e.archetype);
    // Counters a pickup of counter `id` advances: itself plus every counter that includes it.
    const targets = id => [id, ...config.counters.filter(c => c.includes.includes(id)).map(c => c.id)];

    function computeTotals() {
      const own = {};
      for (const c of config.counters) own[c.id] = 0;
      for (const e of Object.values(rt.state.entities)) {
        const k = counterOf(e); if (!k || !defs.has(k.counter)) continue;
        const c = defs.get(k.counter); if (c.zone && e.zone !== c.zone) continue;
        own[k.counter] += k.value ?? c.value;
      }
      for (const c of config.counters) if (c.block) {
        // Count pre-placed cell pickups in the counter's space (only spaces that report a finite size).
        for (const sid of rt.spaces()) { const api = rt.space(sid); if (typeof api.cellsIn !== 'function' || !Array.isArray(api.size)) continue; own[c.id] += api.cellsIn([api.size.map(() => 0), api.size.map(n => n - 1)]).filter(x => x.block === c.block).length * c.value; }
      }
      const totals = {};
      for (const c of config.counters) totals[c.id] = c.total ?? own[c.id] + c.includes.reduce((s, i) => s + (defs.get(i).total ?? own[i]), 0);
      return totals;
    }
    const totalOf = id => (st().totals ??= computeTotals())[id] ?? 0;

    function countUp(id, who, value, zone, at) {
      const s = st(), c = defs.get(id); if (!c) return;
      const before = s.count[id] || 0, now = before + value;
      s.count[id] = now; rt.state.vars[varOf(c)] = now; rt.state.vars[`collected.${c.id}`] = now;
      if (zone) { (s.byZone[id] ??= {})[zone] = (s.byZone[id][zone] || 0) + value; }
      const total = totalOf(id);
      rt.emitTyped('collected', id, { who, value, count: now, total, zone: zone ?? null });
      c.spawnAtCount.forEach((p, i) => {
        const at0 = p.count ?? Math.max(1, Math.round(p.fraction * total)), key = `${id}:${i}`;
        if (s.spawned[key] || before >= at0 || now < at0) return;
        s.spawned[key] = true; spawnPrize(p, who, at);
      });
      if (total > 0 && now >= total && !s.done[id]) {
        s.done[id] = true;
        rt.emitTyped('counter_complete', id, { count: now, total });
        if (c.onComplete.length) rt.run(c.onComplete, { actor: who });
        if (c.clearsLevel) rt.emit('level_cleared', { counter: id });
      }
    }
    function spawnPrize(p, who, at) {
      const actor = rt.entity(who);
      const where = p.at ?? (actor && isVec(actor.at) ? structuredClone(actor.at) : at);
      const e = rt.spawn(p.archetype, { space: actor?.space, at: where });
      if (p.zone) rt.space(e.space).teleport(e, { zone: p.zone }, rt);
      if (p.sec > 0) st().prizes[e.id] = rt.state.frame + Math.round(p.sec / rt.dt);
      rt.emit('prize_spawned', { id: e.id, archetype: p.archetype, sec: p.sec });
    }
    function collect(pickup, who) {
      const k = counterOf(pickup); if (!k || !defs.has(k.counter)) return false;
      const c = defs.get(k.counter), value = k.value ?? c.value, zone = pickup.zone ?? rt.entity(who)?.zone ?? null;
      const at = isVec(pickup.at) ? structuredClone(pickup.at) : pickup.at;
      if (k.item) give(rt, who, k.item, k.count ?? 1);
      addScore(rt, k.points ?? c.points, { self: pickup.id, actor: who });
      const fx = [...c.onCollect, ...(k.fx || [])];
      delete st().prizes[pickup.id];
      if (rt.entity(pickup.id)) rt.despawn(pickup.id);
      for (const id of targets(k.counter)) if (id === k.counter || !defs.get(id).zone || defs.get(id).zone === zone) countUp(id, who, value, zone, at);
      if (fx.length) rt.run(fx, { self: pickup.id, actor: who });
      return true;
    }
    rt.caches.collect = collect;
    rt.caches.collectCount = (id, who, value) => { for (const t of targets(id)) countUp(t, who, value, rt.entity(who)?.zone ?? null, null); };

    rt.on('interacted', d => { const t = rt.entity(d.target); if (t && counterOf(t)) collect(t, d.who); });
    rt.system('interaction', rt => {
      // Each counter's count and total as vars from the first step: what a person watches for the win (card.loop.win.shown).
      if (!st().totals) { st().totals = computeTotals(); for (const c of config.counters) { rt.state.vars[varOf(c)] ??= 0; rt.state.vars[`collected.${c.id}.total`] = st().totals[c.id]; } }
      const s = st();
      for (const [id, until] of Object.entries(s.prizes)) if (rt.state.frame >= until) { delete s.prizes[id]; if (rt.entity(id)) { rt.despawn(id); rt.emit('prize_expired', { id }); } }
      const collectors = Object.values(rt.state.entities).filter(isCollector);
      for (const who of collectors) {
        if (!rt.entity(who.id) || !isVec(who.at)) continue;
        const wb = boxOf(rt, who), wc = center(rt, who);
        const base = config.magnet + (who.id === 'player' ? rt.state.vars['stat.magnet'] ?? 0 : 0);
        for (const e of Object.values(rt.state.entities)) {
          const k = counterOf(e); if (!k || e === who || e.space !== who.space || !isVec(e.at) || !rt.entity(e.id)) continue;
          const reach = typeof k.magnet === 'number' ? k.magnet : k.magnet === false ? 0 : base;
          if (reach > 0 && !e.components.interact) { const d = len(sub(center(rt, e), wc)); if (d <= reach) pull(rt, e, wc, config.magnetSpeed * rt.dt); }
          if (e.components.interact) continue;
          if (boxesTouch(wb, boxOf(rt, e)) || len(sub(center(rt, e), wc)) <= config.radius) collect(e, who.id);
        }
        // Cell pickups: the collector's cell holds a counter's block.
        const api = rt.space(who.space);
        if (typeof api.getCell === 'function') for (const c of config.counters) if (c.block) {
          const cell = cellPoint(rt, who);
          if (api.getCell(cell) === c.block) { api.setCell(cell, null, rt, who.id); for (const id of targets(c.id)) countUp(id, who.id, c.value, who.zone ?? null, cell); addScore(rt, c.points); if (c.onCollect.length) rt.run(c.onCollect, { actor: who.id }); }
        }
      }
    }, KEY);
    rt.provide('collectible', { count: id => st().count[id] || 0, total: id => totalOf(id), remaining: id => Math.max(0, totalOf(id) - (st().count[id] || 0)) });
  },
};
