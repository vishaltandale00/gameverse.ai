// @ts-check
// The schema sampler (ARCHITECTURE.md §1.4, §6.2): catalogue conformance of the card-derived forms. For every card it
// samples answers its forms allow — the strict schema of each param (outline-form strictSpec, the derivation every
// model form uses), of each component it owns (card.components) and of each document section it declares (card.data
// over the kernel's base shapes, kernel/sections.js) — writes each one alone into a document hosting the card, and
// preflights it. An answer a form allows must pass preflight and every validate, except for the cross-field rules the
// cards declare (card.rules): those are what repair re-asks. A finding is a defect of the form's derivation or of a
// declaration:
//   form_rejected      a value the form allows fails a kernel schema check at the field the form wrote (the form allows
//                      what the shape rejects)
//   rule_undeclared    a primitive emits a code its card does not declare (kernel/rules.js)
//   validator_crashed  a validate throws on a value the form allows
//   example_invalid    a declared rule example (card.rules[code].example) is not an answer the forms allow, or does not
//                      emit its code
// and every declared rule must be reachable: some form-allowed answer (or its declared example) emits it
// (rule_unreached). Hosts are derived, never listed: a template document using the card, else the first template
// document to which the card and the primitives it requires (bundles.js requiredBy) can be added without a new
// structural problem.
import { preflight } from '../kernel/document.js';
import { rulesOf, KERNEL_CODES } from '../kernel/rules.js';
import { sectionShape, ID_PATTERN } from '../kernel/sections.js';
import { strictSpec, decode, answerProblems } from './outline-form.js';
import { docRefs } from './content.js';
import { instancesWithPaths } from './templates.js';
import { requiredBy } from './bundles.js';
import { isSpace, isGenerator, isGraphics } from './catalog.js';
import { isObj, isStr, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('../kernel/types.js').ParamSchema} ParamSchema */
/** @typedef {import('./outline-form.js').RefContext} RefContext */
/** A finding. @typedef {{ code: string, use: string, form: string, field: string, value: string, path: string, message: string }} Finding */
/** A card's sampling. @typedef {{ id: string, host: string | null, samples: number, findings: Finding[], reached: string[], unreached: string[], unhosted?: string }} CardSampling */

export const SAMPLER_VERSION = 'schema-sampler/0.1';
export const SAMPLER_CODES = Object.freeze(['form_rejected', 'rule_undeclared', 'validator_crashed', 'example_invalid', 'rule_unreached', 'card_unhosted']);
const KERNEL = new Set(KERNEL_CODES);
/** Kernel codes of rules across entries a form cannot express (two entries one id): declared by the kernel's indexes. */
const ACROSS = new Set(['id_duplicate']);
/** Structural preflight codes: a host that has one of them does not host the card. */
const STRUCTURAL = new Set(['capability_missing', 'service_missing', 'requires_unmet', 'primitive_conflict', 'adapter_from_mismatch', 'primitive_unknown', 'primitive_slot', 'schema']);

/**
 * The values a strict schema allows, as samples: each enum value, both booleans, a number's bounds and middle (and
 * values past an open end), lists empty (when allowed), of one, of the most entries allowed; an object from its first
 * sample, each field varied alone. At most `limit` values.
 * @param {Record<string, any>} s @param {number} [limit] @param {number} [depth] @returns {unknown[]}
 */
