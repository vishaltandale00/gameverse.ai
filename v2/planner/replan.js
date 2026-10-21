// @ts-check
// Figuring out how to make the game when a stage fails. There is no fallback: no default structure, no dropped or
// isolated primitive, no substituted game. Each failure is diagnosed to the mechanic, primitive or win it concerns,
// then the planner re-plans the collection (another or an additional catalogue primitive for that mechanic, a
// primitive that declares the missing win), the outline repairs the failing fields again, or the gap layer writes the
// missing primitive. Then everything is verified again. The attempts are bounded by the pipeline config; when they
// are exhausted the build fails with what it tried and what is still missing.
import { relevance, declaredFit, sharesVerbs, servesInteraction } from './select.js';
import { isSpace, isGenerator, isGraphics, requirementsOf, satisfying } from './catalog.js';
import { composeLoop, winProviders, cardLoop } from './loop.js';
import { checkComposition } from './compose-check.js';
import { isObj, list, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('./select.js').Selection} Selection */
/** @typedef {import('./select.js').Gap} Gap */
/** @typedef {import('./decompose.js').Decomposition} Decomposition */
/** @typedef {import('./compose-check.js').AdapterSpec} AdapterSpec */
/** @typedef {import('./compose-check.js').CompositionResult} CompositionResult */
/** A problem as stages report it. @typedef {{ code?: unknown, path?: unknown, message?: unknown, primitive?: unknown, hint?: unknown }} StageProblem */
/**
 * What a failure is about. kind: 'primitive' (a chosen primitive cannot work here), 'mechanic' (nothing serves a
 * mechanic), 'win' (the collection cannot be won), 'loop' (the core loop does not happen in play), 'fields' (content
 * and params only the model can fix).
 * `signature` (with `adapter`, compose-check's adapter card, when an adapter would fix it) is what re-planning found the
 * catalogue lacks: the gap layer's request.
 * @typedef {{ kind: 'primitive' | 'mechanic' | 'win' | 'loop' | 'fields', mechanic?: string, primitive?: string, importance?: string, codes: string[], message: string, signature?: string, adapter?: AdapterSpec }} Diagnosis
 */
/** One re-planning decision. @typedef {{ action: 'replace' | 'add' | 'repair' | 'write', mechanic?: string, primitive?: string, by?: string, why: string }} Action */

export const REPLAN_VERSION = 'replan/0.1';

const GAME_PREFIX = /^(gameplay|plot)\./;
/** @param {unknown} v */
const text = v => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));

/**
 * Diagnose a stage's problems (and the selection's core gaps) to the mechanic, primitive or win they concern.
 * @param {StageProblem[]} problems @param {{ selection: Selection, registry: RegistryLike, doc?: unknown }} context @returns {Diagnosis[]}
 */
