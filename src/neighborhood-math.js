import { certifyPlayerMove, SAFETY_MARGIN } from './neighborhood-safety.js';

// World coordinates are metres. Collision is deliberately independent of rendering.
export const WALK_SPEED = 2.35;
export const RUN_SPEED = 5.4;
export const PLAYER_RADIUS = 0.32;
export const WORLD_BOUNDS = { minX: -83, maxX: 83, minZ: -59, maxZ: 59 };
export const SPAWN = { x: -48, z: 10.5, yaw: -1.08, pitch: 0.24 };
export const FIRE_RED_ENTRANCE = Object.freeze({ x: -43, z: -19.8, radius: 2.8, gameId: 'firered', name: 'Alder Arcade' });

// The arcade door/frame projects in front of the structural building. Keep its
// walkable facade envelope explicit so camera and player use the same surface.
export const ARCADE_FRONTAGE = Object.freeze({ minX: -54.5, maxX: -31.5, minZ: -22, maxZ: -21.42, minY: 0, maxY: 3.2 });

export function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
export function angleDelta(from, to) { return Math.atan2(Math.sin(to - from), Math.cos(to - from)); }

export function cameraRelativeInput(side, forward, yaw) {
  const length = Math.hypot(side, forward);
  if (length === 0) return { x: 0, z: 0 };
  const scale = 1 / Math.max(1, length);
  return { x: (Math.cos(yaw) * side - Math.sin(yaw) * forward) * scale,
    z: (-Math.sin(yaw) * side - Math.cos(yaw) * forward) * scale };
}

function resolveCircle(position, obstacle, radius) {
  const nearX = clamp(position.x, obstacle.minX, obstacle.maxX);
  const nearZ = clamp(position.z, obstacle.minZ, obstacle.maxZ);
  let dx = position.x - nearX, dz = position.z - nearZ;
  const distance = Math.hypot(dx, dz);
  if (distance >= radius) return;
  if (distance > 0.00001) {
    position.x += dx / distance * (radius - distance);
    position.z += dz / distance * (radius - distance);
  } else {
    // Also recovers an invalid pose inside a wall instead of leaving the player stuck.
    const sides = [
      { d: position.x - obstacle.minX, x: obstacle.minX - radius, z: position.z },
      { d: obstacle.maxX - position.x, x: obstacle.maxX + radius, z: position.z },
      { d: position.z - obstacle.minZ, x: position.x, z: obstacle.minZ - radius },
      { d: obstacle.maxZ - position.z, x: position.x, z: obstacle.maxZ + radius },
    ].sort((a, b) => a.d - b.d);
    position.x = sides[0].x; position.z = sides[0].z;
  }
}

// Exact sweep against a rounded rectangle: flat faces plus the four circular
// corners. Expanding to a square alone catches empty corner space and feels sticky.
function sweepCircle(position, dx, dz, box, radius) {
  let hit = null;
  const accept = (time, nx, nz) => {
    if (time < -1e-8 || time > 1 || dx * nx + dz * nz >= -1e-10) return;
    if (!hit || time < hit.time) hit = { time: Math.max(0, time), nx, nz };
  };
  if (Math.abs(dx) > 1e-10) {
    const nx = dx > 0 ? -1 : 1, edge = dx > 0 ? box.minX - radius : box.maxX + radius;
    const time = (edge - position.x) / dx, z = position.z + dz * time;
    if (z >= box.minZ && z <= box.maxZ) accept(time, nx, 0);
  }
  if (Math.abs(dz) > 1e-10) {
    const nz = dz > 0 ? -1 : 1, edge = dz > 0 ? box.minZ - radius : box.maxZ + radius;
    const time = (edge - position.z) / dz, x = position.x + dx * time;
    if (x >= box.minX && x <= box.maxX) accept(time, 0, nz);
  }
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq > 1e-16) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx < 0 ? box.minX : box.maxX, z = sz < 0 ? box.minZ : box.maxZ;
    const ox = position.x - x, oz = position.z - z;
    const b = ox * dx + oz * dz, c = ox * ox + oz * oz - radius * radius;
    const discriminant = b * b - lengthSq * c;
    if (discriminant < 0) continue;
    const time = (-b - Math.sqrt(discriminant)) / lengthSq;
    const hx = ox + dx * time, hz = oz + dz * time;
    if (hx * sx >= -1e-8 && hz * sz >= -1e-8) accept(time, hx / radius, hz / radius);
  }
  return hit;
}

function overlaps(position, box, radius) {
  return Math.hypot(position.x - clamp(position.x, box.minX, box.maxX),
    position.z - clamp(position.z, box.minZ, box.maxZ)) < radius - 1e-7;
}

