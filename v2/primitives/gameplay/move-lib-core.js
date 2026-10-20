// Shared machinery for every gameplay.move.* primitive and gameplay.mount.
// Space-agnostic: everything goes through capability methods (KERNEL_API §3),
// so the same controller runs on engine.space.test, tilemap, arena2d, voxel,
// mesh3d and grid.
//
// Conventions (documented on the cards and in the move.index.js header):
// - Entity component `components.move` is owned by the move workstream. It
//   marks an NPC as "driven by gameplay.move.*" and holds per-mode state:
//   { base?, mode, since, req, held[], path, abilities?, <mode>: {...} }.
// - Kinematics live in `components.body`: vel [x,y,z] (always 3 long; 2D
//   spaces use [x,y,0]), grounded, facing (yaw in 3D, atan2 angle in 2D),
//   dir (unit facing vector), look [yaw,pitch] when steering by look, state
//   (walk|run|sprint|crouch|air|swim|dive|climb|glide|fly|dash|dodge|wall|
//   ledge|grapple|ride|ship|lanes|grid), controller = 'move'. That stops
//   engine.physics.character from integrating them a second time.
// - 3D yaw is measured from +z toward +x: forward = [sin yaw, 0, cos yaw],
//   right = [-cos yaw, 0, sin yaw]. Move axes [x,y] are relative to
//   body.look[0], then input axes.camera[0], then 0. In 2D top-down, +y is up the screen.
// - NPC intent, in priority: components.input (the player's input shape),
//   components.steer {dir, speed?, run?, jump?, face?}, components.moveTo
//   (kernel move_to intent; followed with space.path waypoints, cleared on
//   arrival with `arrived` / `arrived:<zone>`, or on failure with `move_failed`).
// - Several move primitives can act on one entity. Each claims a mode with a
//   priority in the 'input' phase. The highest claim owns the entity in
//   'movement', so a swim takes over from a walk without either knowing the other.

export const DT = 1 / 60;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));
export const v3 = a => [a?.[0] ?? 0, a?.[1] ?? 0, a?.[2] ?? 0];
export const add = (a, b) => a.map((v, i) => v + (b[i] ?? 0));
export const sub = (a, b) => a.map((v, i) => v - (b[i] ?? 0));
export const scale = (a, k) => a.map(v => v * k);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
export const len = a => Math.hypot(...a);
export const norm = a => { const l = len(a); return l > 1e-9 ? a.map(v => v / l) : a.map(() => 0); };
export const round6 = v => Math.round(v * 1e6) / 1e6;
const AXES = ['x', 'y', 'z'];

// ---------------------------------------------------------------- components

export const mv = e => (e.components.move ??= {});
export function bodyOf(e) {
  const b = (e.components.body ??= {});
  b.vel = v3(b.vel);
  return b;
}
export const state = (e, key) => (mv(e)[key] ??= {});

// ---------------------------------------------------------------- spaces

export function spaceApi(rt, e) {
  if (!e?.space) return null;
  try { return rt.space(e.space); } catch { return null; }
}
export const dimsOf = e => (Array.isArray(e?.at) ? e.at.length : 0);
/** Continuous movement (slide or free setPos) versus discrete navigate.move steps (grid cells, graph zones). */
export const isContinuous = (api, e) => dimsOf(e) > 0 && (typeof api?.slide === 'function' || typeof api?.move !== 'function');

/**
 * Frame for an entity: dims, the up axis (from gravityAt, or null without
 * gravity), the ground plane axes, the vertical axis used by fliers and
 * swimmers, and the gravity vector. planeParam overrides: 'x' | 'xy' | 'xz'.
 */
export function frameOf(api, e, planeParam = 'auto') {
  const dims = dimsOf(e);
  if (!dims) return { dims: 0, up: null, upSign: 1, vert: null, plane: [], g: [0, 0, 0], gmag: 0 };
  const g = api?.gravityAt ? v3(api.gravityAt(e.at)) : [0, 0, 0];
  let up = null;
  for (let i = 0; i < dims; i++) if (Math.abs(g[i]) > 1e-9 && (up === null || Math.abs(g[i]) > Math.abs(g[up]))) up = i;
  const gmag = up === null ? 0 : Math.abs(g[up]);
  const upSign = up === null ? 1 : -Math.sign(g[up]);
  const flat = i => Array.isArray(api?.size) && api.size[i] === 1;
  let plane;
  if (planeParam === 'x') plane = [0];
  else if (planeParam === 'xy') plane = [0, 1];
  else if (planeParam === 'xz') plane = [0, 2];
  else if (up !== null) plane = [...Array(dims).keys()].filter(i => i !== up && !flat(i));
  else plane = dims === 2 ? [0, 1] : flat(2) ? [0, 1] : [0, 2];
  plane = plane.filter(i => i < dims);
  const vert = up ?? (dims === 3 && !plane.includes(1) ? 1 : dims === 2 && plane.length === 1 ? 1 - plane[0] : null);
  return { dims, up, upSign, vert, plane, g, gmag };
}
/** True when the frame is a side view: one horizontal axis plus a vertical one. */
export const sideView = fr => fr.plane.length === 1 && fr.vert !== null;

/** Body box (min/max) honoring the space anchor: 'min' (test), 'center' (2D spaces), 'feet' (3D), 'cell'. */
export function boxOf(api, e) {
  const dims = dimsOf(e), at = e.at.slice(0, dims);
  const size = (e.components.body?.size || []).slice(0, dims);
  while (size.length < dims) size.push(1);
  const anchor = api?.anchor ?? (api?.kind === 'test' ? 'min' : dims === 3 ? 'feet' : 'min');
  let min;
  if (anchor === 'center' || anchor === 'cell') min = at.map((v, i) => v - size[i] / 2);
  else if (anchor === 'feet') min = at.map((v, i) => (i === 1 ? v : v - size[i] / 2));
  else min = at.slice();
  return { min, max: min.map((v, i) => v + size[i]), size, anchor };
}

