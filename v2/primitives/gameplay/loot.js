// Loot tables (content.tables) for drops, chests, fishing and forage:
//   { id, rolls: [a,b], chance?: 0..1, pity?: n, unique?: b, always?: [{item,count}],
//     entries: [{ item | table | null (nothing), weight, count?: [a,b], when?: pred }] } (card.data)
// `when` is tested with self = the dropper. `chance` gates the whole drop and a
// pity meter guarantees one after `pity` misses (the shmup drop meter). Drops go
// to a bag or into the world as `pickup` entities that a magnet draws to the
// player. Entities with a `loot` component (table id) drop when they die.
import { give, room } from './inventory.js';
import { ID_PATTERN } from '../../kernel/sections.js';
import { RANGE, roll, pick, whoKey, isVec, center, len, sub, pull, boxOf, boxesTouch } from './items-lib.js';

const KEY = 'gameplay.loot';
const tables = rt => { if (rt.caches.lootDoc !== rt.doc) { rt.caches.lootDoc = rt.doc; rt.caches.loot = new Map((rt.doc.content?.tables || []).map(t => [t.id, t])); } return rt.caches.loot; };

/** Roll a table into [{item, count}] (merged by item). Advances the table's pity meter. */
export function rollTable(rt, id, context = {}, depth = 0) {
  const t = tables(rt).get(id); if (!t || depth > 4) return [];
  const s = rt.store(KEY); s.meter ??= {};
  if (t.chance != null && t.chance < 1) {
    const due = t.pity != null && (s.meter[id] || 0) + 1 >= t.pity;
    if (!due && rt.random() >= t.chance) { s.meter[id] = (s.meter[id] || 0) + 1; return []; }
    s.meter[id] = 0;
  }
  const out = new Map(), addOut = (item, n) => { if (item && n > 0) out.set(item, (out.get(item) || 0) + n); };
  for (const a of t.always || []) addOut(a.item, roll(rt, a.count, 1));
  const n = roll(rt, t.rolls, 1), used = new Set();
  for (let i = 0; i < n; i++) {
    const pool = (t.entries || []).filter((e, k) => !(t.unique && used.has(k)) && (!e.when || rt.test(e.when, context)));
    const e = pick(rt, pool); if (!e) break;
    used.add(t.entries.indexOf(e));
    if (e.table) for (const x of rollTable(rt, e.table, context, depth + 1)) addOut(x.item, x.count);
    else addOut(e.item, roll(rt, e.count, 1));
  }
  return [...out].map(([item, count]) => ({ item, count }));
}

