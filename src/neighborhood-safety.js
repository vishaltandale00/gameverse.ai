import { certifiedSeparator, certifiedBounds, certifiedWorld } from './neighborhood-certified.generated.js';

// Audited runtime bridge, not part of Lean's kernel. The generated predicate is
// authoritative; normal selection and floating proposals can only cause rejection.
export const SAFETY_GRID = 65536;
export const SAFETY_MARGIN = 4 / SAFETY_GRID;
const MAX_GRID = 2147483648n, bits = new DataView(new ArrayBuffer(8));
const cache = new WeakMap();
const counters = { playerChecks: 0, cameraChecks: 0, rejectedProposals: 0, recoveries: 0 };
export function safetyObservations() { return { ...counters, grid: SAFETY_GRID, kernel: 'lean-separator-v1' }; }

// Decode the exact IEEE-754 dyadic value before rounding. No floating multiply,
// floor, sqrt or trig is used to decide clearance. ±32768m bounds make the final
// integer→Number→/2^16 conversion exact (at most 32 significant bits).
export function encodeGrid(value, mode = 'nearest') {
  if (typeof value !== 'number') throw new TypeError('Safety geometry must contain numbers.');
  bits.setFloat64(0, value, false);
  const raw = bits.getBigUint64(0, false), exponent = Number((raw >> 52n) & 2047n);
  if (exponent === 2047) throw new RangeError('Safety geometry must be finite.');
  let mantissa = raw & 4503599627370495n;
  if (exponent !== 0) mantissa |= 4503599627370496n;
  if (raw >> 63n) mantissa = -mantissa;
  const shift = exponent === 0 ? -1058 : exponent - 1059;
  let result;
  if (shift >= 0) result = mantissa << BigInt(shift);
  else {
    const denominator = 1n << BigInt(-shift);
    const quotient = mantissa / denominator, remainder = mantissa % denominator;
    const floor = quotient - (remainder < 0n ? 1n : 0n);
    const residual = mantissa - floor * denominator;
    result = mode === 'floor' ? floor : mode === 'ceil' ? floor + (residual > 0n ? 1n : 0n)
      : floor + (residual * 2n >= denominator ? 1n : 0n);
  }
  if (result < -MAX_GRID || result > MAX_GRID) throw new RangeError('Safety geometry exceeds the supported 32768 metre range.');
  return result;
}
const decode = value => Number(value) / SAFETY_GRID;
const point = p => [encodeGrid(p.x), encodeGrid(p.y ?? 0), encodeGrid(p.z)];
const unpoint = p => ({ x: decode(p[0]), y: decode(p[1]), z: decode(p[2]) });
const min = (a, b) => a < b ? a : b, max = (a, b) => a > b ? a : b;
const clamp = (n, lo, hi) => max(lo, min(n, hi));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a, b) => a.map((v, i) => v - b[i]);

function proxies(obstacles, isCamera) {
  const cached = cache.get(obstacles);
  if (cached?.isCamera === isCamera) return cached.boxes;
  const boxes = obstacles.map(b => {
    for (const [lo, hi] of [[b.minX, b.maxX], [b.minZ, b.maxZ], ...(isCamera ? [[b.minY ?? 0, b.maxY ?? 100]] : [])]) {
      if (typeof lo !== 'number' || typeof hi !== 'number' || !Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) throw new RangeError('Invalid collision proxy bounds.');
    }
    const low = [encodeGrid(b.minX, 'floor'), encodeGrid(isCamera ? b.minY ?? 0 : 0, 'floor'), encodeGrid(b.minZ, 'floor')];
    const high = [encodeGrid(b.maxX, 'ceil'), encodeGrid(isCamera ? b.maxY ?? 100 : 0, 'ceil'), encodeGrid(b.maxZ, 'ceil')];
    if (low.some((v, i) => v > high[i])) throw new RangeError('Invalid collision proxy bounds.');
    return [...low, ...high];
  });
  // Mutable test/adaptor geometry is always re-encoded. Frozen scene descriptors
  // are the only cacheable inputs, so edits cannot leave stale safety geometry.
  const immutable = Object.isFrozen(obstacles) && obstacles.every((box, index) =>
    Object.hasOwn(Object.getOwnPropertyDescriptor(obstacles, String(index)) || {}, 'value') &&
    Object.isFrozen(box) && Object.getPrototypeOf(box) === Object.prototype &&
    ['minX', 'maxX', 'minZ', 'maxZ', ...(isCamera ? ['minY', 'maxY'] : [])].every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(box, key);
      return descriptor ? Object.hasOwn(descriptor, 'value') : !isCamera || key === 'minY' || key === 'maxY';
    }));
  if (immutable) cache.set(obstacles, { isCamera, boxes });
  return boxes;
}