// ---------------------------------------------------------------- blocks and probes

function blockIndex(rt) {
  const c = rt.caches;
  if (c.moveBlocksDoc !== rt.doc) { c.moveBlocksDoc = rt.doc; c.moveBlocks = new Map((rt.doc.content?.blocks || []).map(b => [b.id, b])); }
  return c.moveBlocks;
}
export function blockTags(rt, block) {
  if (block == null) return [];
  const def = blockIndex(rt).get(block);
  return [String(block), ...(def?.tags || [])];
}
export function isSolidBlock(rt, block) {
  if (block == null || block === '' || block === 'air') return false;
  const def = blockIndex(rt).get(block);
  if (!def) return !['water', 'lava', 'ladder', 'vine'].includes(block);
  return def.solid !== false;
}
/** What occupies point p: {solid, block, tags} via getCell, else a short raycast. */
export function probe(rt, api, p) {
  if (typeof api?.getCell === 'function') {
    const block = api.getCell(p);
    return { solid: isSolidBlock(rt, block), block: block ?? null, tags: blockTags(rt, block) };
  }
  if (typeof api?.raycast === 'function') {
    const dir = p.map(() => 0); dir[1] = -1;
    const r = api.raycast(p, dir, 0.01);
    const block = r?.cell && typeof api.getCell === 'function' ? api.getCell(r.cell) : (r?.block ?? null);
    return { solid: r?.hit === 'cell' && (r.dist ?? 0) <= 0.01, block, tags: blockTags(rt, block) };
  }
  return { solid: false, block: null, tags: [] };
}
export const canProbe = api => typeof api?.getCell === 'function' || typeof api?.raycast === 'function';
/** Tags of the zone at point p (zones carry tags[]), for water/climb/ice regions in spaces without cells. */
export function zoneTags(rt, e, p) {
  const api = spaceApi(rt, e);
  const id = api?.zoneAt?.(p);
  if (!id) return [];
  return rt.doc.spaces.find(s => s.id === e.space)?.zones?.find(z => z.id === id)?.tags || [];
}

/** Water submersion of a body: fraction 0..1 of probes (feet, middle, head) in liquid, and whether the head is under. */
export function submersion(rt, api, e, fr, tags = ['water', 'liquid', 'fluid']) {
  if (!dimsOf(e) || fr.vert === null) return { frac: 0, head: false, surfaceAt: null };
  const b = boxOf(api, e), v = fr.vert, pts = [0.1, 0.5, 0.9].map(k => { const p = b.min.map((m, i) => m + b.size[i] / 2); p[v] = b.min[v] + b.size[v] * k; return p; });
  const wet = p => {
    if (canProbe(api)) { const pr = probe(rt, api, p); if (pr.tags.some(t => tags.includes(t))) return true; }
    if (typeof api?.waterDepthAt === 'function' && typeof api?.groundAt === 'function' && fr.dims === 3) {
      const depth = api.waterDepthAt(p[0], p[2]);
      if (depth > 0) { const top = api.groundAt(p[0], p[2]).y + depth; if (p[1] < top) return true; }
    }
    return zoneTags(rt, e, p).some(t => tags.includes(t));
  };
  const flags = pts.map(wet);
  return { frac: flags.filter(Boolean).length / 3, head: flags[2], feet: flags[0] };
}

// ---------------------------------------------------------------- motion

const blockedArr = b => (Array.isArray(b) ? [0, 1, 2].map(i => Boolean(b[i])) : AXES.map(a => Boolean(b?.[a])));

/**
 * Move e by delta through the space. Order of preference: the
 * engine.physics.character service (step-up, slope limit), space.slide
 * (collide-and-slide), then an axis-separated getCell collision, then plain
 * setPos. Blocked axes are closed to contact by halving. Returns
 * {moved, blocked:[bx,by,bz], grounded, normal}.
 */
export function motor(rt, e, api, delta, opts = {}) {
  const dims = dimsOf(e), d = v3(delta).slice(0, dims);
  const before = e.at.slice();
  const char = rt.hasService?.('character') ? rt.service('character') : null;
  let slide = null;
  if (char?.move && !opts.raw) slide = dd => char.move(e, dd, rt, opts);
  else if (typeof api?.slide === 'function') slide = dd => api.slide(e, dd, rt, opts);
  let blocked = [false, false, false], normal = null, extra = {};
  if (!d.some(v => v !== 0)) return { moved: false, blocked, grounded: groundedOf(rt, api, e), normal: null };
  if (slide) {
    const r = slide(d) || {};
    blocked = blockedArr(r.blocked); normal = r.normal ?? null; extra = r;
    for (let i = 0; i < dims; i++) {
      if (!blocked[i] || !d[i]) continue;
      let step = d[i];
      for (let k = 0; k < 4; k++) { step /= 2; const dd = d.map(() => 0); dd[i] = step; const r2 = slide(dd) || {}; if (blockedArr(r2.blocked)[i]) continue; }
    }
  } else if (typeof api?.getCell === 'function' && typeof api?.setPos === 'function') {
    const p = e.at.slice(0, dims);
    for (let i = 0; i < dims; i++) {
      if (!d[i]) continue;
      const next = p.slice(); next[i] += d[i];
      if (boxHits(rt, api, e, next)) {
        blocked[i] = true;
        let step = d[i];
        for (let k = 0; k < 5; k++) { step /= 2; const t = p.slice(); t[i] += step; if (!boxHits(rt, api, e, t)) p[i] = t[i]; }
      } else p[i] = next[i];
    }
    api.setPos(e, p, rt);
  } else if (typeof api?.setPos === 'function') api.setPos(e, add(e.at, d), rt);
  return { moved: e.at.some((v, i) => v !== before[i]), blocked, grounded: groundedOf(rt, api, e), normal, bumped: extra.bumped, steep: extra.steep };
}

