// Semantic verbs and the device -> verb mapping. Simulation only ever sees
// verbs: the player's come from step({actions, held, axes}); any other
// entity's come from components.input (written by AI/CPU primitives in the
// `ai` phase, read here on the next step's `input` phase). The `input`
// service gives every primitive one per-entity view with press edges, and
// allocates free verbs to primitives that need a button (claim). In the
// browser only, this primitive also listens to keyboard, mouse, gamepad and
// touch and sets view.input(); it never touches rt.state there.
import { compile, conflicts, expand, sample, glyph, keyName, deviceOf, PAD_ORDER } from './runtime-lib-input.js';
import { SLUG } from './runtime-lib.js';

const ID = 'engine.input.actions';
const EMPTY = () => ({ actions: {}, held: {}, axes: { move: [0, 0], look: [0, 0] } });

export default {
  id: ID,
  card: {
    intent: 'Declares the game\'s semantic verbs (move, look, jump, attack, use, mine, drive...) and their keyboard, mouse, gamepad and touch bindings per view. Gives every primitive one input view per entity (player or AI-driven) with held, pressed and axes, and hands out free verbs to primitives that need a button.',
    views: ['any'],
    params: {
      verbs: { type: 'list', of: { type: 'string' }, min: 1, default: ['move', 'look', 'jump', 'use', 'attack', 'menu'], effect: 'verb names the game uses; each becomes a player action' },
      axes: { type: 'list', of: { type: 'string' }, default: ['move', 'look', 'drive', 'steer'], effect: 'verbs that are 2D axes ([x, y], y up/forward positive) rather than buttons' },
      bindings: { type: 'object', open: true, default: {}, effect: 'view -> verb -> key names: letters, digits, f1-f12, space shift ctrl alt tab enter esc up down left right, wasd/arrows/dpad (axes), lmb rmb mmb wheel mouse, pad_a pad_b pad_x pad_y lb rb lt rt start select lstick rstick lstick_press rstick_press dpad_*, ranges like 1-9' },
      shareKeys: { type: 'list', default: [], of: { type: 'list', of: { type: 'string' } }, effect: 'groups of verbs allowed to share a key because they never apply at once (jump/glide, move/drive)' },
      touch: { type: 'boolean', default: false, effect: 'show an on-screen stick and buttons on touch devices' },
      deadzone: { type: 'number', default: 0.2, min: 0, max: 0.9, effect: 'gamepad stick deadzone' },
      lookSensitivity: { type: 'number', default: 0.0025, min: 0.0001, max: 0.05, unit: 'rad/px', effect: 'mouse look' },
      lookRate: { type: 'number', default: 3, min: 0.1, max: 20, unit: 'rad/s', effect: 'stick look at full tilt' },
      invertY: { type: 'boolean', default: false },
    },
    provides: { services: ['input'], events: [] },
    requires: {},
  },
  validate(config) {
    const errors = [], verbs = new Set(config.verbs);
    config.verbs.forEach((v, i) => { if (!SLUG.test(v)) errors.push({ code: 'input_verb_invalid', path: `verbs[${i}]`, message: `verb '${v}' must be a slug` }); });
    if (verbs.size !== config.verbs.length) errors.push({ code: 'input_verb_invalid', path: 'verbs', message: 'duplicate verbs' });
    for (const [view, map] of Object.entries(config.bindings)) {
      if (!map || typeof map !== 'object' || Array.isArray(map)) { errors.push({ code: 'param_type', path: `bindings.${view}`, message: 'a view maps verbs to key lists' }); continue; }
      for (const [verb, keys] of Object.entries(map)) {
        if (!verbs.has(verb)) errors.push({ code: 'input_verb_unknown', path: `bindings.${view}.${verb}`, message: `'${verb}' is not in verbs`, hint: `verbs: ${config.verbs.join(', ')}` });
        if (!Array.isArray(keys)) { errors.push({ code: 'param_type', path: `bindings.${view}.${verb}`, message: 'must be a list of key names' }); continue; }
        keys.forEach((k, i) => { if (!expand(k)) errors.push({ code: 'input_key_unknown', path: `bindings.${view}.${verb}[${i}]`, message: `unknown key '${k}'`, hint: 'gamepad face buttons are pad_a pad_b pad_x pad_y' }); });
      }
    }
    if (!errors.length) for (const c of conflicts(config.bindings, config.shareKeys)) errors.push({ code: 'input_binding_conflict', path: `bindings.${c.view}`, message: `'${c.key}' is bound to both ${c.verbs.join(' and ')}`, hint: 'rebind one, or list both verbs in a shareKeys group' });
    config.shareKeys.forEach((g, i) => g.forEach((v, j) => { if (!verbs.has(v)) errors.push({ code: 'input_verb_unknown', path: `shareKeys[${i}][${j}]`, message: `'${v}' is not in verbs` }); }));
    return errors;
  },
  install(rt, config, instance) {
    const axisVerbs = new Set(config.axes), keymap = compile(config.bindings, axisVerbs);
    const views = Object.keys(keymap), primary = rt.doc.views?.primary;
    const viewKind = () => rt.view?.kind ?? (keymap[primary] ? primary : views[0]);
    const claims = new Map(); // verb -> owner (configuration, rebuilt identically at install, not state)
    let device = 'keyboard';
    const cache = () => (rt.caches[ID] ??= { frame: -1, by: {} });
    // Resolve one entity's input for this frame: held/axes persist, actions are one-shot, pressed = actions or new holds.
    const resolve = (e, prevHeld) => {
      const raw = e.id === 'player' ? rt.input || {} : e.components.input || {};
      const held = { ...(raw.held || {}) }, actions = { ...(raw.actions || {}) }, axes = { move: [0, 0], look: [0, 0], ...(raw.axes || {}) };
      const pressed = {};
      for (const [v, val] of Object.entries(actions)) if (val) pressed[v] = true;
      for (const v of Object.keys(held)) if (held[v] && !prevHeld.includes(v)) pressed[v] = true;
      return { held, actions, axes, pressed };
    };
    const frameInput = id => {
      const c = cache(), e = rt.entity(id); if (!e) return EMPTY();
      if (c.frame === rt.state.frame && c.by[id]) return c.by[id];
      const r = resolve(e, rt.store(ID).prev?.[id] || []);
      if (c.frame === rt.state.frame) c.by[id] = r;
      return r;
    };
    const keysFor = (verb, kind = viewKind()) => keymap[kind]?.keys[verb] || [];
    const api = {
      verbs: () => config.verbs.slice(),
      of: id => frameInput(id ?? 'player'),
      held: (id, verb) => Boolean(frameInput(id ?? 'player').held[verb]),
      pressed: (id, verb) => Boolean(frameInput(id ?? 'player').pressed[verb]),
      axis: (id, name = 'move') => frameInput(id ?? 'player').axes[name] || [0, 0],
      /** Give `owner` a verb: the first free one of `prefer`, else (with any) any free non-axis verb. Returns the verb or null. */
      claim(owner, { prefer = [], any = false } = {}) {
        for (const [v, o] of claims) if (o === owner && (prefer.includes(v) || any)) return v;
        const free = v => config.verbs.includes(v) && !axisVerbs.has(v) && !claims.has(v);
        const v = prefer.find(free) ?? (any ? config.verbs.find(v => free(v) && keysFor(v).length) ?? config.verbs.find(free) : undefined);
        if (v === undefined) return null;
        claims.set(v, owner); return v;
      },
      claims: () => Object.fromEntries(claims),
      free: () => config.verbs.filter(v => !axisVerbs.has(v) && !claims.has(v)),
      bindings: (kind = viewKind()) => structuredClone(keymap[kind]?.keys || {}),
      keys: keysFor,
      device: () => device,
      /** Label of the first key for `verb` on the current (or given) device class. */
      glyph(verb, dev = device) { const ks = keysFor(verb); const k = ks.find(k => deviceOf(k) === (dev === 'touch' ? 'keyboard' : dev)) ?? ks[0]; return glyph(k); },
    };
    rt.provide('input', api);
    // Every verb is a player action, so the kernel reports it (event `action`) and solvers see it.
    for (const v of config.verbs) if (!axisVerbs.has(v) && !rt.actions().includes(v)) rt.action(v, () => {});
    rt.system('input', rt => {
      const s = rt.store(ID); s.prev ??= {};
      const c = cache(); c.frame = rt.state.frame; c.by = {};
      const ids = ['player', ...Object.values(rt.state.entities).filter(e => e.id !== 'player' && e.components.input).map(e => e.id)];
      for (const id of ids) {
        const e = rt.entity(id); if (!e) continue;
        c.by[id] = resolve(e, s.prev[id] || []);
        const held = Object.keys(c.by[id].held).filter(v => c.by[id].held[v]).sort();
        if (held.length) s.prev[id] = held; else delete s.prev[id];
        if (id !== 'player' && e.components.input.actions) e.components.input.actions = {}; // one-shot
      }
    }, ID);

    if (rt.headless || !rt.view || typeof window === 'undefined') return;
    // ---------- browser only: devices -> view.input ----------
    const dev = { down: new Set(), pressed: new Set(), mouse: { dx: 0, dy: 0 }, wheel: 0, sticks: { lstick: [0, 0], rstick: [0, 0] } };
    const container = rt.view.container;
    const typing = ev => /^(input|textarea|select)$/i.test(ev.target?.tagName || '') || ev.target?.isContentEditable;
    const press = k => { if (!k) return; if (!dev.down.has(k)) dev.pressed.add(k); dev.down.add(k); };
    const release = k => { if (k) dev.down.delete(k); };
    const bound = k => Object.values(keymap).some(v => v.buttons[k]) || Object.values(keymap).some(v => Object.values(v.axes).some(src => src.some(s => (expand(s) || []).includes(k))));
    const onKey = down => ev => { if (typing(ev)) return; const k = keyName(ev.code); if (!k) return; device = 'keyboard'; if (bound(k) && !ev.metaKey) ev.preventDefault(); down ? press(k) : release(k); };
    const buttons = ['lmb', 'mmb', 'rmb'];
    const listeners = [
      [window, 'keydown', onKey(true)], [window, 'keyup', onKey(false)], [window, 'blur', () => dev.down.clear()],
      [container, 'mousedown', ev => { device = 'keyboard'; press(buttons[ev.button]); if (keysFor('look').includes('mouse') && document.pointerLockElement !== container) container.requestPointerLock?.(); }],
      [window, 'mouseup', ev => release(buttons[ev.button])],
      [window, 'mousemove', ev => { if (document.pointerLockElement === container) { dev.mouse.dx += ev.movementX || 0; dev.mouse.dy += ev.movementY || 0; } }],
      [container, 'wheel', ev => { dev.wheel += Math.sign(ev.deltaY); ev.preventDefault(); }, { passive: false }],
      [container, 'contextmenu', ev => ev.preventDefault()],
    ];
    for (const [t, name, fn, opts] of listeners) t.addEventListener(name, fn, opts);
    const pads = () => {
      const list = navigator.getGamepads?.() || [];
      const gp = [...list].find(g => g && g.connected); if (!gp) return;
      PAD_ORDER.forEach((k, i) => { const on = Boolean(gp.buttons[i]?.pressed); if (on) { device = 'gamepad'; press(k); } else if (dev.down.has(k)) release(k); });
      dev.sticks.lstick = [gp.axes[0] || 0, gp.axes[1] || 0]; dev.sticks.rstick = [gp.axes[2] || 0, gp.axes[3] || 0];
      if (Math.hypot(...dev.sticks.lstick) > config.deadzone || Math.hypot(...dev.sticks.rstick) > config.deadzone) device = 'gamepad';
    };
    if (config.touch && 'ontouchstart' in window) mountTouch(container, keymap[viewKind()], dev, () => { device = 'touch'; }, api);
    rt.view.input = () => {
      pads();
      const out = sample(keymap[viewKind()], dev, { deadzone: config.deadzone, lookSensitivity: config.lookSensitivity, lookRate: config.lookRate, invertY: config.invertY, dt: rt.dt });
      dev.pressed.clear(); dev.mouse.dx = 0; dev.mouse.dy = 0; dev.wheel = 0;
      return rt.view.modal ? EMPTY() : out; // a modal UI owns input; presses during it are dropped
    };
  },
};

