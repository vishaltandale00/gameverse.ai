// @ts-check
// The engagement step: a document that picks a mechanic must also wire the
// player (and the mechanic's AI participants) into it, or the mechanic never
// fires (a race nobody drives, a car nobody sits in, health nobody has).
// Each card says how it is engaged in `card.engage`; this step applies those
// contracts to a document without overwriting anything the document already
// has. It knows no primitive id: everything comes from the cards.
//
// card.engage = {
//   player: {
//     components: { comp: defaults },      added to the player's archetype when it lacks that component
//     spawn: { role, archetype },          an entity made at the player's start (role names it in effects, e.g. 'vehicle');
//                                          an archetype in the document with the same component keys is reused
//     enter: [effects],                    run once at start; '$player' and '$<role>' are substituted, effects naming
//                                          a role nobody spawned are dropped; skipped when the document already runs
//                                          these effect kinds itself
//   },
//   actors: { components, spawn, enter },  the same, for each AI participant ('$actor' = the participant)
//   participants: { param },               who the participants are: the instance param listing ids or archetypes;
//                                          missing ones are spawned at start beside the player
//   config: { param: value },              instance params filled when the document leaves them unset or empty;
//                                          '$first:<path>' / '$ids:<path>' = the first / every id listed at a document path
//                                          ('with.<param>' = the instance's own param); dropped when there is none
//   join: { param, field, where? },        the player joins the first entry of a list param (where: matching fields) when
//                                          no entry lists 'player' in `field` (a team's members, a side's members)
// }
//
// Start spawns and start effects run through the spawner primitive that declares the `spawn` effect (its rules
// place unique entities and run onSpawn effects on the first step), added first in systems when missing so the
// participants exist before anything that reads them arms.
import { preflight } from '../kernel/document.js';
import { isObj, isStr, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('../kernel/types.js').Card} Card */
/** @typedef {import('../kernel/types.js').Engage} Engage */
/** @typedef {import('../kernel/types.js').EngageSide} EngageSide */
/** @typedef {import('../kernel/types.js').Effect} Effect */
/** @typedef {import('../kernel/types.js').Instance} Instance */
/** @typedef {import('../kernel/types.js').Problem} Problem */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {NonNullable<EngageSide['spawn']>} RoleSpawn */
/** An instance whose card declares an engagement contract. @typedef {{ inst: Instance, path: string, card: Card & { engage: Engage }, id: string }} Found */
/** A start spawn rule for the spawner primitive. @typedef {{ id: string, archetype: string | null, at: unknown, onSpawn?: unknown[], [k: string]: unknown }} SpawnRule */
/** @typedef {{ use: string, path?: string, part: string, what: string }} EngageStep */
/** @typedef {{ use?: string, path?: string, part: string, what?: string, why: string }} EngageSkip */
/** @typedef {{ doc: Doc, applied: EngageStep[], skipped: EngageSkip[], ok: boolean, errors: Problem[], version: string }} EngageResult */

export const ENGAGE_VERSION = 'engage/0.1';

/** @template T @param {T} v @returns {T} */
const clone = v => structuredClone(v);
/** @param {unknown} s */
const slug = s => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || ['x']).join('_');

/** Replace '$name' strings in effects; null when an effect names a role that is not bound.
 * @param {unknown} value @param {Record<string, string>} roles @returns {unknown} the value with the same shape, or undefined */
function bind(value, roles) {
  if (typeof value === 'string' && value.startsWith('$') && !value.startsWith('$first:')) return value.slice(1) in roles ? roles[value.slice(1)] : undefined;
  if (Array.isArray(value)) { const out = []; for (const v of value) { const b = bind(v, roles); if (b === undefined) return undefined; out.push(b); } return out; }
  if (isObj(value)) {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) { const b = bind(v, roles); if (b === undefined) return undefined; out[k] = b; }
    return out;
  }
  return value;
}

/** Effect kinds the document already runs anywhere (`{do: kind}` objects). @param {unknown} doc @returns {Set<string>} */
function effectKinds(doc) {
  /** @type {Set<string>} */
  const kinds = new Set();
  /** @param {unknown} v @returns {void} */
  const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (isObj(v)) { if (typeof v.do === 'string') kinds.add(v.do); Object.values(v).forEach(walk); } };
  walk(doc);
  return kinds;
}

/** The value at a dotted document path (any JSON value along the way, arrays included).
 * @param {unknown} doc @param {string} path @returns {unknown} */
const at = (doc, path) => path.split('.').reduce((/** @type {unknown} */ v, k) => (v == null ? undefined : /** @type {Record<string, unknown>} */ (v)[k]), doc);

