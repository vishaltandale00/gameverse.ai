// Quest objective kinds (catalog §4.2) as data-driven evaluators for plot.quest.
// Each kind declares:
//   fields   - param schema of its fields (validated with the kernel's checkFields)
//   check?   - extra validation (refs, either/or fields)
//   events?  - base event names it listens to (typed `name` + subject form);
//              onEvent(o, prog, data, rt) -> number of progress units (or 'fail')
//   poll?    - evaluated each plot tick while active: returns true (done),
//              'fail', or false; may update prog
//   activate?- initialise progress when the objective becomes active
//   need     - how many progress units complete it (default o.count ?? 1)
//   typed?   - the typed event name (`defeated:<archetype>`...) when unfiltered;
//              with `since: 'start'` progress starts from its count so far
//   reads    - static requirements for the story graph (story-graph.js)
// Event-counted kinds count only events after activation unless `since: 'start'`.
import { err, checkRef, entityAlive, zoneIndex } from './story-lib.js';

const S = (extra = {}) => ({ type: 'string', ...extra });
const N = (extra = {}) => ({ type: 'number', ...extra });
const I = (extra = {}) => ({ type: 'integer', min: 1, max: 100000, ...extra });
const B = (extra = {}) => ({ type: 'boolean', ...extra });
export const BASE_FIELDS = { id: S({ required: true }), kind: S({ required: true }), text: S(), optional: B(), hidden: B(), since: S({ options: ['active', 'start'] }) };

const playerZone = rt => rt.player()?.zone ?? null;
const inZone = (rt, who, zone) => { const e = typeof who === 'string' ? rt.resolve(who) : who; if (!e?.space) return false; try { return rt.space(e.space).inZone(e, zone, rt); } catch { return false; } };
const zoneOfEvent = (rt, data) => {
  if (data.zone) return data.zone;
  if (data.at != null) { const sp = data.space ?? rt.player()?.space; try { const z = rt.space(sp).zoneAt?.(data.at); if (z) return z; } catch { /* no space */ } }
  const victim = data.id ? rt.entity(data.id) : null;
  return victim?.zone ?? playerZone(rt);
};
const isPlayer = (rt, who) => who === undefined || who === null || who === 'player' || who === rt.player()?.id;
const tagged = (rt, zone, tag) => (zoneIndex(rt.doc).get(zone)?.zone?.tags || []).includes(tag);

