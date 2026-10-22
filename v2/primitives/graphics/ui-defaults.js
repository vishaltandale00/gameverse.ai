// Default UI and audio for any document. defaultGraphics(doc, registry)
// returns the graphics instances to add so a game that lists no UI still gets
// a sensible HUD, menu/pause, dialogue, journal, map, inventory, battle/card
// screens and sound, chosen from the systems the document actually uses
// (combat.health -> hp, plot.quest -> journal, gameplay.economy -> money...).
// Nothing game-specific: every rule keys off primitive ids, cards and data.

import { unclaimedChoices } from '../engine/runtime-lib-controls.js';
import { loopInstances, readsOf, winQuantity, winOwner, endsGame, appliesTo, unwired, hostOf, compares, saysOf, fillSays } from '../../kernel/loop.js';

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

// ---- What a person plays toward and against: the loop ends of the document (playedEnds), each with the sentence it
// says (card.loop end.says: objectiveOf, the how-to-play Goal line) and the quantities a person watches for it (hudGoals,
// the HUD), what the end reads (card.loop win/lose reads; the win's is kernel/loop.js winQuantity, the quantity the gate
// measures) as the end declares a person watches it:
//   end.shown  { var, max?, label } | { bar, label } | [...]: what shows it when that is not the read itself (a
//              measurement var, an event every racer emits); max a number, a var or { param } of the instance (a list
//              param by its length);
//   end.once   the end happens at the first occurrence of what it reads: there is no quantity to watch;
//   otherwise  the read: a var, an event's count (the won ending's target as its max) or a component of entities,
//              labelled by end.label.
// A wrapper (card.mode.wraps) plays the wrapped loop part by part: the goal of the part in play (card.mode.parts) is shown
// and said; a part that sets none is won by the wrapped loop's own win (the owner among the other loops), shown and said.
/** The ending a document wins by testing an event count or a var, with its comparison target. */
const wonEnding = (doc, test) => (doc.plot?.endings || []).find(e => (e.outcome ?? 'won') === 'won' && e.when && test(e.when));
/** A number param of an instance, a list param by its length. */
const paramNumber = v => (Array.isArray(v) ? v.length : v);
/** The parts of a wrapper instance (card.mode.parts param) and each one's declared goal kind ({ says, label } or null). */
function partsOf(l) {
  const P = l.loop.parts;
  if (!P) return null;
  const parts = Array.isArray(l.config[P.param]) ? l.config[P.param] : [];
  return { P, parts, kinds: parts.map(p => P.kinds?.[p?.[P.goal]?.[P.kind]] ?? null) };
}
/**
 * The loop ends a person plays toward and against, win first: the loop owning the game's win (kernel/loop.js winOwner),
 * or, when none declares a game-ending win, each encounter win the document wires to a won ending (the encounter ends the
 * game); for a wrapper owner, the wrapped loop's win (`wrapped`), which a part setting no goal of its own is won by; then
 * every game-ending lose that applies to its instance. A loop another one runs on (card.mode.via: the card battle on the
 * turns) has that loop's ends, worded by it: the one played through it stands for it. -> [{ side: 'win' | 'lose', l, e, wrapped? }]
 */
function playedEnds(doc, registry, loops) {
  const played = new Map(loops.filter(l => l.loop.via).map(l => [l.loop.via, l]));
  const as = l => played.get(l.use) ?? l, out = [], seen = new Set();
  const push = (side, l, extra = {}) => { const p = as(l), e = p.loop[side]; if (!e || seen.has(`${side} ${p.use}`)) return; seen.add(`${side} ${p.use}`); out.push({ side, l: p, e, ...extra }); };
  const owner = winOwner(doc, registry, loops, null);
  for (const l of owner ? [owner] : loops.filter(l => l.loop.win && !unwired(doc, l, l.loop.win, 'won', registry))) push('win', l);
  if (owner?.loop.wraps) {
    const inner = winOwner(doc, registry, loops.filter(x => !x.loop.wraps), null);
    if (inner) push('win', inner, { wrapped: true });
  }
  for (const l of loops) if (!played.has(l.use) && l.loop.lose && endsGame(l.loop.lose) && appliesTo(l.loop.lose.applies, l.config) && !repurposed(doc, registry, l, l.loop.lose, 'lost')) push('lose', l);
  return out;
}
/**
 * Does the document give an end's effects param (on the instance, or its card.mode.via host) effects that end no game
 * with this outcome? Then the end is not the game's: a nested game makes an inner loop's lose the encounter's result
 * (engine.adapt.nested). A param the document leaves to the card's default keeps the card's own ending.
 */