/** Does the body placed at `at` overlap a solid cell? (fallback collision, cell size 1) */
export function boxHits(rt, api, e, at) {
  const b = boxOf(api, { ...e, at });
  const lo = b.min.map(v => Math.floor(v + 1e-6)), hi = b.max.map(v => Math.ceil(v - 1e-6) - 1);
  const it = (i, c) => { if (i === lo.length) return probe(rt, api, c).solid; for (let x = lo[i]; x <= hi[i]; x++) { c[i] = x + 0.5; if (it(i + 1, c)) return true; } return false; };
  return it(0, lo.slice());
}

export function groundedOf(rt, api, e) {
  if (typeof api?.grounded === 'function') return Boolean(api.grounded(e));
  return false;
}

/** Probe for a wall beside the body along plane axis `ax` in direction sign s (side view and 3D). */
export function wallBeside(rt, api, e, ax, s, reach = 0.08, heights = [0.2, 0.5, 0.8]) {
  if (!dimsOf(e)) return null;
  const fr = frameOf(api, e), b = boxOf(api, e), v = fr.vert ?? 1;
  if (canProbe(api)) {
    let hits = 0, tags = [];
    for (const k of heights) {
      const p = b.min.map((m, i) => m + b.size[i] / 2);
      p[ax] = s > 0 ? b.max[ax] + reach : b.min[ax] - reach;
      if (v < p.length) p[v] = b.min[v] + b.size[v] * k;
      const pr = probe(rt, api, p);
      if (pr.solid || pr.tags.some(t => t === 'ladder' || t === 'climbable')) { hits++; tags = [...tags, ...pr.tags]; }
    }
    return hits ? { hits, tags, normal: (() => { const n = [0, 0, 0]; n[ax] = -s; return n; })() } : null;
  }
  if (typeof api?.contacts === 'function') {
    const c = (api.contacts(e) || []).find(c => c.normal && Math.sign(c.normal[ax] || 0) === -s);
    if (c) return { hits: 1, tags: c.cell && api.getCell ? blockTags(rt, api.getCell(c.cell)) : [], normal: v3(c.normal) };
  }
  return null;
}
/** Is the space above a wall free at head height (a ledge you can pull up onto)? */
export function ledgeAt(rt, api, e, ax, s) {
  if (!canProbe(api)) return null;
  const fr = frameOf(api, e), b = boxOf(api, e), v = fr.vert ?? 1;
  const at = k => { const p = b.min.map((m, i) => m + b.size[i] / 2); p[ax] = s > 0 ? b.max[ax] + 0.1 : b.min[ax] - 0.1; p[v] = b.min[v] + b.size[v] * k; return p; };
  const chest = probe(rt, api, at(0.55)), over = probe(rt, api, at(1.1));
  if (!chest.solid || over.solid) return null;
  // Find the wall top: the first free cell above chest height.
  let top = null;
  for (let k = 0.6; k <= 1.15; k += 0.05) if (!probe(rt, api, at(k)).solid) { top = Math.floor(at(k)[v] + 1e-6); break; }
  if (top === null) return null;
  const stand = e.at.slice();
  const shift = b.size[ax] + 0.15;
  stand[ax] += s * shift;
  stand[v] = top + (b.anchor === 'center' || b.anchor === 'cell' ? b.size[v] / 2 : 0) + 0.01;
  return boxHits(rt, api, e, stand) ? null : { top, stand };
}

// ---------------------------------------------------------------- input and intent

/** The input source for e: rt.input for the player, components.input for NPCs that use the player path. */
function source(rt, e) { return e.id === 'player' ? rt.input : e.components.input || null; }

/** Per-frame control reader with edge detection; previous held verbs live in components.move.held. */
export function controls(rt, e) {
  const src = source(rt, e);
  if (!src) return null;
  const cache = frameCache(rt).ctl;
  if (cache.has(e.id)) return cache.get(e.id);
  const actions = src.actions || {}, held = src.held || {}, prev = new Set(mv(e).held || []);
  const down = v => Boolean(actions[v] || held[v]);
  const pressed = v => Boolean(actions[v]) && !prev.has(v);
  const released = v => prev.has(v) && !down(v);
  let move = src.axes?.move ?? (Array.isArray(actions.move) ? actions.move : null);
  if (!move) move = [(down('right') ? 1 : 0) - (down('left') ? 1 : 0), (down('up') ? 1 : 0) - (down('down') ? 1 : 0)];
  let [x, y] = [Number(move[0]) || 0, Number(move[1]) || 0];
  const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
  const c = { move: [x, y], look: src.axes?.look ?? null, camera: src.axes?.camera ?? null, heading: src.axes?.heading ?? null, aim: src.axes?.aim ?? null, down, pressed, released, actions, held, value: v => actions[v] };
  cache.set(e.id, c);
  return c;
}

function frameCache(rt) {
  const c = rt.caches;
  if (!c.moveFrame || c.moveFrame.f !== rt.state.frame || c.moveFrame.stateRef !== rt.state.prim) c.moveFrame = { f: rt.state.frame, stateRef: rt.state.prim, ctl: new Map(), intent: new Map() };
  return c.moveFrame;
}