export const OBJECTIVES = {
  reach: {
    fields: { zone: { type: 'ref', to: 'zone' }, at: { type: 'json' }, radius: N({ min: 0, default: 1 }), who: S() },
    check: (o, path, errors) => { if (o.zone === undefined && o.at === undefined) errors.push(err('objective_invalid', path, 'reach needs zone or at')); },
    need: () => 1,
    poll(o, prog, rt) {
      const e = rt.resolve(o.who); if (!e?.space) return false;
      if (o.zone !== undefined) return inZone(rt, e, o.zone);
      const api = rt.space(e.space); if (!api.distance) return false;
      return api.distance(e.at, o.at) <= (o.radius ?? 1);
    },
    reads: o => [...(o.zone ? [['zone', o.zone]] : [])],
  },
  collect: {
    fields: { item: { type: 'ref', to: 'item', required: true }, count: I({ default: 1 }), consume: B({ default: false }), who: S() },
    check: (o, path, errors, ctx) => ctx.checkPredicate({ item: o.item, gte: o.count ?? 1 }, path, errors),
    poll(o, prog, rt) {
      const need = o.count ?? 1;
      prog.n = Math.min(need, rt.logic.predicates.has('item') ? countHeld(rt, o.item, o.who) : 0);
      if (prog.n < need) return false;
      if (o.consume) rt.run([{ do: 'take_item', item: o.item, count: need, who: o.who }]);
      return true;
    },
    reads: o => [['item', o.item]], consumes: o => (o.consume ? [o.item] : []),
  },
  deliver: {
    fields: { item: { type: 'ref', to: 'item', required: true }, count: I({ default: 1 }), to: S({ required: true }), consume: B({ default: true }) },
    check(o, path, errors, ctx) {
      const isChar = ctx.indexes.character?.has(o.to), isZone = ctx.indexes.zone?.has(o.to);
      if (typeof o.to === 'string' && !isChar && !isZone) errors.push(err('ref_unknown', `${path}.to`, `deliver target '${o.to}' is neither a character nor a zone`));
      ctx.checkPredicate({ item: o.item, gte: o.count ?? 1 }, path, errors);
    },
    events: () => ['talked'],
    onEvent(o, prog, data, rt) { if (data.subject === o.to && isPlayer(rt, data.who)) prog.pending = true; return 0; },
    poll(o, prog, rt) {
      const need = o.count ?? 1, held = countHeld(rt, o.item);
      const atTarget = prog.pending || (zoneIndex(rt.doc).has(o.to) && inZone(rt, 'player', o.to));
      prog.pending = false;
      if (!atTarget || held < need) return false;
      if (o.consume !== false) rt.run([{ do: 'take_item', item: o.item, count: need }]);
      rt.emit('delivered', { item: o.item, count: need, to: o.to });
      return true;
    },
    reads: o => [['item', o.item], ['target', o.to]], consumes: o => (o.consume !== false ? [o.item] : []),
  },
  defeat: {
    fields: { archetype: { type: 'ref', to: 'archetype' }, target: S(), count: I({ default: 1 }), zone: { type: 'ref', to: 'zone' } },
    check: (o, path, errors, ctx) => {
      if (o.archetype === undefined && o.target === undefined) errors.push(err('objective_invalid', path, 'defeat needs archetype or target'));
      ctx.noteRef('event', `defeated:${o.archetype ?? o.target}`, path, 'read');
    },
    events: () => ['defeated'],
    typed: o => (o.zone ? null : `defeated:${o.archetype ?? o.target}`),
    onEvent(o, prog, data, rt) {
      const match = o.archetype !== undefined ? data.subject === o.archetype : (data.id === o.target || data.subject === o.target);
      return match && (!o.zone || zoneOfEvent(rt, data) === o.zone) ? 1 : 0;
    },
    reads: o => [['archetype', o.archetype ?? o.target], ...(o.zone ? [['zone', o.zone]] : [])],
  },
  talk: {
    fields: { character: { type: 'ref', to: 'character', required: true }, dialogue: { type: 'ref', to: 'dialogue' }, node: S() },
    check(o, path, errors, ctx) {
      if (o.node !== undefined && o.dialogue === undefined) errors.push(err('objective_invalid', path, 'node needs dialogue'));
      const d = ctx.doc.plot?.dialogue?.[o.dialogue];
      if (o.node !== undefined && d && !(o.node in (d.nodes || {}))) errors.push(err('dialogue_node_unknown', `${path}.node`, `dialogue '${o.dialogue}' has no node '${o.node}'`));
    },
    events: o => [o.node !== undefined ? 'dialogue_line' : o.dialogue !== undefined ? 'dialogue_end' : 'talked'],
    typed: o => (o.dialogue === undefined ? `talked:${o.character}` : null),
    onEvent(o, prog, data, rt, name) {
      if (name === 'talked') return data.subject === o.character && isPlayer(rt, data.who) ? 1 : 0;
      if (name === 'dialogue_end') return data.dialogue === o.dialogue ? 1 : 0;
      return data.dialogue === o.dialogue && data.node === o.node ? 1 : 0;
    },
    need: () => 1,
    reads: o => [['character', o.character], ...(o.dialogue ? [['dialogue', o.dialogue]] : [])],
  },
  escort: {
    fields: { who: S({ required: true }), to: { type: 'ref', to: 'zone', required: true }, failIfDead: B({ default: true }) },
    check: (o, path, errors, ctx) => { if (typeof o.who === 'string' && !ctx.indexes.character?.has(o.who) && !ctx.indexes.archetype?.has(o.who)) errors.push(err('ref_unknown', `${path}.who`, `escortee '${o.who}' is neither a character nor an archetype`)); },
    need: () => 1,
    poll(o, prog, rt) {
      const e = rt.entity(o.who) || Object.values(rt.state.entities).find(x => x.archetype === o.who);
      const alive = o.who in (rt.state.prim['plot.character']?.dead || {}) ? false : entityAlive(e);
      if (!alive) return o.failIfDead !== false ? 'fail' : false;
      return inZone(rt, e, o.to);
    },
    reads: o => [['character', o.who], ['zone', o.to]],
  },
  survive: {
    fields: { seconds: N({ min: 0 }), until: { type: 'predicate' }, zone: { type: 'ref', to: 'zone' }, onDeath: S({ options: ['reset', 'fail'], default: 'reset' }) },
    check: (o, path, errors) => { if (o.seconds === undefined && o.until === undefined) errors.push(err('objective_invalid', path, 'survive needs seconds or until')); },
    need: () => 1,
    activate: prog => { prog.t = 0; },
    events: () => ['player_died'],
    onEvent(o, prog) { if (o.onDeath === 'fail') return 'fail'; prog.t = 0; return 0; },
    poll(o, prog, rt) {
      if (!entityAlive(rt.player())) return o.onDeath === 'fail' ? 'fail' : (prog.t = 0, false);
      if (o.zone && !inZone(rt, 'player', o.zone)) return false; // the clock only runs inside the zone
      prog.t = +((prog.t || 0) + rt.dt).toFixed(6);
      if (o.until !== undefined && rt.test(o.until)) return true;
      return o.seconds !== undefined && prog.t >= o.seconds;
    },
    reads: o => (o.zone ? [['zone', o.zone]] : []),
  },
  build: {
    fields: { block: { type: 'ref', to: 'block' }, structure: S(), count: I({ default: 1 }), zone: { type: 'ref', to: 'zone' } },
    check: (o, path, errors) => { if (o.block === undefined && o.structure === undefined) errors.push(err('objective_invalid', path, 'build needs block or structure')); },
    events: o => [o.structure !== undefined ? 'built' : 'block_placed'],
    typed: o => (o.zone ? null : o.structure !== undefined ? `built:${o.structure}` : o.block !== undefined ? `block_placed:${o.block}` : 'block_placed'),
    onEvent(o, prog, data, rt, name) {
      const match = name === 'built' ? data.subject === o.structure : (o.block === undefined || data.subject === o.block || data.block === o.block);
      return match && (!o.zone || zoneOfEvent(rt, data) === o.zone) ? 1 : 0;
    },
    reads: o => (o.zone ? [['zone', o.zone]] : []),
  },
  drive: {
    fields: { vehicle: S(), to: { type: 'ref', to: 'zone' }, distance: N({ min: 0 }), maxSeconds: N({ min: 0 }) },
    check: (o, path, errors, ctx) => {
      if (o.to === undefined && o.distance === undefined) errors.push(err('objective_invalid', path, 'drive needs to or distance'));
      if (o.vehicle !== undefined && !ctx.indexes.archetype?.has(o.vehicle)) errors.push(err('ref_unknown', `${path}.vehicle`, `unknown vehicle archetype '${o.vehicle}'`));
    },
    need: () => 1,
    activate: prog => { prog.t = 0; prog.d = 0; prog.last = null; prog.ride = null; },
    events: () => ['vehicle_entered', 'vehicle_exited', 'mounted', 'dismounted'],
    onEvent(o, prog, data, rt, name) {
      if (!isPlayer(rt, data.who)) return 0;
      if (name === 'vehicle_entered' || name === 'mounted') prog.ride = data.vehicle ?? data.mount ?? data.id ?? data.subject ?? null;
      else { prog.ride = null; prog.last = null; }
      return 0;
    },
    poll(o, prog, rt) {
      prog.t = +((prog.t || 0) + rt.dt).toFixed(6);
      if (o.maxSeconds !== undefined && prog.t > o.maxSeconds) return 'fail';
      const p = rt.player(), ride = prog.ride ? rt.entity(prog.ride) : null;
      const ok = ride && (o.vehicle === undefined || ride.archetype === o.vehicle || ride.id === o.vehicle);
      if (!ok || !p?.space) { prog.last = null; return false; }
      const api = rt.space(p.space), at = structuredClone(ride.at ?? p.at);
      if (prog.last != null && api.distance) { const d = api.distance(prog.last, at); if (Number.isFinite(d)) prog.d = +(prog.d + d).toFixed(4); }
      prog.last = at;
      return (o.distance === undefined || prog.d >= o.distance) && (o.to === undefined || inZone(rt, p, o.to));
    },
    reads: o => [...(o.vehicle ? [['archetype', o.vehicle]] : []), ...(o.to ? [['zone', o.to]] : [])],
  },
  craft: {
    fields: { recipe: { type: 'ref', to: 'recipe', required: true }, count: I({ default: 1 }) },
    check: (o, path, errors, ctx) => ctx.noteRef('event', `crafted:${o.recipe}`, path, 'read'),
    events: () => ['crafted'],
    typed: o => `crafted:${o.recipe}`,
    onEvent: (o, prog, data) => (data.subject === o.recipe ? 1 : 0),
    reads: o => [['recipe', o.recipe]],
  },
  use: {
    fields: { interactable: S(), tag: S(), count: I({ default: 1 }) },
    check: (o, path, errors, ctx) => {
      if (o.interactable === undefined && o.tag === undefined) errors.push(err('objective_invalid', path, 'use needs interactable or tag'));
      if (o.interactable !== undefined) { checkRef(ctx, 'interactable', o.interactable, `${path}.interactable`, errors); ctx.noteRef('event', `used:${o.interactable}`, path, 'read'); }
    },
    events: () => ['used'],
    typed: o => (o.interactable !== undefined ? `used:${o.interactable}` : null),
    onEvent: (o, prog, data) => ((o.interactable !== undefined ? data.subject === o.interactable : (data.tags || []).includes(o.tag)) ? 1 : 0),
    reads: o => (o.interactable ? [['interactable', o.interactable]] : []),
  },
  discover: {
    fields: { zone: { type: 'ref', to: 'zone' }, tag: S(), count: I({ default: 1 }) },
    check: (o, path, errors) => { if (o.zone === undefined && o.tag === undefined) errors.push(err('objective_invalid', path, 'discover needs zone or tag')); },
    events: () => ['discovered'],
    typed: o => (o.zone !== undefined ? `discovered:${o.zone}` : null),
    onEvent: (o, prog, data, rt) => ((o.zone !== undefined ? data.subject === o.zone : ((data.tags || []).includes(o.tag) || tagged(rt, data.subject, o.tag))) ? 1 : 0),
    reads: o => (o.zone ? [['zone', o.zone]] : []),
  },
  until: {
    fields: { when: { type: 'predicate', required: true } },
    need: () => 1,
    poll: (o, prog, rt) => rt.test(o.when),
    reads: () => [],
  },
};

function countHeld(rt, item, who) {
  // Prefer the inventory service's pure count; otherwise read through the `item` predicate (binary search on gte).
  const inv = rt.hasService('inventory') ? rt.service('inventory') : null;
  if (typeof inv?.count === 'function') return inv.count(who ?? 'player', item) || 0;
  if (!rt.logic.predicates.has('item')) return 0;
  if (!rt.test({ item, gte: 1, who })) return 0;
  let lo = 1, hi = 2;
  while (rt.test({ item, gte: hi, who }) && hi < 1e6) { lo = hi; hi *= 2; }
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rt.test({ item, gte: m, who })) lo = m; else hi = m; }
  return lo;
}

/** Units needed to finish an objective. */
export const needOf = o => (OBJECTIVES[o.kind]?.need ? OBJECTIVES[o.kind].need(o) : (o.count ?? 1));