export function formValues(s, limit = 16, depth = 0) {
  /** @param {unknown} x @returns {Record<string, any>} */
  const node = x => (isObj(x) ? x : {});
  const cap = (/** @type {unknown[]} */ v) => v.slice(0, limit);
  if (!isObj(s)) return [];
  if (Array.isArray(s.anyOf)) return cap(s.anyOf.flatMap(x => formValues(x, limit, depth)));
  if (s.type === 'null') return [null];
  if (Array.isArray(s.enum)) return cap([...s.enum]);
  if (s.type === 'boolean') return [false, true];
  if (s.type === 'integer' || s.type === 'number') {
    const lo = typeof s.minimum === 'number' ? s.minimum : null, hi = typeof s.maximum === 'number' ? s.maximum : null;
    const round = (/** @type {number} */ v) => (s.type === 'integer' ? Math.round(v) : v);
    const a = lo ?? (hi !== null ? hi - 1000 : -1000), b = hi ?? (lo !== null ? lo + 1000 : 1000);
    return [...new Set([a, b, round((a + b) / 2), ...(lo === null ? [-1e6] : []), ...(hi === null ? [1e6] : []), 0, 1].filter(v => (lo === null || v >= lo) && (hi === null || v <= hi)).map(round))];
  }
  if (s.type === 'string') {
    if (typeof s.pattern === 'string') { const re = new RegExp(s.pattern, 'u'); return ['sampled', 'x', 'a_b-1'].filter(v => re.test(v)).slice(0, 2); }
    return ['', 'sampled'];
  }
  if (s.type === 'array') {
    const inner = formValues(node(s.items), limit, depth + 1);
    const min = typeof s.minItems === 'number' ? s.minItems : 0, max = typeof s.maxItems === 'number' ? s.maxItems : Math.max(min, 3);
    const of = (/** @type {number} */ n, /** @type {number} */ k) => Array.from({ length: n }, (_, i) => inner[(i + k) % Math.max(1, inner.length)]);
    if (!inner.length) return min === 0 ? [[]] : [];
    const out = [...(min === 0 ? [[]] : []), of(Math.max(1, min), 0), of(max, 1)];
    for (let k = 1; k < inner.length && out.length < limit; k++) out.push(of(Math.max(1, min), k));
    return cap(out.filter(v => v.length >= min && v.length <= max));
  }
  if (s.type === 'object') {
    const props = Object.entries(isObj(s.properties) ? s.properties : {});
    /** @type {Record<string, unknown>} */
    const base = Object.fromEntries(props.map(([k, p]) => [k, formValues(node(p), limit, depth + 1)[0] ?? null]));
    /** @type {unknown[]} */
    const out = [base];
    if (depth < 3) for (const [k, p] of props) for (const v of formValues(node(p), limit, depth + 1).slice(1)) { if (out.length >= limit * 2) break; out.push({ ...base, [k]: v }); }
    return out;
  }
  return [];
}


/**
 * A card's params as its forms ask them: each declared param, a list that defines a reference kind (card.defines `in`)
 * with its entries' ids held to the kernel's id rule.
 * @param {Record<string, any>} card @returns {Record<string, ParamSchema>}
 */
export function formParams(card) {
  /** @type {Record<string, ParamSchema>} */
  const out = { ...(card.params || {}) };
  for (const d of card.defines || []) {
    const spec = d.in ? out[d.in] : undefined;
    if (spec?.type === 'list' && spec.of?.type === 'object') out[d.in] = { ...spec, of: { ...spec.of, fields: { ...spec.of.fields, id: { ...(spec.of.fields?.id ?? { type: 'string' }), pattern: ID_PATTERN, required: true } } } };
  }
  return out;
}

/** Every primitive a document instantiates. @param {Record<string, any>} doc */
const usesOf = doc => new Set([...instancesWithPaths(doc).map(x => String(x.inst.use)), ...(Array.isArray(doc.graphics) ? doc.graphics.map((/** @type {any} */ g) => String(g.use)) : [])]);

/**
 * A document hosting `id` (see the header), with the path of the card's instance, or why there is none.
 * @param {string} id @param {ReadonlyArray<{ id: string, doc: Record<string, any> }>} corpus @param {RegistryLike} registry @param {LogicLike} logic
 * @returns {{ host: string, doc: Record<string, any>, path: string } | { host: null, why: string }}
 */