export function diagnose(problems, { selection, registry, doc = null }) {
  /** @type {Map<string, Diagnosis>} */
  const out = new Map();
  const mechOf = (/** @type {string} */ id) => (selection.mechanics || []).find(m => (m.primitives || []).includes(id));
  const put = (/** @type {Diagnosis} */ d) => {
    const key = `${d.kind}:${d.mechanic || ''}:${d.primitive || ''}`;
    const cur = out.get(key);
    if (cur) { cur.codes = [...new Set([...cur.codes, ...d.codes])]; return; }
    out.set(key, d);
  };
  for (const g of selection.gaps || []) {
    if (g.importance !== 'core') continue;
    if (g.kind === 'win') put({ kind: 'win', codes: ['loop_win_undeclared'], message: g.description, importance: 'core' });
    else if (g.primitive && registry.has(g.primitive)) put({ kind: 'primitive', primitive: g.primitive, mechanic: mechOf(g.primitive)?.id || g.mechanic, codes: [`gap_${g.kind}`], message: g.description, importance: 'core' });
    else put({ kind: 'mechanic', mechanic: g.mechanic, codes: [`gap_${g.kind}`], message: g.description, importance: 'core' });
  }
  const used = new Set([...(selection.systems || []), ...list(prop(doc, 'systems')).map(s => prop(s, 'use')).filter(/** @returns {x is string} */ x => typeof x === 'string')]);
  const ranked = [...used].filter(id => GAME_PREFIX.test(id)).sort((a, b) => b.length - a.length);
  for (const p of problems) {
    const code = text(p.code), path = text(p.path), message = text(p.message);
    // A selection gap restated as a problem is already diagnosed above.
    if (code.startsWith('gap_')) continue;
    const words = `${message} ${text(p.hint)}`;
    if (/win_unwired|win_undeclared/.test(code) || (code === 'not_playable' && /no_progress/.test(message) && !/loop_absent|cannot_act/.test(message))) { put({ kind: 'win', codes: [code], message }); continue; }
    if (code === 'not_playable' && /loop_absent|loop_undeclared|cannot_act/.test(message)) { put({ kind: 'loop', codes: [code], message }); continue; }
    // The primitive the problem names: the field it carries, the instance its path points into, or its id in the text.
    let primitive = typeof p.primitive === 'string' && registry.has(p.primitive) ? p.primitive : null;
    const at = /^systems\[(\d+)\]/.exec(path);
    if (!primitive && at) { const use = prop(list(prop(doc, 'systems'))[Number(at[1])], 'use'); if (typeof use === 'string' && registry.has(use)) primitive = use; }
    if (!primitive) primitive = ranked.find(id => words.includes(id)) || null;
    // A crash or a lost core primitive is the primitive's; a field the model keeps getting wrong is the model's.
    if (primitive && GAME_PREFIX.test(primitive) && (/core_degraded|core_primitive_missing|runtime_error|install|step|throw|capability|requires/.test(`${code} ${message}`) || typeof p.primitive === 'string'))
      put({ kind: 'primitive', primitive, mechanic: mechOf(primitive)?.id, codes: [code], message });
    else put({ kind: 'fields', ...(primitive ? { primitive } : {}), codes: [code], message: `${path}: ${message}`.slice(0, 240) });
  }
  return [...out.values()];
}

/** @param {{ check: string, code: string, unit: string, space?: string }} f */
const failureKey = f => `${f.check}:${f.code}:${f.unit}:${f.space ?? ''}`;

/**
 * The static composition check of a candidate against the current collection (compose-check, resolving registered
 * providers and adapters): the candidate composes when it adds no failure and no type hole of its own. When everything
 * it adds is adaptable, `adapter` is the adapter card that would project it (adapterSignature).
 * @param {RegistryLike} registry @param {Selection} sel @param {string[]} systems the collection without the candidate @param {string | null} id
 * the candidate (null: the collection alone, the baseline) @param {CompositionResult | null} [before] the baseline, when already checked
 * @returns {{ ok: boolean, via: boolean, why: string, adapter: AdapterSpec | null, result: CompositionResult }}
 */
function composes(registry, sel, systems, id, before = null) {
  const of = (/** @type {string[]} */ ids) => checkComposition({ spaces: sel.spaces, systems: ids, bind: sel.bind, ...(sel.adapters ? { adapters: sel.adapters } : {}) }, registry, { resolve: true });
  before ??= of(systems);
  const after = id ? of([...systems, id]) : before;
  const had = new Set(before.failures.map(failureKey));
  const fresh = after.failures.filter(f => !had.has(failureKey(f)));
  const holes = after.holes.filter(h => !before.holes.some(b => b.card === h.card && b.code === h.code && b.field === h.field));
  if (!fresh.length && !holes.length) return { ok: true, via: after.adapters.length > before.adapters.length, why: after.verdict, adapter: null, result: after };
  return { ok: false, via: false, why: (fresh[0]?.message || holes[0]?.message || after.reason).slice(0, 200), adapter: fresh.length && !holes.length && fresh.every(f => f.adaptable) ? after.signature : null, result: after };
}

/**
 * The primitive signature the gap layer writes when no catalogue primitive fits a mechanic: what its loop must declare.
 * @param {{ id: string, description: string }} m @param {Selection} sel @param {string | null} interaction @param {string[]} verbs what the failing primitive did
 */
const primitiveSignature = (m, sel, interaction, verbs) => `${m.id}: a primitive whose loop (card.loop) ${interaction ? `is played as ${interaction}, ` : ''}${verbs.length ? `does what ${verbs.join('/')} did, ` : ''}with verbs and progress events for "${m.description}", on ${(sel.spaces || []).map(s => `${s.use} (${(s.caps || []).join(', ')})`).join(', ') || 'the chosen space'}`.slice(0, 400);

