// A small deterministic 2D rigid-body engine for the physics-toy kit.
//
// Shapes: circles, convex polygons (boxes, triangles, flippers) and capsule
// segments (static walls, rails and arcs built from segment chains). Impulse
// solver with warm starting, restitution, Coulomb friction and rotation;
// distance/rope and revolute (motor + limits) joints; simple sleeping; swept
// collision for `bullet` circles so fast balls never tunnel through walls.
//
// The world is plain JSON (bodies refer to each other by id), so a game state
// that holds it can be cloned with structuredClone. Iteration order is the
// insertion order of bodies; there is no randomness. Coordinates are y-down.

const SLOP = 0.004;          // allowed penetration
const BAUMGARTE = 0.15;      // position-error feedback per substep
const MARGIN = 0.02;         // speculative contact distance
const BOUNCE_MIN = 0.5;      // approach speed below which contacts don't bounce
const SLEEP_V2 = 0.0064, SLEEP_W2 = 0.0064, SLEEP_TIME = 0.5;
const cross = (ax, ay, bx, by) => ax * by - ay * bx;

export function createWorld(o = {}) {
  return {
    gx: o.gx ?? 0, gy: o.gy ?? 10, substeps: o.substeps ?? 4, iterations: o.iterations ?? 6,
    cell: o.cell ?? 2, sleep: o.sleep ?? true, nextId: 1, rev: 0, time: 0,
    bodies: [], joints: [], warm: {}, touching: {}, contacts: [],
  };
}

// ---------- bodies ----------
function polygonMass(verts, density) {
  let area = 0, cx = 0, cy = 0, inertia = 0;
  for (let i = 0; i < verts.length; i++) {
    const [x1, y1] = verts[i], [x2, y2] = verts[(i + 1) % verts.length];
    const c = cross(x1, y1, x2, y2), a = c / 2;
    area += a; cx += a * (x1 + x2) / 3; cy += a * (y1 + y2) / 3;
    inertia += c * (x1 * x1 + x1 * x2 + x2 * x2 + y1 * y1 + y1 * y2 + y2 * y2) / 12;
  }
  return { area, cx: cx / area, cy: cy / area, inertia: inertia * density };
}

function normalsOf(verts) {
  return verts.map((v, i) => {
    const w = verts[(i + 1) % verts.length], ex = w[0] - v[0], ey = w[1] - v[1], l = Math.hypot(ex, ey) || 1;
    return [ey / l, -ex / l];
  });
}

/**
 * Add a body. def: { shape: 'circle'|'box'|'poly'|'seg', type: 'dynamic'|'static'|'kinematic',
 * x, y, a, vx, vy, av, r, w, h, verts, x1,y1,x2,y2 (seg, world coords), density, e, mu,
 * cat, mask, sensor, bullet, gs (gravity scale), damp, adamp, fixedRotation, tag, data }.
 */
export function addBody(world, d) {
  const b = {
    id: world.nextId++, shape: d.shape === 'box' ? 'poly' : d.shape, type: d.type || 'dynamic',
    x: d.x || 0, y: d.y || 0, a: d.a || 0, vx: d.vx || 0, vy: d.vy || 0, av: d.av || 0,
    r: d.r || 0, e: d.e ?? 0.2, mu: d.mu ?? 0.5, cat: d.cat ?? 1, mask: d.mask ?? 0xffff,
    sensor: !!d.sensor, bullet: !!d.bullet, gs: d.gs ?? 1, damp: d.damp || 0, adamp: d.adamp ?? 0.05,
    invM: 0, invI: 0, m: 0, bound: 0, sleeping: false, idle: 0, dead: false, tag: d.tag || '', data: d.data || {},
  };
  const density = d.density ?? 1;
  let area = 0, inertia = 0;
  if (b.shape === 'circle') {
    area = Math.PI * b.r * b.r; inertia = density * area * b.r * b.r / 2; b.bound = b.r;
  } else if (b.shape === 'poly') {
    let verts = d.verts || [[-d.w / 2, -d.h / 2], [d.w / 2, -d.h / 2], [d.w / 2, d.h / 2], [-d.w / 2, d.h / 2]];
    let pm = polygonMass(verts, density);
    if (pm.area < 0) { verts = [...verts].reverse(); pm = polygonMass(verts, density); }
    // Re-center on the centroid so rotation is about the center of mass.
    const c = Math.cos(b.a), s = Math.sin(b.a);
    b.x += c * pm.cx - s * pm.cy; b.y += s * pm.cx + c * pm.cy;
    b.verts = verts.map(([x, y]) => [x - pm.cx, y - pm.cy]);
    b.norms = normalsOf(b.verts);
    area = pm.area;
    inertia = pm.inertia - density * area * (pm.cx * pm.cx + pm.cy * pm.cy);
    b.bound = Math.max(...b.verts.map(([x, y]) => Math.hypot(x, y)));
  } else if (b.shape === 'seg') {
    b.x = (d.x1 + d.x2) / 2; b.y = (d.y1 + d.y2) / 2; b.a = 0;
    b.verts = [[d.x1 - b.x, d.y1 - b.y], [d.x2 - b.x, d.y2 - b.y]];
    const ex = d.x2 - d.x1, ey = d.y2 - d.y1, l = Math.hypot(ex, ey) || 1;
    b.norms = [[ey / l, -ex / l], [-ey / l, ex / l]];
    b.bound = l / 2 + b.r;
    if (b.type === 'dynamic') b.type = 'static';
  }
  if (b.type === 'dynamic') {
    b.m = density * area; b.invM = b.m > 0 ? 1 / b.m : 0;
    b.invI = d.fixedRotation || inertia <= 0 ? 0 : 1 / inertia;
  }
  world.bodies.push(b);
  if (b.type === 'static') world.rev++;
  return b;
}