export function hostFor(id, corpus, registry, logic) {
  const own = corpus.find(c => usesOf(c.doc).has(id));
  if (own) {
    const at = instancesWithPaths(own.doc).find(x => x.inst.use === id)?.path ?? (own.doc.graphics || []).findIndex((/** @type {any} */ g) => g.use === id);
    return { host: own.id, doc: structuredClone(own.doc), path: typeof at === 'number' ? `graphics[${at}]` : at };
  }
  let why = 'no template document';
  for (const c of corpus) {
    const doc = structuredClone(c.doc);
    const add = [id, ...requiredBy(registry, [id], [...usesOf(doc)]).map(x => x.id)];
    // A service the card requires that no primitive of the document provides: the first catalogue card (by id) providing it.
    const services = new Set([...usesOf(doc), ...add].flatMap(u => registry.get(u)?.card.provides?.services || []));
    for (const sv of registry.get(id)?.card.requires?.services || []) {
      if (services.has(sv)) continue;
      const by = registry.ids().find(x => (registry.get(x)?.card.provides?.services || []).includes(sv));
      if (by) { add.push(by, ...requiredBy(registry, [by], [...usesOf(doc), ...add]).map(x => x.id)); for (const s2 of registry.get(by)?.card.provides?.services || []) services.add(s2); }
    }
    let path = '';
    for (const a of add) {
      let at = '';
      if (isSpace(a)) { doc.spaces.push({ id: `sampled_${doc.spaces.length}`, use: a }); at = `spaces[${doc.spaces.length - 1}]`; }
      else if (isGenerator(a)) {
        const space = (registry.get(a)?.card.spaces || [])[0];
        if (!space) { why = `${a} declares no space it fills (card.spaces)`; continue; }
        doc.spaces.push({ id: `sampled_${doc.spaces.length}`, use: space, generators: [{ use: a }] }); at = `spaces[${doc.spaces.length - 1}].generators[0]`;
      } else if (isGraphics(a)) { (doc.graphics ||= []).push({ use: a }); at = `graphics[${doc.graphics.length - 1}]`; }
      else { doc.systems.push({ use: a }); at = `systems[${doc.systems.length - 1}]`; }
      if (a === id) path = at;
    }
    const before = new Set(preflight(structuredClone(c.doc), registry, logic).errors.map(e => `${e.code}|${e.path}`));
    const fresh = preflight(structuredClone(doc), registry, logic).errors.filter(e => STRUCTURAL.has(e.code) && !before.has(`${e.code}|${e.path}`));
    if (!fresh.length && path) return { host: `${c.id}+${id}`, doc, path };
    why = fresh.slice(0, 2).map(e => `${e.code}: ${e.message}`).join('; ') || why;
  }
  return { host: null, why };
}

/** @param {unknown} v */
const shown = v => (JSON.stringify(v) ?? String(v)).slice(0, 120);
/** @param {Record<string, any>} doc @param {string} path @returns {Record<string, any>} */
const instanceAt = (doc, path) => {
  const m = /^graphics\[(\d+)\]$/.exec(path);
  return m ? doc.graphics[Number(m[1])] : /** @type {Record<string, any>} */ (instancesWithPaths(doc).find(x => x.path === path)?.inst);
};

/**
 * One card's sampling (see the header): its params on its host instance, its components on a probe archetype, its data
 * sections' entries, each value alone; codes seen and findings. `limit` caps the values per field.
 * @param {string} id @param {{ corpus: ReadonlyArray<{ id: string, doc: Record<string, any> }>, registry: RegistryLike, logic: LogicLike, limit?: number }} ctx
 * @returns {CardSampling}
 */
