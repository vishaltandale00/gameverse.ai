// @ts-check
// The template path (ARCHITECTURE.md §5): one strict model call picks the templates and relations the idea names,
// code composes the primary template's verified document, and parallel strict content forms derived from that
// document theme its named entries and set its declared `tune` params. Every answer is checked; a failing form
// re-asks only its failing fields, then that form alone goes once to the escalation writer, then the build fails
// saying what is wrong. Nothing here reads the idea's words: structure comes from the templates' documents and the
// cards in them, judgement from the model's small checked choices.
import { specSchema, decode, fieldForm, formKey, answerProblems, obj as strictObj, arr as strictArr } from './outline-form.js';
import { cardLoop } from './loop.js';
import { modesIn } from '../primitives/gameplay/modes-lib-mode.js';
import { parseReply } from './writer.js';
import { preflight } from '../kernel/document.js';
import { isObj, isStr, objects, prop, messageOf } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('../kernel/types.js').ParamSchema} ParamSchema */
/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('./types.js').ReplySchema} ReplySchema */
/** A template (v2/templates/<id>.js). @typedef {{ id: string, concept: string, doc: Record<string, any>, tune: string[] }} Template */
/** The primary: the one game or genre played. @typedef {{ name: string, kind: string, template: string }} PickPrimary */
/** Another game or genre the idea plays, nested in or united with the primary. @typedef {PickPrimary & { relation: string }} PickGame */
/**
 * The pick as the model wrote it (strings kept as written: the check reports an unknown value).
 * @typedef {{ title: string, premise: string, primary: PickPrimary, games: PickGame[], themes: Theme[] }} Pick
 */
/** A finding with the form field it names (a fieldForm path). @typedef {{ code: string, field: string, message: string }} FormProblem */
/** @typedef {{ code: string, path: string, message: string }} TemplateProblem */
/** One model call of the template path. @typedef {{ form: string, fields?: string[], model: string | null, ms: number, escalated?: boolean, problems?: string[], error?: string }} TemplateCall */
/** @typedef {{ name: string, kind: string }} Theme */
/** @typedef {{ use: string, param: string, spec: ParamSchema, instances: Array<Record<string, any>> }} TuneTarget */
/** Time spent in code (narrowing, checks, composition), excluding model calls. @typedef {{ codeMs: number }} Clock */

export const TEMPLATE_PATH_VERSION = 'template-path/0.1';
/** The kinds that bring a loop of their own (§1.3): the primary and the other games are these. */
export const LOOP_KINDS = Object.freeze(['game', 'genre']);
/** The kinds that only theme the content forms (§1.3): the themes are these. */
export const THEME_KINDS = Object.freeze(['theme', 'setting', 'character']);
export const PICK_KINDS = Object.freeze([...LOOP_KINDS, ...THEME_KINDS]);
/** How another game joins the primary. */
export const PLAYED_RELATIONS = Object.freeze(['nested', 'union']);
/** A themed name: 1-40 characters, starting with a non-space. The form's pattern and the check are this one rule. */
export const NAME_PATTERN = '^\\S.{0,39}$';
const NAME_RE = new RegExp(NAME_PATTERN, 'u');
/** Free text the model must write (title, premise, logline, a concept's name): at least one non-space character. */
export const TEXT_PATTERN = '\\S';
const TEXT_RE = new RegExp(TEXT_PATTERN, 'u');

/** @param {string} description @returns {Record<string, unknown>} */
const text = description => ({ type: 'string', pattern: TEXT_PATTERN, description });
/** @param {string} description @returns {Record<string, unknown>} */
const nameSlot = description => ({ type: 'string', pattern: NAME_PATTERN, description });
/** @param {readonly string[]} values @param {string} description @returns {Record<string, unknown>} */
const choice = (values, description) => ({ type: 'string', enum: [...values], description });

