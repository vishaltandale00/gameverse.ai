// @ts-check
// Extensions onto a composed template document (ARCHITECTURE.md §5; v2/HANDOFF.md user directive "Templates +
// extension"): a template is the base loop, and the idea's extra mechanics are added onto it step by step, checked.
// The template pick names them (templates.js pick form `mechanics`: a short verb phrase, the declared verb that is it,
// core | extra); the step path's machinery adds each one the composed templates do not already give:
//   template   a mechanic whose verb a primitive of the composed document gives the player (templates.js declaredVerbs:
//              card.loop.verbs, card.loop.verbsOf for the instance) is covered by that primitive: nothing is added;
//   extension  otherwise, ONE small strict enum question over EVERY option code has proven valid by declarations
//              (retrieval.js pickOption): each catalogue card whose declared loop gives the player verbs, that carries
//              no whole loop of its own (card.mode: a game, which the pick names as a game), serves the interaction the
//              primary template is played in, and is not in the document yet, as its smallest bundle (bundles.js
//              formBundle: its requirements closure, companions its declarations name) whose addition to the composed
//              document adds no new problem: preflight's structural codes, the composition check, the loop check, the
//              content contracts its own cards declare (content.js populateProblems), and the engagement its cards
//              declare (card.engage config filled from content the document must already have). In declaration order
//              (retrieval.js declarationOrder: the cards whose loop declares the mechanic's verb first, then the
//              catalogue's order): nothing is cut and nothing is ranked by text. The pick joins the document
//              with its bundle and the checks run again on the whole document; a pick that fails them is dropped and
//              the question asked again without it (build.js's convention);
//   gap layer  "none", or no valid option: the gap layer writes the primitive (cfg.gaps 'auto', within
//              cfg.maxGapPrimitives), and the document it returns is held to the same checks.
// When the limits run out the build fails naming every mechanic still missing: a mechanic is never dropped, never
// isolated and never substituted. Every chosen template's structure is kept: an extension only adds instances (and the
// engagement its own cards declare, engage.js `only`).
//
// The params of a mechanic's primitive are written by the model in one strict form derived from its card
// (paramsForm: every param whose declaration has a strict shape; open values keep the card's declarations unset, never
// free JSON), asked in the parallel content round. Its check applies the answer, engages the primitive and requires
// preflight to pass on its instance, every engagement config its card fills from its own params to be filled, and the
// player to get its verbs (runtime-lib-controls.js instanceVerbs: a gun with no weapon gives no `fire`).
// Nothing here names a primitive, a template or a game.
import { cardLoop } from './loop.js';
import { isSpace, isGenerator, isGraphics } from './catalog.js';
import { preflight } from '../kernel/document.js';
import { checkComposition } from './compose-check.js';
import { loopProblems } from './loop-check.js';
import { contractsFor, populateProblems, docRefs } from './content.js';
import { engageDocument } from './engage.js';
import { formBundle } from './bundles.js';
import { pickOption, servesContext, declarationOrder, declaresVerb, STRUCTURAL } from './retrieval.js';
import { makeAsk } from './build-steps.js';
import { strictSpec, formKey, obj as strictObj, nul, decode } from './outline-form.js';
import { declaredVerbs, instancesIn, instancesWithPaths } from './templates.js';
import { instanceVerbs } from '../primitives/engine/runtime-lib-controls.js';
import { isObj, isStr, prop, messageOf } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('../kernel/types.js').Card} Card */
/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('./types.js').ReplySchema} ReplySchema */
/** @typedef {import('./outline-form.js').Codec} Codec */
/** @typedef {import('./outline-form.js').RefContext} RefContext */
/** @typedef {import('./templates.js').PickMechanic} PickMechanic */
/** @typedef {import('./templates.js').TemplateCall} TemplateCall */
/** @typedef {import('./templates.js').FormProblem} FormProblem */
/** @typedef {import('./retrieval.js').Option} Option */
/** The gap layer (kernel-pipeline.js GapService). @typedef {{ fill(request: { doc: unknown, request: string, gap: unknown }): Promise<{ ok: boolean, doc?: unknown, experiment: Record<string, unknown>, problems?: unknown[] }> }} GapService */
/** One question of an extension step and its answer. @typedef {{ name: string, offered: string[], pick: string, why: string, ok: boolean, problem?: string }} ExtensionAsk */
/**
 * How one mechanic the idea names is covered: by the composed templates, by an extension step, or by the gap layer;
 * `primitives` what gives it (the step's bundle, or the primitives the gap layer wrote); a mechanic nothing covers has
 * `by` null and why. The step's record: the options offered (and the cards rejected, with why), the questions asked.
 * @typedef {{ mechanic: string, verb: string, importance: string, by: 'template' | 'extension' | 'gap' | null, primitives: string[], why: string,
 *   offered?: string[], rejected?: Array<{ id: string, why: string }>, asks?: ExtensionAsk[], gap?: Record<string, unknown>, experiment?: unknown, ms?: number }} Coverage
 */

