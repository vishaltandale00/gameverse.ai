// @ts-check
// Figuring out how to make the game when a stage fails. There is no fallback: no default structure, no dropped or
// isolated primitive, no substituted game. Each failure is diagnosed to the mechanic, primitive or win it concerns,
// then the planner re-plans the collection (another or an additional catalogue primitive for that mechanic, a
// primitive that declares the missing win), the outline repairs the failing fields again, or the gap layer writes the
// missing primitive. Then everything is verified again. The attempts are bounded by the pipeline config; when they
// are exhausted the build fails with what it tried and what is still missing.
import { rankCandidates } from './select.js';
import { isSpace, isGenerator, isGraphics, requirementsOf, satisfying } from './catalog.js';
import { cardLoop, winProviders } from './loop.js';
import { isObj, list, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('./select.js').Selection} Selection */
/** @typedef {import('./select.js').Gap} Gap */
/** @typedef {import('./decompose.js').Decomposition} Decomposition */
/** A problem as stages report it. @typedef {{ code?: unknown, path?: unknown, message?: unknown, primitive?: unknown, hint?: unknown }} StageProblem */
/**
 * What a failure is about. kind: 'primitive' (a chosen primitive cannot work here), 'mechanic' (nothing serves a
 * mechanic), 'win' (the collection cannot be won), 'loop' (the core loop does not happen in play), 'fields' (content
 * and params only the model can fix).
 * @typedef {{ kind: 'primitive' | 'mechanic' | 'win' | 'loop' | 'fields', mechanic?: string, primitive?: string, importance?: string, codes: string[], message: string }} Diagnosis
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

/** Does any chosen space host a primitive (its required capabilities)? @param {RegistryLike} registry @param {Selection} selection @param {string} id */
const hostable = (registry, selection, id) => {
  const need = requirementsOf(registry, id).capabilities;
  return (selection.spaces || []).some(s => need.every(c => (s.caps || []).includes(c)));
};

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
  /** Bring in what a primitive requires (closure), as selection does. @param {string} id */
  const require = id => { for (const r of requirementsOf(registry, id).primitives) { if (sel.systems.some(x => x === r || x.startsWith(r + '.'))) continue; const s = satisfying(registry, r); if (s) { sel.systems.push(s); require(s); } } };
  /** The next untried catalogue primitive for a mechanic that the chosen spaces host. @param {{ id: string, verb: string, description: string }} m */
  const next = m => {
    const seen = triedFor(m.id);
    const pool = rankCandidates(m, cards, 12).filter(c => !seen.has(c.id) && !sel.systems.includes(c.id) && hostable(registry, sel, c.id));
    return pool[0]?.id || null;
  };
  const coreMechanics = (sel.mechanics || []).filter(m => m.importance === 'core');
  for (const d of diagnoses) {
    if (d.kind === 'fields') { actions.push({ action: 'repair', ...(d.primitive ? { primitive: d.primitive } : {}), why: d.message }); continue; }
    if (d.kind === 'win') {
      const seen = triedFor('win');
      const caps = (sel.spaces || []).map(s => s.caps || []);
      const best = winProviders(registry, { caps: caps.length ? caps : [[]], exclude: [...sel.systems, ...seen] })[0];
      if (best) { seen.add(best.id); sel.systems.push(best.id); require(best.id); sel.gaps = sel.gaps.filter(g => g.kind !== 'win'); actions.push({ action: 'add', primitive: best.id, why: `declares a way to win (card.loop.win): ${d.message}` }); }
      else unresolved.push(d);
      continue;
    }
    if (d.kind === 'loop') {
      // The core loop does not happen in play: an additional primitive for the first core mechanic that has one left.
      let done = false;
      for (const m of coreMechanics) {
        for (const id of m.primitives || []) triedFor(m.id).add(id);
        const c = next(m);
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
    for (const id of m.primitives || []) triedFor(m.id).add(id);
    if (d.primitive) triedFor(m.id).add(d.primitive);
    const c = next(m);
    if (!c) { unresolved.push({ ...d, mechanic: m.id }); continue; }
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
    : `${m ? m.description : d.message}${d.primitive ? ` (instead of ${d.primitive}: ${d.message})` : ''}`;
  return { request: `${what}. It must work on ${spaces || 'the chosen space'} and declare its loop (card.loop: verbs, progress events${d.kind === 'win' ? ', win' : ''}).`.slice(0, 500),
    gap: { mechanic: d.mechanic || d.kind, description: what, importance: 'core', kind: d.kind === 'win' ? 'win' : 'no_primitive', why: d.message } };
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

/** Does a primitive declare a loop? (re-exported for callers that report the collection) @param {RegistryLike} registry @param {string} id */
export const declaresLoop = (registry, id) => Boolean(cardLoop(registry.get(id)?.card));