/** Every primitive instance in a document (systems, spaces, their generators) with its document path. @param {Record<string, any>} doc */
export function instancesWithPaths(doc) {
  /** @type {Array<{ inst: Record<string, any>, path: string }>} */
  const out = [];
  (Array.isArray(doc.systems) ? doc.systems : []).forEach((/** @type {Record<string, any>} */ s, /** @type {number} */ i) => out.push({ inst: s, path: `systems[${i}]` }));
  (Array.isArray(doc.spaces) ? doc.spaces : []).forEach((/** @type {Record<string, any>} */ s, /** @type {number} */ i) => {
    out.push({ inst: s, path: `spaces[${i}]` });
    (Array.isArray(s.generators) ? s.generators : []).forEach((/** @type {Record<string, any>} */ g, /** @type {number} */ j) => out.push({ inst: g, path: `spaces[${i}].generators[${j}]` }));
  });
  return out;
}
/** @param {Record<string, any>} doc */
export const instancesIn = doc => instancesWithPaths(doc).map(x => x.inst);

/**
 * A tune path '<primitive id>.<param>' resolved against the document's instances and the primitive's card (the longest
 * primitive id that prefixes the path); null when no instance's card declares that param.
 * @param {Record<string, any>} doc @param {string} path @param {RegistryLike} registry @returns {TuneTarget | null}
 */
export function tuneTarget(doc, path, registry) {
  const uses = new Set(instancesIn(doc).map(i => String(i.use)));
  const use = [...uses].filter(u => path.startsWith(`${u}.`)).sort((a, b) => b.length - a.length)[0];
  if (!use) return null;
  const param = path.slice(use.length + 1), spec = /** @type {ParamSchema | undefined} */ (registry.get(use)?.card?.params?.[param]);
  return spec ? { use, param, spec, instances: instancesIn(doc).filter(i => i.use === use) } : null;
}

/** The templates code can compose in this catalogue: every primitive their document uses is registered. @param {readonly Template[]} templates @param {RegistryLike} registry */
export const offeredTemplates = (templates, registry) => templates.filter(t => instancesIn(t.doc).every(i => registry.has(String(i.use))));

// ---------------------------------------------------------------------------------------------------------------
// 1. The pick: one strict form whose structure makes every structurally invalid pick inexpressible, checked by code
//    against that same schema plus the rules that need the catalogue.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The pick's rules, each with its stable code. The form's schema guarantees the structure (exactly one primary, a
 * game or genre; other games only nested or union; themes, settings and characters only themes, with no template);
 * `pick_form` is that same schema held against the answer (outline-form answerProblems), for writers that do not
 * enforce it. The template enum is the offered templates' ids, so a template that does not exist is a `pick_form`
 * problem at its field. The rules below it need the catalogue.
 */
export const PICK_RULES = Object.freeze({
  pick_form: 'the answer satisfies the pick form\'s schema: its fields, enums (kinds, template ids, relations) and patterns',
  pick_nested_no_entry: 'a nested game needs a primary whose template\'s loops declare an entry event (card.loop.involves)',
});

/** The pick's strict form. @param {readonly Template[]} templates @returns {ReplySchema} */
export function pickForm(templates) {
  const ids = [...templates.map(t => t.id), 'none'];
  const template = (/** @type {string} */ what) => choice(ids, `the template whose concept IS ${what}; none when no template is (never the closest one)`);
  return { name: 'pick_templates', schema: strictObj({
    title: text('the game\'s title'),
    premise: text('two or three sentences: the world, the player, the goal'),
    primary: strictObj({
      name: text('the one game or genre the player plays, as the idea names it; a named game and its genre are this one concept: name the game'),
      kind: choice(LOOP_KINDS, 'game: a game the idea names; genre: a kind of game'),
      template: template('this game or its genre'),
    }, 'the primary: the one game or genre the player plays'),
    games: strictArr(strictObj({
      name: text('the game or genre as the idea names it'),
      kind: choice(LOOP_KINDS, 'game: a game the idea names; genre: a kind of game'),
      template: template('this game or genre'),
      relation: choice(PLAYED_RELATIONS, 'nested: a game entered from inside the primary; union: a game played alongside the primary on the same space'),
    }), 'every OTHER game or genre the idea also plays, each with its own loop (never the primary\'s own genre); [] when the idea plays one game'),
    themes: strictArr(strictObj({
      name: text('the theme, setting or character as the idea names it'),
      kind: choice(THEME_KINDS, 'theme, setting or character: restyles the primary\'s content, never played'),
    }), 'every theme, setting and character the idea names or implies; [] when none'),
  }) };
}