export function sampleCard(id, { corpus, registry, logic, limit = 12 }) {
  const card = /** @type {Record<string, any>} */ (registry.get(id)?.card);
  const hosted = hostFor(id, corpus, registry, logic);
  if (!hosted.host) return { id, host: null, samples: 0, findings: [], reached: [], unreached: rulesOf(card).map(r => r.code), unhosted: /** @type {any} */ (hosted).why };
  const { doc: base, path } = /** @type {{ host: string, doc: Record<string, any>, path: string }} */ (hosted);
  const pre = preflight(structuredClone(base), registry, logic);
  const before = new Set([...pre.errors, ...pre.warnings].map(e => `${e.code}|${e.path}`));
  const reached = new Set();
  /** @type {Finding[]} */
  const findings = [];
  let samples = 0;
  /** @param {string} form @param {string} field @param {string} at the document path the form wrote @param {unknown} value @param {(d: Record<string, any>) => void} write */
  const tryValue = (form, field, at, value, write) => {
    const d = structuredClone(base);
    write(d);
    samples++;
    const r = preflight(d, registry, logic);
    // The declaration checks report as warnings until the catalogue's declarations are complete (document.js DECLARATIONS_ENFORCED).
    for (const e of [...r.errors, ...r.warnings.filter(w => w.code === 'rule_undeclared' || KERNEL.has(w.code))]) {
      if (before.has(`${e.code}|${e.path}`)) continue;
      const mine = e.path === at || e.path.startsWith(`${at}.`) || e.path.startsWith(`${at}[`);
      const finding = (/** @type {string} */ code) => findings.push({ code, use: id, form, field, value: shown(value), path: e.path, message: `${e.code}: ${e.message}`.slice(0, 240) });
      if (e.code === 'rule_undeclared') finding('rule_undeclared');
      else if (e.code === 'validator_crashed') finding('validator_crashed');
      else if (KERNEL.has(e.code)) { if (mine && !ACROSS.has(e.code)) finding('form_rejected'); }
      else reached.add(e.code);
    }
  };
  const refs = docRefs(registry, base);
  // Params: each value of each param's strict schema, alone on the card's instance.
  for (const [k, spec] of Object.entries(formParams(card))) {
    const s = strictSpec(spec, 1, refs);
    if (!s) continue;
    for (const v of formValues(spec.required ? s.schema : { anyOf: [s.schema, { type: 'null' }] }, limit)) {
      const value = decode(v, s.codec);
      tryValue('params', k, `${path}.with.${k}`, value, d => { const inst = instanceAt(d, path); inst.with = { ...(isObj(inst.with) ? inst.with : {}) }; if (value === undefined) delete inst.with[k]; else inst.with[k] = value; });
    }
  }
  // Components: each value of each component the card owns, on a probe archetype of its own.
  for (const [k] of Object.entries(card.components || {})) {
    const shape = sectionShape(registry, usesOf(base), 'content.archetypes').shape;
    const spec = prop(prop(prop(prop(shape, 'of'), 'fields'), 'components'), 'fields');
    const s = strictSpec(prop(spec, k), 1, refs);
    if (!s) continue;
    for (const v of formValues(s.schema, limit)) {
      const value = decode(v, s.codec);
      const at = `content.archetypes[${(base.content?.archetypes || []).length}].components.${k}`;
      tryValue('components', k, at, value, d => { d.content ||= {}; d.content.archetypes = [...(d.content.archetypes || []), { id: 'sampled_probe', name: 'Probe', components: { [k]: value } }]; });
    }
  }
  // Data: each value of an entry of each section the card declares, as the section's first entry.
  for (const section of Object.keys(card.data || {})) {
    const shape = sectionShape(registry, usesOf(base), section).shape;
    if (!shape) continue;
    const entry = shape.type === 'list' ? shape.of : shape.values;
    const s = strictSpec(entry, 1, refs);
    if (!s) continue;
    const [root, key] = section.split('.');
    for (const v of formValues(s.schema, limit)) {
      const value = decode(v, s.codec);
      const at = shape.type === 'list' ? `${section}[0]` : `${section}.sampled`;
      tryValue('data', section, at, value, d => {
        d[root] ||= {};
        const cur = d[root][key];
        if (shape.type === 'list') d[root][key] = [value, ...(Array.isArray(cur) ? cur.slice(1) : [])];
        else d[root][key] = { ...(isObj(cur) ? cur : {}), sampled: value };
      });
    }
  }
  // Declared rule examples (card.rules[code].example): a document fragment merged into the card's host document
  // ({ doc, at? }: for logic-written fields, fields deeper than the forms, open maps and cross-instance rules), or
  // values the forms allow, written together ({ <param>: v, 'content.<x>': entries, 'components.<name>': v }). Proven
  // when preflight reports exactly that code (at `at` when declared).
  for (const rule of rulesOf(card)) {
    const example = /** @type {Record<string, unknown> | undefined} */ (prop(prop(card.rules, rule.code), 'example'));
    if (!isObj(example)) continue;
    const fragment = isFragment(example);
    const bad = fragment ? [] : exampleProblems(card, example, base, registry, refs);
    if (bad.length) { for (const m of bad) findings.push({ code: 'example_invalid', use: id, form: 'rules', field: rule.code, value: shown(example), path: '', message: m }); continue; }
    const d = structuredClone(base);
    if (fragment) mergeFragment(d, /** @type {Record<string, any>} */ (example.doc)); else writeExample(d, path, example);
    samples++;
    const r = preflight(d, registry, logic);
    const fresh = [...r.errors, ...r.warnings].filter(e => !before.has(`${e.code}|${e.path}`) && e.code !== 'data_unused');
    for (const e of fresh) if (!KERNEL.has(e.code) && e.code !== 'rule_undeclared') reached.add(e.code);
    const codes = [...new Set(fresh.map(e => e.code))];
    const where = isStr(example.at) ? fresh.some(e => e.code === rule.code && e.path === example.at) : true;
    if (codes.length !== 1 || codes[0] !== rule.code || !where) findings.push({ code: 'example_invalid', use: id, form: 'rules', field: rule.code, value: shown(example), path: '', message: `the example emits ${fresh.map(e => `${e.code} at ${e.path}`).join('; ').slice(0, 300) || 'nothing'}, not exactly ${rule.code}${isStr(example.at) ? ` at ${example.at}` : ''}` });
  }
  const declared = rulesOf(card).map(r => r.code);
  return { id, host: hosted.host, samples, findings, reached: [...reached].sort(), unreached: declared.filter(c => !reached.has(c)) };
}

