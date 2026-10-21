// The template contract (ARCHITECTURE.md §5): what makes `{ id, concept, doc, tune }` a verified template, as one
// function. Every template check lives HERE, in STAGES order, with a stable problem code; the suite
// (tests/v2-template-contract.test.js), discovery (v2/templates/registry.js: the format stage only, cheap at load) and
// promotion (v2/improve, target 'template': the whole contract against the live catalogue) all call it. A check
// added to templates later is added to this file, never to one caller.
//
//   format       id, a one-line concept, a document whose id is the template id, tune a list of '<primitive>.<param>'
//   tune         each tune path names a scalar param the card declares, of exactly one instance in the document
//   preflight    the document preflights against the catalogue's card-derived schemas
//   composition  the static composition check (card declarations only) finds no failure
//   loop         the loop check finds no problem
//   gate         the publish gate (verifyDocument with the playtest agents' budget) finds it viable
//   controls     the document a person plays (the host's input and UI added) gives a control for every verb its loops
//                declare, and each direction pressed through the controls moves the player the way the view shows it
//   features     every primitive the document mixes in exists, is controllable and works when its controls are pressed
//                from states the gate's play reached (verify/features.js; the table is in the evidence)
//   bots         every bot the document's loops name (card.mode.bot) is the one the gate plays, wins with status 'won'
//                on every world seed in SEEDS through the real controls, and replays to the same runs
//
// Static stages stop the check when one fails (nothing simulates a document that is malformed or fails its
// declarations); the dynamic stages (gate, bots) both run once the static ones pass.
import { isDeepStrictEqual } from 'node:util';
import { preflight } from '../kernel/document.js';
import { checkComposition } from '../planner/compose-check.js';
import { loopProblems } from '../planner/loop-check.js';
import { verifyDocument } from '../planner/verify-adapter.js';
import { tuneTarget } from '../planner/templates.js';
import { controlledMaker, hostPreflight } from '../verify/controls.js';
import { usedPrimitives } from '../verify/util.js';
import { strategies, select, modeBots } from '../verify/strategies/index.js';
import { documentUncontrolled } from '../verify/controls.js';
import { directionProblems, DIRECTION_CODES } from '../verify/directions.js';
import { FEATURE_CODES } from '../verify/features.js';

export const CONTRACT_VERSION = 'template-contract/0.1';
export const DOC_SCHEMA = 'gameverse.v2.game/0.2';
/** The world seeds every named bot must win on (and replay). */
export const SEEDS = Object.freeze([1, 2, 3]);
/** The publish gate's budgets, as the template suite runs it. */
export const GATE = Object.freeze({ budgetMs: 800, playtestMs: 1500 });
/** A named bot's wall budget, and the run options particular bots take (their own params, by strategy id). */
export const BOT_BUDGET_MS = 60000;
export const BOT_OPTS = Object.freeze({ 'danger-field': Object.freeze({ maxFrames: 15000 }), dodge: Object.freeze({ seconds: 60, every: 8 }) });
/** Param types a tune path may name: a single value the frame_tune form can ask for. */
export const SCALAR_TYPES = Object.freeze(['number', 'integer', 'boolean', 'string']);
/** A template id: a lowercase slug (a promoted template's file name and an enum value of the pick form). */
export const ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
/** Ids the pick form already gives a meaning (planner/templates.js pickForm: 'none' routes to the step path). */
export const RESERVED_IDS = Object.freeze(['none']);

/** Every problem code the contract emits, by stage (the stage order is the check order). */
export const CODES = Object.freeze({
  format: Object.freeze(['template_shape', 'template_id_invalid', 'template_id_reserved', 'template_concept_invalid', 'template_doc_invalid', 'template_doc_id_mismatch', 'template_tune_invalid']),
  tune: Object.freeze(['tune_unknown', 'tune_not_scalar', 'tune_ambiguous']),
  preflight: Object.freeze(['preflight_failed']),
  composition: Object.freeze(['composition_failed']),
  loop: Object.freeze(['loop_problem']),
  gate: Object.freeze(['gate_not_viable']),
  controls: Object.freeze(['controls_missing', ...DIRECTION_CODES]),
  features: Object.freeze([...new Set(Object.values(FEATURE_CODES).flat())]),
  bots: Object.freeze(['bot_unnamed', 'bot_selection_mismatch', 'bot_failed', 'bot_not_won', 'replay_mismatch']),
});
export const STAGES = Object.freeze(Object.keys(CODES));
const DYNAMIC = STAGES.indexOf('gate');

const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const problem = (code, message, extra = {}) => ({ code, message, ...extra });