/**
 * The loops a template carries, as their cards declare them (card.mode via modesIn; how it is played and who plays
 * against the player via cardLoop): its own loops, and the wrapper modes that sequence them. A template carrying no
 * loop of its own is a template defect (422 'template_defect').
 * @param {Template} template @param {RegistryLike} registry
 * @returns {{ loops: Array<{ loop: string, interactions: string[], opponent: string | null }>, wrappers: string[] }}
 */
export function templateLoops(template, registry) {
  const modes = modesIn(template.doc, registry).map(m => ({ m, loop: cardLoop(registry.get(m.use)?.card) }));
  const loops = modes.filter(x => !x.m.mode.wraps).map(x => ({ loop: String(x.m.mode.loop), interactions: x.loop?.interactions ?? [], opponent: x.loop?.opponent ?? null }));
  if (!loops.length) throw Object.assign(Error(`template '${template.id}' carries no loop of its own (card.mode)`), { status: 422, code: 'template_defect', problems: [{ code: 'template_loop_undeclared', path: template.id, message: 'a template carries at least one card.mode loop that is not a wrapper' }] });
  return { loops, wrappers: modes.filter(x => x.m.mode.wraps).map(x => String(x.m.mode.loop)) };
}

/**
 * The pick's instructions: the templates grouped by the loops their cards declare (loop id, how it is played, who
 * plays against the player), each template as `id: concept`. Derived from the cards in the templates' documents.
 * @param {readonly Template[]} templates @param {RegistryLike} registry
 */
export function pickSystem(templates, registry) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const t of templates) {
    const { loops, wrappers } = templateLoops(t, registry);
    const family = loops.map(l => `${l.loop} (played ${l.interactions.join(' or ') || 'in the interaction it wraps'}; opponent: ${l.opponent ?? 'undeclared'})`).join(' + ');
    groups.set(family, [...(groups.get(family) ?? []), `- ${t.id}: ${t.concept}${wrappers.length ? ` (sequenced by ${wrappers.join(', ')})` : ''}`]);
  }
  const listing = [...groups].map(([family, lines]) => `Loop ${family}:\n${lines.join('\n')}`).join('\n') || '(no templates in this catalogue)';
  return `You pick how a game idea is built from verified game templates.
Templates, grouped by the loop they are played with (the loop, how the player plays it, who plays against the player), each as id: concept:
${listing}

Fill the form:
- primary: the ONE game or genre the player plays. A named game and its genre are one concept: a game named with its genre ("a Mario game", "a Zelda-style dungeon") is that game (kind game) with the template of its genre, never the game and its genre as two concepts. template: the template whose concept IS that game or its genre, or none when no template is (never the closest one).
- games: every OTHER game or genre the idea also plays, with its own loop: nested (entered from inside the primary) or union (played alongside it on the same space); [] when the idea plays one game.
- themes: every theme, setting and character the idea names or implies (a character the player plays as, a place, a look): it restyles the primary's content and is never played.
Also write the game's title and premise.`;
}

/** @param {unknown} v @returns {PickPrimary} */
const narrowPrimary = v => ({ name: String(prop(v, 'name') ?? ''), kind: String(prop(v, 'kind') ?? ''), template: String(prop(v, 'template') ?? '') });
/** The pick as written, narrowed (strings kept as written; the check reports what is wrong). @param {unknown} v @returns {Pick} */
export const narrowPick = v => ({
  title: String(prop(v, 'title') ?? ''), premise: String(prop(v, 'premise') ?? ''),
  primary: narrowPrimary(prop(v, 'primary')),
  games: objects(prop(v, 'games')).map(c => ({ ...narrowPrimary(c), relation: String(c.relation ?? '') })),
  themes: objects(prop(v, 'themes')).map(c => ({ name: String(c.name ?? ''), kind: String(c.kind ?? '') })),
});

/** The entry events the loops of a document's instances declare (card.loop.involves). @param {Record<string, any>} doc @param {RegistryLike} registry */
export function entryEvents(doc, registry) {
  return instancesIn(doc).flatMap(i => Object.keys(cardLoop(registry.get(String(i.use))?.card)?.involves || {}).map(event => ({ use: String(i.use), event })));
}