/** An example that is a document fragment: { doc, at? }. @param {Record<string, unknown>} example */
const isFragment = example => isObj(example.doc) && Object.keys(example).every(k => k === 'doc' || k === 'at');

/**
 * Merge a document fragment into a document: each top-level section the fragment names (systems, spaces, graphics,
 * content, plot, player, ...) replaces that section; the sections it does not name are kept. An example writes the whole
 * section it means (one instance with the field, or two instances for a cross-instance rule).
 * @param {Record<string, any>} target @param {Record<string, any>} fragment
 */
export function mergeFragment(target, fragment) {
  for (const [k, v] of Object.entries(fragment)) target[k] = structuredClone(v);
}

/** Where an example's key writes: a param of the instance, a section path, or 'components.<name>' (a probe archetype's). @param {string} key */
const exampleTarget = key => (key.startsWith('components.') ? 'component' : /^(content|plot)\.[A-Za-z0-9_]+$/.test(key) ? 'section' : 'param');

/** @param {Record<string, any>} d @param {string} path @param {Record<string, unknown>} example */
function writeExample(d, path, example) {
  const inst = instanceAt(d, path);
  for (const [k, v] of Object.entries(example)) {
    const t = exampleTarget(k);
    if (t === 'param') inst.with = { ...(isObj(inst.with) ? inst.with : {}), [k]: structuredClone(v) };
    else if (t === 'component') { d.content ||= {}; d.content.archetypes = [...(d.content.archetypes || []), { id: 'sampled_probe', name: 'Probe', components: { [k.slice('components.'.length)]: structuredClone(v) } }]; }
    else { const [root, key] = k.split('.'); d[root] ||= {}; d[root][key] = structuredClone(v); }
  }
}

/**
 * Why an example is not one the forms allow: each param value against its strict schema, each section against its
 * entries' strict schema, each component against its owner's. -> messages
 * @param {Record<string, any>} card @param {Record<string, unknown>} example @param {Record<string, any>} doc @param {RegistryLike} registry @param {RefContext} refs
 */
