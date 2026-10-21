// Host defaults for engine.input.actions: every document the player mounts gets a device -> verb mapping
// for its primary view, so a generated game whose input instance is missing, or lists verbs without
// bindings, is still playable from the keyboard, a gamepad and (on touch devices) the screen.
// - A missing engine.input.actions is added when any system offers device-style actions.
// - Device-style actions the systems provide but the verbs omit are added (rotate_cw for falling pieces...).
// - Verbs with no binding in the primary view get conventional keys that are still free in that view;
//   existing bindings are never changed. UI verbs (menu, inventory, journal, map) are left to the UI's own
//   hotkeys, and those hotkeys' keys are kept free.
// The conventions are keyed by verb name (shared vocabulary across primitives), never by game.
import { expand, AXES, deviceOf, bindingNames } from '../primitives/engine/runtime-lib-input.js';
import { verbControl, loopVerbs, verbInstances, actionSpaceOf } from '../primitives/engine/runtime-lib-controls.js';

export { verbControl, loopVerbs, verbInstances, actionSpaceOf };

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
// Verbs that may share keys because they never apply at once (input-actions shareKeys), and the direction verbs that
// mean the same as the move axis on the same keys.
const SHARE = [['move', 'up', 'down', 'left', 'right'], ['interact', 'use', 'talk', 'grab', 'mount', 'climb', 'use_portal', 'enter_vehicle', 'exit_vehicle'], ['jump', 'glide', 'fly', 'ascend', 'launch'], ['move', 'drive', 'steer']];
const FALLBACK = ['e', 'q', 'f', 'r', 'c', 'v', 'x', 'z', 'k', 'l', 'g', 'h', 'n', 'b', 'u', 'o', 'y', 'comma', 'period'];
const AXIS_SOURCES = { move: [['arrows', 'wasd', 'dpad', 'lstick'], ['wasd', 'lstick']], drive: [['arrows', 'wasd', 'lstick'], ['wasd', 'lstick']], steer: [['arrows', 'wasd', 'lstick'], ['wasd', 'lstick']], look: [[], ['mouse', 'rstick']], aim: [['arrows', 'rstick'], ['rstick']] };
// Conventional keys per value of a closed-set verb (card.actionSpace enum), keyed by verb name like KEYS.
const VALUE_KEYS = {
  slide: { left: ['left', 'a', 'dpad_left'], right: ['right', 'd', 'dpad_right'], up: ['up', 'w', 'dpad_up'], down: ['down', 's', 'dpad_down'] },
  cycle: { '-1': ['q', 'lb'], 1: ['e', 'rb'] }, dash: { fwd: ['shift', 'pad_b'], back: ['c', 'lb'] },
};

const pick = (entry, threeD) => (Array.isArray(entry?.[0]) ? entry[threeD ? 1 : 0] : entry) || [];

/**
 * The document's systems with a usable engine.input.actions instance for its primary view.
 * Every verb its loops declare (card.loop.verbs) and every device-style verb its primitives provide is a verb of the
 * instance; each gets a binding in the primary view from its declaration (verbControl): an axis its axis sources, a press
 * its conventional keys (KEYS) when free, else a free key, a closed set of values one key per value. Verbs whose value is
 * a choice get no key: the UI primitive that issues them does (ui-defaults.js mounts it).
 * @param {object} doc a game document (not mutated)
 * @param {object} registry the primitive registry (cards give provided actions and their action spaces)
 * @param {{touch?: boolean}} opts touch: the host is a touch device (shows the on-screen stick and buttons)
 */
