// What a person must see to play a document, and whether the renderers the host mounts draw it (ARCHITECTURE §1.4:
// declared on cards, checked statically). Browser-safe: the host (ui-defaults.js), the renderers, the template contract
// (v2/templates/contract.js 'presentation' stage) and the publish gate (planner/verify-adapter.js) all read it.
//
//   card.loop.shows (or card.mode.shows)   what of the space the loop's play happens in a person must see to play it;
//                                           every loop card with a win or a lose declares it (empty: nothing of the
//                                           world, the loop is played through its UI);
//   card.draws (renderer cards)            what the renderer draws of the space it is bound to (a list, or a function
//                                           of the space instance).
//
// The things (DRAWS):
//   entities  every entity in the space, each by the role its kind and components declare (flat-art.js roleOf);
//   cells     the space's cells (on spaces with editCells), each block drawn distinguishably (its declared tile and color);
//   zones     the zones the loop's params name (ref to a zone: checkpoints, goals), with their names;
//   labels    the label a block declares (content.blocks[].label: a 2048 tile's number), drawn on its cells;
//   marks     per-cell state a primitive keeps outside cells and entities (crop stages), read from the service its card
//             names in card.marks (marks(spaceId) → [{ at, kind, stage, stages, ready }]).
import { cardLoop, loopInstances, loopSpaceFits } from '../../kernel/loop.js';

export const DRAWS = Object.freeze(['entities', 'cells', 'zones', 'labels', 'marks']);
export const PRESENTATION_CODES = Object.freeze({ missing: 'render_missing', undeclared: 'shows_undeclared' });

const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
/** What a loop card declares a person must see (card.loop.shows, else card.mode.shows), or null when it declares nothing. */
export function showsOf(card) {
  const v = card?.loop?.shows ?? card?.mode?.shows;
  return Array.isArray(v) ? v : null;
}
/** What a renderer card draws of a space instance, or null when it declares nothing. */
export function drawsOf(card, space) {
  const v = typeof card?.draws === 'function' ? card.draws(space) : card?.draws;
  return Array.isArray(v) ? v : null;
}
/** Does a loop card have to declare what it shows: it has a win or a lose (it is something a person plays toward). */
export const mustShow = card => { const l = cardLoop(card); return Boolean(l && (l.win || l.lose)); };

/** The capabilities a space instance provides (its card's provides.capabilities or capabilities(config)). */
function capsOf(registry, s) {
  const card = registry.get(s.use)?.card, p = registry.get(s.use);
  let caps = card?.provides?.capabilities || [];
  try { if (typeof p?.capabilities === 'function') caps = p.capabilities(s.with || {}) || caps; } catch { /* the declared list */ }
  return new Set(caps);
}

/**
 * The spaces a loop instance's play happens in: a generator's own space; else the document's spaces its card declares
 * it fits (card.loop.space / card.mode.space); else, for a loop that declares no space, the player's space.
 */
export function loopSpaces(doc, registry, l) {
  const spaces = Array.isArray(doc?.spaces) ? doc.spaces : [];
  const own = /^spaces\[(\d+)\]\.generators/.exec(l.path);
  if (own) return spaces[Number(own[1])] ? [spaces[Number(own[1])]] : [];
  if (!l.loop.space.length) { const p = spaces.find(s => s.id === doc?.player?.space) || spaces[0]; return p ? [p] : []; }
  return spaces.filter(s => typeof s.use === 'string' && loopSpaceFits(l.loop, s.use, capsOf(registry, s)));
}

/** The renderer instance the host mounts for a space: a graphics.render.* bound to it (by `space`, else the first one of its kind). */
export function rendererOf(doc, registry, space) {
  const gs = (doc?.graphics || []).filter(g => typeof g.use === 'string' && g.use.startsWith('graphics.render.'));
  return gs.find(g => g.space === space.id) || gs.find(g => !g.space && (registry.get(g.use)?.card?.spaces || []).includes(space.use)) || gs.find(g => !g.space && g.use === `graphics.render.${String(space.use).replace(/^engine\.space\./, '')}`) || null;
}

