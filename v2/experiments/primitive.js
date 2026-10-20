// Gap filling (ARCHITECTURE.md §4, step 4), server side: a code model writes a NEW
// primitive (card + sandboxed module) for a mechanic no registered primitive covers;
// the gate below decides whether it may join a game. Gates, all headless and in
// milliseconds-to-seconds: card checks, registry admission, preflight of the game
// with the primitive in it, rejection of a bad config by stable code, 600 frames of
// play without errors or budget overruns, deterministic replay, snapshot/restore
// equivalence, no plot regression (verifier) and an observable effect.
// Promotion (v2/improve, target 'primitive') turns a passing experiment into a
// native, tested primitive under v2/primitives.
import { createHash } from 'node:crypto';
import { Registry } from '../kernel/registry.js';
import { createWorld } from '../kernel/world.js';
import { preflight } from '../kernel/document.js';
import { hashOf } from '../server/store.js';
import { loadPureVm } from './vm-pure.js';
import { PRIMITIVE_EXPERIMENT_SCHEMA, hostPrimitive, cardProblems, cleanCard, kernelSnapshot, experimentPrimitives } from './primitive-host.js';
import { buildCatalogue, promotedPrimitives, vocabulary } from '../planner/catalog.js';
import { verifyDocument, regressed } from '../planner/verify-adapter.js';
import { parseReply } from '../planner/writer.js';

export const GATE = { frames: 600, stepAvgMs: 2, wallMs: 10000 };
export const vmBox = code => loadPureVm(code);

/** Catalogue for a document: the registered primitives plus the experiment primitives it carries (vm-hosted). */
export async function catalogueForDoc(doc, { extra = [], box = vmBox } = {}) {
  return buildCatalogue([...(await promotedPrimitives()), ...experimentPrimitives(doc, box), ...extra]);
}

/** The document with one experiment attached and instantiated (replacing an earlier version of it). */
export function withExperiment(doc, experiment) {
  const others = (doc.experiments || []).filter(e => e.id !== experiment.id && e.card?.id !== experiment.card.id);
  const systems = (doc.systems || []).filter(s => s.use !== experiment.card.id);
  return { ...doc, experiments: [...others, experiment], systems: [...systems, { use: experiment.card.id, with: structuredClone(experiment.instance?.with || {}) }] };
}
export function withoutExperiment(doc, id) {
  const exp = (doc.experiments || []).find(e => e.id === id);
  if (!exp) return doc;
  return { ...doc, experiments: doc.experiments.filter(e => e.id !== id), systems: (doc.systems || []).filter(s => s.use !== exp.card?.id) };
}

const problem = (code, message, hint) => ({ code, message, ...(hint ? { hint } : {}) });

function scriptInputs(rt, i, actions) {
  if (actions.length && i % 7 === 3) return { actions: { [actions[(i / 7 | 0) % actions.length]]: true } };
  if (i % 23 === 11) { const opts = rt.availableOptions().filter(o => o.actions); if (opts.length) return { actions: opts[(i / 23 | 0) % opts.length].actions }; }
  return { axes: { move: [Math.sin(i / 30), Math.cos(i / 45)] } };
}