function exampleProblems(card, example, doc, registry, refs) {
  const out = [];
  const params = formParams(card);
  for (const [k, v] of Object.entries(example)) {
    const t = exampleTarget(k);
    /** @type {unknown} */
    let spec;
    if (t === 'param') spec = params[k];
    else if (t === 'component') spec = prop(prop(prop(prop(prop(sectionShape(registry, usesOf(doc), 'content.archetypes').shape, 'of'), 'fields'), 'components'), 'fields'), k.slice('components.'.length));
    else spec = sectionShape(registry, usesOf(doc), k).shape;
    const s = strictSpec(spec, 1, refs);
    if (!s) { out.push(`${k}: no form asks for it (its declaration has no strict shape)`); continue; }
    for (const p of answerProblems(s.schema, v)) out.push(`${k}${p.path ? `.${p.path}` : ''}: ${p.message}`);
  }
  return out;
}

/**
 * The sampler's probe: an ambient stand-in whose declared params take every kernel shape (a ranged number, a closed
 * set, a pattern, a reserved value, a list with a minimum, a ref, a list defining a kind, a predicate, effects), so each
 * kernel code and each vocabulary kind's declared example can be preflighted in a document. Never in a game: the
 * conformance builds its catalogue with it.
 */
export const PROBE = Object.freeze({
  id: 'engine.sampler.probe',
  card: { intent: 'The schema sampler\'s probe: params of every kernel shape, to preflight declared examples in a document.', ambient: true,
    params: { req: { type: 'boolean', required: true }, n: { type: 'integer', min: 0, max: 4, multipleOf: 2 }, s: { type: 'string', options: ['a', 'b'] }, p: { type: 'string', pattern: '^[a-z]+$', reserved: ['player'] },
      l: { type: 'list', min: 1, of: { type: 'number' } }, r: { type: 'ref', to: 'archetype' }, entries: { type: 'list', of: { type: 'object', fields: { id: { type: 'string', required: true } } } },
      j: { type: /** @type {any} */ ('unknown_type') }, crash: { type: 'boolean' }, when: { type: 'predicate' }, do: { type: 'effects' } },
    defines: [{ kind: 'sampled_entry', in: 'entries' }], provides: {}, requires: {} },
  /** @param {Record<string, any>} config */
  validate(config) { if (config.crash) throw Error('the probe crashes when asked to'); return []; },
});

/**
 * The declared example of every kernel code (kernel/rules.js KERNEL_CODES): the probe's `with` that emits exactly it,
 * or the template change that does.
 */
export const KERNEL_EXAMPLES = Object.freeze({
  param_type: { with: { req: true, n: 'two' } }, param_range: { with: { req: true, n: 3 } }, param_option: { with: { req: true, s: 'c' } }, param_unknown: { with: { req: true, zz: 1 } },
  param_missing: { with: {} }, param_reserved: { with: { req: true, p: 'player' } }, param_pattern: { with: { req: true, p: 'A1' } }, schema_invalid: { with: { req: true, j: 1 } },
  ref_unknown: { with: { req: true, r: 'no_such_archetype' } }, id_invalid: { with: { req: true, entries: [{ id: 'Not A Slug' }] } }, id_duplicate: { with: { req: true, entries: [{ id: 'a' }, { id: 'a' }] } },
  predicate_unknown: { with: { req: true, when: { no_such_kind: 1 } } }, predicate_invalid: { with: { req: true, when: { all: [] } } },
  effect_unknown: { with: { req: true, do: [{ do: 'no_such_effect' }] } }, effect_invalid: { with: { req: true, do: [{ do: 'emit' }] } },
  event_ref_type: { with: { req: true, when: { count: 3, gte: 1 } } }, validator_crashed: { with: { req: true, crash: true } },
});

/**
 * The declared examples of the kernel's codes and of every vocabulary kind's codes (logic.predicate/effect(kind,
 * { codes })), each preflighted in a document: the template hosting the kind's owner (kernel kinds: the first template)
 * with the probe carrying the example. Each must emit exactly its code. -> { checked, findings }
 * @param {{ corpus: ReadonlyArray<{ id: string, doc: Record<string, any> }>, registry: RegistryLike, logic: LogicLike }} ctx
 */