// Minimal touch layer: left half is a virtual stick for `move`, buttons for the first bound non-axis verbs.
function mountTouch(container, view, dev, onTouch, api) {
  if (!view) return;
  const layer = document.createElement('div');
  layer.className = 'gv-overlay gv-touch';
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;touch-action:none';
  const stick = { id: null, x: 0, y: 0 };
  const zone = document.createElement('div');
  zone.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:50%;pointer-events:auto';
  zone.addEventListener('touchstart', ev => { onTouch(); const t = ev.changedTouches[0]; Object.assign(stick, { id: t.identifier, x: t.clientX, y: t.clientY }); ev.preventDefault(); }, { passive: false });
  zone.addEventListener('touchmove', ev => { for (const t of ev.changedTouches) if (t.identifier === stick.id) dev.sticks.lstick = [Math.max(-1, Math.min(1, (t.clientX - stick.x) / 50)), Math.max(-1, Math.min(1, (t.clientY - stick.y) / 50))]; ev.preventDefault(); }, { passive: false });
  zone.addEventListener('touchend', () => { stick.id = null; dev.sticks.lstick = [0, 0]; });
  layer.append(zone);
  if (view.axes.move && !view.axes.move.includes('lstick')) view.axes.move.push('lstick');
  const verbs = Object.keys(view.keys).filter(v => !view.axes[v]).slice(0, 6);
  verbs.forEach((verb, i) => {
    const b = document.createElement('button');
    b.textContent = verb.replace(/_/g, ' ');
    b.style.cssText = `position:absolute;right:${16 + (i % 3) * 72}px;bottom:${16 + Math.floor(i / 3) * 72}px;width:64px;height:64px;border-radius:50%;pointer-events:auto;opacity:.75;font:12px sans-serif`;
    const key = `touch_${verb}`;
    (view.buttons[key] ??= []).push({ verb, value: true });
    b.addEventListener('touchstart', ev => { onTouch(); if (!dev.down.has(key)) dev.pressed.add(key); dev.down.add(key); ev.preventDefault(); }, { passive: false });
    b.addEventListener('touchend', () => dev.down.delete(key));
    layer.append(b);
  });
  container.append(layer);
}
