// A substantive first-playable world (ARCHITECTURE.md §4 step 2: "the world is generated procedurally
// from the outline's generator params"). A cell space the player moves through needs something in it:
// a document can be valid, verified and completable while its only space is an empty map, because
// zones are just rects and the solver walks along the map's solid edges. This module checks the booted
// world empirically (cells and entities, not a list of primitive ids) and, when a space is empty, adds a
// generator from the catalogue that fits it: one whose required capabilities the space provides and whose
// views fit the game, configured by the generator's own `scaffold(space, doc, {envelope})` hook (from the
// space's zones and the document's movement envelope) or, when it needs no required params, its defaults.
// Every candidate is preflighted and booted; the first that fills the space is kept. Zero model calls.
import { preflight } from '../kernel/document.js';
import { createWorld } from '../kernel/world.js';
import { movementEnvelope } from '../primitives/gameplay/move-lib-envelope.js';
import { defaultsOf, isGenerator, requirementsOf } from './catalog.js';

export const WORLD_VERSION = 'world/0.1';
const MAX_CELLS_SCANNED = 4e6;

/** Capabilities a space instance provides with its configuration. */
export function spaceCaps(registry, space) {
  const p = registry.get(space.use); if (!p) return [];
  const config = { ...defaultsOf(p.card), ...(space.with || {}) };
  try { return p.capabilities ? p.capabilities(config) : p.card.provides?.capabilities || []; } catch { return p.card.provides?.capabilities || []; }
}

const hasEnvelope = p => Boolean(p && (p.card?.envelope || p.envelope));
/**
 * Spaces whose world must not be empty: cell spaces (editCells) that a movement primitive moves
 * something through (a card with a movement envelope, bound to that space or to the first one).
 * A pure board or falling-block game with no movement primitive may legitimately start empty.
 */
export function spacesNeedingWorld(doc, registry) {
  const first = doc.spaces?.[0]?.id;
  const moved = new Set((doc.systems || []).filter(s => hasEnvelope(registry.get(s.use))).map(s => s.space ?? first));
  return (doc.spaces || []).map((space, index) => ({ space, index })).filter(({ space }) => moved.has(space.id) && needsWorld(registry, space));
}
/** A cell space (its terrain is cells) is spatial content the player needs; graph and none spaces are their zones. */
export const needsWorld = (registry, space) => spaceCaps(registry, space).includes('editCells');
/** Whether a primitive moves things through a space (its card has a movement envelope). */
export const isMovement = (registry, id) => hasEnvelope(registry.get(id));

/** Non-empty cells (any layer) plus entities other than the player in a booted space; null when it can't be measured. */
export function contentOf(rt, spaceId) {
  const api = rt.space(spaceId);
  if (!api) return null;
  const entities = Object.values(rt.state.entities).filter(e => e.space === spaceId && e.id !== 'player').length;
  let cells = null;
  const b = typeof api.bounds === 'function' ? api.bounds() : api.size ? { min: api.size.map(() => 0), max: api.size } : null;
  if (typeof api.cellsIn === 'function' && b?.min && b?.max && b.max.every(Number.isFinite)) {
    const volume = b.max.reduce((v, x, i) => v * Math.max(0, x - b.min[i]), 1);
    if (volume <= MAX_CELLS_SCANNED) {
      const box = [b.min, b.max.map(x => x - 1)];
      const layers = Array.isArray(api.layers) ? api.layers : [undefined];
      cells = 0;
      for (const l of layers) { cells += api.cellsIn(box, l).length; if (cells) break; }
    }
  }
  return { cells, entities };
}

