// Test-only primitives and document builders for the verification layer.
// They are tiny, deterministic games on the kernel test space and the graph
// space, written only against the kernel API, so the generic verifier and
// its strategies can be exercised before the real primitives land. They are
// never registered in the catalogue.
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { testSpace } from '../v2/kernel/testing.js';
import spaceGraph from '../v2/primitives/engine/space-graph.js';
import storyboard from '../v2/primitives/plot/storyboard.js';
import inventory from '../v2/primitives/gameplay/inventory.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';
import inputActions from '../v2/primitives/engine/input-actions.js';
import uiStory from '../v2/primitives/graphics/ui-story.js';
import uiChoices from '../v2/primitives/graphics/ui-choices.js';

const P = defaults => Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, { type: 'json', default: v }]));
const fx = (id, intent, params, { card = {}, ...rest } = {}) => ({ id, ...rest, card: { intent, views: ['any'], params: P(params), ...card } });
const end = (rt, outcome, ending = null) => { rt.run([{ do: 'end_game', outcome, ending }]); };
const v3 = a => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
const fl = a => v3(a).map(Math.floor);
const same = (a, b) => fl(a).join() === fl(b).join();
const hp = e => e.components.health.hp;

// ---------- movement and placement ----------

/** Discrete steps on a cell space: options (one per open direction) and held move axes. */
export const step = fx('gameplay.fixture.step', 'test: one-cell steps on a cell space', { every: 4, options: true, envelope: null }, {
  // It steps by the held move axis (and by the step verb's value): it declares the axis, so the host binds it, and the
  // step verb is a verb the player plays (loop.verbs), so the host gives each of its values a key and the options that
  // offer a step are ones a person can take.
  card: { provides: { actions: ['step'] }, loop: { verbs: ['step'] }, actionSpace: { move: { type: 'vector', min: -1, max: 1, kind: 'continuous' }, step: { type: 'enum', options: ['up', 'down', 'left', 'right'] } }, envelope: (config, abilities) => ({ run: 1, jumpHeight: abilities.has('high_jump') ? 5 : 1 }) },
  install(rt, cfg) {
    const D = { up: [0, 1, 0], down: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0] };
    const go = d => { const p = rt.player(); if (!p) return; const api = rt.space(p.space); api.move(p, fl(p.at).map((v, i) => v + d[i]), rt); };
    rt.action('step', d => D[d] && go(D[d]));
    if (cfg.options) rt.options(rt => { const p = rt.player(); if (!p) return []; const api = rt.space(p.space); return Object.entries(D).filter(([, d]) => api.canMove(p, fl(p.at).map((v, i) => v + d[i]), rt)).map(([k]) => ({ label: `step ${k}`, actions: { step: k } })); });
    rt.system('input', rt => {
      const m = rt.input.axes?.move; if (!m || (!m[0] && !m[1])) return;
      const s = rt.store('gameplay.fixture.step'); s.t = (s.t || 0) + 1; if (s.t % cfg.every) return;
      go(Math.abs(m[0]) >= Math.abs(m[1]) ? [Math.sign(m[0]), 0, 0] : [0, Math.sign(m[1]), 0]);
    });
  },
});

/** Continuous top-down movement: move axes at `speed` cells/frame, clamped to the space. */
export const glide = fx('gameplay.fixture.glide', 'test: continuous axis movement', { speed: 0.2 }, {
  install(rt, cfg) {
    rt.system('movement', rt => {
      const p = rt.player(), m = rt.input.axes?.move; if (!p || !m) return;
      const api = rt.space(p.space), [W, H] = api.size, n = Math.hypot(m[0], m[1]) || 1;
      api.setPos(p, [Math.min(W - 1, Math.max(0, p.at[0] + cfg.speed * m[0] / n)), Math.min(H - 1, Math.max(0, p.at[1] + cfg.speed * m[1] / n)), 0], rt);
    });
  },
});

/** Spawns listed entities at install. */
export const spawner = fx('gameplay.fixture.spawn', 'test: spawn entities at start', { entities: [] }, {
  install(rt, cfg) { if (rt.state.frame) return; for (const e of cfg.entities) rt.spawn(e.archetype, { id: e.id, at: e.at, space: e.space, components: structuredClone(e.components || {}) }); },
});

