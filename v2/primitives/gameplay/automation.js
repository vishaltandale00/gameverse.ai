// gameplay.automation: factory logistics over editable cells. Cell ids are
// mapped to roles: belts (direction, speed; items ride with spacing and
// capacity, queue at blocked ends and hop onto the next cell), inserters
// (swing items from one neighbour to another), machines (craft content.recipes
// from an input buffer into an output buffer they push forward), sources
// (drills/spawners emitting items) and sinks (chests, delivery points).
// Players build the factory with any cell-editing primitive; the layout is
// discovered from the space (cellsIn) and kept current from its edit log.
// Throughput is published per item as vars (delivered, produced, per-minute rate).
import { err, r6, cellKey, keyCell, v3, has } from './modes-lib-util.js';

const ID = 'gameplay.automation';
const DIRS = { e: [1, 0, 0], w: [-1, 0, 0], n: [0, 1, 0], s: [0, -1, 0], u: [0, 0, 1], d: [0, 0, -1] };
const dirOf = d => (typeof d === 'string' ? DIRS[d] : v3(d));

export default {
  id: ID,
  card: {
    intent: 'Factory automation on editable cells: conveyor belts with item spacing and back-pressure, inserters, recipe machines with buffers, item sources and sinks, layout read from the cell grid and its edit log, and per-item throughput vars.',
    views: ['td', 'iso', '3p'],
    params: {
      belts: { type: 'object', open: true, default: {}, effect: 'cell id -> {dir: e|w|n|s|u|d|[dx,dy,dz], speed cells/s}' },
      inserters: { type: 'object', open: true, default: {}, effect: 'cell id -> {from: dir, to: dir, swingSec, stack}' },
      machines: { type: 'object', open: true, default: {}, effect: 'cell id -> {recipes: [recipe ids], speed, out: dir, buffer}' },
      sources: { type: 'object', open: true, default: {}, effect: 'cell id -> {item, every s, out: dir, count}' },
      sinks: { type: 'object', open: true, default: {}, effect: 'cell id -> {accept: [items] (all when omitted), capacity}' },
      area: { type: 'json', effect: '[[min],[max]] cell box to scan at start (default: the whole space)' },
      beltCapacity: { type: 'integer', default: 4, min: 1, max: 16, effect: 'items per belt cell' },
      spacing: { type: 'number', default: 0.25, min: 0.05, max: 1, effect: 'minimum gap between items on a belt (cells)' },
      rateWindowSec: { type: 'number', default: 60, min: 1, max: 3600, unit: 's' },
    },
    provides: { events: ['item_produced', 'item_produced:*', 'item_delivered', 'item_delivered:*', 'machine_started', 'item_lost'], vars: ['auto.delivered.*', 'auto.produced.*', 'auto.rate.*', 'auto.items'] },
    requires: { capabilities: ['editCells'] },
    reads: ['content.recipes'],
  },
  logic(logic) {
    logic.effect('insert_item', { check: (e, path, errors) => { if (!e.item || !Array.isArray(e.at)) errors.push(err('effect_invalid', path, 'insert_item needs item and at')); }, run: (e, rt) => { for (let i = 0; i < (e.count ?? 1); i++) rt.service('automation').insert(e.at, e.item); } });
  },
  validate(config, doc) {
    const errors = [], recipes = new Set((doc.content?.recipes || []).map(r => r.id)), blocks = doc.content?.blocks ? new Set(doc.content.blocks.map(b => b.id)) : null;
    const roles = ['belts', 'inserters', 'machines', 'sources', 'sinks'];
    if (roles.every(r => !Object.keys(config[r]).length)) errors.push(err('automation_empty', 'with', 'map at least one cell id to a role'));
    const seen = new Map();
    for (const role of roles) for (const [id, d] of Object.entries(config[role])) {
      const path = `with.${role}.${id}`;
      if (seen.has(id)) errors.push(err('automation_role', path, `cell '${id}' is already a ${seen.get(id)}`)); seen.set(id, role);
      if (blocks && !blocks.has(id)) errors.push(err('ref_unknown', path, `unknown block '${id}'`));
      for (const k of ['dir', 'from', 'to', 'out']) if (d[k] !== undefined && !(typeof d[k] === 'string' ? DIRS[d[k]] : Array.isArray(d[k]) && d[k].every(Number.isInteger) && d[k].some(Boolean))) errors.push(err('automation_dir', `${path}.${k}`, `${k} must be e|w|n|s|u|d or a non-zero integer offset`));
      if (role === 'belts' && d.dir === undefined) errors.push(err('automation_dir', `${path}.dir`, 'belts need dir'));
      if (role === 'inserters' && (d.from === undefined || d.to === undefined)) errors.push(err('automation_dir', path, 'inserters need from and to'));
      if (role === 'machines') { if (!Array.isArray(d.recipes) || !d.recipes.length) errors.push(err('automation_recipe', `${path}.recipes`, 'machines need recipes')); for (const r of d.recipes || []) if (!recipes.has(r)) errors.push(err('automation_recipe', `${path}.recipes`, `unknown recipe '${r}'`)); if (d.out === undefined) errors.push(err('automation_dir', `${path}.out`, 'machines need out')); }
      if (role === 'sources' && (!d.item || !(d.every > 0) || d.out === undefined)) errors.push(err('automation_source', path, 'sources need item, every > 0 and out'));
    }
    return errors;
  },
  install(rt, config, instance) {
    const sid = instance.space ?? rt.doc.spaces[0].id, F = s => Math.max(1, Math.round(s * 60));
    const space = () => rt.space(sid);
    const st = () => { const s = rt.store(ID); s.items ??= {}; s.mach ??= {}; s.ins ??= {}; s.src ??= {}; s.sink ??= {}; s.delivered ??= {}; s.produced ??= {}; s.window ??= []; return s; };
    const recipe = id => (rt.doc.content?.recipes || []).find(r => r.id === id);
    const outputsOf = r => (r.outputs || (r.output ? [r.output] : [])).map(o => ({ item: o.item, count: o.count ?? 1 }));
    const inputsOf = r => (r.inputs || []).map(i => ({ item: i.item, count: i.count ?? 1 }));
    const roleOf = block => (config.belts[block] ? 'belt' : config.inserters[block] ? 'inserter' : config.machines[block] ? 'machine' : config.sources[block] ? 'source' : config.sinks[block] ? 'sink' : null);
    const defOf = (role, block) => ({ belt: config.belts, inserter: config.inserters, machine: config.machines, source: config.sources, sink: config.sinks })[role][block];

    // Layout index (derived): rebuilt from a scan, then kept current from the edit log.
    const ckey = `${ID}:${sid}:layout`;
    function scan() {
      const api = space(), cells = new Map();
      const box = config.area ?? (api.size ? [[0, 0, 0], api.size.map(n => n - 1)] : null);
      if (box && has(api, 'cellsIn')) for (const c of api.cellsIn(box)) { const role = roleOf(c.block); if (role) cells.set(cellKey(c.at), { role, block: c.block }); }
      const log = has(api, 'editLog') ? api.editLog() : [];
      rt.caches[ckey] = { cells, logLen: log.length };
    }
    function layout(s) {
      if (!rt.caches[ckey]) scan();
      const L = rt.caches[ckey], log = space().editLog();
      if (log.length < L.logLen) { scan(); return rt.caches[ckey]; }
      for (const e of log.slice(L.logLen)) {
        const k = cellKey(e.at), role = roleOf(e.to);
        if (role) L.cells.set(k, { role, block: e.to });
        else if (L.cells.has(k)) { L.cells.delete(k); drop(s, k); }
      }
      L.logLen = log.length;
      return L;
    }
    rt.onRestore(() => { delete rt.caches[ckey]; });
    function drop(s, k) {
      for (const it of s.items[k] || []) rt.emit('item_lost', { item: it.item, at: keyCell(k) });
      delete s.items[k]; delete s.mach[k]; delete s.ins[k]; delete s.src[k];
    }
    const neighbour = (k, d) => cellKey(keyCell(k).map((x, i) => x + (dirOf(d)[i] ?? 0)));

    /** Offer an item to the cell at key k. Returns true when it was taken. */
    function accept(s, L, k, item) {
      const c = L.cells.get(k); if (!c) return false;
      if (c.role === 'belt') {
        const list = (s.items[k] ??= []);
        if (list.length >= config.beltCapacity || list.some(x => x.p < config.spacing)) return false;
        list.push({ item, p: 0, f: rt.state.frame }); return true;
      }
      if (c.role === 'machine') {
        const d = defOf('machine', c.block), m = (s.mach[k] ??= { inv: {}, out: {}, recipe: null, t: 0 });
        const wanted = d.recipes.some(r => inputsOf(recipe(r) || {}).some(i => i.item === item));
        if (!wanted || (m.inv[item] ?? 0) >= (d.buffer ?? 10)) return false;
        m.inv[item] = (m.inv[item] ?? 0) + 1; return true;
      }
      if (c.role === 'sink') {
        const d = defOf('sink', c.block), store = (s.sink[k] ??= {});
        if (d.accept && !d.accept.includes(item)) return false;
        if (d.capacity && Object.values(store).reduce((a, b) => a + b, 0) >= d.capacity) return false;
        store[item] = (store[item] ?? 0) + 1; s.delivered[item] = (s.delivered[item] ?? 0) + 1;
        s.window.push({ t: rt.state.frame, item });
        rt.emitTyped('item_delivered', item, { item, at: keyCell(k) });
        return true;
      }
      return false;
    }
    /** Take one item out of the cell at key k (belts, machine outputs, sink storage). */
    function take(s, L, k) {
      const c = L.cells.get(k); if (!c) return null;
      if (c.role === 'belt') { const list = s.items[k] || []; if (!list.length) return null; list.sort((a, b) => b.p - a.p); return list.shift().item; }
      if (c.role === 'machine') { const m = s.mach[k]; const item = m && Object.keys(m.out).sort().find(i => m.out[i] > 0); if (!item) return null; if (!--m.out[item]) delete m.out[item]; return item; }
      if (c.role === 'sink') { const store = s.sink[k]; const item = store && Object.keys(store).sort().find(i => store[i] > 0); if (!item) return null; if (!--store[item]) delete store[item]; return item; }
      return null;
    }

    rt.provide('automation', {
      insert: (at, item) => { const s = st(); return accept(s, layout(s), cellKey(at), item); },
      itemsAt: at => (st().items[cellKey(at)] || []).map(x => ({ item: x.item, p: x.p })),
      machine: at => structuredClone(st().mach[cellKey(at)] ?? null),
      stored: at => ({ ...(st().sink[cellKey(at)] || {}) }),
    });

    rt.system('physics', rt => {
      const s = st(), L = layout(s), dt = rt.dt, f = rt.state.frame;
      const keys = [...L.cells.keys()].sort();
      // Sources.
      for (const k of keys) {
        const c = L.cells.get(k); if (c.role !== 'source') continue;
        const d = defOf('source', c.block), q = (s.src[k] ??= { t: 0 });
        q.t = Math.min(q.t + 1, F(d.every));
        if (q.t >= F(d.every)) { let ok = true; for (let i = 0; i < (d.count ?? 1) && ok; i++) ok = accept(s, L, neighbour(k, d.out), d.item); if (ok) q.t = 0; }
      }
      // Machines: start a recipe whose inputs are buffered, progress it, push outputs forward.
      for (const k of keys) {
        const c = L.cells.get(k); if (c.role !== 'machine') continue;
        const d = defOf('machine', c.block), m = (s.mach[k] ??= { inv: {}, out: {}, recipe: null, t: 0 });
        if (!m.recipe) for (const rid of d.recipes) {
          const r = recipe(rid); if (!r) continue;
          const ins = inputsOf(r); if (!ins.every(i => (m.inv[i.item] ?? 0) >= i.count)) continue;
          const outN = Object.values(m.out).reduce((a, b) => a + b, 0); if (outN >= (d.buffer ?? 10)) break;
          for (const i of ins) { m.inv[i.item] -= i.count; if (!m.inv[i.item]) delete m.inv[i.item]; }
          m.recipe = rid; m.t = 0; rt.emit('machine_started', { at: keyCell(k), recipe: rid }); break;
        }
        if (m.recipe) {
          const r = recipe(m.recipe); m.t = r6(m.t + dt * (d.speed ?? 1));
          if (m.t >= (r.time ?? 1)) { for (const o of outputsOf(r)) { m.out[o.item] = (m.out[o.item] ?? 0) + o.count; s.produced[o.item] = (s.produced[o.item] ?? 0) + o.count; rt.emitTyped('item_produced', o.item, { item: o.item, count: o.count, at: keyCell(k), recipe: m.recipe }); } m.recipe = null; m.t = 0; }
        }
        const item = Object.keys(m.out).sort().find(i => m.out[i] > 0);
        if (item && accept(s, L, neighbour(k, d.out), item)) { if (!--m.out[item]) delete m.out[item]; }
      }
      // Inserters.
      for (const k of keys) {
        const c = L.cells.get(k); if (c.role !== 'inserter') continue;
        const d = defOf('inserter', c.block), q = (s.ins[k] ??= { t: 0, hand: [] }), swing = F(d.swingSec ?? 0.5);
        q.t = Math.min(q.t + 1, swing);
        if (!q.hand.length && q.t >= swing / 2) { for (let i = 0; i < (d.stack ?? 1); i++) { const it = take(s, L, neighbour(k, d.from)); if (!it) break; q.hand.push(it); } }
        if (q.hand.length && q.t >= swing) { while (q.hand.length && accept(s, L, neighbour(k, d.to), q.hand[0])) q.hand.shift(); if (!q.hand.length) q.t = 0; }
      }
      // Belts: furthest items first; spacing behind the item ahead; hop at the end.
      for (const k of keys) {
        const c = L.cells.get(k); if (c.role !== 'belt' || !s.items[k]?.length) continue;
        const d = defOf('belt', c.block), list = s.items[k].sort((a, b) => b.p - a.p), keep = [];
        let ahead = Infinity;
        for (const it of list) {
          if (it.f === f) { keep.push(it); ahead = it.p - config.spacing; continue; }
          it.p = r6(Math.min(1, it.p + (d.speed ?? 2) * dt, ahead));
          if (it.p >= 1 && accept(s, L, neighbour(k, d.dir), it.item)) continue;
          keep.push(it); ahead = it.p - config.spacing;
        }
        s.items[k] = keep; if (!keep.length) delete s.items[k];
      }
      // Throughput.
      const win = F(config.rateWindowSec);
      while (s.window.length && s.window[0].t <= f - win) s.window.shift();
      const v = rt.state.vars, rate = {};
      for (const w of s.window) rate[w.item] = (rate[w.item] ?? 0) + 1;
      for (const item of Object.keys(s.delivered)) { v[`auto.delivered.${item}`] = s.delivered[item]; v[`auto.rate.${item}`] = r6((rate[item] ?? 0) * 60 / config.rateWindowSec); }
      for (const item of Object.keys(s.produced)) v[`auto.produced.${item}`] = s.produced[item];
      v['auto.items'] = Object.values(s.items).reduce((t, l) => t + l.length, 0);
    }, ID);
  },
};
