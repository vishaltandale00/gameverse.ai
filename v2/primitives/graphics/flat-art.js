// Generated art for entities with no art data: the shared procedural painters
// in v2/art (six character body plans, props, scenery) rasterized for canvas.
// The archetype's declared kind and the roles its components' cards declare pick
// its role; a variation seeded by its id picks body plan, parts and colors, so a
// document with zero art still shows a cast that reads at a glance.
// SVGs are rasterized through Blob URLs (the CSP allows blob: images) and
// cached per look and pose; until an image decodes, callers draw a placeholder.
import { paintCharacter, POSE_NAMES } from '../../art/characters.js';
import { paintProp, PROPS } from '../../art/props.js';
import { paintScenery, THEMES } from '../../art/scenery.js';
import { rng, seedOf, hash, surface, ctx2d } from './flat-util.js';

const images = new Map();
const canRaster = () => typeof Image !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL;

/** A decoded image for an SVG (made on first request) or null while it loads / in Node. */
export function svgImage(key, make) {
  let e = images.get(key);
  if (!e) {
    e = { img: null, ready: false, box: null };
    images.set(key, e);
    if (canRaster()) {
      try {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => { e.ready = true; e.box = opaqueBox(img); };
        img.onerror = () => { e.failed = true; };
        img.src = URL.createObjectURL(new Blob([make()], { type: 'image/svg+xml' }));
        e.img = img;
      } catch { e.failed = true; }
    }
  }
  return e.ready ? e : null;
}
/** Opaque bounding box of an image as fractions [x0,y0,x1,y1]. */
function opaqueBox(img) {
  const N = 64, c = surface(N, N), g = ctx2d(c);
  if (!g?.getImageData) return [0, 0, 1, 1];
  try {
    g.drawImage(img, 0, 0, N, N);
    const a = g.getImageData(0, 0, N, N).data;
    let x0 = N, y0 = N, x1 = -1, y1 = -1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (a[(y * N + x) * 4 + 3] > 24) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return x1 >= x0 ? [x0 / N, y0 / N, (x1 + 1) / N, (y1 + 1) / N] : [0, 0, 1, 1];
  } catch { return [0, 0, 1, 1]; }
}

// ---------- roles ----------
// What an entity reads as comes from declarations, never from words in its id, name or tags (ARCHITECTURE §1.2: the
// content forms theme `name`, so a themed name must never change artwork): the role its archetype's declared `kind`
// reads as and the roles its components present (card.presents: { <component>: P | [P...] } on the card owning the
// component, or on a card whose param of type ref to an archetype names it, P = { role, prop?, vector?, when? }: the first P whose `when` fields the component matches, `true` matching any
// set value), the highest in precedence; with neither, a prop.
export const ROLES = Object.freeze(['player', 'enemy', 'boss', 'npc', 'pickup', 'hazard', 'goal', 'projectile', 'vehicle', 'mount', 'prop']);
/** The role each declared archetype kind (planner/outline-form.js ARCH_KINDS) reads as. */
const KIND_ROLE = Object.freeze({ player: 'player', npc: 'npc', creature: 'enemy', enemy: 'enemy', boss: 'boss', vehicle: 'vehicle', prop: 'prop', projectile: 'projectile', pickup: 'pickup', mount: 'mount' });
/** When an entity's kind and components present several roles, the first of these wins. */
const PRECEDENCE = ['boss', 'projectile', 'vehicle', 'mount', 'goal', 'hazard', 'pickup', 'enemy', 'npc', 'prop'];
const presented = new WeakMap();
/** component → [{ role, prop?, when?, by }] from every card's `presents` (cached per registry). */
export function presentations(registry) {
  if (!registry || typeof registry.cards !== 'function') return new Map();
  let m = presented.get(registry);
  if (m) return m;
  m = new Map();
  const refParam = (c, k) => c.params?.[k]?.type === 'ref' && c.params[k].to === 'archetype';
  for (const c of registry.cards()) for (const [comp, v] of Object.entries(c.presents || {})) if (!refParam(c, comp)) m.set(comp, (Array.isArray(v) ? v : [v]).filter(p => p && ROLES.includes(p.role)).map(p => ({ ...p, by: c.id })));
  presented.set(registry, m);
  return m;
}
const byDoc = new WeakMap();
/**
 * archetype id → [P] for archetypes a system's param names, from `presents` keys that are a card param of type
 * `ref` to an archetype (sports `ball`: the archetype that param names on the instance is drawn as declared).
 */