/** A chain of static capsule segments along a circular arc (angles in radians). */
export function addArc(world, cx, cy, radius, a0, a1, n, o = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n;
    out.push(addBody(world, { ...o, shape: 'seg', type: 'static', x1: cx + Math.cos(t0) * radius, y1: cy + Math.sin(t0) * radius, x2: cx + Math.cos(t1) * radius, y2: cy + Math.sin(t1) * radius }));
  }
  return out;
}

/** A chain of static segments through points. */
export function addChain(world, points, o = {}) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) out.push(addBody(world, { ...o, shape: 'seg', type: 'static', x1: points[i][0], y1: points[i][1], x2: points[i + 1][0], y2: points[i + 1][1] }));
  return out;
}

export function removeBody(world, b) {
  if (!b || b.dead) return;
  b.dead = true;
  if (b.type === 'static') world.rev++;
  // Wake whatever was resting on it.
  const box = aabbOf(b);
  for (const o of world.bodies) if (o.sleeping && overlaps(box, aabbOf(o), 0.25)) wake(o);
}

export function wake(b) { if (b.sleeping) { b.sleeping = false; b.idle = 0; } }
export function bodyIndex(world) { const m = new Map(); for (const b of world.bodies) m.set(b.id, b); return m; }
export function findBody(world, id) { for (const b of world.bodies) if (b.id === id) return b; return null; }

/** Apply an impulse at a world point (center when omitted). */
export function applyImpulse(b, px, py, x = b.x, y = b.y) {
  if (b.type !== 'dynamic') return;
  wake(b);
  b.vx += px * b.invM; b.vy += py * b.invM;
  b.av += cross(x - b.x, y - b.y, px, py) * b.invI;
}

// ---------- joints ----------
/** Distance joint (rope: max length only). a may be 0 for a world anchor (la is then a world point). */
export function addDistanceJoint(world, { a = 0, b, la = [0, 0], lb = [0, 0], length, rope = false, tag = '' }) {
  const j = { id: world.nextId++, type: 'distance', a, b, la, lb, length, rope, tag, ji: 0 };
  world.joints.push(j); return j;
}
/** Revolute joint at a world pivot, with optional motor and angle limits (relative to the current angle). */
export function addRevoluteJoint(world, { a = 0, b, x, y, motor = false, speed = 0, maxTorque = 0, limit = false, lower = 0, upper = 0, tag = '' }) {
  const bodies = bodyIndex(world), A = a ? bodies.get(a) : null, B = bodies.get(b);
  const local = (body, px, py) => { if (!body) return [px, py]; const c = Math.cos(body.a), s = Math.sin(body.a), dx = px - body.x, dy = py - body.y; return [c * dx + s * dy, -s * dx + c * dy]; };
  const j = { id: world.nextId++, type: 'revolute', a, b, la: local(A, x, y), lb: local(B, x, y), ref: B.a - (A ? A.a : 0), motor, speed, maxTorque, limit, lower, upper, tag, jx: 0, jy: 0, jm: 0, jl: 0 };
  world.joints.push(j); return j;
}

// ---------- geometry ----------
function proxyOf(b) {
  const c = Math.cos(b.a), s = Math.sin(b.a);
  const p = { b, cx: b.x, cy: b.y, v: null, n: null, box: null };
  if (b.verts) {
    p.v = b.verts.map(([x, y]) => [b.x + c * x - s * y, b.y + s * x + c * y]);
    p.n = b.norms.map(([x, y]) => [c * x - s * y, s * x + c * y]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p.v) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    p.box = [x0 - b.r, y0 - b.r, x1 + b.r, y1 + b.r];
  } else p.box = [b.x - b.r, b.y - b.r, b.x + b.r, b.y + b.r];
  return p;
}
export function aabbOf(b) { return proxyOf(b).box; }
const overlaps = (a, b, m = 0) => a[0] - m <= b[2] && b[0] - m <= a[2] && a[1] - m <= b[3] && b[1] - m <= a[3];