export const EXTEND_VERSION = 'extend/0.1';
/** Every problem code the extension stage emits. */
export const EXTEND_RULES = Object.freeze({
  extension_missing: 'a mechanic the idea names is covered by a template, an extension step or the gap layer, or the build fails naming it',
  extension_unengaged: 'an extension\'s engagement (card.engage config) is filled: from its own params (its params form) or from content the document has',
  extension_unusable: 'the player gets the verbs of an extension\'s primitive (card.loop.verbs, card.loop.verbsOf)',
  extension_params: 'an extension\'s params pass preflight on its instance',
});


/** @param {RegistryLike} registry @param {string} id @returns {Card | null} */
const cardOf = (registry, id) => registry.get(id)?.card ?? null;
/** The primitives a document uses. @param {Record<string, any>} doc */
const usesOf = doc => new Set(instancesIn(doc).map(i => String(i.use)));
/** The document with these primitives appended to its systems (each once). @param {Record<string, any>} doc @param {string[]} ids */
export function withSystems(doc, ids) {
  const d = structuredClone(doc), have = usesOf(d);
  d.systems = Array.isArray(d.systems) ? d.systems : [];
  for (const id of ids) if (!have.has(id)) { d.systems.push({ use: id }); have.add(id); }
  return d;
}

/**
 * The template coverage of the idea's mechanics: a mechanic whose verb a primitive of the document gives the player is
 * covered by it (templates.js declaredVerbs). -> one Coverage per mechanic, `by` null for those an extension must add.
 * @param {readonly PickMechanic[]} mechanics @param {Record<string, any>} doc @param {RegistryLike} registry @returns {Coverage[]}
 */
export function templateCoverage(mechanics, doc, registry) {
  const verbs = declaredVerbs(doc, registry);
  return mechanics.map(m => {
    const by = m.verb !== 'none' ? verbs.get(m.verb) ?? [] : [];
    return { mechanic: m.name, verb: m.verb, importance: m.importance, by: by.length ? 'template' : null, primitives: by,
      why: by.length ? `the composed templates give the player '${m.verb}' (${by.join(', ')})` : m.verb === 'none' ? 'no declared verb is it' : `no primitive of the composed templates gives the player '${m.verb}'` };
  });
}

/** The keyed problems of a document stage. @typedef {Map<string, string>} Problems */

/**
 * The checks an extension is held to, on a document with `ids` added (see the header): each stage's problems with
 * stable keys. Stages run in order and stop at the first one with a problem `baseline` (the document before) does
 * not have, so a rejected option costs only the checks that reject it.
 * @param {Record<string, any>} d the document with the extension @param {string[]} ids the primitives it adds
 * @param {{ registry: RegistryLike, logic: LogicLike, baseline?: Record<string, Problems> | null }} cat
 * @returns {{ problems: Record<string, Problems>, fresh: string[] }}
 */
export function extensionProblems(d, ids, { registry, logic, baseline = null }) {
  /** @type {Record<string, Problems>} */
  const problems = {};
  /** @type {string[]} */
  const fresh = [];
  const stage = (/** @type {string} */ name, /** @type {() => Problems} */ run) => {
    if (fresh.length) return;
    const got = run();
    problems[name] = got;
    for (const [k, m] of got) if (!baseline?.[name]?.has(k)) fresh.push(m);
  };
  stage('preflight', () => new Map(preflight(structuredClone(d), registry, logic).errors.filter(e => STRUCTURAL.has(e.code)).map(e => [`${e.code}:${e.message}`, `preflight ${e.code}: ${e.message}`])));
  stage('composition', () => new Map(checkComposition(/** @type {any} */ (d), registry, { logic }).failures.map(f => [`${f.check}:${f.code}:${f.unit}`, `composition ${f.code}: ${f.message}`])));
  stage('loop', () => new Map(loopProblems(/** @type {any} */ (d), registry, { logic }).map(p => [`${p.code}:${p.primitive}:${p.path}`, `loop ${p.code}: ${p.message}`])));
  stage('content', () => new Map(ids.length ? populateProblems(d, registry, { contracts: contractsFor(registry, ids) }).map(p => [`${p.code}:${p.contract}`, `content ${p.code}: ${p.message}`]) : []));
  stage('engage', () => new Map(unengaged(d, ids, { registry, logic }).filter(u => !u.own).map(u => [`${u.use}:${u.param}`, `engage: ${u.message}`])));
  return { problems, fresh };
}

