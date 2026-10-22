// @ts-check
// Layer 5 of ARCHITECTURE.md §4 plus targeted revisions, for kernel documents.
// - tweakDocument: a parameter patch, no code: ONE small strict model choice among the params the cards declare on the
//   document's instances (a template game: its tune slots; their effect, unit, range and current value listed), or the
//   world's size when its spaces declare scale params, with the new value checked against the declared range (an
//   answer outside it is asked again, never clamped). No words of the request are matched: without a model nothing
//   is tweaked.
// - reviseDocument: a writer proposes targeted ops (set/add/remove at
//   identity-aware paths); nothing else in the document can change.
// - reviewChange: the notes on a change (removals, look changes, finishability, applied-or-not). What may publish
//   is decided by the version gate (version-gate.js), which every new version passes; reviewChange's own block
//   (an invalid or crashing game) only repeats what the gate already refused.
import { regressed } from './verify-adapter.js';
import { cardText, vocabulary, dataShapes } from './catalog.js';

import { parsePath } from './repair.js';
import { contentDiff, changeSummary, shrunkLists, asksToRemove, checkRevision, noulOf } from './revision-check.js';
import { parseReply } from './writer.js';
import { scaleWorld } from './world.js';
import { isObj, list, obj, prop, str, messageOf } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('../kernel/types.js').Instance} Instance */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('../kernel/types.js').ParamSchema} ParamSchema */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('./revision-check.js').Decisions} Decisions */
/** @typedef {import('./repair.js').Key} Key */
/** @typedef {import('./repair.js').Bag} Bag */
/** A tweakable param of an instance in the document, with the range a value must keep (the card's, narrowed by `limits`). @typedef {{ path: string, use: string, param: string, schema: ParamSchema, current: unknown, min?: number, max?: number }} TweakOption */
/** A param change (or, for a world-size request, a scaled section: `use` null, `to` '×factor'). @typedef {{ path: string, use: string | null, param: string, from: unknown, to: number | boolean | string }} TweakOp */
/**
 * The verification fields reviewChange reads (a verifyDocument result satisfies it).
 * @typedef {{ ok?: boolean, viable?: boolean, viability?: string | null, completable?: boolean | null, exhaustive?: boolean, problems?: import('./verify-adapter.js').VerifyProblem[] }} ReviewVerification
 */
/**
 * reviewChange's result: `block` refuses the change; everything else is notes on the published version.
 * @typedef {{ block: { code: string, message: string } | null, notes: string[], dropped: import('./revision-check.js').Shrunk[], artChanged: boolean, revisionCheck: import('./revision-check.js').RevisionCheck | null, changes: string[], diff: number, lines: string[] }} ChangeReview
 */
/** What a writer says it could not do: model output, so `request` / `why` are unchecked. @typedef {{ request: unknown, why?: unknown, [k: string]: unknown }} Unsupported */

export const REVISE_VERSION = 'doc-revise/0.1';

/** @param {Doc} doc @returns {Array<{ inst: Instance, path: string }>} */
function instancesOf(doc) {
  /** @type {Array<{ inst: Instance, path: string }>} */
  const out = [];
  (doc.spaces || []).forEach((s, i) => { out.push({ inst: s, path: `spaces[${i}]` }); (s.generators || []).forEach((g, j) => out.push({ inst: g, path: `spaces[${i}].generators[${j}]` })); });
  (doc.systems || []).forEach((s, i) => out.push({ inst: s, path: `systems[${i}]` }));
  (doc.graphics || []).forEach((g, i) => out.push({ inst: g, path: `graphics[${i}]` }));
  return out;
}

/** A tighter range for a tweakable param than its card's (a template's tune slot), by its document path ('systems[2].with.speed'). @typedef {Map<string, { minimum?: number, maximum?: number }>} TweakLimits */

/**
 * The params a tweak may set (see the header): every number, integer or boolean param the cards declare on the
 * document's instances, in document order; for a template game (`limits` given), only its tune slots. Each with its
 * declared range narrowed by its limit. @param {Doc} doc @param {RegistryLike} registry @param {TweakLimits | null} [limits] @returns {TweakOption[]}
 */