/**
 * The pick's code checks (PICK_RULES). Problems carry stable codes and the form field they name. A game or genre
 * with template 'none' is not a problem: it goes to the step path (`stepPath`: those concepts' names).
 * @param {Pick} pick @param {{ templates: readonly Template[], registry: RegistryLike }} ctx
 * @returns {{ problems: FormProblem[], stepPath: string[] }}
 */
export function checkPick(pick, { templates, registry }) {
  /** @type {FormProblem[]} */
  const problems = answerProblems(pickForm(templates).schema, pick).map(p => ({ code: 'pick_form', field: p.path, message: p.message }));
  const outer = templates.find(t => t.id === pick.primary.template) ?? null;
  if (outer && !entryEvents(outer.doc, registry).length) pick.games.forEach((g, i) => {
    if (g.relation === 'nested') problems.push({ code: 'pick_nested_no_entry', field: `games[${i}].relation`, message: `'${g.name}' cannot be nested in '${outer.id}': no loop of its document declares an entry event (card.loop.involves)` });
  });
  const stepPath = [pick.primary, ...pick.games].filter(c => c.template === 'none').map(c => c.name);
  return { problems, stepPath };
}

// ---------------------------------------------------------------------------------------------------------------
// Asking: one form, its check, field re-asks, one escalation (decompose.js askStep's convention).
// ---------------------------------------------------------------------------------------------------------------

/** The value at a fieldForm path ('a.b[0].c'). @param {unknown} v @param {string} path @returns {unknown} */
function valueAt(v, path) {
  /** @type {unknown} */
  let cur = v;
  for (const m of path.matchAll(/\[(\d+)\]|([^.[\]]+)/g)) cur = m[1] !== undefined ? (Array.isArray(cur) ? cur[Number(m[1])] : undefined) : prop(cur, m[2]);
  return cur;
}

/**
 * Ask one strict form and check its answer; a failing check re-asks only the failing fields (fieldForm), up to
 * `attempts` calls of the default writer, then once of the escalation writer (effort low, this form only). Still
 * failing: a 422 with `code` and every finding. -> { value, calls (this form's calls, made one after another) }
 * @template T
 * @param {{ writer: Writer, escalate: Writer | null, attempts: number, calls: TemplateCall[], system: string, user: string, schema: ReplySchema,
 *   narrow: (value: unknown) => T, check: (value: T) => FormProblem[], code: string, what: string, clock: Clock }} args
 * @returns {Promise<{ value: T, calls: number }>}
 */
export async function askForm({ writer, escalate, attempts, calls, system, user, schema, narrow, check, code, what, clock }) {
  /** @type {{ v: T } | null} */
  let value = null;
  /** @type {FormProblem[]} */
  let problems = [];
  /** @type {string[]} */
  const failed = [];
  const own = Math.max(1, attempts);
  let n = 0;
  for (let i = 0; i < own + (escalate ? 1 : 0); i++) {
    const w = i >= own && escalate ? escalate : writer;
    const current = value;
    const fields = current && problems.length ? fieldForm(schema, [...new Set(problems.map(p => p.field))]) : null;
    const ask = fields && current
      ? `${user}\n\nYour answer failed these checks:\n${problems.map(p => `- ${p.field}: ${p.message}`).join('\n')}\nFix ONLY these fields. Current values: ${JSON.stringify(Object.fromEntries(fields.slots.map(s => [s.path, valueAt(current.v, s.path) ?? null])))}`
      : failed.length ? `${user}\n\nYour previous reply failed (${failed[failed.length - 1]}). Reply with one JSON object.` : user;
    const form = fields ? fields.schema : schema;
    const t0 = performance.now();
    /** @type {TemplateCall} */
    const call = { form: schema.name, ...(fields ? { fields: fields.slots.map(s => s.path) } : {}), model: null, ms: 0, ...(w === escalate ? { escalated: true } : {}) };
    calls.push(call); n++;
    try {
      const reply = await w.complete({ system, user: ask, schema: form, ...(w === escalate ? { effort: 'low' } : {}) });
      call.model = reply.model || w.model; call.ms = Math.round(performance.now() - t0);
      const tc = performance.now();
      const parsed = parseReply(reply.text);
      const next = narrow(fields && current ? fields.apply(current.v, parsed) : parsed);
      value = { v: next };
      problems = check(next);
      clock.codeMs += performance.now() - tc;
      if (!problems.length) return { value: next, calls: n };
      call.problems = problems.map(p => `${p.code} ${p.field}: ${p.message}`.slice(0, 300));
      failed.push(call.problems.join('; '));
    } catch (error) {
      call.ms = Math.round(performance.now() - t0);
      call.error = messageOf(error).slice(0, 160);
      failed.push(call.error);
    }
  }
  throw Object.assign(Error(`${what} failed its checks after ${failed.length} call(s): ${failed.join(' | ')}`),
    { status: 422, code, attempts: failed, problems: problems.map(p => ({ code: p.code, path: p.field, message: p.message })) });
}

