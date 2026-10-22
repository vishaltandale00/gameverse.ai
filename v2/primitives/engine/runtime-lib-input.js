// Device-independent input mapping for engine.input.actions: a key
// vocabulary (keyboard, mouse, gamepad), bindings compiled per view, and a
// pure sampler that turns device state into kernel input
// {actions, held, axes}. The browser glue in input-actions.js only feeds
// device state into sample(); everything here also runs headless.

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const DIGITS = '0123456789'.split('');
export const KEYBOARD = new Set([...LETTERS, ...DIGITS, ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
  'space', 'shift', 'ctrl', 'alt', 'tab', 'enter', 'esc', 'backspace', 'up', 'down', 'left', 'right', 'minus', 'equal', 'comma', 'period', 'slash', 'semicolon', 'quote', 'backquote', 'bracketleft', 'bracketright']);
export const MOUSE = new Set(['lmb', 'rmb', 'mmb']);
export const PAD = new Set(['pad_a', 'pad_b', 'pad_x', 'pad_y', 'lb', 'rb', 'lt', 'rt', 'select', 'start', 'lstick_press', 'rstick_press', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right']);
/** Axis sources: each yields an [x, y] vector (y up positive). */
export const AXES = new Set(['wasd', 'arrows', 'dpad', 'lstick', 'rstick', 'mouse']);
export const SPECIAL = new Set(['wheel']);
/** Standard gamepad button order (W3C "standard" mapping). */
export const PAD_ORDER = ['pad_a', 'pad_b', 'pad_x', 'pad_y', 'lb', 'rb', 'lt', 'rt', 'select', 'start', 'lstick_press', 'rstick_press', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right'];
export const AXIS_KEYS = { wasd: { up: 'w', down: 's', left: 'a', right: 'd' }, arrows: { up: 'up', down: 'down', left: 'left', right: 'right' }, dpad: { up: 'dpad_up', down: 'dpad_down', left: 'dpad_left', right: 'dpad_right' } };
const RANGE = /^(\d)-(\d)$/;

/** Physical keys a binding name covers (axis groups expand to their keys); null when unknown. */
export function expand(name) {
  if (typeof name !== 'string') return null;
  if (KEYBOARD.has(name) || MOUSE.has(name) || PAD.has(name) || SPECIAL.has(name)) return [name];
  if (AXIS_KEYS[name]) return Object.values(AXIS_KEYS[name]);
  if (name === 'lstick' || name === 'rstick' || name === 'mouse') return [name];
  const m = name.match(RANGE); if (m && +m[1] <= +m[2]) { const out = []; for (let d = +m[1]; d <= +m[2]; d++) out.push(String(d)); return out; }
  return null;
}
export const deviceOf = key => (PAD.has(key) || key === 'lstick' || key === 'rstick' || key === 'dpad' ? 'gamepad' : 'keyboard');

/**
 * One verb's binding entry: a list of key names (a press sends `true`; a range like 1-9 sends the digit), or a value
 * map { <value>: [key names] } for a verb whose action takes one of a closed set of values (card.actionSpace enum): each
 * key sends its value. Value names are decoded as JSON where they parse (numbers, booleans), else they are strings.
 * -> [{ name, value }] where value undefined means "a press" (true, or the digit of a range).
 */
export function bindingKeys(entry) {
  if (Array.isArray(entry)) return entry.map(name => ({ name, value: undefined }));
  if (entry && typeof entry === 'object') return Object.entries(entry).flatMap(([v, names]) => (Array.isArray(names) ? names : []).map(name => ({ name, value: decodeValue(v) })));
  return [];
}
/** A value-map key as the value the action receives ('-1' -> -1, 'true' -> true, 'left' -> 'left'). */
export function decodeValue(v) { try { const x = JSON.parse(v); return typeof x === 'number' || typeof x === 'boolean' ? x : v; } catch { return v; } }
/** Every key name of a binding entry (list or value map), in order. */
export const bindingNames = entry => bindingKeys(entry).map(k => k.name);

/**
 * Compile bindings {view: {verb: entry}} into {view: {buttons: {key: [{verb, value}]}, axes: {verb: [source]},
 * keys: {verb: [names]}, values: {verb: {value: [names]}}}} (entry: bindingKeys).
 */
export function compile(bindings, axisVerbs) {
  const out = {};
  for (const [view, map] of Object.entries(bindings || {})) {
    const v = out[view] = { buttons: {}, axes: {}, keys: {}, values: {} };
    for (const [verb, entry] of Object.entries(map || {})) {
      const list = bindingKeys(entry);
      v.keys[verb] = list.map(k => k.name);
      if (!Array.isArray(entry)) v.values[verb] = structuredClone(entry);
      for (const { name, value } of list) {
        if (value === undefined && AXES.has(name) && (axisVerbs.has(verb) || name === 'mouse' || name === 'lstick' || name === 'rstick')) { (v.axes[verb] ??= []).push(name); continue; }
        const m = String(name).match(RANGE);
        for (const key of expand(name) || []) (v.buttons[key] ??= []).push({ verb, value: value !== undefined ? value : m ? Number(key) : true });
      }
    }
  }
  return out;
}

/**
 * The view whose bindings apply to a runtime: the document's primary view when the bindings have it, else the first
 * view they list (engine.input.actions in a host without a view kind, and the headless input driver, v2/verify/controls.js).
 */
export function hostView(keymap, primary) { const views = Object.keys(keymap || {}); return keymap?.[primary] ? primary : views[0] ?? null; }

/** Keys bound to more than one verb in a view, ignoring verbs that share keys on purpose. */
export function conflicts(bindings, shareKeys = []) {
  const out = [];
  const shared = (a, b) => shareKeys.some(g => g.includes(a) && g.includes(b));
  for (const [view, map] of Object.entries(bindings || {})) {
    const owner = {};
    for (const [verb, entry] of Object.entries(map || {})) for (const name of new Set(bindingNames(entry))) for (const key of expand(name) || []) {
      for (const other of owner[key] || []) if (other !== verb && !shared(other, verb)) out.push({ view, key, verbs: [other, verb] });
      (owner[key] ??= []).push(verb);
    }
  }
  return out;
}

const norm = ([x, y]) => { const l = Math.hypot(x, y); return l > 1 ? [x / l, y / l] : [x, y]; };
const dead = (v, dz) => (Math.abs(v) < dz ? 0 : v);

/**
 * Sample device state into kernel input for one view.
 * dev = { down: Set<key>, pressed: Set<key> (went down since the last sample), mouse: {dx, dy}, wheel: n,
 *         sticks: { lstick: [x, y], rstick: [x, y] } (gamepad axes, y down as reported by browsers) }
 * opts = { deadzone, lookSensitivity (rad/px), lookRate (rad/s), invertY, dt }
 */
export function sample(view, dev, opts = {}) {
  const { deadzone = 0.2, lookSensitivity = 0.0025, lookRate = 3, invertY = false, dt = 1 / 60 } = opts;
  const actions = {}, held = {}, axes = {};
  if (!view) return { actions, held, axes };
  for (const [key, list] of Object.entries(view.buttons)) {
    for (const { verb, value } of list) {
      if (key === 'wheel') { if (dev.wheel) actions[verb] = Math.sign(dev.wheel); continue; }
      if (dev.down?.has(key)) held[verb] = true;
      if (dev.pressed?.has(key) && !(verb in actions)) actions[verb] = value;
    }
  }
  for (const [verb, sources] of Object.entries(view.axes)) {
    let x = 0, y = 0;
    for (const src of sources) {
      if (AXIS_KEYS[src]) { const k = AXIS_KEYS[src]; x += (dev.down?.has(k.right) ? 1 : 0) - (dev.down?.has(k.left) ? 1 : 0); y += (dev.down?.has(k.up) ? 1 : 0) - (dev.down?.has(k.down) ? 1 : 0); }
      else if (src === 'mouse') { x += (dev.mouse?.dx || 0) * lookSensitivity; y += -(dev.mouse?.dy || 0) * lookSensitivity * (invertY ? -1 : 1); }
      else if (src === 'lstick' || src === 'rstick') {
        const s = dev.sticks?.[src] || [0, 0], sx = dead(s[0], deadzone), sy = -dead(s[1], deadzone);
        if (verb === 'look') { x += sx * lookRate * dt; y += sy * lookRate * dt * (invertY ? -1 : 1); } else { x += sx; y += sy; }
      }
    }
    const isLook = verb === 'look' || sources.every(s => s === 'mouse');
    axes[verb] = isLook ? [x, y] : norm([Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))]);
  }
  return { actions, held, axes };
}

/** Short label for a key name (prompts). */
export function glyph(name) {
  if (!name) return '';
  const fixed = { space: 'Space', shift: 'Shift', ctrl: 'Ctrl', alt: 'Alt', tab: 'Tab', enter: 'Enter', esc: 'Esc', backspace: 'Bksp', up: '↑', down: '↓', left: '←', right: '→', lmb: 'LMB', rmb: 'RMB', mmb: 'MMB', wheel: 'Wheel', mouse: 'Mouse', wasd: 'WASD', arrows: 'Arrows', lstick: 'L-Stick', rstick: 'R-Stick', lstick_press: 'L3', rstick_press: 'R3', dpad: 'D-Pad', select: 'Select', start: 'Start' };
  if (fixed[name]) return fixed[name];
  if (name.startsWith('pad_')) return name.slice(4).toUpperCase();
  if (name.startsWith('dpad_')) return `D-${name.slice(5)[0].toUpperCase()}${name.slice(6)}`;
  return name.toUpperCase();
}

/** DOM KeyboardEvent.code -> key name. */
export function keyName(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  if (/^F\d{1,2}$/.test(code)) return code.toLowerCase();
  const map = { Space: 'space', ShiftLeft: 'shift', ShiftRight: 'shift', ControlLeft: 'ctrl', ControlRight: 'ctrl', AltLeft: 'alt', AltRight: 'alt', Tab: 'tab', Enter: 'enter', NumpadEnter: 'enter', Escape: 'esc', Backspace: 'backspace',
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Minus: 'minus', Equal: 'equal', Comma: 'comma', Period: 'period', Slash: 'slash', Semicolon: 'semicolon', Quote: 'quote', Backquote: 'backquote', BracketLeft: 'bracketleft', BracketRight: 'bracketright' };
  return map[code] ?? null;
}
