// The template contract (ARCHITECTURE.md §5): what makes `{ id, concept, doc, tune }` a verified template, as one
// function. Every template check lives HERE, in STAGES order, with a stable problem code; the suite
// (tests/v2-template-contract.test.js), discovery (v2/templates/registry.js: the format stage only, cheap at load) and
// promotion (v2/improve, target 'template': the whole contract against the live catalogue) all call it. A check
// added to templates later is added to this file, never to one caller.
//
//   format       id, a one-line concept, a document whose id is the template id, tune a list of '<primitive>.<param>'
//   tune         each tune entry names a scalar param the card declares, of exactly one instance in the document, with
//                a playable range inside the card's (a template narrows it where the card's range is not playable), a
//                finite one the bounds stage can prove, holding the template's own value
//   preflight    the document preflights against the catalogue's card-derived schemas
//   composition  the static composition check (card declarations only) finds no failure
//   loop         the loop check finds no problem
//   presentation the document a person plays (the host's renderers added) draws everything its loops need a person to
//                see (card.loop.shows against the renderers' card.draws: graphics/presentation.js); every look its
//                instances' cards declare (a param with `cosmetic: true`, such as a space's scenery) is set and tuned,
//                and each value the form allows for it preflights and plays its first frame exactly as the template's
//                own value does (a look is proven by drawing, never by a bot run: the simulation does not read it)
//   gate         the publish gate (verifyDocument with the playtest agents' budget) finds it viable
//   controls     the document a person plays (the host's input and UI added) gives a control for every verb its loops
//                declare, and each direction pressed through the controls moves the player the way the view shows it
//   features     every primitive the document mixes in exists, is controllable and works when its controls are pressed
//                from states the gate's play reached (verify/features.js; the table is in the evidence)
//   bots         every bot the document's loops name (card.mode.bot) is the one the gate plays, wins with status 'won'
//                on every world seed in SEEDS through the real controls, and replays to the same runs; and, played
//                again with a person's hands (HUMAN_INPUT's edge rate, verify/human.js), how it ends goes into the
//                evidence (evidence.bots[].human, world seed SEEDS[0]): which templates only a hand faster than a
//                person's can win
//   bounds       every value the frame_tune form allows keeps the game playable: at each bound of each tune entry (the
//                min and max of a number, each value of a boolean or a closed set; the other params at the template's
//                values) the document preflights and every named bot wins on every world seed in SEEDS
//
// Static stages stop the check when one fails (nothing simulates a document that is malformed or fails its
// declarations); the dynamic stages (gate, bots) both run once the static ones pass.
import { isDeepStrictEqual } from 'node:util';
import { preflight } from '../kernel/document.js';
import { checkComposition } from '../planner/compose-check.js';
import { loopProblems } from '../planner/loop-check.js';
import { verifyDocument } from '../planner/verify-adapter.js';
import { tuneTarget, tuneRanges, tunedSpec, instancesWithPaths } from '../planner/templates.js';
import { controlledMaker, hostPreflight } from '../verify/controls.js';
import { usedPrimitives } from '../verify/util.js';
import { strategies, select, modeBots } from '../verify/strategies/index.js';
import { documentUncontrolled } from '../verify/controls.js';
import { directionProblems, DIRECTION_CODES } from '../verify/directions.js';
import { FEATURE_CODES } from '../verify/features.js';
import { humanRate } from '../verify/human.js';
import { presentationProblems, PRESENTATION_CODES } from '../primitives/graphics/presentation.js';

export const CONTRACT_VERSION = 'template-contract/0.1';
/** The look checks' codes (lookProblems). */
export const LOOK_CODES = Object.freeze(['look_undeclared', 'look_untuned', 'look_value_invalid', 'look_not_cosmetic']);
export const DOC_SCHEMA = 'gameverse.v2.game/0.2';
/** The world seeds every named bot must win on (and replay). */
export const SEEDS = Object.freeze([1, 2, 3]);
/** The publish gate as the template suite runs it: the playability checks, on the gate's own budgets (verify GATE_BUDGET). */
export const GATE = Object.freeze({ playable: true });
/**
 * A named bot's budget per world seed, in simulated frames (lookahead included: verify/util.js budget.meter), never wall
 * time, so the bots stage gives the same runs on a loaded machine or across a laptop's sleep; and the run options
 * particular bots take (their own params, by strategy id).
 */
