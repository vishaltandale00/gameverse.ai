// Test helpers for the worlds3d workstream: cut a full example game down to
// its spaces, generators and the content they read, so the 3D world can be
// preflighted and generated headless before every other primitive exists.
import { checkFields } from '../../kernel/params.js';

/** The space/generator part of a game document, keeping only instances whose primitives are registered. */
export function worldOnly(doc, registry, { spaces } = {}) {
  const keep = s => !spaces || spaces.includes(s.id);
  const out = {
    schema: doc.schema, id: doc.id, title: doc.title, seed: doc.seed,
    spaces: doc.spaces.filter(keep).filter(s => registry.has(s.use)).map(s => ({ ...structuredClone(s), generators: (s.generators || []).filter(g => registry.has(g.use)) })),
    content: { blocks: doc.content?.blocks, models: doc.content?.models, archetypes: doc.content?.archetypes, tables: doc.content?.tables },
  };
  for (const k of Object.keys(out.content)) if (out.content[k] === undefined) delete out.content[k];
  if (doc.player && out.spaces.some(s => s.id === doc.player.space)) out.player = { archetype: doc.player.archetype, space: doc.player.space, at: doc.player.at };
  return out;
}

/** Param errors for every instance of `ids` in a document (spaces and generators), via the cards' params. */
export function instanceParamErrors(doc, registry, ids) {
  const errors = [], indexes = { zone: new Set(doc.spaces.flatMap(s => (s.zones || []).map(z => z.id))), block: new Set((doc.content?.blocks || []).map(b => b.id)), model: new Set(Object.keys(doc.content?.models || {})), archetype: new Set((doc.content?.archetypes || []).map(a => a.id)), biome: new Set() };
  for (const s of doc.spaces) for (const g of s.generators || []) if (g.use === 'engine.generate.biomes') for (const b of g.with?.biomes || []) indexes.biome.add(b.id);
  const ctx = { indexes, checkPredicate() {}, checkEffect() {} };
  doc.spaces.forEach((s, i) => {
    if (ids.includes(s.use)) checkFields(registry.get(s.use).card.params, s.with || {}, `spaces[${i}].with`, errors, ctx);
    (s.generators || []).forEach((g, j) => { if (ids.includes(g.use)) checkFields(registry.get(g.use).card.params, g.with || {}, `spaces[${i}].generators[${j}].with`, errors, ctx); });
  });
  return errors;
}
