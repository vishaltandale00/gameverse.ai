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