export function paramPresentations(doc, registry) {
  if (!doc || !registry || typeof registry.get !== 'function') return new Map();
  let m = byDoc.get(doc)?.get(registry);
  if (m) return m;
  m = new Map();
  for (const inst of [...(doc.systems || []), ...(doc.spaces || []).flatMap(s => s.generators || [])]) {
    const card = registry.get(inst?.use)?.card;
    for (const [key, v] of Object.entries(card?.presents || {})) {
      const param = card.params?.[key];
      if (param?.type !== 'ref' || param.to !== 'archetype' || typeof inst.with?.[key] !== 'string') continue;
      m.set(inst.with[key], (Array.isArray(v) ? v : [v]).filter(p => p && ROLES.includes(p.role)).map(p => ({ ...p, by: card.id })));
    }
  }
  if (!byDoc.has(doc)) byDoc.set(doc, new WeakMap());
  byDoc.get(doc).set(registry, m);
  return m;
}
const matches = (when, value) => !when || Object.entries(when).every(([k, v]) => (v === true ? value?.[k] != null && value[k] !== false : value?.[k] === v));
/** The presentation an entity's kind and components declare (highest precedence), or null. */
export function presentationOf(arch = {}, registry = null, components = null, doc = null) {
  const P = presentations(registry), comps = { ...(arch.components || {}), ...(components || {}) };
  const found = Object.entries(comps).map(([k, value]) => (P.get(k) || []).find(p => matches(p.when, value))).filter(Boolean);
  found.push(...(paramPresentations(doc, registry).get(arch.id) || []));
  if (KIND_ROLE[arch.kind]) found.push({ role: KIND_ROLE[arch.kind], by: 'kind' });
  found.sort((a, b) => PRECEDENCE.indexOf(a.role) - PRECEDENCE.indexOf(b.role));
  return found[0] || null;
}
/** The cast role of an archetype: the highest-precedence role its kind and components declare, else 'prop'. */
export function roleOf(arch = {}, id = arch.id, registry = null, components = null, doc = null) {
  if (id === 'player') return 'player';
  return presentationOf(arch, registry, components, doc)?.role || 'prop';
}

// ---------- character looks ----------
// A declared look (content.models / components.model, kind 'art' with `look`) is drawn as declared; without one the
// look is a variation seeded by the archetype id (stable per archetype, independent of its name).
const PLANS = ['biped', 'blob', 'flyer', 'quadruped', 'robot', 'ghost'];
const HEADWEAR = ['none', 'none', 'none', 'crown', 'helmet', 'wizard-hat', 'bandana', 'horns', 'hood', 'cap'];
const HELD = ['none', 'none', 'none', 'sword', 'hammer', 'staff', 'blaster', 'shield'];
const FRIENDLY = ['#3a7bd5', '#e8742a', '#2ea84a', '#d8352a', '#9b5cff', '#f0b429', '#1fb5a8', '#ff6fa0'];
const MENACE = ['#6a2a8a', '#3a3a4a', '#8a2a2a', '#2a5a3a', '#5a3a2a', '#2a3a6a', '#7a1a3a', '#4a4a1a'];
const SKIN = ['#f2d2a9', '#e8b48c', '#c8906a', '#8a5a3c', '#f5dcc4', '#d8a878'];