function repurposed(doc, registry, l, end, outcome) {
  if (typeof end.param !== 'string') return false;
  const w = hostOf(doc, l)?.with;
  return Boolean(w) && w[end.param.split('.')[0]] !== undefined && unwired(doc, l, end, outcome, registry) !== null;
}
/** The quantities a person watches for one loop end: [{ end, use, var? | count? | component?, of? | bar?, max? | maxVar?, label? }]. */
function endGoals(doc, side, l, e, win) {
  if (e.once) return [];
  let list;
  if (e.shown !== undefined) list = (Array.isArray(e.shown) ? e.shown : [e.shown]).flatMap(q => shownEntries(q, l.config));
  else {
    const rd = readsOf(e);
    if (!rd) return [];
    const label = typeof e.label === 'string' ? { label: e.label } : {};
    if (rd.var) { const t = side === 'win' && win?.use === l.use && win?.var === rd.var ? win.target : undefined; list = [{ var: rd.var, ...label, ...(t !== undefined ? { max: t } : {}) }]; }
    else if (rd.event) { const ending = side === 'win' ? wonEnding(doc, w => typeof w.count === 'string' && (w.count === rd.event || w.count.startsWith(rd.event + ':'))) : null; const t = ending && ['gte', 'gt', 'eq'].find(k => typeof ending.when[k] === 'number'); list = [{ count: ending ? ending.when.count : rd.event, ...label, ...(t ? { max: ending.when[t] } : {}) }]; }
    else list = [{ component: rd.component, of: rd.of || 'opponents', ...label }];
  }
  // The target, as graphics.ui.hud declares a goal's: a number (given, or the instance's { param }) is max, a var name is maxVar.
  return list.map(q => {
    const { max: given, ...rest } = q;
    const max = given && typeof given === 'object' ? paramNumber(l.config[given.param]) : given;
    return { end: side, use: l.use, ...rest, ...(typeof max === 'number' ? { max } : typeof max === 'string' ? { maxVar: max } : {}) };
  });
}
/**
 * The ends a person plays toward and against with their quantities: [{ side, l, e, goals, part?, wrapped? }]. A wrapper's
 * entry carries `part`: its parts' goal quantity (the vars card.mode.parts names, labelled per part by its goal kind); the
 * wrapped loop's entry is kept only when some part sets no goal of its own (those parts its win decides).
 */
function playedGoals(doc, registry) {
  const loops = loopInstances(doc, registry), win = winQuantity(doc, registry);
  const ends = playedEnds(doc, registry, loops).map(x => ({ ...x, goals: endGoals(doc, x.side, x.l, x.e, win) }));
  const wrapper = ends.find(x => x.side === 'win' && !x.wrapped && x.l.loop.parts), parts = wrapper ? partsOf(wrapper.l) : null;
  if (parts) {
    const labels = parts.kinds.map(k => k?.label ?? '');
    if (labels.some(Boolean)) wrapper.part = { end: 'win', use: wrapper.l.use, var: parts.P.value, maxVar: parts.P.target, labels, index: parts.P.index };
  }
  return ends.filter(x => !x.wrapped || !parts || parts.kinds.some(k => !k));
}
/**
 * HUD goals for a document: [{ end, use, var? | count? | component?, of? | bar?, max? | maxVar?, label? | labels + index }],
 * one per quantity, win first.
 * @param {any} doc @param {any} registry
 */
export function hudGoals(doc, registry) {
  if (!registry) return [];
  const out = [], keys = new Set();
  for (const x of playedGoals(doc, registry)) for (const g of [...x.goals, ...(x.part ? [x.part] : [])]) {
    const key = JSON.stringify([g.var, g.count, g.component, g.of, g.bar]);
    if (keys.has(key)) continue;
    keys.add(key); out.push(g);
  }
  return out;
}

/**
 * The objective a person is told (the how-to-play Goal line, graphics/ui-menu.js): the sentences the document's loop ends
 * say (card.loop end.says), win first and then lose, placeholders filled from the instance (its params; {target} and
 * {label} from the quantity a person watches for the end, as hudGoals derives it). A wrapper says the goal of the part in
 * play (from `vars`, the state's, else its first part) before its own; a part setting no goal says the wrapped loop's win.
 * `missing` names every end that says nothing where it should (no `says` declared, a placeholder with no value): text a
 * person would not get. The one function every screen that tells the objective reads; `text` is the line as shown.
 * @param {any} doc @param {any} registry @param {Record<string, unknown> | null} [vars]
 * @returns {{ win: string[], lose: string[], text: string, missing: string[] }}
 */
