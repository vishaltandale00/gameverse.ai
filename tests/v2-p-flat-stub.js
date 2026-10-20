// Test support for the flat graphics primitives (not a test file itself):
// a minimal DOM + recording 2D canvas, a fake browser view, and small fake 2D
// spaces implementing the read-only renderer contract agreed with spaces2d
// (kind, size, config, layers, getCell/cellsIn, collisionOf, bounds, anchor).
// The fakes are never registered in the catalogue.
import { compile } from '../v2/kernel/testing.js';

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

const v2 = a => [a?.[0] ?? 0, a?.[1] ?? 0];
function fakeSpace(kind, extra = {}) {
  return {
    id: `engine.space.${kind}`,
    card: { intent: `Fake ${kind} space for flat renderer tests.`, views: ['any'], params: { size: { type: 'list', default: [32, 18], of: { type: 'number' } }, tile: { type: 'integer', default: 16 }, mode: { type: 'string', default: 'side' }, layers: { type: 'list', default: ['bg', 'solid', 'fg'], of: { type: 'string' } }, topology: { type: 'string', default: 'square' }, yAxis: { type: 'string', default: 'up' }, wrap: { type: 'string', default: 'none' }, view: { type: 'string', default: 'side' }, lanes: { type: 'integer', default: 3 }, cells: { type: 'json', default: null } }, provides: { capabilities: ['position', 'distance'], events: ['enter_zone', 'leave_zone', 'cell_changed'] } },
    install(rt, config, instance) {
      const sid = instance.id, [W, Hh] = config.size;
      const st = () => (rt.state.spaces[sid].cells ??= structuredClone(config.cells || defaultCells(kind, W, Hh)));
      const zones = () => rt.doc.spaces.find(s => s.id === sid)?.zones || [];
      const zoneAt = at => zones().find(z => z.rect && at[0] >= z.rect[0] && at[1] >= z.rect[1] && at[0] < z.rect[2] && at[1] < z.rect[3])?.id ?? null;
      const api = {
        kind, size: config.size, config, layers: config.layers, anchor: kind === 'grid' ? 'cell' : 'center',
        place(e) { e.at = e.at ? v2(e.at).concat(e.at.length > 2 ? [e.at[2]] : []) : [2, 2]; e.zone = zoneAt(e.at); }, remove() {}, pos: e => e.at, setPos(e, at) { e.at = at.slice(); e.zone = zoneAt(at); },
        entitiesAt: () => [], inZone: (e, z) => zoneAt(e.at) === z, zoneAt, teleport(e, { at }) { if (at) e.at = at.slice(); }, nearest: () => null,
        distance: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
        getCell(at, layer = 'solid') { return st()[layer]?.[`${Math.floor(at[0])},${Math.floor(at[1])}`] ?? null; },
        cellsIn([[x0, y0], [x1, y1]], layer = 'solid') { const out = [], L = st()[layer] || {}; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const b = L[`${x},${y}`]; if (b != null) out.push({ at: [x, y], block: b }); } return out; },
        setCell(at, block, rt2, layer = 'solid') { const L = st()[layer] ??= {}; const k = `${at[0]},${at[1]}`, from = L[k] ?? null; if (block == null) delete L[k]; else L[k] = block; rt2.emit('cell_changed', { at, from, to: block }); return true; },
        collisionOf: b => (rt.doc.content?.blocks?.find(x => x.id === b)?.solid === false ? 'none' : 'solid'),
        bounds: () => ({ min: [0, 0], max: [W, Hh], wrap: [false, false] }),
        cellCenter: c => [c[0] + (config.topology === 'hex' && c[1] % 2 ? 0.5 : 0), c[1]],
        ...extra,
      };
      if (kind === 'physics2d') { api.walls = () => [{ id: 'floor', kind: 'box', x0: 0, y0: 0, x1: W, y1: 0.5 }]; api.joints = () => []; }
      if (kind === 'track') api.bounds = () => ({ min: [Math.max(0, (rt.player()?.at?.[0] || 0) - 5), 0, 0], max: [(rt.player()?.at?.[0] || 0) + 80, config.lanes, 4], wrap: [false, false] });
      rt.defineSpace(sid, api);
    },
  };
}
function defaultCells(kind, W, H) {
  const solid = {}, bg = {}, fg = {};
  if (kind === 'tilemap') {
    for (let x = 0; x < W; x++) { solid[`${x},0`] = 'stone'; solid[`${x},1`] = x > 10 && x < 14 ? undefined : 'stone'; }
    for (let x = 6; x < 10; x++) solid[`${x},5`] = 'stone';
    for (let x = 11; x < 14; x++) solid[`${x},1`] = 'water';
    for (let x = 0; x < W; x++) for (let y = 2; y < H; y++) if ((x * 7 + y * 3) % 5 === 0) bg[`${x},${y}`] = 'stone';
    fg['3,3'] = 'stone'; solid['16,2'] = 'spikes';
    for (const k of Object.keys(solid)) if (solid[k] === undefined) delete solid[k];
  }
  if (kind === 'grid') { for (let x = 0; x < W; x++) { solid[`${x},0`] = 'wall'; solid[`${x},${H - 1}`] = 'wall'; } for (let y = 0; y < H; y++) { solid[`0,${y}`] = 'wall'; solid[`${W - 1},${y}`] = 'wall'; } solid['4,4'] = 'wall'; solid['5,4'] = 'wall'; solid['5,5'] = 'wall'; }
  return { solid, bg, fg };
}
export const fakeSpaces = Object.fromEntries(['tilemap', 'grid', 'physics2d', 'arena2d', 'track', 'graph', 'none'].map(k => [k, fakeSpace(k)]));