export function tweakOptions(doc, registry, limits = null) {
  /** @type {TweakOption[]} */
  const out = [];
  for (const { inst, path } of instancesOf(doc)) {
    const p = registry.get(inst.use); if (!p) continue;
    for (const [name, s] of Object.entries(p.card.params || {})) {
      if (!['number', 'integer', 'boolean'].includes(s.type)) continue;
      const at = `${path}.with.${name}`;
      if (limits && !limits.has(at)) continue;
      const l = limits?.get(at) || {};
      const min = [s.min, l.minimum].filter(x => typeof x === 'number').reduce((a, b) => Math.max(a, b), -Infinity);
      const max = [s.max, l.maximum].filter(x => typeof x === 'number').reduce((a, b) => Math.min(a, b), Infinity);
      out.push({ path: at, use: inst.use, param: name, schema: s, current: inst.with?.[name] ?? s.default, ...(Number.isFinite(min) ? { min } : {}), ...(Number.isFinite(max) ? { max } : {}) });
    }
  }
  return out;
}

/** @param {unknown} v @returns {v is Bag} a non-null object or list */
const isBag = v => typeof v === 'object' && v !== null;
/** @param {Doc} doc @param {string} path @param {unknown} value */
function setPath(doc, path, value) {
  const keys = parsePath(path);
  /** @type {Bag} */
  let o = doc;
  for (const k of keys.slice(0, -1)) { const next = (o[k] ??= {}); if (!isBag(next)) return; o = next; }
  o[keys[keys.length - 1]] = value;
}

/** Params of a space card marked scale: 'world' (its extent). @param {RegistryLike} registry @param {string} use @returns {string[]} */
const worldParams = (registry, use) => Object.entries(registry.get(use)?.card.params || {}).filter(([, x]) => x.scale === 'world').map(([k]) => k);

/**
 * Model ops that only resize a space's world-scale param grow the container and leave the content as it was (a bigger
 * empty void). They are replaced by scaleWorld with the factor they imply, so generators, zones and the start grow with it.
 * -> { doc, ops (the rest, applied after), scaled: [{ space, factor }] }
 * @param {Doc} before @param {unknown} ops model-written ops @param {RegistryLike} registry
 * @returns {{ doc: Doc, ops: unknown[], scaled: Array<{ space: string, factor: number }> }}
 */
export function routeWorldScale(before, ops, registry) {
  let doc = before;
  /** @type {unknown[]} */
  const rest = [];
  /** @type {Array<{ space: string, factor: number }>} */
  const scaled = [];
  for (const op of Array.isArray(ops) ? ops : []) {
    const m = prop(op, 'op') === 'set' && /^spaces\[([^\]]+)\]\.with\.([a-zA-Z]+)$/.exec(String(prop(op, 'path') || ''));
    const space = m && (doc.spaces || []).find((x, i) => x.id === m[1] || String(i) === m[1]);
    if (!m || !space || !worldParams(registry, space.use).includes(m[2])) { rest.push(op); continue; }
    /** @type {unknown} */
    const cur = space.with?.[m[2]] ?? registry.get(space.use)?.card.params[m[2]]?.default, value = prop(op, 'value');
    const a = Array.isArray(cur) ? cur.find(Number.isFinite) : cur, b = Array.isArray(value) ? value.find(Number.isFinite) : value;
    const factor = typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b) && a > 0 ? b / a : null;
    if (!factor || factor === 1) { rest.push(op); continue; }
    doc = scaleWorld(doc, registry, factor).doc; scaled.push({ space: space.id, factor: +factor.toFixed(3) });
  }
  return { doc, ops: rest, scaled };
}

/** The tweak option for the world's size (scaleWorld over the spaces' scale: 'world' params), when a space declares one. */
export const WORLD_SIZE = 'world_size';
/** The factors a world-size tweak may scale by. */
export const WORLD_FACTOR = Object.freeze({ min: 0.25, max: 4 });
const TWEAK_SYSTEM = `You turn a change request for a game into ONE parameter change, or "none". Pick the listed parameter whose declared effect carries out the request, and give its new value: for a number, the value itself within the listed range; for a switch, true or false; for ${WORLD_SIZE}, the factor the whole world is scaled by (${WORLD_FACTOR.min} to ${WORLD_FACTOR.max}). Answer "none" when no single listed parameter carries the request out (it needs content, a mechanic, or several changes).`;
const nul = (/** @type {Record<string, unknown>} */ t) => ({ anyOf: [t, { type: 'null' }] });