export function proposeMoveWithCollision(position, dx, dz, obstacles, radius = PLAYER_RADIUS, bounds = WORLD_BOUNDS) {
  const next = { x: position.x, z: position.z };
  const confine = point => {
    point.x = clamp(point.x, bounds.minX + radius, bounds.maxX - radius);
    point.z = clamp(point.z, bounds.minZ + radius, bounds.maxZ - radius);
  };
  confine(next);
  // Recovery is separate from motion so a restored/edited embedded pose can leave
  // overlapping tree/planter proxies, including at the world edge.
  for (let pass = 0; pass < 8 && obstacles.some(box => overlaps(next, box, radius)); pass++) {
    for (const box of obstacles) resolveCircle(next, box, radius);
    confine(next);
  }
  if (obstacles.some(box => overlaps(next, box, radius))) {
    const candidates = [];
    for (const box of obstacles) {
      for (const x of [box.minX - radius, box.maxX + radius]) candidates.push({ x, z: next.z });
      for (const z of [box.minZ - radius, box.maxZ + radius]) candidates.push({ x: next.x, z });
    }
    candidates.forEach(confine);
    candidates.sort((a, b) => Math.hypot(a.x - position.x, a.z - position.z) - Math.hypot(b.x - position.x, b.z - position.z));
    const valid = candidates.find(point => !obstacles.some(box => overlaps(point, box, radius)));
    if (valid) Object.assign(next, valid);
  }
  // At most six contacts; long frame steps cost the same as short ones. Every
  // contact consumes its incoming component and preserves tangential movement.
  for (let iteration = 0; iteration < 6 && Math.hypot(dx, dz) > 1e-8; iteration++) {
    let time = 1, contacts = [];
    const collect = hit => {
      if (!hit || hit.time > time + 1e-8) return;
      if (hit.time < time - 1e-8) { time = hit.time; contacts = []; }
      contacts.push(hit);
    };
    for (const box of obstacles) collect(sweepCircle(next, dx, dz, box, radius));
    for (const [axis, delta, low, high] of [['x', dx, bounds.minX + radius, bounds.maxX - radius], ['z', dz, bounds.minZ + radius, bounds.maxZ - radius]]) {
      if (Math.abs(delta) < 1e-10) continue;
      const t = ((delta > 0 ? high : low) - next[axis]) / delta;
      if (t >= 0 && t <= 1) collect({ time: t, nx: axis === 'x' ? -Math.sign(delta) : 0, nz: axis === 'z' ? -Math.sign(delta) : 0 });
    }
    next.x += dx * time; next.z += dz * time;
    dx *= 1 - time; dz *= 1 - time;
    if (!contacts.length) break;
    for (const contact of contacts) {
      const inward = Math.min(0, dx * contact.nx + dz * contact.nz);
      dx -= inward * contact.nx; dz -= inward * contact.nz;
    }
  }
  confine(next);
  return next;
}

// The floating sweep is a proposal. Only the exact generated certificate guard
// can commit its result; a small geometric margin absorbs outward grid rounding.
export function moveWithCollision(position, dx, dz, obstacles, radius = PLAYER_RADIUS, bounds = WORLD_BOUNDS) {
  const proposed = proposeMoveWithCollision(position, dx, dz, obstacles, radius + SAFETY_MARGIN, bounds);
  return certifyPlayerMove(position, proposed, obstacles, radius, bounds);
}

// Retraction is immediate for safety. Release is exponential, so stepping out
// from a lamppost/wall never makes the camera jump back to its full boom length.
export function smoothCameraDistance(current, safe, dt) {
  return safe < current ? safe : current + (safe - current) * (1 - Math.exp(-Math.max(0, dt) * 4.5));
}

// Swept camera sphere vs. expanded boxes. Returns safe distance along the boom.
export function cameraDistance(target, direction, desired, obstacles, radius = 0.25) {
  let nearest = desired;
  for (const box of obstacles) {
    let enter = 0, leave = desired;
    let intersects = true;
    for (const [axis, minKey, maxKey] of [['x', 'minX', 'maxX'], ['y', 'minY', 'maxY'], ['z', 'minZ', 'maxZ']]) {
      const low = (box[minKey] ?? 0) - radius, high = (box[maxKey] ?? 100) + radius;
      if (Math.abs(direction[axis]) < 1e-8) {
        if (target[axis] < low || target[axis] > high) { intersects = false; break; }
      } else {
        const a = (low - target[axis]) / direction[axis], b = (high - target[axis]) / direction[axis];
        enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
        if (enter > leave) { intersects = false; break; }
      }
    }
    if (intersects && leave >= 0) nearest = Math.min(nearest, Math.max(0.12, enter - 0.04));
  }
  return nearest;
}