/**
 * The engagement configs of `ids` (card.engage.config) the document leaves unfilled once engaged: `own` when the value
 * is filled from the instance's own params ('$first:with.<param>': the params form writes it), else from a document
 * section it does not have. @param {Record<string, any>} d @param {string[]} ids @param {{ registry: RegistryLike, logic: LogicLike }} cat
 * @returns {Array<{ use: string, param: string, from: string[], own: boolean, message: string }>}
 */
export function unengaged(d, ids, { registry, logic }) {
  if (!ids.length) return [];
  const e = engageDocument(/** @type {any} */ (d), registry, logic, { only: new Set(ids), force: true });
  return e.skipped.filter(s => s.part === 'config' && isStr(s.use) && isStr(s.what)).map(s => {
    const use = String(s.use), param = String(s.what);
    const from = (JSON.stringify(prop(cardOf(registry, use)?.engage?.config, param) ?? null).match(/\$(?:first|ids):[A-Za-z0-9_.]+/g) || []).map(x => x.slice(x.indexOf(':') + 1));
    const own = from.length > 0 && from.every(p => p.startsWith('with.'));
    return { use, param, from, own, message: `${use} fills ${param} from ${from.join(', ') || 'nothing declared'}, which ${own ? 'its params leave empty' : 'the document does not have'}` };
  });
}

/**
 * Every valid option for one mechanic on the document (see the header), in declaration order, and the cards rejected
 * with why. @param {{ doc: Record<string, any>, registry: RegistryLike, logic: LogicLike, mechanic: PickMechanic, interactions: string[] }} args
 * @returns {{ options: Option[], rejected: Array<{ id: string, why: string }> }}
 */
export function extensionOptions({ doc, registry, logic, mechanic, interactions }) {
  const have = usesOf(doc);
  const base = extensionProblems(doc, [], { registry, logic });
  /** @type {Map<string, { ok: true, variant: number } | { ok: false, why: string }>} */
  const memo = new Map();
  /** @param {string[]} ids */
  const composes = ids => {
    const add = [...new Set(ids)].filter(id => !have.has(id)).sort();
    const key = add.join(',');
    const hit = memo.get(key); if (hit) return hit;
    const r = extensionProblems(withSystems(doc, add), add, { registry, logic, baseline: base.problems });
    /** @type {{ ok: true, variant: number } | { ok: false, why: string }} */
    const out = r.fresh.length ? { ok: false, why: r.fresh.slice(0, 3).join('; ') } : { ok: true, variant: 0 };
    memo.set(key, out);
    return out;
  };
  // The composed world is the templates': an extension that needs an adapter onto it fails the composition check.
  const resolve = () => ({ adapters: [], bind: {}, gaps: [] });
  const space = String(doc.spaces?.[0]?.use ?? '');
  const served = (/** @type {Card} */ c) => (interactions.length ? interactions.some(i => servesContext(c, i)) : servesContext(c, null));
  const pool = registry.cards().filter(c => !isSpace(c.id) && !isGenerator(c.id) && !isGraphics(c.id) && !c.adapts && !c.mode && !have.has(c.id) && (cardLoop(c)?.verbs.length ?? 0) > 0 && served(c));
  /** @type {Option[]} */
  const options = [];
  /** @type {Array<{ id: string, why: string }>} */
  const rejected = [];
  for (const c of pool) {
    const b = formBundle({ registry, seed: c.id, systems: [...have], space, adapters: [], composes, resolve, interaction: interactions[0] ?? null });
    if (!b.ok) { rejected.push({ id: c.id, why: b.why }); continue; }
    options.push({ id: c.id, score: Number(declaresVerb(registry, c.id, mechanic.verb)), variant: 0, members: b.members, extra: b.extra, adapters: [] });
  }
  options.sort(declarationOrder(registry, mechanic.verb));
  return { options, rejected };
}