/**
 * tweakDocument(doc, request, { registry, writer, limits }) -> { doc, ops: [{ path, use, param, from, to }], matched, scaled?, ms, source }
 * See the header. Only parameter values change; never code, never content lists. `limits`: a template game's tune
 * slots and the ranges its template tunes them in (version-gate.js tuneLimits): only those are offered.
 * @param {Doc} input @param {unknown} request
 * @param {{ registry: RegistryLike, writer?: Writer | null, limits?: TweakLimits | null, attempts?: number }} options
 * @returns {Promise<{ doc: Doc, ops: TweakOp[], matched: boolean, scaled?: { factor: number, unscaled: unknown[] }, ms: number, source: string, asked?: Array<{ pick: string, problem?: string }> }>}
 */
export async function tweakDocument(input, request, { registry, writer = null, limits = null, attempts = 2 }) {
  const started = performance.now();
  const none = (/** @type {string} */ source, /** @type {Array<{ pick: string, problem?: string }>} */ asked = []) => ({ doc: input, ops: [], matched: false, ms: Math.round(performance.now() - started), source, asked });
  if (!writer?.complete) return none('no_model');
  const options = tweakOptions(input, registry, limits);
  const world = !limits && (input.spaces || []).some(sp => worldParams(registry, sp.use).length);
  const ids = [...options.map(o => o.path), ...(world ? [WORLD_SIZE] : [])];
  if (!ids.length) return none('no_params');
  const schema = { name: 'tweak_param', schema: { type: 'object', additionalProperties: false, required: ['param', 'number', 'flag', 'why'], properties: {
    param: { type: 'string', enum: [...ids, 'none'] }, number: nul({ type: 'number' }), flag: nul({ type: 'boolean' }), why: { type: 'string', description: 'one line' } } } };
  const line = (/** @type {TweakOption} */ o) => `- ${o.path} (${o.use}.${o.param}, ${o.schema.type}${o.min !== undefined || o.max !== undefined ? `, ${o.min ?? ''}..${o.max ?? ''}` : ''}${o.schema.unit ? ` ${o.schema.unit}` : ''}; now ${JSON.stringify(o.current)}): ${String(o.schema.effect || '').slice(0, 160)}`;
  const base = `Change request: ${String(request || '')}\n\nParameters:\n${options.map(line).join('\n')}${world ? `\n- ${WORLD_SIZE}: scale the whole world (its spaces' extent and what their generators build) by a factor` : ''}`;
  /** @type {Array<{ pick: string, problem?: string }>} */
  const asked = [];
  let problem = '';
  for (let i = 0; i < Math.max(1, attempts); i++) {
    /** @type {unknown} */
    let a;
    try { a = parseReply((await writer.complete({ system: TWEAK_SYSTEM, user: problem ? `${base}\n\nYour previous answer failed: ${problem}` : base, schema })).text); }
    catch (error) { problem = messageOf(error).slice(0, 160); asked.push({ pick: '', problem }); continue; }
    const pick = str(prop(a, 'param')), n = prop(a, 'number'), flag = prop(a, 'flag');
    if (pick === 'none') { asked.push({ pick }); return none(writer.model || 'model', asked); }
    if (pick === WORLD_SIZE && world) {
      if (typeof n !== 'number' || !Number.isFinite(n) || n < WORLD_FACTOR.min || n > WORLD_FACTOR.max || n === 1) { problem = `${WORLD_SIZE} needs a factor from ${WORLD_FACTOR.min} to ${WORLD_FACTOR.max}, not 1`; asked.push({ pick, problem }); continue; }
      const r = scaleWorld(input, registry, n);
      /** @type {TweakOp[]} */
      const ops = r.changes.map(c => ({ path: c.path, use: null, param: c.params.join(','), from: null, to: `×${n}` }));
      asked.push({ pick });
      if (!ops.length) return none(writer.model || 'model', asked);
      return { doc: r.doc, ops, matched: true, scaled: { factor: n, unscaled: r.unscaled }, ms: Math.round(performance.now() - started), source: 'scaleWorld', asked };
    }
    const o = options.find(x => x.path === pick);
    if (!o) { problem = `'${pick.slice(0, 80)}' is not a listed parameter`; asked.push({ pick, problem }); continue; }
    /** @type {number | boolean | undefined} */
    let to;
    if (o.schema.type === 'boolean') to = typeof flag === 'boolean' ? flag : undefined;
    else if (typeof n === 'number' && Number.isFinite(n) && (o.schema.type !== 'integer' || Number.isInteger(n)) && n >= (o.min ?? -Infinity) && n <= (o.max ?? Infinity)) to = n;
    if (to === undefined) { problem = `${o.path} needs ${o.schema.type === 'boolean' ? 'flag true or false' : `a${o.schema.type === 'integer' ? 'n integer' : ' number'} from ${o.min ?? '-∞'} to ${o.max ?? '∞'}`}`; asked.push({ pick, problem }); continue; }
    asked.push({ pick });
    if (to === o.current) return none(writer.model || 'model', asked);
    const doc = structuredClone(input);
    setPath(doc, o.path, to);
    return { doc, ops: [{ path: o.path, use: o.use, param: o.param, from: o.current, to }], matched: true, ms: Math.round(performance.now() - started), source: writer.model || 'model', asked };
  }
  return none(writer.model || 'model', asked);
}

// ---------- model revisions as targeted ops ----------
const OPS_SCHEMA_TEXT = `{ "ops": [ { "op": "set"|"add"|"remove", "path": "...", "value": ... } ], "unsupported": [ { "request": "...", "why": "..." } ], "summary": "..." }`;

/**
 * Resolve an identity-aware path: [n] indexes, [id] finds by id, then by `use` (instances). Returns { parent, key } or null.
 * A path through (or into) a scalar does not resolve.
 * @param {unknown} doc @param {unknown} path @param {{ create?: boolean }} [options] @returns {{ parent: Bag, key: Key } | null}
 */
export function resolvePath(doc, path, { create = false } = {}) {
  const parts = String(path).match(/[^.[\]]+|\[[^\]]+\]/g) || [];
  /** @type {unknown} */
  let o = doc;
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i], sel = raw.startsWith('[') ? raw.slice(1, -1) : null, last = i === parts.length - 1;
    /** @type {Key} */
    let key = raw;
    if (sel !== null) {
      if (!Array.isArray(o)) return null;
      key = /^\d+$/.test(sel) ? Number(sel) : o.findIndex(x => prop(x, 'id') === sel) >= 0 ? o.findIndex(x => prop(x, 'id') === sel) : o.findIndex(x => prop(x, 'use') === sel);
      if (key < 0) return null;
    }
    if (!isBag(o)) return null;
    if (last) return { parent: o, key };
    if (o[key] === undefined) { if (!create) return null; o[key] = {}; }
    o = o[key];
  }
  return null;
}