/** Values of params of type `ref` to `kind` in a config, walking lists and object fields as the card declares them. */
export function refsIn(spec, value, kind, out = []) {
  if (!spec || value == null) return out;
  if (spec.type === 'ref') { if (spec.to === kind && typeof value === 'string') out.push(value); return out; }
  if (spec.type === 'list' && Array.isArray(value)) { for (const v of value) refsIn(spec.of, v, kind, out); return out; }
  if (spec.type === 'object' && isObj(value)) { for (const [k, f] of Object.entries(spec.fields || {})) refsIn(f, value[k], kind, out); return out; }
  return out;
}

/** The zone ids the document's loops that show zones name in their params (what the renderers draw as zones). */
export function shownZones(doc, registry) {
  const out = new Set();
  for (const l of loopInstances(doc, registry)) {
    if (!(showsOf(l.card) || []).includes('zones')) continue;
    for (const [k, spec] of Object.entries(l.card.params || {})) for (const z of refsIn(spec, l.config[k], 'zone')) out.add(z);
  }
  return out;
}

/** The services the document's primitives name for marks (card.marks: { service }), in document order. */
export function markServices(doc, registry) {
  const out = [];
  for (const s of [...(doc?.systems || []), ...(doc?.spaces || []).flatMap(x => x.generators || [])]) {
    const m = registry.get(s?.use)?.card?.marks;
    if (isObj(m) && typeof m.service === 'string' && !out.includes(m.service)) out.push(m.service);
  }
  return out;
}

/**
 * Presentation problems of a document as the host mounts it (v2/web/host-doc.js hostDocument): for every loop instance,
 * each space its play happens in is drawn by a renderer that draws everything the loop shows.
 * -> [{ code, path, use, space, renderer, missing, message }]
 */
export function presentationProblems(doc, registry) {
  const out = [];
  for (const l of loopInstances(doc, registry)) {
    const shows = showsOf(l.card);
    if (!shows) {
      if (mustShow(l.card)) out.push({ code: PRESENTATION_CODES.undeclared, path: l.path, use: l.use, space: null, renderer: null, missing: [], message: `${l.use} has a win or lose and declares nothing a person must see to play it (card.loop.shows)` });
      continue;
    }
    if (!shows.length) continue;
    // Labels are what blocks declare: a loop showing them needs every block to declare one.
    const unlabelled = shows.includes('labels') ? (doc?.content?.blocks || []).filter(b => b.label == null || b.label === '').map(b => b.id) : [];
    if (unlabelled.length) out.push({ code: PRESENTATION_CODES.missing, path: l.path, use: l.use, space: null, renderer: null, missing: ['labels'], message: `${l.use} shows block labels and the blocks ${unlabelled.join(', ')} declare none (content.blocks[].label)` });
    for (const space of loopSpaces(doc, registry, l)) {
      const r = rendererOf(doc, registry, space);
      const draws = r ? drawsOf(registry.get(r.use)?.card, space) || [] : [];
      // Cells and their labels are a person's to see on a space that has cells (editCells): a dungeon generated on a
      // heightfield builds its walls as objects, which are its world, not cells.
      const cellular = capsOf(registry, space).has('editCells');
      const missing = shows.filter(x => !draws.includes(x) && (cellular || (x !== 'cells' && x !== 'labels')));
      if (missing.length) out.push({ code: PRESENTATION_CODES.missing, path: l.path, use: l.use, space: space.id, renderer: r?.use ?? null, missing, message: `${l.use} needs a person to see the ${missing.join(', ')} of space '${space.id}', which ${r ? `its renderer ${r.use} does not draw (card.draws: ${draws.join(', ') || 'nothing'})` : 'no renderer draws'}` });
    }
  }
  return out;
}