/** -> { ok, problems, warnings, report } */
export async function checkPrimitiveExperiment(experiment, { doc, base = null, budget = GATE } = {}) {
  const started = performance.now();
  const problems = [], warnings = [];
  const report = { frames: 0, applied: 0, dropped: 0, errors: 0, events: 0, varsChanged: 0, draws: 0, stepAvgMs: null, deterministic: null, restoreExact: null, verify: null, ms: null };
  const finish = () => ({ ok: !problems.length, problems, warnings, report: { ...report, ms: Math.round(performance.now() - started) } });
  problems.push(...cardProblems(experiment.card));
  if (problems.length) return finish();
  const card = cleanCard(experiment.card);
  // Registry admission (id shape, intent) and no collision with a registered primitive.
  const baseCat = base || await catalogueForDoc(withoutExperiment(doc, experiment.id));
  if (baseCat.registry.has(card.id)) { problems.push(problem('card_collision', `'${card.id}' is already a registered primitive`, 'pick an id for the new mechanic')); return finish(); }
  try { new Registry([hostPrimitive(experiment, { box: vmBox })]); } catch (error) { problems.push(problem('card_invalid', error.message)); return finish(); }
  const box0 = vmBox(experiment.code);
  if (box0.error) { problems.push(problem('load', `the module did not load: ${box0.error}`)); return finish(); }
  const gameDoc = withExperiment(doc, experiment);
  const cat = await catalogueForDoc(gameDoc);
  const pre = preflight(gameDoc, cat.registry, cat.logic);
  if (!pre.ok) { for (const e of pre.errors.slice(0, 6)) problems.push(problem(`preflight_${e.code}`, `${e.path}: ${e.message}`, e.hint)); return finish(); }
  // A config outside a declared range must be rejected by preflight with param_range.
  const ranged = Object.entries(card.params).find(([, s]) => (s.type === 'number' || s.type === 'integer') && s.max !== undefined);
  if (ranged) {
    const bad = structuredClone(gameDoc); bad.systems.find(s => s.use === card.id).with = { [ranged[0]]: ranged[1].max + 1 };
    const r = preflight(bad, cat.registry, cat.logic);
    if (!r.errors.some(e => e.code === 'param_range')) problems.push(problem('bad_config_accepted', `preflight accepted ${ranged[0]} = ${ranged[1].max + 1}`));
  } else warnings.push('no ranged numeric param, so no bad-config check');
  // Play: scripted inputs, twice for determinism, plus snapshot/restore equivalence.
  const actions = card.provides.actions;
  const play = (frames, { restoreAt = null } = {}) => {
    const rt = createWorld(pre.doc, cat.registry, cat.logic, { seed: gameDoc.seed });
    const before = JSON.stringify(rt.state.vars);
    let stepMs = 0, snap = null, i = 0, events = 0;
    rt.on('*', e => { if (card.provides.events.some(n => n === e.name || (n.endsWith(':*') && e.name.startsWith(n.slice(0, -1))))) events++; });
    for (; i < frames && rt.state.status === 'playing'; i++) {
      if (restoreAt !== null && i === restoreAt) snap = rt.snapshot();
      const t = performance.now(); rt.step(scriptInputs(rt, i, actions)); stepMs += performance.now() - t;
      if (performance.now() - started > budget.wallMs) break;
    }
    return { rt, stepMs, frames: i, snap, events, varsChanged: JSON.stringify(rt.state.vars) !== before };
  };
  let a;
  try { a = play(budget.frames, { restoreAt: Math.floor(budget.frames / 2) }); }
  catch (error) { problems.push(problem('throws', `the game threw with the experiment in it: ${String(error?.message || error).slice(0, 200)}`)); return finish(); }
  const stats = Object.entries(a.rt.caches).find(([k]) => k.startsWith('exp:'))?.[1] || {};
  Object.assign(report, { frames: a.frames, applied: stats.applied || 0, dropped: stats.dropped || 0, errors: stats.errors || 0, events: a.events, varsChanged: a.varsChanged, stepAvgMs: +(a.stepMs / Math.max(1, a.frames)).toFixed(3) });
  if (stats.disabled) problems.push(problem('disabled', `the host stopped it: ${stats.note}`, stats.problems?.join('; ')));
  else if (stats.errors) problems.push(problem('errors', `${stats.errors} errors: ${(stats.problems || []).join('; ')}`));
  if (report.dropped > 0) problems.push(problem('bad_ops', `${report.dropped} returned effects were rejected: ${(stats.problems || []).join('; ').slice(0, 300)}`, `effects must be {do: kind, ...} with kind one of ${vocabulary(cat.logic).effects.join(', ')}`));
  if (report.stepAvgMs > budget.stepAvgMs) problems.push(problem('slow', `a game step averaged ${report.stepAvgMs} ms with the experiment; the budget is ${budget.stepAvgMs} ms`));
  if (!report.applied && !report.events && !report.varsChanged) problems.push(problem('no_effect', `in ${a.frames} frames the experiment changed nothing in the game`, 'return effects (set_var, add_var, emit, ...) when the mechanic happens'));
  const b = play(budget.frames);
  report.deterministic = hashOf(a.rt.snapshot()) === hashOf(b.rt.snapshot()) && a.frames === b.frames;
  if (!report.deterministic) problems.push(problem('nondeterministic', 'two runs with the same seed and inputs ended in different states', 'use only the rng you are given; keep all state in the returned state'));
  if (a.snap) {
    const rt = createWorld(pre.doc, cat.registry, cat.logic, { seed: gameDoc.seed });
    rt.restore(a.snap);
    for (let i = Math.floor(budget.frames / 2); i < a.frames && rt.state.status === 'playing'; i++) rt.step(scriptInputs(rt, i, actions));
    report.restoreExact = hashOf(rt.snapshot()) === hashOf(a.rt.snapshot());
    if (!report.restoreExact) problems.push(problem('restore_mismatch', 'restoring a snapshot and replaying did not reach the same state'));
  }
  const vBefore = await verifyDocument(doc, baseCat.registry, baseCat.logic, { budgetMs: 600 });
  const vAfter = await verifyDocument(gameDoc, cat.registry, cat.logic, { budgetMs: 600 });
  report.verify = { before: vBefore.completable, after: vAfter.completable, source: vAfter.source };
  if (regressed(vBefore, vAfter)) problems.push(problem('plot_regressed', 'with the experiment the game can no longer be finished'));
  return finish();
}