export function withDefaultInput(doc, registry, { touch = false } = {}) {
  const systems = (doc.systems || []).map(s => ({ ...s }));
  if (!registry?.has?.(INPUT)) return systems;
  const view = doc.views?.primary || 'side', threeD = FIRST_PERSON.has(view) || /space\.(voxel|mesh3d)$/.test(doc.spaces?.[0]?.use || '');
  const instances = verbInstances({ ...doc, systems });
  const control = v => verbControl(registry, instances, v);
  // Verbs the systems register, plus input axes they read (an actionSpace vector such as a car's move), plus every loop verb.
  const cardOf = s => registry.get(s.use)?.card;
  const provided = new Set(systems.flatMap(s => [...(cardOf(s)?.provides?.actions || []),
    ...Object.entries(actionSpaceOf(cardOf(s), s)).filter(([v, a]) => v in AXIS_SOURCES && (a?.type === 'vector' || a?.kind === 'continuous')).map(([v]) => v)]));
  const loops = loopVerbs({ ...doc, systems }, registry);
  const bindable = v => { const c = control(v).kind; return c === 'axis' ? pick(AXIS_SOURCES[v], threeD).length > 0 : c !== 'choice'; };
  const device = [...new Set([...[...provided].filter(v => (v in AXIS_SOURCES || v in KEYS) && bindable(v)), ...loops.filter(bindable)])];
  let i = systems.findIndex(s => s.use === INPUT);
  if (i < 0) {
    if (!device.length) return systems;
    systems.unshift({ use: INPUT, with: {} }); i = 0;
  }
  const w = { ...(systems[i].with || {}) };
  const axes = [...(w.axes || registry.get(INPUT).card.params.axes.default)];
  const verbs = [...(w.verbs || [])];
  // Added verbs follow the conventions' order (core movement and actions before mode-specific ones), then the loops' order.
  const rank = v => { const i = Object.keys(KEYS).indexOf(v); return i < 0 ? Object.keys(KEYS).length + loops.indexOf(v) : i; };
  for (const v of device.sort((a, b) => rank(a) - rank(b))) if (!verbs.includes(v)) verbs.push(v);
  if (threeD && verbs.includes('move') && !verbs.includes('look')) verbs.push('look');
  // verbs needs one entry; a document with nothing to steer (graph or none spaces driven by options)
  // gets the UI verb, which binds no key, rather than a move axis no primitive reads.
  if (!verbs.length) verbs.push('menu');
  for (const v of verbs) if (control(v).kind === 'axis' && !axes.includes(v)) axes.push(v);
  const bindings = structuredClone(w.bindings || {});
  const map = bindings[view] ??= {};
  const used = new Map(); // key -> verbs bound to it in this view
  const claim = (verb, name) => { for (const k of expand(name) || []) (used.get(k) || used.set(k, []).get(k)).push(verb); };
  for (const [verb, entry] of Object.entries(map)) for (const n of bindingNames(entry)) claim(verb, n);
  const share = (a, b) => SHARE.some(g => g.includes(a) && g.includes(b)) || (w.shareKeys || []).some(g => g.includes(a) && g.includes(b));
  const free = (verb, name) => { const ks = expand(name); return ks && ks.every(k => !UI_KEYS.has(k)) && ks.every(k => (used.get(k) || []).every(o => share(o, verb))); };
  /** Keys for one press: one keyboard/mouse key and one gamepad button from the candidates, a free key when no candidate is free. */
  const buttonKeys = (verb, candidates) => {
    let names = candidates.filter(n => free(verb, n));
    names = ['keyboard', 'gamepad'].map(d => names.find(n => (expand(n) || []).every(k => deviceOf(k) === d))).filter(Boolean);
    if (!names.some(n => (expand(n) || []).some(k => deviceOf(k) === 'keyboard'))) { // always one keyboard/mouse key
      const k = FALLBACK.find(n => free(verb, n)); if (k) names = [k, ...names];
    }
    for (const n of names) claim(verb, n);
    return names;
  };
  for (const verb of verbs) {
    if (UI_VERBS.has(verb) || map[verb] && bindingNames(map[verb]).length) continue;
    const c = control(verb);
    if (c.kind === 'choice') continue;
    if (c.kind === 'axis' || (axes.includes(verb) && verb in AXIS_SOURCES)) {
      const names = pick(AXIS_SOURCES[verb], threeD).filter(n => free(verb, n) && AXES.has(n));
      if (!names.length) continue;
      map[verb] = names; for (const n of names) claim(verb, n);
      continue;
    }
    if (c.kind === 'values') {
      const entry = {};
      for (const o of c.options) { const names = buttonKeys(verb, VALUE_KEYS[verb]?.[String(o)] || []); if (names.length) entry[typeof o === 'string' ? o : JSON.stringify(o)] = names; }
      if (Object.keys(entry).length) map[verb] = entry;
      continue;
    }
    const names = buttonKeys(verb, pick(KEYS[verb], threeD));
    if (names.length) map[verb] = names;
  }
  if (!Object.keys(map).length) delete bindings[view];
  const shareKeys = [...(w.shareKeys || [])];
  for (const g of SHARE) {
    const present = g.filter(v => verbs.includes(v));
    if (present.length > 1 && !shareKeys.some(x => present.every(v => x.includes(v)))) shareKeys.push(present);
  }
  systems[i] = { ...systems[i], with: { ...w, verbs, axes, bindings, shareKeys, ...(touch ? { touch: true } : {}) } };
  return systems;
}