/** World-space vertices of a polygon or segment body. */
export function worldVerts(b) { return proxyOf(b).v; }

function circleCircle(A, B) {
  const dx = B.cx - A.cx, dy = B.cy - A.cy, d = Math.hypot(dx, dy), rr = A.b.r + B.b.r;
  if (d - rr > MARGIN) return null;
  const nx = d > 1e-9 ? dx / d : 0, ny = d > 1e-9 ? dy / d : 1, sep = d - rr;
  return { nx, ny, pts: [{ x: A.cx + nx * (A.b.r + sep / 2), y: A.cy + ny * (A.b.r + sep / 2), sep, key: 0 }] };
}

function polyCircle(P, C) {
  const r = C.b.r + P.b.r, v = P.v, n = P.n;
  let best = -Infinity, face = 0;
  for (let i = 0; i < v.length; i++) {
    const s = n[i][0] * (C.cx - v[i][0]) + n[i][1] * (C.cy - v[i][1]);
    if (s > r + MARGIN) return null;
    if (s > best) { best = s; face = i; }
  }
  const v1 = v[face], v2 = v[(face + 1) % v.length];
  let nx = n[face][0], ny = n[face][1], sep = best - r, key = face;
  if (best > 1e-9) {
    const u1 = (C.cx - v1[0]) * (v2[0] - v1[0]) + (C.cy - v1[1]) * (v2[1] - v1[1]);
    const u2 = (C.cx - v2[0]) * (v1[0] - v2[0]) + (C.cy - v2[1]) * (v1[1] - v2[1]);
    const corner = u1 <= 0 ? v1 : u2 <= 0 ? v2 : null;
    if (corner) {
      const dx = C.cx - corner[0], dy = C.cy - corner[1], d = Math.hypot(dx, dy);
      if (d - r > MARGIN) return null;
      nx = dx / (d || 1); ny = dy / (d || 1); sep = d - r; key = 16 + (u1 <= 0 ? face : (face + 1) % v.length);
    }
  }
  return { nx, ny, pts: [{ x: C.cx - nx * (C.b.r + sep / 2), y: C.cy - ny * (C.b.r + sep / 2), sep, key }] };
}

function segCircle(S, C) {
  const [a, b] = S.v, ex = b[0] - a[0], ey = b[1] - a[1], ll = ex * ex + ey * ey;
  const t = ll > 0 ? Math.max(0, Math.min(1, ((C.cx - a[0]) * ex + (C.cy - a[1]) * ey) / ll)) : 0;
  const qx = a[0] + ex * t, qy = a[1] + ey * t, dx = C.cx - qx, dy = C.cy - qy, d = Math.hypot(dx, dy), rr = S.b.r + C.b.r;
  if (d - rr > MARGIN) return null;
  let nx, ny;
  if (d > 1e-9) { nx = dx / d; ny = dy / d; } else { nx = S.n[0][0]; ny = S.n[0][1]; }
  const sep = d - rr;
  return { nx, ny, pts: [{ x: C.cx - nx * (C.b.r + sep / 2), y: C.cy - ny * (C.b.r + sep / 2), sep, key: t <= 0 ? 1 : t >= 1 ? 2 : 0 }] };
}

function maxSeparation(A, B) {
  let best = -Infinity, edge = 0;
  for (let i = 0; i < A.v.length; i++) {
    const [nx, ny] = A.n[i], [vx, vy] = A.v[i];
    let min = Infinity;
    for (const [wx, wy] of B.v) { const s = nx * (wx - vx) + ny * (wy - vy); if (s < min) min = s; }
    if (min > best) { best = min; edge = i; }
  }
  return [best, edge];
}

