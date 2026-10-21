// engine.adapt.skin: a skin adapter (ARCHITECTURE.md §1.3): one concept's content fills another concept's
// content slots. Species as chess pieces, shopping carts as karts, library shelves as maze walls. Content
// mapping only, never mechanics: each map takes the entries of a source section (content.species) and writes
// them into a target section (content.archetypes) as entries the target's primitives already understand,
// so a primitive's content contract (card.content, card.mode.needs.content) is met from the other concept.
//
//   maps[] = { from: 'content.species', to: 'content.archetypes',
//              pairs?: [{ from: 'ember_pup', to: 'w_knight', with?: {...} }]   (default: every source entry,
//                                                                               target id = prefix + source id)
//              fields?: { 'name': 'name', 'components.model': 'model' }        (target path <- source path;
//                                                                               '$id' is the source id)
//              template?: {...}  base of every new target entry (a piece's components.turns side...)
//              mark?: 'components.skin'  where the target records {from, id} of its source ('' = nowhere) }
//
// skin(doc, config) returns the document with the maps applied (pure; existing target fields win), and the
// installed primitive provides the `skin` service (sourceOf / targetsOf) so other primitives can read which
// source entry a target stands for. planner/adapters.js applySkins(doc, registry) applies every skin of a
// document before preflight.
import { checkFields } from '../../kernel/params.js';

const ID = 'engine.adapt.skin';
const isObj = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const getPath = (obj, path) => String(path).split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, path, value) {
  const keys = String(path).split('.').filter(Boolean); let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { if (!isObj(o[keys[i]])) o[keys[i]] = {}; o = o[keys[i]]; }
  if (keys.length) o[keys[keys.length - 1]] = value;
}
/** a over b, recursively for plain objects (a wins). */
const merge = (a, b) => { if (!isObj(a) || !isObj(b)) return a === undefined ? structuredClone(b) : structuredClone(a); const out = structuredClone(b); for (const [k, v] of Object.entries(a)) out[k] = merge(v, b[k]); return out; };
/** Entries of a section: a list of {id} or an id-keyed object. */
const entriesOf = v => (Array.isArray(v) ? v.filter(x => isObj(x) && typeof x.id === 'string') : isObj(v) ? Object.entries(v).filter(([, x]) => isObj(x)).map(([id, x]) => ({ ...x, id })) : []);

const MAP = { type: 'object', fields: {
  from: { type: 'string', required: true, effect: 'source section path (the concept whose content is used), e.g. content.species' },
  to: { type: 'string', required: true, effect: "target section path (the slots another primitive's contract reads), e.g. content.archetypes" },
  pairs: { type: 'list', default: [], of: { type: 'object', fields: { from: { type: 'string', required: true }, to: { type: 'string', required: true }, with: { type: 'json', effect: 'extra target fields for this pair' } } }, effect: 'source id -> target id (default: every source entry)' },
  prefix: { type: 'string', default: '', effect: 'target id prefix when pairs are derived' },
  fields: { type: 'object', open: true, default: {}, effect: "target path <- source path ('$id' = the source id)" },
  template: { type: 'json', default: {}, effect: 'base of every target entry' },
  mark: { type: 'string', effect: "target path recording {from, id} of the source (default 'components.skin' for archetypes, else none)" },
} };

const PARAMS = { maps: { type: 'list', min: 1, required: true, of: MAP, effect: 'source section -> target section mappings' } };

/** Pairs of one map over a document: [{ src, to, with }]. */
const pairsOf = (doc, m) => {
  const src = entriesOf(getPath(doc, m.from));
  return (m.pairs.length ? m.pairs : src.map(s => ({ from: s.id, to: `${m.prefix}${s.id}` }))).map(p => ({ ...p, src: src.find(s => s.id === p.from) || null }));
};
const markOf = m => m.mark ?? (m.to === 'content.archetypes' ? 'components.skin' : '');