export function sampleExamples({ corpus, registry, logic }) {
  /** @type {Finding[]} */
  const findings = [];
  let checked = 0;
  /** @param {Record<string, any>} doc @param {Record<string, unknown>} w @param {string} code @param {string} use @param {string} field @param {Record<string, any> | null} [fragment] */
  const prove = (doc, w, code, use, field, fragment = null) => {
    const base = structuredClone(doc);
    (base.systems ||= []).push({ use: PROBE.id, with: { req: true } });
    const before = preflight(structuredClone(base), registry, logic);
    const seen = new Set([...before.errors, ...before.warnings].map(e => `${e.code}|${e.path}`));
    const d = structuredClone(base);
    d.systems[d.systems.length - 1].with = structuredClone(w);
    if (fragment) mergeFragment(d, fragment);
    const r = preflight(d, registry, logic);
    const fresh = [...new Set([...r.errors, ...r.warnings].filter(e => !seen.has(`${e.code}|${e.path}`) && e.code !== 'data_unused').map(e => e.code))];
    checked++;
    if (fresh.length !== 1 || fresh[0] !== code) findings.push({ code: 'example_invalid', use, form: 'example', field, value: shown(w), path: '', message: `the example of ${code} emits ${fresh.join(', ') || 'nothing'}` });
  };
  const first = corpus[0]?.doc;
  if (!first) return { checked, findings: [{ code: 'card_unhosted', use: PROBE.id, form: 'example', field: '', value: '', path: '', message: 'no template document' }] };
  for (const [code, ex] of Object.entries(KERNEL_EXAMPLES)) prove(first, ex.with, code, 'kernel', code);
  for (const code of KERNEL_CODES) if (!(code in KERNEL_EXAMPLES)) findings.push({ code: 'rule_unreached', use: 'kernel', form: 'example', field: code, value: '', path: '', message: `the kernel code ${code} has no declared example` });
  for (const type of /** @type {const} */ (['predicate', 'effect'])) {
    for (const [kind, def] of (type === 'predicate' ? logic.predicates : logic.effects)) {
      const owner = logic.owners?.[type]?.get(kind) ?? 'kernel';
      const host = owner === 'kernel' || !registry.has(owner) ? { host: 'kernel', doc: first } : hostFor(owner, corpus, registry, logic);
      for (const c of Array.isArray(def.codes) ? def.codes : []) {
        if (!host.host) { findings.push({ code: 'card_unhosted', use: owner, form: 'example', field: `${kind}.${c.code}`, value: '', path: '', message: /** @type {any} */ (host).why }); continue; }
        if (isObj(c.example) && isFragment(c.example)) prove(/** @type {any} */ (host).doc, { req: true }, c.code, owner, `${type} ${kind}`, /** @type {any} */ (c.example).doc);
        else prove(/** @type {any} */ (host).doc, type === 'predicate' ? { req: true, when: c.example } : { req: true, do: [c.example] }, c.code, owner, `${type} ${kind}`);
      }
    }
  }
  return { checked, findings };
}

/**
 * Sample every card of the registry (or `ids`). Codes a card's sampling reached count for every card that declares
 * them (a rule of one card is often reached through another card's form). -> { cards, findings, unreached }
 * @param {{ corpus: ReadonlyArray<{ id: string, doc: Record<string, any> }>, registry: RegistryLike, logic: LogicLike, ids?: string[], limit?: number }} ctx
 */
export function sampleCatalogue({ corpus, registry, logic, ids = registry.ids(), limit }) {
  const cards = ids.filter(id => id !== PROBE.id).map(id => sampleCard(id, { corpus, registry, logic, limit }));
  const reached = new Set(cards.flatMap(c => c.reached));
  const unreached = cards.flatMap(c => c.unreached.filter(code => !reached.has(code)).map(code => ({ use: c.id, code })));
  return { cards, findings: cards.flatMap(c => c.findings), unreached, unhosted: cards.filter(c => !c.host).map(c => ({ use: c.id, why: c.unhosted })) };
}
