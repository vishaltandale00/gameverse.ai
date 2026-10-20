// UI input for every UI primitive: keyboard, gamepad and pointer mapped to
// UI verbs (up down left right confirm back prev next menu inventory journal
// map, digit1..9), a stack of layers with focus, and the gameplay input gate.
//
// Rules:
// - With no modal layer open, only the open hotkeys (menu / inventory / journal /
//   map) are consumed, and only if nothing in engine.input.actions binds that key
//   to a gameplay verb. Every other key passes through to gameplay untouched.
// - While a modal layer is open, view.modal is set and the gameplay input read
//   by the host (view.input) returns nothing, so gameplay never sees UI input.
// - Non-modal layers (barks, HUD) never take input.

export const VERBS = ['up', 'down', 'left', 'right', 'confirm', 'back', 'prev', 'next', 'menu', 'inventory', 'journal', 'map'];
const EMPTY = Object.freeze({ actions: {}, axes: { move: [0, 0], look: [0, 0] }, held: {} });

// Normalised key names, matching the vocabulary used in engine.input.actions bindings.
export function keyName(e) {
  const k = e.key === ' ' ? 'space' : String(e.key || '').toLowerCase();
  return { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', escape: 'esc', return: 'enter' }[k] || k;
}
const expand = k => k === 'arrows' ? ['up', 'down', 'left', 'right'] : k === 'wasd' ? ['w', 'a', 's', 'd'] : k === 'escape' ? ['esc'] : [String(k).toLowerCase()];

/** Keys that move focus/confirm inside an open UI layer. */
export const MODAL_KEYS = {
  up: ['up', 'w'], down: ['down', 's'], left: ['left', 'a'], right: ['right', 'd'],
  confirm: ['enter', 'space', 'z', 'e'], back: ['esc', 'backspace', 'x'], prev: ['q', 'pageup'], next: ['r', 'pagedown'],
};
/** Default open hotkeys; engine.input.actions bindings for the same verbs override them. */
export const OPEN_KEYS = { menu: ['esc', 'p'], inventory: ['i'], journal: ['j'], map: ['m'] };
// Standard gamepad mapping.
const PAD = { 0: 'confirm', 1: 'back', 2: 'alt', 3: 'journal', 4: 'prev', 5: 'next', 8: 'inventory', 9: 'menu', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

/** Key bindings from the document's engine.input.actions: { verb: [keys] } across views. */
export function docBindings(doc) {
  const inst = (doc?.systems || []).find(s => s.use === 'engine.input.actions');
  const out = {};
  for (const byVerb of Object.values(inst?.with?.bindings || {})) for (const [verb, keys] of Object.entries(byVerb || {})) (out[verb] ??= new Set()), (keys || []).flatMap(expand).forEach(k => out[verb].add(k));
  return out;
}

/** Resolve the open hotkeys against the document's gameplay bindings. */
export function openKeys(doc) {
  const b = docBindings(doc);
  const gameplay = new Set(Object.entries(b).filter(([v]) => !(v in OPEN_KEYS)).flatMap(([, ks]) => [...ks]));
  const out = {};
  for (const [verb, defaults] of Object.entries(OPEN_KEYS)) {
    const bound = b[verb] ? [...b[verb]] : [];
    out[verb] = [...new Set([...bound, ...defaults.filter(k => !gameplay.has(k))])];
  }
  return out;
}

/**
 * Pure focus navigation over `count` items laid out in `columns`.
 * Returns the new index (wrapping in lists, clamping in grids).
 */
export function moveFocus(index, dir, count, columns = 1) {
  if (count <= 0) return -1;
  const i = Math.max(0, Math.min(count - 1, index < 0 ? 0 : index));
  if (columns <= 1) {
    if (dir === 'up' || dir === 'left') return (i - 1 + count) % count;
    if (dir === 'down' || dir === 'right') return (i + 1) % count;
    return i;
  }
  const r = Math.floor(i / columns), c = i % columns, rows = Math.ceil(count / columns);
  if (dir === 'left') return c > 0 ? i - 1 : i;
  if (dir === 'right') return c < columns - 1 && i + 1 < count ? i + 1 : i;
  if (dir === 'up') return r > 0 ? i - columns : i;
  if (dir === 'down') return r < rows - 1 ? Math.min(count - 1, i + columns) : i;
  return i;
}

export function createUiInput(host) {
  const { view, rt } = host;
  const layers = []; // { id, modal, onVerb(verb, info) -> handled? }
  const hotkeys = new Map(); // verb -> fn
  let keys = openKeys(rt.doc);
  let device = 'keyboard';
  const pads = { prev: {}, repeat: {} };

  // Gameplay input gate: wrap whatever function the input primitive assigns to view.input.
  let inner = Object.prototype.hasOwnProperty.call(view, 'input') ? view.input : null;
  const gated = () => (modal() ? EMPTY : (inner?.() ?? EMPTY));
  try {
    Object.defineProperty(view, 'input', { configurable: true, enumerable: true, get: () => (inner ? gated : null), set: fn => { inner = fn; } });
  } catch { /* frozen view: the input primitive must honour view.modal itself */ }

  const top = () => layers[layers.length - 1] || null;
  const modal = () => layers.some(l => l.modal);
  // view.modal mirrors both UI modal layers and the simulation's modal (rt.modal), so the input
  // primitive, the UI and the simulation agree on who owns input.
  const uiModal = () => [...layers].reverse().find(l => l.modal)?.id || null;
  const sync = () => { view.modal = uiModal() || (rt.modal ? `sim:${rt.modal.owner}` : null); host.root.classList.toggle('gv-modal-open', Boolean(uiModal())); };

  function dispatch(verb, info = {}) {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.modal && !l.takesInput) continue;
      if (l.onVerb?.(verb, info) !== false) return true;
      if (l.modal) return true; // a modal layer swallows what it does not handle
    }
    const fn = hotkeys.get(verb);
    if (fn) { fn(info); return true; }
    return false;
  }

  function onKey(e) {
    if (e.defaultPrevented || e.isComposing) return;
    if (e.target?.tagName === 'INPUT' && e.target.type === 'text') return;
    device = 'keyboard';
    const k = keyName(e);
    const open = Object.keys(keys).find(v => keys[v].includes(k) && hotkeys.has(v)) || null;
    const uiKey = () => (/^[1-9]$/.test(k) ? `digit${k}` : k === 'tab' ? (e.shiftKey ? 'prev' : 'next') : Object.keys(MODAL_KEYS).find(v => MODAL_KEYS[v].includes(k)) || null);
    let verb = null;
    if (modal()) verb = uiKey() || Object.keys(keys).find(v => keys[v].includes(k)) || null;
    else if (layers.some(l => l.takesInput)) verb = open || uiKey(); // open hotkeys (pause, inventory...) win over a non-modal input layer
    else verb = open;
    if (!verb) return;
    if (dispatch(verb, { source: 'key', repeat: e.repeat, key: k })) { e.preventDefault?.(); e.stopPropagation?.(); }
  }
  const win = host.doc?.defaultView || globalThis.window;
  win?.addEventListener?.('keydown', onKey, true);

  return {
    VERBS,
    get device() { return device; },
    get modal() { return modal(); },
    get top() { return top()?.id || null; },
    sync,
    /** Open a layer: { id, modal, takesInput?, onVerb(verb, info) }. Returns a close function. */
    push(layer) {
      if (layers.includes(layer)) return () => this.pop(layer);
      layers.push(layer); sync(); return () => this.pop(layer);
    },
    pop(layer) { const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); sync(); },
    isOpen: layer => layers.includes(layer),
    /** Register an open hotkey verb ('menu', 'inventory', 'journal', 'map'). */
    hotkey(verb, fn) { hotkeys.set(verb, fn); },
    keysFor: verb => keys[verb] || MODAL_KEYS[verb] || [],
    /** Feed a verb directly (pointer handlers, tests). */
    press: (verb, info = {}) => dispatch(verb, { source: 'api', ...info }),
    refresh() { keys = openKeys(rt.doc); },
    /** Poll gamepads once per display frame (edge-triggered with D-pad/stick repeat). */
    poll() {
      const list = globalThis.navigator?.getGamepads?.() || [];
      const now = host.now();
      for (const gp of list) {
        if (!gp) continue;
        const prev = (pads.prev[gp.index] ??= {}), rep = (pads.repeat[gp.index] ??= {});
        const down = {};
        gp.buttons?.forEach((b, i) => { if (PAD[i] && (b.pressed || b.value > 0.5)) down[PAD[i]] = true; });
        const [ax = 0, ay = 0] = gp.axes || [];
        if (ax < -0.6) down.left = true; if (ax > 0.6) down.right = true; if (ay < -0.6) down.up = true; if (ay > 0.6) down.down = true;
        for (const verb of Object.keys(down)) {
          const nav = ['up', 'down', 'left', 'right'].includes(verb);
          if (!prev[verb]) { rep[verb] = now + 0.38; device = 'gamepad'; fire(verb); }
          else if (nav && now >= rep[verb]) { rep[verb] = now + 0.09; fire(verb); }
        }
        pads.prev[gp.index] = down;
      }
      function fire(verb) {
        if (!modal() && !layers.some(l => l.takesInput) && !hotkeys.has(verb)) return;
        dispatch(verb, { source: 'pad' });
      }
    },
    dispose() { win?.removeEventListener?.('keydown', onKey, true); },
  };
}

/**
 * Glyph text for a UI verb on the current device ('Enter', 'A', 'Esc'), or
 * for a gameplay verb via the document bindings / an input service glyph().
 */
export function glyph(host, verb) {
  const rt = host.rt;
  if (rt.hasService?.('input')) { try { const g = rt.service('input').glyph?.(verb); if (g) return g; } catch { /* ignore */ } }
  const pad = host.input.device === 'gamepad';
  if (pad) return { confirm: 'A', back: 'B', menu: 'Start', inventory: 'Select', journal: 'Y', prev: 'LB', next: 'RB', interact: 'A', map: 'Select' }[verb] || verb;
  const k = (docBindings(rt.doc)[verb] && [...docBindings(rt.doc)[verb]][0]) || host.input.keysFor(verb)[0] || verb;
  return { esc: 'Esc', enter: 'Enter', space: 'Space', up: '↑', down: '↓', left: '←', right: '→', tab: 'Tab', shift: 'Shift' }[k] || String(k).toUpperCase();
}