// ---------- generation ----------
const SYSTEM = `You write a NEW game mechanic as a primitive for the Gameverse kernel, where every game is a JSON document of primitives. You write two things:
1. card: the primitive's card, read by planners: { "id": "gameplay.<domain>.<name>", "intent": "...", "views": ["any"], "phase": "rules", "params": { "<camelName>": { "type": "number"|"integer"|"boolean"|"string", "default": ..., "min"?: n, "max"?: n, "unit"?: "...", "options"?: [...], "effect": "what it changes" } }, "provides": { "events": [...], "vars": [...], "actions": [...] }, "requires": { "capabilities": [] } }
   - actions are new player verbs (input reaches your step as input.actions.<verb>). vars are numbers you keep in the game's vars (set them with set_var/add_var). events are names you emit.
   - Give every number param a min and max. Keep requires.capabilities empty unless you rely on a space capability.
2. code: one ES module, exactly one \`export default { label, init(snapshot, rng, config), step(state, { snapshot, input, config, rng }), draw?(state, snapshot) }\`, no imports.
   - init returns your initial state (plain JSON). step returns { state, ops }: your new state and a list of kernel EFFECTS to run this step (may be empty). Effects are objects { "do": kind, ...fields } with kind one of: __EFFECTS__. Common fields: set_var/add_var {var, value}, set_flag {flag}, emit {event, data?}, give_item/take_item {item, count?}, end_game {ending?, outcome?}, say {character, text}, teleport {who?, zone?, at?, space?}.
   - snapshot: { frame, time, status, player: { id, at, zone, space, hp, body }, entities: [{ id, archetype, at, zone, hp }], zones: [...], vars, flags, counts, events: [{ name, ... }] (this step so far), input: { actions, axes: { move: [x, y] } } }.
   - draw (optional) returns a HUD display list in overlay units (x and w are fractions of the view's width, y, h, r and size fractions of its height): { t: "rect", x, y, w, h, color } | { t: "text", x, y, text, color, size? } | { t: "circle", x, y, r, color } | { t: "line", x1, y1, x2, y2, color } | { t: "poly", points, color }.
   - The sandbox has no Math.random, Date, performance, timers, Promise, async, fetch, DOM, console, eval or Function. Use only the rng you are given (call it as rng()). Deterministic: the same inputs give the same outputs. Each call well under 1 ms. Never throw: any snapshot field may be missing or null.
   - The mechanic must visibly do something within seconds of play (change a var, emit an event, run an effect).
Reply with JSON: { "label": "<at most 24 chars>", "card": {...}, "code": "<the module source>", "instance": { "with": { ... } } }.`;

function docSummary(doc) {
  return {
    title: doc.title, premise: doc.plot?.premise, spaces: doc.spaces.map(s => ({ id: s.id, use: s.use, zones: (s.zones || []).map(z => z.id).slice(0, 20) })),
    systems: (doc.systems || []).map(s => s.use), items: (doc.content?.items || []).map(i => i.id).slice(0, 30), characters: (doc.plot?.characters || []).map(c => c.id).slice(0, 20),
    endings: (doc.plot?.endings || []).map(e => e.id), player: doc.player,
  };
}

