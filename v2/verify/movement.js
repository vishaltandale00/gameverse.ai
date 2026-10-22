// What the player can do right now, in the form spaces' navigation takes:
// reachable(from, rt, opts) / path(from, to, opts) / canReach(a, b, rt, opts)
// with opts = { abilities, envelope, who } (frozen kernel signatures), plus
// the body box (width, height) spaces use for clearance. Abilities come from
// the `ability` predicate (progression primitives) and player.abilities,
// expanded with each ability's movement `grants` (doubleJump, wallJump...); the
// envelope merges every movement primitive's card `envelope(config, abilities)`
// at the mover's space gravity. The mapping itself (moverOptions) lives with the
// envelopes, so generators prove traversal for exactly the mover checked here.
import { documentEnvelope, abilityIds, abilityDefs, withGrants, moverOptions, gravityMagnitude } from '../primitives/gameplay/move-lib-envelope.js';

export { abilityIds, abilityDefs, withGrants };

/** Merge every movement primitive's envelope: max of numbers, OR of booleans, first string. -> { envelope, sources } */
export const movementEnvelope = (doc, registry, abilities = new Set(), ctx = {}) => documentEnvelope(doc, registry, abilities, ctx);

/** Abilities the player holds now: the `ability` predicate when registered, plus the document's starting list. */
export function currentAbilities(rt, ids, start = []) {
  const out = new Set(start);
  if (!rt.canTest('ability')) return out;
  for (const id of ids) { try { if (rt.test({ ability: id })) out.add(id); } catch { /* not testable here */ } }
  return out;
}

/**
 * Navigation options for an entity now: { abilities: {id: true}, envelope, who, width, height }, plus
 * the ability set and how many movement primitives contributed an envelope.
 */
export function navOptions(rt, registry, e = rt.player(), ids = abilityIds(rt.doc, registry)) {
  const held = currentAbilities(rt, ids, rt.doc.player?.abilities || []);
  const api = e?.space ? rt.space(e.space) : null, gravity = gravityMagnitude(api, e?.at);
  const { opts, abilities, sources } = moverOptions(rt.doc, registry, held, e?.components?.body?.size ?? null, gravity ? { gravity } : {});
  return { opts: { ...opts, who: e?.id ?? null }, abilities, sources };
}

/** Where navigation starts for an entity: the space's own cell key when it has one, else its position. */
export const navFrom = (api, e) => api.cellOf?.(e) ?? api.pos?.(e) ?? e.at;