/** The gap layer's request for a mechanic no catalogue primitive covers. @param {PickMechanic} m @param {Record<string, any>} doc @param {string[]} interactions @param {string} spec */
export function extensionGap(m, doc, interactions, spec) {
  const spaces = (Array.isArray(doc.spaces) ? doc.spaces : []).map((/** @type {Record<string, any>} */ s) => s.use).join(', ');
  const signature = `${m.name}: a primitive whose loop (card.loop) gives the player ${m.verb === 'none' ? 'a verb' : `the verb '${m.verb}'`} for "${m.name}", played as ${interactions.join(' or ') || 'the game is'}, on ${spaces}, added onto a game whose primitives are ${[...usesOf(doc)].join(', ')}${spec ? `. Spec: ${spec}` : ''}`.slice(0, 700);
  return { request: `${signature}. It must declare its loop (card.loop: verbs, progress events).`.slice(0, 700),
    gap: { mechanic: m.name, description: signature, importance: m.importance === 'core' ? 'core' : 'supporting', kind: 'no_primitive', why: spec || 'no catalogue primitive is valid for it', signature } };
}

/** A writer that records each call in the template path's call list. @param {Writer} writer @param {TemplateCall[]} calls @returns {Writer} */
export function recordingWriter(writer, calls) {
  return { ...writer, async complete(req) {
    const t0 = performance.now();
    /** @type {TemplateCall} */
    const call = { form: String(req.schema?.name ?? 'reply'), model: null, ms: 0 };
    calls.push(call);
    try { const r = await writer.complete(req); call.model = r.model || writer.model; return r; }
    catch (error) { call.error = messageOf(error).slice(0, 160); throw error; }
    finally { call.ms = Math.round(performance.now() - t0); }
  } };
}

/**
 * Add every mechanic the composed templates do not cover (see the header), one after another, each checked.
 * -> { doc, registry, logic, coverage (one per mechanic, in the pick's order), added (the extension steps' seeds, whose
 * params the content round writes), calls (this stage's model calls, asked one after another), missing (the
 * mechanics nothing covers: the caller fails the build naming them) }
 * @param {{ doc: Record<string, any>, mechanics: readonly PickMechanic[], registry: RegistryLike, logic: LogicLike, writer: Writer, attempts: number, interactions: string[],
 *   header: string, gaps: { mode: string, service: GapService | null, max: number }, catalogue: (doc: unknown) => Promise<{ registry: RegistryLike, logic: LogicLike }>, stage?: (name: string, detail: Record<string, unknown>) => void,
 *   deadline?: number | null }} args
 *   deadline: the step path's time box (a performance.now() value): a step's question is not asked after it, and the
 *   mechanic is missing with why (build-steps.js makeAsk, step_path_timeout)
 */
