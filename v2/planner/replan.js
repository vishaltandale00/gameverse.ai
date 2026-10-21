// @ts-check
// Figuring out how to make the game when a stage fails. There is no fallback: no default structure, no dropped or
// isolated primitive, no substituted game. Each failure is diagnosed to the mechanic, primitive or win it concerns,
// then the planner re-plans the collection (another catalogue primitive for that mechanic; the win, a driver or what
// changes the win's reads through the build's own loop steps, build-steps.js, the model choosing among checked
// candidates), the outline repairs the failing fields again, or the gap layer writes the missing primitive. Then
// everything is verified again. The attempts are bounded by the pipeline config; when they are exhausted the build
// fails with what it tried and what is still missing.
import { declaredFit, sharesVerbs, servesInteraction } from './select.js';
import { isSpace, isGenerator, isGraphics, requirementsOf, satisfying } from './catalog.js';
import { composeLoop, cardLoop } from './loop.js';
import { checkComposition } from './compose-check.js';
import { resolveAdapters } from './adapters.js';
import { loopProblems } from './loop-check.js';
import { loopCore } from './presets.js';
import { makeAsk, loopSteps, stepSignature, selectionCollection } from './build-steps.js';
import { mashupSides } from './play-spec.js';
import { isObj, isStr, list, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('./select.js').Selection} Selection */
/** @typedef {import('./select.js').Gap} Gap */
/** @typedef {import('./decompose.js').Decomposition} Decomposition */
/** @typedef {import('./compose-check.js').AdapterSpec} AdapterSpec */
/** @typedef {import('./compose-check.js').CompositionResult} CompositionResult */
/** A problem as stages report it. @typedef {{ code?: unknown, path?: unknown, message?: unknown, primitive?: unknown, hint?: unknown, need?: unknown }} StageProblem */
/** @typedef {import('./loop-check.js').LoopNeed} LoopNeed */
/**
 * What a failure is about. kind: 'primitive' (a chosen primitive cannot work here), 'mechanic' (nothing serves a
 * mechanic), 'win' (the collection cannot be won), 'loop' (the core loop does not happen in play), 'structure' (a
 * loop primitive's declared win can never be reached: `loop` says why, from the static loop check), 'fields' (content
 * and params only the model can fix).
 * `signature` (with `adapter`, compose-check's adapter card, when an adapter would fix it) is what re-planning found the
 * catalogue lacks: the gap layer's request.
 * @typedef {{ kind: 'primitive' | 'mechanic' | 'win' | 'loop' | 'structure' | 'fields', mechanic?: string, primitive?: string, importance?: string, codes: string[], message: string,
 *   signature?: string, adapter?: AdapterSpec, loop?: { code: string, need: LoopNeed } }} Diagnosis
 */
/** One re-planning decision. @typedef {{ action: 'replace' | 'add' | 'repair' | 'write', mechanic?: string, primitive?: string, by?: string, why: string }} Action */

export const REPLAN_VERSION = 'replan/0.1';

const GAME_PREFIX = /^(gameplay|plot)\./;
/** Gate verdicts (verify-adapter.js viability) that say the declared loop was never won or never progressed. */
export const GATE_LOOP = /\b(no_progress|loop_absent|plot_uncompletable)\b/;
/** Loop-check needs a re-planned loop primitive answers (its declarations cannot produce them): replaced for its mechanic. */
const REPLACE = new Set(['participants', 'seat', 'opponent', 'group', 'component']);
/** @param {unknown} v */
const text = v => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));

/**
 * Diagnose a stage's problems (and the selection's core gaps) to the mechanic, primitive or win they concern.
 * Gate verdicts (no_progress, loop_absent, plot_uncompletable) are diagnosed through the static loop check of the
 * played document (`core` orders its loops, as the preset's loopCore): which loop primitive's declared win or progress
 * was never reached, and why.
 * `opponent` is the play spec's opponent (the loop check's AI-opponent rule).
 * @param {StageProblem[]} problems @param {{ selection: Selection, registry: RegistryLike, doc?: unknown, core?: string[] | null, opponent?: string | null }} context @returns {Diagnosis[]}
 */