/** Steering yaw for 3D: body.look yaw, then camera axis, then heading axis, then 0. */
export function yawOf(e, ctl) {
  const b = e.components.body || {};
  if (Array.isArray(b.look)) return b.look[0];
  if (ctl?.camera) return Number(ctl.camera[0]) || 0;
  if (ctl?.heading != null) return Number(ctl.heading) || 0;
  return 0;
}
/** Map stick [x,y] into a world vector on the frame's ground plane. */
export function planeVector(fr, x, y, yaw = 0) {
  const v = [0, 0, 0];
  if (fr.plane.length === 1) v[fr.plane[0]] = x;
  else if (fr.plane.length >= 2) {
    const [a, b] = fr.plane;
    if (fr.dims === 3 && b === 2) { const s = Math.sin(yaw), c = Math.cos(yaw); v[0] = -x * c + y * s; v[2] = x * s + y * c; }
    else { const s = Math.sin(yaw), c = Math.cos(yaw); v[a] = x * c - y * s; v[b] = x * s + y * c; }
  }
  return v;
}
export const project = (fr, vec) => { const out = [0, 0, 0]; for (const i of fr.plane) out[i] = vec[i] ?? 0; return out; };

/**
 * What e wants to do this frame, in world terms:
 * { dir: [x,y,z] plane vector (|dir| ≤ 1), vert: -1..1, stick, run, jump, jumpHeld, ctl, source, speed? }.
 * opts.free3d: steer moveTo/steer in full 3D (fliers, swimmers). opts.tol: arrival tolerance.
 */
