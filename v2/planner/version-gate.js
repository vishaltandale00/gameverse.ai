// @ts-check
// The version gate (ARCHITECTURE §4: "each change produces a new immutable version that is checked like a new game";
// §1.5, §6): the one check every new version passes before it publishes, whatever made it (create, a revision's tweak
// or model ops, an experiment, a gap the step path filled). It runs, in this order, on the document that will be
// published, and through it on the document a person plays (v2/web/host-doc.js):
//   preflight    the document preflights against the card-derived schemas, and so does its host document
//   tune         (a version of a template game) every tune param the change set satisfies the template's frame_tune
//                slot: the schema the content form asks it with (templates.js frameTuneForm), so a range the template
//                declares bounds a revision exactly as it bounds creation
//   composition  the static composition check (card declarations only) finds no failure
//   loop         the loop check finds no problem
//   controls     every verb the host document's loops declare has a control a person has
//   gate         the publish gate (verifyDocument with the playtest agents' budget) finds it viable; the feature
//                checks run there and their errors block
//   features     (with a base version) every feature verb that worked in the base still works (verify/features.js table)
//   bots         (with a base version) every bot the loops name (card.mode.bot) that won the base on its world seed
//                still wins this version, played through the controls with the template contract's bot budget
// The static stages stop the gate before anything simulates. The template contract (v2/templates/contract.js) is the
// same check for a template, plus its bots winning every contract seed; this gate's bots stage is its regression form.
import { preflight } from '../kernel/document.js';
import { hashOf } from '../server/store.js';
import { checkComposition } from './compose-check.js';
import { loopProblems } from './loop-check.js';
import { verifyDocument } from './verify-adapter.js';
import { catalogHash } from './catalog.js';
import { answerProblems } from './outline-form.js';
import { frameTuneForm, instancesWithPaths } from './templates.js';
import { controlledMaker, hostPreflight, documentUncontrolled } from '../verify/controls.js';
import { modeBots } from '../verify/strategies/index.js';
import { playBot } from '../verify/index.js';
import { usedPrimitives } from '../verify/util.js';
import { BOT_BUDGET_MS, BOT_OPTS } from '../templates/contract.js';
import { isObj, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('./verify-adapter.js').Verification} Verification */
/** @typedef {import('./templates.js').Template} Template */
/** A gate finding: its stage, a stable code, and what is wrong. @typedef {{ stage: string, code: string, message: string, path?: string, [k: string]: unknown }} GateProblem */
/** One named bot's play of one version: `won` is a proof of a win (its proven list is not empty). @typedef {{ id: string, won: boolean, undecided: boolean, status: string | null, frames: number | null, ms: number, proven: string[], error?: string }} BotOutcome */
/** The named bots' play of one document, keyed by what decides it (the document, the catalogue, the proof's version). @typedef {{ version: string, docHash: string, catalogHash: string, seed: unknown, bots: BotOutcome[] }} BotProof */
/**
 * What a version is checked against: the base version's preflighted document, its gate verification with the same
 * budgets (or `verify`, which makes it when the regression stages need it: a version failing a static stage simulates
 * nothing) and its stored bot proof, if any (reused when it proves that document in this catalogue).
 * @typedef {{ doc: Doc, verification?: Verification | null, verify?: () => Promise<Verification>, proof?: unknown }} Baseline
 */
/**
 * @typedef {{ ok: boolean, stage: string | null, problems: GateProblem[], doc: Doc | null, verification: Verification | null, baseVerification: Verification | null, proof: BotProof | null, baseProof: BotProof | null, ms: Record<string, number> }} GateResult
 */

export const VERSION_GATE_VERSION = 'version-gate/0.1';
export const BOT_PROOF_VERSION = 'bot-proof/0.1';
/** Every problem code the gate emits, by stage (the stage order is the check order). */
export const GATE_CODES = Object.freeze({
  preflight: Object.freeze(['preflight_failed']),
  tune: Object.freeze(['tune_out_of_range']),
  composition: Object.freeze(['composition_failed']),
  loop: Object.freeze(['loop_problem']),
  controls: Object.freeze(['controls_missing']),
  gate: Object.freeze(['not_playable']),
  features: Object.freeze(['feature_regressed']),
  bots: Object.freeze(['bot_regressed', 'bot_unproven']),
});
export const GATE_STAGES = Object.freeze(Object.keys(GATE_CODES));

/** A thrown value's message (or the value), as text. @param {unknown} error */
const errorText = error => String(prop(error, 'message') || error);

/**
 * The template a version was built from (its provenance names the templates the template path composed): the primary
 * with every part's tune paths, as composeTemplates gives it to the content forms. null for a version no template made
 * or one naming a template this catalogue does not have.
 * @param {unknown} provenance a stored version's provenance @param {readonly Template[]} templates
 * @returns {Template | null}
 */