export default {
  id: 'gameplay.loot',
  card: {
    loop: { verbs: [], progress: ['loot_dropped', 'picked_up'] },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "section", "at": "content.tables", "min": 1, "why": "loot drops roll from tables", "example": {"id": "drop_small", "rolls": [1, 1], "entries": [{"item": "coin", "weight": 3}]}},
    ],
    intent: 'Loot tables for drops, chests, forage and fishing: weighted rolls with `when` predicates, nested tables, a drop chance with a pity meter, drops into a bag or into the world as magnet pickups; entities with a `loot` component drop on death.',
    views: ['any'],
    params: {
      dropTo: { type: 'string', default: 'bag', options: ['bag', 'world'], effect: 'where death drops go: straight into the killer’s bag, or pickups in the world' },
      onDeath: { type: 'boolean', default: true, effect: 'entities with a `loot` component drop when they die (died/defeated events)' },
      magnet: { type: 'number', default: 0, min: 0, max: 100, unit: 'space units', effect: 'world pickups within this radius drift to the player (pickup `magnet` component and var stat.magnet add)' },
      magnetSpeed: { type: 'number', default: 8, min: 0, max: 200, unit: 'units/s' },
      scatter: { type: 'number', default: 0.5, min: 0, max: 10, unit: 'space units', effect: 'random spread of world pickups around the drop point' },
      pickupArchetype: { type: 'ref', to: 'archetype', effect: 'archetype for world pickups (gets a pickup component)' },
      despawnSec: { type: 'number', default: 0, min: 0, unit: 's', effect: 'world pickups vanish after this long; 0 = never' },
    },
    provides: { events: ['loot_dropped', 'loot_dropped:*', 'picked_up', 'picked_up:*'], services: ['loot'] },
    reads: ['content.tables', 'content.archetypes'],
    defines: [{ kind: 'table', at: 'content.tables' }],
    // The section it owns, whole.
    data: { 'content.tables': { type: 'list', of: { type: 'object', fields: {
      id: { type: 'string', pattern: ID_PATTERN, required: true },
      rolls: { ...RANGE, effect: 'entries rolled per drop, [min, max] (default [1, 1])' },
      chance: { type: 'number', min: 0, max: 1, effect: 'chance the table drops at all' },
      pity: { type: 'integer', min: 1, effect: 'a drop is guaranteed after this many misses' },
      unique: { type: 'boolean', effect: 'an entry is rolled at most once per drop' },
      always: { type: 'list', of: { type: 'object', fields: { item: { type: 'ref', to: 'item', required: true }, count: RANGE } }, effect: 'dropped every time' },
      entries: { type: 'list', required: true, of: { type: 'object', fields: {
        item: { type: 'ref', to: 'item', effect: 'the item (neither item nor table: nothing)' }, table: { type: 'ref', to: 'table', effect: 'a nested table rolled instead' },
        weight: { type: 'number', min: 0 }, count: RANGE, when: { type: 'predicate', effect: 'rollable only while it holds (self = the dropper)' },
      } } },
    } } } },
    // Shapes of the archetype components this primitive owns.
    components: {
      loot: { type: 'ref', to: 'table', effect: 'the table it drops when it dies (or when looted)' },
      pickup: { type: 'object', fields: { item: { type: 'ref', to: 'item', required: true }, count: { type: 'integer', min: 1 } }, effect: 'a world pickup: touching it takes the item' },
      magnet: { type: 'number', min: 0, effect: 'a pickup: magnet radius (default the magnet param)' },
    },
    rules: { table_invalid: { fields: ['content.tables[].rolls', 'content.tables[].always[].count', 'content.tables[].entries[].count'], message: 'a [min, max] range has min <= max' } },
  },
  logic(logic) {
    logic.effect('drop_loot', {
      refs: e => [['table', e.table]],
      check: (e, path, errors) => { if (e.into && !['bag', 'world'].includes(e.into)) errors.push({ code: 'effect_invalid', path: `${path}.into`, message: "into must be 'bag' or 'world'" }); },
      run: (e, rt, c) => { const fn = rt.caches.lootDrop; if (fn) fn(e.table, { who: whoKey(e.who, c), into: e.into, at: e.at, from: c.self }); else for (const x of rollTable(rt, e.table, c)) give(rt, whoKey(e.who, c), x.item, x.count); },
    });
  },
  validate(config, doc) {
    const errors = [];
    const range = (r, p) => { if (Array.isArray(r) && r.length === 2 && r[0] > r[1]) errors.push({ code: 'table_invalid', path: p, message: `range [${r[0]}, ${r[1]}]: min must be at most max` }); };
    (Array.isArray(doc.content?.tables) ? doc.content.tables : []).forEach((t, i) => {
      const path = `content.tables[${i}]`;
      range(t?.rolls, `${path}.rolls`);
      for (const k of ['always', 'entries']) (Array.isArray(t?.[k]) ? t[k] : []).forEach((e, j) => range(e?.count, `${path}.${k}[${j}].count`));
    });
    return errors;
  },
  /** Solver key: pity meters only (drop bookkeeping and expiry frames always grow). */
  solverKey(rt) { return rt.state.prim[KEY]?.meter || {}; },
  install(rt, config) {
    const st = () => { const s = rt.store(KEY); s.dropped ??= {}; s.expire ??= {}; return s; };
    st(); // created at install, so reads later never add state
    function spawnPickup(item, count, space, at) {
      const p = isVec(at) ? at.map((v, i) => (i < 2 && config.scatter ? +(v + (rt.random() * 2 - 1) * config.scatter).toFixed(4) : v)) : at;
      const e = rt.spawn(config.pickupArchetype ?? null, { space, at: p, components: { pickup: { item, count } } });
      if (config.despawnSec > 0) st().expire[e.id] = rt.state.frame + Math.round(config.despawnSec / rt.dt);
      return e;
    }
    function drop(table, { who = 'player', into, at, from, space } = {}) {
      const src = from ? rt.entity(from) : null, got = rollTable(rt, table, { self: from, actor: who });
      const mode = into ?? (src ? config.dropTo : 'bag');
      const recipient = rt.entity(who);
      for (const x of got) {
        if (mode === 'bag') { const n = give(rt, who, x.item, x.count); if (n < x.count && recipient) spawnPickup(x.item, x.count - n, recipient.space, structuredClone(recipient.at)); }
        else spawnPickup(x.item, x.count, space ?? src?.space ?? recipient?.space, structuredClone(at ?? src?.at ?? recipient?.at));
      }
      rt.emitTyped('loot_dropped', table, { table, items: got, who, from: from ?? null, into: mode });
      return got;
    }
    rt.caches.lootDrop = drop;
    const onDeath = d => {
      if (!config.onDeath) return;
      const id = d.id ?? d.target ?? d.who; if (!id || id === 'player' || st().dropped[id]) return;
      const e = rt.entity(id), table = e?.components.loot ?? rt.archetype(d.archetype ?? d.subject)?.components?.loot;
      if (!table) return;
      st().dropped[id] = true;
      drop(table, { who: whoKey(d.by ?? d.killer ?? 'player'), from: e ? id : null, at: e?.at ?? d.at, space: e?.space });
    };
    rt.on('died', onDeath); rt.on('defeated', onDeath);
    rt.on('despawn', ({ id }) => { delete st().dropped[id]; });
    rt.on('interacted', d => { const t = rt.entity(d.target); if (t?.components.loot && d.kind === 'loot' && !st().dropped[t.id]) { st().dropped[t.id] = true; drop(t.components.loot, { who: d.who, into: 'bag', from: t.id }); } });

    // World pickups: `pickup: {item, count}` components; touch collects, magnets pull.
    const pickupOf = e => e.components.pickup ?? null;
    rt.system('interaction', rt => {
      const s = st(), p = rt.player();
      for (const [id, until] of Object.entries(s.expire)) if (rt.state.frame >= until) { delete s.expire[id]; if (rt.entity(id)) rt.despawn(id); }
      if (!p || !isVec(p.at)) return;
      const pc = center(rt, p), pb = boxOf(rt, p), bonus = rt.state.vars['stat.magnet'] ?? 0;
      for (const e of Object.values(rt.state.entities)) {
        const k = pickupOf(e); if (!k || e.space !== p.space || !isVec(e.at) || e.components.interact || e.components.collectible) continue;
        const r = (typeof e.components.magnet === 'number' ? e.components.magnet : config.magnet) + bonus;
        if (r > 0 && len(sub(center(rt, e), pc)) <= r) pull(rt, e, pc, config.magnetSpeed * rt.dt);
        if (!(boxesTouch(pb, boxOf(rt, e)) || len(sub(center(rt, e), pc)) <= 0.25)) continue;
        if (room(rt, 'player', k.item) < (k.count ?? 1)) continue;
        give(rt, 'player', k.item, k.count ?? 1);
        rt.despawn(e.id); delete s.expire[e.id];
        rt.emitTyped('picked_up', k.item, { who: 'player', item: k.item, count: k.count ?? 1 });
      }
    }, KEY);
    rt.provide('loot', { roll: (table, ctx) => rollTable(rt, table, ctx), drop: (table, opts) => drop(table, opts), meter: table => rt.store(KEY).meter?.[table] ?? 0 });
  },
};