export function intent(rt, e, api, fr, opts = {}) {
  const cache = frameCache(rt).intent, key = `${e.id}|${opts.free3d ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);
  const out = { dir: [0, 0, 0], vert: 0, stick: [0, 0], run: false, jump: false, jumpHeld: false, ctl: null, source: null, speed: null };
  const npc = e.id !== 'player';
  if (e.components.moveTo && (!npc || e.components.move)) {
    Object.assign(out, follow(rt, e, api, fr, opts));
  } else if (npc && e.components.steer && e.components.move && !e.components.input) {
    const s = e.components.steer, d = v3(s.dir);
    const free = opts.free3d || s.fly;
    out.dir = free ? d : project(fr, d); out.source = 'steer'; out.speed = s.speed ?? null; out.run = Boolean(s.run);
    if (free && fr.vert !== null) out.vert = d[fr.vert];
    out.jump = out.jumpHeld = Boolean(s.jump);
    if (s.face) out.face = v3(s.face);
  } else {
    const ctl = controls(rt, e);
    if (ctl) {
      out.ctl = ctl; out.source = npc ? 'input' : 'player'; out.stick = ctl.move;
      const yaw = yawOf(e, ctl);
      out.dir = planeVector(fr, ctl.move[0], ctl.move[1], yaw);
      out.vert = (ctl.down('ascend') || ctl.down('jump') && opts.jumpIsUp ? 1 : 0) - (ctl.down('descend') || ctl.down('crouch') && opts.crouchIsDown ? 1 : 0);
      if (sideView(fr) || opts.stickIsVert) out.vert = out.vert || ctl.move[1];
      out.run = ctl.down('run') || ctl.down('sprint');
      out.jump = ctl.pressed('jump'); out.jumpHeld = ctl.down('jump');
    }
  }
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- moveTo following

/** A representative point for a zone in its space (rect, bounds, center/r, polygon, at). */
export function zoneAnchor(rt, e, zoneId) {
  const space = rt.doc.spaces.find(s => s.id === e.space), z = space?.zones?.find(x => x.id === zoneId);
  if (!z) return null;
  const dims = dimsOf(e);
  if (!dims) return zoneId;
  const fill = p => { const out = e.at.slice(); p.forEach((v, i) => { if (v != null && i < dims) out[i] = v; }); return out; };
  if (Array.isArray(z.at)) return fill(z.at);
  const api = spaceApi(rt, e);
  if (Array.isArray(z.rect)) {
    const [x0, y0, x1, y1] = z.rect, c = [(x0 + x1) / 2, (y0 + y1) / 2];
    // Prefer a free cell inside the rect, nearest its centre.
    let best = fill([Math.floor(c[0]), Math.floor(c[1])]);
    if (typeof api?.getCell === 'function') {
      let bd = Infinity;
      for (let x = Math.floor(x0); x < x1 && x < x0 + 64; x++) for (let y = Math.floor(y0); y < y1 && y < y0 + 64; y++) {
        const p = fill([x, y]); if (isSolidBlock(rt, api.getCell(p))) continue;
        const d = (x + 0.5 - c[0]) ** 2 + (y + 0.5 - c[1]) ** 2; if (d < bd) { bd = d; best = p; }
      }
    }
    return best;
  }
  if (z.bounds?.min && z.bounds?.max) return fill(z.bounds.min.map((v, i) => (v + z.bounds.max[i]) / 2));
  if (z.bounds?.center || z.center) { const c = z.bounds?.center || z.center; return dims === 3 ? fill([c[0], null, c[1]]) : fill(c); }
  if (Array.isArray(z.polygon) && z.polygon.length) { const n = z.polygon.length, cx = z.polygon.reduce((s, p) => s + p[0], 0) / n, cz = z.polygon.reduce((s, p) => s + p[1], 0) / n; return dims === 3 ? fill([cx, null, cz]) : fill([cx, cz]); }
  return null;
}

function planeDist(fr, a, b) { if (!fr.plane.length) return a === b ? 0 : Infinity; return Math.hypot(...fr.plane.map(i => (a[i] ?? 0) - (b[i] ?? 0))); }

function follow(rt, e, api, fr, opts) {
  const mt = e.components.moveTo, m = mv(e), out = { dir: [0, 0, 0], vert: 0, run: Boolean(mt.run), source: 'moveTo', speed: mt.speed ?? null, jump: false, jumpHeld: false };
  const key = JSON.stringify([mt.zone ?? null, mt.at ?? null]);
  if (!m.path || m.path.key !== key) m.path = { key, pts: null, i: 0, best: null, stuck: 0, tries: 0 };
  const P = m.path, tol = opts.tol ?? 0.35;
  // AI intents (by:'ai') are rewritten every frame: their behaviour owns arrival and clearing, so stay quiet.
  if (mt.by === 'ai' && P.quiet === key) return out;
  const done = ok => {
    if (mt.by === 'ai') { if (ok !== true) P.quiet = key; return out; }
    delete e.components.moveTo; m.path = null; if (ok === true) rt.emitTyped('arrived', mt.zone ?? null, { who: e.id, zone: mt.zone ?? null }); else rt.emit('move_failed', { who: e.id, zone: mt.zone ?? null, reason: ok === false ? 'no_path' : ok }); return out; };
  if (mt.zone && api?.inZone?.(e, mt.zone, rt) && !mt.at) return done(true);
  const target = mt.at ?? zoneAnchor(rt, e, mt.zone);
  if (target == null) return done('no_target');
  const dist = opts.free3d ? len(sub(v3(e.at), v3(target))) : planeDist(fr, e.at, target);
  if (dimsOf(e) && dist <= tol) return done(true);
  if (!P.pts) {
    const p = typeof api?.path === 'function' ? api.path(e.at, target, { abilities: opts.envelope }) : [target];
    if (!p || !p.length) return done(false);
    P.pts = structuredClone(p); P.i = 0;
  }
  const near = wp => (opts.free3d ? len(sub(v3(e.at), v3(wp))) : planeDist(fr, e.at, wp)) <= tol;
  while (P.i < P.pts.length - 1 && near(P.pts[P.i])) P.i++;
  const wp = P.pts[P.i];
  if (P.best === null || dist < P.best - 0.02) { P.best = dist; P.stuck = 0; } else P.stuck += rt.dt;
  if (P.stuck > (opts.stuckSec ?? 2)) { P.pts = null; P.tries++; P.stuck = 0; P.best = null; if (P.tries > 3) return done('stuck'); }
  const raw = sub(v3(wp), v3(e.at));
  out.dir = norm(opts.free3d ? raw : project(fr, raw));
  if (fr.vert !== null) {
    out.vert = clamp(raw[fr.vert], -1, 1);
    if (!opts.free3d && raw[fr.vert] > (opts.jumpRise ?? 0.6)) out.jump = out.jumpHeld = true;
  }
  if (out.speed == null && mt.speed != null) out.speed = mt.speed;
  return out;
}

/** Discrete next step toward moveTo on navigate spaces (grid cells, graph zones). Returns the neighbour or null. */
export function discreteNext(rt, e, api) {
  const mt = e.components.moveTo, m = mv(e);
  const goal = mt.at ?? (dimsOf(e) ? zoneAnchor(rt, e, mt.zone) : mt.zone);
  const key = JSON.stringify(goal);
  const arrived = () => (mt.zone && api.inZone?.(e, mt.zone, rt)) || (mt.at != null && JSON.stringify(e.at) === JSON.stringify(mt.at)) || (!dimsOf(e) && e.at === goal);
  const quiet = mt.by === 'ai';
  if (arrived()) { if (!quiet) { delete e.components.moveTo; m.path = null; rt.emitTyped('arrived', mt.zone ?? null, { who: e.id, zone: mt.zone ?? null }); } return null; }
  if (!m.path || m.path.key !== key || !m.path.pts) {
    let pts = null;
    const inGoal = goal == null && mt.zone ? c => Boolean(api.inZone?.({ ...e, at: c }, mt.zone, rt)) : null;
    if (typeof api.path === 'function' && dimsOf(e) && goal != null) pts = api.path(e.at, goal);
    else if (typeof api.neighbors === 'function' && (goal != null || inGoal)) pts = bfs(rt, e, api, goal, inGoal);
    if (!pts || pts.length < 2) { if (quiet) return null; delete e.components.moveTo; m.path = null; rt.emit('move_failed', { who: e.id, zone: mt.zone ?? null, reason: 'no_path' }); return null; }
    m.path = { key, pts: structuredClone(pts), i: 1 };
  }
  const P = m.path;
  while (P.i < P.pts.length && JSON.stringify(P.pts[P.i]) === JSON.stringify(e.at)) P.i++;
  return P.pts[P.i] ?? null;
}
function bfs(rt, e, api, goal, test = null) {
  const k = x => JSON.stringify(x), start = e.at, prev = new Map([[k(start), null]]), q = [start];
  let n = 0;
  while (q.length && n++ < 4096) {
    const c = q.shift();
    if (test ? test(c) : k(c) === k(goal)) { const out = []; for (let x = c; x != null; x = prev.get(k(x))) out.unshift(x); return out; }
    for (const nb of api.neighbors(c) || []) if (!prev.has(k(nb)) && (typeof api.canMove !== 'function' || api.canMove({ ...e, at: c }, nb, rt))) { prev.set(k(nb), c); q.push(nb); }
  }
  return null;
}

// ---------------------------------------------------------------- mode arbitration

/** Claim the entity for `mode` this frame (call in the 'input' phase). Highest priority wins. */
export function claim(rt, e, mode, pri, owner) {
  const m = mv(e), f = rt.state.frame;
  if (!m.req || m.req.f !== f || pri > m.req.pri) m.req = { f, mode, pri, owner };
}
/** Resolve (once per frame, in 'movement') and return the mode that owns e now. */
export function modeOf(rt, e) {
  const m = mv(e), f = rt.state.frame;
  if (m.at !== f) {
    const r = m.req?.f === f ? m.req : null, next = r?.mode ?? null;
    if (next !== (m.mode ?? null)) { m.last = m.mode ?? null; m.mode = next; m.since = rt.state.time; rt.emit('move_mode', { who: e.id, from: m.last, to: next }); }
    m.owner = r?.owner ?? null; m.at = f;
  }
  return m.mode;
}
export const ownedBy = (rt, e, owner) => (modeOf(rt, e), mv(e).owner === owner);

// ---------------------------------------------------------------- controllers and entity selection

function registryOf(rt) { return (rt.caches.moveBases ??= []); }
/** Register a base locomotion controller (walk, platformer, ship, lanes, grid, fly-always). */
export function registerBase(rt, owner, mode, instance) { registryOf(rt).push({ owner, mode, space: instance.space ?? null }); }
/** Is `owner` the base controller for e? components.move.base picks explicitly; else the first registered for the space. */
export function isBaseFor(rt, e, owner, id, mode) {
  const m = e.components.move;
  if (m?.base) return m.base === owner || m.base === id || m.base === mode;
  const first = registryOf(rt).find(c => !c.space || c.space === e.space);
  return first?.owner === owner;
}
/** Entities a move primitive may drive: the player (unless player:false) and NPCs carrying components.move. */
export function driven(rt, config, instance) {
  const out = [];
  const p = rt.player();
  if (p && config.player !== false && p.space && (!instance.space || p.space === instance.space)) out.push(p);
  if (config.npcs !== false) for (const e of Object.values(rt.state.entities)) if (e.id !== 'player' && e.components.move && e.space && (!instance.space || e.space === instance.space)) out.push(e);
  return out;
}
export function ownerKey(instance) { return `${instance.use}#${instance.key}`; }

// ---------------------------------------------------------------- abilities

function grantsIndex(rt) {
  const c = rt.caches;
  if (c.moveGrantsDoc !== rt.doc) {
    c.moveGrantsDoc = rt.doc; const idx = new Map();
    for (const s of rt.doc.systems || []) if (s.use === 'gameplay.progression.abilities') for (const a of s.with?.abilities || []) for (const g of [a.id, ...(a.grants || [])]) { if (!idx.has(g)) idx.set(g, []); idx.get(g).push(a.id); }
    c.moveGrants = idx;
  }
  return c.moveGrants;
}
/**
 * Does e have movement ability `name` (doubleJump, dash, wallSlide, glide...)?
 * Sources, any of which grants it:
 * 1. components.move.abilities[name] (per entity; false explicitly denies);
 * 2. flag `ability.<name>` (move workstream's own store; set with set_flag);
 * 3. gameplay.progression.abilities: an ability whose id is `name` or whose
 *    `grants` list contains `name`, tested through the `ability` predicate when
 *    that predicate is registered, else the ability ids in doc.player.abilities.
 */
export function hasAbility(rt, e, name) {
  const own = e.components.move?.abilities?.[name];
  if (own === false) return false;
  if (own) return true;
  if (rt.state.flags[`ability.${name}`]) return true;
  const ids = grantsIndex(rt).get(name) || [];
  const all = ids.includes(name) ? ids : [name, ...ids];
  if (rt.logic.predicates.has('ability')) {
    for (const id of all) { try { if (rt.test({ ability: id, ...(e.id === 'player' ? {} : { who: e.id }) })) return true; } catch { /* malformed predicate in another workstream */ } }
    return false;
  }
  if (e.id === 'player') { const start = rt.doc.player?.abilities || []; return all.some(id => start.includes(id)); }
  return false;
}

// ---------------------------------------------------------------- resources (stamina, fuel, breath)

/**
 * A spendable pool for e. For the player, gameplay.resource vars `res.<id>` (and
 * `res.<id>.max`, `res.<id>.locked` while exhaust-locked) are used when present;
 * spending goes through the `spend` effect when registered. Otherwise, and for
 * NPCs, an internal pool in components.move.pools[id] regenerates at `regen`/s.
 * Returns null when id is empty/'none'.
 */
export function pool(rt, e, id, { max = 100, regen = 0 } = {}) {
  if (!id || id === 'none') return null;
  const v = rt.state.vars, key = `res.${id}`;
  if (e.id === 'player' && v[key] !== undefined) {
    return {
      external: true, get value() { return v[key]; }, get max() { return v[`${key}.max`] ?? max; },
      get locked() { return Boolean(v[`${key}.locked`]); },
      spend(a) { if (a <= 0) return true; if (rt.logic.effects.has('spend')) rt.run([{ do: 'spend', resource: id, amount: a }]); else v[key] = Math.max(0, v[key] - a); return true; },
      regen() {},
    };
  }
  const m = mv(e); m.pools ??= {};
  const P = (m.pools[id] ??= { value: max, max, lock: false });
  return {
    external: false, get value() { return P.value; }, get max() { return P.max; }, get locked() { return P.lock; },
    spend(a) { P.value = Math.max(0, round6(P.value - a)); if (P.value < 1e-3) P.value = 0; if (P.value <= 0 && !P.lock) { P.lock = true; rt.emitTyped('depleted', id, { who: e.id, resource: id }); } return true; },
    regen(dt) { if (regen > 0 && P.value < P.max) { P.value = Math.min(P.max, round6(P.value + regen * dt)); if (P.lock && P.value >= P.max * 0.3) P.lock = false; } },
    refill() { P.value = P.max; P.lock = false; },
  };
}
export const canSpend = (p, amount) => !p || (!p.locked && p.value >= Math.max(amount, 1e-9));

// ---------------------------------------------------------------- effects that may not be registered

/** Apply damage through combat.health's `damage` effect when present; otherwise emit only. */
export function hurt(rt, e, amount, type, reason) {
  if (rt.logic.effects.has('damage')) rt.run([{ do: 'damage', who: e.id, amount, type }], { self: e.id });
  rt.emit('move_hurt', { who: e.id, amount, type, reason });
}

// ---------------------------------------------------------------- body bookkeeping

export function setFacing(e, fr, dirVec) {
  const b = bodyOf(e), d = v3(dirVec);
  if (len(d) < 1e-6) return;
  const u = norm(d);
  b.dir = u.slice(0, Math.max(2, fr.dims)).map(round6);
  b.facing = round6(fr.dims === 3 ? Math.atan2(u[0], u[2]) : Math.atan2(u[1], u[0]));
}
export function settle(e, fr) { const b = bodyOf(e); b.vel = b.vel.map(round6); b.controller = 'move'; }

/** Emit `landed` when the body touches down; tracks fall height in components.move.air. */
export function trackAir(rt, e, fr, wasGrounded, grounded, vBefore) {
  const m = mv(e), v = fr.vert;
  if (v === null) return;
  if (!grounded) { m.air ??= { top: e.at[v], t: 0 }; m.air.top = Math.max(m.air.top, e.at[v]); m.air.t += rt.dt; }
  else if (!wasGrounded || m.air) {
    const h = m.air ? round6(m.air.top - e.at[v]) : 0;
    if (!wasGrounded) rt.emit('landed', { who: e.id, speed: round6(Math.abs(vBefore)), height: Math.max(0, h) });
    m.air = null;
  }
}

// ---------------------------------------------------------------- verbs, edges, macro travel

/** Declare verbs to the kernel (no-op handlers; systems read rt.input). Never overrides another primitive's verb. */
export function verbs(rt, names) { const have = new Set(rt.actions()); for (const n of names) if (!have.has(n)) rt.action(n, () => {}); }

/**
 * Shared, once-per-runtime setup:
 * - a 'late' system that records which verbs were down (edge detection);
 * - the `travel` action and macro options: "travel to <zone>" sets the
 *   player's moveTo, and the real controller walks/flies/swims there through
 *   real steps. Each option carries `steps` (the solver repeats the action for
 *   that many frames) and `apply(rt)`, which steps until arrival and returns
 *   {ok, frames, mode}. When stepping fails and validated teleport is
 *   allowed, it falls back to teleporting along the space's path, checking
 *   each waypoint is free.
 */
export function ensureShared(rt, macro = {}) {
  if (rt.caches.moveShared) { if (macro.speed) rt.caches.moveShared.speed = Math.max(rt.caches.moveShared.speed, macro.speed); return; }
  const S = rt.caches.moveShared = { speed: macro.speed || 3, seconds: macro.seconds ?? 60, teleport: macro.teleport ?? true, max: macro.max ?? 16 };
  rt.system('late', rt => {
    for (const e of Object.values(rt.state.entities)) {
      const src = source(rt, e); if (!src) continue;
      const a = src.actions || {}, h = src.held || {};
      const down = [...new Set([...Object.keys(a).filter(k => a[k] && typeof a[k] !== 'object'), ...Object.keys(h).filter(k => h[k])])].sort();
      if (down.length || e.components.move?.held?.length) mv(e).held = down;
    }
  }, 'gameplay.move');
  if (!new Set(rt.actions()).has('travel')) rt.action('travel', (zone, rt) => {
    const p = rt.player(); if (!p || typeof zone !== 'string') return;
    if (p.components.moveTo?.zone !== zone) p.components.moveTo = { zone, at: null, run: true };
  });
  rt.options(rt => {
    const p = rt.player(); if (!p?.space || S.max <= 0) return [];
    const api = spaceApi(rt, p); if (!api) return [];
    const zones = rt.doc.spaces.find(s => s.id === p.space)?.zones || [];
    const here = zones.filter(z => api.inZone?.(p, z.id, rt)).map(z => z.id);
    const out = [];
    for (const z of zones) {
      if (here.includes(z.id)) continue;
      const to = zoneAnchor(rt, p, z.id); if (to == null) continue;
      let pathLen = null;
      if (dimsOf(p) && typeof api.path === 'function') { const path = api.path(p.at, to, {}); if (!path) continue; pathLen = path.length; }
      else if (dimsOf(p)) pathLen = len(sub(v3(to), v3(p.at)));
      else pathLen = 1;
      const steps = Math.min(Math.round(S.seconds / rt.dt), Math.max(30, Math.ceil(((pathLen + 2) / S.speed) * 1.6 / rt.dt)));
      out.push({ label: `travel to ${z.id}`, actions: { travel: z.id }, steps, macro: true, apply: rt => travel(rt, z.id, steps, S) });
      if (out.length >= S.max) break;
    }
    return out;
  });
}

function travel(rt, zone, steps, S) {
  const p = rt.player(); if (!p) return { ok: false, frames: 0, mode: 'none' };
  p.components.moveTo = { zone, at: null, run: true };
  let frames = 0;
  while (frames < steps && rt.state.status === 'playing' && p.components.moveTo) { rt.step({}); frames++; }
  const api = spaceApi(rt, p);
  if (api?.inZone?.(p, zone, rt)) return { ok: true, frames, mode: 'steps' };
  delete p.components.moveTo;
  if (!S.teleport || !dimsOf(p) || typeof api?.path !== 'function') return { ok: false, frames, mode: 'steps' };
  const to = zoneAnchor(rt, p, zone), path = api.path(p.at, to, {});
  if (!path) return { ok: false, frames, mode: 'path' };
  for (const wp of path) { if (canProbe(api) && boxHits(rt, api, p, wp)) return { ok: false, frames, mode: 'path' }; api.setPos(p, wp, rt); }
  rt.emit('travelled', { who: p.id, zone, mode: 'path' });
  return { ok: Boolean(api.inZone?.(p, zone, rt)), frames, mode: 'path' };
}

// ---------------------------------------------------------------- presets

/** Merge preset values under explicit params: params without a default stay undefined unless set. */
export function withPreset(config, presets, base) {
  const out = { ...base };
  const layer = src => { for (const [k, v] of Object.entries(src || {})) if (v !== undefined) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) ? { ...out[k], ...v } : v; };
  layer(presets[config.preset]); layer(config);
  return out;
}