export function objectiveOf(doc, registry, vars = null) {
  const out = { win: [], lose: [], missing: [] };
  if (!registry) return { ...out, text: '' };
  const add = (side, t) => { if (t && !out[side].includes(t)) out[side].push(t); };
  const ends = playedGoals(doc, registry);
  const said = x => {
    if (x.e.says === undefined) { out.missing.push(`${x.l.use} ${x.side}: declares no says`); return []; }
    const text = saysOf(x.e, x.l.config);
    if (!text) return []; // its declared condition does not hold: the instance has no such end
    const params = Object.fromEntries(Object.entries(x.l.config).filter(([, v]) => typeof v === 'number' || Array.isArray(v)));
    const per = /\{(target|label)\}/.test(text) && x.goals.length ? x.goals : [null];
    return per.map(g => {
      const target = !g ? undefined : typeof g.max === 'number' ? g.max : vars && typeof vars[g.maxVar] === 'number' ? vars[g.maxVar] : undefined;
      const t = fillSays(text, { ...params, ...(target !== undefined ? { target } : {}), ...(g?.label ? { label: g.label } : {}) });
      if (t === null) out.missing.push(`${x.l.use} ${x.side}: '${text}' has a placeholder with no value`);
      return t;
    }).filter(Boolean);
  };
  // The goal of the part in play (null when that part sets none: the wrapped loop's win decides it).
  const partSaid = x => {
    const p = partsOf(x.l);
    if (!p || !p.parts.length) return null;
    const at = vars && typeof vars[p.P.index] === 'number' ? vars[p.P.index] : Number(x.l.config[p.P.start] ?? 0);
    const i = Math.min(Math.max(0, Math.trunc(at)), p.parts.length - 1), kind = p.kinds[i];
    if (!kind) return null;
    const goal = p.parts[i]?.[p.P.goal] || {};
    const t = fillSays(kind.says, Object.fromEntries(Object.entries(goal).filter(([, v]) => typeof v === 'number')));
    if (t === null) out.missing.push(`${x.l.use} part ${i + 1}: '${kind.says}' has a placeholder with no value`);
    return t;
  };
  const wrapped = ends.find(x => x.wrapped);
  for (const x of ends) {
    if (x.wrapped) continue;
    if (x.side === 'win' && x.l.loop.wraps) { const part = partSaid(x); if (part) add('win', part); else if (wrapped) for (const t of said(wrapped)) add('win', t); }
    for (const t of said(x)) add(x.side, t);
  }
  return { ...out, text: [...out.win, ...out.lose].join(' · ') };
}
/**
 * The entries a declared `shown` stands for on an instance: itself, or one per entry of a list param (`each: { param,
 * where? }`, the entry's fields matching `where`) with `$id` in its strings replaced by that entry's id and `$name` by its
 * declared name (display text; '' when it declares none). Data only.
 */
function shownEntries(q, config) {
  if (!q || typeof q !== 'object' || !compares(q.applies, config)) return [];
  const { each, applies: _, ...rest } = q;
  if (!each) return [rest];
  const sub = (v, x) => (typeof v === 'string' ? v.replaceAll('$id', String(x.id)).replaceAll('$name', typeof x.name === 'string' ? x.name : '') : v);
  return (Array.isArray(config[each.param]) ? config[each.param] : []).filter(x => x && Object.entries(each.where || {}).every(([k, v]) => x[k] === v))
    .map(x => Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, sub(v, x)])));
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
  for (const c of sysOf(doc, 'gameplay.economy')?.with?.currencies || []) counters.push({ var: c.var || `money.${c.id}`, icon: c.icon || 'coin', label: c.name || '', pos: 'top-right' });
  for (const c of sysOf(doc, 'gameplay.collectible')?.with?.counters || []) if (c.var) counters.push({ var: c.var, icon: c.icon || null, label: c.name || '', pos: 'top-right' });
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
  if (uses(doc, 'plot.quest') || uses(doc, 'plot.journal') || uses(doc, 'plot.investigation')) {
    const tags = new Set((doc.plot?.entries || []).map(e => e.tag || 'lore'));
    const tabs = [uses(doc, 'plot.quest') && 'quests', uses(doc, 'plot.investigation') && 'clues', [...tags].some(t => !/note|bestiary/.test(t)) && 'lore', tags.has('bestiary') || (uses(doc, 'gameplay.combat') && (doc.content?.archetypes || []).some(a => a.kind === 'enemy' || a.kind === 'boss')) ? 'bestiary' : null, uses(doc, 'plot.character') && 'characters', [...tags].some(t => /note/.test(t)) && 'notes'].filter(Boolean);
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