/**
 * Apply model-written ops to a copy of the document. The result is draft data (repair and preflight it).
 * @param {unknown} input @param {unknown} ops
 * @returns {{ doc: unknown, applied: Record<string, unknown>[], failed: Record<string, unknown>[] }}
 */
export function applyOps(input, ops) {
  const doc = structuredClone(input);
  /** @type {Record<string, unknown>[]} */
  const applied = [], failed = [];
  for (const raw of Array.isArray(ops) ? ops : []) {
    const op = obj(raw);
    const at = resolvePath(doc, op.path, { create: op.op !== 'remove' });
    if (!at) { failed.push({ ...op, why: 'path not found' }); continue; }
    const { parent, key } = at;
    // Setting an index past the end of a list appends (never leaves holes in the list).
    if (op.op === 'set') { if (Array.isArray(parent) && typeof key === 'number' && key >= parent.length) parent.push(structuredClone(op.value)); else parent[key] = structuredClone(op.value); applied.push(op); }
    else if (op.op === 'add') {
      if (parent[key] === undefined) parent[key] = Array.isArray(op.value) ? [] : {};
      const target = parent[key];
      if (Array.isArray(target)) { target.push(...(Array.isArray(op.value) ? structuredClone(op.value) : [structuredClone(op.value)])); applied.push(op); }
      else if (target && typeof target === 'object' && op.value && typeof op.value === 'object') { Object.assign(target, structuredClone(op.value)); applied.push(op); }
      else failed.push({ ...op, why: 'add needs a list or object' });
    } else if (op.op === 'remove') {
      if (!Array.isArray(parent)) delete parent[key];
      else if (/^\d+$/.test(String(key))) parent.splice(Number(key), 1);
      else { failed.push({ ...op, why: 'path not found' }); continue; } // a name is not a list index
      applied.push(op);
    }
    else failed.push({ ...op, why: `unknown op '${op.op}'` });
  }
  return { doc, applied, failed };
}