export async function extendDocument({ doc: input, mechanics, registry: reg, logic: lg, writer, attempts, interactions, header, gaps, catalogue, stage = () => {}, deadline = null }) {
  let doc = structuredClone(input), registry = reg, logic = lg, calls = 0, written = 0;
  const ask = makeAsk({ writer, attempts, count: () => { calls++; }, deadline });
  const coverage = templateCoverage(mechanics, doc, registry);
  /** @type {string[]} */
  const added = [];
  // Core mechanics first, then extras, each in the idea's order: every one is built or the build fails.
  const order = coverage.map((c, i) => ({ c, i })).filter(x => !x.c.by).sort((a, b) => Number(a.c.importance !== 'core') - Number(b.c.importance !== 'core') || a.i - b.i);
  for (const { c, i } of order) {
    const t0 = performance.now();
    const m = mechanics[i];
    const found = extensionOptions({ doc, registry, logic, mechanic: m, interactions });
    Object.assign(c, { offered: found.options.map(o => o.id), rejected: found.rejected.slice(0, 12), asks: [] });
    const asks = /** @type {ExtensionAsk[]} */ (c.asks);
    let open = [...found.options], spec = '';
    /** @type {string | null} */
    let problem = null;
    /** Why the step's own question failed (its answers kept failing), when it did. */
    let failed = '';
    const mechanic = /** @type {import('./decompose.js').Mechanic} */ ({ id: formKey(m.name).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40) || 'mechanic', verb: m.verb === 'none' ? '' : m.verb, description: m.name, from: '', importance: m.importance === 'core' ? 'core' : 'supporting' });
    const head = `${header}\nPrimitives in the game: ${[...usesOf(doc)].join(', ')}\nThe idea also names "${m.name}" (${m.importance}${m.verb !== 'none' ? `, the verb '${m.verb}'` : ''}), which no primitive of the game gives the player yet.`;
    while (open.length) {
      /** @type {Awaited<ReturnType<typeof pickOption>>} */
      let a;
      // A question whose answers keep failing (makeAsk: selection_failed) leaves the mechanic missing, with why.
      try { a = await pickOption({ ask, registry, header: head, mechanic, options: open, problem }); }
      catch (error) { failed = `the extension question failed: ${messageOf(error).slice(0, 300)}`; break; }
      for (const x of a.asked) asks.push({ ...x, ok: false });
      if (a.pick === 'none') { spec = a.spec; asks[asks.length - 1].why = a.why; break; }
      const cand = /** @type {Option} */ (open.find(o => o.id === a.pick));
      const after = withSystems(doc, cand.members);
      const checked = extensionProblems(after, cand.members.filter(id => !usesOf(doc).has(id)), { registry, logic, baseline: extensionProblems(doc, [], { registry, logic }).problems });
      if (checked.fresh.length) {
        const last = asks[asks.length - 1]; last.problem = checked.fresh.slice(0, 3).join('; ');
        open = open.filter(o => o.id !== a.pick);
        problem = `Your pick ${cand.members.join(' + ')} was dropped: ${last.problem}. Pick another listed option, or "none".`;
        continue;
      }
      asks[asks.length - 1].ok = true;
      doc = after;
      added.push(cand.id);
      Object.assign(c, { by: 'extension', primitives: [...cand.members], why: a.why || `added ${cand.members.join(' + ')}` });
      break;
    }
    if (!c.by && failed) c.why = failed;
    else if (!c.by) {
      // The gap layer writes the primitive no catalogue option gives (cfg.gaps 'auto', within its limit).
      const g = extensionGap(m, doc, interactions, spec);
      c.gap = g.gap;
      if (gaps.mode === 'auto' && gaps.service && written < gaps.max) {
        written++;
        stage('gap', { mechanic: m.name, during: 'extension' });
        try {
          const r = await gaps.service.fill({ doc, request: g.request, gap: g.gap });
          if (r.ok && isObj(r.doc)) {
            const next = await catalogue(r.doc);
            const before = usesOf(doc);
            const fresh = [...usesOf(/** @type {Record<string, any>} */ (r.doc))].filter(u => !before.has(u) && next.registry.has(u));
            const base = extensionProblems(doc, [], next);
            const checked = extensionProblems(/** @type {Record<string, any>} */ (r.doc), fresh, { ...next, baseline: base.problems });
            if (fresh.length && !checked.fresh.length) {
              doc = /** @type {Record<string, any>} */ (r.doc); registry = next.registry; logic = next.logic;
              Object.assign(c, { by: 'gap', primitives: fresh, why: `the gap layer wrote ${fresh.join(', ')}`, experiment: r.experiment?.id ?? null });
            } else c.why = fresh.length ? `the gap layer's ${fresh.join(', ')} fails the checks: ${checked.fresh.slice(0, 3).join('; ')}` : 'the gap layer added no primitive';
          } else c.why = `the gap layer could not write it: ${JSON.stringify(r.problems ?? []).slice(0, 300)}`;
        } catch (error) { c.why = `the gap layer failed: ${messageOf(error).slice(0, 200)}`; }
      } else c.why = `${found.options.length ? `none of the ${found.options.length} valid options gives it${spec ? ` (${spec.slice(0, 200)})` : ''}` : `no catalogue primitive is valid on the game${found.rejected.length ? ` (${found.rejected.slice(0, 2).map(x => `${x.id}: ${x.why}`).join('; ')})` : ''}`}; the gap layer ${gaps.mode !== 'auto' ? `is ${gaps.mode} (not auto)` : !gaps.service ? 'is not connected' : `has written its limit (${gaps.max})`}`.slice(0, 600);
    }
    c.ms = Math.round(performance.now() - t0);
    stage('extended', { mechanic: m.name, by: c.by, primitives: c.primitives, calls });
  }
  return { doc, registry, logic, coverage, added, calls, missing: coverage.filter(c => !c.by) };
}