/** A gameplay primitive that walks the player right and hops, to animate states. */
export const mover = {
  id: 'gameplay.flattest.mover',
  card: { intent: 'Test mover: walks the player and hops, emitting jump/land/hit.', params: { speed: { type: 'number', default: 4 } }, provides: { events: ['jump', 'land', 'hit', 'defeated'] } },
  install(rt, config) {
    rt.on('game_start', (d, r) => { const sid = r.doc.spaces[0].id; r.spawn('slime', { space: sid, at: [6, 2.6], components: { body: { size: [0.9, 0.8], vel: [0, 0], grounded: true } } }); r.spawn('coin', { space: sid, at: [8, 3] }); });
    rt.system('movement', r => {
      const p = r.player(); if (!p || !p.at) return;
      const b = (p.components.body ??= { size: [0.8, 1.2], vel: [0, 0], grounded: true, facing: 1 });
      const f = r.state.frame;
      b.vel = [config.speed, f % 60 < 20 ? 3 : f % 60 < 40 ? -3 : 0]; b.grounded = f % 60 >= 40; b.facing = 1;
      p.at = [p.at[0] + b.vel[0] / 60, p.at[1] + (b.grounded ? 0 : b.vel[1] / 60)];
      if (f % 60 === 0) r.emit('jump', { who: 'player' });
      if (f % 60 === 40) r.emit('land', { who: 'player' });
      if (f % 45 === 10) r.emit('hit', { who: 'player', target: Object.keys(r.state.entities).find(id => id !== 'player') || 'player' });
    });
  },
};

/** A minimal document for a fake space kind with a player and a couple of archetypes. */
export function docFor(kind, { graphics = [], spaceWith = {}, content = {}, player = {}, zones } = {}) {
  return {
    schema: 'gameverse.v2.game/0.2', id: `flat-${kind}`, title: `Flat ${kind} test`, logline: 'a test in a cave',
    spaces: [{ id: 'world', use: `engine.space.${kind}`, with: spaceWith, zones: zones || [{ id: 'start', name: 'Start', rect: [0, 0, 16, 18] }, { id: 'east', name: 'East', rect: [16, 0, 32, 18] }] }],
    content: { blocks: [{ id: 'stone', color: '#5a5668', solid: true, tile: 'rock' }, { id: 'water', color: '#2a5a9a', solid: false, tags: ['liquid'], transparent: true }, { id: 'spikes', color: '#b0b4b8', solid: false, tags: ['hazard'] }, { id: 'wall', color: '#3a3aa8', solid: true }], archetypes: [{ id: 'hero', kind: 'player', components: {} }, { id: 'slime', kind: 'enemy', components: { health: { max: 3 } } }, { id: 'coin', kind: 'pickup', components: {} }], ...content },
    systems: [{ use: 'gameplay.flattest.mover' }],
    graphics,
    player: { archetype: 'hero', space: 'world', at: [3, 2.6], ...player },
  };
}

/** Compile in "browser" mode with a fake view; returns { rt, view, checked }. */
export function mount(doc, primitives, { seed = 1 } = {}) {
  const view = fakeView();
  const out = compile(doc, { primitives: [...Object.values(fakeSpaces), mover, ...primitives], headless: false, view, seed });
  return { ...out, view };
}
/** Step the sim and draw frames in lockstep. */
export function play(m, steps = 30) { for (let i = 0; i < steps; i++) { m.rt.step({}); m.view.frame(0.5); } return m; }