/** Every instance in the document with the primitive's card. @param {Doc} doc @param {RegistryLike} registry @returns {Found[]} */
function instances(doc, registry) {
  /** @type {Found[]} */
  const out = [];
  for (const [section, list] of [['systems', doc.systems], ['graphics', doc.graphics]]) (Array.isArray(list) ? list : []).forEach((inst, i) => {
    const p = inst && registry.get(inst.use);
    if (p?.card?.engage) out.push({ inst, path: `${section}[${i}]`, card: /** @type {Found['card']} */ (p.card), id: p.id });
  });
  return out;
}

/** The spawner the document uses or should use: the primitive that owns the `spawn` effect.
 * @param {RegistryLike} registry @returns {string | null} */
export function spawnerId(registry) {
  for (const id of registry.ids()) { const c = registry.get(id)?.card; if (c?.params?.rules && (c.defines || []).some(d => d.kind === 'spawn_rule')) return id; }
  return null;
}

/** A position `k` steps beside the player's start (behind it on the first axis); zone/slot starts are shared.
 * @param {unknown} start @param {number} k @returns {unknown} */
function beside(start, k) {
  if (!Array.isArray(start)) return start;
  const p = start.slice(); p[0] = Math.round((p[0] - 2 * k) * 1000) / 1000; return p;
}

/**
 * engageDocument(doc, registry, logic) -> { doc, applied: [{use, part, what}], skipped: [...], ok, errors, version }
 * The input is not modified. When the engaged document would not preflight, the input is returned unchanged
 * (ok false, with the errors), so this step can never break a playable document.
 * force: return the engaged document even when it does not preflight yet (a caller that repairs it next).
 * @param {Doc} input @param {RegistryLike} registry @param {LogicLike} logic @param {{ force?: boolean }} [options] @returns {EngageResult}
 */