/** Abilities: `ability` predicate and unlock_ability effect, ids defined in `with.abilities`. */
export const abilities = fx('gameplay.fixture.abilities', 'test: ability registry', { abilities: [] }, {
  card: { defines: [{ kind: 'ability', in: 'abilities' }] },
  logic(logic) {
    logic.predicate('ability', { refs: p => [['ability', p.ability]], test: (p, rt) => Boolean(rt.store('gameplay.fixture.abilities')[p.ability]) });
    logic.effect('unlock_ability', { refs: e => [['ability', e.ability]], run: (e, rt) => { rt.store('gameplay.fixture.abilities')[e.ability] = true; rt.emitTyped('ability_unlocked', e.ability); } });
  },
});

/** A test space with a ledge row: cells at y ≥ ledgeY need the high_jump ability (moves) or jumpHeight ≥ ledgeY (reachable). */
export const ledgeSpace = {
  id: 'engine.space.fixture-ledge',
  card: { ...testSpace.card, intent: 'test: test space with an ability-gated ledge', params: { ...testSpace.card.params, ledgeY: { type: 'integer', default: 3 } } },
  install(rt, config, instance) {
    testSpace.install(rt, config, instance);
    const api = rt.space(instance.id), base = { canMove: api.canMove, reachable: api.reachable };
    const high = (c, ok) => fl(c)[1] < config.ledgeY || ok;
    api.canMove = (e, to, rt2) => base.canMove(e, to, rt2) && high(to, (rt2 || rt).test({ ability: 'high_jump' }));
    api.reachable = (from, rt2, { envelope = {} } = {}) => {
      const ok = (envelope.jumpHeight ?? 0) >= config.ledgeY, seen = new Set([fl(from).join(',')]), q = [fl(from)];
      while (q.length) { const c = q.shift(); for (const n of api.neighbors(c)) { const k = n.join(','); if (!seen.has(k) && high(n, ok)) { seen.add(k); q.push(n); } } }
      return seen;
    };
  },
};

// ---------- real 2D spaces: level painting and platforming ----------

/** Paints cells through the space's bake(): rows are strings, top line = highest y; legend maps chars to blocks. */
export const rows = { id: 'engine.generate.fixture-rows', card: { intent: 'test: paint cells from text rows', views: ['any'], params: P({ rows: [], legend: {}, layer: null }) },
  install(rt, cfg, inst) { const H = cfg.rows.length; rt.space(inst.space).bake(cfg.rows.flatMap((line, i) => [...line].map((ch, x) => ({ at: [x, H - 1 - i], block: cfg.legend[ch] ?? null })).filter(c => c.block)), rt, cfg.layer ? { layer: cfg.layer } : {}); } };

/** Side-view platforming on a gravity space via slide(): move axes run, `jump` from the ground, a second jump with double_jump. */
export const platformer = fx('gameplay.fixture.platformer', 'test: run and jump', { run: 6, jump: 17 }, {
  // It runs by the held move axis: it declares the axis, so the host binds it (a person steers it with keys).
  card: { provides: { actions: ['jump'] }, actionSpace: { move: { type: 'vector', min: -1, max: 1, kind: 'continuous' } }, envelope: (c, abilities) => ({ mode: 'continuous', run: c.run, jumpHeight: c.jump ** 2 / 120, jumpDistance: c.run * 2 * c.jump / 60, doubleJump: abilities.has('double_jump') }) }, // physical reach (units), as card envelopes report it
  install(rt, cfg) {
    rt.action('jump', () => {
      const p = rt.player(); if (!p) return; const b = p.components.body, s = rt.store('gameplay.fixture.platformer');
      if (b.grounded) { b.vel[1] = cfg.jump; s.air = 0; }
      else if (rt.test({ ability: 'double_jump' }) && !(s.air > 0)) { b.vel[1] = cfg.jump; s.air = 1; }
    });
    rt.system('movement', rt => {
      const p = rt.player(); if (!p) return;
      const api = rt.space(p.space), b = p.components.body; b.vel ??= [0, 0];
      b.vel[0] = cfg.run * Math.sign(rt.input.axes?.move?.[0] || 0);
      b.vel[1] += (api.gravityAt(p.at)[1] || 0) * rt.dt;
      const r = api.slide(p, [b.vel[0] * rt.dt, b.vel[1] * rt.dt], rt);
      if (r.blocked.y) b.vel[1] = 0;
      b.grounded = r.grounded;
      if (p.at[1] < 0.2) end(rt, 'lost', 'fell');
    });
  },
});

// ---------- boards ----------