/** Generators that could fill this space: required capabilities provided, views fitting the game; best first. */
export function generatorsFor(registry, space, view = null) {
  const caps = new Set(spaceCaps(registry, space));
  const spaceViews = new Set(registry.get(space.use)?.card.views || []);
  return registry.ids('engine').filter(isGenerator).map(id => {
    const p = registry.get(id), card = p.card;
    if (!requirementsOf(registry, id).capabilities.every(c => caps.has(c))) return null;
    const views = card.views || ['any'];
    if (!views.includes('any') && !views.some(v => spaceViews.has(v))) return null;
    const required = Object.entries(card.params || {}).some(([, s]) => s.required && s.default === undefined);
    if (typeof p.scaffold !== 'function' && required) return null;
    const score = (typeof p.scaffold === 'function' ? 10 : 0) + (view && views.includes(view) ? 4 : 0) + (views.includes('any') ? 1 : 0);
    return { id, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

const boot = (doc, registry, logic, seed, frames = 3) => {
  const rt = createWorld(doc, registry, logic, { seed });
  for (let i = 0; i < frames && rt.state.status === 'playing'; i++) rt.step();
  return rt;
};

/** world_empty problems for a booted world (stable code, verification-problem shape). */
export function worldProblems(rt, doc, registry) {
  const out = [];
  for (const { space, index } of spacesNeedingWorld(doc, registry)) {
    const c = contentOf(rt, space.id);
    if (!c || c.cells === null || c.cells > 0 || c.entities > 0) continue;
    const fits = generatorsFor(registry, space, doc.views?.primary).map(g => g.id);
    out.push({
      code: 'world_empty', path: `spaces[${index}]`, severity: 'error', stage: 'world', space: space.id,
      message: `space '${space.id}' (${space.use}) is empty: no generator and no authored cells or entities, so the player moves through a void`,
      hint: fits.length ? `add a generator in spaces[${index}].generators that builds the zones' terrain: ${fits.slice(0, 4).join(', ')}` : 'add authored content or a generator for this space',
    });
  }
  return out;
}

/**
 * furnishWorld(doc, registry, logic, { seed, rt? }) -> { doc, added: [{ space, use }], fixes, problems, ms }
 * Adds a fitting generator to every empty space that needs a world. Never mutates its input. `problems`
 * are the world_empty problems left (no candidate filled the space). A world that does not boot is left
 * to first-playable isolation and returned unchanged.
 */
export function furnishWorld(input, registry, logic, { seed, rt = null } = {}) {
  const started = performance.now();
  const done = (doc, added, fixes, problems) => ({ doc, added, fixes, problems, ms: Math.round(performance.now() - started), version: WORLD_VERSION });
  const pre = preflight(input, registry, logic);
  if (!pre.ok) return done(input, [], [], []);
  try { rt ??= boot(pre.doc, registry, logic, seed); } catch { return done(input, [], [], []); }
  const empty = worldProblems(rt, pre.doc, registry);
  if (!empty.length) return done(input, [], [], []);
  let doc = structuredClone(input);
  const added = [], fixes = [], left = [];
  for (const problem of empty) {
    const index = Number(/\[(\d+)\]/.exec(problem.path)[1]), space = doc.spaces[index];
    const gravity = Math.abs(Number(space.with?.gravity)) || undefined;
    const envelope = movementEnvelope(pre.doc, registry, doc.player?.abilities || [], gravity ? { gravity } : {});
    // The first candidate that fills the space with a clean generation proof wins; otherwise the filled one
    // whose generator reported the fewest error problems (unreachable rooms, a blocked start...).
    let kept = null;
    for (const cand of generatorsFor(registry, space, doc.views?.primary)) {
      const p = registry.get(cand.id);
      let made;
      try { made = typeof p.scaffold === 'function' ? p.scaffold(space, doc, { envelope, registry }) : { with: {} }; } catch { made = null; }
      if (!made) continue;
      const trial = structuredClone(doc), gen = { use: cand.id };
      (trial.spaces[index].generators ??= []).push(gen);
      applyScaffold(trial, index, gen, made);
      const p2 = preflight(trial, registry, logic);
      if (!p2.ok) continue;
      let filled = false, generation = [];
      try {
        const world = boot(p2.doc, registry, logic, seed), c = contentOf(world, space.id);
        filled = Boolean(c && (c.cells > 0 || c.entities > 0));
        generation = (world.service('generation')?.problems() || []).filter(x => x.severity === 'error');
      } catch { filled = false; }
      if (!filled) continue;
      if (!kept || generation.length < kept.generation.length) kept = { trial, use: cand.id, generation };
      if (!generation.length) break;
    }
    if (!kept) { left.push(problem); continue; }
    doc = kept.trial;
    added.push({ space: space.id, use: kept.use, problems: kept.generation.map(x => x.code) });
    fixes.push({ code: 'world_empty', path: `spaces[${index}].generators`, action: `added ${kept.use} to fill space '${space.id}'` });
  }
  return done(doc, added, fixes, left);
}

/** Apply a scaffold result (generator config, content additions, player start) to one generator instance of a document. */
function applyScaffold(doc, spaceIndex, gen, made) {
  if (Object.keys(made.with || {}).length) gen.with = { ...made.with, ...(gen.with || {}) };
  for (const [section, list] of Object.entries(made.content || {})) {
    doc.content ??= {};
    const have = Array.isArray(doc.content[section]) ? doc.content[section] : (doc.content[section] = []);
    for (const x of list) if (!have.some(h => h?.id === x.id)) have.push(x);
  }
  const space = doc.spaces[spaceIndex];
  if (Array.isArray(made.start) && doc.player && (doc.player.space ?? doc.spaces[0].id) === space.id) doc.player.at = made.start;
}

/**
 * Fill the params of generator instances that a selection added without them (the skeleton lists `{use}` only)
 * through each generator's `scaffold` hook. Mutates and returns `doc`; -> fixes.
 */
export function configureGenerators(doc, registry) {
  const fixes = [];
  (doc.spaces || []).forEach((space, i) => (space.generators || []).forEach((gen, j) => {
    const p = registry.get(gen.use), card = p?.card;
    if (typeof p?.scaffold !== 'function') return;
    const missing = Object.entries(card.params || {}).some(([k, s]) => s.required && s.default === undefined && gen.with?.[k] === undefined);
    if (!missing) return;
    const gravity = Math.abs(Number(space.with?.gravity)) || undefined;
    let made = null;
    try { made = p.scaffold(space, doc, { envelope: movementEnvelope(doc, registry, doc.player?.abilities || [], gravity ? { gravity } : {}), registry }); } catch { made = null; }
    if (!made) return;
    applyScaffold(doc, i, gen, made);
    fixes.push({ code: 'generator_scaffold', path: `spaces[${i}].generators[${j}]`, action: `configured ${gen.use} from the zones` });
  }));
  return fixes;
}