async function sampleSnapshots(doc) {
  try {
    const cat = await catalogueForDoc(doc);
    const pre = preflight(doc, cat.registry, cat.logic);
    if (!pre.ok) return [];
    const rt = createWorld(pre.doc, cat.registry, cat.logic, { seed: doc.seed });
    const out = [];
    for (let i = 0; i <= 120 && rt.state.status === 'playing'; i++) { rt.step(scriptInputs(rt, i, [])); if (i === 2 || i === 120) out.push(kernelSnapshot(rt, {})); }
    return out;
  } catch { return []; }
}

const describe = problems => problems.map(p => `- [${p.code}] ${p.message}${p.hint ? ` (hint: ${p.hint})` : ''}`).join('\n');
const parse = text => {
  const out = parseReply(text);
  if (!out || typeof out.code !== 'string' || !out.card) throw Object.assign(Error('the code model returned no card and module'), { status: 502 });
  return { label: String(out.label || out.card.id || 'Experiment').slice(0, 40), card: out.card, code: out.code.replace(/^\s*```(?:js|javascript)?\s*\n/, '').replace(/\n```\s*$/, ''), instance: { with: out.instance?.with && typeof out.instance.with === 'object' ? out.instance.with : {} } };
};

/**
 * generatePrimitiveExperiment({ writer, doc, request, gap?, repairs }) -> { experiment, report }
 * experiment.check carries the last gate result; callers attach it only when check.ok.
 */
export async function generatePrimitiveExperiment({ writer, doc, request, gap = null, repairs = 2 }) {
  if (!writer) throw Object.assign(Error('Writing a new primitive needs a code model.'), { status: 503 });
  const started = performance.now();
  const base = await catalogueForDoc(doc);
  const system = SYSTEM.replace('__EFFECTS__', vocabulary(base.logic).effects.join(', '));
  const user = [`Game: ${JSON.stringify(docSummary(doc))}`, `Registered primitives (do not duplicate these ids): ${base.registry.ids().join(', ')}`,
    `Snapshots of this game: ${(await sampleSnapshots(doc)).map(s => JSON.stringify(s).slice(0, 2500)).join('\n')}`,
    `Mechanic to build: ${request}${gap?.why ? `\nWhy no primitive covers it: ${gap.why}` : ''}`].join('\n\n');
  const attempts = [];
  let conversation = user, draft = null, check = null;
  for (let attempt = 0; attempt <= repairs; attempt++) {
    const reply = await writer.complete({ system, user: conversation });
    try { draft = parse(reply.text); }
    catch (error) { attempts.push({ attempt, modelMs: reply.ms, ok: false, problems: [error.message] }); if (attempt === repairs) break; continue; }
    const id = `pexp-${createHash('sha256').update(draft.code + JSON.stringify(draft.card)).digest('hex').slice(0, 12)}`;
    const candidate = { schema: PRIMITIVE_EXPERIMENT_SCHEMA, id, kind: 'primitive', label: draft.label, request, card: draft.card, code: draft.code, instance: draft.instance };
    check = await checkPrimitiveExperiment(candidate, { doc, base });
    attempts.push({ attempt, modelMs: reply.ms, served: reply.model, ok: check.ok, problems: check.problems.map(p => p.code), checkMs: check.report.ms });
    draft = candidate;
    if (check.ok) break;
    conversation = `${user}\n\nYour previous answer:\n${JSON.stringify({ card: draft.card, code: draft.code }).slice(0, 20000)}\n\nIt failed the gate (headless play of this game with your primitive in it):\n${describe(check.problems)}\n\nReturn the complete corrected answer.`;
  }
  if (!draft) throw Object.assign(Error('The code model returned no usable primitive.'), { status: 502 });
  const experiment = { ...draft, check: { ok: Boolean(check?.ok), problems: check?.problems || [], warnings: check?.warnings || [], report: check?.report || {} },
    provenance: { model: writer.model, attempts: attempts.length, created: new Date().toISOString() } };
  return { experiment, report: { ok: Boolean(check?.ok), attempts, totalMs: Math.round(performance.now() - started) } };
}