const SHAPES = {
  I: [[[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [0, 1], [0, 2], [0, 3]]],
  O: [[[0, 0], [1, 0], [0, 1], [1, 1]]],
  L: [[[0, 0], [1, 0], [2, 0], [2, 1]], [[0, 0], [0, 1], [0, 2], [1, 0]], [[0, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [1, 2], [0, 2]]],
  S: [[[0, 0], [1, 0], [1, 1], [2, 1]], [[1, 0], [1, 1], [0, 1], [0, 2]]],
  Z: [[[1, 0], [2, 0], [0, 1], [1, 1]], [[0, 0], [0, 1], [1, 1], [1, 2]]],
  T: [[[0, 0], [1, 0], [2, 0], [1, 1]], [[0, 0], [0, 1], [0, 2], [1, 1]], [[1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [1, 2], [0, 1]]],
  J: [[[0, 0], [1, 0], [2, 0], [0, 1]], [[0, 0], [1, 0], [1, 1], [1, 2]], [[2, 0], [0, 1], [1, 1], [2, 1]], [[0, 0], [0, 1], [0, 2], [1, 2]]],
};
const TYPES = Object.keys(SHAPES);
/** Falling pieces on the test space's cells (y up): place options, hard drop, line clears, top-out loss, line goal. */
export const falling = fx('gameplay.fixture.falling', 'test: falling pieces', { goal: 8, types: TYPES }, {
  card: { provides: { actions: ['place'] } },
  install(rt, cfg) {
    const S = () => rt.store('gameplay.fixture.falling');
    const api = () => rt.space(rt.doc.spaces[0].id);
    const draw = () => cfg.types[Math.floor(rt.random() * cfg.types.length)];
    const W = () => api().size[0], H = () => api().size[1];
    const filled = (x, y) => x < 0 || x >= W() || y < 0 || (y < H() && api().getCell([x, y, 0]) !== null);
    const fits = (cells, x, y) => cells.every(([cx, cy]) => !filled(x + cx, y + cy));
    if (!S().piece) Object.assign(S(), { piece: draw(), next: draw(), lines: 0, pieces: 0 });
    rt.options(() => { if (rt.state.status !== 'playing') return []; const t = S().piece, out = []; SHAPES[t].forEach((cells, r) => { const w = Math.max(...cells.map(c => c[0])); for (let x = 0; x + w < W(); x++) out.push({ label: `place ${r} ${x}`, actions: { place: { r, x } } }); }); return out; });
    rt.action('place', ({ r, x }) => {
      const s = S(), cells = SHAPES[s.piece][r], h = Math.max(...cells.map(c => c[1]));
      let y = H() - 1 - h;
      if (!fits(cells, x, y)) { end(rt, 'lost', 'topped_out'); return; }
      while (fits(cells, x, y - 1)) y--;
      for (const [cx, cy] of cells) api().setCell([x + cx, y + cy, 0], 'block', rt);
      for (let row = 0; row < H(); row++) {
        while ([...Array(W()).keys()].every(c => filled(c, row))) {
          for (let yy = row; yy < H(); yy++) for (let c = 0; c < W(); c++) api().setCell([c, yy, 0], yy + 1 < H() ? api().getCell([c, yy + 1, 0]) : null, rt);
          s.lines++; rt.emit('line_cleared');
        }
      }
      s.pieces++; s.piece = s.next; s.next = draw();
      if (s.lines >= cfg.goal) end(rt, 'won', 'cleared');
      else if ([...Array(W()).keys()].some(c => filled(c, H() - 2))) end(rt, 'lost', 'topped_out');
    });
  },
});

/** 2048-style slide/merge with a `board` service; spawns 2 (90%) or 4 through rt.random. */
export const slide = fx('gameplay.fixture.slide', 'test: slide and merge', { n: 4, target: 64, moves: 1000 }, {
  card: { provides: { actions: ['slide'], services: ['board'] }, actionSpace: { slide: { type: 'enum', options: ['left', 'right', 'up', 'down'] } } },
  install(rt, cfg) {
    const S = () => rt.store('gameplay.fixture.slide'), n = cfg.n;
    const spawn = g => { const empty = g.map((v, i) => (v ? -1 : i)).filter(i => i >= 0); if (!empty.length) return; g[empty[Math.floor(rt.random() * empty.length)]] = rt.random() < 0.9 ? 2 : 4; };
    if (!S().g) { const g = Array(n * n).fill(0); spawn(g); spawn(g); Object.assign(S(), { g, moves: 0 }); }
    const lineIdx = (d, k) => Array.from({ length: n }, (_, j) => (d === 'left' ? k * n + j : d === 'right' ? k * n + n - 1 - j : d === 'down' ? j * n + k : (n - 1 - j) * n + k));
    const moved = (g, d) => {
      const out = g.slice();
      for (let k = 0; k < n; k++) {
        const idx = lineIdx(d, k), vals = idx.map(i => g[i]).filter(Boolean), res = [];
        for (let i = 0; i < vals.length; i++) { if (vals[i] === vals[i + 1]) { res.push(vals[i] * 2); i++; } else res.push(vals[i]); }
        idx.forEach((i, j) => { out[i] = res[j] || 0; });
      }
      return out;
    };
    const dirs = ['left', 'right', 'up', 'down'];
    rt.provide('board', { get w() { return n; }, get h() { return n; }, get: (x, y) => { const v = S().g[y * n + x]; return v ? String(v) : null; } });
    rt.options(() => rt.state.status !== 'playing' ? [] : dirs.filter(d => moved(S().g, d).some((v, i) => v !== S().g[i])).map(d => ({ label: `slide ${d}`, actions: { slide: d } })));
    rt.action('slide', d => {
      const s = S(), g = moved(s.g, d);
      if (g.every((v, i) => v === s.g[i])) return;
      spawn(g); s.g = g; s.moves++;
      if (Math.max(...g) >= cfg.target) end(rt, 'won', 'target');
      else if (s.moves >= cfg.moves || !dirs.some(x => moved(g, x).some((v, i) => v !== g[i]))) end(rt, 'lost', 'stuck');
    });
  },
});

/** Match-3 swaps with a `board` service: legal swaps only, clears runs ≥ 3, gravity, random refill, score goal. */
export const match = fx('gameplay.fixture.match', 'test: swap and match', { w: 5, h: 5, colors: ['r', 'g', 'b', 'y'], target: 30, moves: 20, layout: null }, {
  card: { provides: { actions: ['swap'], services: ['board'] } },
  install(rt, cfg) {
    const { w, h } = cfg, S = () => rt.store('gameplay.fixture.match');
    const rnd = () => cfg.colors[Math.floor(rt.random() * cfg.colors.length)];
    const runs = g => { const clear = new Set(); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = g[y * w + x]; if (!c) continue; if (x + 2 < w && g[y * w + x + 1] === c && g[y * w + x + 2] === c) [0, 1, 2].forEach(k => clear.add(y * w + x + k)); if (y + 2 < h && g[(y + 1) * w + x] === c && g[(y + 2) * w + x] === c) [0, 1, 2].forEach(k => clear.add((y + k) * w + x)); } return clear; };
    if (!S().g) {
      let g = cfg.layout ? cfg.layout.flat() : Array.from({ length: w * h }, rnd);
      if (!cfg.layout) for (let guard = 0; guard < 50 && runs(g).size; guard++) for (const i of runs(g)) g[i] = rnd();
      Object.assign(S(), { g, moves: 0 });
      rt.state.vars.score = 0;
    }
    const swapped = (g, a, b) => { const o = g.slice(); [o[a], o[b]] = [o[b], o[a]]; return o; };
    const legal = () => { const g = S().g, out = []; for (let i = 0; i < w * h; i++) for (const j of [i + 1, i + w]) { if ((j === i + 1 && (i % w) === w - 1) || j >= w * h) continue; if (runs(swapped(g, i, j)).size) out.push([i, j]); } return out; };
    rt.provide('board', { get w() { return w; }, get h() { return h; }, get: (x, y) => S().g[y * w + x] });
    rt.options(() => rt.state.status !== 'playing' ? [] : legal().map(([a, b]) => ({ label: `swap ${a} ${b}`, actions: { swap: [a, b] } })));
    rt.action('swap', ([a, b]) => {
      const s = S(); let g = swapped(s.g, a, b);
      if (!runs(g).size) return;
      for (let guard = 0; guard < 20; guard++) {
        const c = runs(g); if (!c.size) break;
        rt.state.vars.score += c.size;
        for (const i of c) g[i] = null;
        for (let x = 0; x < w; x++) { const col = []; for (let y = 0; y < h; y++) if (g[y * w + x]) col.push(g[y * w + x]); for (let y = 0; y < h; y++) g[y * w + x] = col[y] ?? rnd(); }
      }
      s.g = g; s.moves++;
      if (rt.state.vars.score >= cfg.target) end(rt, 'won', 'score');
      else if (s.moves >= cfg.moves) end(rt, 'lost', 'out_of_moves');
    });
  },
});

// ---------- real-time ----------

/** Pellets (collectible entities) eaten on contact; wins when none are left. */
export const pellets = fx('gameplay.fixture.pellets', 'test: collect pellets', {}, {
  install(rt) {
    rt.system('interaction', rt => {
      const p = rt.player(); if (!p) return;
      for (const e of Object.values(rt.state.entities)) if (e.components.collectible && same(e.at, p.at)) { rt.despawn(e.id); rt.emitTyped('collected', 'pellet'); }
      if (!Object.values(rt.state.entities).some(e => e.components.collectible)) end(rt, 'won', 'cleared');
    });
  },
});
/** Chasers: `ai` entities step greedily toward the player every `ai.every` frames; contact costs a life. */
export const chasers = fx('gameplay.fixture.chasers', 'test: chasing enemies', { lives: 3 }, {
  install(rt, cfg) {
    if (rt.state.vars.lives === undefined) rt.state.vars.lives = cfg.lives;
    rt.system('ai', rt => {
      const p = rt.player(); if (!p) return;
      for (const e of Object.values(rt.state.entities)) {
        if (!e.components.ai) continue;
        const ai = e.components.ai, api = rt.space(e.space);
        if (rt.state.frame % (ai.every || 6) === 0) {
          const best = api.neighbors(fl(e.at)).map(n => ({ n, d: Math.abs(n[0] - fl(p.at)[0]) + Math.abs(n[1] - fl(p.at)[1]) })).sort((a, b) => a.d - b.d)[0];
          if (best) api.setPos(e, best.n, rt);
        }
        if (same(e.at, p.at)) { rt.state.vars.lives--; rt.emit('hurt', { who: 'player' }); api.setPos(e, ai.home, rt); if (rt.state.vars.lives <= 0) end(rt, 'lost', 'caught'); }
      }
    });
  },
});

/** Bullets fall from the top every `every` frames (hazard + body.vel); contact costs hp; surviving `frames` wins. */
export const bullets = fx('gameplay.fixture.bullets', 'test: falling bullets', { every: 20, speed: 0.15, row: false, frames: 600 }, {
  install(rt, cfg) {
    rt.system('physics', rt => {
      const p = rt.player(); if (!p) return;
      const api = rt.space(p.space), [W, H] = api.size;
      if (rt.state.frame % cfg.every === 0) {
        if (cfg.row) for (let x = 0; x < W; x += 0.5) rt.spawn('bullet', { at: [x, H - 1, 0], components: { hazard: {}, body: { size: [0.2, 0.2, 1], vel: [0, -cfg.speed, 0] } } });
        else rt.spawn('bullet', { at: [rt.random() * (W - 1), H - 1, 0], components: { hazard: {}, body: { size: [0.2, 0.2, 1], vel: [0, -cfg.speed, 0] } } });
      }
      for (const e of Object.values(rt.state.entities)) {
        if (!e.components.hazard) continue;
        const v = e.components.body.vel; e.at = [e.at[0] + v[0], e.at[1] + v[1], 0];
        if (e.at[1] < 0) { rt.despawn(e.id); continue; }
        if (Math.hypot(e.at[0] - p.at[0], e.at[1] - p.at[1]) < 0.6) { p.components.health.hp--; rt.emit('damaged', { who: 'player' }); rt.despawn(e.id); if (p.components.health.hp <= 0) { end(rt, 'lost', 'shot'); return; } }
      }
      if (rt.state.frame >= cfg.frames) end(rt, 'won', 'survived');
    });
  },
});

/** Auto-runner: the player moves +x every frame; move axes change lane (y); solid cells kill; the far end wins. */
export const runner = fx('gameplay.fixture.runner', 'test: auto-runner lanes', { speed: 0.25 }, {
  install(rt, cfg) {
    rt.system('movement', rt => {
      const p = rt.player(); if (!p) return;
      const api = rt.space(p.space), [W, H] = api.size, s = rt.store('gameplay.fixture.runner'), m = rt.input.axes?.move;
      let y = p.at[1];
      if (m && m[1] && !(s.cool > 0)) { y = Math.min(H - 1, Math.max(0, y + Math.sign(m[1]))); s.cool = 6; }
      s.cool = Math.max(0, (s.cool || 0) - 1);
      api.setPos(p, [p.at[0] + cfg.speed, y, 0], rt);
      if (api.getCell(p.at) !== null) end(rt, 'lost', 'crashed');
      else if (p.at[0] >= W - 1) end(rt, 'won', 'finished');
    });
  },
});

/** Melee: `attack` hits foes within 1.5 (cooldown 20); `kick` reaches only 0.3. Foe AI approaches and attacks. */
export const melee = fx('gameplay.combat.fixture', 'test: melee versus', { foeDamage: 1, foeAttacks: true }, {
  card: { provides: { actions: ['attack', 'kick'] } },
  install(rt, cfg) {
    const strike = reach => { const p = rt.player(), s = rt.store('gameplay.combat.fixture'); if (!p || (s.cool || 0) > 0) return; s.cool = 20; for (const e of Object.values(rt.state.entities)) if (e !== p && e.components.health && Math.abs(e.at[0] - p.at[0]) <= reach + 0.05 && Math.abs(e.at[1] - p.at[1]) < 1) { e.components.health.hp--; rt.emit('damaged', { who: e.id }); } };
    rt.action('attack', () => strike(1.5));
    rt.action('kick', () => strike(0.3));
    rt.system('movement', rt => { const p = rt.player(), m = rt.input.axes?.move; if (p && m && m[0]) rt.space(p.space).setPos(p, [Math.max(0, Math.min(rt.space(p.space).size[0] - 1, p.at[0] + 0.1 * Math.sign(m[0]))), p.at[1], 0], rt); });
    rt.system('ai', rt => {
      const p = rt.player(), s = rt.store('gameplay.combat.fixture'); if (!p) return;
      s.cool = Math.max(0, (s.cool || 0) - 1);
      for (const e of Object.values(rt.state.entities)) {
        if (e === p || !e.components.ai) continue;
        if (hp(e) <= 0) { rt.despawn(e.id); rt.emitTyped('defeated', e.archetype); continue; }
        const dx = p.at[0] - e.at[0];
        if (Math.abs(dx) > 1.2) rt.space(e.space).setPos(e, [e.at[0] + 0.05 * Math.sign(dx), e.at[1], 0], rt);
        const a = e.components.attacks ??= { t: 0, active: false };
        if (!cfg.foeAttacks) continue;
        a.t++;
        a.active = a.t % 45 > 35;
        if (a.t % 45 === 0 && Math.abs(dx) <= 1.5) { p.components.health.hp -= cfg.foeDamage; rt.emit('damaged', { who: 'player' }); }
      }
      if (p.components.health.hp <= 0) end(rt, 'lost', 'ko');
      else if (!Object.values(rt.state.entities).some(e => e !== p && e.components.ai)) end(rt, 'won', 'ko');
    });
  },
});

/** Launcher: `launch {angle, power}` fires a ballistic projectile; targets (health) are destroyed on contact; limited shots. */
export const launcher = fx('gameplay.fixture.launcher', 'test: launcher', { shots: 5, from: [1, 1, 0], gravity: 0.01 }, {
  card: { provides: { actions: ['launch'] }, actionSpace: { launch: { angle: { min: 0.1, max: 1.4 }, power: { min: 0.3, max: 1 } } } },
  install(rt, cfg) {
    const S = () => rt.store('gameplay.fixture.launcher');
    S().shots ??= cfg.shots;
    rt.action('launch', ({ angle, power }) => { if (S().shots <= 0 || Object.values(rt.state.entities).some(e => e.archetype === 'shot')) return; S().shots--; rt.spawn('shot', { at: cfg.from.slice(), components: { body: { size: [0.2, 0.2, 1], vel: [Math.cos(angle) * power * 0.6, Math.sin(angle) * power * 0.6, 0] } } }); });
    rt.system('physics', rt => {
      const api = rt.space(rt.doc.spaces[0].id), [W, H] = api.size;
      for (const e of Object.values(rt.state.entities)) {
        if (e.archetype !== 'shot') continue;
        const v = e.components.body.vel; v[1] -= cfg.gravity;
        e.at = [e.at[0] + v[0], e.at[1] + v[1], 0];
        if (e.at[0] < 0 || e.at[0] >= W || e.at[1] < 0 || e.at[1] >= H || api.getCell(e.at) !== null) { rt.despawn(e.id); continue; }
        for (const t of Object.values(rt.state.entities)) if (t.components.health && t.id !== 'player' && Math.hypot(t.at[0] - e.at[0], t.at[1] - e.at[1]) < 0.7) { t.components.health.hp = 0; rt.despawn(t.id); rt.emitTyped('defeated', t.archetype); }
      }
      const left = Object.values(rt.state.entities).filter(t => t.components.health && t.id !== 'player').length;
      if (!left) end(rt, 'won', 'cleared');
      else if (S().shots <= 0 && !Object.values(rt.state.entities).some(e => e.archetype === 'shot')) end(rt, 'lost', 'out_of_shots');
    });
  },
});

/** Bouncing balls (body.vel) reflect off walls and solid cells; `flip` kicks low balls; glue cells stop them; leaky drops the right wall. */
export const balls = fx('gameplay.fixture.balls', 'test: bouncing bodies', { glue: [], leaky: false }, {
  card: { provides: { actions: ['flip'] } },
  install(rt, cfg) {
    rt.action('flip', () => { for (const e of Object.values(rt.state.entities)) if (e.archetype === 'ball' && e.at[1] < 2) e.components.body.vel[1] = Math.abs(e.components.body.vel[1]) + 0.05; });
    rt.system('physics', rt => {
      const api = rt.space(rt.doc.spaces[0].id), [W, H] = api.size;
      for (const e of Object.values(rt.state.entities)) {
        if (e.archetype !== 'ball') continue;
        const v = e.components.body.vel;
        if (cfg.glue.some(g => same(g, e.at))) { v[0] = 0; v[1] = 0; continue; }
        const nx = e.at[0] + v[0], ny = e.at[1] + v[1];
        const wallX = nx < 0 || (!cfg.leaky && nx >= W) || api.getCell([nx, e.at[1], 0]) !== null && nx < W && nx >= 0;
        const wallY = ny < 0 || ny >= H || (ny >= 0 && ny < H && api.getCell([e.at[0], ny, 0]) !== null);
        if (wallX) v[0] = -v[0]; if (wallY) v[1] = -v[1];
        e.at = [e.at[0] + v[0], e.at[1] + v[1], 0];
      }
    });
  },
});

/** Turn-based battle on any space: options strike / heavy / heal; the foe answers each turn. */
export const battle = fx('gameplay.fixture.battle', 'test: turn-based battle', { foeHp: 12, foeDamage: 2, foeHit: 0.7 }, {
  card: { provides: { actions: ['turn'] } },
  install(rt, cfg) {
    if (!rt.state.entities.foe) rt.spawn('foe', { id: 'foe', at: rt.doc.player?.at, components: { health: { hp: cfg.foeHp, max: cfg.foeHp } } });
    rt.options(() => (rt.state.status === 'playing' && rt.entity('foe') ? ['strike', 'heavy', 'heal'].map(k => ({ label: k, actions: { turn: k } })) : []));
    rt.action('turn', k => {
      const p = rt.player(), f = rt.entity('foe'); if (!p || !f) return;
      if (k === 'strike' && rt.random() < 0.85) f.components.health.hp -= 3;
      if (k === 'heavy' && rt.random() < 0.5) f.components.health.hp -= 6;
      if (k === 'heal') p.components.health.hp = Math.min(p.components.health.max, p.components.health.hp + 4);
      if (f.components.health.hp <= 0) { rt.despawn('foe'); end(rt, 'won', 'victory'); return; }
      if (rt.random() < cfg.foeHit) p.components.health.hp -= cfg.foeDamage;
      if (p.components.health.hp <= 0) end(rt, 'lost', 'fainted');
    });
  },
});

// ---------- invariant breakers ----------

export const breakers = {
  nan: fx('gameplay.fixture.nan', 'test: writes NaN', {}, { install(rt) { rt.system('rules', rt => { if (rt.state.frame === 5) rt.state.vars.speed = 0 / 0; }); } }),
  random: fx('gameplay.fixture.mathrandom', 'test: uses Math.random', {}, { install(rt) { rt.system('rules', rt => { rt.state.vars.noise = Math.random(); }); } }),
  explode: fx('gameplay.fixture.explode', 'test: spawns without limit', {}, { install(rt) { rt.system('rules', rt => { for (let i = 0; i < 40; i++) rt.spawn('dust', { at: [0, 0, 0] }); }); } }),
  // A bullet pattern: 90 shots alive at once at most (each lasts 90 frames): many entities, but bounded.
  volley: fx('gameplay.fixture.volley', 'test: a bounded stream of short-lived shots', {}, { install(rt) { rt.system('rules', rt => { const s = rt.store('gameplay.fixture.volley'); s.t = (s.t || 0) + 1; s.shots ??= []; s.shots.push(rt.spawn('dust', { at: [0, 0, 0] }).id); while (s.shots.length > 90) rt.despawn(s.shots.shift()); }); } }),
  storm: fx('gameplay.fixture.storm', 'test: event storm', {}, { install(rt) { rt.system('rules', rt => { for (let i = 0; i < 2500; i++) rt.emit('tick'); }); } }),
  hidden: fx('gameplay.fixture.hidden', 'test: simulation state outside rt.state', {}, { install(rt) { let n = 0; rt.system('rules', rt => { n++; rt.state.vars.n = n; }); } }),
  clock: fx('gameplay.fixture.clock', 'test: a store that changes every step, with a solverKey', { keyed: true }, {
    install(rt) { rt.system('late', rt => { const s = rt.store('gameplay.fixture.clock'); s.t = (s.t || 0) + 1; }); },
  }),
};
breakers.clock.solverKey = (rt, config) => (config.keyed ? 0 : rt.store('gameplay.fixture.clock').t);

/** Macro options: "travel to zone X" whose apply(rt) walks the player there step by step. */
export const travel = fx('gameplay.fixture.travel', 'test: macro travel options', {}, {
  install(rt) {
    rt.options(rt => {
      const p = rt.player(); if (!p) return [];
      const api = rt.space(p.space), zones = rt.doc.spaces.find(s => s.id === p.space).zones || [];
      return zones.filter(z => !api.inZone(p, z.id, rt)).map(z => ({ label: `travel ${z.id}`, apply(rt) {
        const pl = rt.player(), path = api.path(pl.at, [z.rect[0], z.rect[1], 0]);
        if (!path) return;
        for (const c of path.slice(1)) { api.move(pl, c, rt); rt.step({}); if (rt.state.status !== 'playing') return; }
      } }));
    });
  },
});

// ---------- catalogues and documents ----------

export const FIXTURES = [rows, platformer, step, glide, spawner, abilities, falling, slide, match, pellets, chasers, bullets, runner, melee, launcher, balls, battle, travel, ...Object.values(breakers)];
export function fixtureCatalogue(extra = []) {
  // engine.input.actions and the UI that lists choices: the gate's bots play through the controls the host mounts
  // (v2/verify/controls.js): keys, the story's option list, the choices panel for chosen values (travel).
  const registry = new Registry([testSpace, ledgeSpace, spaceGraph, ...spaces2d.filter(p => p.id !== 'engine.space.graph'), storyboard, inventory, inputActions, uiStory, uiChoices, ...FIXTURES, ...extra]);
  return { registry, logic: buildLogic(registry, Logic) };
}
export function normalized(doc, cat = fixtureCatalogue()) {
  const r = preflight(doc, cat.registry, cat.logic);
  if (!r.ok) throw Error(`fixture doc failed preflight: ${JSON.stringify(r.errors)}`);
  return { ...cat, doc: r.doc, checked: r };
}

/** A document on the test space. */
export function cellDoc({ id = 'cells', size = [8, 8, 1], solid = [], zones = [], systems = [], archetypes = [], at = [0, 0, 0], plot, components = {}, space = 'engine.space.test', spaceWith = {} } = {}) {
  return {
    schema: 'gameverse.v2.game/0.2', id, title: id, seed: 1,
    spaces: [{ id: 'board', use: space, with: { size, solid, ...spaceWith }, zones }],
    systems,
    ...(plot ? { plot } : {}),
    content: { archetypes: [{ id: 'hero', components }, ...archetypes] },
    player: { archetype: 'hero', at },
  };
}
/** "Reach the exit" plot: beat on entering `zone` ends the game. */
export const reachPlot = zone => ({ storyboard: { acts: [{ id: 'a', beats: [{ id: 'arrive', when: { zone }, do: [{ do: 'end_game', ending: 'out' }] }] }] }, endings: [{ id: 'out' }] });

/** The kernel's quiet-manor mystery on the graph space. */
export const mystery = () => ({
  schema: 'gameverse.v2.game/0.2', id: 'manor', title: 'The Quiet Manor', seed: 1,
  spaces: [{ id: 'manor', use: 'engine.space.graph', zones: [
    { id: 'hall', name: 'Hall', exits: [{ to: 'garden' }, { to: 'library', gate: { item: 'brass_key' } }] },
    { id: 'garden', name: 'Garden', exits: [{ to: 'hall' }] },
    { id: 'library', name: 'Library', exits: [{ to: 'hall' }] },
  ] }],
  systems: [{ use: 'gameplay.inventory' }, { use: 'plot.storyboard' }],
  plot: {
    characters: [{ id: 'butler', name: 'Hobbs' }],
    storyboard: { acts: [
      { id: 'arrival', beats: [{ id: 'greeting', do: [{ do: 'say', character: 'butler', text: 'The master is missing.' }] }] },
      { id: 'search', beats: [
        { id: 'find_key', when: { zone: 'garden' }, do: [{ do: 'give_item', item: 'brass_key' }, { do: 'set_flag', flag: 'key_found' }] },
        { id: 'find_letter', after: ['find_key'], when: { zone: 'library' }, do: [{ do: 'give_item', item: 'letter' }] },
        { id: 'solve', when: { item: 'letter' }, do: [{ do: 'end_game', ending: 'truth' }] },
      ] },
    ] },
    endings: [{ id: 'truth', title: 'The truth' }],
  },
  content: { items: [{ id: 'brass_key', name: 'Brass key' }, { id: 'letter', name: 'Letter' }], archetypes: [{ id: 'detective', components: { name: 'You' } }] },
  player: { archetype: 'detective', space: 'manor', at: 'hall' },
});
