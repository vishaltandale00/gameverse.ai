// @ts-check
// Bundles for the iterative build (build.js): some primitives only work together. A bundle is a seed card plus the
// smallest set of companions that makes it compose with the collection so far, found from declarations alone:
//   - requires.primitives providers (the seed's requirements closure, each with the card that requires it);
//   - companions the seed's declarations name, when the seed (with its closure) still fails a check: providers of the
//     services it requires (provides.services), declarers of the sections it reads, engages from or its loop needs
//     (card.reads, card.engage config sources, card.loop needs.content; card.defines/data/dataShapes), generators of the
//     world content it needs on the space (card.needs.content, card.spaces), the input whose card.interactions has the
//     interaction its loop is played in (the play spec's when the loop serves it, else one its loop declares), and
//     the owners of the effects its engagement runs (card.engage *.enter);
//   - the adapter instances resolveAdapters (adapters.js) projects the bundle onto the chosen space with (card.adapts).
// The smallest composing companion set wins (fewest primitives, then declaration order); a bundle never exceeds
// MAX_BUNDLE primitives. Nothing here names a primitive, a genre or a game.
import { requirementsOf, satisfying, isSpace, isGraphics, isGenerator } from './catalog.js';
import { cardLoop } from './loop.js';
import { vocabIndex } from './select.js';
import { isStr, isObj } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').Card} Card */
/** @typedef {import('./compose-check.js').AdapterInstance} AdapterInstance */
/** A bundle member beyond the seed, why it is there, and how: the seed's requirements closure, or a companion its other declarations name. @typedef {{ id: string, why: string, kind: 'requires' | 'declared' }} Companion */
/** An adapter instance a bundle brings, and why. @typedef {AdapterInstance & { why: string }} BundleAdapter */
/**
 * A formed option: the seed and its companions (primitives the collection gains), the adapter instances projecting
 * them onto the space, and the space configuration they compose on.
 * @typedef {{ ok: true, members: string[], extra: Companion[], adapters: BundleAdapter[], variant: number }} Bundle
 */
/** @typedef {{ ok: true, variant: number } | { ok: false, why: string }} Composes */

/** At most this many primitives in one bundle (the seed, its companions and its adapter instances). */
export const MAX_BUNDLE = 4;
/** At most this many declared companions are searched for one seed. */
export const COMPANION_POOL = 6;

/** @param {RegistryLike} registry @param {string} id @returns {Card | null} */
const cardOf = (registry, id) => registry.get(id)?.card ?? null;
/** @param {string} id */
const isSystem = id => !isSpace(id) && !isGraphics(id);

/**
 * The requirements closure of a set of cards (card.requires.primitives, transitively), each with the card requiring it,
 * that `have` does not already satisfy. @param {RegistryLike} registry @param {string[]} ids @param {Iterable<string>} have
 * @returns {Companion[]}
 */
export function requiredBy(registry, ids, have) {
  const got = new Set([...have, ...ids]);
  /** @type {Companion[]} */
  const out = [];
  const visit = (/** @type {string} */ x) => {
    for (const req of requirementsOf(registry, x).primitives) {
      if ([...got].some(g => g === req || g.startsWith(req + '.'))) continue;
      const s = satisfying(registry, req, [...got]);
      if (!s) continue;
      got.add(s); out.push({ id: s, why: `required by ${x} (card.requires.primitives)`, kind: 'requires' }); visit(s);
    }
  };
  for (const id of ids) visit(id);
  return out;
}

/** Sections a card declares (card.defines at, card.data, card.dataShapes). @param {Card | null} c */
const sectionsOf = c => new Set([...(c?.defines || []).map(d => d.at).filter(isStr), ...Object.keys(c?.data || {}), ...Object.keys(c?.dataShapes || {})]);

/**
 * Companions the declarations of `ids` name (see the header), in declaration order, without those in `exclude`.
 * `interaction` is the one the collection is played in (the play spec's; null when undecided).
 * @param {RegistryLike} registry @param {string[]} ids @param {string} space the bound space primitive @param {Iterable<string>} exclude
 * @param {string | null} [interaction]
 * @returns {Companion[]}
 */