/** The format stage: needs no catalogue (discovery admits templates through it at load). */
export function formatProblems(t) {
  if (!isObj(t)) return [problem('template_shape', 'a template is an object { id, concept, doc, tune }')];
  const out = [];
  if (typeof t.id !== 'string' || !ID_PATTERN.test(t.id)) out.push(problem('template_id_invalid', `id ${JSON.stringify(t.id)} is not a lowercase slug (${ID_PATTERN})`, { path: 'id' }));
  else if (RESERVED_IDS.includes(t.id)) out.push(problem('template_id_reserved', `id '${t.id}' is reserved by the template pick`, { path: 'id' }));
  if (typeof t.concept !== 'string' || t.concept.trim().length <= 10 || t.concept.includes('\n')) out.push(problem('template_concept_invalid', 'concept is one line of more than 10 characters: what the template pick matches the idea against', { path: 'concept' }));
  if (!isObj(t.doc) || t.doc.schema !== DOC_SCHEMA) out.push(problem('template_doc_invalid', `doc is a complete game document (schema ${DOC_SCHEMA})`, { path: 'doc' }));
  else if (t.doc.id !== t.id) out.push(problem('template_doc_id_mismatch', `the document id '${t.doc.id}' is not the template id '${t.id}'`, { path: 'doc.id' }));
  if (!Array.isArray(t.tune) || !t.tune.every(p => typeof p === 'string' && p.length > 0) || new Set(t.tune).size !== t.tune.length) out.push(problem('template_tune_invalid', "tune is a list of distinct '<primitive id>.<param>' paths", { path: 'tune' }));
  return out;
}

/** The tune stage: each path names one declared scalar param of exactly one instance. */
export function tuneProblems(t, registry) {
  const out = [];
  for (const path of t.tune) {
    const target = tuneTarget(t.doc, path, registry);
    if (!target) { out.push(problem('tune_unknown', `tune '${path}' names no param a card declares on an instance in the document`, { path })); continue; }
    if (!SCALAR_TYPES.includes(target.spec.type)) out.push(problem('tune_not_scalar', `tune '${path}' is a ${target.spec.type}; a tune param is one of ${SCALAR_TYPES.join(', ')}`, { path }));
    if (target.instances.length !== 1) out.push(problem('tune_ambiguous', `tune '${path}' names ${target.instances.length} instances of ${target.use}; it must name exactly one`, { path }));
  }
  return out;
}

/**
 * The context the gate's bots play a preflighted host document in (the document a person plays: v2/web/host-doc.js),
 * through the controls a person has (v2/verify/controls.js).
 */
export function playContext(checked, registry, logic) {
  const make = controlledMaker(checked.doc, registry, logic);
  return { doc: checked.doc, registry, logic, make, seed: SEEDS[0], capabilities: checked.capabilities, used: usedPrimitives(checked.doc), playerSpace: make(SEEDS[0]).player()?.space ?? checked.doc.spaces[0].id };
}

const runsOf = r => r?.metrics?.runs ?? r?.metrics?.matches ?? [];
const strip = runs => runs.map(({ budget, ...x }) => x);

/** The bots stage over a preflighted document; per-bot evidence goes into `evidence.bots`. */
function botProblems(checked, registry, logic, evidence) {
  const out = [], ctx = playContext(checked, registry, logic);
  const named = modeBots(ctx).map(x => x.s.id);
  if (!named.length) return [problem('bot_unnamed', 'no loop in the document names its bot (card.mode.bot)')];
  const chosen = select(ctx).chosen.map(c => c.s.id);
  if (!isDeepStrictEqual(chosen, named)) out.push(problem('bot_selection_mismatch', `the gate plays ${chosen.join(', ') || 'no bot'}; the loops name ${named.join(', ')}`));
  for (const id of named) {
    const bot = strategies.get(id), opts = { budgetMs: BOT_BUDGET_MS, seeds: [...SEEDS], ...BOT_OPTS[id] };
    const t0 = performance.now();
    let a, b;
    // A bot that asks for a verb no control issues, or that throws, fails here with what it needed.
    try { a = bot.run(ctx, opts); b = bot.run(ctx, opts); } catch (error) { out.push(problem('bot_failed', `${id}: ${String(error?.message || error).slice(0, 400)}`, { bot: id, ...(error?.code ? { cause: error.code } : {}) })); continue; }
    const runs = runsOf(a);
    evidence.bots.push({ id, runs: runs.map(r => ({ seed: r.seed ?? null, status: r.status ?? null, frames: r.frames ?? null })), ms: Math.round(performance.now() - t0) });
    if (a.ok !== true) out.push(problem('bot_failed', `${id}: ${JSON.stringify(a.problems).slice(0, 400)}`, { bot: id }));
    for (const seed of SEEDS) {
      const r = runs.find(x => x.seed === seed);
      if (!r) out.push(problem('bot_not_won', `${id}: world seed ${seed} did not run`, { bot: id, seed }));
      else if (r.status !== 'won') out.push(problem('bot_not_won', `${id}: world seed ${seed} ended ${r.status} (${JSON.stringify(r).slice(0, 240)})`, { bot: id, seed }));
    }
    if (!isDeepStrictEqual(strip(runsOf(b)), strip(runs))) out.push(problem('replay_mismatch', `${id}: the same document and seeds did not replay to the same runs`, { bot: id }));
  }
  return out;
}