function polyPoly(A, B) {
  const rr = A.b.r + B.b.r;
  const [sa, ea] = maxSeparation(A, B);
  if (sa - rr > MARGIN) return null;
  const [sb, eb] = maxSeparation(B, A);
  if (sb - rr > MARGIN) return null;
  const flip = sb > 0.98 * sa + 0.002; // hysteresis keeps the reference face (and warm-start keys) stable
  const ref = flip ? B : A, inc = flip ? A : B, edge = flip ? eb : ea;
  const v1 = ref.v[edge], v2 = ref.v[(edge + 1) % ref.v.length], [nx, ny] = ref.n[edge];
  // Incident edge: the face of inc most anti-parallel to the reference normal.
  let ie = 0, md = Infinity;
  for (let i = 0; i < inc.n.length; i++) { const d = nx * inc.n[i][0] + ny * inc.n[i][1]; if (d < md) { md = d; ie = i; } }
  const i2 = (ie + 1) % inc.v.length;
  let pts = [[inc.v[ie][0], inc.v[ie][1], ie], [inc.v[i2][0], inc.v[i2][1], i2]];
  const tx = v2[0] - v1[0], ty = v2[1] - v1[1], tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl;
  const clip = (list, ox, oy, off) => {
    const out = [], d0 = ox * list[0][0] + oy * list[0][1] - off, d1 = ox * list[1][0] + oy * list[1][1] - off;
    if (d0 <= 0) out.push(list[0]);
    if (d1 <= 0) out.push(list[1]);
    if (d0 * d1 < 0) { const t = d0 / (d0 - d1); out.push([list[0][0] + t * (list[1][0] - list[0][0]), list[0][1] + t * (list[1][1] - list[0][1]), d0 > 0 ? list[0][2] : list[1][2]]); }
    return out;
  };
  pts = clip(pts, -ux, -uy, -(ux * v1[0] + uy * v1[1]));
  if (pts.length < 2) return null;
  pts = clip(pts, ux, uy, ux * v2[0] + uy * v2[1]);
  if (pts.length < 2) return null;
  const out = [];
  for (const [px, py, vi] of pts) {
    const d = nx * (px - v1[0]) + ny * (py - v1[1]), sep = d - rr;
    if (sep > MARGIN) continue;
    out.push({ x: px - nx * d * 0.5, y: py - ny * d * 0.5, sep, key: edge * 64 + vi * 2 + (flip ? 1 : 0) });
  }
  if (!out.length) return null;
  return { nx: flip ? -nx : nx, ny: flip ? -ny : ny, pts: out };
}

function collide(A, B) {
  const sa = A.b.shape, sb = B.b.shape;
  const flipped = m => m && { nx: -m.nx, ny: -m.ny, pts: m.pts };
  if (sa === 'circle' && sb === 'circle') return circleCircle(A, B);
  if (sa === 'poly' && sb === 'circle') return polyCircle(A, B);
  if (sa === 'circle' && sb === 'poly') return flipped(polyCircle(B, A));
  if (sa === 'seg' && sb === 'circle') return segCircle(A, B);
  if (sa === 'circle' && sb === 'seg') return flipped(segCircle(B, A));
  if (sa === 'seg' && sb === 'seg') return null;
  return polyPoly(A, B);
}

/** Whether a world point lies inside a body's shape. */
export function containsPoint(b, x, y) {
  const p = proxyOf(b);
  if (b.shape === 'circle') return Math.hypot(x - b.x, y - b.y) <= b.r;
  if (b.shape === 'seg') return segCircle(p, { b: { r: 0 }, cx: x, cy: y })?.pts[0].sep <= 0;
  return p.v.every((v, i) => p.n[i][0] * (x - v[0]) + p.n[i][1] * (y - v[1]) <= 0);
}

// ---------- swept collision ----------
function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = ox - cx, fy = oy - cy, a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
  if (c < 0) return Infinity; // starting inside: the contact solver owns it
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a === 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : Infinity;
}
function raySeg(ox, oy, dx, dy, ax, ay, bx, by, nx, ny, r) {
  // Segment offset outward along n by r; only crossings moving against n count.
  const ax2 = ax + nx * r, ay2 = ay + ny * r, bx2 = bx + nx * r, by2 = by + ny * r;
  const vn = dx * nx + dy * ny;
  if (vn >= 0) return Infinity;
  const dist = (ox - ax2) * nx + (oy - ay2) * ny;
  if (dist < 0) return Infinity;
  const t = dist / -vn;
  if (t > 1) return Infinity;
  const px = ox + dx * t, py = oy + dy * t, ex = bx2 - ax2, ey = by2 - ay2, u = ((px - ax2) * ex + (py - ay2) * ey) / (ex * ex + ey * ey || 1);
  return u >= 0 && u <= 1 ? t : Infinity;
}
/** Time of impact (0..1) of a circle moving by (dx, dy) against a shape proxy, or Infinity. */
function sweep(C, dx, dy, P) {
  const ox = C.cx, oy = C.cy, r = C.b.r + P.b.r;
  if (P.b.shape === 'circle') return rayCircle(ox, oy, dx, dy, P.cx, P.cy, r);
  let t = Infinity;
  const v = P.v, n = P.n, closed = P.b.shape === 'poly';
  const edges = closed ? v.length : 2;
  for (let i = 0; i < edges; i++) {
    const a = closed ? v[i] : v[i & 1], b = closed ? v[(i + 1) % v.length] : v[(i + 1) & 1];
    t = Math.min(t, raySeg(ox, oy, dx, dy, a[0], a[1], b[0], b[1], n[i][0], n[i][1], r));
  }
  for (const c of v) t = Math.min(t, rayCircle(ox, oy, dx, dy, c[0], c[1], r));
  return t;
}

