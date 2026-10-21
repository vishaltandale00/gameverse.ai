// Continuous 2D rigid bodies: physics puzzles, pinball, breakout, slingshot
// toys, top-down driving. Wraps the impulse solver ported from the physics kit
// (spaces2d-rigid.js: warm starting, restitution, Coulomb friction, 2-point
// block solver, distance/rope/revolute joints with motors and limits, sensors,
// kinematic bodies, swept bullets, sleeping, grid broadphase; SLOP 0.004,
// BAUMGARTE 0.15, 4 substeps × 6 iterations by default). Entities own
// components.body; the space keeps the solver world in state, syncs entity
// edits in before each step and results out after, and reports contacts.
import { createWorld, addBody, addArc, addChain, removeBody, wake, bodyIndex, applyImpulse, addDistanceJoint, addRevoluteJoint, stepWorld, raycastWorld, queryShape, depenetrate, containsPoint, aabbOf } from './spaces2d-rigid.js';
import { zoneIndex, zoneTracker, zoneEditor, obstacleOf, inSpace, bodyOf, rectHas, rectArea, rectCenter, rectDist, edgesParam, checkEdges, wrapDelta, mod, BOUNDS_CAPS } from './spaces2d-lib.js';

const SHAPES = ['circle', 'box', 'poly', 'seg'];
const WALL_KINDS = ['box', 'circle', 'poly', 'seg', 'arc', 'chain'];
const JOINT_KINDS = ['distance', 'rope', 'revolute'];
const num = (d, o = {}) => ({ type: 'number', default: d, ...o });
const shapeFields = {
  restitution: num(0.2, { min: 0, max: 1.5 }), friction: num(0.5, { min: 0, max: 5 }), sensor: { type: 'boolean', default: false },
  category: { type: 'integer', default: 1, min: 0, max: 0xffff }, mask: { type: 'integer', default: 0xffff, min: 0, max: 0xffff }, tags: { type: 'list', of: { type: 'string' }, default: [] },
};

