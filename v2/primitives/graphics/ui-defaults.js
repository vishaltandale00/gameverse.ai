// Default UI and audio for any document. defaultGraphics(doc, registry)
// returns the graphics instances to add so a game that lists no UI still gets
// a sensible HUD, menu/pause, dialogue, journal, map, inventory, battle/card
// screens and sound, chosen from the systems the document actually uses
// (combat.health -> hp, plot.quest -> journal, gameplay.economy -> money...).
// Nothing game-specific: every rule keys off primitive ids, cards and data.

import { unclaimedChoices } from '../engine/runtime-lib-controls.js';
import { loopInstances, readsOf, winQuantity, endsGame } from '../../planner/loop.js';

const has = (registry, id) => (registry ? registry.has(id) : true);
const sysOf = (doc, id) => (doc.systems || []).find(s => s.use === id || s.use.startsWith(id + '.'));
const uses = (doc, id) => Boolean(sysOf(doc, id));
const actionsProvided = (doc, registry) => new Set((doc.systems || []).flatMap(s => registry?.get(s.use)?.card?.provides?.actions || []));

/** True when the document is a text/menu game (graph or none spaces and no world renderer). */
export function isTextual(doc) {
  const spatial = (doc.spaces || []).some(s => !/space\.(graph|none)$/.test(s.use || ''));
  // graphics.render.dom is the scene card above the story text, not a world renderer.
  const renderer = (doc.graphics || []).some(g => /graphics\.(render|camera)\./.test(g.use) && g.use !== DOM_RENDERER);
  return !spatial && !renderer;
}

// ---- World presentation: one renderer per space, the camera the view asks for, juice and post.
// Renderers follow the catalogue's naming: engine.space.<kind> is drawn by graphics.render.<kind>.
// Graph and none spaces (locations, cards, dialogue) are drawn by the DOM scene renderer.
const DOM_RENDERER = 'graphics.render.dom';
const DOM_SPACES = new Set(['engine.space.graph', 'engine.space.none']);
/** The renderer primitive id that draws a space, or null when the catalogue has none. */
export function rendererFor(space, registry) {
  const use = space?.use || '';
  const id = DOM_SPACES.has(use) ? DOM_RENDERER : use.startsWith('engine.space.') ? `graphics.render.${use.slice('engine.space.'.length)}` : null;
  return id && has(registry, id) ? id : null;
}
// three.js renderers host the 3D camera rig (their cards provide the `camera` service); canvas
// renderers carry a camera fitted to their space (board fit, fighter framing, follow with room lock),
// so a 2D camera primitive is added only for a projection they don't do by themselves.
const is3dRenderer = (registry, id) => (registry?.get(id)?.card?.provides?.services || []).includes('camera');
const CAMERA_VIEWS = { '3d': new Set(['1p', '3p', 'iso']), '2d': new Set(['iso']) };
const cardViews = (registry, id) => registry?.get(id)?.card?.views || [];
/** Camera primitive id for a renderer and view: a registered graphics.camera.* whose card lists the view and whose validator accepts the space. */
export function cameraFor(doc, space, renderer, view, registry) {
  if (!registry || !view || renderer === DOM_RENDERER) return null;
  if (!CAMERA_VIEWS[is3dRenderer(registry, renderer) ? '3d' : '2d'].has(view)) return null;
  if (!cardViews(registry, renderer).includes(view)) return null;
  for (const id of registry.ids('graphics').filter(i => i.startsWith('graphics.camera.'))) {
    if (!cardViews(registry, id).includes(view)) continue;
    const p = registry.get(id);
    let errs = [];
    try { errs = p.validate?.({}, doc, { warn() {} }, { space: space.id, path: 'graphics' }) || []; } catch { errs = [{ code: 'camera_check' }]; }
    if (!errs.length) return id;
  }
  return null;
}
/** Renderer, camera, particles, hit feedback and post for spaces the document's graphics leave undrawn. */
export function defaultWorldGraphics(doc, registry) {
  const listed = doc.graphics || [], spaces = doc.spaces || [], out = [];
  const listedUse = new Set(listed.map(g => g.use));
  const drawn = s => listed.some(g => /^graphics\.render\./.test(g.use) && (g.space ? g.space === s.id : g.use === rendererFor(s, registry)));
  const view = doc.views?.primary;
  let world = false;
  for (const s of spaces) {
    const r = rendererFor(s, registry);
    if (!r || drawn(s)) continue;
    out.push({ use: r, space: s.id, with: {} });
    if (r === DOM_RENDERER) continue;
    world = true;
    const cam = !listed.some(g => /^graphics\.camera\./.test(g.use)) && cameraFor(doc, s, r, view, registry);
    if (cam && !out.some(g => g.use === cam && g.space === s.id)) out.push({ use: cam, space: s.id, with: {} });
  }
  if (world) for (const id of ['graphics.particles', 'graphics.fx.feedback', 'graphics.post'])
    if (has(registry, id) && !listedUse.has(id)) out.push({ use: id, with: {} });
  return out;
}