/**
 * Re-plan the collection for a diagnosis: another catalogue primitive for a failing primitive's mechanic, an
 * additional one for a mechanic or a loop that does not happen, a primitive that declares the missing win. `tried`
 * (mechanic or 'win' -> ids) grows with every choice, so nothing is chosen twice. Never removes a primitive without
 * putting another in its place. -> { selection, actions, unresolved }
 * @param {Selection} selection @param {Diagnosis[]} diagnoses
 * @param {{ registry: RegistryLike, decomposition: Decomposition, tried: Map<string, Set<string>> }} context
 * @returns {{ selection: Selection, actions: Action[], unresolved: Diagnosis[] }}
 */
export function replan(selection, diagnoses, { registry, decomposition, tried }) {
  const sel = /** @type {Selection} */ (structuredClone(selection));
  /** @type {Action[]} */
  const actions = [];
  /** @type {Diagnosis[]} */
  const unresolved = [];
  const cards = registry.cards().filter(c => GAME_PREFIX.test(c.id) && !isSpace(c.id) && !isGenerator(c.id) && !isGraphics(c.id));
  const triedFor = (/** @type {string} */ key) => { let s = tried.get(key); if (!s) { s = new Set(); tried.set(key, s); } return s; };
  // Primitives that failed here are never chosen again, for any mechanic or the win.
  const failed = triedFor('failed');
  /** Bring in what a primitive requires (closure), as selection does. @param {string} id */
  const require = id => { for (const r of requirementsOf(registry, id).primitives) { if (sel.systems.some(x => x === r || x.startsWith(r + '.'))) continue; const s = satisfying(registry, r); if (s) { sel.systems.push(s); require(s); } } };
  const interaction = decomposition.core?.interaction || null;
  const joined = (/** @type {string} */ id) => (decomposition.core?.mashup || []).some(x => x.mechanics.includes(id));
  /**
   * The next untried catalogue primitive for a mechanic: ranked by its declarations (declaredFit: loop verbs and
   * progress fitting the mechanic and what the failing primitive did, the play spec's interaction, how participants
   * take part), natively hosted before adapted, and only one that passes the static composition check against the
   * current space and collection. When none does, `signature` (and `adapter`, when an adapter would make the best one
   * compose) is the gap layer's request.
   * @param {{ id: string, verb: string, description: string }} m @param {string | null} [old] the failing primitive
   * @returns {{ id: string | null, signature: string, adapter?: AdapterSpec }}
   */
  const next = (m, old = null) => {
    const seen = triedFor(m.id);
    const verbs = old ? cardLoop(registry.get(old)?.card)?.verbs || [] : [];
    // A primitive that failed because it does not serve how the idea is played (avatar steps for pieces moved in turns)
    // is replaced only by one whose loop is declared for that interaction.
    const strict = Boolean(old && interaction && !servesInteraction(registry.get(old)?.card, interaction));
    const pool = cards.filter(c => !seen.has(c.id) && !failed.has(c.id) && !sel.systems.includes(c.id) && (!strict || cardLoop(c)?.interaction === interaction))
      .map(c => ({ id: c.id, score: declaredFit(m, c, { interaction, joined: joined(m.id), verbs }) }))
      .filter(c => c.score !== null).sort((a, b) => Number(b.score) - Number(a.score) || a.id.localeCompare(b.id)).slice(0, 8);
    const rest = sel.systems.filter(x => x !== old);
    const baseline = pool.length ? composes(registry, sel, rest, null).result : null;
    /** @type {AdapterSpec | undefined} */
    let adapter;
    /** @type {string | null} */
    let via = null;
    for (const c of pool) {
      const r = composes(registry, sel, rest, c.id, baseline);
      if (r.ok && !r.via) return { id: c.id, signature: '' };
      if (r.ok) via ??= c.id;
      else if (!adapter && r.adapter) adapter = r.adapter;
    }
    if (via) return { id: via, signature: '' };
    return { id: null, signature: adapter ? `adapter ${adapter.id}: ${adapter.card.adapts.projection}` : primitiveSignature(m, sel, interaction, verbs), ...(adapter ? { adapter } : {}) };
  };
  /**
   * A primitive already in the mechanic's collection that does what the failing one did, played the play spec's way
   * (its loop declared for the interaction, sharing the failing primitive's verbs): piece movement stays with the turns
   * loop when avatar steps fail. @param {{ id: string, verb: string, description: string, primitives?: string[] }} m @param {string} old
   */
  const served = (m, old) => {
    const verbs = cardLoop(registry.get(old)?.card)?.verbs || [];
    if (!interaction || !verbs.length) return null;
    return (m.primitives || []).filter(id => id !== old && !failed.has(id)).find(id => {
      const card = { id, ...registry.get(id)?.card };
      return cardLoop(card)?.interaction === interaction && sharesVerbs(card, verbs) && declaredFit(m, card, { interaction, joined: joined(m.id), verbs }) !== null;
    }) || null;
  };
  const coreMechanics = (sel.mechanics || []).filter(m => m.importance === 'core');
  // Primitives first: a replacement may itself declare the missing win.
  const ordered = [...diagnoses.filter(d => d.kind === 'primitive' || d.kind === 'mechanic'), ...diagnoses.filter(d => d.kind !== 'primitive' && d.kind !== 'mechanic')];
  for (const d of ordered) if (d.kind === 'primitive' && d.primitive) failed.add(d.primitive);
  for (const d of ordered) {
    if (d.kind === 'fields') { actions.push({ action: 'repair', ...(d.primitive ? { primitive: d.primitive } : {}), why: d.message }); continue; }
    if (d.kind === 'win') {
      const seen = triedFor('win');
      const core = coreMechanics.flatMap(m => m.primitives || []);
      if (actions.length && composeLoop(sel.systems, registry, { core }).win) { actions.push({ action: 'repair', why: `the re-planned collection declares a win: ${d.message}` }); continue; }
      const caps = (sel.spaces || []).map(s => s.caps || []);
      // The provider that best fits how the idea is won (the play spec's words and the core mechanics).
      const words = [decomposition.core?.win, ...coreMechanics.map(m => m.description)].filter(Boolean).join('. ') || decomposition.premise || '';
      const best = winProviders(registry, { caps: caps.length ? caps : [[]], exclude: [...sel.systems, ...seen, ...failed], score: card => relevance({ verb: '', description: words }, /** @type {any} */ (card)) })[0];
      if (best) { seen.add(best.id); sel.systems.push(best.id); require(best.id); sel.gaps = sel.gaps.filter(g => g.kind !== 'win'); actions.push({ action: 'add', primitive: best.id, why: `declares a way to win (card.loop.win): ${d.message}` }); }
      else unresolved.push(d);
      continue;
    }
    if (d.kind === 'loop') {
      // The core loop does not happen in play: an additional primitive for the first core mechanic that has one left.
      let done = false;
      for (const m of coreMechanics) {
        for (const id of m.primitives || []) triedFor(m.id).add(id);
        const c = next(m).id;
        if (!c) continue;
        triedFor(m.id).add(c); sel.systems.push(c); require(c); m.primitives = [...(m.primitives || []), c];
        actions.push({ action: 'add', mechanic: m.id, primitive: c, why: `the core loop did not happen in play (${d.message.slice(0, 160)}); ${c} adds to "${m.description}"` });
        done = true; break;
      }
      if (!done) unresolved.push(d);
      continue;
    }
    const m = (sel.mechanics || []).find(x => x.id === d.mechanic) || (d.primitive ? (sel.mechanics || []).find(x => (x.primitives || []).includes(/** @type {string} */ (d.primitive))) : undefined);
    if (!m) { unresolved.push(d); continue; }
    // The mechanic already has a primitive that does what the failing one did, played the play spec's way: it takes its place.
    const keep = d.kind === 'primitive' && d.primitive ? served(m, d.primitive) : null;
    if (keep && d.primitive) {
      const old = d.primitive;
      sel.systems = sel.systems.filter(x => x !== old || (sel.mechanics || []).some(o => o !== m && (o.primitives || []).includes(old)));
      m.primitives = (m.primitives || []).filter(x => x !== old);
      triedFor(m.id).add(old);
      actions.push({ action: 'replace', mechanic: m.id, primitive: old, by: keep, why: `${keep} already serves "${m.description}" as ${interaction} (card.loop verbs ${(cardLoop(registry.get(keep)?.card)?.verbs || []).join(', ')}): ${d.message}`.slice(0, 240) });
      sel.gaps = (sel.gaps || []).filter(g => !(g.mechanic === m.id && (g.importance === 'core' || g.primitive === old)));
      continue;
    }
    for (const id of m.primitives || []) triedFor(m.id).add(id);
    if (d.primitive) triedFor(m.id).add(d.primitive);
    const found = next(m, d.primitive || null);
    const c = found.id;
    if (!c) { unresolved.push({ ...d, mechanic: m.id, signature: found.signature, ...(found.adapter ? { adapter: found.adapter } : {}) }); continue; }
    triedFor(m.id).add(c);
    if (d.kind === 'primitive' && d.primitive) {
      // Another primitive in its place, for this mechanic (what required the failing one keeps its own requirement).
      const old = d.primitive;
      sel.systems = sel.systems.filter(x => x !== old || (sel.mechanics || []).some(o => o !== m && (o.primitives || []).includes(old)));
      m.primitives = [...(m.primitives || []).filter(x => x !== old), c];
      actions.push({ action: 'replace', mechanic: m.id, primitive: old, by: c, why: d.message.slice(0, 200) });
    } else {
      m.primitives = [...(m.primitives || []), c];
      actions.push({ action: 'add', mechanic: m.id, primitive: c, why: d.message.slice(0, 200) });
    }
    if (!sel.systems.includes(c)) sel.systems.push(c);
    require(c);
    sel.gaps = (sel.gaps || []).filter(g => !(g.mechanic === m.id && (g.importance === 'core' || g.primitive === d.primitive)));
  }
  return { selection: sel, actions, unresolved };
}

