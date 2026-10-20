// Crafting: content.recipes at stations, with item or tag inputs, craft times
// and queues, recipe discovery (known / learned / experiment) and cooking-style
// merges where the output carries the summed ingredient effects of what went in.
//   recipe { id, station?: station id | station tag, inputs: [{item|tag, count}], output: {item, count},
//            time?: s, learned?: bool | flag id, merge?: b }
// A station is available when an entity with components.station = id is within
// `stationRange`, or the crafter stands in the station's zone.
import { compare } from '../../kernel/logic.js';
import { bag, give, take, room } from './inventory.js';
import { item as itemDef, tokens, whoKey, dist } from './items-lib.js';
import { META } from './item-use.js';

const KEY = 'gameplay.crafting';
const parse = v => (typeof v === 'string' ? { recipe: v, count: 1 } : { recipe: v?.recipe, count: Math.max(1, v?.count ?? 1) });

export default {
  id: 'gameplay.crafting',
  card: {
    intent: 'Recipes at stations with item or tag inputs, craft times and queues, recipe discovery (known, learned, or experiment by combining items) and cooking-style merges whose output carries the summed ingredient effects.',
    views: ['any'],
    params: {
      stations: { type: 'list', default: [], of: { type: 'object', fields: { id: { type: 'string', required: true }, name: { type: 'string' }, tags: { type: 'list', default: [], of: { type: 'string' } }, zone: { type: 'ref', to: 'zone', effect: 'standing in this zone counts as being at the station' } } }, effect: 'crafting stations' },
      handCraft: { type: 'boolean', default: true, effect: 'recipes without a station can be crafted anywhere' },
      stationRange: { type: 'number', default: 3, min: 0, max: 50, unit: 'space units', effect: 'distance to a station entity that counts as being at it' },
      queue: { type: 'boolean', default: false, effect: 'timed recipes queue up; false allows one timed job at a time' },
      maxQueue: { type: 'integer', default: 8, min: 1, max: 100 },
      merge: { type: 'object', default: { enabled: false, stat: 'effects' }, fields: { enabled: { type: 'boolean', default: false }, stat: { type: 'string', default: 'effects', effect: 'ingredient field summed into the output (ingredient.<stat>)' } }, effect: 'cooking: merge recipes sum their ingredients’ effects into the crafted item' },
      discover: { type: 'string', default: 'known', options: ['known', 'learned', 'experiment'], effect: 'known: every recipe; learned: recipe.learned / flag / learn_recipe; experiment: also by combining matching inputs' },
      failItem: { type: 'ref', to: 'item', effect: 'experiment: combining inputs that match no recipe consumes them and yields this item (dubious food); unset = nothing happens' },
    },
    provides: { events: ['crafted', 'crafted:*', 'craft_started', 'craft_failed', 'recipe_learned', 'recipe_learned:*'], actions: ['craft', 'combine', 'cancel_craft'], services: ['crafting'] },
    requires: { primitives: ['gameplay.inventory'] },
    reads: ['content.recipes', 'content.items', 'content.archetypes'],
    defines: [{ kind: 'station', in: 'stations' }],
  },
  logic(logic) {
    const api = rt => rt.caches.crafting;
    logic.predicate('knows', { refs: p => [['recipe', p.knows]], test: (p, rt) => Boolean(api(rt)?.known(p.knows)) });
    logic.predicate('crafting', { test: (p, rt, c) => compare(api(rt)?.jobs(whoKey(p.who, c)).length ?? 0, p) });
    logic.effect('learn_recipe', { refs: e => [['recipe', e.recipe]], run: (e, rt) => api(rt)?.learn(e.recipe) });
    logic.effect('craft', { refs: e => [['recipe', e.recipe]], run: (e, rt, c) => api(rt)?.craft(whoKey(e.who, c), e.recipe, e.count ?? 1, { anywhere: e.anywhere ?? true }) });
  },
  validate(config, doc) {
    const errors = [], items = new Set((doc.content?.items || []).map(i => i.id));
    const stations = new Set(config.stations.flatMap(s => [s.id, ...s.tags]));
    (doc.content?.recipes || []).forEach((r, i) => {
      const path = `content.recipes[${i}]`;
      if (r.station != null && !stations.has(r.station)) errors.push({ code: 'recipe_invalid', path: `${path}.station`, message: `unknown station '${r.station}'`, hint: [...stations].join(', ') || 'no stations' });
      if (!Array.isArray(r.inputs) || !r.inputs.length) errors.push({ code: 'recipe_invalid', path: `${path}.inputs`, message: 'needs at least one input' });
      (r.inputs || []).forEach((x, k) => {
        if (x.item == null && x.tag == null) errors.push({ code: 'recipe_invalid', path: `${path}.inputs[${k}]`, message: 'input needs item or tag' });
        if (x.item != null && !items.has(x.item)) errors.push({ code: 'ref_unknown', path: `${path}.inputs[${k}].item`, message: `unknown item '${x.item}'` });
        if (x.count !== undefined && !(Number.isInteger(x.count) && x.count >= 1)) errors.push({ code: 'recipe_invalid', path: `${path}.inputs[${k}].count`, message: 'count must be a positive integer' });
      });
      if (!r.output?.item || !items.has(r.output.item)) errors.push({ code: 'ref_unknown', path: `${path}.output.item`, message: `unknown output item '${r.output?.item}'` });
      if (r.time !== undefined && !(Number.isFinite(r.time) && r.time >= 0)) errors.push({ code: 'recipe_invalid', path: `${path}.time`, message: 'time must be a non-negative number' });
    });
    return errors;
  },
  install(rt, config) {
    const recipes = () => { if (rt.caches.recipesDoc !== rt.doc) { rt.caches.recipesDoc = rt.doc; rt.caches.recipes = new Map((rt.doc.content?.recipes || []).map(r => [r.id, r])); } return rt.caches.recipes; };
    const st = () => { const s = rt.store(KEY); s.known ??= {}; s.jobs ??= {}; return s; };
    st(); // created at install, so reads later never add state
    const mergeOn = r => r.merge ?? config.merge.enabled;
    function known(id) {
      const r = recipes().get(id); if (!r) return false;
      if (config.discover === 'known' || st().known[id] || r.learned === true) return true;
      return typeof r.learned === 'string' && Boolean(rt.state.flags[r.learned]);
    }
    function learn(id) { if (!recipes().has(id) || st().known[id]) return; st().known[id] = true; rt.emitTyped('recipe_learned', id, { recipe: id }); }
    function stationsAt(who) {
      const a = rt.entity(who), out = new Set(); if (!a) return out;
      for (const s of config.stations) if (s.zone && a.zone === s.zone) out.add(s.id);
      for (const e of Object.values(rt.state.entities)) {
        const id = typeof e.components.station === 'string' ? e.components.station : e.components.station?.id;
        if (id && e.space === a.space && dist(rt, a, e) <= config.stationRange) out.add(id);
      }
      return out;
    }
    const stationOk = (r, at) => (r.station == null ? config.handCraft || at.size > 0 : config.stations.some(s => at.has(s.id) && (s.id === r.station || s.tags.includes(r.station))));
    /** Choose bag items for n crafts; returns [{item, count}] or null. Tag inputs take the cheapest matching items first. */
    function plan(who, r, n, from = bag(rt, who)) {
      const left = { ...from }, takes = [];
      const grab = (id, k) => { left[id] -= k; if (!left[id]) delete left[id]; const t = takes.find(x => x.item === id); if (t) t.count += k; else takes.push({ item: id, count: k }); };
      for (const x of [...r.inputs].sort((a, b) => (a.item ? 0 : 1) - (b.item ? 0 : 1))) {
        let need = (x.count ?? 1) * n;
        if (x.item) { if ((left[x.item] || 0) < need) return null; grab(x.item, need); continue; }
        const cands = Object.keys(left).filter(id => tokens(itemDef(rt, id) || { id }).has(x.tag)).sort((a, b) => (itemDef(rt, a)?.value ?? 0) - (itemDef(rt, b)?.value ?? 0) || (a < b ? -1 : 1));
        for (const id of cands) { if (!need) break; const k = Math.min(need, left[id]); grab(id, k); need -= k; }
        if (need) return null;
      }
      return takes;
    }
    function mergedEffects(takes) {
      const out = {};
      for (const t of takes) for (const [k, v] of Object.entries(itemDef(rt, t.item)?.ingredient?.[config.merge.stat] || {})) if (Number.isFinite(v)) out[k] = (out[k] ?? 0) + v * t.count;
      return out;
    }
    // Each crafted unit carries an equal share of everything that went in.
    const perUnit = (fx, units) => Object.fromEntries(Object.entries(fx).map(([k, v]) => [k, +(v / units).toFixed(4)]));
    function finish(who, r, n, effects) {
      const k = give(rt, who, r.output.item, (r.output.count ?? 1) * n);
      if (effects && k) { const meta = (rt.store(META)[who] ??= {}); const list = (meta[r.output.item] ??= []); for (let i = 0; i < k; i++) list.push({ effects, recipe: r.id }); }
      rt.emitTyped('crafted', r.id, { who, recipe: r.id, item: r.output.item, count: k, ...(effects ? { effects } : {}) });
    }
    function craft(who, id, n = 1, { anywhere = false } = {}) {
      const r = recipes().get(id), fail = reason => { rt.emit('craft_failed', { who, recipe: id, reason }); return false; };
      if (!r) return fail('unknown');
      if (!known(id)) return fail('unknown');
      if (!anywhere && !stationOk(r, stationsAt(who))) return fail('station');
      const takes = plan(who, r, n); if (!takes) return fail('missing');
      const jobs = (st().jobs[who] ??= []);
      if (r.time > 0 && (config.queue ? jobs.length >= config.maxQueue : jobs.length > 0)) return fail('busy');
      if (room(rt, who, r.output.item) < (r.output.count ?? 1) * n) return fail('full');
      for (const t of takes) take(rt, who, t.item, t.count);
      const effects = mergeOn(r) ? perUnit(mergedEffects(takes), (r.output.count ?? 1) * n) : null;
      if (r.time > 0) { jobs.push({ recipe: id, count: n, left: Math.round(r.time * n / rt.dt), effects, takes }); rt.emit('craft_started', { who, recipe: id, count: n, sec: r.time * n }); }
      else finish(who, r, n, effects);
      return true;
    }
    function combine(who, list) {
      const offered = {};
      for (const x of list) { const it = typeof x === 'string' ? { item: x, count: 1 } : x; offered[it.item] = (offered[it.item] || 0) + (it.count ?? 1); }
      const held = bag(rt, who);
      if (Object.entries(offered).some(([id, k]) => (held[id] || 0) < k)) { rt.emit('craft_failed', { who, recipe: null, reason: 'missing' }); return false; }
      const at = stationsAt(who), total = Object.values(offered).reduce((a, b) => a + b, 0);
      // A recipe matches when its inputs consume exactly the offered items.
      const r = [...recipes().values()].sort((a, b) => (a.id < b.id ? -1 : 1)).find(r => { if (!stationOk(r, at)) return false; const t = plan(who, r, 1, offered); return t && t.reduce((s, x) => s + x.count, 0) === total; });
      if (r) { if (!known(r.id)) learn(r.id); return craft(who, r.id, 1); }
      if (config.discover === 'experiment' && config.failItem) { for (const [id, k] of Object.entries(offered)) take(rt, who, id, k); give(rt, who, config.failItem, 1); rt.emit('craft_failed', { who, recipe: null, reason: 'no_recipe', consumed: offered }); return false; }
      rt.emit('craft_failed', { who, recipe: null, reason: 'no_recipe' });
      return false;
    }
    rt.caches.crafting = { known, learn, craft, jobs: who => st().jobs[who] || [] };
    rt.on('interacted', d => { const t = rt.entity(d.target); const id = typeof t?.components.station === 'string' ? t.components.station : t?.components.station?.id; if (id) rt.emit('station_opened', { who: d.who, station: id }); });
    rt.system('rules', rt => {
      for (const [who, jobs] of Object.entries(st().jobs)) {
        const job = jobs[0]; if (!job) continue;
        if (--job.left > 0) continue;
        jobs.shift(); finish(who, recipes().get(job.recipe), job.count, job.effects);
      }
    }, KEY);
    rt.action('craft', (v, rt) => { const { recipe, count: n } = parse(v); craft('player', recipe, n); });
    if (config.discover === 'experiment') rt.action('combine', (v, rt) => combine('player', Array.isArray(v) ? v : v?.items || []));
    rt.action('cancel_craft', (v, rt) => {
      const jobs = st().jobs.player || [], i = typeof v === 'number' ? v : jobs.length - 1, job = jobs[i]; if (!job) return;
      jobs.splice(i, 1);
      for (const t of job.takes) give(rt, 'player', t.item, t.count);
      rt.emit('craft_cancelled', { who: 'player', recipe: job.recipe });
    });
    const craftable = who => { const at = stationsAt(who); return [...recipes().values()].filter(r => known(r.id) && stationOk(r, at) && plan(who, r, 1)).map(r => r.id).sort(); };
    rt.options(rt => craftable('player').slice(0, 12).map(id => { const r = recipes().get(id); return { label: `craft ${id}`, actions: { craft: id }, steps: r.time > 0 ? Math.round(r.time / rt.dt) + 1 : 1 }; }));
    rt.provide('crafting', {
      station: (who = 'player') => { const at = [...stationsAt(who)].sort()[0]; const s = config.stations.find(x => x.id === at); return s ? { id: s.id, name: s.name ?? s.id, tags: s.tags } : null; },
      craftable: (who = 'player') => craftable(who), known: () => [...recipes().keys()].filter(known), jobs: (who = 'player') => structuredClone(st().jobs[who] || []),
    });
  },
};
