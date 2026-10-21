// Containers: chests, corpses, barrels, forage plants, shelves. An entity with
// a `container` component ({ slots?, items?: [{item,count}], table?, locked?: pred,
// autoTake?: b, respawnDays? }) holds its own bag (keyed by the entity id) that
// is filled on first open from `items` and a loot table, and refilled after
// `respawnDays` (var time.day). A `lock` component (item id | { key, consume?, when? })
// needs the key. Opening happens through gameplay.interact or open_container;
// the open container is then browsed with take/store/take_all/close_container.
import { bag, give, take, transfer, count } from './inventory.js';
import { rollTable } from './loot.js';
import { whoKey, entityByRef, dist, checkItem } from './items-lib.js';

const KEY = 'gameplay.container';
const lockOf = e => { const l = e.components.lock; return l == null ? null : typeof l === 'string' ? { key: l } : l; };
const parse = v => (typeof v === 'string' ? { item: v, count: 1 } : { item: v?.item, count: v?.count ?? 1 });

export default {
  id: 'gameplay.container',
  card: {
    // What an entity carrying these components reads as on screen (graphics/flat-art.js roleOf; never its name).
    presents: { lock: { role: 'prop', prop: 'door' } },
    loop: { verbs: ['take', 'store', 'take_all'], progress: ['opened', 'container_opened'] },
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { take: { type: 'choice', of: 'an item in the open container' }, store: { type: 'choice', of: 'an item in the bag' } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "archetypes", "component": "container", "min": 1, "placed": 1, "why": "containers are entities with a container component {slots, table?}", "example": {"id": "chest", "kind": "prop", "components": {"container": {"slots": 6}}}},
    ],
    intent: 'Chests, corpses, barrels and forage (entities with a `container` component): their own item bag filled from items and a loot table, key locks, refill after days, and take/store/take-all while open.',
    views: ['any'],
    params: {
      slots: { type: 'integer', default: 27, min: 1, max: 1000, unit: 'stacks', effect: 'default container size (components.container.slots overrides)' },
      lockable: { type: 'boolean', default: true, effect: 'honour `lock` components and `locked` predicates' },
      autoTake: { type: 'boolean', default: false, effect: 'opening moves everything to the opener (forage, corpses); components.container.autoTake overrides' },
      closeRange: { type: 'number', default: 4, min: 0, max: 100, unit: 'space units', effect: 'an open container closes when the opener moves farther away' },
    },
    provides: { events: ['opened', 'opened:*', 'container_opened', 'container_closed', 'container_locked', 'unlocked:*'], actions: ['take', 'store', 'take_all', 'close_container'], services: ['container'] },
    requires: { primitives: ['gameplay.inventory'] },
    reads: ['content.archetypes', 'content.tables'],
  },
  logic(logic) {
    logic.effect('open_container', {
      check: (e, path, errors) => { if (!e.container) errors.push({ code: 'effect_invalid', path, message: 'open_container needs a container (entity id or archetype)' }); },
      run: (e, rt, c) => { const t = entityByRef(rt, e.container, c); if (t) rt.caches.containerOpen?.(whoKey(e.who, c), t, { force: true }); },
    });
    logic.effect('close_container', { run: (e, rt, c) => rt.caches.containerClose?.(whoKey(e.who, c)) });
  },
  validate(config, doc, ctx) {
    const errors = [], tables = new Set((doc.content?.tables || []).map(t => t.id));
    (doc.content?.archetypes || []).forEach((a, i) => {
      const c = a.components?.container; if (!c) return;
      const path = `content.archetypes[${i}].components`;
      if (typeof c !== 'object') { errors.push({ code: 'container_invalid', path: `${path}.container`, message: 'container must be an object' }); return; }
      if (c.slots !== undefined && !(Number.isInteger(c.slots) && c.slots >= 1)) errors.push({ code: 'container_invalid', path: `${path}.container.slots`, message: 'slots must be a positive integer' });
      if (c.table && !tables.has(c.table)) errors.push({ code: 'ref_unknown', path: `${path}.container.table`, message: `unknown table '${c.table}'` });
      (c.items || []).forEach((x, k) => checkItem(doc, x.item, `${path}.container.items[${k}].item`, errors));
      if (c.locked) ctx.checkPredicate(c.locked, `${path}.container.locked`, errors);
      const l = a.components.lock; if (l != null) checkItem(doc, typeof l === 'string' ? l : l.key, `${path}.lock`, errors);
    });
    return errors;
  },
  install(rt, config) {
    rt.caches.containerSlots = config.slots;
    const st = () => { const s = rt.store(KEY); s.open ??= {}; s.filled ??= {}; s.unlocked ??= {}; return s; };
    st(); // created at install, so reads later never add state
    const day = () => rt.state.vars['time.day'] ?? 0;
    function fill(e) {
      const c = e.components.container, s = st(), last = s.filled[e.id];
      const due = last == null || (c.respawnDays > 0 && day() - last >= c.respawnDays);
      if (!due) return;
      s.filled[e.id] = day();
      for (const x of c.items || []) give(rt, e.id, x.item, x.count ?? 1, { silent: true });
      if (c.table) for (const x of rollTable(rt, c.table, { self: e.id })) give(rt, e.id, x.item, x.count, { silent: true });
    }
    function open(who, e, { force = false } = {}) {
      const c = e?.components.container; if (!c) return false;
      const s = st(), lock = config.lockable ? lockOf(e) : null;
      if (config.lockable && !s.unlocked[e.id]) {
        if (c.locked && rt.test(c.locked, { self: e.id, actor: who })) { rt.emit('container_locked', { who, id: e.id }); return false; }
        if (lock && !force) {
          if ((lock.key && !count(rt, who, lock.key)) || (lock.when && !rt.test(lock.when, { self: e.id, actor: who }))) { rt.emit('container_locked', { who, id: e.id, key: lock.key ?? null }); return false; }
          if (lock.consume && lock.key) take(rt, who, lock.key, 1);
          s.unlocked[e.id] = true; rt.emitTyped('unlocked', e.id, { who, id: e.id });
        }
      }
      fill(e);
      s.open[who] = e.id;
      rt.emitTyped('opened', e.id, { who, id: e.id, archetype: e.archetype });
      rt.emit('container_opened', { who, id: e.id });
      if (c.autoTake ?? config.autoTake) { takeAll(who); close(who); }
      return true;
    }
    function close(who) { const s = st(), id = s.open[who]; if (!id) return; delete s.open[who]; rt.emit('container_closed', { who, id }); }
    function takeAll(who) { const id = st().open[who]; if (!id) return 0; let n = 0; for (const [item, k] of Object.entries(bag(rt, id)).sort()) n += transfer(rt, id, who, item, k); return n; }
    rt.caches.containerOpen = open; rt.caches.containerClose = close;
    rt.on('interacted', d => { const t = rt.entity(d.target); if (t?.components.container) open(d.who, t); });
    rt.on('despawn', ({ id }) => { for (const [who, c] of Object.entries(st().open)) if (c === id) close(who); });
    rt.action('take', (v, rt) => { const id = st().open.player; if (!id) return; const { item, count: n } = parse(v); transfer(rt, id, 'player', item, n); });
    rt.action('store', (v, rt) => { const id = st().open.player; if (!id) return; const { item, count: n } = parse(v); transfer(rt, 'player', id, item, n); });
    rt.action('take_all', (v, rt) => { takeAll('player'); });
    rt.action('close_container', (v, rt) => close('player'));
    rt.system('interaction', rt => {
      for (const [who, id] of Object.entries(st().open)) { const a = rt.entity(who), e = rt.entity(id); if (!a || !e || dist(rt, a, e) > config.closeRange) close(who); }
    }, KEY);
    rt.options(rt => {
      const id = st().open.player; if (!id) return [];
      const items = Object.keys(bag(rt, id)).sort();
      return [...(items.length ? [{ label: `take all from ${id}`, actions: { take_all: true } }] : []), { label: `close ${id}`, actions: { close_container: true } }];
    });
    rt.provide('container', { open: (who = 'player') => { const id = st().open[who]; return id ? { id, items: { ...bag(rt, id) } } : null; }, contents: id => ({ ...bag(rt, id) }) });
  },
};
