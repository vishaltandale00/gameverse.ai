// @ts-check
// Figuring out how to make the game when a stage fails. There is no fallback: no default structure, no dropped or
// isolated primitive, no substituted game. Each failure is diagnosed to the mechanic, primitive or win it concerns,
// then the planner re-plans the collection (another catalogue primitive for that mechanic, through the build's own
// retrieval: retrieval.js coverage by declarations, every valid option, one model pick; the win, a driver or what
// changes the win's reads through the build's own loop steps, build-steps.js, the model choosing among checked
// candidates), the outline repairs the failing fields again, or the gap layer writes the missing primitive. Then
// everything is verified again. The attempts are bounded by the pipeline config; when they are exhausted the build
// fails with what it tried and what is still missing.
import { requirementsOf, satisfying, dataShapes } from './catalog.js';
import { composeLoop, cardLoop } from './loop.js';
import { documentedBy } from './compose-check.js';
import { resolveAdapters, keepMashupAdapters } from './adapters.js';
import { collectionChecks, collectionState, coverageOf, askCoverage, validOptions, pickOption, ownersOf } from './retrieval.js';
import { loopProblems } from './loop-check.js';
import { loopCore } from './presets.js';
import { makeAsk, loopSteps, stepSignature, selectionCollection, askWins } from './build-steps.js';
import { isObj, isStr, list, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('./select.js').Selection} Selection */
/** @typedef {import('./select.js').Gap} Gap */
/** @typedef {import('./decompose.js').Decomposition} Decomposition */
/** @typedef {import('./compose-check.js').AdapterSpec} AdapterSpec */
/** @typedef {import('./compose-check.js').AdapterInstance} AdapterInstance */
/** @typedef {import('./compose-check.js').CompositionResult} CompositionResult */
/** A problem as stages report it. @typedef {{ code?: unknown, path?: unknown, message?: unknown, primitive?: unknown, hint?: unknown, need?: unknown }} StageProblem */
/** @typedef {import('./loop-check.js').LoopNeed} LoopNeed */
/**
 * What a failure is about. kind: 'primitive' (a chosen primitive cannot work here), 'mechanic' (nothing serves a
 * mechanic), 'win' (the collection cannot be won), 'loop' (the core loop does not happen in play), 'structure' (a
 * loop primitive's declared win can never be reached: `loop` says why, from the static loop check), 'fields' (content
 * and params only the model can fix).
 * `signature` (with `adapter`, compose-check's adapter card, when an adapter would fix it) is what re-planning found the
 * catalogue lacks: the gap layer's request. `reason`: why re-planning took no action for it (an unresolved diagnosis).
 * @typedef {{ kind: 'primitive' | 'mechanic' | 'win' | 'loop' | 'structure' | 'fields', mechanic?: string, primitive?: string, importance?: string, codes: string[], message: string,
 *   signature?: string, adapter?: AdapterSpec, loop?: { code: string, need: LoopNeed }, reason?: string }} Diagnosis
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

/**
 * The primitive signature the gap layer writes when no catalogue primitive fits a mechanic: what its loop must declare.
 * @param {{ id: string, description: string }} m @param {Selection} sel @param {string | null} interaction the mechanic's interaction context @param {string[]} verbs what the failing primitive did
 */
const primitiveSignature = (m, sel, interaction, verbs) => `${m.id}: a primitive whose loop (card.loop) ${interaction ? `is played as ${interaction}, ` : ''}${verbs.length ? `does what ${verbs.join('/')} did, ` : ''}with verbs and progress events for "${m.description}", on ${(sel.spaces || []).map(s => `${s.use} (${(s.caps || []).join(', ')})`).join(', ') || 'the chosen space'}`.slice(0, 400);