function separates(a, b, box, radius) {
  const query = [...a, ...b, ...box, radius, 0n, 0n, 0n];
  const check = n => {
    query[13] = n[0]; query[14] = n[1]; query[15] = n[2];
    return certifiedSeparator(query);
  };
  // Most street proxies are separated along one axis. This cheap witness choice
  // is NOT an acceptance shortcut: the generated checker still validates it.
  for (let i = 0; i < 3; i++) {
    const n = [0n, 0n, 0n];
    if (max(a[i], b[i]) + radius <= box[i]) { n[i] = -1n; if (check(n)) return query; }
    if (min(a[i], b[i]) - radius >= box[i + 3]) { n[i] = 1n; if (check(n)) return query; }
  }
  for (const p of [a, b]) if (check(p.map((v, i) => v - clamp(v, box[i], box[i + 3])))) return query;
  const delta = subtract(b, a), lengthSq = dot(delta, delta);
  // Edge/segment normals and corner/segment normals keep rounded grazing paths
  // useful. Completeness is deliberately not assumed; missing witnesses reject.
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3, k = (i + 2) % 3, n = [0n, 0n, 0n];
    n[j] = -delta[k]; n[k] = delta[j];
    if (check(n) || check(n.map(v => -v))) return query;
  }
  if (lengthSq > 0n) for (let corner = 0; corner < 8; corner++) {
    const vertex = [0, 1, 2].map(i => box[i + ((corner >> i) & 1) * 3]);
    const from = subtract(a, vertex), projection = dot(from, delta);
    if (check(from.map((v, i) => v * lengthSq - delta[i] * projection))) return query;
  }
  return false;
}

function segment(a, b, boxes, radius) {
  // Every real scene proxy needs a successful generated certificate. The loop
  // and exact proxy/argument correspondence are part of the audited JS bridge.
  const queries = [];
  for (const box of boxes) {
    const query = separates(a, b, box, radius);
    if (!query) return false;
    queries.push(query);
  }
  return certifiedWorld(queries);
}
function radiusGrid(radius) {
  if (!(radius > 0)) throw new RangeError('Safety radius must be positive.');
  return encodeGrid(radius, 'ceil');
}
function encodedBounds(bounds) {
  // Bounds round inward, obstacles/radii outward.
  return [encodeGrid(bounds.minX, 'ceil'), encodeGrid(bounds.maxX, 'floor'), encodeGrid(bounds.minZ, 'ceil'), encodeGrid(bounds.maxZ, 'floor')];
}
function within(p, r, b) { return certifiedBounds([p[0], p[2], r, ...b]); }

export function certifyPlayerMove(previous, proposed, obstacles, radius, bounds) {
  counters.playerChecks++;
  const a = point({ x: previous.x, y: 0, z: previous.z }), b = point({ x: proposed.x, y: 0, z: proposed.z }), boxes = proxies(obstacles, false), r = radiusGrid(radius), limits = encodedBounds(bounds);
  const poseSafe = p => within(p, r, limits) && segment(p, p, boxes, r);
  const accept = p => within(p, r, limits) && segment(a, p, boxes, r);
  // A full segment certificate already proves its start is outside every proxy;
  // separately recertifying that point on the successful path duplicates work.
  if (within(a, r, limits) && accept(b)) { const p = unpoint(b); return { x: p.x, z: p.z }; }
  const startsSafe = poseSafe(a);
  // A restored invalid pose has no swept-path guarantee; recovery must still end
  // in a certified safe pose, and failure returns no allegedly safe position.
  if (!startsSafe && poseSafe(b)) { counters.recoveries++; const p = unpoint(b); return { x: p.x, z: p.z }; }
  if (!startsSafe) throw new Error('No safe player pose could be certified. Reopen Gameverse to recover.');
  counters.rejectedProposals++;
  for (const p of [[b[0], a[1], a[2]], [a[0], a[1], b[2]]]) if (p.some((v, i) => v !== a[i]) && accept(p)) {
    const q = unpoint(p); return { x: q.x, z: q.z };
  }
  for (let divisor = 2n; divisor <= 1024n; divisor *= 2n) {
    const p = b.map((v, i) => a[i] + (v - a[i]) / divisor);
    if (accept(p)) { const q = unpoint(p); return { x: q.x, z: q.z }; }
  }
  const safe = unpoint(a); return { x: safe.x, z: safe.z };
}

export function certifyCameraPose(target, proposed, obstacles, radius, floor = 0.23) {
  counters.cameraChecks++;
  const a = point(target), b = point(proposed), boxes = proxies(obstacles, true), r = radiusGrid(radius), ground = encodeGrid(floor, 'ceil');
  const valid = p => p[1] - r >= ground && a[1] - r >= ground && segment(a, p, boxes, r);
  let selected = valid(b) ? b : null;
  if (!selected) {
    counters.rejectedProposals++;
    for (let divisor = 2n; divisor <= 1024n && !selected; divisor *= 2n) {
      const p = b.map((v, i) => a[i] + (v - a[i]) / divisor);
      if (valid(p)) selected = p;
    }
  }
  // Never render a rejected point or a zero-length lookAt. Existing scene failure
  // recovery catches this explicitly; reopening is preferable to wall clipping.
  if (!selected || selected.every((v, i) => v === a[i])) throw new Error('No safe camera pose could be certified. Reopen Gameverse to recover.');
  return { position: unpoint(selected), target: unpoint(a) };
}
