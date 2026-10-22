// Movement envelope for the spatial verifier (v2/verify). Every
// gameplay.move.* card and gameplay.mount exposes `card.envelope(config,
// abilities:Set, ctx?)` (also the primitive's `envelope`) returning the reach
// limits of that movement in space units:
//   mode         'continuous' | 'discrete' | 'lanes' | 'ship'
//   run          top horizontal speed (units/s)
//   jumpHeight   highest vertical reach from standing (units; double jumps included)
//   jumpGap      widest horizontal gap crossable at speed (units; dash and glide included)
//   climb, swim, fly, wallJump, oneWay   booleans
//   dash, glideRatio, climbSpeed, swimSpeed, flyRange, grapple   numbers (extras)
// ctx.gravity is the space gravity magnitude when known (defaults: 9.8 for 3D movers, 60 tiles/s² for the platformer).
// movementEnvelope merges the envelopes of every instance in a document: max of numbers, OR of booleans.
export function mergeEnvelopes(list) {
  const out = {};
  for (const env of list) for (const [k, v] of Object.entries(env || {})) {
    if (typeof v === 'number') out[k] = Math.max(out[k] ?? -Infinity, v);
    else if (typeof v === 'boolean') out[k] = Boolean(out[k]) || v;
    else if (out[k] === undefined) out[k] = v;
    else if (out[k] !== v && k === 'mode') out[k] = [].concat(out[k], v).filter((x, i, a) => a.indexOf(x) === i);
  }
  return out;
}

/** Envelope of every movement instance in a preflighted doc for the given unlocked abilities (ids or grants). */
export function movementEnvelope(doc, registry, abilities = [], ctx = {}) {
  const set = new Set(abilities);
  for (const s of doc.systems || []) if (s.use === 'gameplay.progression.abilities') for (const a of s.with?.abilities || []) if (set.has(a.id)) for (const g of a.grants || []) set.add(g);
  const envs = [];
  for (const s of doc.systems || []) {
    const p = registry.get(s.use), fn = p?.card?.envelope || p?.envelope;
    if (typeof fn === 'function') envs.push(fn(s.with || {}, set, ctx));
    else if (fn && typeof fn === 'object') envs.push(fn);
  }
  return mergeEnvelopes(envs);
}

// ---------- movers: what navigation and generator proofs take for an entity ----------
const instancesIn = doc => [...(doc.spaces || []).flatMap(s => [s, ...(s.generators || [])]), ...(doc.systems || []), ...(doc.graphics || [])];

/**
 * The document's movement envelope for a held ability set (ids and the movement grants they carry): every instance
 * whose card declares `envelope`, merged (max of numbers, OR of booleans, first string). ctx.gravity is the mover's
 * space gravity magnitude when known. -> { envelope, sources } (sources: how many instances contributed).
 */
export function documentEnvelope(doc, registry, abilities = new Set(), ctx = {}) {
  const out = {};
  let sources = 0;
  for (const inst of instancesIn(doc)) {
    const p = registry.get(inst?.use), env = p?.card?.envelope ?? p?.envelope;
    if (!env) continue;
    const e = typeof env === 'function' ? env(inst.with || {}, abilities, ctx) : env;
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
  for (const def of abilityDefs(doc, registry).keys()) ids.add(def);
  return ids;
}

/** Ability definitions by id from every `ability` reference kind (card.defines): { id → { grants: [...] } }. */
export function abilityDefs(doc, registry) {
  const out = new Map();
  for (const inst of instancesIn(doc)) for (const d of registry.get(inst?.use)?.card.defines || []) {
    if (d.kind !== 'ability') continue;
    const list = d.in ? inst.with?.[d.in] : d.at ? d.at.split('.').reduce((o, k) => o?.[k], doc) : null;
    for (const a of Array.isArray(list) ? list : Object.entries(list || {}).map(([id, v]) => ({ id, ...v }))) if (a?.id) out.set(a.id, a);
  }
  return out;
}

/** Ability ids plus the movement grants they carry (`grants: ['wallJump']`), as envelope functions test them. */
export function withGrants(set, defs) {
  const out = new Set(set);
  for (const id of set) for (const g of defs.get(id)?.grants || []) out.add(g);
  return out;
}

/** Ability names the document's movement cards turn on by name (their `abilities` param fields: doubleJump, dash...). */
export function movementAbilityNames(doc, registry) {
  const out = new Set();
  for (const inst of instancesIn(doc)) { const c = registry.get(inst?.use)?.card; if (c && (c.envelope || registry.get(inst.use)?.envelope)) for (const k of Object.keys(c.params?.abilities?.fields || {})) out.add(k); }
  return out;
}

/**
 * Navigation options for a mover (KERNEL_API §3 reachability opts plus the body box): the abilities it holds (ids;
 * their grants are added), the document's movement envelope for them and its body size in space units, if declared
 * (spaces give an undeclared body one unit per axis). The verifier and every generator that proves traversal call
 * this, so a proof at generation time and the check after it walk the same mover.
 * -> { opts: { abilities: {id: true}, envelope, width?, height? }, abilities: Set, sources }
 */
export function moverOptions(doc, registry, held = [], size = null, ctx = {}) {
  const set = withGrants(new Set(held), abilityDefs(doc, registry));
  const { envelope, sources } = documentEnvelope(doc, registry, set, ctx);
  return { opts: { abilities: Object.fromEntries([...set].map(a => [a, true])), envelope, ...(Array.isArray(size) ? { width: size[0], height: size[1] } : {}) }, abilities: set, sources };
}

/** The player's declared body size: doc.player.components.body.size, else its archetype's; null when neither declares one. */
export function playerBodySize(doc) {
  const p = doc.player; if (!p) return null;
  const a = (doc.content?.archetypes || []).find(x => x?.id === p.archetype);
  const size = p.components?.body?.size ?? a?.components?.body?.size;
  return Array.isArray(size) ? size : null;
}

/** Gravity magnitude of a space at a point (gravity capability), for envelopes; undefined when the space has none. */
export function gravityMagnitude(api, at) {
  const g = typeof api?.gravityAt === 'function' ? api.gravityAt(at) : null;
  const m = Array.isArray(g) ? Math.hypot(...g.map(v => v || 0)) : 0;
  return m > 0 ? m : undefined;
}