export function diagnose(problems, { selection, registry, doc = null, core: order = null, opponent = null }) {
  /** @type {Map<string, Diagnosis>} */
  const out = new Map();
  const mechOf = (/** @type {string} */ id) => (selection.mechanics || []).find(m => (m.primitives || []).includes(id));
  const put = (/** @type {Diagnosis} */ d) => {
    const key = `${d.kind}:${d.mechanic || ''}:${d.primitive || ''}:${d.loop?.code || ''}`;
    const cur = out.get(key);
    if (cur) { cur.codes = [...new Set([...cur.codes, ...d.codes])]; return; }
    out.set(key, d);
  };
  for (const g of selection.gaps || []) {
    if (g.importance !== 'core') continue;
    if (g.kind === 'win') put({ kind: 'win', codes: ['loop_win_undeclared'], message: g.description, importance: 'core' });
    else if (g.primitive && registry.has(g.primitive)) put({ kind: 'primitive', primitive: g.primitive, mechanic: mechOf(g.primitive)?.id || g.mechanic, codes: [`gap_${g.kind}`], message: g.description, importance: 'core' });
    else put({ kind: 'mechanic', mechanic: g.mechanic, codes: [`gap_${g.kind}`], message: g.description, importance: 'core', ...(g.signature ? { signature: g.signature } : {}), ...(g.adapter ? { adapter: g.adapter } : {}) });
  }
  const used = new Set([...(selection.systems || []), ...list(prop(doc, 'systems')).map(s => prop(s, 'use')).filter(/** @returns {x is string} */ x => typeof x === 'string')]);
  const ranked = [...used].filter(id => GAME_PREFIX.test(id)).sort((a, b) => b.length - a.length);
  const core = order || (selection.mechanics || []).filter(m => m.importance === 'core').flatMap(m => m.primitives || []).filter(id => GAME_PREFIX.test(id));
  /** A static loop problem: which loop primitive's declared win can never be reached, and why. @param {StageProblem} p @param {string[]} codes */
  const structural = (p, codes) => {
    const primitive = text(p.primitive), need = /** @type {LoopNeed} */ (p.need);
    put({ kind: 'structure', primitive, mechanic: mechOf(primitive)?.id, codes, message: text(p.message), loop: { code: text(p.code), need } });
  };
  /** The structural cause of a gate verdict, from the static loop check of the document the gate played. @type {StageProblem[] | null} */
  let causes = null;
  for (const p of problems) {
    const code = text(p.code), path = text(p.path), message = text(p.message);
    // A selection gap restated as a problem is already diagnosed above.
    if (code.startsWith('gap_')) continue;
    // The static loop check's own problems (outline stage, before any model call).
    if (code.startsWith('loop_') && isObj(p.need) && isStr(p.primitive)) { structural(p, [code]); continue; }
    // The gate saw no progress, no loop, or no reachable ending: diagnose which loop primitive's declared win or progress
    // was never reached and why (a missing participant, no action that affects what the win reads, an unwired win).
    const verdict = GATE_LOOP.exec(`${code} ${message}`)?.[1];
    if (verdict && (code === 'not_playable' || code === verdict)) {
      causes ??= doc ? loopProblems(doc, registry, { core, opponent }) : [];
      if (causes.length) { for (const c of causes) structural(c, [code === verdict ? code : `${code}:${verdict}`, text(c.code)]); continue; }
    }
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
 * Re-plan the collection for a diagnosis: another catalogue primitive for a failing primitive's mechanic; and through
 * the build's loop steps (build-steps.js, one small strict question each, asked of `writer`), the primitive that
 * declares the missing win, the driver of AI opponents nothing drives (loop_opponent_inert) and what lets play change
 * the win's reads (loop_win_unaffected, or the gate's no_progress and loop_absent). `tried` (mechanic or step kind ->
 * ids) grows with every choice, so nothing is offered twice. Never removes a primitive without putting another in its
 * place. Without a writer the loop steps choose nothing: their needs are unresolved, with the gap layer's signature.
 * -> { selection, actions, unresolved }
 * @param {Selection} selection @param {Diagnosis[]} diagnoses
 * @param {{ registry: RegistryLike, decomposition: Decomposition, tried: Map<string, Set<string>>, writer?: import('./types.js').Writer | null, attempts?: number, log?: (msg: string) => void }} context
 * @returns {Promise<{ selection: Selection, actions: Action[], unresolved: Diagnosis[] }>}
 */
export async function replan(selection, diagnoses, { registry, decomposition, tried, writer = null, attempts = 2, log = () => {} }) {
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
  const joined = (/** @type {string} */ id) => (decomposition.core?.mashup || []).some(x => mashupSides(x, decomposition.mechanics || []).inner.includes(id));
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
  // The core loop mechanic: the play spec's, else the first core one. The loop steps' picks join it.
  const loopId = isStr(prop(decomposition.core, 'loop')) ? String(prop(decomposition.core, 'loop')) : null;
  const loopMechanic = (sel.mechanics || []).find(m => m.id === loopId) || coreMechanics[0] || null;
  const ask = writer?.complete ? makeAsk({ writer, attempts, log }) : null;
  /** The selection as the loop steps read it (build-steps.js selectionCollection). */
  const collectionOf = () => selectionCollection(registry, sel, loopMechanic?.id ?? null);
  /**
   * Re-plan through the loop steps (build-steps.js), the same mechanism the build ran: one small strict question over
   * checked candidates for `need`, never a pick made here. Candidates tried before (here, or offered by the build's own
   * step of that kind when it ended in a gap) and primitives that failed are not offered again. Without a model nothing
   * is chosen: the need is unresolved with its signature. -> what was added, or the gap layer's request.
   * @param {import('./build-steps.js').StepNeed} need @returns {Promise<{ added: string[], why: string, signature: string, adapter?: AdapterSpec }>}
   */
  const step = async need => {
    const seen = triedFor(`step:${need.kind}`);
    for (const s of /** @type {any[]} */ (sel.build?.steps || [])) if (s?.kind === need.kind && s.outcome === 'gap') for (const x of s.candidates || []) seen.add(x.id);
    if (!ask) return { added: [], why: '', signature: stepSignature(need, decomposition, collectionOf(), registry) };
    /** @type {string[]} */
    const added = [];
    const r = await loopSteps({ registry, decomposition, collection: collectionOf(), ask, mechanic: loopMechanic, needs: [need], only: [need.kind], log,
      exclude: () => [...seen, ...failed],
      commit: (kind, pick) => {
        for (const id of pick.members) { if (!sel.systems.includes(id)) { sel.systems.push(id); added.push(id); } require(id); }
        if (pick.adapters.length) {
          const resolved = resolveAdapters({ spaces: sel.spaces, systems: sel.systems }, registry);
          sel.adapters = resolved.adapters; Object.assign(sel.bind, resolved.bind);
        }
        if (kind !== 'driver' && loopMechanic && !loopMechanic.primitives.includes(pick.id)) loopMechanic.primitives = [...loopMechanic.primitives, pick.id];
        return collectionOf();
      } });
    for (const s of r.steps) for (const x of s.candidates) seen.add(x.id);
    const last = r.steps[r.steps.length - 1];
    const gap = r.gaps[0];
    return { added, why: last?.asks[last.asks.length - 1]?.why || '', signature: gap?.signature || (added.length ? '' : stepSignature(need, decomposition, collectionOf(), registry)), ...(gap?.adapter ? { adapter: gap.adapter } : {}) };
  };
  /** The need a structure diagnosis is (its loop problem), for the driver or coverage step; null for another kind. @param {Diagnosis} d @returns {import('./build-steps.js').StepNeed | null} */
  const needOf = d => {
    const n = d.loop?.need;
    if (!n) return null;
    const problem = /** @type {import('./loop-check.js').LoopProblem} */ ({ code: d.loop?.code || '', path: '', message: d.message, hint: '', severity: 'error', stage: 'loop', primitive: d.primitive || '', need: n });
    if (n.kind === 'driver') return { kind: 'driver', key: `driver:${d.loop?.code}:${d.primitive}`, why: d.message, problem };
    if (['owner', 'action', 'event', 'var'].includes(n.kind)) return { kind: 'coverage', key: `coverage:${d.loop?.code}:${d.primitive}`, why: d.message, problem };
    return null;
  };
  // A loop primitive whose declared win can never be reached (the static loop check, or the cause of a gate verdict):
  // when its own declarations cannot produce what the loop needs (participants, sides, the components its win reads),
  // it is re-planned like a failing primitive; an unwired win like a missing one; what play cannot change (an action
  // or a player-driven producer) and an unowned component are added below.
  const mapped = diagnoses.map(d => (d.kind !== 'structure' || !d.loop ? d : REPLACE.has(d.loop.need.kind) ? /** @type {Diagnosis} */ ({ ...d, kind: 'primitive' }) : d.loop.need.kind === 'win' || d.loop.need.kind === 'lose' ? /** @type {Diagnosis} */ ({ ...d, kind: 'win' }) : d));
  // Primitives first: a replacement may itself declare the missing win.
  const ordered = [...mapped.filter(d => d.kind === 'primitive' || d.kind === 'mechanic'), ...mapped.filter(d => d.kind !== 'primitive' && d.kind !== 'mechanic')];
  for (const d of ordered) if (d.kind === 'primitive' && d.primitive) failed.add(d.primitive);
  for (let d of ordered) {
    if (d.kind === 'fields') { actions.push({ action: 'repair', ...(d.primitive ? { primitive: d.primitive } : {}), why: d.message }); continue; }
    if (d.kind === 'structure' && d.loop) {
      // AI participants nothing drives, or what play cannot change of the win's reads: the driver or coverage step.
      const need = needOf(d);
      if (need) {
        const r = await step(need);
        if (r.added.length) { actions.push({ action: 'add', ...(need.kind !== 'driver' && loopMechanic ? { mechanic: loopMechanic.id } : {}), primitive: r.added[0], why: `${need.kind} step${r.why ? ` (${r.why})` : ''}: ${d.message}`.slice(0, 240) }); continue; }
        unresolved.push({ ...d, signature: r.signature, ...(r.adapter ? { adapter: r.adapter } : {}) });
        continue;
      }
      // Its win declares no reads (a declaration hole): the loop primitive itself is re-planned for its mechanic.
      if (!d.primitive) { unresolved.push(d); continue; }
      failed.add(d.primitive);
      d = { ...d, kind: 'primitive' };
    }
    if (d.kind === 'win' || d.kind === 'loop') {
      // A declared win or lose never wired is the preset's to wire, from the declarations.
      if (d.loop) { actions.push({ action: 'repair', why: d.message }); continue; }
      const composed = composeLoop(sel.systems, registry, { core: loopCore(decomposition, sel, registry) });
      if (actions.length && composed.win) { actions.push({ action: 'repair', why: `the re-planned collection declares a win: ${d.message}` }); continue; }
      // No declared win: the win step. A declared win play never reached, or a loop that never happened (no_progress,
      // loop_absent): the coverage step, over what changes the win's reads.
      const need = /** @type {import('./build-steps.js').StepNeed} */ (composed.win ? { kind: 'coverage', key: 'coverage:gate', why: d.message } : { kind: 'win', key: 'win', why: d.message });
      const r = await step(need);
      if (r.added.length) {
        if (need.kind === 'win') sel.gaps = sel.gaps.filter(g => g.kind !== 'win');
        actions.push({ action: 'add', ...(loopMechanic ? { mechanic: loopMechanic.id } : {}), primitive: r.added[0], why: `${need.kind} step${r.why ? ` (${r.why})` : ''}: ${d.message}`.slice(0, 240) });
      } else unresolved.push({ ...d, signature: r.signature, ...(r.adapter ? { adapter: r.adapter } : {}) });
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
    if (!c) { unresolved.push({ ...d, mechanic: m.id, signature: d.loop && d.signature ? d.signature : found.signature, ...(found.adapter ? { adapter: found.adapter } : {}) }); continue; }
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
    : d.kind === 'structure' && d.signature ? `${m ? `"${m.description}": ` : ''}${d.signature}`
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
export const missingText = ds => ds.map(d => `${d.kind}${d.mechanic ? ` "${d.mechanic}"` : ''}${d.primitive ? ` (${d.primitive})` : ''}${d.loop ? ` [${d.codes.join(', ')}]` : ''}: ${d.message}${d.signature && d.loop ? `; needed: ${d.signature}` : ''}`.slice(0, 400));