export function companionsOf(registry, ids, space, exclude, interaction = null) {
  const skip = new Set(exclude);
  /** @type {Map<string, string[]>} */
  const found = new Map();
  const add = (/** @type {string} */ id, /** @type {string} */ why) => {
    if (skip.has(id) || !registry.has(id) || !isSystem(id) || cardOf(registry, id)?.adapts) return;
    const w = found.get(id) || []; if (!w.includes(why)) w.push(why); found.set(id, w);
  };
  const all = registry.ids();
  const effects = vocabIndex(registry).effects;
  for (const id of ids) {
    const c = cardOf(registry, id); if (!c) continue;
    for (const sv of c.requires?.services || []) for (const p of all) if ((cardOf(registry, p)?.provides?.services || []).includes(sv)) add(p, `provides service ${sv} for ${id}`);
    const loop = /** @type {Record<string, any> | null} */ (cardLoop(c));
    const engaged = (JSON.stringify(c.engage?.config || {}).match(/\$(?:first|ids):[A-Za-z0-9_.]+/g) || []).map(s => s.slice(s.indexOf(':') + 1)).filter(p => !p.startsWith('with.'));
    const needs = [...(Array.isArray(loop?.needs?.content) ? loop.needs.content : []), ...(c.needs?.content || [])].filter(isStr);
    for (const section of [...(c.reads || []), ...engaged, ...needs.filter(x => x.includes('.'))])
      for (const p of all) if (p !== id && sectionsOf(cardOf(registry, p)).has(section)) add(p, `declares ${section} for ${id}`);
    for (const item of needs.filter(x => !x.includes('.')))
      for (const g of all.filter(isGenerator)) { const gc = cardOf(registry, g); if ((gc?.spaces || []).includes(space) && (gc?.provides?.content || []).includes(item)) add(g, `generates ${item} on ${space} for ${id}`); }
    // The input for the interaction the loop is played in: the collection's when the loop serves it, else any it declares.
    const declared = /** @type {string[]} */ (loop?.interactions || []).filter(x => x !== 'none');
    const played = interaction && declared.includes(interaction) ? [interaction] : declared;
    for (const i of played) for (const p of all) if (p.startsWith('engine.input.') && (cardOf(registry, p)?.interactions || []).includes(i)) add(p, `input for ${id}'s ${i} interaction`);
    for (const eff of [...(c.engage?.player?.enter || []), ...(c.engage?.actors?.enter || [])]) {
      const owner = isStr(eff?.do) ? effects[eff.do] : undefined;
      if (owner) add(owner, `owns ${eff.do}, which ${id} engages with`);
    }
  }
  // The most related first (most declarations naming it), then declaration order.
  return [...found].map(([id, why], i) => ({ id, why, i })).sort((a, b) => b.why.length - a.why.length || a.i - b.i)
    .slice(0, COMPANION_POOL).map(({ id, why }) => ({ id, why: why.join('; '), kind: /** @type {const} */ ('declared') }));
}

/** Every k-subset of `xs`, in order. @template T @param {T[]} xs @param {number} k @returns {Generator<T[]>} */
function* subsets(xs, k, from = 0) {
  if (k === 0) { yield []; return; }
  for (let i = from; i <= xs.length - k; i++) for (const rest of subsets(xs, k - 1, i + 1)) yield [xs[i], ...rest];
}

/**
 * Why an adapter instance is in a bundle, from its card: a sub-space adapter projects the space kind its with[kind]
 * names onto the space for the primitives bound to its region; another provides what its card.adapts declares.
 * @param {RegistryLike} registry @param {AdapterInstance} inst @param {string} space @param {Record<string, string>} bind
 */
