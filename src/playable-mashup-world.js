/** Bounded authored world/contact service, not a recovered original scene.
 * Coordinates: +x right, +y down, actor position is foot-center, Q8=256.
 * A simulation invocation is caller-owned; no original frame cadence is inferred.
 */
export const WORLD_POLICY_VERSION = 'authored-world-q8-v1';
export const Q8 = 256;
const I32_MIN = -2147483648, I32_MAX = 2147483647;
const integer = (value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${label} outside integer domain ${min}..${max}`);
  return value;
};
export const pixelToQ8 = value => integer(integer(value, -8388608, 8388607, 'pixel') * Q8, I32_MIN, I32_MAX, 'Q8');
export const q8ToPixel = value => Math.floor(integer(value, I32_MIN, I32_MAX, 'Q8') / Q8);
export function syncPosition(actor) {
  const x = q8ToPixel(actor.xQ8), y = q8ToPixel(actor.yQ8);
  actor.x = x; actor.y = y;
  return actor;
}
const rect = (value, width, height) => {
  const result = { ...value };
  integer(result.x, 0, width, 'rectangle x'); integer(result.y, 0, height, 'rectangle y');
  integer(result.width, 1, width, 'rectangle width'); integer(result.height, 1, height, 'rectangle height');
  if (result.x + result.width > width || result.y + result.height > height) throw new RangeError('rectangle outside world');
  return Object.freeze(result);
};
export function createWorld({ id = 'authored-world', width, height, tileSize = 16, solids = [], hazards = [], checkpoints = [], spawn } = {}) {
  integer(width, 16, 32767, 'world width'); integer(height, 16, 32767, 'world height');
  integer(tileSize, 1, 256, 'tile size');
  const point = value => {
    if (!value) throw new TypeError('world spawn/checkpoint required');
    integer(value.x, 0, width, 'point x'); integer(value.y, 0, height, 'point y');
    return Object.freeze({ ...value });
  };
  const points = checkpoints.map(point);
  if (points.some(p => typeof p.id !== 'string' || !p.id) || new Set(points.map(p => p.id)).size !== points.length) throw new TypeError('unique checkpoint ids required');
  return Object.freeze({ id, version: WORLD_POLICY_VERSION, width, height, tileSize, solids: Object.freeze(solids.map(r => rect(r, width, height))), hazards: Object.freeze(hazards.map(r => rect(r, width, height))), checkpoints: Object.freeze(points), spawn: point(spawn) });
}
/** World pixels and tile-local shape samples have distinct semantic domains.
 * Only 16px authored tiles map to the published Kirby shape1 index 0..255.
 * This selects a sample, not a claim about source displacement physical units.
 */
export function worldToShapeProbe(world, xQ8, yQ8) {
  if (world.tileSize !== 16) throw new RangeError('Kirby shape1 requires authored 16px tile mapping');
  const x = q8ToPixel(xQ8), y = q8ToPixel(yQ8);
  integer(x, 0, world.width - 1, 'probe x'); integer(y, 0, world.height - 1, 'probe y');
  const column = Math.floor(x / 16), row = Math.floor(y / 16), localX = x % 16, localY = y % 16;
  return Object.freeze({ column, row, localX, localY, index: localY * 16 + localX, selector: 1, quantity: 'flattened_16_by_16_shape_sample_index', frame: 'tile_local_shape_row', conversion: 'authored-positive-world-pixel-to-16px-cell' });
}
export function requireShapeProbe(probe) {
  if (probe?.quantity !== 'flattened_16_by_16_shape_sample_index' || probe?.frame !== 'tile_local_shape_row' || probe.selector !== 1) throw new TypeError('world coordinates cannot bind directly to a source shape index');
  return integer(probe.index, 0, 255, 'shape index');
}
const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const body = (x, y, halfWidth, height) => ({ left: x - halfWidth, right: x + halfWidth, top: y - height, bottom: y });
const edges = r => ({ left: r.x * Q8, right: (r.x + r.width) * Q8, top: r.y * Q8, bottom: (r.y + r.height) * Q8 });
/** Axis swept authored AABB contacts against complete rectangle geometry.
 * Call after source motion exactly once, using the pre-motion position. Source
 * velocities remain authoritative except normal velocity zeroed on contact.
 */
export function resolveTerrain(world, actor, previous, { halfWidth = 6, height = 14, maxDisplacementPixels = 64 } = {}) {
  integer(halfWidth, 1, 128, 'actor half width'); integer(height, 1, 256, 'actor height');
  integer(maxDisplacementPixels, 1, 1024, 'maximum displacement');
  if (halfWidth * 2 > world.width || height > world.height) throw new RangeError('actor dimensions exceed world');
  for (const state of [actor, previous]) for (const key of ['xQ8', 'yQ8']) integer(state[key], I32_MIN, I32_MAX, key);
  for (const key of ['vxQ8', 'vyQ8']) integer(actor[key], I32_MIN, I32_MAX, key);
  if (Math.abs(actor.xQ8 - previous.xQ8) > maxDisplacementPixels * Q8 || Math.abs(actor.yQ8 - previous.yQ8) > maxDisplacementPixels * Q8) throw new RangeError('motion exceeds contact sweep budget');
  const hw = halfWidth * Q8, h = height * Q8;
  let x = actor.xQ8, y = actor.yQ8, grounded = false, hitWall = false, hitCeiling = false;
  const old = body(previous.xQ8, previous.yQ8, hw, h);
  if (world.solids.some(r => overlap(old, edges(r)))) throw new RangeError('motion starts inside solid terrain; safe reset required');
  for (const solid of world.solids) {
    const r = edges(solid);
    if (old.top >= r.bottom || old.bottom <= r.top) continue;
    if (x > previous.xQ8 && old.right <= r.left && x + hw >= r.left) { x = Math.min(x, r.left - hw); hitWall = true; }
    if (x < previous.xQ8 && old.left >= r.right && x - hw <= r.right) { x = Math.max(x, r.right + hw); hitWall = true; }
  }
  if (x < hw || x > world.width * Q8 - hw) { x = Math.max(hw, Math.min(world.width * Q8 - hw, x)); hitWall = true; }
  // Select nearest crossed surface independent of geometry declaration order.
  for (const solid of world.solids) {
    const r = edges(solid);
    if (x + hw <= r.left || x - hw >= r.right) continue;
    if (y >= previous.yQ8 && old.bottom <= r.top && y >= r.top) { y = Math.min(y, r.top); grounded = true; }
    if (y < previous.yQ8 && old.top >= r.bottom && y - h <= r.bottom) { y = Math.max(y, r.bottom + h); hitCeiling = true; }
  }
  if (y < h) { y = h; hitCeiling = true; }
  const landed = grounded && !actor.grounded;
  actor.xQ8 = x; actor.yQ8 = y; actor.grounded = grounded;
  if (hitWall) actor.vxQ8 = 0;
  if (grounded || hitCeiling) actor.vyQ8 = 0;
  syncPosition(actor);
  const bounds = body(x, y, hw, h);
  // Hazards observe the same x-then-y swept path, so thin hazards cannot be
  // skipped by a bounded high-speed source integration invocation.
  const horizontalSweep = { left: Math.min(old.left, x - hw), right: Math.max(old.right, x + hw), top: old.top, bottom: old.bottom };
  const verticalSweep = { left: bounds.left, right: bounds.right, top: Math.min(old.top, bounds.top), bottom: Math.max(old.bottom, bounds.bottom) };
  const hazard = y > world.height * Q8 || world.hazards.some(r => { const e = edges(r); return overlap(horizontalSweep, e) || overlap(verticalSweep, e); });
  return { landed, grounded, hitWall, hitCeiling, hazard };
}
export function admitJump(actor, { pressed, speedQ8 = 1280 } = {}) {
  integer(speedQ8, 1, 32767, 'jump speed Q8');
  if (!pressed || !actor.grounded) return false;
  actor.vyQ8 = -speedQ8; actor.grounded = false;
  return true;
}
export function updateCamera(world, actor, camera) {
  const width = integer(camera.width, 1, 32767, 'camera width'), height = integer(camera.height, 1, 32767, 'camera height');
  // Pixel projection is floor, including negative intermediate actor positions.
  const x = q8ToPixel(actor.xQ8), y = q8ToPixel(actor.yQ8);
  camera.x = Math.max(0, Math.min(Math.max(0, world.width - width), x - Math.floor(width / 2)));
  camera.y = Math.max(0, Math.min(Math.max(0, world.height - height), y - Math.floor(height / 2)));
  return camera;
}
/** Checkpoint is an authored safe spawn; original SMA1 retry may provide integer
 * coordinates but its stale fixed backing is NEVER reused as coherent reentry.
 */
export function resetToCheckpoint(world, actor, camera, checkpointId = null, options = {}) {
  const checkpoint = checkpointId === null ? world.spawn : world.checkpoints.find(p => p.id === checkpointId);
  if (!checkpoint) throw new RangeError('unknown checkpoint');
  const next = { ...actor, xQ8: pixelToQ8(checkpoint.x), yQ8: pixelToQ8(checkpoint.y), vxQ8: 0, vyQ8: 0, grounded: false };
  const initialBounds = body(next.xQ8, next.yQ8, (options.halfWidth ?? 6) * Q8, (options.height ?? 14) * Q8);
  if (world.solids.some(r => overlap(initialBounds, edges(r)))) throw new RangeError('checkpoint intersects unsafe terrain');
  const contact = resolveTerrain(world, next, next, options);
  const hw = (options.halfWidth ?? 6) * Q8, h = (options.height ?? 14) * Q8;
  const bounds = body(next.xQ8, next.yQ8, hw, h);
  if (next.xQ8 !== checkpoint.x * Q8 || next.yQ8 !== checkpoint.y * Q8 || contact.hazard || world.solids.some(r => overlap(bounds, edges(r)))) throw new RangeError('checkpoint intersects unsafe terrain');
  const nextCamera = updateCamera(world, next, { ...camera });
  Object.assign(actor, next); Object.assign(camera, nextCamera);
  return { checkpointId, x: actor.x, y: actor.y, grounded: actor.grounded, authoredSceneReentry: true };
}
