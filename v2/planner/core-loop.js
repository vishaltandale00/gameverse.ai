// Core-loop invariant (publish gate, alongside "the playtest must not crash"): a published game must be
// the game the idea asked for. Every core mechanic keeps the primitives it was mapped to, the content
// those primitives read is present, and something wires a win to an ending. Problems carry stable codes
// and paths so outline repair can send them back to the model.
import { isSpace, isGenerator } from './catalog.js';

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const used = doc => new Set([...(doc.systems || []), ...(doc.graphics || []), ...(doc.spaces || []).flatMap(s => [s, ...(s.generators || [])])].map(x => x?.use).filter(Boolean));
const at = (doc, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
const nonEmpty = v => (Array.isArray(v) ? v.length > 0 : isObj(v) ? Object.keys(v).length > 0 : v != null && v !== '');

/** Effects lists anywhere in the document that end the game with a win. */
function winsWired(doc) {
  const endings = new Map((doc.plot?.endings || []).filter(isObj).map(e => [e.id, e]));
  const wins = e => e?.do === 'end_game' && (e.outcome === 'won' || (e.ending && (endings.get(e.ending)?.outcome ?? 'won') === 'won') || (!e.outcome && !e.ending));
  let found = false;
  const walk = v => { if (found) return; if (Array.isArray(v)) { for (const x of v) walk(x); return; } if (!isObj(v)) return; if (wins(v)) { found = true; return; } for (const x of Object.values(v)) walk(x); };
  walk(doc);
  return found;
}

/**
 * coreLoopProblems(doc, mechanics, registry) -> [{ code, path, message, hint, severity: 'error' }]
 * mechanics: selection.mechanics ({ id, description, importance, primitives[] }).
 */
export function coreLoopProblems(doc, mechanics, registry) {
  const problems = [];
  if (!isObj(doc)) return problems;
  const have = used(doc);
  const core = (mechanics || []).filter(m => m?.importance === 'core');
  const needed = new Set();
  for (const m of core) {
    // Spaces and generators are the world; the mechanic itself lives in its gameplay/plot primitives.
    const ids = (m.primitives || []).filter(id => typeof id === 'string' && registry.has(id) && !isSpace(id) && !isGenerator(id));
    for (const id of ids) {
      if (have.has(id)) { needed.add(id); continue; }
      problems.push({ code: 'core_primitive_missing', path: 'systems', severity: 'error', message: `core mechanic "${m.description}" needs ${id}, which the game does not use`, hint: `add { use: '${id}' } and configure it; do not replace it with another mechanic` });
    }
  }
  for (const id of needed) {
    for (const section of registry.get(id)?.card.reads || []) {
      if (typeof section !== 'string' || nonEmpty(at(doc, section))) continue;
      problems.push({ code: 'core_content_empty', path: section, severity: 'error', message: `${id} (a core mechanic) reads ${section}, which is empty`, hint: `write the ${section} entries this mechanic plays with` });
    }
  }
  if (core.length && !winsWired(doc)) problems.push({ code: 'win_unwired', path: 'plot.endings', severity: 'error', message: 'nothing in the game ends it with a win', hint: "wire the core loop's victory (e.g. the mechanic's onVictory/onWin effects, or a beat) to { do: 'end_game', ending: <a won ending> }" });
  return problems;
}