/**
 * The document a revision is written against: its fields and instances, and only the plot and content sections a
 * primitive it uses reads (card.reads), or the kernel (archetypes). @param {Doc} doc @param {RegistryLike} registry
 */
export function declaredDocument(doc, registry) {
  const reads = new Set(['content.archetypes', ...instancesOf(doc).flatMap(({ inst }) => list(registry.get(inst.use)?.card.reads).filter(r => typeof r === 'string'))]);
  const read = (/** @type {string} */ key) => [...reads].some(r => key === r || key.startsWith(`${r}.`));
  /** @type {Record<string, unknown>} */
  const out = { ...doc };
  for (const root of /** @type {const} */ (['plot', 'content'])) {
    const sec = doc[root];
    if (!isObj(sec)) continue;
    out[root] = Object.fromEntries(Object.entries(sec).filter(([k]) => (root === 'plot' && k === 'premise') || read(`${root}.${k}`)));
  }
  return out;
}

/** @param {RegistryLike} registry @param {LogicLike} logic @param {Doc} doc @returns {string} */
export function reviseSystem(registry, logic, doc) {
  const v = vocabulary(logic), used = new Set([...doc.spaces.map(s => s.use), ...(doc.systems || []).map(s => s.use), ...(doc.graphics || []).map(g => g.use)]);
  return `You make one targeted change to a game document (schema ${doc.schema}), as a list of ops:
${OPS_SCHEMA_TEXT}
Paths are dotted with selectors: [n] is an index, [id] selects by id (or, for spaces/systems/graphics, by primitive "use"). Examples:
  {"op":"set","path":"systems[gameplay.inventory].with.slots","value":12}
  {"op":"add","path":"content.items","value":{"id":"lamp","name":"Lamp"}}
  {"op":"add","path":"plot.storyboard.acts[act_1].beats","value":{"id":"x","when":{"zone":"hall"},"do":[...]}}
  {"op":"set","path":"spaces[manor].zones[hall].name","value":"Great Hall"}
  {"op":"add","path":"systems","value":{"use":"<primitive id from the catalogue>","with":{}}}
Rules:
- Change only what the request asks; everything else stays exactly as it is. Never remove content unless the request asks for fewer or removal.
- Don't change graphics or content.models unless the request is about looks.
- Mechanics come only from catalogue primitives. If the request needs a mechanic no primitive provides, list it in "unsupported" with a short why and don't fake it (renaming or restyling is not the mechanic).
- Predicates: ${v.predicates.join(', ')}. Effects: ${v.effects.join(', ')}.
Primitives in this game:
${[...used].flatMap(id => { const p = registry.get(id); return p ? [cardText({ id, ...p.card }, { full: true })] : []; }).join('\n')}
Other primitives:
${registry.cards().filter(c => !used.has(c.id)).map(c => cardText(c)).join('\n') || '(none)'}
Shapes of the sections the game's primitives read:
${dataShapes(registry, [...used]).join('\n')}`;
}

/**
 * A writer proposes ops for one change. `ops` and `unsupported` are model output: applyOps narrows each op;
 * `unsupported` keeps only object entries ({ request, why } when well formed).
 * @param {{ writer: Writer, doc: Doc, change: string, registry: RegistryLike, logic: LogicLike, errors?: string | null, previous?: unknown }} request
 * @returns {Promise<{ ops: unknown[], unsupported: Unsupported[], summary: string, ms: number, model: string }>}
 */
