// Test support for the flat graphics primitives (not a test file itself):
// a minimal DOM + recording 2D canvas, a fake browser view, documents on the
// real 2D spaces (spaces2d), and two test-only helpers that fill cells and
// walk the player (stand-ins for generators and movement primitives; never
// registered in the catalogue).
import { compile } from '../v2/kernel/testing.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';

export function recordingContext(canvas) {
  const calls = new Map(), state = { fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, globalCompositeOperation: 'source-over', font: '10px sans-serif', lineWidth: 1, filter: 'none' };
  const stack = [];
  const count = name => calls.set(name, (calls.get(name) || 0) + 1);
  const grad = () => ({ addColorStop() {} });
  const methods = {
    save() { count('save'); stack.push({ ...state }); }, restore() { count('restore'); Object.assign(state, stack.pop() || {}); },
    createLinearGradient: () => (count('createLinearGradient'), grad()), createRadialGradient: () => (count('createRadialGradient'), grad()),
    createPattern: () => ({}), measureText: s => ({ width: String(s).length * 7 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    setLineDash() {}, getTransform: () => ({ a: 1, d: 1, e: 0, f: 0 }),
  };
  return new Proxy({ canvas, calls }, {
    get(t, k) {
      if (k === 'calls' || k === 'canvas') return t[k];
      if (k in methods) return methods[k];
      if (k in state) return state[k];
      if (typeof k === 'string' && /^[a-z]/.test(k) && !['shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'lineCap', 'lineJoin', 'textAlign', 'textBaseline', 'imageSmoothingEnabled', 'lineDashOffset'].includes(k)) return (...args) => { count(k); if (k === 'drawImage' && !args[0]) throw Error('drawImage without an image'); };
      return t[k];
    },
    set(t, k, v) {
      if (k in state || typeof k === 'string') { if (k === 'globalAlpha' && !Number.isFinite(v)) throw Error(`non-finite globalAlpha ${v}`); state[k] = v; }
      return true;
    },
  });
}

function element(tag) {
  const el = {
    tagName: tag.toUpperCase(), style: {}, children: [], dataset: {}, className: '', textContent: '', innerHTML: '', hidden: false, clientWidth: 960, clientHeight: 540,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    append(...c) { for (const x of c) { if (x && typeof x === 'object') x.parentElement = el; el.children.push(x); } }, appendChild(c) { el.append(c); return c; }, prepend(...c) { el.append(...c); }, replaceChildren(...c) { el.children = []; el.append(...c); },
    remove() {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
  };
  if (tag === 'canvas') { el.width = 300; el.height = 150; let ctx = null; el.getContext = () => (ctx ??= recordingContext(el)); }
  return el;
}

/** Install a fake DOM on globalThis; returns the container used as view.container. */
export function installDom() {
  globalThis.document = { createElement: element, createTextNode: t => ({ textContent: t }), body: element('body') };
  return element('div');
}

/** A browser view with frames you drive by hand. */
export function fakeView() {
  const container = installDom(), frames = [], acts = [];
  return { container, THREE: null, act: a => acts.push(a), onFrame: fn => frames.push(fn), input: null, frames, acts, frame(alpha = 0.5) { for (const f of frames) f(alpha); } };
}
/** All canvases' draw-call counts merged. */
export function drawCalls(view) {
  const out = {};
  const walk = el => { for (const c of el.children || []) { if (c.getContext) for (const [k, v] of c.getContext('2d').calls) out[k] = (out[k] || 0) + v; walk(c); } };
  walk(view.container);
  return out;
}

/** Fills cells on game start from its config: cells = [{ box:[[x0,y0],[x1,y1]], block, layer? }]. */
export const cellFiller = {
  id: 'gameplay.flattest.cells',
  card: { intent: 'Test helper: fills boxes of cells on game start.', params: { cells: { type: 'json', default: [] } }, reads: ['content.blocks'] },
  install(rt, config) {
    rt.on('game_start', (d, r) => { const sid = r.doc.spaces[0].id, api = r.space(sid); for (const c of config.cells) { const [[x0, y0], [x1, y1]] = c.box; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) api.setCell([x, y], c.block, r, null, c.layer); } });
  },
};
/** A gameplay primitive that walks the player right and hops, to animate states. */
export const mover = {
  id: 'gameplay.flattest.mover',
  card: { intent: 'Test mover: walks the player and hops, emitting jump/land/hit.', params: { speed: { type: 'number', default: 4 } }, provides: { events: ['jump', 'land', 'hit', 'defeated'] } },
  install(rt, config) {
    rt.on('game_start', (d, r) => { const sid = r.doc.spaces[0].id, kind = r.space(sid).kind; if (kind === 'none') return; const at = kind === 'grid' ? [[6, 2], [7, 5]] : kind === 'track' ? [[12, 0, 0.5], [20, 2, 1]] : [[6, 2.6], [8, 3]]; r.spawn('slime', { space: sid, at: at[0], components: { body: { size: [0.9, 0.8], vel: [0, 0], grounded: true } } }); r.spawn('coin', { space: sid, at: at[1] }); });
    rt.system('movement', r => {
      const p = r.player(); if (!p || !p.at) return;
      const kind = r.space(p.space).kind, f = r.state.frame;
      if (kind === 'grid') { if (f % 20 === 0) p.at = [Math.min(8, p.at[0] + 1), p.at[1]]; return; }
      if (kind === 'track') { p.at = [p.at[0] + config.speed / 60, 1 + Math.sin(f / 40) * 0.5, p.at[2]]; return; }
      const b = (p.components.body ??= { size: [0.8, 1.2], vel: [0, 0], grounded: true, facing: 1 });
      b.vel = [config.speed, f % 60 < 20 ? 3 : f % 60 < 40 ? -3 : 0]; b.grounded = f % 60 >= 40; b.facing = 1;
      p.at = [p.at[0] + b.vel[0] / 60, p.at[1] + (b.grounded ? 0 : b.vel[1] / 60)];
      if (f % 60 === 0) r.emit('jump', { who: 'player' });
      if (f % 60 === 40) r.emit('land', { who: 'player' });
      if (f % 45 === 10) r.emit('hit', { who: 'player', target: Object.keys(r.state.entities).find(id => id !== 'player') || 'player', amount: 3 });
    });
  },
};

const SPACE_WITH = {
  tilemap: { size: [32, 18], tile: 16, mode: 'side' },
  grid: { size: [10, 8], layers: ['terrain'], rules: { wall: { pass: false } } },
  physics2d: { bounds: [20, 12], walls: [{ id: 'floor', kind: 'box', at: [10, 0.25], size: [20, 0.5] }] },
  arena2d: { size: [16, 9], solids: [[0, 0, 16, 1]], platforms: [{ x0: 4, x1: 8, y: 4 }] },
  track: { lanes: 3 },
  none: {},
};
const CELLS = {
  tilemap: [{ box: [[0, 0], [31, 1]], block: 'stone' }, { box: [[11, 1], [13, 1]], block: 'water' }, { box: [[6, 5], [9, 5]], block: 'stone' }, { box: [[16, 2], [16, 2]], block: 'spikes' }, { box: [[2, 3], [4, 8]], block: 'stone', layer: 'bg' }, { box: [[20, 4], [21, 5]], block: 'stone', layer: 'fg' }],
  grid: [{ box: [[0, 0], [9, 0]], block: 'wall' }, { box: [[0, 7], [9, 7]], block: 'wall' }, { box: [[0, 0], [0, 7]], block: 'wall' }, { box: [[9, 0], [9, 7]], block: 'wall' }, { box: [[4, 3], [5, 4]], block: 'wall' }, { box: [[2, 5], [2, 5]], block: 'gem' }],
};
const START = { tilemap: [3, 2.6], grid: [2, 2], physics2d: [3, 3], arena2d: [3, 2], track: [0, 1, 0.5], none: null };

/** A minimal document on a real 2D space with a player and a couple of archetypes. */
export function docFor(kind, { graphics = [], spaceWith = {}, content = {}, player = {}, zones, cells } = {}) {
  return {
    schema: 'gameverse.v2.game/0.2', id: `flat-${kind}`, title: `Flat ${kind} test`, logline: 'a test in a cave',
    spaces: [{ id: 'world', use: `engine.space.${kind}`, with: { ...SPACE_WITH[kind], ...spaceWith }, zones: zones || (kind === 'tilemap' ? [{ id: 'start', name: 'Start', rect: [0, 0, 16, 18] }, { id: 'east', name: 'East', rect: [16, 0, 32, 18] }] : []) }],
    content: { blocks: [{ id: 'stone', color: '#5a5668', solid: true, tile: 'rock' }, { id: 'water', color: '#2a5a9a', solid: false, tags: ['liquid'], transparent: true }, { id: 'spikes', color: '#b0b4b8', solid: false, tags: ['hazard'] }, { id: 'wall', color: '#3a3aa8', solid: true }, { id: 'gem', color: '#ff5a7a', solid: false, tile: 'gem' }], archetypes: [{ id: 'hero', kind: 'player', components: {} }, { id: 'slime', kind: 'enemy', components: { health: { hp: 3, max: 3 } } }, { id: 'coin', kind: 'pickup', components: {} }], ...content },
    systems: [{ use: 'gameplay.flattest.cells', with: { cells: cells ?? CELLS[kind] ?? [] } }, { use: 'gameplay.flattest.mover' }],
    graphics,
    player: { archetype: 'hero', space: 'world', at: START[kind], ...player },
  };
}

/** Compile in "browser" mode with a fake view; returns { rt, view, checked }. */
export function mount(doc, primitives, { seed = 1 } = {}) {
  const view = fakeView();
  const out = compile(doc, { primitives: [...spaces2d, cellFiller, mover, ...primitives], headless: false, view, seed });
  return { ...out, view };
}
/** Step the sim and draw frames in lockstep. */
export function play(m, steps = 30) { for (let i = 0; i < steps; i++) { m.rt.step({}); m.view.frame(0.5); } return m; }