/**
 * Re-plan the collection for a diagnosis: for a failing primitive's mechanic (or one nothing serves), the build's own
 * retrieval (retrieval.js): a primitive already in the collection that covers it by its declarations takes its place
 * (a weaker declared match is asked), else every valid option on the collection without the failing primitive is
 * offered in one model pick; and through
 * the build's loop steps (build-steps.js, one small strict question each, asked of `writer`), the primitive that
 * declares the missing win, the driver of AI opponents nothing drives (loop_opponent_inert) and what lets play change
 * the win's reads (loop_win_unaffected, or the gate's no_progress and loop_absent). `tried` (mechanic or step kind ->
 * ids) grows with every choice, so nothing is offered twice. Never removes a primitive without putting another in its
 * place. Without a writer nothing is chosen (only a declaration that clearly covers the mechanic is taken): the need is
 * unresolved, with the gap layer's signature and the reason no action was taken (`reason`). A pick that makes the
 * collection declare a second win is followed by the build's own wins question (build-steps.js askWins: selection.win).
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
  const triedFor = (/** @type {string} */ key) => { let s = tried.get(key); if (!s) { s = new Set(); tried.set(key, s); } return s; };
  // Primitives that failed here are never chosen again, for any mechanic or the win.
  const failed = triedFor('failed');
  /** Bring in what a primitive requires (closure), as selection does. @param {string} id */
  const require = id => { for (const r of requirementsOf(registry, id).primitives) { if (sel.systems.some(x => x === r || x.startsWith(r + '.'))) continue; const s = satisfying(registry, r); if (s) { sel.systems.push(s); require(s); } } };
  const interaction = decomposition.core?.interaction || null;
  const documented = documentedBy(dataShapes);
  const ask = writer?.complete ? makeAsk({ writer, attempts, log }) : null;
  const premise = `Game idea: ${decomposition.premise || ''}\nPlayed as: ${interaction || 'undecided'}`;
  /**
   * What takes a failing primitive's place for its mechanic (or serves a mechanic nothing serves), by the build's own
   * retrieval: a primitive already in the collection that covers it by declarations (asked when the match is weak),
   * else one model pick over every valid option on the collection without the failing primitive. Untried only (`tried`
   * per mechanic, and primitives that failed). Without a model nothing is picked. -> the covering primitive, the
   * picked option, or the gap layer's request.
   * @param {{ id: string, verb: string, description: string, importance?: string, from?: string, primitives?: string[] }} m @param {string | null} old
   * @param {string} message
   * @returns {Promise<{ covered: string, why: string } | { option: import('./retrieval.js').Option, why: string } | { signature: string, reason: string }>}
   */
  const replacement = async (m, old, message) => {
    const seen = triedFor(m.id);
    const mechanic = /** @type {import('./decompose.js').Mechanic} */ ({ from: '', importance: 'core', ...(decomposition.mechanics || []).find(x => x.id === m.id), ...m });
    const others = (sel.mechanics || []).map(x => ({ id: x.id, primitives: (x.primitives || []).filter(id => id !== old) }));
    const mapping = Object.fromEntries(others.map(x => [x.id, { primitives: x.primitives }]));
    const verbs = old ? cardLoop(registry.get(old)?.card)?.verbs || [] : [];
    const spec = { mechanics: decomposition.mechanics || [], concepts: decomposition.concepts, core: decomposition.core };
    const header = `${premise}\nSpace: ${sel.spaces[0]?.use || 'none'}\nCollection so far: ${sel.systems.filter(x => x !== old).join(', ') || '(empty)'}`;
    const cov = coverageOf({ registry, decomposition: spec, mechanic, mapping, owners: ownersOf(others), exclude: [...failed, ...(old ? [old] : [])] });
    let covered = cov.covered;
    if (!covered && cov.ambiguous.length && ask) covered = (await askCoverage({ ask, registry, header, mechanic, ambiguous: cov.ambiguous })).covered;
    if (covered) return { covered: covered.primitive, why: covered.why };
    const rest = sel.systems.filter(x => x !== old);
    const state = collectionState({ checks: checksOf(), systems: rest, variant: 0, variants: [0] });
    const found = validOptions({ registry, decomposition: spec, mechanic, mapping, state, systems: rest, space: sel.spaces[0]?.use || '', adapters: state.baseline.adapters, exclude: [...seen, ...failed], verbs });
    if (!found.options.length || !ask) return { signature: primitiveSignature(m, sel, found.context, verbs), reason: !found.options.length ? `no untried valid option for ${m.id}${found.rejected.length ? ` (${found.rejected.slice(0, 2).map(x => `${x.id}: ${x.why}`).join('; ')})` : ''}`.slice(0, 300) : 'no model to choose among the options' };
    const a = await pickOption({ ask, registry, header, mechanic, options: found.options, problem: old ? `It replaces ${old}, which failed: ${message}`.slice(0, 300) : null });
    const option = found.options.find(o => o.id === a.pick);
    if (!option) return { signature: `${primitiveSignature(m, sel, found.context, verbs)}${a.spec ? `. Spec: ${a.spec}` : ''}`.slice(0, 600), reason: `the model picked none of ${found.options.length} option(s): ${a.why || 'none fits'}`.slice(0, 300) };
    return { option, why: a.why };
  };
  /** The validity checks on the selection's space (the build's: retrieval.js collectionChecks). */
  const checksOf = () => { const space = sel.spaces[0]; return collectionChecks({ registry, space: { id: space?.id || 'world', use: space?.use || '' }, variants: [{ with: space?.with || {} }], documented, interaction: decomposition.core?.interaction || null }); };
  /**
   * The adapter instances and bindings the re-planned collection resolves (bindings to the selection's own spaces stay),
   * with the instances realising the mashup relations and the bindings onto their regions kept (keepMashupAdapters).
   * @param {{ adapters: AdapterInstance[], bind: Record<string, string> }} resolved
   */
  const adopt = resolved => {
    const kept = keepMashupAdapters(resolved, sel);
    const own = new Set((sel.spaces || []).map(x => x.id));
    sel.adapters = kept.adapters;
    sel.bind = { ...Object.fromEntries(Object.entries(sel.bind || {}).filter(([, x]) => own.has(x))), ...kept.bind };
  };
  const reresolve = () => adopt(checksOf().evaluate(sel.systems, 0));
  const coreMechanics = (sel.mechanics || []).filter(m => m.importance === 'core');
  // The core loop mechanic: the play spec's, else the first core one. The loop steps' picks join it.
  const loopId = isStr(prop(decomposition.core, 'loop')) ? String(prop(decomposition.core, 'loop')) : null;
  const loopMechanic = (sel.mechanics || []).find(m => m.id === loopId) || coreMechanics[0] || null;
  /** The selection as the loop steps read it (build-steps.js selectionCollection). */
  const collectionOf = () => selectionCollection(registry, sel, loopMechanic?.id ?? null);
  /**
   * Re-plan through the loop steps (build-steps.js), the same mechanism the build ran: one small strict question over
   * checked candidates for `need`, never a pick made here. Candidates tried before (here, or offered by the build's own
   * step of that kind when it ended in a gap) and primitives that failed are not offered again. Without a model nothing
   * is chosen: the need is unresolved with its signature and the reason. A pick joins the need's mechanic (a coverage
   * need: the mechanic of the primitive whose end it serves), else the core loop mechanic; when the collection then
   * declares more than one win, the build's wins question picks the game's (selection.win).
   * -> what was added, or the gap layer's request and why nothing was.
   * @param {import('./build-steps.js').StepNeed} need @returns {Promise<{ added: string[], why: string, signature: string, reason: string, adapter?: AdapterSpec }>}
   */
  const step = async need => {
    const seen = triedFor(`step:${need.kind}`);
    for (const s of /** @type {any[]} */ (sel.build?.steps || [])) if (s?.kind === need.kind && s.outcome === 'gap') for (const x of s.candidates || []) seen.add(x.id);
    if (!ask) return { added: [], why: '', signature: stepSignature(need, decomposition, collectionOf(), registry), reason: 'no model to choose a candidate' };
    /** @type {string[]} */
    const added = [];
    const r = await loopSteps({ registry, decomposition, collection: collectionOf(), ask, mechanic: loopMechanic, needs: [need], only: [need.kind], log,
      exclude: () => [...seen, ...failed],
      commit: (kind, pick, mech) => {
        for (const id of pick.members) { if (!sel.systems.includes(id)) { sel.systems.push(id); added.push(id); } require(id); }
        if (pick.adapters.length) adopt(resolveAdapters({ spaces: sel.spaces, systems: sel.systems }, registry));
        const into = (sel.mechanics || []).find(x => x.id === mech) || loopMechanic;
        if (kind !== 'driver' && into && !into.primitives.includes(pick.id)) into.primitives = [...into.primitives, pick.id];
        return collectionOf();
      } });
    for (const s of r.steps) for (const x of s.candidates) seen.add(x.id);
    const last = r.steps[r.steps.length - 1];
    const gap = r.gaps[0];
    if (added.length) {
      const w = await askWins({ registry, decomposition, collection: collectionOf(), ask, decided: sel.win || null, mechanic: need.join ?? loopMechanic?.id ?? null });
      if (w) sel.win = w.decision;
    }
    return { added, why: last?.asks[last.asks.length - 1]?.why || '', signature: gap?.signature || (added.length ? '' : stepSignature(need, decomposition, collectionOf(), registry)),
      reason: added.length ? '' : gap?.why || 'the step added nothing', ...(gap?.adapter ? { adapter: gap.adapter } : {}) };
  };
  /** The need a structure diagnosis is (its loop problem), for the driver or coverage step; null for another kind. @param {Diagnosis} d @returns {import('./build-steps.js').StepNeed | null} */
  const needOf = d => {
    const n = d.loop?.need;
    if (!n) return null;
    const problem = /** @type {import('./loop-check.js').LoopProblem} */ ({ code: d.loop?.code || '', path: '', message: d.message, hint: '', severity: 'error', stage: 'loop', primitive: d.primitive || '', need: n });
    if (n.kind === 'driver') return { kind: 'driver', key: `driver:${d.loop?.code}:${d.primitive}`, why: d.message, problem };
    // What play cannot change of an end's reads: the coverage step, its pick joining the primitive's own mechanic.
    if (['owner', 'action', 'event', 'var'].includes(n.kind)) return { kind: 'coverage', key: `coverage:${d.loop?.code}:${d.primitive}`, why: d.message, problem, ...(d.mechanic ? { join: d.mechanic } : {}) };
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
        const into = need.kind !== 'driver' ? need.join || loopMechanic?.id : null;
        if (r.added.length) { actions.push({ action: 'add', ...(into ? { mechanic: into } : {}), primitive: r.added[0], why: `${need.kind} step${r.why ? ` (${r.why})` : ''}: ${d.message}`.slice(0, 240) }); continue; }
        log(`replan: no action for ${d.loop.code} ${d.primitive || ''}: ${r.reason}`);
        unresolved.push({ ...d, signature: r.signature, reason: `${need.kind} step: ${r.reason}`.slice(0, 400), ...(r.adapter ? { adapter: r.adapter } : {}) });
        continue;
      }
      // Its win declares no reads (a declaration hole): the loop primitive itself is re-planned for its mechanic.
      if (!d.primitive) { unresolved.push({ ...d, reason: `${d.loop.code} names no primitive to re-plan` }); continue; }
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
      } else unresolved.push({ ...d, signature: r.signature, reason: `${need.kind} step: ${r.reason}`.slice(0, 400), ...(r.adapter ? { adapter: r.adapter } : {}) });
      continue;
    }
    const m = (sel.mechanics || []).find(x => x.id === d.mechanic) || (d.primitive ? (sel.mechanics || []).find(x => (x.primitives || []).includes(/** @type {string} */ (d.primitive))) : undefined);
    if (!m) { unresolved.push({ ...d, reason: `no mechanic of the selection maps ${d.mechanic || d.primitive || 'it'}` }); continue; }
    // The mechanic's other primitives stay on offer (re-used); the failing one and earlier replacements never are.
    if (d.primitive) triedFor(m.id).add(d.primitive);
    const old = d.kind === 'primitive' && d.primitive ? d.primitive : null;
    const found = await replacement(m, old, d.message);
    if ('signature' in found) { unresolved.push({ ...d, mechanic: m.id, signature: d.loop && d.signature ? d.signature : found.signature, reason: found.reason }); continue; }
    const by = 'covered' in found ? found.covered : found.option.id;
    triedFor(m.id).add(by);
    // The failing primitive leaves (what another mechanic still maps to stays), the replacement takes its place.
    if (old) sel.systems = sel.systems.filter(x => x !== old || (sel.mechanics || []).some(o => o !== m && (o.primitives || []).includes(old)));
    const extra = 'option' in found ? found.option.extra.filter(x => x.kind === 'declared').map(x => x.id) : [];
    m.primitives = [...new Set([...(m.primitives || []).filter(x => x !== old), by, ...extra])];
    for (const id of 'option' in found ? found.option.members : [by]) { if (!sel.systems.includes(id)) sel.systems.push(id); require(id); }
    if (sel.spaces?.length) reresolve();
    const why = 'covered' in found ? `${found.why}: ${d.message}` : `${found.why ? `${found.why}: ` : ''}${d.message}`;
    actions.push(old ? { action: 'replace', mechanic: m.id, primitive: old, by, why: why.slice(0, 240) } : { action: 'add', mechanic: m.id, primitive: by, why: why.slice(0, 240) });
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
export const missingText = ds => ds.map(d => `${d.kind}${d.mechanic ? ` "${d.mechanic}"` : ''}${d.primitive ? ` (${d.primitive})` : ''}${d.loop ? ` [${d.codes.join(', ')}]` : ''}: ${d.message}${d.reason ? `; no action: ${d.reason}` : ''}${d.signature && d.loop ? `; needed: ${d.signature}` : ''}`.slice(0, 600));