/**
 * The gap layer's request for what re-planning could not resolve: a primitive the catalogue lacks, specified by the
 * mechanic, the loop it must declare (verbs, progress events, a win when that is what is missing) and the spaces.
 * @param {Diagnosis} d @param {Selection} selection @param {Decomposition} decomposition @returns {{ request: string, gap: Record<string, unknown> }}
 */
export function gapRequest(d, selection, decomposition) {
  const m = (selection.mechanics || []).find(x => x.id === d.mechanic);
  const spaces = (selection.spaces || []).map(s => s.use).join(', ');
  const what = d.kind === 'win' ? `a primitive that declares how this game is won (card.loop.win) for: ${decomposition.core?.win || decomposition.premise}`
    : d.adapter ? `an adapter for "${m ? m.description : d.message}": ${d.signature}`
    : `${m ? m.description : d.message}${d.primitive ? ` (instead of ${d.primitive}: ${d.message})` : ''}`;
  const played = decomposition.core?.interaction ? `, be played as ${decomposition.core.interaction}` : '';
  return { request: `${what}. It must work on ${spaces || 'the chosen space'}${played} and declare its loop (card.loop: verbs, progress events${d.kind === 'win' ? ', win' : ''}).${d.signature && !d.adapter ? ` Signature: ${d.signature}` : ''}`.slice(0, 700),
    gap: { mechanic: d.mechanic || d.kind, description: what, importance: 'core', kind: d.kind === 'win' ? 'win' : d.adapter ? 'adapter' : 'no_primitive', why: d.message, ...(d.signature ? { signature: d.signature } : {}), ...(d.adapter ? { adapter: d.adapter } : {}) } };
}

/**
 * New primitives a gap fill brought: the document's systems the new catalogue knows and the selection does not use.
 * @param {unknown} doc @param {Selection} selection @param {RegistryLike} registry @returns {string[]}
 */
export function addedBy(doc, selection, registry) {
  return list(prop(doc, 'systems')).map(s => prop(s, 'use')).filter(/** @returns {x is string} */ x => typeof x === 'string' && registry.has(x) && !selection.systems.includes(x));
}

/** The experiments a gap fill attached to a document (carried into every later draft). @param {unknown} doc @returns {unknown[]} */
export const experimentsOf = doc => list(prop(doc, 'experiments')).filter(isObj);

/** One line per unresolved diagnosis, for the failure report. @param {Diagnosis[]} ds */
export const missingText = ds => ds.map(d => `${d.kind}${d.mechanic ? ` "${d.mechanic}"` : ''}${d.primitive ? ` (${d.primitive})` : ''}: ${d.message}`.slice(0, 240));

