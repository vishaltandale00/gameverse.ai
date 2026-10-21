// @ts-check
// Core-loop invariant (publish gate, alongside "the playtest must not crash" and the content contracts):
// a published game must be the game the idea asked for. Every core mechanic keeps the primitives it was
// mapped to, and something wires a win to an ending. Problems carry stable codes
// and paths so outline repair can send them back to the model.
import { isSpace, isGenerator } from './catalog.js';
import { isObj, list, objects, strings, prop, isStr } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').Problem & { severity: 'error' }} CoreLoopProblem */

// The document may be a draft from model output (before or after preflight): read as unknown.
/** @param {Record<string, unknown>} doc @returns {Set<string>} */
const used = doc => new Set([...list(doc.systems), ...list(doc.graphics), ...list(doc.spaces).flatMap(s => [s, ...list(prop(s, 'generators'))])].map(x => prop(x, 'use')).filter(isStr).filter(Boolean));

/** Effects lists anywhere in the document that end the game with a win. @param {Record<string, unknown>} doc */
function winsWired(doc) {
  const endings = new Map(objects(prop(doc.plot, 'endings')).map(e => [e.id, e]));
  /** @param {Record<string, unknown>} e */
  const wins = e => e.do === 'end_game' && (e.outcome === 'won' || (e.ending && (endings.get(e.ending)?.outcome ?? 'won') === 'won') || (!e.outcome && !e.ending));
  let found = false;
  /** @param {unknown} v */
  const walk = v => { if (found) return; if (Array.isArray(v)) { for (const x of v) walk(x); return; } if (!isObj(v)) return; if (wins(v)) { found = true; return; } for (const x of Object.values(v)) walk(x); };
  walk(doc);
  return found;
}

/**
 * coreLoopProblems(doc, mechanics, registry) -> [{ code, path, message, hint, severity: 'error' }]
 * mechanics: selection.mechanics ({ id, description, importance, primitives[] }).
 * @param {unknown} doc @param {unknown} mechanics @param {RegistryLike} registry @returns {CoreLoopProblem[]}
 */
export function coreLoopProblems(doc, mechanics, registry) {
  /** @type {CoreLoopProblem[]} */
  const problems = [];
  if (!isObj(doc)) return problems;
  const have = used(doc);
  const core = objects(mechanics).filter(m => m.importance === 'core');
  /** @type {Set<string>} */
  const needed = new Set();
  for (const m of core) {
    // Spaces and generators are the world; the mechanic itself lives in its gameplay/plot primitives.
    const ids = strings(m.primitives).filter(id => registry.has(id) && !isSpace(id) && !isGenerator(id));
    for (const id of ids) {
      if (have.has(id)) { needed.add(id); continue; }
      problems.push({ code: 'core_primitive_missing', path: 'systems', severity: 'error', message: `core mechanic "${m.description}" needs ${id}, which the game does not use`, hint: `add { use: '${id}' } and configure it; do not replace it with another mechanic` });
    }
  }
  // Content is checked by the cards' content contracts (planner/content.js populateProblems), which know what each primitive requires.
  if (core.length && !winsWired(doc)) problems.push({ code: 'win_unwired', path: 'plot.endings', severity: 'error', message: 'nothing in the game ends it with a win', hint: "wire the core loop's victory (e.g. the mechanic's onVictory/onWin effects, or a beat) to { do: 'end_game', ending: <a won ending> }" });
  return problems;
}
