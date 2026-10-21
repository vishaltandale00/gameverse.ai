// Improvement target 'template' (ARCHITECTURE.md §5: "what the step path builds well becomes a new template"): a
// published game version becomes a template `{ id, concept, doc, tune }`, checked by the whole template contract
// (v2/templates/contract.js) against the live catalogue, and written to v2/templates/promoted/<id>.json with its
// provenance, where discovery (v2/templates/registry.js) finds it. Everything here is derived from the version and
// the cards in it; nothing is written by a model.
//   id       the request's template id (the game's id when the request names none)
//   concept  the document's premise (doc.plot.premise), on one line
//   doc      the published document, its id set to the template id
//   tune     every param a card declares as a number or integer with a finite range, a boolean or a closed set of
//            strings, that the document sets on the instance of a primitive it instantiates once (the values the build
//            chose), in document order; then only the candidates proven playable over that whole range (provenTune: the
//            contract's bounds stage, each candidate alone) stay tunable, the others are structure the build fixed
import { formatProblems, boundValues, boundsProblems } from '../templates/contract.js';
import { PROMOTED_SCHEMA } from '../templates/registry.js';
import { instancesIn } from '../planner/templates.js';

export const TEMPLATE_DERIVATION_VERSION = 'template-derivation/0.1';
export const DERIVE_CODES = Object.freeze(['derive_doc_invalid', 'derive_has_experiments', 'derive_premise_missing']);
export const templatePaths = id => ({ file: `v2/templates/promoted/${id}.json` });

const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A param the frame_tune form can set from the card's declaration alone, over a range the bounds stage can prove. */
const tunable = spec => ['number', 'integer', 'boolean', 'string'].includes(spec?.type) && boundValues(spec) !== null;

/** The tune paths of a document (see the header). @param {Record<string, any>} doc @param {{ get(id: string): any }} registry */
export function derivedTune(doc, registry) {
  const instances = instancesIn(doc), count = new Map();
  for (const i of instances) count.set(i.use, (count.get(i.use) || 0) + 1);
  const out = [];
  for (const inst of instances) {
    if (count.get(inst.use) !== 1 || !isObj(inst.with)) continue;
    const params = registry.get(String(inst.use))?.card?.params || {};
    for (const [name, spec] of Object.entries(params)) if (name in inst.with && tunable(spec)) out.push(`${inst.use}.${name}`);
  }
  return out;
}

/**
 * Derive a template from a published version. -> { template, problems: [{ code, message }] } (template null on problems;
 * the template's own format is the contract's to check).
 * @param {{ doc: unknown }} version @param {{ id: string, registry: { get(id: string): any } }} options
 */
export function deriveTemplate(version, { id, registry }) {
  const doc = version?.doc;
  if (!isObj(doc) || !Array.isArray(doc.systems) || !Array.isArray(doc.spaces)) return { template: null, problems: [{ code: 'derive_doc_invalid', message: 'the version has no game document' }] };
  const problems = [];
  if (Array.isArray(doc.experiments) && doc.experiments.length) problems.push({ code: 'derive_has_experiments', message: `the game carries experiment primitives (${doc.experiments.map(e => e.card?.id ?? e.id).join(', ')}); promote them to primitives first (POST /api/v2/games/:id/promote)` });
  const premise = typeof doc.plot?.premise === 'string' ? doc.plot.premise.replace(/\s+/g, ' ').trim() : '';
  if (!premise) problems.push({ code: 'derive_premise_missing', message: 'the document has no premise (plot.premise) to be the template\'s concept' });
  if (problems.length) return { template: null, problems };
  const out = structuredClone(doc);
  out.id = id;
  return { template: { id, concept: premise, doc: out, tune: derivedTune(out, registry) }, problems: [] };
}

/** The promoted file's text: { schema, template, provenance }. Throws on a template that fails the format stage. */
export function promotedFile(template, provenance) {
  const problems = formatProblems(template);
  if (problems.length) throw Error(`not a template: ${problems.map(p => p.code).join(', ')}`);
  return `${JSON.stringify({ schema: PROMOTED_SCHEMA, template, provenance }, null, 2)}\n`;
}

/**
 * The derived tune entries proven playable over their card's whole range: each candidate's bounds played alone (the
 * template contract's bounds stage). -> { tune: the proven paths, dropped: [{ path, problems }] }
 * @param {{ id: string, doc: Record<string, any>, tune: string[] }} template @param {{ registry: any, logic: any }} catalogue
 */
export function provenTune(template, { registry, logic }) {
  const tune = [], dropped = [];
  for (const path of template.tune) {
    const problems = boundsProblems({ ...template, tune: [path] }, registry, logic, { bounds: [] });
    if (problems.length) dropped.push({ path, problems: problems.map(p => `${p.code}: ${p.message}`.slice(0, 200)) }); else tune.push(path);
  }
  return { tune, dropped };
}
