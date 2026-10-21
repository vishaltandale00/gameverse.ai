// Host defaults for engine.input.actions: every document the player mounts gets a device -> verb mapping
// for its primary view, so a generated game whose input instance is missing, or lists verbs without
// bindings, is still playable from the keyboard, a gamepad and (on touch devices) the screen.
// - A missing engine.input.actions is added when any system offers device-style actions.
// - Device-style actions the systems provide but the verbs omit are added (rotate_cw for falling pieces...).
// - Verbs with no binding in the primary view get conventional keys that are still free in that view;
//   existing bindings are never changed. UI verbs (menu, inventory, journal, map) are left to the UI's own
//   hotkeys, and those hotkeys' keys are kept free.
// The conventions are keyed by verb name (shared vocabulary across primitives), never by game.
import { expand, AXES, deviceOf } from '../primitives/engine/runtime-lib-input.js';

const INPUT = 'engine.input.actions';
const UI_VERBS = new Set(['menu', 'pause', 'inventory', 'journal', 'map']);
const UI_KEYS = new Set(['esc', 'p', 'i', 'j', 'm', 'tab', 'enter']); // ui-input OPEN_KEYS and modal navigation
const FIRST_PERSON = new Set(['1p', '3p']);

// Candidate keys per verb, in preference order: [2D views, 3D views]. A string list applies to both.
const KEYS = {
  jump: ['space', 'z', 'pad_a'], glide: ['space', 'pad_a'], fly: ['space', 'pad_a'], ascend: ['space', 'pad_a'],
  attack: [['x', 'k', 'pad_x'], ['lmb', 'pad_x']], fire: [['c', 'l', 'rb'], ['lmb', 'rt']], shoot: [['c', 'l', 'rb'], ['lmb', 'rt']],
  heavy: ['v', 'pad_y'], special: ['f', 'rb'], throw: ['g', 'lb'], block: ['q', 'lb'], takedown: ['f', 'pad_y'],
  aim: [[], ['rmb', 'lt']], lock: ['f', 'rstick_press'], lockon: ['f', 'rstick_press'],
  dash: ['shift', 'pad_b'], dodge: ['shift', 'pad_b'], sprint: ['shift', 'lb'], run: ['shift', 'lb'],
  crouch: ['c', 'ctrl', 'pad_b'], slide: ['c', 'ctrl', 'pad_b'], descend: ['c', 'ctrl'], dive: ['c', 'ctrl'], climb: ['e', 'pad_y'],
  interact: ['e', 'pad_y'], use: ['e', 'pad_y'], talk: ['e', 'pad_y'], grab: ['e', 'pad_y'], mount: ['e', 'pad_y'],
  use_portal: ['e', 'pad_y'], enter_vehicle: ['e', 'pad_y'], exit_vehicle: ['e', 'pad_y'], use_item: ['q', 'dpad_down'],
  mine: [['x', 'k'], ['lmb', 'rt']], place: [['c', 'v', 'l'], ['rmb', 'lt']], build: ['b'], demolish: ['n'],
  hotbar: ['1-9'], cast: ['f', 'rb'], heal: ['h', 'dpad_down'], cover: ['q', 'lb'], sense: ['v'], rewind: ['r', 'lb'],
  shift_left: ['left', 'a', 'q'], shift_right: ['right', 'd', 'e'], soft_drop: ['down', 's', 'f'], hard_drop: ['space', 'w', 'r'],
  rotate_cw: ['up', 'x', 'k'], rotate_ccw: ['z', 'l'], hold: ['c', 'shift', 'h'],
  up: ['up', 'w', 'dpad_up'], down: ['down', 's', 'dpad_down'], left: ['left', 'a', 'dpad_left'], right: ['right', 'd', 'dpad_right'],
  paddle_left: ['left', 'a'], paddle_right: ['right', 'd'], launch: ['space', 'pad_a'], thrust: ['up', 'w', 'pad_a'],
  hyperspace: ['shift', 'pad_b'], focus: ['shift', 'lb'], swap: ['space', 'pad_a'], end_turn: ['space', 'start'],
  horn: ['h'], call: ['c'], call_mount: ['c'], swap_camera: ['f5'], skip_cutscene: ['backspace'],
};
// Verbs that may share keys because they never apply at once (input-actions shareKeys).
const SHARE = [['interact', 'use', 'talk', 'grab', 'mount', 'climb', 'use_portal', 'enter_vehicle', 'exit_vehicle'], ['jump', 'glide', 'fly', 'ascend', 'launch'], ['move', 'drive', 'steer']];
const FALLBACK = ['e', 'q', 'f', 'r', 'c', 'v', 'x', 'z', 'k', 'l', 'g', 'h', 'n', 'b', 'u', 'o', 'y', 'comma', 'period'];
const AXIS_SOURCES = { move: [['arrows', 'wasd', 'dpad', 'lstick'], ['wasd', 'lstick']], drive: [['arrows', 'wasd', 'lstick'], ['wasd', 'lstick']], steer: [['arrows', 'wasd', 'lstick'], ['wasd', 'lstick']], look: [[], ['mouse', 'rstick']] };