/** Common params every movement primitive accepts. */
export const COMMON_PARAMS = {
  player: { type: 'boolean', default: true, effect: 'drive the player from input' },
  npcs: { type: 'boolean', default: true, effect: 'drive NPCs that carry components.move (input, steer or moveTo intents)' },
  plane: { type: 'string', options: ['auto', 'x', 'xy', 'xz'], default: 'auto', effect: 'ground plane axes; auto derives it from gravity and the space size' },
};
export const MACRO_PARAMS = {
  macro: { type: 'object', default: {}, effect: 'solver macro options: travel to zones', fields: {
    max: { type: 'integer', min: 0, max: 64, default: 16, effect: 'travel options offered at once (0 disables)' },
    seconds: { type: 'number', min: 1, max: 600, default: 60, unit: 's', effect: 'step budget per travel' },
    teleport: { type: 'boolean', default: true, effect: 'fall back to validated teleport along space.path when stepping fails' },
  } },
};

// ---------------------------------------------------------------- overlay modes (climb, swim, glide, dodge, grapple, fly)

/**
 * Install a movement mode that takes an entity over from its base controller
 * while `wants` holds. wants(e, api, fr, s, active) runs in 'input' and may
 * set s.endReason; step(e, api, fr, s) runs in 'movement' while the mode owns
 * the entity; start/end are called on transitions. Per-entity state is
 * components.move[mode].
 */
