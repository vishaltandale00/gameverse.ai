// What the player can do right now, in the form spaces' navigation takes:
// reachable(from, rt, opts) / path(from, to, opts) / canReach(a, b, rt, opts)
// with opts = { abilities, envelope, who } (frozen kernel signatures), plus
// the body box (width, height) spaces use for clearance. Abilities come from
// the `ability` predicate (progression primitives) and player.abilities; the
// envelope merges every movement primitive's card `envelope(config, abilities)`.
import { instancesOf } from './util.js';

/** Merge every movement primitive's envelope: max of numbers, OR of booleans, first string. */
export function movementEnvelope(doc, registry, abilities = new Set()) {
  const out = {};
  let sources = 0;
  for (const x of instancesOf(doc)) {
    const p = registry.get(x.inst?.use), env = p?.card?.envelope ?? p?.envelope;
    if (!env) continue;
    const e = typeof env === 'function' ? env(x.inst.with || {}, abilities) : env;
    if (!e || typeof e !== 'object') continue;
    sources++;
    for (const [k, v] of Object.entries(e)) {
      if (typeof v === 'number') out[k] = Math.max(out[k] ?? -Infinity, v);
      else if (typeof v === 'boolean') out[k] = Boolean(out[k]) || v;
      else if (out[k] === undefined) out[k] = v;
    }
  }
  return { envelope: out, sources };
}

/** Ability ids a document mentions: player.abilities and every `ability` reference kind defined by primitives. */
export function abilityIds(doc, registry) {
  const ids = new Set(doc.player?.abilities || []);
  for (const x of instancesOf(doc)) for (const d of registry.get(x.inst?.use)?.card.defines || []) {
    if (d.kind === 'ability' && d.in) for (const a of x.inst.with?.[d.in] || []) if (a?.id) ids.add(a.id);
    if (d.kind === 'ability' && d.at) { const v = d.at.split('.').reduce((o, k) => o?.[k], doc); for (const a of Array.isArray(v) ? v : Object.keys(v || {})) ids.add(a?.id ?? a); }
  }
  return ids;
}

/** Abilities the player holds now: the `ability` predicate when registered, plus the document's starting list. */
export function currentAbilities(rt, ids, start = []) {
  const out = new Set(start);
  if (!rt.logic.predicates.has('ability')) return out;
  for (const id of ids) { try { if (rt.test({ ability: id })) out.add(id); } catch { /* not testable here */ } }
  return out;
}

/**
 * Navigation options for an entity now: { abilities: {id: true}, envelope, who, width, height }, plus
 * the ability set and how many movement primitives contributed an envelope.
 */
export function navOptions(rt, registry, e = rt.player(), ids = abilityIds(rt.doc, registry)) {
  const set = currentAbilities(rt, ids, rt.doc.player?.abilities || []);
  const { envelope, sources } = movementEnvelope(rt.doc, registry, set);
  const size = e?.components?.body?.size;
  return { opts: { abilities: Object.fromEntries([...set].map(a => [a, true])), envelope, who: e?.id ?? null, ...(size ? { width: size[0], height: size[1] } : {}) }, abilities: set, sources };
}

/** Where navigation starts for an entity: the space's own cell key when it has one, else its position. */
export const navFrom = (api, e) => api.cellOf?.(e) ?? api.pos?.(e) ?? e.at;