export default {
  id: 'engine.space.physics2d',
  card: {
    intent: 'Continuous 2D rigid-body physics: circles, boxes, polygons and capsule segments with restitution, friction, joints (distance, rope, revolute with motor and limits), sensors, kinematic movers, fast bullets and sleeping. For physics puzzles, pinball, breakout, slingshot toys and top-down driving.',
    views: ['side', 'td'],
    needs: { content: ['structures'] },
    params: {
      gravity: { type: 'list', of: { type: 'number' }, min: 2, max: 2, default: [0, -9.8], unit: 'm/s²', effect: 'gravity vector (y up)' },
      bounds: { type: 'list', of: { type: 'number', min: 1, max: 100000 }, min: 2, max: 2, default: [20, 12], unit: 'm', scale: 'world', effect: 'world width and height from the origin' },
      edges: edgesParam('solid'),
      substeps: { type: 'integer', min: 1, max: 8, default: 4, effect: 'solver substeps per frame' },
      iterations: { type: 'integer', min: 1, max: 20, default: 6, effect: 'velocity iterations per substep' },
      cell: num(2, { min: 0.25, max: 100, unit: 'm', effect: 'broadphase grid cell for static geometry' }),
      sleep: { type: 'boolean', default: true, effect: 'resting bodies sleep until touched (0.5 s below 0.08 m/s)' },
      contactEvents: { type: 'string', options: ['begin', 'all', 'none'], default: 'begin', effect: "emit 'contact' when touching starts, every step while touching, or never" },
      impactMin: num(0.5, { min: 0, unit: 'N·s', effect: "begin contacts with at least this normal impulse also emit 'impact'" }),
      walls: { type: 'list', default: [], of: { type: 'object', fields: {
        id: { type: 'string' }, kind: { type: 'string', options: WALL_KINDS, default: 'box' },
        at: { type: 'list', of: { type: 'number' }, default: [0, 0] }, size: { type: 'list', of: { type: 'number' }, default: [1, 1] }, angle: num(0, { unit: 'rad' }),
        r: num(0, { min: 0 }), points: { type: 'list', of: { type: 'json' }, default: [] }, radius: num(1, { min: 0 }), from: num(0, { unit: 'rad' }), to: num(Math.PI, { unit: 'rad' }), segments: { type: 'integer', min: 1, max: 128, default: 8 },
        ...shapeFields,
      } }, effect: 'static geometry: boxes, circles, polygons, capsule segments (points [a,b]), arcs (at=center) and chains of segments' },
      bodies: { type: 'list', default: [], of: { type: 'object', fields: {
        id: { type: 'string', required: true }, archetype: { type: 'ref', to: 'archetype' }, at: { type: 'list', of: { type: 'number' }, required: true }, body: { type: 'json' },
      } }, effect: 'entities spawned at start with these body settings (merged over the archetype body)' },
      joints: { type: 'list', default: [], of: { type: 'object', fields: {
        id: { type: 'string', required: true }, kind: { type: 'string', options: JOINT_KINDS, required: true }, a: { type: 'string' }, b: { type: 'string', required: true },
        anchor: { type: 'list', of: { type: 'number' } }, anchorB: { type: 'list', of: { type: 'number' } }, length: { type: 'number', min: 0 },
        motor: { type: 'boolean', default: false }, speed: num(0, { unit: 'rad/s' }), maxTorque: num(0, { min: 0 }), limit: { type: 'boolean', default: false }, lower: num(0, { unit: 'rad' }), upper: num(0, { unit: 'rad' }),
      } }, effect: 'joints between entities (a omitted = world anchor); anchors are world points' },
    },
    provides: {
      capabilities: ['position', 'distance', 'overlap', 'raycast', 'gravity', 'joints', 'dynamics', 'bounds', 'wrap'],
      capabilityMethods: { joints: ['addJoint', 'removeJoint', 'joints', 'setMotor', 'jointAngle'], ...BOUNDS_CAPS },
      events: ['enter_zone', 'leave_zone', 'enter_zone:*', 'leave_zone:*', 'contact', 'contact_end', 'impact', 'out_of_bounds', 'out_of_bounds:*', 'zone_added'],
    },
    at: 'At = [x, y] metres, y up: the body centre of mass. components.body = {size, vel, angle, angVel, shape:{kind:circle,r}|{kind:box,w,h}|{kind:poly,points}|{kind:seg,a,b,r}, type:dynamic|static|kinematic (static:true alias), density=1, restitution=0.2, friction=0.5, sensor, bullet, gravityScale=1, damping, angularDamping=0.05, fixedRotation, category=1, mask=0xffff}; the space fills mass and sleeping.',
    zones: 'Zone = {id, name?, rect:[x0,y0,x1,y1) metres, spawn?, tags?, rules?}; membership by body centre',
    state: 'rt.state.spaces[id] = {world: solver JSON (bodies with ref = entity or wall id, joints with jid, warm-start cache, touching pairs), inside, out, zones?}',
    notes: "Entity obstacles: components.body.solid (default type kinematic) collides; solid:false turns the body into a ghost (an opened door); oneWay bodies hold others only from above (arriving against gravity) and never stop bullets. Events: contact {a, b, impulse, normal (a→b), at, speed, begin, sensor}; impact (same, begin contacts with impulse ≥ impactMin); contact_end {a, b}. a/b are entity ids or wall ids. raycast hits are 'entity' (with id) or 'cell' for static walls (with wall). slide() moves a body kinematically with depenetration. Joint angles in radians.",
  },
  capabilities(config) {
    const caps = ['position', 'distance', 'overlap', 'raycast', 'gravity', 'joints', 'dynamics', 'bounds'];
    if (Object.values(config.edges || {}).includes('wrap')) caps.push('wrap');
    return caps;
  },
  validate(config) {
    const errors = [...checkEdges(config.edges, 'with.edges')];
    const ids = new Set((config.bodies || []).map(b => b.id));
    (config.walls || []).forEach((w, i) => {
      if ((w.kind === 'seg' || w.kind === 'chain') && (!Array.isArray(w.points) || w.points.length < 2)) errors.push({ code: 'wall_invalid', path: `with.walls[${i}].points`, message: `${w.kind} walls need at least two points` });
      if (w.kind === 'poly' && (!Array.isArray(w.points) || w.points.length < 3)) errors.push({ code: 'wall_invalid', path: `with.walls[${i}].points`, message: 'poly walls need at least three points' });
    });
    (config.bodies || []).forEach((b, i) => { const s = b.body?.shape; if (s && !SHAPES.includes(s.kind)) errors.push({ code: 'shape_invalid', path: `with.bodies[${i}].body.shape.kind`, message: `shape kind must be ${SHAPES.join('|')}` }); });
    (config.joints || []).forEach((j, i) => {
      for (const k of ['a', 'b']) if (j[k] != null && !ids.has(j[k])) errors.push({ code: 'joint_body_unknown', path: `with.joints[${i}].${k}`, message: `joint '${j.id}' references body '${j[k]}' not declared in bodies`, hint: 'declare it under with.bodies, or add the joint at runtime with addJoint' });
      if (j.kind === 'revolute' && !j.anchor) errors.push({ code: 'joint_anchor_missing', path: `with.joints[${i}].anchor`, message: 'revolute joints need a world pivot anchor' });
      if (j.limit && j.lower > j.upper) errors.push({ code: 'joint_limit_invalid', path: `with.joints[${i}]`, message: 'lower limit exceeds upper' });
    });
    return errors;
  },
  install(rt, config, instance) {
    const sid = instance.id, [W, H] = config.bounds, E = config.edges, [gx, gy] = config.gravity;
    const wrapX = E.left === 'wrap', wrapY = E.bottom === 'wrap';
    const sst = () => rt.state.spaces[sid];
    const world = () => (sst().world ??= initWorld());
    const zones = zoneIndex(rt, sid);
    const zoneHas = (z, at) => Boolean(z.rect) && rectHas(z.rect, at);
    const tracker = zoneTracker(rt, sid, zones, zoneHas, z => (z.rect ? rectArea(z.rect) : Infinity));
    // Body lookup by entity / wall ref, cached per world object and body count.
    // Rebuilt when the world object (restore), its id counter (adds) or its body list (removals) change.
    let idxWorld = null, idxN = -1, idxLen = -1, byRef = new Map(), byId = new Map();
    const index = () => { const w = world(); if (idxWorld !== w || idxN !== w.nextId || idxLen !== w.bodies.length) { idxWorld = w; idxN = w.nextId; idxLen = w.bodies.length; byRef = new Map(); byId = bodyIndex(w); for (const b of w.bodies) if (!b.dead && !byRef.has(b.ref)) byRef.set(b.ref, b); } return { byRef, byId }; };
    const bodyFor = e => { const b = index().byRef.get(e.id); return b && !b.dead ? b : null; };
    const refOf = id => index().byId.get(id)?.ref ?? null;

    function initWorld() {
      const w = createWorld({ gx, gy, substeps: config.substeps, iterations: config.iterations, cell: config.cell, sleep: config.sleep });
      const T = Math.max(1, Math.min(W, H) * 0.1);
      const edge = (ref, x, y, ww, hh) => { const b = addBody(w, { shape: 'box', type: 'static', x, y, w: ww, h: hh, e: 0.2, mu: 0.5 }); b.ref = ref; b.wall = true; };
      if (E.left === 'solid') edge('edge:left', -T / 2, H / 2, T, H + 2 * T);
      if (E.right === 'solid') edge('edge:right', W + T / 2, H / 2, T, H + 2 * T);
      if (E.bottom === 'solid') edge('edge:bottom', W / 2, -T / 2, W + 2 * T, T);
      if (E.top === 'solid') edge('edge:top', W / 2, H + T / 2, W + 2 * T, T);
      config.walls.forEach((d, i) => {
        const ref = d.id || `wall${i}`, o = { type: 'static', e: d.restitution, mu: d.friction, sensor: d.sensor, cat: d.category, mask: d.mask, r: d.r, tag: ref };
        let made = [];
        if (d.kind === 'box') made = [addBody(w, { ...o, shape: 'box', x: d.at[0], y: d.at[1], a: d.angle, w: d.size[0], h: d.size[1] })];
        else if (d.kind === 'circle') made = [addBody(w, { ...o, shape: 'circle', x: d.at[0], y: d.at[1], r: d.r || d.radius })];
        else if (d.kind === 'poly') made = [addBody(w, { ...o, shape: 'poly', x: d.at[0], y: d.at[1], a: d.angle, verts: d.points })];
        else if (d.kind === 'seg') made = [addBody(w, { ...o, shape: 'seg', x1: d.points[0][0], y1: d.points[0][1], x2: d.points[1][0], y2: d.points[1][1] })];
        else if (d.kind === 'chain') made = addChain(w, d.points, o);
        else if (d.kind === 'arc') made = addArc(w, d.at[0], d.at[1], d.radius, d.from, d.to, d.segments, o);
        for (const b of made) { b.ref = ref; b.wall = true; b.data = { tags: d.tags }; }
      });
      return w;
    }

    // ---------- entity ↔ body ----------
    function defOf(e) {
      const B = bodyOf(e), s = B.shape || { kind: 'box', w: B.size[0], h: B.size[1] };
      // Entity obstacles (body.solid set, true or false) are kinematic unless typed: mechanisms move and open them.
      const type = B.static ? 'static' : B.type || (B.solid !== undefined ? 'kinematic' : 'dynamic');
      const d = { type, x: e.at[0], y: e.at[1], a: B.angle || 0, vx: B.vel[0], vy: B.vel[1], av: B.angVel || 0, density: B.density ?? 1, e: B.restitution ?? 0.2, mu: B.friction ?? 0.5,
        cat: B.category ?? 1, mask: B.mask ?? 0xffff, sensor: !!B.sensor, bullet: !!B.bullet, gs: B.gravityScale ?? 1, damp: B.damping || 0, adamp: B.angularDamping ?? 0.05, fixedRotation: !!B.fixedRotation };
      if (s.kind === 'circle') { d.shape = 'circle'; d.r = s.r; B.size = [2 * s.r, 2 * s.r]; }
      else if (s.kind === 'poly') { d.shape = 'poly'; d.verts = s.points; d.r = s.radius || 0; }
      else if (s.kind === 'seg') { d.shape = 'seg'; d.x1 = e.at[0] + s.a[0]; d.y1 = e.at[1] + s.a[1]; d.x2 = e.at[0] + s.b[0]; d.y2 = e.at[1] + s.b[1]; d.r = s.r || 0; }
      else { d.shape = 'box'; d.w = s.w ?? B.size[0]; d.h = s.h ?? B.size[1]; }
      return d;
    }
    function attach(e) {
      const w = world(), b = addBody(w, defOf(e));
      b.ref = e.id; const B = e.components.body;
      B.mass = +b.m.toFixed(9); e.at = [b.x, b.y]; B.sleeping = false;
      obstacleFlags(e, b);
      if (b.type === 'static') w.rev++;
      return b;
    }
    // body.solid false (an opened door) makes a body a ghost; body.oneWay makes it a one-way platform.
    function obstacleFlags(e, b) {
      const B = e.components.body, off = B.solid === false, one = obstacleOf(e) === 'oneway';
      if (Boolean(b.ghost) !== off || Boolean(b.oneWay) !== one) { b.ghost = off; b.oneWay = one; wake(b); if (b.type === 'static') world().rev++; }
    }
    // Entity edits made between steps (positions, velocities, obstacle flags) flow into the solver.
    function syncIn() {
      for (const e of inSpace(rt, sid)) {
        let b = bodyFor(e); if (!b) { b = attach(e); continue; }
        const B = bodyOf(e);
        if (e.at[0] !== b.x || e.at[1] !== b.y) { b.x = e.at[0]; b.y = e.at[1]; wake(b); if (b.type === 'static') world().rev++; }
        if (B.vel[0] !== b.vx || B.vel[1] !== b.vy) { b.vx = B.vel[0]; b.vy = B.vel[1]; wake(b); }
        if ((B.angle ?? 0) !== b.a) { b.a = B.angle ?? 0; wake(b); }
        if ((B.angVel ?? 0) !== b.av) { b.av = B.angVel ?? 0; wake(b); }
        obstacleFlags(e, b);
      }
    }
    function syncOut(rt) {
      const out = (sst().out ??= {});
      for (const e of inSpace(rt, sid)) {
        const b = bodyFor(e); if (!b) continue;
        if (wrapX && (b.x < 0 || b.x >= W)) { b.x = mod(b.x, W); wake(b); }
        if (wrapY && (b.y < 0 || b.y >= H)) { b.y = mod(b.y, H); wake(b); }
        const B = e.components.body;
        e.at = [b.x, b.y]; B.vel = [b.vx, b.vy]; B.angle = b.a; B.angVel = b.av; B.sleeping = b.sleeping;
        tracker.track(e, rt);
        const box = aabbOf(b), edge = box[2] < 0 ? 'left' : box[0] > W ? 'right' : box[3] < 0 ? 'bottom' : box[1] > H ? 'top' : null;
        if (edge && E[edge] === 'kill') { if (out[e.id] !== edge) { out[e.id] = edge; rt.emitTyped('out_of_bounds', edge, { who: e.id, edge }); } } else if (out[e.id]) delete out[e.id];
      }
    }
    function report(rt) {
      const w = world();
      if (config.contactEvents !== 'none') for (const c of w.contacts) {
        if (!c.begin && config.contactEvents !== 'all') continue;
        const data = { a: refOf(c.a), b: refOf(c.b), impulse: +c.impulse.toFixed(9), normal: [c.nx, c.ny], at: [c.x, c.y], speed: +c.speed.toFixed(9), begin: c.begin, sensor: c.sensor };
        rt.emit('contact', data);
        if (c.begin && !c.sensor && c.impulse >= config.impactMin) rt.emit('impact', data);
      }
      for (const x of w.ended || []) rt.emit('contact_end', { a: refOf(x.a), b: refOf(x.b) });
    }

    const setPos = (e, at, rt) => { e.at = [wrapX ? mod(at[0], W) : at[0], wrapY ? mod(at[1], H) : at[1]]; const b = bodyFor(e); if (b) { b.x = e.at[0]; b.y = e.at[1]; wake(b); } tracker.track(e, rt); };
    const delta = (a, b) => [wrapDelta(a[0], b[0], wrapX ? W : 0), wrapDelta(a[1], b[1], wrapY ? H : 0)];
    const entityOf = b => (b && !b.wall ? rt.entity(b.ref) : null);
    const solid = (b, self) => b !== self && !b.sensor && !b.dead && !b.ghost;
    const jointByRef = id => world().joints.find(j => j.jid === id) || null; // the solver uses j.ref for the revolute reference angle

    const api = {
      kind: 'physics2d', anchor: 'center', size: [W, H], config,
      get zones() { return zones().byId; },
      place(e, rt) { bodyOf(e); if (e.at == null) { const z = zones().list[0]; e.at = z ? (z.spawn || rectCenter(z.rect)) : [W / 2, H / 2]; } if (!bodyFor(e)) attach(e); tracker.track(e, rt); },
      remove(e, rt) { const b = bodyFor(e); if (b) removeBody(world(), b); for (const z of sst().inside?.[e.id] || []) rt.emitTyped('leave_zone', z, { who: e.id, zone: z }); tracker.forget(e); e.zone = null; if (sst().out) delete sst().out[e.id]; },
      pos: e => e.at, setPos,
      entitiesAt: at => world().bodies.filter(b => !b.dead && !b.wall && containsPoint(b, at[0], at[1])).map(b => b.ref),
      inZone: (e, zone) => { const z = zones().byId.get(zone); return Boolean(z) && zoneHas(z, e.at); },
      zoneAt: at => tracker.zoneAt(at),
      teleport(e, { zone, at }, rt) { const z = zone && zones().byId.get(zone); const p = at ?? (z ? z.spawn || rectCenter(z.rect) : e.at); bodyOf(e).vel = [0, 0]; const b = bodyFor(e); if (b) { b.vx = b.vy = b.av = 0; } setPos(e, p, rt); },
      nearest(e, target, rt) {
        const z = zones().byId.get(target);
        if (z) return zoneHas(z, e.at) ? 0 : rectDist(z.rect, e.at);
        let best = null; for (const o of inSpace(rt, sid)) if (o !== e && (o.id === target || o.archetype === target)) { const d = api.distance(e.at, o.at); if (best === null || d < best) best = d; }
        return best;
      },
      distance(a, b, metric = 'euclid') { const [dx, dy] = delta(a, b); return metric === 'manhattan' ? Math.abs(dx) + Math.abs(dy) : Math.hypot(dx, dy); },
      wrapPos: at => [wrapX ? mod(at[0], W) : at[0], wrapY ? mod(at[1], H) : at[1]], delta,
      bounds: () => ({ min: [0, 0], max: [W, H], wrap: [wrapX, wrapY] }),
      inBounds: (at, m = 0) => (wrapX || (at[0] >= -m && at[0] <= W + m)) && (wrapY || (at[1] >= -m && at[1] <= H + m)),
      overlap(shape, filter) {
        const f = typeof filter === 'function' ? filter : () => true, at = shape.at;
        let probe;
        if (shape.kind === 'circle' || shape.kind === 'sphere' || shape.kind === 'cone') probe = { x: at[0], y: at[1], r: shape.r ?? 0 };
        else { const s = shape.size || [0, 0], x0 = shape.centered ? at[0] - s[0] / 2 : at[0], y0 = shape.centered ? at[1] - s[1] / 2 : at[1]; probe = { x0, y0, x1: x0 + Math.max(s[0], 1e-6), y1: y0 + Math.max(s[1], 1e-6) }; }
        let hits = queryShape(world(), probe, b => !b.wall).map(entityOf).filter(e => e && f(e));
        if (shape.kind === 'cone') { const dir = shape.dir || [1, 0], dl = Math.hypot(...dir) || 1, cos = Math.cos(((shape.angle ?? 90) / 2) * Math.PI / 180); hits = hits.filter(e => { const [dx, dy] = delta(at, e.at), d = Math.hypot(dx, dy); return d < 1e-9 || (dx * dir[0] + dy * dir[1]) / (d * dl) >= cos; }); }
        return hits.map(e => e.id);
      },
      contacts(e) {
        const b = bodyFor(e); if (!b) return [];
        return world().contacts.filter(c => c.a === b.id || c.b === b.id).map(c => { const other = refOf(c.a === b.id ? c.b : c.a), s = c.a === b.id ? -1 : 1, isWall = index().byId.get(c.a === b.id ? c.b : c.a)?.wall; return isWall ? { wall: other, normal: [c.nx * s, c.ny * s], impulse: c.impulse } : { id: other, normal: [c.nx * s, c.ny * s], impulse: c.impulse }; });
      },
      raycast(from, dir, maxDist, mask = {}) {
        const l = Math.hypot(dir[0], dir[1]) || 1, ux = dir[0] / l, uy = dir[1] / l;
        const ent = mask.entities ?? true, ign = mask.ignore;
        const h = raycastWorld(world(), from[0], from[1], ux, uy, maxDist, b => (mask.sensors || !b.sensor) && !b.ghost && (!b.oneWay || (mask.oneway && uy < 0)) && b.ref !== ign && (b.wall ? mask.walls !== false : ent && (typeof ent !== 'function' || ent(rt.entity(b.ref)))) && (mask.category === undefined || (b.cat & mask.category) !== 0));
        if (!h) return { hit: 'none', at: null, normal: null, dist: maxDist };
        return h.body.wall ? { hit: 'cell', at: [h.x, h.y], normal: [h.nx, h.ny], dist: h.dist, wall: h.body.ref, cell: null } : { hit: 'entity', at: [h.x, h.y], normal: [h.nx, h.ny], dist: h.dist, id: h.body.ref };
      },
      gravityAt: () => [gx, gy, 0],
      /** Kinematic collide-and-slide for controlled bodies: sub-stepped moves with depenetration. */
      slide(e, d, rt, opts = {}) {
        const b = bodyFor(e) || attach(e), x0 = b.x, y0 = b.y, n = Math.max(1, Math.ceil(Math.hypot(d[0], d[1]) / Math.max(0.05, b.bound * 0.5)));
        const blocked = { x: false, y: false, z: false }; let grounded = false, normal = null;
        for (let i = 0; i < n; i++) {
          b.x += d[0] / n; b.y += d[1] / n;
          for (const nrm of depenetrate(world(), b, o => solid(o, b) && (!o.oneWay || (d[1] || 0) * (gy <= 0 ? 1 : -1) < 0) && (opts.filter ? opts.filter(o.wall ? null : rt.entity(o.ref)) : true))) {
            if (Math.abs(nrm[0]) > 0.7) blocked.x = true;
            if (Math.abs(nrm[1]) > 0.7) blocked.y = true;
            if (nrm[1] * Math.sign(-gy || -1) > 0.7) grounded = true;
            normal = nrm;
          }
        }
        wake(b); bodyOf(e).grounded = grounded || api.grounded(e);
        setPos(e, [b.x, b.y], rt);
        return { moved: b.x !== x0 || b.y !== y0, blocked, grounded: bodyOf(e).grounded, normal };
      },
      grounded(e) {
        const b = bodyFor(e); if (!b) return false;
        const box = aabbOf(b), down = gy <= 0 ? -1 : 1, y = down < 0 ? box[1] : box[3];
        return queryShape(world(), { x0: box[0] + 0.02, x1: box[2] - 0.02, y0: Math.min(y, y + down * 0.03), y1: Math.max(y, y + down * 0.03) }, o => solid(o, b)).length > 0;
      },
      // dynamics
      impulse(e, v, rt, at) { const b = bodyFor(e); if (!b) return; applyImpulse(b, v[0], v[1], at?.[0] ?? b.x, at?.[1] ?? b.y); const B = bodyOf(e); B.vel = [b.vx, b.vy]; B.angVel = b.av; },
      velocity: e => { const b = bodyFor(e); return b ? [b.vx, b.vy] : bodyOf(e).vel.slice(); },
      setVelocity(e, v) { const b = bodyFor(e); if (b) { b.vx = v[0]; b.vy = v[1]; wake(b); } bodyOf(e).vel = [v[0], v[1]]; },
      // joints
      addJoint(j, rt) {
        if (jointByRef(j.id)) return null;
        const A = j.a ? rt.entity(j.a) && bodyFor(rt.entity(j.a)) : null, Bb = rt.entity(j.b) && bodyFor(rt.entity(j.b));
        if (!Bb || (j.a && !A)) throw Error(`joint '${j.id}': unknown body`);
        let made;
        if (j.kind === 'revolute') {
          const p = j.anchor || [Bb.x, Bb.y];
          made = addRevoluteJoint(world(), { a: A ? A.id : 0, b: Bb.id, x: p[0], y: p[1], motor: !!j.motor, speed: j.speed || 0, maxTorque: j.maxTorque || 0, limit: !!j.limit, lower: j.lower || 0, upper: j.upper || 0 });
        } else {
          const pa = j.anchor || (A ? [A.x, A.y] : [Bb.x, Bb.y + 1]), pb = j.anchorB || [Bb.x, Bb.y];
          const local = (body, p) => { if (!body) return p.slice(); const c = Math.cos(body.a), s = Math.sin(body.a), dx = p[0] - body.x, dy = p[1] - body.y; return [c * dx + s * dy, -s * dx + c * dy]; };
          made = addDistanceJoint(world(), { a: A ? A.id : 0, b: Bb.id, la: local(A, pa), lb: local(Bb, pb), length: j.length ?? Math.hypot(pb[0] - pa[0], pb[1] - pa[1]), rope: j.kind === 'rope' });
        }
        made.jid = j.id; made.kind = j.kind; wake(Bb); if (A) wake(A);
        return j.id;
      },
      removeJoint(id) { const w = world(), n = w.joints.length; w.joints = w.joints.filter(j => j.jid !== id); return w.joints.length < n; },
      joints() {
        const { byId } = index(), rot = (b, p) => { if (!b) return p.slice(); const c = Math.cos(b.a), s = Math.sin(b.a); return [b.x + c * p[0] - s * p[1], b.y + s * p[0] + c * p[1]]; };
        return world().joints.map(j => { const A = j.a ? byId.get(j.a) : null, B = byId.get(j.b); return { id: j.jid, kind: j.kind || j.type, a: A?.ref ?? null, b: B?.ref ?? null, anchorA: rot(A, j.la), anchorB: rot(B, j.lb) }; });
      },
      setMotor(id, { speed, maxTorque, enabled } = {}) { const j = jointByRef(id); if (!j || j.type !== 'revolute') return false; if (speed !== undefined) j.speed = speed; if (maxTorque !== undefined) j.maxTorque = maxTorque; if (enabled !== undefined) j.motor = !!enabled; const B = index().byId.get(j.b); if (B) wake(B); return true; },
      jointAngle(id) { const j = jointByRef(id); if (!j || j.type !== 'revolute') return null; const { byId } = index(), A = j.a ? byId.get(j.a) : null, B = byId.get(j.b); return B.a - (A ? A.a : 0) - j.ref; },
      walls: () => world().bodies.filter(b => b.wall && !b.dead).map(b => ({ id: b.ref, kind: b.shape, at: [b.x, b.y], angle: b.a, r: b.r, points: b.verts ? b.verts.map(([x, y]) => { const c = Math.cos(b.a), s = Math.sin(b.a); return [b.x + c * x - s * y, b.y + s * x + c * y]; }) : null, sensor: b.sensor })),
      ...zoneEditor(rt, sid, zones, z => (Array.isArray(z.rect) && z.rect.length === 4 ? null : 'needs rect [x0,y0,x1,y1]'), rt => { for (const e of inSpace(rt, sid)) tracker.track(e, rt); }),
    };
    api.applyImpulse = api.impulse;
    rt.defineSpace(sid, api);
    world();

    // Declared bodies and joints.
    for (const d of config.bodies) {
      const base = rt.archetype(d.archetype)?.components?.body || {};
      rt.spawn(d.archetype || 'body', { id: d.id, space: sid, at: d.at.slice(), components: { body: { ...structuredClone(base), ...structuredClone(d.body || {}) } } });
    }
    for (const j of config.joints) api.addJoint(j, rt);
    rt.system('physics', rt => { syncIn(); stepWorld(world(), rt.dt); syncOut(rt); report(rt); }, sid);
  },
};