// ---------- broadphase ----------
const grids = new WeakMap();
function staticGrid(world) {
  let g = grids.get(world);
  if (g && g.rev === world.rev && g.n === world.bodies.length) return g;
  const cells = new Map(), size = world.cell;
  const list = [];
  for (const b of world.bodies) {
    if (b.type !== 'static' || b.dead) continue;
    const idx = list.length, bb = aabbOf(b), box = [bb[0] - MARGIN, bb[1] - MARGIN, bb[2] + MARGIN, bb[3] + MARGIN];
    list.push(b);
    for (let gx = Math.floor(box[0] / size); gx <= Math.floor(box[2] / size); gx++) for (let gy = Math.floor(box[1] / size); gy <= Math.floor(box[3] / size); gy++) {
      const k = gx * 73856093 ^ gy * 19349663;
      let cell = cells.get(k); if (!cell) cells.set(k, cell = []); cell.push(idx);
    }
  }
  g = { rev: world.rev, n: world.bodies.length, cells, list, stamp: new Int32Array(list.length), mark: 0 };
  grids.set(world, g);
  return g;
}
function queryStatic(g, box, size) {
  const out = [];
  g.mark++;
  for (let gx = Math.floor(box[0] / size); gx <= Math.floor(box[2] / size); gx++) for (let gy = Math.floor(box[1] / size); gy <= Math.floor(box[3] / size); gy++) {
    const cell = g.cells.get(gx * 73856093 ^ gy * 19349663);
    if (!cell) continue;
    for (const i of cell) if (g.stamp[i] !== g.mark) { g.stamp[i] = g.mark; out.push(i); }
  }
  return out.sort((a, b) => a - b);
}
const canCollide = (a, b) => (a.cat & b.mask) !== 0 && (b.cat & a.mask) !== 0;

// ---------- step ----------
/**
 * Advance the world by dt (split into world.substeps). After the call,
 * world.contacts lists this step's touching pairs as
 * { a, b, nx, ny, x, y, impulse, speed, sensor, begin } (normal from a to b).
 */
export function stepWorld(world, dt) {
  if (world.bodies.some(b => b.dead)) {
    const alive = new Set();
    world.bodies = world.bodies.filter(b => !b.dead && alive.add(b.id));
    world.joints = world.joints.filter(j => (!j.a || alive.has(j.a)) && alive.has(j.b));
  }
  const n = world.substeps, h = dt / n;
  const report = new Map();
  for (let s = 0; s < n; s++) substep(world, h, report);
  const touching = {};
  world.contacts = [];
  for (const [key, c] of report) { c.begin = !world.touching[key]; touching[key] = 1; world.contacts.push(c); }
  world.touching = touching;
  world.time += dt;
  if (world.sleep) updateSleep(world, dt);
}