/** A normalizeLook()-compatible character look for an archetype: a variation seeded by its id. */
export function lookFor(arch = {}, role = roleOf(arch), colors = null) {
  const r = rng(seedOf(arch.id || role)), pick = a => a[Math.floor(r() * a.length)];
  const hostile = role === 'enemy' || role === 'boss';
  const body = hostile && role !== 'boss' ? pick(PLANS) : 'biped';
  const primary = colors?.primary || pick(hostile ? MENACE : FRIENDLY);
  return {
    body, build: role === 'boss' ? 'stocky' : pick(['chibi', 'chibi', 'normal', 'stocky']),
    colors: { primary, secondary: colors?.secondary || (body === 'biped' ? pick(SKIN) : '#f0e8d8'), accent: colors?.accent || pick(hostile ? ['#ff3b3b', '#f0c020', '#9cff3a'] : ['#f5c542', '#ffffff', '#3ad0e8', '#ff5a7a']), eye: colors?.eye || (hostile ? '#ff3b3b' : pick(['#1f8a4c', '#2a5ad8', '#3a2a10'])), hair: colors?.hair || pick(['#3a2418', '#1a1418', '#e8c040', '#c84a2a']) },
    eyes: hostile ? pick(['angry', 'angry', 'visor', 'cyclops']) : pick(['cartoon', 'cartoon', 'dots']),
    headwear: body === 'biped' ? pick(HEADWEAR) : 'none', held: body === 'biped' ? pick(HELD) : 'none',
    ears: body === 'quadruped' ? pick(['pointed', 'round', 'floppy']) : r() < 0.25 ? pick(['pointed', 'round']) : 'none',
    snout: body === 'quadruped' ? 'muzzle' : body === 'flyer' ? 'beak' : r() < 0.3 ? pick(['nose', 'muzzle']) : 'none',
    tail: body === 'quadruped' ? pick(['fluffy', 'thin', 'spiky']) : 'none',
    top: body === 'biped' && r() < 0.5 ? pick(['tuft', 'spikes', 'long-hair', 'mohawk']) : 'none',
    accessory: role === 'boss' ? 'cape' : r() < 0.2 ? pick(['scarf', 'belt', 'backpack']) : 'none',
    feet: body === 'quadruped' ? 'paws' : pick(['shoes', 'boots']), hands: hostile && r() < 0.4 ? 'claws' : 'gloves',
  };
}
/** The prop a declared item kind (planner/outline-form.js ITEM_KINDS) is drawn as when it lies in the world. */
const ITEM_PROP = Object.freeze({ currency: 'coin', key: 'key', food: 'fruit', potion: 'heart', charm: 'ring', quest: 'scroll', material: 'crystal', ammo: 'battery', tool: 'star', weapon: 'star', armor: 'shell', block: 'gem', prop: 'gem', misc: 'gem' });
/**
 * A prop kind (v2/art/props) for an archetype of a prop-like role: the one its components' card declares
 * (card.presents prop), else for a pickup of an item the prop its declared item kind is drawn as, else a pick seeded
 * by the archetype id among the role's props.
 */
export function propFor(arch = {}, role = roleOf(arch), registry = null, doc = null) {
  const declared = presentationOf(arch, registry, null, doc)?.prop;
  if (declared && Object.values(PROPS).some(l => l.includes(declared))) return declared;
  const itemId = arch.components?.pickup?.item ?? arch.components?.collectible?.item;
  const kind = itemId && (doc?.content?.items || []).find(i => i.id === itemId)?.kind;
  if (role === 'pickup' && ITEM_PROP[kind]) return ITEM_PROP[kind];
  const list = PROPS[role === 'prop' ? 'decor' : role] || PROPS.pickup;
  return list[Math.floor(hash(seedOf(arch.id || 'x')) * list.length)];
}

// ---------- images ----------
const lookKey = look => JSON.stringify(look);
/** Image entry for a character pose (null until decoded). */
export function characterImage(look, pose, pixel = false) {
  const p = POSE_NAMES.includes(pose) ? pose : 'idle';
  return svgImage(`c|${lookKey(look)}|${p}|${pixel}`, () => paintCharacter(look, p, { pixel }));
}
export function propImage(kind, color, pixel = false) { return svgImage(`p|${kind}|${color || ''}|${pixel}`, () => paintProp(kind, { color, pixel })); }
export function sceneryImage(opts, pixel = false, seed = 'scenery') { return svgImage(`s|${JSON.stringify(opts)}|${pixel}|${seed}`, () => paintScenery(opts, { pixel, seed })); }

/** Pose name for a presentation state over time (art characters have 9 poses). */
export function poseFor(state, t, speed = 1) {
  switch (state) {
    case 'run': case 'walk': case 'dash': return ['runA', 'runB', 'runC', 'runD'][Math.floor(t * (state === 'walk' ? 7 : 10) * Math.max(0.6, Math.min(1.8, speed))) % 4];
    case 'jump': return 'jump';
    case 'fall': return 'fall';
    case 'hurt': case 'die': return 'hurt';
    case 'attack': return 'runA';
    default: return Math.floor(t * 1.6) % 2 ? 'idleB' : 'idle';
  }
}
/**
 * The scenery theme of a space: the one its instance declares (`scenery`, engine/spaces2d-scenery.js: chosen for the
 * idea's theme by the content form), never guessed from words in the title, logline, names or tags, and never a
 * default; null when it declares none (the renderers then paint no scenery).
 * @param {any} doc @param {string | null | undefined} spaceId
 * @returns {string | null}
 */
export function themeFor(doc, spaceId) {
  const s = (doc?.spaces || []).find(x => x.id === spaceId), t = s?.with?.scenery;
  return THEMES.includes(t) ? t : null;
}