/**
 * The pick, asked and checked; a pick still failing is a 422 'template_pick_failed' with its problems.
 * @param {{ writer: Writer, escalate: Writer | null, attempts: number, prompt: string, templates: readonly Template[], registry: RegistryLike, calls: TemplateCall[], clock: Clock }} args
 * @returns {Promise<{ pick: Pick, stepPath: string[], calls: number }>}
 */
export async function askPick({ writer, escalate, attempts, prompt, templates, registry, calls, clock }) {
  const r = await askForm({ writer, escalate, attempts, calls, clock, system: pickSystem(templates, registry), user: `Idea: ${prompt}`, schema: pickForm(templates), narrow: narrowPick,
    check: pick => checkPick(pick, { templates, registry }).problems, code: 'template_pick_failed', what: 'The template pick' });
  return { pick: r.value, stepPath: checkPick(r.value, { templates, registry }).stepPath, calls: r.calls };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Composition (code).
// ---------------------------------------------------------------------------------------------------------------

/**
 * Compose the picked templates: the primary template's document (a deep clone) with the pick's title and premise;
 * theme concepts are collected for the content forms (no adapter, §1.3). Nested and union composition (handoff
 * increment 4) is not implemented yet: such a concept is a `composition_pending` problem naming what is missing; it
 * is never dropped or substituted. With step-path concepts or pick problems there is nothing to compose (doc null).
 * @param {Pick} pick @param {{ templates: readonly Template[], registry: RegistryLike }} ctx
 * @returns {{ doc: Record<string, any> | null, template: Template | null, themes: Theme[], stepPath: string[], problems: TemplateProblem[] }}
 */
export function composeTemplates(pick, { templates, registry }) {
  const { problems: checks, stepPath } = checkPick(pick, { templates, registry });
  /** @type {TemplateProblem[]} */
  const problems = checks.map(p => ({ code: p.code, path: p.field, message: p.message }));
  const themes = pick.themes.map(c => ({ name: c.name, kind: c.kind }));
  if (stepPath.length || problems.length) return { doc: null, template: null, themes, stepPath, problems };
  const primary = pick.primary;
  const outer = /** @type {Template} */ (templates.find(t => t.id === primary.template));
  pick.games.forEach((c, i) => {
    const how = c.relation === 'nested'
      ? `engine.adapt.nested composition (the inner template appended with prefixed ids and entered on ${entryEvents(outer.doc, registry).map(e => e.event).join('/')})`
      : 'union composition (both templates on one space, proven by the composition check)';
    problems.push({ code: 'composition_pending', path: `games[${i}]`, message: `'${c.name}' (template '${c.template}') is ${c.relation} in '${primary.name}' (template '${outer.id}'): ${how} is not yet implemented` });
  });
  if (problems.length) return { doc: null, template: outer, themes, stepPath, problems };
  const doc = structuredClone(outer.doc);
  doc.title = pick.title;
  doc.plot = { ...(isObj(doc.plot) ? doc.plot : {}), premise: pick.premise };
  return { doc, template: outer, themes, stepPath, problems };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Content forms, derived from the composed document.
// ---------------------------------------------------------------------------------------------------------------

/** @typedef {{ form: string, at: string, label: string, entries: Array<Record<string, any>> }} NamedSection */

/**
 * The document's sections of named entries: every content.* list of { id, … } and every space's zones. Ids are
 * fixed by code; the model only names the entries.
 * @param {Record<string, any>} doc @returns {NamedSection[]}
 */
export function namedSections(doc) {
  const named = (/** @type {unknown} */ v) => Array.isArray(v) && v.length > 0 && v.every(e => isObj(e) && isStr(e.id) && e.id.length > 0);
  /** @type {NamedSection[]} */
  const out = [];
  for (const [k, v] of Object.entries(isObj(doc.content) ? doc.content : {})) if (named(v)) out.push({ form: `content_${k}`.slice(0, 64), at: `content.${k}`, label: k, entries: objects(v) });
  (Array.isArray(doc.spaces) ? doc.spaces : []).forEach((/** @type {Record<string, any>} */ s, /** @type {number} */ i) => {
    if (named(s.zones)) out.push({ form: `zones_${s.id}`.slice(0, 64), at: `spaces[${i}].zones`, label: `zones of the space '${s.id}'`, entries: s.zones });
  });
  return out;
}

/** @param {Record<string, any>} doc @param {string} at @returns {Array<Record<string, any>>} */
const entriesAt = (doc, at) => objects(valueAt(doc, at));

/** One content form for a named section: a name slot per entry id, nothing else. @param {NamedSection} section */
export function namesForm(section) {
  const ids = section.entries.map(e => String(e.id));
  /** @type {ReplySchema} */
  const schema = { name: section.form, schema: strictObj(Object.fromEntries(section.entries.map(e => [String(e.id), nameSlot(`themed name of the ${section.label} entry '${e.id}' (template name: ${String(e.name ?? e.id)}); 1-40 characters`)]))) };
  /** @param {unknown} v @returns {Record<string, string>} */
  const narrow = v => Object.fromEntries(ids.map(id => [id, String(prop(v, id) ?? '')]));
  /** @param {Record<string, string>} v @returns {FormProblem[]} */
  const check = v => ids.filter(id => !NAME_RE.test(v[id])).map(id => ({ code: 'name_invalid', field: id, message: `a name of 1-40 characters that starts with a non-space, not '${v[id].slice(0, 60)}'` }));
  /** @param {Record<string, any>} doc @param {Record<string, string>} v */
  const apply = (doc, v) => { for (const e of entriesAt(doc, section.at)) if (isStr(e.id) && v[e.id] !== undefined) e.name = v[e.id]; };
  return { schema, narrow, check, apply };
}

/**
 * The frame and tune form: the logline, and one slot per `tune` path whose schema the card's param spec derives
 * (outline-form specSchema: closed sets as enums, ranges as minimum/maximum). Its check applies the decoded values to
 * the document and preflights it: a finding at a tuned param (or elsewhere on its instance) is that slot's problem.
 * A tune path naming no single declared param is a template defect (422 'template_defect').
 * @param {Template} template @param {Record<string, any>} doc the composed document @param {{ registry: RegistryLike, logic: LogicLike }} cat
 */
export function frameTuneForm(template, doc, { registry, logic }) {
  const paths = instancesWithPaths(doc);
  const slots = template.tune.map(path => {
    const target = tuneTarget(doc, path, registry);
    if (!target || target.instances.length !== 1) throw Object.assign(Error(`template '${template.id}': tune '${path}' names ${target ? `${target.instances.length} instances` : 'no declared param of an instance'} in its document`), { status: 422, code: 'template_defect', problems: [{ code: 'tune_unknown', path, message: 'a tune path names one declared param of one instance' }] });
    const inst = target.instances[0], at = /** @type {{ path: string }} */ (paths.find(p => p.inst === inst)).path;
    const { schema, codec } = specSchema(target.spec);
    const current = inst.with?.[target.param] ?? target.spec.default;
    return { key: formKey(path), path, param: target.param, at, codec, spec: target.spec, schema: { ...schema, description: `${path}: ${String(schema.description || '')}; now ${JSON.stringify(current)}`.slice(0, 300) } };
  });
  /** @type {ReplySchema} */
  const schema = { name: 'frame_tune', schema: strictObj({ logline: text('one sentence that sells the game'), ...Object.fromEntries(slots.map(s => [s.key, s.schema])) }) };
  /** @param {unknown} v @returns {Record<string, unknown>} */
  const narrow = v => ({ logline: String(prop(v, 'logline') ?? ''), ...Object.fromEntries(slots.map(s => [s.key, decode(prop(v, s.key), s.codec)])) });
  /** @param {Record<string, any>} d @param {Record<string, unknown>} v */
  const apply = (d, v) => {
    d.logline = v.logline;
    const at = instancesWithPaths(d);
    for (const s of slots) { const inst = /** @type {{ inst: Record<string, any> }} */ (at.find(p => p.path === s.at)).inst; inst.with = { ...(inst.with || {}), [s.param]: v[s.key] }; }
  };
  /** @param {Record<string, unknown>} v @returns {FormProblem[]} */
  const check = v => {
    /** @type {FormProblem[]} */
    const problems = [];
    if (!TEXT_RE.test(String(v.logline))) problems.push({ code: 'text_missing', field: 'logline', message: 'write a one-sentence logline' });
    for (const s of slots) if (v[s.key] === undefined) problems.push({ code: 'tune_missing', field: s.key, message: `${s.path} needs a value` });
    if (problems.length) return problems;
    const d = structuredClone(doc);
    apply(d, v);
    for (const e of preflight(d, registry, logic).errors) {
      const param = slots.filter(s => e.path === `${s.at}.with.${s.param}` || e.path.startsWith(`${s.at}.with.${s.param}.`) || e.path.startsWith(`${s.at}.with.${s.param}[`));
      // The composed document preflighted before these values were set (the caller checks it), so any finding is
      // theirs: a finding elsewhere on a tuned instance (a cross-field rule) belongs to that instance's slots, any
      // other to every slot.
      const inst = param.length ? param : slots.filter(s => e.path === s.at || e.path.startsWith(`${s.at}.`));
      for (const s of inst.length ? inst : slots) problems.push({ code: e.code, field: s.key, message: `${s.path}: ${e.message}${e.hint ? ` (${e.hint})` : ''}` });
    }
    return problems;
  };
  return { schema, narrow, check, apply, slots };
}

/**
 * Ask every content form of the composed document in parallel (Promise.all), each checked and repaired on its own,
 * and apply the answers to a copy of the document. The themes and the premise are in every form's prompt.
 * -> { doc, forms: [{ form, calls }], rounds (the most calls any one form made: they run side by side) }
 * @param {{ writer: Writer, escalate: Writer | null, attempts: number, template: Template, doc: Record<string, any>, pick: Pick, themes: Theme[],
 *   registry: RegistryLike, logic: LogicLike, calls: TemplateCall[], clock: Clock }} args
 */
export async function writeContent({ writer, escalate, attempts, template, doc, pick, themes, registry, logic, calls, clock }) {
  const tc = performance.now();
  const sections = namedSections(doc).map(section => ({ section, form: namesForm(section) }));
  const frame = frameTuneForm(template, doc, { registry, logic });
  clock.codeMs += performance.now() - tc;
  const system = `You write the content of a game built from the verified template '${template.id}' (${template.concept}).
Title: ${pick.title}
Premise: ${pick.premise}
Themes: ${themes.length ? themes.map(t => `${t.name} (${t.kind})`).join('; ') : 'none beyond the premise'}
Write only what the form asks, in the game's theme. Ids and structure are fixed.`;
  const base = { writer, escalate, attempts, calls, clock, system, code: 'template_content_failed' };
  const [frameAnswer, ...named] = await Promise.all([
    askForm({ ...base, user: `Write the logline of '${pick.title}' and set its tuning (each slot names its current value).`, schema: frame.schema, narrow: frame.narrow, check: frame.check, what: 'The frame_tune form' }),
    ...sections.map(({ section, form }) => askForm({ ...base, user: `Name every ${section.label} entry of '${pick.title}' for its theme.`, schema: form.schema, narrow: form.narrow, check: form.check, what: `The ${section.form} form` })),
  ]);
  const ta = performance.now();
  const out = structuredClone(doc);
  frame.apply(out, frameAnswer.value);
  sections.forEach(({ form }, i) => form.apply(out, named[i].value));
  clock.codeMs += performance.now() - ta;
  const forms = [{ form: 'frame_tune', calls: frameAnswer.calls }, ...sections.map(({ section }, i) => ({ form: section.form, calls: named[i].calls }))];
  return { doc: out, forms, rounds: Math.max(...forms.map(f => f.calls)) };
}