export function versionTemplate(provenance, templates) {
  const ids = prop(provenance, 'templates');
  if (!Array.isArray(ids) || !ids.length) return null;
  const parts = ids.map(id => templates.find(t => t.id === id));
  if (parts.some(t => !t)) return null;
  const used = /** @type {Template[]} */ (parts);
  return { ...used[0], tune: [...new Set(used.flatMap(t => t.tune))] };
}

/**
 * The tune slots of a template on a document: frameTuneForm's slots (the schema the content form asks each tune param
 * with), one per tune path that names exactly one instance in this document (a structural change may have removed or
 * doubled the instance: the other stages check the structure).
 * @param {Template} template @param {Doc} doc @param {{ registry: RegistryLike, logic: LogicLike }} cat
 */
export function tuneSlots(template, doc, cat) {
  /** @type {ReturnType<typeof frameTuneForm>['slots']} */
  const slots = [];
  for (const path of template.tune) {
    try { slots.push(...frameTuneForm({ ...template, tune: [path] }, doc, cat).slots); } catch { /* not one instance of it here */ }
  }
  return slots;
}

/**
 * The numeric ranges a template's tune slots allow, by the param's document path ('systems[2].with.speed'): what a
 * tweak of a template game chooses its values within (doc-revise.js tweakDocument `limits`).
 * @param {Template} template @param {Doc} doc @param {{ registry: RegistryLike, logic: LogicLike }} cat
 * @returns {Map<string, { minimum?: number, maximum?: number }>}
 */
export function tuneLimits(template, doc, cat) {
  /** @type {Map<string, { minimum?: number, maximum?: number }>} */
  const out = new Map();
  for (const s of tuneSlots(template, doc, cat)) {
    const { minimum, maximum } = /** @type {{ minimum?: unknown, maximum?: unknown }} */ (s.schema);
    out.set(`${s.at}.with.${s.param}`, { ...(typeof minimum === 'number' ? { minimum } : {}), ...(typeof maximum === 'number' ? { maximum } : {}) });
  }
  return out;
}

/** The value of a param of the instance at a document path (the card's default when unset); undefined without the instance. @param {Doc} doc @param {string} at @param {string} param @param {unknown} fallback */
export const instanceValue = (doc, at, param, fallback) => {
  const inst = instancesWithPaths(doc).find(x => x.path === at)?.inst;
  return inst ? (inst.with?.[param] ?? fallback) : undefined;
};

/**
 * The tune stage: every tune param whose value the change set (it differs from the base's) satisfies its frame_tune
 * slot's schema. Values the change left alone are not judged again.
 * @param {Template} template @param {Doc} doc @param {Doc | null} base @param {{ registry: RegistryLike, logic: LogicLike }} cat
 * @returns {GateProblem[]}
 */
export function tuneRangeProblems(template, doc, base, cat) {
  /** @type {GateProblem[]} */
  const out = [];
  for (const s of tuneSlots(template, doc, cat)) {
    const value = instanceValue(doc, s.at, s.param, s.spec.default);
    if (base && JSON.stringify(instanceValue(base, s.at, s.param, s.spec.default)) === JSON.stringify(value)) continue;
    for (const p of answerProblems(s.schema, value)) out.push({ stage: 'tune', code: 'tune_out_of_range', path: `${s.at}.with.${s.param}`, message: `${s.path}: ${p.message} (the template '${template.id}' tunes it as ${JSON.stringify(s.schema).slice(0, 160)})`, tune: s.path });
  }
  return out;
}

/**
 * The bots the document's loops name (card.mode.bot), each played once through the controls a person has on the
 * document's own world seed, with the template contract's bot budget. A bot that throws is recorded with its error.
 * @param {Doc} doc a preflighted document @param {RegistryLike} registry @param {LogicLike} logic
 * @param {{ budgetMs?: number, only?: string[] | null }} [opts] only: play just these bots
 * @returns {BotProof}
 */
