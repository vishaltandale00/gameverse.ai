// Checkpoints and save slots kept as JSON inside the game state, so they
// survive snapshots, travel with exported state and replay deterministically.
// A save is a snapshot of rt.state without the save store itself (no
// nesting); loading restores it and keeps the slots. The checkpoint is a
// position (space, zone, at) that death/respawn primitives return to.
// Autosave runs on an interval and on chosen events, unless `autosaveWhen`
// is false (in combat, mid-cutscene). With keepEditLog off, cell-space edit
// logs are left out of saves (their cells are kept).
const ID = 'engine.save';

export default {
  id: ID,
  card: {
    intent: 'Save slots, autosave and checkpoints as JSON in the game state: save_game / load_game actions and effects, set_checkpoint / return_to_checkpoint for respawning, slot listing for menus.',
    views: ['any'],
    params: {
      auto: { type: 'boolean', default: true, effect: 'autosave to the "auto" slot' },
      intervalSec: { type: 'number', default: 60, min: 1, max: 3600, unit: 's', effect: 'autosave interval' },
      autosaveOn: { type: 'list', of: { type: 'string' }, default: ['discovered', 'act_complete'], effect: 'events that trigger an autosave' },
      autosaveWhen: { type: 'predicate', effect: 'autosave only while it holds' },
      slots: { type: 'integer', default: 3, min: 1, max: 20, effect: 'manual slots 1..N' },
      keepEditLog: { type: 'boolean', default: true, effect: 'include cell edit logs in saves' },
      checkpointOnStart: { type: 'boolean', default: true, effect: 'the player\'s start is the first checkpoint' },
    },
    provides: { events: ['saved', 'loaded', 'checkpoint', 'checkpoint:*', 'save_failed'], actions: ['save_game', 'load_game'], services: ['save'], vars: ['save.count'] },
    requires: {},
  },
  logic(logic) {
    const codes = kind => [{ code: 'save_slot_invalid', fields: ['slot'], message: 'slot is a positive integer or "auto"', example: { do: kind, slot: 0 } }];
    const slot = (e, path, errors) => { if (e.slot !== undefined && !(Number.isInteger(e.slot) && e.slot >= 1) && e.slot !== 'auto') errors.push({ code: 'save_slot_invalid', path, message: 'slot is a positive integer or "auto"' }); };
    logic.effect('save_game', { codes: codes('save_game'), check: slot, run: (e, rt) => rt.service('save').save(e.slot ?? 'auto', e.label) });
    logic.effect('load_game', { codes: codes('load_game'), check: slot, run: (e, rt) => rt.service('save').load(e.slot ?? 'auto') });
    logic.effect('set_checkpoint', {
      refs: e => (e.zone ? [['zone', e.zone]] : []),
      run: (e, rt, c) => { const who = rt.resolve(e.who, c); rt.service('save').checkpoint({ id: e.id, zone: e.zone, at: e.at, space: e.space }, who); },
    });
    logic.effect('return_to_checkpoint', { run: (e, rt, c) => rt.service('save').respawn(rt.resolve(e.who, c)) });
    logic.predicate('checkpoint', { test: (p, rt) => rt.store(ID).checkpoint?.id === p.checkpoint });
    logic.predicate('has_save', { test: (p, rt) => Boolean(rt.store(ID).slots?.[String(p.has_save)]) });
  },
  install(rt, config) {
    const st = () => { const s = rt.store(ID); s.slots ??= {}; s.count ??= 0; s.next ??= null; return s; };
    const valid = slot => slot === 'auto' || (Number.isInteger(slot) && slot >= 1 && slot <= config.slots);
    const stripped = () => {
      const snap = rt.snapshot();
      delete snap.prim[ID];
      snap.events = [];
      if (!config.keepEditLog) for (const s of Object.values(snap.spaces || {})) if (Array.isArray(s?.log)) s.log = [];
      return snap;
    };
    const api = {
      save(slot = 'auto', label) {
        if (!valid(slot)) { rt.emit('save_failed', { slot, reason: 'slot' }); return false; }
        const s = st(), p = rt.player();
        const data = stripped();
        s.slots[String(slot)] = { slot, frame: rt.state.frame, time: rt.state.time, zone: p?.zone ?? null, space: p?.space ?? null, label: label ?? null, data };
        s.count++; rt.state.vars['save.count'] = s.count;
        rt.emit('saved', { slot, auto: slot === 'auto' });
        return true;
      },
      load(slot = 'auto') {
        const s = st(), entry = s.slots[String(slot)];
        if (!entry) { rt.emit('save_failed', { slot, reason: 'empty' }); return false; }
        const keep = structuredClone(s);
        rt.restore(entry.data);
        rt.state.prim[ID] = keep; // slots and checkpoint outlive the load
        rt.emit('loaded', { slot });
        return true;
      },
      slots: () => Object.values(st().slots).map(({ slot, time, frame, zone, label }) => ({ slot, time, frame, zone, label })).sort((a, b) => String(a.slot).localeCompare(String(b.slot))),
      clear(slot) { delete st().slots[String(slot)]; },
      checkpoint(cp = {}, who = rt.player()) {
        const s = st(), at = cp.at !== undefined ? structuredClone(cp.at) : cp.zone ? null : structuredClone(who?.at ?? null);
        s.checkpoint = { id: cp.id ?? cp.zone ?? `cp${s.count}`, space: cp.space ?? who?.space ?? null, zone: cp.zone ?? (cp.at === undefined ? who?.zone ?? null : null), at, frame: rt.state.frame };
        rt.emitTyped('checkpoint', s.checkpoint.id, { who: who?.id ?? null, ...s.checkpoint });
        return s.checkpoint;
      },
      current: () => structuredClone(st().checkpoint ?? null),
      /** Put an entity back at the checkpoint (or does nothing without one). */
      respawn(e = rt.player()) {
        const cp = st().checkpoint; if (!cp || !e) return false;
        if (cp.space && cp.space !== e.space) rt.moveToSpace(e, cp.space, cp.at !== null ? structuredClone(cp.at) : null, cp.zone ?? undefined);
        else rt.space(e.space).teleport(e, { zone: cp.zone ?? undefined, at: cp.at !== null ? structuredClone(cp.at) : undefined }, rt);
        if (e.components.body?.vel) e.components.body.vel = e.components.body.vel.map(() => 0);
        return true;
      },
    };
    rt.provide('save', api);
    rt.action('save_game', value => api.save(value === true ? 1 : value));
    rt.action('load_game', value => { st().next = value === true ? 1 : value; }); // applied at the end of the step, not mid-step
    for (const ev of config.autosaveOn) rt.on(ev, () => { if (config.auto) st().pending = true; });
    rt.system('late', rt => {
      const s = st();
      if (s.checkpoint === undefined && config.checkpointOnStart && rt.player()) api.checkpoint({ id: 'start' });
      if (s.next !== null) { const slot = s.next; s.next = null; api.load(slot); return; }
      if (!config.auto) return;
      const due = rt.state.frame > 0 && rt.state.frame % Math.round(config.intervalSec * 60) === 0;
      if ((due || s.pending) && (!config.autosaveWhen || rt.test(config.autosaveWhen))) { s.pending = false; api.save('auto'); }
    }, ID);
  },
};