export function engageDocument(input, registry, logic, { force = false } = {}) {
  const doc = clone(input);
  /** @type {EngageStep[]} */ const applied = [];
  /** @type {EngageSkip[]} */ const skipped = [];
  const found = instances(doc, registry);
  if (!found.length || !doc.player) return { doc: input, applied, skipped, ok: true, errors: [], version: ENGAGE_VERSION };
  doc.content = isObj(doc.content) ? doc.content : {};
  doc.content.archetypes = Array.isArray(doc.content.archetypes) ? doc.content.archetypes : [];
  const docPlayer = doc.player;
  /** @type {any[]} the document's archetypes (document data the kernel carries as `any`) */
  const archetypes = doc.content.archetypes;
  const archetype = (/** @type {unknown} */ id) => archetypes.find(a => a?.id === id);
  const already = effectKinds(input);
  const player = archetype(docPlayer.archetype);
  /** @type {SpawnRule[]} */
  const rules = [];
  /** @type {Set<string>} */
  const ruleIds = new Set();
  const addRule = (/** @type {SpawnRule} */ r) => { if (ruleIds.has(r.id)) return; ruleIds.add(r.id); rules.push(r); };

  // 1. Instance params the mechanic needs to have anything to engage with.
  for (const { inst, path, card, id } of found) {
    for (const [param, value] of Object.entries(card.engage.config || {})) {
      const cur = inst.with?.[param];
      if (cur !== undefined && !(Array.isArray(cur) && !cur.length) && cur !== null && cur !== '') continue;
      let missing = false;
      /** @param {string} path @returns {string[]} */
      const idsAt = path => { const list = path.startsWith('with.') ? at(inst, path) : at(doc, path); return Array.isArray(list) ? list.map(e => e?.id).filter(isStr) : isObj(list) ? Object.keys(list) : []; };
      /** @param {unknown} x @returns {unknown} */
      const sub = x => {
        if (typeof x === 'string' && /^\$(first|ids):/.test(x)) { const [, kind, path] = /** @type {RegExpMatchArray} */ (x.match(/^\$(first|ids):(.*)$/)), ids = idsAt(path); if (!ids.length) missing = true; return kind === 'first' ? ids[0] : ids; }
        if (Array.isArray(x)) return x.map(sub); if (isObj(x)) return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, sub(y)])); return x;
      };
      const v = sub(clone(value));
      if (missing) { skipped.push({ use: id, part: 'config', what: param, why: 'the document has no content to fill it from' }); continue; }
      inst.with = { ...(inst.with || {}), [param]: v };
      applied.push({ use: id, path, part: 'config', what: param });
    }
  }

  // The player joins a list param's entry (a team, a side) when no entry names it.
  for (const { inst, path, card, id } of found) {
    const j = card.engage.join; if (!j?.param || !j.field) continue;
    const list = inst.with?.[j.param]; if (!Array.isArray(list) || !list.length) continue;
    if (list.some(x => Array.isArray(x?.[j.field]) && x[j.field].includes('player'))) continue;
    const target = list.find(x => isObj(x) && Object.entries(j.where || {}).every(([k, v]) => x[k] === v)) ?? (j.where ? null : list[0]);
    if (!isObj(target)) continue;
    const members = target[j.field];
    target[j.field] = [...(Array.isArray(members) ? members : []), 'player'];
    applied.push({ use: id, path, part: 'join', what: `${j.param}.${target.id ?? 0}` });
  }

  // 2. Player components: a component the archetype already has is the document's choice and stays as it is.
  for (const { card, id } of found) {
    const comps = card.engage.player?.components;
    if (!comps || !player) continue;
    player.components = isObj(player.components) ? player.components : {};
    const added = Object.keys(comps).filter(k => player.components[k] === undefined);
    for (const k of added) player.components[k] = clone(comps[k]);
    if (added.length) applied.push({ use: id, part: 'player.components', what: added.join(',') });
  }

  // 3. Role spawns (one archetype per role: reused from the document when one has the template's components).
  /** @type {Record<string, string>} */
  const roleArchetypes = {};
  /** @param {RoleSpawn} spec @param {string} id @returns {string | null} */
  const roleFor = (spec, id) => {
    if (!spec?.role || !spec.archetype) return null;
    if (roleArchetypes[spec.role]) return roleArchetypes[spec.role];
    const keys = Object.keys(spec.archetype.components || {});
    const reuse = archetypes.find(a => a?.id !== docPlayer.archetype && keys.length && keys.every(k => a?.components?.[k] !== undefined));
    if (reuse) return (roleArchetypes[spec.role] = reuse.id);
    let aid = slug(spec.archetype.id || spec.role); while (archetype(aid)) aid += '_x';
    archetypes.push({ ...clone(spec.archetype), id: aid });
    applied.push({ use: id, part: 'archetype', what: aid });
    return (roleArchetypes[spec.role] = aid);
  };
  const space = docPlayer.space, start = docPlayer.at;
  /** @param {'player' | 'actors'} side */
  const spawnsOf = side => found.map(f => ({ ...f, spec: f.card.engage[side]?.spawn })).filter(/** @returns {f is Found & { spec: RoleSpawn }} */ f => Boolean(f.spec?.role));
  /** @param {'player' | 'actors'} side @returns {{ use: string, effect: Effect }[]} */
  const entersOf = side => found.flatMap(f => (f.card.engage[side]?.enter || []).map(e => ({ use: f.id, effect: e })));

  // The player's role entities and start effects; skipped when the document already runs those effects itself.
  const pEnter = entersOf('player');
  if (pEnter.length && pEnter.every(e => !already.has(e.effect.do))) {
    /** @type {Record<string, string>} */ const roles = { player: 'player' };
    /** @type {SpawnRule[]} */ const roleRules = [];
    for (const f of spawnsOf('player')) {
      if (roles[f.spec.role]) continue;
      const aid = roleFor(f.spec, f.id), eid = `player_${aid}`;
      roles[f.spec.role] = eid;
      roleRules.push({ id: eid, archetype: aid, ...(space ? { space } : {}), at: clone(start), unique: true, activation: 'always', respawnSec: 0, ...(f.spec.components ? { components: clone(f.spec.components) } : {}), onSpawn: [] });
    }
    // bind keeps each effect's shape (or drops it when it names an unbound role).
    const effects = /** @type {Effect[]} */ (pEnter.map(e => bind(e.effect, roles)).filter(Boolean));
    const last = roleRules.at(-1);
    if (effects.length && last) {
      last.onSpawn = effects;
      roleRules.forEach(addRule);
      applied.push({ use: [...new Set(pEnter.map(e => e.use))].join(','), part: 'player.enter', what: effects.map(e => e.do).join(',') });
    } else if (pEnter.length) skipped.push({ use: pEnter[0].use, part: 'player.enter', why: 'no role entity to enter' });
  } else if (pEnter.length) skipped.push({ use: pEnter[0].use, part: 'player.enter', why: 'the document already runs these effects' });

  // 4. Participants: spawned beside the player when missing, then equipped by every mechanic's actors contract.
  // Participants that already exist: characters, and named (unique) spawns in the document or added above.
  const spawned = (doc.systems || []).flatMap(s => (Array.isArray(s?.with?.rules) ? s.with.rules : []).filter(r => r?.unique).map(r => r.id));
  const entities = new Set([...(doc.plot?.characters || []).map((/** @type {unknown} */ c) => prop(c, 'id')), ...rules.map(r => r.id), ...spawned]);
  /** @type {{ id: string, archetype: string, from: string }[]} */
  const actors = [];
  for (const { inst, card, id } of found) {
    const part = card.engage.participants; if (!part?.param) continue;
    const list = inst.with?.[part.param] ?? card.params?.[part.param]?.default ?? [];
    for (const sel of Array.isArray(list) ? list : []) {
      if (typeof sel !== 'string' || sel === 'player' || actors.some(a => a.id === sel) || entities.has(sel)) continue;
      // A selector that names no archetype becomes one (an NPC with that name), so the participant exists.
      if (!archetype(sel)) { archetypes.push({ id: sel, kind: 'npc', components: { name: sel } }); applied.push({ use: id, part: 'archetype', what: sel }); }
      actors.push({ id: sel, archetype: sel, from: id });
    }
  }
  const aEnter = entersOf('actors');
  actors.forEach((a, k) => {
    const where = beside(start, k + 1);
    /** @type {Record<string, unknown>} */ const components = {};
    for (const f of found) for (const [k, v] of Object.entries(f.card.engage.actors?.components || {})) components[k] ??= clone(v);
    const own = archetype(a.archetype);
    for (const key of Object.keys(components)) if (own?.components?.[key] !== undefined) delete components[key];
    addRule({ id: a.id, archetype: a.archetype, ...(space ? { space } : {}), at: where, unique: true, activation: 'always', respawnSec: 0, ...(Object.keys(components).length ? { components } : {}) });
    /** @type {Record<string, string>} */ const roles = { actor: a.id };
    /** @type {SpawnRule[]} */ const roleRules = [];
    for (const f of spawnsOf('actors')) {
      if (roles[f.spec.role]) continue;
      const tkeys = Object.keys(f.spec.archetype.components || {});
      if (tkeys.length && tkeys.every(t => own?.components?.[t] !== undefined)) continue; // the participant is that role itself
      const aid = roleFor(f.spec, f.id), eid = `${a.id}_${aid}`;
      roles[f.spec.role] = eid;
      roleRules.push({ id: eid, archetype: aid, ...(space ? { space } : {}), at: where, unique: true, activation: 'always', respawnSec: 0, ...(f.spec.components ? { components: clone(f.spec.components) } : {}), onSpawn: [] });
    }
    const effects = aEnter.map(e => bind(e.effect, roles)).filter(Boolean);
    const last = roleRules.at(-1);
    if (last) last.onSpawn = effects;
    roleRules.forEach(addRule);
    applied.push({ use: a.from, part: 'participant', what: `${a.id}${roleRules.length ? ` +${roleRules.map(r => r.archetype).join('+')}` : ''}` });
  });

  // 5. Start spawns go through the spawner: the document's own, else one added first in systems.
  if (rules.length) {
    const sid = spawnerId(registry);
    if (!sid) { skipped.push({ part: 'spawn', why: 'no primitive owns start spawns' }); }
    else {
      doc.systems = Array.isArray(doc.systems) ? doc.systems : [];
      let sp = doc.systems.find(s => s?.use === sid);
      if (!sp) { sp = { use: sid, with: { rules: [] } }; doc.systems.unshift(sp); applied.push({ use: sid, part: 'system', what: 'start spawns' }); }
      sp.with = isObj(sp.with) ? sp.with : {};
      sp.with.rules = Array.isArray(sp.with.rules) ? sp.with.rules : [];
      const taken = new Set(sp.with.rules.map((/** @type {unknown} */ r) => prop(r, 'id')));
      for (const r of rules) if (!taken.has(r.id)) sp.with.rules.push(r);
    }
  }

  if (!applied.length) return { doc: input, applied, skipped, ok: true, errors: [], version: ENGAGE_VERSION };
  const pre = preflight(doc, registry, logic);
  if (!pre.ok && force) return { doc, applied, skipped, ok: false, errors: pre.errors.slice(0, 20), version: ENGAGE_VERSION };
  if (!pre.ok) return { doc: input, applied: [], skipped: [...skipped, ...applied.map(a => ({ ...a, why: 'reverted: the engaged document failed preflight' }))], ok: false, errors: pre.errors.slice(0, 20), version: ENGAGE_VERSION };
  return { doc, applied, skipped, ok: true, errors: [], version: ENGAGE_VERSION };
}