function substep(world, h, report) {
  const bodies = world.bodies, by = new Map();
  for (const b of bodies) by.set(b.id, b);
  // Integrate forces.
  for (const b of bodies) {
    if (b.type !== 'dynamic' || b.sleeping) continue;
    b.vx += world.gx * b.gs * h; b.vy += world.gy * b.gs * h;
    if (b.damp) { const k = 1 / (1 + h * b.damp); b.vx *= k; b.vy *= k; }
    if (b.adamp) b.av *= 1 / (1 + h * b.adamp);
  }
  // Collide.
  const grid = staticGrid(world), size = world.cell;
  const movers = [], proxies = new Map();
  for (const b of bodies) if (b.type !== 'static') { const p = proxyOf(b); proxies.set(b.id, p); movers.push(p); }
  const sproxy = i => { const b = grid.list[i]; let p = proxies.get(b.id); if (!p) { p = proxyOf(b); proxies.set(b.id, p); } return p; };
  const manifolds = [];
  const consider = (A, B) => {
    const a = A.b, b = B.b;
    if (!canCollide(a, b)) return;
    const aMoves = a.type === 'dynamic' && !a.sleeping, bMoves = b.type === 'dynamic' && !b.sleeping;
    if (!aMoves && !bMoves && !(a.type === 'kinematic' && b.type === 'dynamic') && !(b.type === 'kinematic' && a.type === 'dynamic')) return;
    if (!overlaps(A.box, B.box, MARGIN)) return;
    const m = collide(A, B);
    if (!m) return;
    if (a.sensor || b.sensor) { if (m.pts.some(p => p.sep < 0)) record(report, a, b, m, 0, 0, true); return; }
    // Sleeping partners stay asleep (and act as static) unless hit by something moving.
    if (a.sleeping && bMoves && (b.vx * b.vx + b.vy * b.vy > 0.04 || b.av * b.av > 0.04)) wake(a);
    if (b.sleeping && aMoves && (a.vx * a.vx + a.vy * a.vy > 0.04 || a.av * a.av > 0.04)) wake(b);
    if (a.sleeping && b.type === 'kinematic') wake(a);
    if (b.sleeping && a.type === 'kinematic') wake(b);
    manifolds.push({ a, b, ...m });
  };
  // Only pairs with a dynamic body can produce contacts; kinematic-kinematic pairs are skipped.
  for (let i = 0; i < movers.length; i++) {
    const A = movers[i];
    if (A.b.type !== 'dynamic') continue;
    for (let j = 0; j < movers.length; j++) if (j !== i && (j > i || movers[j].b.type !== 'dynamic')) consider(A, movers[j]);
    if (A.b.sleeping) continue;
    for (const k of queryStatic(grid, A.box, size)) consider(A, sproxy(k));
  }
  // Prepare contact constraints with warm starting.
  const warm = world.warm, nextWarm = {}, cons = [], solved = [];
  for (const m of manifolds) {
    const { a, b } = m;
    const mA = a.type === 'dynamic' && !a.sleeping ? a.invM : 0, iA = a.type === 'dynamic' && !a.sleeping ? a.invI : 0;
    const mB = b.type === 'dynamic' && !b.sleeping ? b.invM : 0, iB = b.type === 'dynamic' && !b.sleeping ? b.invI : 0;
    m.cons = [];
    if (mA + mB + iA + iB === 0) continue;
    const e = Math.max(a.e, b.e), mu = Math.sqrt(a.mu * b.mu), tx = -m.ny, ty = m.nx, bullet = a.bullet || b.bullet;
    let maxSpeed = 0;
    for (const p of m.pts) {
      const rax = p.x - a.x, ray = p.y - a.y, rbx = p.x - b.x, rby = p.y - b.y;
      const dvx = b.vx - b.av * rby - a.vx + a.av * ray, dvy = b.vy + b.av * rbx - a.vy - a.av * rax;
      const vn = dvx * m.nx + dvy * m.ny;
      // Speculative points only for bullets about to hit (they destabilize warm-started stacks).
      if (p.sep > 0 && !(bullet && p.sep + vn * h < 0)) continue;
      const rnA = cross(rax, ray, m.nx, m.ny), rnB = cross(rbx, rby, m.nx, m.ny);
      const rtA = cross(rax, ray, tx, ty), rtB = cross(rbx, rby, tx, ty);
      const kn = mA + mB + iA * rnA * rnA + iB * rnB * rnB, kt = mA + mB + iA * rtA * rtA + iB * rtB * rtB;
      let target = p.sep > 0 ? -p.sep / h : BAUMGARTE * Math.max(0, -p.sep - SLOP) / h;
      if (vn < -BOUNCE_MIN && e > 0 && p.sep + vn * h < 0) target = Math.max(target, -e * vn);
      if (-vn > maxSpeed) maxSpeed = -vn;
      const key = `${a.id}|${b.id}|${p.key}`, w = warm[key];
      const c = { a, b, mA, mB, iA, iB, nx: m.nx, ny: m.ny, tx, ty, rax, ray, rbx, rby, rnA, rnB, mn: kn > 0 ? 1 / kn : 0, kn, mt: kt > 0 ? 1 / kt : 0, target, mu, jn: w ? w[0] : 0, jt: w ? w[1] : 0, key };
      if (w) {
        const px = m.nx * c.jn + tx * c.jt, py = m.ny * c.jn + ty * c.jt;
        a.vx -= px * mA; a.vy -= py * mA; a.av -= cross(rax, ray, px, py) * iA;
        b.vx += px * mB; b.vy += py * mB; b.av += cross(rbx, rby, px, py) * iB;
      }
      cons.push(c); m.cons.push(c);
    }
    m.speed = maxSpeed;
    if (!m.cons.length) continue;
    // Two-point manifolds use a 2x2 block solve (stable stacks without drift).
    if (m.cons.length === 2) {
      const [c1, c2] = m.cons, k12 = mA + mB + iA * c1.rnA * c2.rnA + iB * c1.rnB * c2.rnB, det = c1.kn * c2.kn - k12 * k12;
      if (c1.kn * c1.kn < 1000 * det) m.block = { k11: c1.kn, k12, k22: c2.kn, i11: c2.kn / det, i12: -k12 / det, i22: c1.kn / det };
    }
    solved.push(m);
  }
  const joints = world.joints.map(j => prepareJoint(j, by, h)).filter(Boolean);
  const apply = (c, px, py) => {
    const { a, b } = c;
    a.vx -= px * c.mA; a.vy -= py * c.mA; a.av -= cross(c.rax, c.ray, px, py) * c.iA;
    b.vx += px * c.mB; b.vy += py * c.mB; b.av += cross(c.rbx, c.rby, px, py) * c.iB;
  };
  const normalSpeed = c => { const { a, b } = c; return (b.vx - b.av * c.rby - a.vx + a.av * c.ray) * c.nx + (b.vy + b.av * c.rbx - a.vy - a.av * c.rax) * c.ny; };
  // Iterate.
  for (let it = 0; it < world.iterations; it++) {
    for (const j of joints) solveJoint(j, h);
    for (const m of solved) {
      for (const c of m.cons) {
        const { a, b } = c;
        const vt = (b.vx - b.av * c.rby - a.vx + a.av * c.ray) * c.tx + (b.vy + b.av * c.rbx - a.vy - a.av * c.rax) * c.ty, maxF = c.mu * c.jn;
        const jt = Math.max(-maxF, Math.min(maxF, c.jt - vt * c.mt)), d = jt - c.jt; c.jt = jt;
        apply(c, c.tx * d, c.ty * d);
      }
      const B = m.block;
      if (B) {
        const [c1, c2] = m.cons, a1 = c1.jn, a2 = c2.jn;
        const b1 = normalSpeed(c1) - c1.target - (B.k11 * a1 + B.k12 * a2), b2 = normalSpeed(c2) - c2.target - (B.k12 * a1 + B.k22 * a2);
        let x1 = -(B.i11 * b1 + B.i12 * b2), x2 = -(B.i12 * b1 + B.i22 * b2);
        if (!(x1 >= 0 && x2 >= 0)) {
          x1 = -b1 / B.k11; x2 = 0;
          if (!(x1 >= 0 && B.k12 * x1 + b2 >= 0)) {
            x1 = 0; x2 = -b2 / B.k22;
            if (!(x2 >= 0 && B.k12 * x2 + b1 >= 0)) { x1 = 0; x2 = 0; if (!(b1 >= 0 && b2 >= 0)) { x1 = a1; x2 = a2; } }
          }
        }
        c1.jn = x1; c2.jn = x2;
        apply(c1, c1.nx * (x1 - a1), c1.ny * (x1 - a1));
        apply(c2, c2.nx * (x2 - a2), c2.ny * (x2 - a2));
      } else for (const c of m.cons) {
        const jn = Math.max(0, c.jn + (c.target - normalSpeed(c)) * c.mn), d = jn - c.jn; c.jn = jn;
        apply(c, c.nx * d, c.ny * d);
      }
    }
  }
  for (const c of cons) nextWarm[c.key] = [c.jn, c.jt];
  world.warm = nextWarm;
  // Report (aggregated over substeps by pair).
  for (const m of manifolds) {
    if (!m.cons.length) continue;
    let imp = 0;
    for (const c of m.cons) imp += c.jn;
    record(report, m.a, m.b, m, imp, m.speed, false);
  }
  // Integrate positions, sweeping fast bullets against everything solid.
  for (const b of bodies) {
    if (b.type === 'static' || b.sleeping || b.dead) continue;
    let dx = b.vx * h, dy = b.vy * h;
    if (b.bullet && b.shape === 'circle' && dx * dx + dy * dy > b.r * b.r * 0.25) {
      const C = proxies.get(b.id), box = [Math.min(C.box[0], C.box[0] + dx), Math.min(C.box[1], C.box[1] + dy), Math.max(C.box[2], C.box[2] + dx), Math.max(C.box[3], C.box[3] + dy)];
      let t = 1;
      const test = P => { if (P.b === b || P.b.sensor || !canCollide(b, P.b) || !overlaps(box, P.box, 0)) return; const s = sweep(C, dx, dy, P); if (s < t) t = s; };
      for (const k of queryStatic(grid, box, size)) test(sproxy(k));
      for (const P of movers) if (!P.b.bullet) test(P);
      if (t < 1) { const len = Math.hypot(dx, dy), back = Math.max(0, t - 0.002 / len); dx *= back; dy *= back; }
    }
    b.x += dx; b.y += dy; b.a += b.av * h;
  }
}