export function botProof(doc, registry, logic, { budgetMs = BOT_BUDGET_MS, only = null } = {}) {
  const host = hostPreflight(doc, registry, logic);
  /** @type {BotProof} */
  const proof = { version: BOT_PROOF_VERSION, docHash: hashOf(doc), catalogHash: catalogHash(registry), seed: doc.seed ?? null, bots: [] };
  if (!host.ok) return proof;
  const make = controlledMaker(host.doc, registry, logic), seed = host.doc.seed;
  const ctx = { doc: host.doc, registry, logic, make, seed, capabilities: host.capabilities, used: usedPrimitives(host.doc), playerSpace: make(seed).player()?.space ?? host.doc.spaces[0]?.id };
  /** @type {Record<string, Record<string, unknown>>} */
  const botOpts = BOT_OPTS;
  for (const { s } of modeBots(ctx)) {
    if (only && !only.includes(s.id)) continue;
    const t0 = performance.now();
    try {
      const r = playBot(s, ctx, { budgetMs, ...(botOpts[s.id] || {}) });
      const runs = /** @type {Array<Record<string, unknown>>} */ (prop(r.metrics, 'runs') ?? prop(r.metrics, 'matches') ?? []);
      const run = runs[0] ?? null, proven = Array.isArray(r.proven) ? r.proven.map(String) : [];
      const undecided = !proven.length && (Boolean(run?.budget) || (r.problems || []).some((/** @type {{ code?: unknown }} */ p) => p.code === 'budget_exhausted'));
      proof.bots.push({ id: s.id, won: proven.length > 0, undecided, status: typeof run?.status === 'string' ? run.status : null, frames: typeof run?.frames === 'number' ? run.frames : null, ms: Math.round(performance.now() - t0), proven: proven.slice(0, 4) });
    } catch (error) {
      proof.bots.push({ id: s.id, won: false, undecided: false, status: null, frames: null, ms: Math.round(performance.now() - t0), proven: [], error: errorText(error).slice(0, 300) });
    }
  }
  return proof;
}

/** Is a stored proof the proof of this document in this catalogue? @param {unknown} proof @param {Doc} doc @param {RegistryLike} registry @returns {proof is BotProof} */
export const proofHolds = (proof, doc, registry) => isObj(proof) && proof.version === BOT_PROOF_VERSION && proof.docHash === hashOf(doc) && proof.catalogHash === catalogHash(registry) && Array.isArray(proof.bots);

/**
 * The features stage: every verb the base's feature table shows working, on a feature this version still has, works.
 * A feature the version no longer has is the structure the change made (the other stages check it), not a regression
 * of the feature. -> problems
 * @param {Verification} base @param {Verification} after @returns {GateProblem[]}
 */
export function featureRegressions(base, after) {
  const rows = (/** @type {Verification} */ v) => /** @type {Array<{ use: string, verbs?: Record<string, { works?: boolean }> }>} */ (v.features?.table ?? []);
  /** @type {GateProblem[]} */
  const out = [];
  const now = rows(after);
  for (const row of rows(base)) {
    const later = now.filter(r => r.use === row.use);
    if (!later.length) continue;
    for (const [verb, v] of Object.entries(row.verbs || {})) {
      if (!v.works || later.some(r => r.verbs?.[verb]?.works)) continue;
      out.push({ stage: 'features', code: 'feature_regressed', path: row.use, message: `${row.use}: '${verb}' worked in the version this changes and no longer does when pressed through its controls`, use: row.use, verb });
    }
  }
  return out;
}

/**
 * The bots stage: every named bot that won the base's world still wins this version. -> problems
 * @param {BotProof} base @param {BotProof} after @returns {GateProblem[]}
 */
export function botRegressions(base, after) {
  /** @type {GateProblem[]} */
  const out = [];
  for (const b of base.bots.filter(x => x.won)) {
    const a = after.bots.find(x => x.id === b.id);
    if (!a || a.won) continue;
    if (a.undecided) out.push({ stage: 'bots', code: 'bot_unproven', message: `the ${b.id} bot won the version this changes (in ${b.frames ?? '?'} frames) and could not win this one within its budget`, bot: b.id });
    else out.push({ stage: 'bots', code: 'bot_regressed', message: `the ${b.id} bot won the version this changes (in ${b.frames ?? '?'} frames) and does not win this one: ${a.error ? `it threw: ${a.error}` : `it ended ${a.status ?? 'without a win'}${a.frames != null ? ` after ${a.frames} frames` : ''}`}`, bot: b.id });
  }
  return out;
}

/**
 * Gate one new version. `base` (the version it changes) turns on the regression stages; `template` (the template the
 * game was built from) turns on the tune stage. -> GateResult (ok, the stage that failed and its problems, the
 * preflighted document, its verification, the bot proofs the regression stage made).
 * @param {unknown} input the document to publish (preflighted here)
 * `through: 'controls'` runs the static stages only (nothing simulates).
 * @param {{ registry: RegistryLike, logic: LogicLike, budgetMs: number, playtestMs: number, base?: Baseline | null, template?: Template | null, botBudgetMs?: number, through?: 'controls' | null }} opts
 * @returns {Promise<GateResult>}
 */