const pick = (entry, threeD) => (Array.isArray(entry?.[0]) ? entry[threeD ? 1 : 0] : entry) || [];
/** True when an action takes a plain press (not a number, vector or enum value), so a key can trigger it. */
const pressable = (registry, systems, verb) => {
  for (const s of systems) {
    const space = registry?.get(s.use)?.card?.actionSpace?.[verb];
    if (space && (space.type === 'number' || space.type === 'vector' || (space.type === 'enum' && !(space.options || []).every(o => o === true)))) return false;
  }
  return true;
};

/**
 * The document's systems with a usable engine.input.actions instance for its primary view.
 * @param {object} doc a game document (not mutated)
 * @param {object} registry the primitive registry (cards give provided actions and their action spaces)
 * @param {{touch?: boolean}} opts touch: the host is a touch device (shows the on-screen stick and buttons)
 */
export function withDefaultInput(doc, registry, { touch = false } = {}) {
  const systems = (doc.systems || []).map(s => ({ ...s }));
  if (!registry?.has?.(INPUT)) return systems;
  const view = doc.views?.primary || 'side', threeD = FIRST_PERSON.has(view) || /space\.(voxel|mesh3d)$/.test(doc.spaces?.[0]?.use || '');
  // Verbs the systems register, plus input axes they read (an actionSpace vector such as a car's move).
  const cardOf = s => registry.get(s.use)?.card;
  const provided = new Set(systems.flatMap(s => [...(cardOf(s)?.provides?.actions || []),
    ...Object.entries(cardOf(s)?.actionSpace || {}).filter(([v, a]) => v in AXIS_SOURCES && a?.type === 'vector').map(([v]) => v)]));
  const device = [...provided].filter(v => (v in AXIS_SOURCES ? pick(AXIS_SOURCES[v], threeD).length > 0 : v in KEYS && pressable(registry, systems, v)));
  let i = systems.findIndex(s => s.use === INPUT);
  if (i < 0) {
    if (!device.length) return systems;
    systems.unshift({ use: INPUT, with: {} }); i = 0;
  }
  const w = { ...(systems[i].with || {}) };
  const axes = w.axes || registry.get(INPUT).card.params.axes.default;
  const verbs = [...(w.verbs || [])];
  // Added verbs follow the conventions' order (core movement and actions before mode-specific ones).
  const rank = v => { const i = Object.keys(KEYS).indexOf(v); return i < 0 ? -1 : i; };
  for (const v of device.sort((a, b) => rank(a) - rank(b))) if (!verbs.includes(v)) verbs.push(v);
  if (threeD && verbs.includes('move') && !verbs.includes('look')) verbs.push('look');
  // verbs needs one entry; a document with nothing to steer (graph or none spaces driven by options)
  // gets the UI verb, which binds no key, rather than a move axis no primitive reads.
  if (!verbs.length) verbs.push('menu');
  const bindings = structuredClone(w.bindings || {});
  const map = bindings[view] ??= {};
  const used = new Map(); // key -> verbs bound to it in this view
  const claim = (verb, name) => { for (const k of expand(name) || []) (used.get(k) || used.set(k, []).get(k)).push(verb); };
  for (const [verb, names] of Object.entries(map)) for (const n of names || []) claim(verb, n);
  const share = (a, b) => SHARE.some(g => g.includes(a) && g.includes(b)) || (w.shareKeys || []).some(g => g.includes(a) && g.includes(b));
  const free = (verb, name) => { const ks = expand(name); return ks && ks.every(k => !UI_KEYS.has(k)) && ks.every(k => (used.get(k) || []).every(o => share(o, verb))); };
  for (const verb of verbs) {
    if (UI_VERBS.has(verb) || map[verb]?.length) continue;
    const isAxis = axes.includes(verb);
    if (!isAxis && !pressable(registry, systems, verb)) continue;
    const candidates = isAxis ? pick(AXIS_SOURCES[verb], threeD) : pick(KEYS[verb], threeD);
    let names = candidates.filter(n => free(verb, n) && (!isAxis || AXES.has(n)));
    // Buttons take one keyboard/mouse key and one gamepad button, so later verbs still find conventional keys.
    if (!isAxis) names = ['keyboard', 'gamepad'].map(d => names.find(n => (expand(n) || []).every(k => deviceOf(k) === d))).filter(Boolean);
    if (!isAxis && !names.some(n => (expand(n) || []).some(k => deviceOf(k) === 'keyboard'))) { // always one keyboard/mouse key
      const k = FALLBACK.find(n => free(verb, n)); if (k) names = [k, ...names];
    }
    if (!names.length) continue;
    map[verb] = names;
    for (const n of names) claim(verb, n);
  }
  if (!Object.keys(map).length) delete bindings[view];
  const shareKeys = [...(w.shareKeys || [])];
  for (const g of SHARE) {
    const present = g.filter(v => verbs.includes(v));
    if (present.length > 1 && !shareKeys.some(x => present.every(v => x.includes(v)))) shareKeys.push(present);
  }
  systems[i] = { ...systems[i], with: { ...w, verbs, bindings, shareKeys, ...(touch ? { touch: true } : {}) } };
  return systems;
}
