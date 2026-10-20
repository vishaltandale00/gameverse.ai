// Abstract state keys for search deduplication. A primitive may declare how
// its state abstracts with `solverKey(rt, config, instance) → JSON` (top level
// or on the card); that part replaces its raw per-primitive store. Everything
// else falls back to a generic key: player space/position (quantized for
// continuous spaces), status, flags, vars, unclaimed primitive stores and the
// population per archetype. Frame, time, counts and events are excluded
// (they always grow); the RNG is excluded unless `includeRng`.
import { instancesOf, stableStringify } from './util.js';

const quantize = (at, q) => Array.isArray(at) ? at.map(v => (typeof v === 'number' ? (q > 0 ? Math.floor(v / q) : v) : v)) : at;

export function abstraction(doc, registry, { quantum = 1, includeRng = false, entities = 'census', extra = null } = {}) {
  const keyed = [];
  const claimed = new Set();
  for (const x of instancesOf(doc)) {
    const p = registry.get(x.inst?.use);
    const fn = p?.solverKey || p?.card?.solverKey;
    if (typeof fn !== 'function') continue;
    keyed.push({ fn, x, id: p.id });
    claimed.add(p.id); claimed.add(x.key);
  }
  function parts(rt) {
    const s = rt.state, pl = rt.player();
    const prim = {};
    for (const [k, v] of Object.entries(s.prim)) if (!claimed.has(k)) prim[k] = v;
    const declared = keyed.map(({ fn, x }) => fn(rt, x.inst.with || {}, { key: x.key, ...x.inst }));
    let ents;
    if (entities === 'census') { ents = {}; for (const e of Object.values(s.entities)) if (e.id !== 'player') ents[`${e.space}:${e.archetype}`] = (ents[`${e.space}:${e.archetype}`] || 0) + 1; }
    else if (entities === 'positions') ents = Object.values(s.entities).filter(e => e.id !== 'player').map(e => [e.id, e.space, quantize(e.at, quantum)]);
    else ents = null;
    return [pl?.space ?? null, quantize(pl?.at ?? null, quantum), s.status, s.ending, s.flags, s.vars, prim, declared, ents, includeRng ? s.rng : 0, extra ? extra(rt) : 0];
  }
  return { key: rt => stableStringify(parts(rt)), declared: keyed.map(k => k.id) };
}