// ---- The quantities a person watches: what the loops' win and lose read (card.loop win/lose reads; the win's is
// planner/loop.js winQuantity, the quantity the gate measures), as the end declares a person watches it:
//   end.shown  { var, max?, label? } | { bar } | [...] | (config, doc) => [...]: what shows it when that is not the read
//              itself (a measurement var, an event every racer emits); max a number, a var or { param } of the instance;
//   end.once   the end happens at the first occurrence of what it reads: there is no quantity to watch;
//   otherwise  the read: a var, an event's count (the won ending's target as its max) or a component of entities.
const titleCase = s => String(s).replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
/** The ending a document wins by testing an event count or a var, with its comparison target. */
const wonEnding = (doc, test) => (doc.plot?.endings || []).find(e => (e.outcome ?? 'won') === 'won' && e.when && test(e.when));
/**
 * HUD goals for a document: [{ end, use, var? | count? | component?, of? | bar?, max?, label? }], one per quantity, win first.
 * @param {any} doc @param {any} registry
 */
export function hudGoals(doc, registry) {
  if (!registry) return [];
  const loops = loopInstances(doc, registry), out = [], keys = new Set();
  const win = winQuantity(doc, registry), owner = win ? loops.find(l => l.use === win.use) : null;
  const ends = [...(owner ? [{ end: 'win', l: owner, e: owner.loop.win }] : []), ...loops.filter(l => l.loop.lose && endsGame(l.loop.lose) && readsOf(l.loop.lose)).map(l => ({ end: 'lose', l, e: l.loop.lose }))];
  for (const { end, l, e } of ends) {
    if (e.once) continue;
    const declared = typeof e.shown === 'function' ? e.shown(l.config, doc) : e.shown;
    let list;
    if (declared) list = Array.isArray(declared) ? declared : [declared];
    else {
      const rd = readsOf(e);
      if (rd.var) { const t = end === 'win' && win?.var === rd.var ? win.target : undefined; list = [{ var: rd.var, ...(t !== undefined ? { max: t } : {}) }]; }
      else if (rd.event) { const ending = wonEnding(doc, w => typeof w.count === 'string' && (w.count === rd.event || w.count.startsWith(rd.event + ':'))); const t = ending && ['gte', 'gt', 'eq'].find(k => typeof ending.when[k] === 'number'); list = [{ count: ending ? ending.when.count : rd.event, ...(t ? { max: ending.when[t] } : {}) }]; }
      else list = [{ component: rd.component, of: rd.of || 'opponents' }];
    }
    for (const q of list) {
      const max = q.max && typeof q.max === 'object' ? l.config[q.max.param] : q.max;
      const g = { end, use: l.use, ...q, ...(max !== undefined ? { max } : {}) };
      if (g.max === undefined) delete g.max;
      const key = JSON.stringify([g.var, g.count, g.component, g.of, g.bar]);
      if (keys.has(key)) continue;
      keys.add(key); out.push(g);
    }
  }
  return out;
}
/** Does a UI card's `displays` cover a goal (ui-battle shows every side's units' health). */
const displays = (card, g) => (card?.displays || []).some(d => (d.component && d.component === g.component && (d.of ?? g.of) === g.of) || (d.var && d.var === g.var) || (d.count && d.count === g.count));

/** HUD configuration derived from the document's systems and player archetype, and the loops' goal quantities. */
export function defaultHud(doc, registry = null, goals = hudGoals(doc, registry)) {
  const player = doc.content?.archetypes?.find(a => a.id === doc.player?.archetype)?.components || {};
  const meters = [], counters = [];
  const hpMax = player.health?.max;
  if (uses(doc, 'gameplay.combat.health') || player.health) {
    if (typeof hpMax === 'number' && hpMax <= 12) counters.push({ var: 'hp', icon: 'heart', pos: 'top-left' });
    else meters.push({ pool: 'hp', pos: 'top-left' });
  }
  const pools = sysOf(doc, 'gameplay.resource')?.with?.pools?.map(p => p.id) || Object.keys(player.resources || {});
  for (const id of pools) meters.push({ pool: id, pos: 'top-left' });
  for (const c of sysOf(doc, 'gameplay.economy')?.with?.currencies || []) counters.push({ var: c.var || `money.${c.id}`, icon: c.icon || c.id, label: c.name, pos: 'top-right' });
  for (const c of sysOf(doc, 'gameplay.collectible')?.with?.counters || []) if (c.var) counters.push({ var: c.var, icon: c.icon || c.id, label: c.name || c.id, pos: 'top-right' });
  const v = doc.views?.primary;
  return {
    meters, counters,
    ...(uses(doc, 'gameplay.score') ? { score: { var: 'score', label: 'Score', pos: 'top-center' } } : {}),
    ...(uses(doc, 'gameplay.wanted') ? { stars: { var: 'wanted', max: sysOf(doc, 'gameplay.wanted')?.with?.levels ?? 5, icon: 'star', pos: 'top-right' } } : {}),
    prompt: uses(doc, 'gameplay.interact') || uses(doc, 'plot.character'),
    clock: uses(doc, 'engine.time'),
    compass: (v === '3p' || v === '1p') && uses(doc, 'plot.quest'),
    status: uses(doc, 'gameplay.combat.status') || uses(doc, 'gameplay.combat.health'),
    bossBar: goals.some(g => g.bar === 'boss'),
    goals: goals.map(({ end, use, ...q }) => ({ end, use, ...q })),
    crosshair: v === '1p' ? 'dot' : 'none',
  };
}