/** The document with every map of one skin applied. Pure: new entries are added, existing fields are kept. */
export function skin(doc, config) {
  const out = structuredClone(doc);
  for (const m of checkFields(PARAMS, config || {}, '', [], null).maps || []) {
    const cur = getPath(out, m.to), keyed = isObj(cur);
    const list = keyed ? entriesOf(cur) : Array.isArray(cur) ? cur : [];
    for (const p of pairsOf(out, m)) {
      if (!p.src) continue;
      const made = structuredClone(m.template ?? {});
      for (const [to, from] of Object.entries(m.fields || {})) { const v = from === '$id' ? p.src.id : getPath(p.src, from); if (v !== undefined) setPath(made, to, structuredClone(v)); }
      const mark = markOf(m); if (mark) setPath(made, mark, { from: m.from, id: p.src.id });
      const i = list.findIndex(x => x?.id === p.to), withPair = isObj(p.with) ? p.with : {};
      const entry = merge(i >= 0 ? list[i] : {}, merge(withPair, made)); entry.id = p.to;
      if (i >= 0) list[i] = entry; else list.push(entry);
    }
    setPath(out, m.to, keyed ? Object.fromEntries(list.map(({ id, ...rest }) => [id, rest])) : list);
  }
  return out;
}

export default {
  id: ID,
  card: {
    intent: "Skin adapter: maps one concept's content onto another concept's content slots (species as chess pieces, shopping carts as karts, library shelves as maze walls) so a primitive's content contract is filled from the other concept. Content only, no mechanics.",
    views: ['any'],
    params: PARAMS,
    provides: { services: ['skin'] },
    requires: {},
    components: { skin: { type: 'object', fields: { from: { type: 'string' }, id: { type: 'string' } }, effect: 'the source entry a skinned archetype stands for (owned by engine.adapt.skin)' } },
    adapts: {
      provides: { capabilities: [], content: [], services: ['skin'] },
      from: {},
      projection: "a source section's entries become entries of a target section (fields copied by path, a template for the rest)",
      relation: 'skin',
    },
  },
  skin,
  validate(config, doc, ctx) {
    const errors = [];
    config.maps.forEach((m, i) => {
      if (!/^(content|plot)\.[A-Za-z0-9_]+$/.test(m.from)) errors.push({ code: 'skin_section', path: `with.maps[${i}].from`, message: `'${m.from}' is not a content or plot section` });
      if (!/^(content|plot)\.[A-Za-z0-9_]+$/.test(m.to)) errors.push({ code: 'skin_section', path: `with.maps[${i}].to`, message: `'${m.to}' is not a content or plot section` });
      const src = entriesOf(getPath(doc, m.from));
      if (!src.length) { errors.push({ code: 'skin_source_empty', path: `with.maps[${i}].from`, message: `${m.from} has no entries to skin with` }); return; }
      m.pairs.forEach((p, j) => { if (!src.some(s => s.id === p.from)) errors.push({ code: 'skin_pair_unknown', path: `with.maps[${i}].pairs[${j}].from`, message: `${m.from} has no '${p.from}'`, hint: `ids: ${src.map(s => s.id).slice(0, 12).join(', ')}` }); });
      const targets = new Set(entriesOf(getPath(doc, m.to)).map(t => t.id)), missing = pairsOf(doc, m).filter(p => p.src && !targets.has(p.to)).map(p => p.to);
      if (missing.length) ctx.warn({ code: 'skin_unapplied', path: `with.maps[${i}]`, message: `${m.to} lacks ${missing.slice(0, 6).join(', ')}`, hint: 'apply the skin to the document first (planner/adapters.js applySkins)' });
    });
    return errors;
  },
  install(rt, config) {
    const maps = config.maps;
    rt.provide('skin', {
      /** The source {from, id} a target entry stands for, or null. */
      sourceOf(section, id) { for (const m of maps) if (m.to === section) for (const p of pairsOf(rt.doc, m)) if (p.to === id && p.src) return { from: m.from, id: p.src.id }; return null; },
      /** Target ids standing for a source entry. */
      targetsOf(section, id) { return maps.filter(m => m.from === section).flatMap(m => pairsOf(rt.doc, m).filter(p => p.src?.id === id).map(p => ({ to: m.to, id: p.to }))); },
    });
  },
};