export function adapterWhy(registry, inst, space, bind) {
  const a = cardOf(registry, inst.use)?.adapts;
  if (!a) return `adapter on ${space}`;
  const users = Object.entries(bind).filter(([, region]) => inst.id !== undefined && region === inst.id).map(([use]) => use);
  const kind = a.subspace && isObj(inst.with) ? inst.with[/** @type {string} */ (a.subspace.kind)] : undefined;
  if (isStr(kind)) return `projects ${kind} onto ${space}${users.length ? ` for ${users.join(', ')}` : ''}`;
  const gives = [...(a.provides?.capabilities || []), ...(a.provides?.content || []), ...(a.provides?.services || [])];
  return `adapts ${gives.slice(0, 4).join(', ') || 'it'} onto ${space}: ${String(a.projection || '').slice(0, 80)}`;
}

/**
 * The smallest bundle around `seed` that composes with the collection (see the header), or why there is none.
 * @param {{ registry: RegistryLike, seed: string, systems: string[], space: string, adapters: AdapterInstance[],
 *   composes: (ids: string[]) => Composes,
 *   resolve: (ids: string[], variant: number) => { adapters: AdapterInstance[], bind: Record<string, string>, gaps: unknown[] },
 *   limit?: number, interaction?: string | null }} options
 * @returns {Bundle | { ok: false, why: string }}
 */
export function formBundle({ registry, seed, systems, space, adapters, composes, resolve, limit = MAX_BUNDLE, interaction = null }) {
  if (systems.includes(seed)) { const r = composes([seed]); return r.ok ? { ok: true, members: [seed], extra: [], adapters: [], variant: r.variant } : r; }
  const closure = requiredBy(registry, [seed], systems);
  if (1 + closure.length > limit) return { ok: false, why: `its smallest bundle (${[seed, ...closure.map(c => c.id)].join(' + ')}) exceeds ${limit} primitives` };
  /** @type {Companion[]} */
  let extra = closure;
  let c = composes([seed, ...closure.map(x => x.id)]);
  if (!c.ok) {
    const first = c.why;
    const pool = companionsOf(registry, [seed, ...closure.map(x => x.id)], space, [...systems, seed, ...closure.map(x => x.id)], interaction);
    /** @type {{ extra: Companion[], variant: number } | null} */
    let found = null;
    for (let k = 1; !found && k <= limit - 1 - closure.length && k <= pool.length; k++) for (const set of subsets(pool, k)) {
      const more = requiredBy(registry, set.map(x => x.id), [...systems, seed, ...closure.map(x => x.id)]).filter(x => !set.some(s => s.id === x.id));
      const all = [...closure, ...set, ...more];
      if (1 + all.length > limit) continue;
      const r = composes([seed, ...all.map(x => x.id)]);
      if (r.ok) { found = { extra: all, variant: r.variant }; break; }
    }
    if (!found) return { ok: false, why: pool.length ? `${first} (no bundle of at most ${limit} primitives with ${pool.map(x => x.id).join(', ')} composes)` : first };
    extra = found.extra; c = { ok: true, variant: found.variant };
  }
  const members = [seed, ...extra.map(x => x.id)];
  // The adapter instances projecting the bundle onto the space: those the whole collection with it resolves that the
  // collection did not already have. A bundle that needs an adapter nobody registers stays without one (the checks
  // after the pick report it).
  const r = resolve(members, c.variant);
  const had = new Set(adapters.map(a => `${a.use}#${a.id ?? ''}`));
  const own = r.gaps.length ? [] : r.adapters.filter(a => !had.has(`${a.use}#${a.id ?? ''}`));
  if (members.length + own.length > limit) return { ok: false, why: `its smallest bundle (${[...members, ...own.map(a => a.use)].join(' + ')}) exceeds ${limit} primitives` };
  return { ok: true, members, extra, adapters: own.map(a => ({ ...a, why: adapterWhy(registry, a, space, r.bind) })), variant: c.variant };
}

/** The option line the model reads: its members joined with +, each extra with why it is there. @param {Pick<Bundle, 'members' | 'extra' | 'adapters'>} b */
export const bundleLabel = b => [b.members[0], ...b.extra.map(x => `${x.id} (${x.why})`), ...b.adapters.map(a => `${a.use}${a.id !== undefined ? `#${a.id}` : ''} (${a.why})`)].join(' + ');
