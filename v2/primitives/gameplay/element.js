// gameplay.element: chemistry between element tags. Entities carry elements
// through components.element / components.tags / their active statuses' tags;
// cells through their block's tags (content.blocks). A reaction {a, b, result}
// fires when element `a` meets something tagged `b`:
//   - a hit of damage type a lands on an entity tagged b;
//   - a status tagged a is applied to an entity tagged b;
//   - apply_element / ignite spreads a around a point, touching entities and cells;
//   - entities standing in water (space surface capability) get `water`.
// Results are effects run with context {self, target, by}; `who: "target"` and
// `at: "target"` address the reacting entity. Cells that react with a spreading
// rule burn: they hurt whatever stands on them, spread to tagged neighbours with
// probability `spread` per tick, and burn out into `burn.into`.
import { frames, v3, add, posOf, like, spaceOf, resolveWho, combat, hooks, overlapping, round, err } from './combat-lib.js';

const KEY = 'gameplay.element';

export default {
  id: KEY,
  card: {
    intent: 'Element chemistry: element tags on entities, statuses and cells, and reaction rules (fire burns grass, water puts out burning, ice and fire, electricity conducts) triggered by typed hits, statuses, water and ignite effects; burning cells spread and burn out.',
    views: ['any'],
    params: {
      reactions: { type: 'list', min: 1, of: { type: 'object', fields: {
        a: { type: 'string', required: true, effect: 'the incoming element (damage type, status tag or applied element)' },
        b: { type: 'string', required: true, effect: 'the tag it reacts with on an entity, status or cell' },
        result: { type: 'effects', default: [] },
        spread: { type: 'number', default: 0, min: 0, max: 1, effect: 'chance per tick that a burning cell spreads to a neighbour tagged b' },
      } } },
      burn: { type: 'object', default: { sec: 4, tickSec: 0.5, damage: 4, type: 'fire', element: 'fire' }, fields: {
        sec: { type: 'number', default: 4, min: 0.1, max: 600, unit: 's' }, tickSec: { type: 'number', default: 0.5, min: 0.05, max: 10, unit: 's' },
        damage: { type: 'number', default: 4, min: 0 }, type: { type: 'string', default: 'fire' }, element: { type: 'string', default: 'fire' }, into: { type: 'string', effect: 'block a burnt cell becomes; omit to clear it' },
      } },
      water: { type: 'boolean', default: true, effect: 'entities in water get the water element each second (needs a surface space)' },
      maxBurning: { type: 'integer', default: 256, min: 1, max: 10000 },
    },
    provides: { events: ['reaction', 'reaction:*', 'ignited', 'burned_out'] },
    requires: { capabilities: ['overlap'] },
    reads: ['content.blocks'],
  },
  logic(logic) {
    const at = (rt, e, c) => (e.at === 'target' ? rt.entity(c.target)?.at ?? c.cell : e.at === 'self' || e.at === undefined ? resolveWho(rt, e.who ?? 'self', c)?.at ?? rt.entity(c.target)?.at ?? c.cell : e.at);
    logic.effect('apply_element', { run: (e, rt, c) => { const p = at(rt, e, c); if (p != null) rt.service('element').apply(e.element, p, e.r ?? 1, { by: c.by ?? c.self, space: e.space }); } });
    logic.effect('ignite', { run: (e, rt, c) => { const p = at(rt, e, c); if (p != null) rt.service('element').apply(e.element ?? 'fire', p, e.r ?? 1, { by: c.by ?? c.self, space: e.space }); } });
    logic.predicate('element', { test: (p, rt, c) => { const e = resolveWho(rt, p.who, c); return Boolean(e) && rt.service('element').tagsOf(e).includes(p.element); } });
  },
  validate(config) {
    const errors = [], seen = new Set();
    config.reactions.forEach((r, i) => { const k = `${r.a}|${r.b}`; if (seen.has(k)) errors.push(err('element_reaction_duplicate', `with.reactions[${i}]`, `duplicate reaction ${r.a} + ${r.b}`)); seen.add(k); if (r.a === r.b) errors.push(err('element_reaction_invalid', `with.reactions[${i}]`, 'a reaction needs two different elements')); });
    return errors;
  },
  install(rt, config) {
    const S = () => { const s = rt.store(KEY); s.burning ??= {}; return s; };
    const blockTags = id => (rt.doc.content?.blocks || []).find(b => b.id === id)?.tags || [];
    const statusIds = e => Object.keys(e.components.status && typeof e.components.status === 'object' ? e.components.status : {});
    const statusTags = e => statusIds(e).flatMap(id => (rt.doc.content?.statuses || []).find(s => s.id === id)?.tags || []);
    const tagsOf = e => {
      const c = e.components, out = new Set([...(Array.isArray(c.element) ? c.element : c.element ? [c.element] : []), ...(c.tags || []), ...statusTags(e), ...statusIds(e)]);
      const kind = rt.archetype(e.archetype)?.tags; for (const t of kind || []) out.add(t);
      return [...out];
    };
    const depth = () => (rt.caches.elementDepth ?? 0);
    // A reaction never re-triggers on the same subject inside its own chain (fire on a bush ignites around the bush, not the bush again).
    const react = (r, ctx) => {
      const chain = (rt.caches.elementChain ??= new Set()), key = `${r.a}|${r.b}|${ctx.target ?? (ctx.cell || []).join(',')}`;
      if (depth() > 2 || chain.has(key)) return;
      rt.caches.elementDepth = depth() + 1; chain.add(key);
      try { rt.emitTyped('reaction', `${r.a}_${r.b}`, { a: r.a, b: r.b, target: ctx.target ?? null, cell: ctx.cell ?? null }); rt.run(r.result, ctx); }
      finally { rt.caches.elementDepth = depth() - 1; chain.delete(key); }
    };
    const onEntity = (element, e, by = null) => { for (const r of config.reactions) if (r.a === element && tagsOf(e).includes(r.b)) react(r, { self: e.id, target: e.id, by }); };
    const key = c => c.join(',');
    const ignite = (cell, space, element, by) => {
      const s = S(), k = `${space}:${key(cell)}`; if (s.burning[k] || Object.keys(s.burning).length >= config.maxBurning) return false;
      s.burning[k] = { space, at: cell, element, left: frames(config.burn.sec), tick: frames(config.burn.tickSec), by };
      rt.emit('ignited', { space, at: cell, element }); return true;
    };
    const api = {
      tagsOf,
      reactionsFor: (a, b) => config.reactions.filter(r => r.a === a && r.b === b),
      /** Apply an element in radius r around `at`: react with entities and cells there. */
      apply(element, at, r = 1, { by = null, space = null } = {}) {
        const sp = space ?? rt.entity(by)?.space ?? rt.doc.spaces[0].id, p = v3(at);
        for (const id of overlapping(rt, sp, { kind: 'sphere', at: p, r }, () => true)) { const e = rt.entity(id); if (e) onEntity(element, e, by); }
        let api; try { api = rt.space(sp); } catch { return; }
        if (!api.cellsIn) return;
        const lo = p.map((v, i) => Math.floor(v - (i === 2 && api.size?.[2] <= 1 ? 0 : r))), hi = p.map((v, i) => Math.floor(v + (i === 2 && api.size?.[2] <= 1 ? 0 : r)));
        for (const { at: c, block } of api.cellsIn([lo, hi])) {
          for (const rule of config.reactions) if (rule.a === element && blockTags(block).includes(rule.b)) {
            const fresh = rule.spread > 0 || element === config.burn.element ? ignite(c, sp, element, by) : true;
            if (fresh && depth() === 0) react(rule, { cell: c, by, self: by });
          }
        }
      },
      burning: () => Object.values(S().burning).map(b => ({ space: b.space, at: b.at, left: b.left })),
    };
    rt.provide('element', api);
    hooks(rt).damaged.push((target, hit) => { if (hit.type && hit.source !== 'element') onEntity(hit.type, target, hit.by); for (const t of hit.tags || []) if (t !== hit.type) onEntity(t, target, hit.by); });
    rt.on('status_applied', ({ who, status, by }) => {
      const e = rt.entity(who); if (!e) return;
      const tags = (rt.doc.content?.statuses || []).find(s => s.id === status)?.tags || [];
      for (const a of tags) for (const r of config.reactions) if (r.a === a && tagsOf(e).filter(t => t !== status && !tags.includes(t)).includes(r.b)) react(r, { self: e.id, target: e.id, by });
    });
    rt.system('rules', rt => {
      const s = S();
      for (const [k, b] of Object.entries(s.burning)) {
        let api; try { api = rt.space(b.space); } catch { delete s.burning[k]; continue; }
        if (--b.tick <= 0) {
          b.tick = frames(config.burn.tickSec);
          for (const id of overlapping(rt, b.space, { kind: 'aabb', at: add(v3(b.at), [0, 1, 0]), size: [1, 1, 1] }, e => Boolean(e.components.health))) combat(rt)?.hit(rt.entity(id), { amount: config.burn.damage * config.burn.tickSec, type: config.burn.type, source: 'element', noIframes: true, ignoreIframes: true, by: b.by });
          for (const rule of config.reactions) if (rule.a === b.element && rule.spread > 0) {
            const plane = api.size?.[2] <= 1 ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] : [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
            for (const d of plane) { const n = add(v3(b.at), d); const blk = api.getCell?.(n); if (blk && !s.burning[`${b.space}:${key(n)}`] && blockTags(blk).includes(rule.b) && rt.random() < rule.spread) ignite(n, b.space, b.element, b.by); }
          }
        }
        if (--b.left <= 0) { delete s.burning[k]; if (api.setCell) api.setCell(b.at, config.burn.into ?? null, rt, 'fire'); rt.emit('burned_out', { space: b.space, at: b.at }); }
      }
      if (config.water && rt.state.frame % 60 === 0) for (const e of Object.values(rt.state.entities)) {
        if (!Array.isArray(e.at) || !e.components.health) continue;
        const api = spaceOf(rt, e); if (!api?.waterDepthAt) continue;
        const p = v3(e.at); if (api.waterDepthAt(p[0], p[2]) > 0 || api.waterDepthAt(p[0], p[1]) > 0 && e.at.length === 2) onEntity('water', e, null);
      }
    }, KEY);
  },
};
export { round, like, posOf };