/** Graphics instances to add for a document. Each category (world renderer, story, menu, HUD, dialogue,
 * journal, map, minimap, inventory, battle, cards, audio) is defaulted on its own: listing one UI primitive
 * keeps that one and still fills in the others the document's systems call for. */
export function defaultGraphics(doc, registry) {
  const listed = new Set((doc.graphics || []).map(g => g.use));
  const out = defaultWorldGraphics(doc, registry); // drawn beneath the UI, so mounted first
  const add = (use, w) => { if (has(registry, use) && !listed.has(use)) out.push({ use, with: w }); };
  const textual = isTextual(doc), acts = actionsProvided(doc, registry);
  const zones = (doc.spaces || []).flatMap(s => s.zones || []);
  const players = (doc.content?.archetypes || []).filter(a => a.kind === 'player');
  if (textual) add('graphics.ui.story', { style: 'auto' });
  add('graphics.ui.menu', { select: players.length > 1 && acts.has('select_character') ? [{ id: 'character', kind: 'character', action: 'select_character' }] : [] });
  if (!textual) add('graphics.ui.hud', defaultHud(doc, registry));
  if (!textual && ['plot.dialogue', 'plot.barks', 'plot.storyboard', 'plot.cutscene', 'plot.events.random'].some(id => uses(doc, id))) add('graphics.ui.dialogue', {});
  if (uses(doc, 'plot.quest') || uses(doc, 'plot.journal')) {
    const tags = new Set((doc.plot?.entries || []).map(e => e.tag || 'lore'));
    const tabs = [uses(doc, 'plot.quest') && 'quests', [...tags].some(t => !/note|bestiary/.test(t)) && 'lore', tags.has('bestiary') || (uses(doc, 'gameplay.combat') && (doc.content?.archetypes || []).some(a => a.kind === 'enemy' || a.kind === 'boss')) ? 'bestiary' : null, uses(doc, 'plot.character') && 'characters', [...tags].some(t => /note/.test(t)) && 'notes'].filter(Boolean);
    add('graphics.ui.journal', { tabs: tabs.length ? tabs : ['quests'] });
  }
  if (!textual && zones.length >= 3) add('graphics.ui.map', { fog: uses(doc, 'engine.zones') || zones.length > 6, fastTravel: acts.has('fast_travel') });
  const v = doc.views?.primary;
  if (!textual && zones.length >= 2 && ['3p', '1p', 'td', 'iso'].includes(v)) add('graphics.ui.minimap', { rotate: v === '3p' || v === '1p' });
  if (!textual && uses(doc, 'gameplay.inventory')) {
    const eq = sysOf(doc, 'gameplay.equipment')?.with;
    const panels = ['items',
      eq?.slots?.some(s => !(s.accepts || []).includes('charm')) && 'equipment',
      (eq?.budget || eq?.slots?.some(s => (s.accepts || []).includes('charm'))) && 'loadout',
      uses(doc, 'gameplay.crafting') && 'crafting',
      uses(doc, 'gameplay.container') && 'container',
      uses(doc, 'gameplay.economy') && 'shop',
      (uses(doc, 'gameplay.progression.abilities') || uses(doc, 'gameplay.progression.tree')) && 'skills'].filter(Boolean);
    add('graphics.ui.inventory', { panels });
  }
  if (uses(doc, 'gameplay.creature.battle') || uses(doc, 'gameplay.turns')) add('graphics.ui.battle', {});
  if (uses(doc, 'gameplay.cards')) add('graphics.ui.cards', {});
  if (![...listed].some(u => u.startsWith('graphics.audio.'))) add('graphics.audio.synth', {});
  // The loops' goal quantities go to the HUD unless another UI the document mounts displays them (card.displays: the
  // battle screen shows every side's health); a text or menu game mounts the HUD for the ones nothing else shows.
  const mounted = [...listed, ...out.map(g => g.use)].map(u => registry?.get(u)?.card).filter(Boolean);
  const goals = hudGoals(doc, registry).filter(g => !mounted.some(c => displays(c, g)));
  const hud = out.find(g => g.use === 'graphics.ui.hud');
  if (hud) hud.with = defaultHud(doc, registry, goals);
  else if (textual && goals.length) add('graphics.ui.hud', defaultHud(doc, registry, goals));
  // Every choice verb the document's loops declare (card.actionSpace 'choice') gets a control: the UI primitives above
  // issue the ones their card.controls name; graphics.ui.choices issues the rest from the game's options.
  if (unclaimedChoices({ ...doc, graphics: [...(doc.graphics || []), ...out] }, registry).length) add('graphics.ui.choices', {});
  return out;
}

/** The document's graphics plus the defaults it is missing (what a host should mount). */
export function withDefaultGraphics(doc, registry) { return [...(doc.graphics || []), ...defaultGraphics(doc, registry)]; }