export async function reviseDocument({ writer, doc, change, registry, logic, errors = null, previous = null }) {
  // The document as its declarations make it: every instance, and the plot and content sections a primitive it uses
  // reads (card.reads; the kernel's archetypes). Nothing is cut: a section no primitive reads is no part of the game.
  const user = `Document:\n${JSON.stringify(declaredDocument(doc, registry))}\n\nChange request: ${change}${errors ? `\n\nYour previous ops produced a document that failed checks:\n${errors}\nPrevious ops: ${JSON.stringify(previous).slice(0, 6000)}\nReturn corrected ops.` : ''}`;
  const reply = await writer.complete({ system: reviseSystem(registry, logic, doc), user });
  const out = obj(parseReply(reply.text));
  return { ops: Array.isArray(out.ops) ? out.ops : [], unsupported: list(out.unsupported).slice(0, 6).filter(/** @returns {u is Unsupported} */ u => isObj(u)), summary: String(out.summary || '').slice(0, 300), ms: reply.ms, model: reply.model };
}

/** @param {Doc} doc */
const artOf = doc => ({ graphics: doc.graphics || [], models: doc.content?.models || {}, art: doc.art || null });

/**
 * Review of a change (one place for every revision guard). The user's request is the authority:
 * a change is blocked only when the changed game cannot run (invalid document, or the playtest crashes).
 * Everything else the review notices is a note on the published version, never a refusal:
 * - content the request didn't ask to remove; look changes on a request that isn't about looks;
 * - a game that could be finished and no longer provably can;
 * - the decision model doubting the request was fully carried out.
 * -> { block: null | { code, message }, notes: [string], dropped, artChanged, revisionCheck, changes, diff, lines }
 * `verifyBefore` / `verifyAfter` are verifyDocument results (any object with these fields).
 * @param {{ before: Doc, after: Doc, change: string, decisions?: Decisions | null, unsupported?: unknown[], verifyBefore?: ReviewVerification | null, verifyAfter?: ReviewVerification | null }} review
 * @returns {Promise<ChangeReview>}
 */
export async function reviewChange({ before, after, change, decisions = null, unsupported = [], verifyBefore = null, verifyAfter = null }) {
  /** @type {string[]} */
  const notes = [];
  /** @type {{ code: string, message: string } | null} */
  let block = null;
  if (verifyAfter && !verifyAfter.ok) block = { code: 'invalid', message: 'The changed game failed its document checks.' };
  else if (verifyAfter && verifyAfter.viable === false) block = { code: 'not_playable', message: `That change leaves a game that crashes: ${verifyAfter.viability}` };
  const shrunk = [...shrunkLists(before.plot || {}, after.plot || {}, 'plot'), ...shrunkLists(before.content || {}, after.content || {}, 'content'), ...shrunkLists({ spaces: before.spaces, systems: before.systems }, { spaces: after.spaces, systems: after.systems })];
  const dropped = shrunk.length && !(await asksToRemove(decisions, change, shrunk)) ? shrunk : [];
  if (dropped.length) notes.push(`removed ${dropped.map(d => d.path).join(', ')}`);
  const artChanged = JSON.stringify(artOf(before)) !== JSON.stringify(artOf(after));
  if (artChanged) notes.push('changed the look (graphics or models)');
  if (verifyBefore && verifyAfter && regressed(verifyBefore, verifyAfter)) notes.push('the game could be finished before this change and no longer provably can');
  const diff = contentDiff(strip(before), strip(after));
  const revisionCheck = await checkRevision(decisions, { change, engine: 'gameverse kernel document', before: strip(before), after: strip(after), unsupported });
  if (revisionCheck?.notApplied) notes.push('the checker is not sure the change fully does what was asked');
  return { block, notes, dropped, artChanged, revisionCheck, changes: changeSummary(diff), diff: diff.length, lines: diff.slice(0, 20) };
}
/** Kept for callers of the old name: a review without verification results. @param {Parameters<typeof reviewChange>[0]} args */
export const guardRevision = args => reviewChange(args).then(r => ({ ...r, ok: true }));
/** @param {Doc} doc */
const strip = doc => { const { experiments, ...rest } = doc; return rest; };
