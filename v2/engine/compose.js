// Compose a preflighted spec into a deterministic game definition.
// State is plain JSON (no functions, no classes), so it can be cloned,
// snapshotted, replayed, diffed and sent between workers.
import { random, seedFrom } from './rng.js';

export const DT = 1 / 60;
const PHASES = ['input', 'motion', 'interaction', 'rules'];
const EPS = 1e-6;

export const NEUTRAL_INPUT = Object.freeze({ x: 0, y: 0, a: false, b: false });

/** Input with edge flags derived from the previous frame's held buttons. */
function edges(input, previous) {
  return { x: Math.max(-1, Math.min(1, input.x || 0)), y: Math.max(-1, Math.min(1, input.y || 0)),
    a: !!input.a, b: !!input.b, aPressed: !!input.a && !previous.a, bPressed: !!input.b && !previous.b };
}

export function compose(spec, registry) {
  const modules = spec.modules.map((m, order) => ({ mod: registry.get(m.use), cfg: m.with, order }))
    .sort((p, q) => PHASES.indexOf(p.mod.card.phase || 'rules') - PHASES.indexOf(q.mod.card.phase || 'rules') || p.order - q.order);
  const kinds = spec.entities;
  const rows = spec.level.rows;
  const width = rows[0].length, height = rows.length;
  const solidKinds = new Set(Object.entries(kinds).filter(([, d]) => d.solid).map(([k]) => k));

  function makeEntity(state, kind, x, y) {
    const def = kinds[kind] || {}; // module-spawned kinds (e.g. projectile) may be undeclared
    const w = def.w ?? 0.8, h = def.h ?? 0.8;
    const e = { id: state.nextId++, kind, x: x + (1 - w) / 2, y: y + (1 - h), w, h, vx: 0, vy: 0, face: 1, tags: [...(def.tags || [])], data: {} };
    state.entities.push(e);
    return e;
  }

  // The API handed to modules for one step. Built per call; holds no state.
  function api(state, input) {
    // Side edges are walls; above the top and below the bottom are open.
    const solidAt = (tx, ty) => tx < 0 || tx >= width ? true : ty < 0 || ty >= height ? false : state.solid[ty * width + tx] === 1;
    const self = {
      dt: DT, input, width, height, kinds,
      random: () => random(state),
      solidAt: (tx, ty) => solidAt(Math.floor(tx), Math.floor(ty)),
      tagged: tag => state.entities.filter(e => !e.dead && e.tags.includes(tag)),
      player: () => state.entities.find(e => !e.dead && e.tags.includes('player')) || null,
      overlap: (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h,
      spawn: (kind, x, y) => makeEntity(state, kind, x, y),
      remove: e => { e.dead = true; },
      emit: (name, data = {}) => {
        state.counts[name] = (state.counts[name] || 0) + 1;
        state.events.push({ name, ...data });
        for (const { mod, cfg } of modules) mod.on?.[name]?.(state, data, cfg, self);
      },
      // Axis-separated AABB move against the tile grid, sub-stepped so no
      // step exceeds 0.45 tiles (prevents tunneling). Returns contact flags.
      move: (e, dx, dy) => {
        const hit = { left: false, right: false, up: false, down: false };
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.45));
        for (let i = 0; i < steps; i++) {
          const h = moveOnce(e, hit.left || hit.right ? 0 : dx / steps, hit.up || hit.down ? 0 : dy / steps);
          for (const k in h) hit[k] ||= h[k];
        }
        return hit;
      },
    };
    function moveOnce(e, dx, dy) {
        const hit = { left: false, right: false, up: false, down: false };
        if (dx) {
          e.x += dx;
          const y0 = Math.floor(e.y + EPS), y1 = Math.floor(e.y + e.h - EPS);
          if (dx > 0) { const tx = Math.floor(e.x + e.w - EPS); for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) { e.x = tx - e.w; hit.right = true; break; } }
          else { const tx = Math.floor(e.x + EPS); for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) { e.x = tx + 1; hit.left = true; break; } }
        }
        if (dy) {
          e.y += dy;
          const x0 = Math.floor(e.x + EPS), x1 = Math.floor(e.x + e.w - EPS);
          if (dy > 0) { const ty = Math.floor(e.y + e.h - EPS); for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) { e.y = ty - e.h; hit.down = true; break; } }
          else { const ty = Math.floor(e.y + EPS); for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) { e.y = ty + 1; hit.up = true; break; } }
        }
        return hit;
    }
    return self;
  }

  function evaluate(predicate, state) {
    if (!predicate) return false;
    if (predicate.all) return predicate.all.every(p => evaluate(p, state));
    if (predicate.any) return predicate.any.some(p => evaluate(p, state));
    const value = predicate.var !== undefined ? state.vars[predicate.var] ?? 0 : state.counts[predicate.count] ?? 0;
    if (predicate.gte !== undefined) return value >= predicate.gte;
    if (predicate.lte !== undefined) return value <= predicate.lte;
    return value === predicate.eq;
  }

  function createState(seed = spec.seed) {
    const state = { schema: 1, specId: spec.id, frame: 0, time: 0, status: 'playing', rng: seedFrom(seed), nextId: 1,
      solid: new Array(width * height).fill(0), entities: [], vars: {}, counts: {}, events: [], held: { a: false, b: false }, modules: {} };
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const kind = spec.level.legend[ch];
      if (!kind) return;
      if (solidKinds.has(kind)) state.solid[y * width + x] = 1;
      else makeEntity(state, kind, x, y);
    }));
    const context = api(state, edges(NEUTRAL_INPUT, state.held));
    for (const { mod, cfg } of modules) mod.init?.(state, cfg, context);
    state.events = [];
    return state;
  }

  /** Advance one fixed 1/60 s frame. Mutates and returns state. */
  function step(state, rawInput = NEUTRAL_INPUT) {
    if (state.status !== 'playing') return state;
    const input = edges(rawInput, state.held);
    state.held = { a: input.a, b: input.b };
    state.events = [];
    const context = api(state, input);
    for (const { mod, cfg } of modules) mod.step?.(state, cfg, context);
    if (state.entities.some(e => e.dead)) state.entities = state.entities.filter(e => !e.dead);
    state.frame++; state.time = state.frame * DT;
    const player = context.player();
    if (player && player.y > height + 1) { context.emit('fell'); state.status = 'lost'; return state; }
    if (!player) state.status = 'lost';
    else if (spec.lose && evaluate(spec.lose, state)) state.status = 'lost';
    else if (evaluate(spec.win, state)) state.status = 'won';
    return state;
  }

  /** Invariant check used by playtests and save loading. Returns issue strings. */
  function check(state) {
    const issues = [];
    for (const e of state.entities) {
      for (const k of ['x', 'y', 'vx', 'vy', 'w', 'h']) if (!Number.isFinite(e[k])) issues.push(`entity ${e.kind}#${e.id} has non-finite ${k}`);
    }
    for (const [k, v] of Object.entries(state.vars)) if (!Number.isFinite(v)) issues.push(`var ${k} is non-finite`);
    if (state.entities.length > 4000) issues.push(`entity count ${state.entities.length} exceeds 4000`);
    return issues;
  }

  return { spec, width, height, createState, step, check, snapshot: s => structuredClone(s), evaluate };
}
