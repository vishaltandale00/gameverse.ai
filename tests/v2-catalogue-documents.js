// The documents the catalogue composes, for conformance over worlds (tests/v2-sides.test.js,
// tests/v2-options-controlled.test.js): every template, and every ordered pair of templates that composes nested (an
// entry event on the outer, an enterable loop in the inner) or united (v2/planner/compose.js), derived from the
// registry and the template discovery, never a hand list.
import { TEMPLATES, templateById } from '../v2/templates/registry.js';
import { composeNested, composeUnion, entryTriggers, innerLoops } from '../v2/planner/compose.js';

/** @param {{ registry: any, logic: any }} cat @returns {Array<{ label: string, doc: any }>} */
export function catalogueDocuments(cat) {
  const out = TEMPLATES.map(t => ({ label: t.id, doc: t.doc }));
  const part = id => ({ id, doc: templateById(id).doc });
  for (const a of TEMPLATES) for (const b of TEMPLATES) {
    if (a === b) continue;
    if (entryTriggers(a.doc, cat.registry).length && innerLoops(b.doc, cat.registry).length) { const r = composeNested(part(a.id), part(b.id), cat); if (r.doc) out.push({ label: `${a.id} × ${b.id}`, doc: r.doc }); }
    const u = composeUnion(part(a.id), part(b.id), cat);
    if (u.doc) out.push({ label: `${a.id} ∪ ${b.id}`, doc: u.doc });
  }
  return out;
}
