// World coordinates are metres. Collision is deliberately independent of rendering.
export const WALK_SPEED = 2.35;
export const RUN_SPEED = 5.4;
export const PLAYER_RADIUS = 0.32;
export const WORLD_BOUNDS = { minX: -83, maxX: 83, minZ: -59, maxZ: 59 };
export const SPAWN = { x: -48, z: 10.5, yaw: -1.08, pitch: 0.24 };
export const FIRE_RED_ENTRANCE = Object.freeze({ x: -43, z: -19.8, radius: 2.8, gameId: 'firered', name: 'Alder Arcade' });

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

export function moveWithCollision(position, dx, dz, obstacles, radius = PLAYER_RADIUS, bounds = WORLD_BOUNDS) {
  const next = { x: position.x, z: position.z };
  // Substeps prevent tunnelling even when a frame stalls or a wall is thin.
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (radius * 0.5)));
  for (let step = 0; step < steps; step++) {
    next.x += dx / steps; next.z += dz / steps;
    for (let pass = 0; pass < 3; pass++) for (const obstacle of obstacles) resolveCircle(next, obstacle, radius);
    next.x = clamp(next.x, bounds.minX + radius, bounds.maxX - radius);
    next.z = clamp(next.z, bounds.minZ + radius, bounds.maxZ - radius);
  }
  return next;
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