function record(report, a, b, m, impulse, speed, sensor) {
  const key = `${a.id}|${b.id}`;
  const r = report.get(key);
  if (r) { r.impulse += impulse; if (speed > r.speed) r.speed = speed; return; }
  const p = m.pts[0];
  report.set(key, { a: a.id, b: b.id, nx: m.nx, ny: m.ny, x: p.x, y: p.y, impulse, speed, sensor, begin: false });
}

function updateSleep(world, dt) {
  for (const b of world.bodies) {
    if (b.type !== 'dynamic' || b.sleeping) continue;
    if (b.bullet || b.data?.awake) { b.idle = 0; continue; }
    if (b.vx * b.vx + b.vy * b.vy < SLEEP_V2 && b.av * b.av < SLEEP_W2) {
      b.idle += dt;
      if (b.idle >= SLEEP_TIME) { b.sleeping = true; b.vx = b.vy = b.av = 0; }
    } else b.idle = 0;
  }
  // Joints keep their bodies awake together.
  const by = bodyIndex(world);
  for (const j of world.joints) {
    const A = j.a ? by.get(j.a) : null, B = by.get(j.b);
    if (A && B && A.sleeping !== B.sleeping) { wake(A); wake(B); }
    if (j.type === 'revolute' && j.motor && B) wake(B);
  }
}