export function installOverlay(rt, config, instance, { id, mode, pri, wants, step, start, end }) {
  const owner = ownerKey(instance);
  rt.system('input', rt => {
    for (const e of driven(rt, config, instance)) {
      const api = spaceApi(rt, e); if (!api || !dimsOf(e)) continue;
      const s = state(e, mode), fr = frameOf(api, e, config.plane);
      if (wants(e, api, fr, s, Boolean(s.on))) claim(rt, e, mode, pri, owner);
    }
  }, id);
  rt.system('movement', rt => {
    for (const e of driven(rt, config, instance)) {
      const s = e.components.move?.[mode];
      const mine = ownedBy(rt, e, owner);
      if (!mine) { if (s?.on) { s.on = false; end?.(e, spaceApi(rt, e), s, s.endReason || 'interrupted'); s.endReason = null; } continue; }
      const api = spaceApi(rt, e), fr = frameOf(api, e, config.plane);
      if (!s.on) { s.on = true; s.t = 0; start?.(e, api, fr, s); }
      s.t = round6((s.t || 0) + rt.dt);
      step(e, api, fr, s);
      settle(e, fr);
    }
  }, id);
}

/** Integrate a body's velocity through the motor, zero blocked axes, update grounded/landed. */
export function integrate(rt, e, api, fr, opts = {}) {
  const b = bodyOf(e), was = Boolean(b.grounded), vUp = fr.up === null ? 0 : b.vel[fr.up] * fr.upSign;
  const r = motor(rt, e, api, b.vel.map(v => v * rt.dt), opts);
  r.blocked.forEach((bl, i) => { if (bl) b.vel[i] = 0; });
  b.grounded = fr.up === null ? false : r.grounded;
  if (fr.up !== null) trackAir(rt, e, fr, was, b.grounded, vUp);
  return r;
}

/** Accelerate plane velocity toward want (vector) by at most `rate` this frame. */
export function steerPlane(b, fr, want, rate) {
  const dv = fr.plane.map(i => (want[i] ?? 0) - b.vel[i]), dl = Math.hypot(...dv);
  fr.plane.forEach((i, k) => { b.vel[i] += dl <= rate ? dv[k] : (dv[k] / dl) * rate; });
}

/** Horizontal directions to test for walls: the input direction's dominant axis, then facing. */
export function wallProbeDirs(e, fr, dir) {
  const out = [], d = v3(dir);
  const ax = fr.plane.slice().sort((a, b) => Math.abs(d[b]) - Math.abs(d[a]))[0];
  if (ax !== undefined && Math.abs(d[ax]) > 0.2) out.push([ax, Math.sign(d[ax])]);
  const f = e.components.body?.dir;
  if (f) for (const a of fr.plane) if (Math.abs(f[a] ?? 0) > 0.5 && !out.some(o => o[0] === a && o[1] === Math.sign(f[a]))) out.push([a, Math.sign(f[a])]);
  return out;
}