// ---------------------------------------------------------------------------------------------------------------
// The params form of an extension's primitive: strict, derived from its card.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The params form of one extension primitive in a document (see the section header), or null when its card declares
 * no param with a strict shape. Its answer: one slot per param (null keeps the card's declaration).
 * @param {Record<string, any>} doc @param {string} use @param {{ registry: RegistryLike, logic: LogicLike }} cat
 */
export function paramsForm(doc, use, { registry, logic }) {
  const card = cardOf(registry, use);
  const at = instancesWithPaths(doc).find(x => x.inst.use === use)?.path;
  if (!card || !at) return null;
  const refs = docRefs(registry, doc);
  /** @type {Array<{ key: string, codec: Codec, schema: Record<string, unknown> }>} */
  const slots = [];
  for (const [key, spec] of Object.entries(card.params || {})) {
    const s = strictSpec(spec, 1, refs);
    if (s) slots.push({ key, codec: s.codec, schema: prop(spec, 'required') ? s.schema : nul(s.schema) });
  }
  if (!slots.length) return null;
  /** @type {ReplySchema} */
  const schema = { name: `params_${formKey(use)}`.slice(0, 64), schema: strictObj(Object.fromEntries(slots.map(s => [s.key, s.schema]))) };
  /** @param {unknown} v @returns {Record<string, unknown>} */
  const narrow = v => Object.fromEntries(slots.map(s => [s.key, decode(prop(v, s.key), s.codec)]).filter(([, x]) => x !== undefined));
  /** @param {Record<string, any>} d @param {Record<string, unknown>} v */
  const apply = (d, v) => {
    const inst = instancesWithPaths(d).find(x => x.inst.use === use)?.inst;
    if (inst) inst.with = { ...(isObj(inst.with) ? inst.with : {}), ...structuredClone(v) };
  };
  const before = new Set(preflight(structuredClone(doc), registry, logic).errors.map(e => `${e.code}|${e.path}`));
  /** @param {Record<string, unknown>} v @returns {FormProblem[]} */
  const check = v => {
    const d = structuredClone(doc);
    apply(d, v);
    /** @type {FormProblem[]} */
    const problems = [];
    const all = (/** @type {string} */ code, /** @type {string} */ message) => { for (const s of slots) problems.push({ code, field: s.key, message }); };
    for (const u of unengaged(d, [use], { registry, logic })) {
      const own = u.from.filter(p => p.startsWith('with.')).map(p => p.split('.')[1]).filter(k => slots.some(s => s.key === k));
      if (own.length) for (const k of own) problems.push({ code: 'extension_unengaged', field: k, message: `${use} gives the player ${u.param} from ${k}: write at least one entry` });
      else all('extension_unengaged', u.message);
    }
    const engaged = engageDocument(/** @type {any} */ (d), registry, logic, { only: new Set([use]), force: true }).doc;
    for (const e of preflight(structuredClone(engaged), registry, logic).errors) {
      const mine = e.path === at || e.path.startsWith(`${at}.`);
      if (!mine && before.has(`${e.code}|${e.path}`)) continue;
      const key = mine && e.path.startsWith(`${at}.with.`) ? e.path.slice(`${at}.with.`.length).split(/[.[]/)[0] : null;
      const msg = `${e.code} ${e.path}: ${e.message}${e.hint ? ` (${e.hint})` : ''}`.slice(0, 300);
      if (key && slots.some(s => s.key === key)) problems.push({ code: 'extension_params', field: key, message: msg }); else all('extension_params', msg);
    }
    if (!problems.length) {
      const inst = instancesWithPaths(engaged).find(x => x.inst.use === use)?.inst;
      const declared = cardLoop(card)?.verbs ?? [];
      if (declared.length && !(/** @type {string[]} */ (instanceVerbs(card, inst, engaged))).length) all('extension_unusable', `with these values the player gets none of ${use}'s verbs (${declared.join(', ')}): set what the player uses them with`);
    }
    return problems;
  };
  return { schema, narrow, check, apply, use, intent: String(card.intent || '').replace(/\s+/g, ' ').slice(0, 300) };
}