export const BOT_STEPS = Infinity;
export const BOT_OPTS = Object.freeze({ 'danger-field': Object.freeze({ maxFrames: 15000 }), dodge: Object.freeze({ seconds: 60, every: 8 }) });
/**
 * The fastest a person changes their input: what they hold (the move axis, the keys down) changes at most this many
 * times a second, and a press is down for at least that long. 10 per second (a change every 100 ms, 6 frames at 60 Hz)
 * is the edge of human speed: a single finger taps about 5-7 times a second sustained and near 10 in short bursts, and
 * a visual reaction takes over 150 ms, so a line that needs faster changes is one only a bot plays. Used by the bots
 * stage's human-rate replay (verify/human.js).
 */
export const HUMAN_INPUT = Object.freeze({ changesPerSecond: 10 });
/** Param types a tune path may name: a single value the frame_tune form can ask for. */
export const SCALAR_TYPES = Object.freeze(['number', 'integer', 'boolean', 'string']);
/** A template id: a lowercase slug (a promoted template's file name and an enum value of the pick form). */
export const ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
/** Ids the pick form already gives a meaning (planner/templates.js pickForm: 'none' routes to the step path). */
export const RESERVED_IDS = Object.freeze(['none']);

/** Every problem code the contract emits, by stage (the stage order is the check order). */
export const CODES = Object.freeze({
  format: Object.freeze(['template_shape', 'template_id_invalid', 'template_id_reserved', 'template_concept_invalid', 'template_doc_invalid', 'template_doc_id_mismatch', 'template_tune_invalid']),
  tune: Object.freeze(['tune_unknown', 'tune_not_scalar', 'tune_ambiguous', 'tune_range_invalid', 'tune_unbounded', 'tune_value_outside']),
  preflight: Object.freeze(['preflight_failed']),
  composition: Object.freeze(['composition_failed']),
  loop: Object.freeze(['loop_problem']),
  presentation: Object.freeze([...Object.values(PRESENTATION_CODES), ...LOOK_CODES]),
  gate: Object.freeze(['gate_not_viable']),
  controls: Object.freeze(['controls_missing', 'option_uncontrolled', ...DIRECTION_CODES]),
  features: Object.freeze([...new Set(Object.values(FEATURE_CODES).flat())]),
  bots: Object.freeze(['bot_unnamed', 'bot_selection_mismatch', 'bot_failed', 'bot_not_won', 'replay_mismatch']),
  bounds: Object.freeze(['bound_invalid', 'bound_bot_failed', 'bound_not_won']),
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
  if (!Array.isArray(t.tune) || !t.tune.every(tuneEntryWellFormed) || new Set(t.tune.map(e => (typeof e === 'string' ? e : e.path))).size !== t.tune.length) out.push(problem('template_tune_invalid', "tune is a list of distinct entries: a '<primitive id>.<param>' path, or { path, min?, max? } (a number) or { path, options } (a closed set) giving its playable range", { path: 'tune' }));
  return out;
}

const RANGE_KEYS = ['path', 'min', 'max', 'options'];
/** A tune entry: a non-empty path, or { path, min?, max?, options? } with finite bounds and a non-empty list of distinct strings. @param {unknown} e */
function tuneEntryWellFormed(e) {
  if (typeof e === 'string') return e.length > 0;
  if (!isObj(e) || typeof e.path !== 'string' || !e.path || !Object.keys(e).every(k => RANGE_KEYS.includes(k)) || Object.keys(e).length < 2) return false;
  if (['min', 'max'].some(k => e[k] !== undefined && !Number.isFinite(e[k]))) return false;
  return e.options === undefined || (Array.isArray(e.options) && e.options.length > 0 && e.options.every(o => typeof o === 'string') && new Set(e.options).size === e.options.length);
}

/**
 * The values the bounds stage plays for a tune entry's playable spec (planner/templates.js tunedSpec): a number's min
 * and max, both booleans, every value of a closed set; null when the range is not finite (tune_unbounded).
 * @param {Record<string, any>} spec @returns {unknown[] | null}
 */
export function boundValues(spec) {
  if (spec.type === 'number' || spec.type === 'integer') return Number.isFinite(spec.min) && Number.isFinite(spec.max) ? [...new Set([spec.min, spec.max])] : null;
  if (spec.type === 'boolean') return [false, true];
  if (spec.type === 'string') return Array.isArray(spec.options) && spec.options.length ? [...spec.options] : null;
  return null;
}

/** The tune stage: each path names one declared scalar param of exactly one instance. */
export function tuneProblems(t, registry) {
  const out = [];
  for (const range of tuneRanges(t)) {
    const path = range.path, target = tuneTarget(t.doc, path, registry);
    if (!target) { out.push(problem('tune_unknown', `tune '${path}' names no param a card declares on an instance in the document`, { path })); continue; }
    const spec = target.spec;
    if (!SCALAR_TYPES.includes(spec.type)) { out.push(problem('tune_not_scalar', `tune '${path}' is a ${spec.type}; a tune param is one of ${SCALAR_TYPES.join(', ')}`, { path })); continue; }
    if (target.instances.length !== 1) { out.push(problem('tune_ambiguous', `tune '${path}' names ${target.instances.length} instances of ${target.use}; it must name exactly one`, { path })); continue; }
    // The playable range narrows the card's: min/max for a number inside the card's range, options for a closed set within the card's.
    const numeric = spec.type === 'number' || spec.type === 'integer';
    const wide = [
      ...(range.min !== undefined || range.max !== undefined ? (!numeric ? [`a ${spec.type} has no min or max`] : []) : []),
      ...(numeric && range.min !== undefined && Number.isFinite(spec.min) && range.min < spec.min ? [`min ${range.min} is below the card's ${spec.min}`] : []),
      ...(numeric && range.max !== undefined && Number.isFinite(spec.max) && range.max > spec.max ? [`max ${range.max} is above the card's ${spec.max}`] : []),
      ...(numeric && spec.type === 'integer' && [range.min, range.max].some(v => v !== undefined && !Number.isInteger(v)) ? ['an integer param has integer bounds'] : []),
      ...(range.options !== undefined && spec.type !== 'string' ? [`a ${spec.type} has no options`] : []),
      ...(range.options !== undefined && spec.type === 'string' && Array.isArray(spec.options) && !range.options.every(o => spec.options.includes(o)) ? [`options ${range.options.filter(o => !spec.options.includes(o)).join(', ')} are not the card's (${spec.options.join(', ')})`] : []),
      ...(range.options !== undefined && spec.type === 'string' && !Array.isArray(spec.options) ? ['the card declares no closed set of values to choose options from'] : []),
    ];
    const tuned = tunedSpec(spec, range);
    if (numeric && Number.isFinite(tuned.min) && Number.isFinite(tuned.max) && tuned.min > tuned.max) wide.push(`min ${tuned.min} is above max ${tuned.max}`);
    if (wide.length) { out.push(problem('tune_range_invalid', `tune '${path}': ${wide.join('; ')}`, { path })); continue; }
    if (!boundValues(tuned)) { out.push(problem('tune_unbounded', `tune '${path}' allows ${numeric ? `[${tuned.min ?? '-∞'}, ${tuned.max ?? '∞'}]` : 'any text'}: declare its playable range ({ path, min, max } or { path, options }) so every value the form allows is proven`, { path })); continue; }
    const value = target.instances[0].with?.[target.param] ?? spec.default;
    const inside = numeric ? value >= tuned.min && value <= tuned.max : spec.type === 'string' ? tuned.options.includes(value) : typeof value === 'boolean';
    if (!inside) out.push(problem('tune_value_outside', `tune '${path}': the template's value ${JSON.stringify(value)} is outside its playable range`, { path }));
  }
  return out;
}

/**
 * The look checks: every param a card of the document's instances declares `cosmetic: true` (what a person sees, which
 * the simulation never reads: a space's scenery) has a value on the instance (look_undeclared: no default stands in
 * for the choice) and is in the template's tune (look_untuned: the idea chooses it, through the frame_tune form). Each
 * value its closed set allows preflights as the document a person plays (look_value_invalid), and its first frame
 * leaves the same state as the template's own value (look_not_cosmetic). One frame per value: a look is shown, not played.
 */
export function lookProblems(t, registry, logic) {
  const out = [], tuned = new Set(t.tune);
  const firstFrame = doc => { const h = hostPreflight(doc, registry, logic); if (!h.ok) return { errors: h.errors }; const rt = controlledMaker(h.doc, registry, logic)(SEEDS[0]); rt.step({}); return { state: rt.snapshot() }; };
  let base = null;
  for (const { inst, path } of instancesWithPaths(t.doc)) {
    const params = registry.get(inst.use)?.card?.params || {};
    for (const [param, spec] of Object.entries(params)) {
      if (!spec?.cosmetic) continue;
      const at = `${path}.with.${param}`, tunePath = `${inst.use}.${param}`;
      if (inst.with?.[param] === undefined) { out.push(problem('look_undeclared', `${inst.use} declares the look '${param}' (one of ${(spec.options || []).join(', ')}); the template sets it for its own concept`, { path: at })); continue; }
      if (!tuned.has(tunePath)) { out.push(problem('look_untuned', `the look '${tunePath}' is not in tune: the idea's theme chooses it`, { path: at })); continue; }
      base ??= firstFrame(t.doc);
      for (const value of spec.options || []) {
        if (value === inst.with[param]) continue;
        const d = structuredClone(t.doc), target = instancesWithPaths(d).find(x => x.path === path).inst;
        target.with = { ...target.with, [param]: value };
        const r = firstFrame(d);
        if (r.errors) out.push(problem('look_value_invalid', `${tunePath} = ${JSON.stringify(value)} does not preflight: ${r.errors.slice(0, 2).map(e => `${e.code} ${e.path}`).join('; ')}`, { path: at, cause: r.errors[0]?.code ?? null }));
        else if (!isDeepStrictEqual(r.state, base.state)) out.push(problem('look_not_cosmetic', `${tunePath} = ${JSON.stringify(value)} changes the first frame's state: the simulation reads a param its card declares cosmetic`, { path: at }));
      }
    }
  }
  return out;
}

/**
 * The context the gate's bots play a preflighted host document in (the document a person plays: v2/web/host-doc.js),
 * through the controls a person has (v2/verify/controls.js).
 */
export function playContext(checked, registry, logic) {
  // Hosting is idempotent: a preflighted document or its host document gives the same document a person plays.
  const host = hostPreflight(checked.doc, registry, logic);
  if (!host.ok) throw Object.assign(Error(`the host document does not preflight: ${JSON.stringify(host.errors.slice(0, 3))}`), { code: 'preflight_failed' });
  const make = controlledMaker(host.doc, registry, logic);
  return { doc: host.doc, registry, logic, make, seed: SEEDS[0], capabilities: host.capabilities, used: usedPrimitives(host.doc), playerSpace: make(SEEDS[0]).player()?.space ?? host.doc.spaces[0].id };
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
    const bot = strategies.get(id), opts = { maxSteps: BOT_STEPS, seeds: [...SEEDS], ...BOT_OPTS[id] };
    const t0 = performance.now();
    let a, b;
    // A bot that asks for a verb no control issues, or that throws, fails here with what it needed.
    let human = null;
    try { a = bot.run(ctx, opts); b = bot.run(ctx, opts); human = runsOf(bot.run({ ...ctx, make: humanRate(ctx.make, HUMAN_INPUT.changesPerSecond) }, { ...opts, seeds: [SEEDS[0]] })); } catch (error) { out.push(problem('bot_failed', `${id}: ${String(error?.message || error).slice(0, 400)}`, { bot: id, ...(error?.code ? { cause: error.code } : {}) })); continue; }
    const runs = runsOf(a);
    // How the bot's play ends with a person's hands: evidence (which templates need a faster hand), not a block.
    evidence.bots.push({ id, runs: runs.map(r => ({ seed: r.seed ?? null, status: r.status ?? null, frames: r.frames ?? null })), human: human.map(r => ({ seed: r.seed ?? null, status: r.status ?? null, frames: r.frames ?? null })), humanRate: HUMAN_INPUT.changesPerSecond, ms: Math.round(performance.now() - t0) });
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
 * The bounds stage: every bound of every tune entry (boundValues of its playable spec) other than the template's own
 * value, set alone on the document: it preflights as a person plays it, and every bot its loops name wins on every world
 * seed in SEEDS through the real controls (the bots stage proved replay at the template's values; a bound plays once).
 * Per-bound evidence goes into `evidence.bounds`.
 */
export function boundsProblems(t, registry, logic, evidence) {
  const out = [];
  for (const range of tuneRanges(t)) {
    const target = /** @type {NonNullable<ReturnType<typeof tuneTarget>>} */ (tuneTarget(t.doc, range.path, registry));
    const own = target.instances[0].with?.[target.param] ?? target.spec.default;
    for (const value of boundValues(tunedSpec(target.spec, range)) ?? []) {
      if (isDeepStrictEqual(value, own)) continue;
      const doc = structuredClone(t.doc), inst = instancesWithPaths(doc).find(x => x.inst.use === target.use)?.inst;
      inst.with = { ...(isObj(inst.with) ? inst.with : {}), [target.param]: value };
      const at = { path: range.path, value };
      const host = hostPreflight(doc, registry, logic);
      if (!host.ok) { out.push(problem('bound_invalid', `${range.path} = ${JSON.stringify(value)} does not preflight: ${host.errors.slice(0, 3).map(e => `${e.code} ${e.path}: ${e.message}`).join('; ')}`, { ...at, cause: host.errors[0]?.code ?? null })); evidence.bounds.push({ ...at, ok: false, bots: [] }); continue; }
      const ctx = playContext({ doc }, registry, logic), row = { ...at, ok: true, bots: /** @type {any[]} */ ([]) };
      for (const id of modeBots(ctx).map(x => x.s.id)) {
        const t0 = performance.now();
        let r;
        try { r = strategies.get(id).run(ctx, { budgetMs: BOT_BUDGET_MS, seeds: [...SEEDS], ...BOT_OPTS[id] }); } catch (error) { out.push(problem('bound_bot_failed', `${range.path} = ${JSON.stringify(value)}: ${id}: ${String(error?.message || error).slice(0, 300)}`, { ...at, bot: id })); row.ok = false; continue; }
        const runs = runsOf(r);
        row.bots.push({ id, runs: runs.map(x => ({ seed: x.seed ?? null, status: x.status ?? null, frames: x.frames ?? null })), ms: Math.round(performance.now() - t0) });
        for (const seed of SEEDS) {
          const run = runs.find(x => x.seed === seed);
          if (run?.status !== 'won') { out.push(problem('bound_not_won', `${range.path} = ${JSON.stringify(value)}: ${id} on world seed ${seed} ${run ? `ended ${run.status}` : 'did not run'} (the other tune params at the template's values)`, { ...at, bot: id, seed })); row.ok = false; }
        }
      }
      evidence.bounds.push(row);
    }
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
  const evidence = { contract: CONTRACT_VERSION, seeds: [...SEEDS], stages: {}, gate: null, bots: [], bounds: [], ms: 0 };
  const problems = [];
  const t = /** @type {any} */ (template);
  let checked = null, bare = null, gateFeatures = null;
  /** @type {any[]} */
  let gateOptions = [];
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
    presentation: () => [...presentationProblems(checked.doc, registry).map(p => problem(p.code, p.message, { path: p.path, use: p.use, ...(p.space ? { space: p.space } : {}), missing: p.missing })), ...lookProblems(t, registry, logic)],
    gate: async () => {
      const v = await verifyDocument(structuredClone(t.doc), registry, logic, { ...GATE });
      evidence.gate = { viable: Boolean(v.viable), viability: v.viability ?? null, ms: v.ms ?? null };
      gateFeatures = v.features ?? null;
      gateOptions = (v.problems || []).filter(p => p.code === 'option_uncontrolled');
      return v.viable ? [] : [problem('gate_not_viable', `${v.viability} ${JSON.stringify((v.problems || []).filter(p => p.severity === 'error')).slice(0, 600)}`, { cause: v.viability ?? null })];
    },
    // The document a person plays gives a control for every verb its loops declare (in each interaction they are played
    // in), and pressing each direction moves the player the way the view the host mounts shows it (verify/directions.js).
    controls: () => {
      const host = checked.doc;
      const out = documentUncontrolled(host, registry).map(m => problem('controls_missing', `${m.use}: no control a person has issues '${m.kind}'${m.interaction ? ` in ${m.interaction}` : ''}`, { verb: m.verb, use: m.use }));
      const d = directionProblems(host, registry, playContext(checked, registry, logic).make, SEEDS[0]);
      evidence.directions = d.evidence;
      // Every option the game offers is one a person can take (the gate's explorer: playtest option_uncontrolled).
      const options = gateOptions.map(p => problem('option_uncontrolled', p.message, { missing: p.missing ?? null }));
      return [...out, ...options, ...d.problems.map(p => problem(p.code, p.message))];
    },
    // Every primitive the document mixes in exists, is controllable and works (verify/features.js, run by the gate).
    features: () => {
      evidence.features = gateFeatures?.table ?? null;
      if (!gateFeatures) return [problem('feature_missing', 'the gate ran no feature checks')];
      return gateFeatures.problems.filter(p => p.severity !== 'warning').map(p => problem(p.code, p.message, { path: p.path, use: p.use, ...(p.verb ? { verb: p.verb } : {}) }));
    },
    bots: () => botProblems(checked, registry, logic, evidence),
    bounds: () => boundsProblems(t, registry, logic, evidence),
  };
  for (let i = 0; i <= last; i++) {
    const stage = STAGES[i];
    if (i === DYNAMIC && problems.length) break;
    // The bounds are played only for a template proven at its own values.
    if (stage === 'bounds' && problems.length) break;
    const t0 = performance.now();
    const found = await run[stage]();
    evidence.stages[stage] = { ms: Math.round(performance.now() - t0), problems: found.length };
    problems.push(...found.map(p => ({ ...p, stage })));
    if (i < DYNAMIC && found.length) break; // a static failure stops the check before anything simulates
  }
  evidence.ms = Math.round(performance.now() - started);
  return { ok: !problems.length, problems, evidence };
}