/**
 * Check a template against a catalogue. -> { ok, problems: [{ code, stage, message, path?, cause?, bot?, seed? }], evidence }
 * `opts.through` names the last stage to run (discovery runs 'format'); the whole contract runs without it.
 * @param {unknown} template @param {{ registry: any, logic: any }} catalogue @param {{ through?: string }} [opts]
 */
export async function checkTemplate(template, { registry, logic }, opts = {}) {
  const started = performance.now();
  const last = opts.through === undefined ? STAGES.length - 1 : STAGES.indexOf(opts.through);
  if (last < 0) throw Error(`checkTemplate: unknown stage '${opts.through}' (one of ${STAGES.join(', ')})`);
  const evidence = { contract: CONTRACT_VERSION, seeds: [...SEEDS], stages: {}, gate: null, bots: [], ms: 0 };
  const problems = [];
  const t = /** @type {any} */ (template);
  let checked = null, bare = null, gateFeatures = null;
  const run = {
    format: () => formatProblems(t),
    tune: () => tuneProblems(t, registry),
    // The document preflights, and so does the document a person plays (the host's input and UI added).
    preflight: () => {
      const r = preflight(structuredClone(t.doc), registry, logic);
      if (!r.ok) return r.errors.map(e => problem('preflight_failed', `${e.code} ${e.path}: ${e.message}`, { path: e.path, cause: e.code }));
      const h = hostPreflight(t.doc, registry, logic);
      if (!h.ok) return h.errors.map(e => problem('preflight_failed', `host document: ${e.code} ${e.path}: ${e.message}`, { path: e.path, cause: e.code }));
      bare = r; checked = h; return [];
    },
    composition: () => checkComposition(bare.doc, registry, { logic }).failures.map(f => problem('composition_failed', `${f.check}: ${f.message}`, { cause: f.check })),
    loop: () => loopProblems(bare.doc, registry, { logic }).map(p => problem('loop_problem', p.message, { path: p.path, cause: p.code })),
    gate: async () => {
      const v = await verifyDocument(structuredClone(t.doc), registry, logic, { ...GATE });
      evidence.gate = { viable: Boolean(v.viable), viability: v.viability ?? null, ms: v.ms ?? null };
      gateFeatures = v.features ?? null;
      return v.viable ? [] : [problem('gate_not_viable', `${v.viability} ${JSON.stringify((v.problems || []).filter(p => p.severity === 'error')).slice(0, 600)}`, { cause: v.viability ?? null })];
    },
    // The document a person plays gives a control for every verb its loops declare (in each interaction they are played
    // in), and pressing each direction moves the player the way the view the host mounts shows it (verify/directions.js).
    controls: () => {
      const host = checked.doc;
      const out = documentUncontrolled(host, registry).map(m => problem('controls_missing', `${m.use}: no control a person has issues '${m.kind}'${m.interaction ? ` in ${m.interaction}` : ''}`, { verb: m.verb, use: m.use }));
      const d = directionProblems(host, registry, playContext(checked, registry, logic).make, SEEDS[0]);
      evidence.directions = d.evidence;
      return [...out, ...d.problems.map(p => problem(p.code, p.message))];
    },
    // Every primitive the document mixes in exists, is controllable and works (verify/features.js, run by the gate).
    features: () => {
      evidence.features = gateFeatures?.table ?? null;
      if (!gateFeatures) return [problem('feature_missing', 'the gate ran no feature checks')];
      return gateFeatures.problems.filter(p => p.severity !== 'warning').map(p => problem(p.code, p.message, { path: p.path, use: p.use, ...(p.verb ? { verb: p.verb } : {}) }));
    },
    bots: () => botProblems(checked, registry, logic, evidence),
  };
  for (let i = 0; i <= last; i++) {
    const stage = STAGES[i];
    if (i === DYNAMIC && problems.length) break;
    const t0 = performance.now();
    const found = await run[stage]();
    evidence.stages[stage] = { ms: Math.round(performance.now() - t0), problems: found.length };
    problems.push(...found.map(p => ({ ...p, stage })));
    if (i < DYNAMIC && found.length) break; // a static failure stops the check before anything simulates
  }
  evidence.ms = Math.round(performance.now() - started);
  return { ok: !problems.length, problems, evidence };
}