export async function gateVersion(input, { registry, logic, budgetMs, playtestMs, base = null, template = null, botBudgetMs = BOT_BUDGET_MS, through = null }) {
  /** @type {Record<string, number>} */
  const ms = {};
  /** @type {GateResult} */
  const result = { ok: false, stage: null, problems: [], doc: null, verification: null, baseVerification: null, proof: null, baseProof: null, ms };
  /** @param {string} stage @param {GateProblem[]} problems */
  const fail = (stage, problems) => Object.assign(result, { ok: false, stage, problems });
  /** @template T @param {string} stage @param {() => T} fn @returns {T} */
  const timed = (stage, fn) => { const t = performance.now(); try { return fn(); } finally { ms[stage] = (ms[stage] ?? 0) + Math.round(performance.now() - t); } };
  const pre = timed('preflight', () => preflight(structuredClone(input), registry, logic));
  if (!pre.ok) return fail('preflight', pre.errors.map(e => ({ stage: 'preflight', code: 'preflight_failed', path: e.path, message: `${e.code} ${e.path}: ${e.message}`, cause: e.code })));
  const doc = pre.doc;
  result.doc = doc;
  const host = timed('preflight', () => hostPreflight(doc, registry, logic));
  if (!host.ok) return fail('preflight', host.errors.map(e => ({ stage: 'preflight', code: 'preflight_failed', path: e.path, message: `host document: ${e.code} ${e.path}: ${e.message}`, cause: e.code })));
  if (template) {
    const tune = timed('tune', () => tuneRangeProblems(template, doc, base?.doc ?? null, { registry, logic }));
    if (tune.length) return fail('tune', tune);
  }
  const composition = timed('composition', () => checkComposition(doc, registry, { logic }).failures);
  if (composition.length) return fail('composition', composition.map(f => ({ stage: 'composition', code: 'composition_failed', message: `${f.check}: ${f.message}`, cause: f.check })));
  const loop = timed('loop', () => loopProblems(doc, registry, { logic }));
  if (loop.length) return fail('loop', loop.map(p => ({ stage: 'loop', code: 'loop_problem', path: p.path, message: p.message, cause: p.code })));
  const loose = timed('controls', () => documentUncontrolled(host.doc, registry));
  if (loose.length) return fail('controls', loose.map(m => ({ stage: 'controls', code: 'controls_missing', path: m.use, message: `${m.use}: no control a person has issues '${m.kind}'${m.interaction ? ` in ${m.interaction}` : ''}`, use: m.use, verb: m.verb })));
  if (through === 'controls') return Object.assign(result, { ok: true, stage: null, problems: [] });
  let t = performance.now();
  const v = await verifyDocument(doc, registry, logic, { budgetMs, playtestMs });
  ms.gate = Math.round(performance.now() - t);
  result.verification = v;
  if (!v.viable) return fail('gate', [{ stage: 'gate', code: 'not_playable', path: '$', message: String(v.viability || 'not viable') }, ...(v.problems || []).filter(p => p.severity === 'error').slice(0, 8).map(p => ({ ...p, stage: 'gate' }))]);
  if (base) {
    t = performance.now();
    const bv = base.verification ?? (base.verify ? await base.verify() : null);
    ms.base = Math.round(performance.now() - t);
    if (!bv) throw Error('gateVersion: a base needs its verification (or verify)');
    result.baseVerification = bv;
    const features = timed('features', () => featureRegressions(bv, v));
    if (features.length) return fail('features', features);
    t = performance.now();
    // The base's proof is reused when it is the proof of that document in this catalogue (its version's report keeps it).
    const before = proofHolds(base.proof, base.doc, registry) ? base.proof : botProof(base.doc, registry, logic, { budgetMs: botBudgetMs });
    result.baseProof = before;
    const won = before.bots.filter(b => b.won).map(b => b.id);
    if (won.length) result.proof = botProof(doc, registry, logic, { budgetMs: botBudgetMs, only: won });
    ms.bots = Math.round(performance.now() - t);
    const bots = result.proof ? botRegressions(before, result.proof) : [];
    if (bots.length) return fail('bots', bots);
  }
  return Object.assign(result, { ok: true, stage: null, problems: [] });
}

/** The gate's failure as the error a job throws: 422, the first problem's code, the stage and problems in its report. @param {GateResult} g @param {string} what */
export function gateError(g, what) {
  const shown = g.problems.slice(0, 4).map(p => `${p.code}${p.path ? ` ${p.path}` : ''}: ${String(p.message).slice(0, 200)}`).join('; ');
  return Object.assign(Error(`${what} failed the version gate at ${g.stage}: ${shown}`), { status: 422, code: g.problems[0]?.code ?? 'version_gate_failed', report: { stage: g.stage, problems: g.problems.slice(0, 20) } });
}