/** The contact manifold between two bodies (normal from a to b), or null. */
export function collideBodies(a, b) { return collide(proxyOf(a), proxyOf(b)); }

// ---------- joint solver ----------
function prepareJoint(j, by, h) {
  const A = j.a ? by.get(j.a) : null, B = by.get(j.b);
  if (!B || B.sleeping && (!A || A.sleeping)) return null;
  const rot = (body, [x, y]) => { if (!body) return [x, y]; const c = Math.cos(body.a), s = Math.sin(body.a); return [c * x - s * y, s * x + c * y]; };
  const ra = A ? rot(A, j.la) : [0, 0], rb = rot(B, j.lb);
  const pa = A ? [A.x + ra[0], A.y + ra[1]] : j.la, pb = [B.x + rb[0], B.y + rb[1]];
  const mA = A && A.type === 'dynamic' ? A.invM : 0, iA = A && A.type === 'dynamic' ? A.invI : 0, mB = B.type === 'dynamic' ? B.invM : 0, iB = B.type === 'dynamic' ? B.invI : 0;
  const s = { j, A: A || { vx: 0, vy: 0, av: 0, a: 0 }, B, ra, rb, mA, mB, iA, iB, h };
  if (j.type === 'distance') {
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], len = Math.hypot(dx, dy) || 1e-6;
    s.nx = dx / len; s.ny = dy / len; s.C = len - j.length;
    if (j.rope && s.C <= 0) { j.ji = 0; return null; }
    const rnA = cross(ra[0], ra[1], s.nx, s.ny), rnB = cross(rb[0], rb[1], s.nx, s.ny), k = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
    s.m = k > 0 ? 1 / k : 0;
  } else {
    s.cx = pb[0] - pa[0]; s.cy = pb[1] - pa[1];
    const k11 = mA + mB + iA * ra[1] * ra[1] + iB * rb[1] * rb[1], k12 = -iA * ra[0] * ra[1] - iB * rb[0] * rb[1], k22 = mA + mB + iA * ra[0] * ra[0] + iB * rb[0] * rb[0];
    const det = k11 * k22 - k12 * k12;
    s.k = det ? [k22 / det, -k12 / det, k11 / det] : [0, 0, 0];
    s.am = iA + iB > 0 ? 1 / (iA + iB) : 0;
    s.angle = B.a - (A ? A.a : 0) - j.ref;
    j.jx = j.jy = j.jm = j.jl = 0;
  }
  return s;
}
function push(s, px, py, ang = 0) {
  const { A, B } = s;
  if (s.mA || s.iA) { A.vx -= px * s.mA; A.vy -= py * s.mA; A.av -= (cross(s.ra[0], s.ra[1], px, py) + ang) * s.iA; }
  B.vx += px * s.mB; B.vy += py * s.mB; B.av += (cross(s.rb[0], s.rb[1], px, py) + ang) * s.iB;
}
function solveJoint(s, h) {
  const { j, A, B, ra, rb } = s;
  const vax = A.vx - A.av * ra[1], vay = A.vy + A.av * ra[0], vbx = B.vx - B.av * rb[1], vby = B.vy + B.av * rb[0];
  if (j.type === 'distance') {
    const vn = (vbx - vax) * s.nx + (vby - vay) * s.ny;
    let lambda = -(vn + BAUMGARTE * s.C / h) * s.m;
    if (j.rope) { const old = j.ji; j.ji = Math.min(0, old + lambda); lambda = j.ji - old; }
    push(s, s.nx * lambda, s.ny * lambda);
    return;
  }
  if (j.motor) {
    const wrel = B.av - A.av - j.speed, max = j.maxTorque * h, old = j.jm;
    j.jm = Math.max(-max, Math.min(max, old - wrel * s.am));
    push(s, 0, 0, j.jm - old);
  }
  if (j.limit) {
    const wrel = B.av - A.av;
    if (s.angle <= j.lower) {
      const old = j.jl; j.jl = Math.max(0, old - (wrel + BAUMGARTE * Math.min(0, s.angle - j.lower) / h) * s.am); push(s, 0, 0, j.jl - old);
    } else if (s.angle >= j.upper) {
      const old = j.jl; j.jl = Math.min(0, old - (wrel + BAUMGARTE * Math.max(0, s.angle - j.upper) / h) * s.am); push(s, 0, 0, j.jl - old);
    }
  }
  const cx = vbx - vax + BAUMGARTE * s.cx / h, cy = vby - vay + BAUMGARTE * s.cy / h;
  const px = -(s.k[0] * cx + s.k[1] * cy), py = -(s.k[1] * cx + s.k[2] * cy);
  push(s, px, py);
}
