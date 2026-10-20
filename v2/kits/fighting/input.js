// Input history and motion parsing. The host gives held input {x, y, a, b}; each fighter keeps a
// ring of the last BUF frames, packed as numbers (plain JSON for saves). Motions are read from
// that history relative to the fighter's current facing, in numpad notation (6 = forward,
// 2 = down, 3 = down-forward, 8 = up ...), with leniency windows so they feel arcade-fair.
export const BUF = 40;
export const CHARGE = 40;          // frames of back/down hold for a charge move
export const CHARGE_GRACE = 10;    // frames the charge is remembered after releasing it
export const PRESS_BUFFER = 4;     // a press this recent still triggers a move from neutral
export const CANCEL_BUFFER = 10;   // ... or a cancel (covers hit-stop)

/** Absolute numpad direction from held input (y: -1 up, 1 down). */
export const numpad = (x, y) => 5 + (x | 0) - 3 * (y | 0);
/** Mirror a numpad direction for a fighter facing left. */
export const mirror = d => d % 3 === 1 ? d + 2 : d % 3 === 0 ? d - 2 : d;
export const rel = (d, facing) => facing < 0 ? mirror(d) : d;

const A = 16, B = 32, PA = 64, PB = 128;
export function pack(input, prev) {
  const a = !!input.a, b = !!input.b;
  return numpad(Math.sign(input.x || 0), Math.sign(input.y || 0)) | (a ? A : 0) | (b ? B : 0) | (a && !prev?.a ? PA : 0) | (b && !prev?.b ? PB : 0);
}
export const dirOf = v => v & 15;
export const pressA = v => !!(v & PA), pressB = v => !!(v & PB), holdA = v => !!(v & A), holdB = v => !!(v & B);

/** Record this frame's input; returns the packed value. */
export function record(f, input) {
  const v = pack(input, f.prev);
  f.buf.push(v); if (f.buf.length > BUF) f.buf.shift();
  f.n++;
  f.prev = { x: input.x | 0, y: input.y | 0, a: !!input.a, b: !!input.b };
  const d = rel(dirOf(v), f.facing);
  const ch = f.charge;
  if (d === 1 || d === 4 || d === 7) ch.b++; else { if (ch.b >= CHARGE) ch.bm = CHARGE_GRACE; ch.b = 0; }
  if (d === 1 || d === 2 || d === 3) ch.d++; else { if (ch.d >= CHARGE) ch.dm = CHARGE_GRACE; ch.d = 0; }
  if (ch.bm > 0 && !(d === 1 || d === 4 || d === 7)) ch.bm--;
  if (ch.dm > 0 && !(d === 1 || d === 2 || d === 3)) ch.dm--;
  return v;
}

const SETS = {
  2: [2], 3: [3], 6: [6], 4: [4], 1: [1], 8: [8, 7, 9],
  down: [1, 2, 3], fwd: [6, 9], fwdish: [3, 6, 9], back: [4, 7], backish: [1, 4, 7], up: [7, 8, 9],
  notDown: [4, 5, 6, 7, 8, 9], notFwd: [1, 2, 4, 5, 7, 8], notBack: [2, 3, 5, 6, 8, 9], dpStart: [6, 3], rdpStart: [4, 1],
};
// Each motion: steps in order (sets of relative directions) and the frame window from first step to press.
export const MOTIONS = {
  qcf: { steps: ['2', '3', 'fwd'], window: 16 },
  qcb: { steps: ['2', '1', 'back'], window: 16 },
  // A dragon punch must not end in a plain forward (that is a quarter circle after walking forward).
  dp: { steps: ['dpStart', 'down', '3'], window: 18, last: 3, noAfter: [6] },
  rdp: { steps: ['rdpStart', 'down', '1'], window: 18, last: 3, noAfter: [4] },
  hcf: { steps: ['back', '1', '2', 'fwd'], window: 24 },
  hcb: { steps: ['fwd', '3', '2', 'back'], window: 24 },
  qcf2: { steps: ['2', '3', 'fwd', '2', '3', 'fwd'], window: 32 },
  'tap-dd': { steps: ['down', 'notDown', 'down'], window: 16 },
  'tap-bf': { steps: ['back', 'notBack', 'fwd'], window: 12 },
};

/** Index of the most recent unconsumed press of `button` ('a', 'b' or 'any') within `within` frames. */
export function recentPress(f, button, within) {
  const n = f.buf.length;
  for (let i = n - 1; i >= Math.max(0, n - within); i--) {
    const abs = f.n - (n - 1 - i);
    if (abs <= f.consumed) return -1;
    const v = f.buf[i];
    if ((button === 'a' || button === 'any') && pressA(v)) return i;
    if ((button === 'b' || button === 'any') && pressB(v)) return i;
  }
  return -1;
}
/** Which button(s) the press at index i used. */
export const pressedAt = (f, i) => (pressA(f.buf[i]) ? 'a' : '') + (pressB(f.buf[i]) ? 'b' : '');
export function consume(f, i) { f.consumed = f.n - (f.buf.length - 1 - i); }

/** Does the buffer hold `motion` ending at or before press index `pi`? */
export function hasMotion(f, motion, pi) {
  if (motion === 'charge-bf' || motion === 'charge-du') {
    const ch = f.charge, d = rel(dirOf(f.buf[pi]), f.facing);
    // The charge was released at most CHARGE_GRACE frames ago (bm/dm) or is still being held this frame.
    if (motion === 'charge-bf') return SETS.fwdish.includes(d) && (ch.bm > 0 || ch.b >= CHARGE);
    return SETS.up.includes(d) && (ch.dm > 0 || ch.d >= CHARGE);
  }
  const m = MOTIONS[motion];
  if (!m) return false;
  let at = pi, steps = m.steps;
  // The last direction may come up to 6 frames before the press (or on the press frame).
  for (let s = steps.length - 1; s >= 0; s--) {
    const set = SETS[steps[s]];
    const limit = s === steps.length - 1 ? Math.max(0, pi - (m.last ?? 6)) : Math.max(0, pi - m.window);
    let found = -1;
    for (let i = at; i >= limit; i--) if (set.includes(rel(dirOf(f.buf[i]), f.facing))) { found = i; break; }
    if (found < 0) return false;
    if (s === steps.length - 1 && m.noAfter) for (let i = found + 1; i <= pi; i++) if (m.noAfter.includes(rel(dirOf(f.buf[i]), f.facing))) return false;
    at = found - 1;
    if (at < 0 && s > 0) return false;
  }
  return pi - (at + 1) <= m.window;
}

/** A double tap of a direction ('fwd' | 'back') that completes on this frame. */
export function doubleTap(f, which) {
  const n = f.buf.length, want = which === 'fwd' ? 6 : 4;
  const d = i => rel(dirOf(f.buf[i]), f.facing);
  if (n < 3 || d(n - 1) !== want || d(n - 2) === want) return false;
  for (let i = n - 2, gap = false; i >= Math.max(0, n - 12); i--) {
    if (d(i) !== want) gap = true;
    else if (gap) return true;
  }
  return false;
}

/** True if a and b were both pressed within 3 frames of each other (the latest press unconsumed). */
export function pressedBoth(f) {
  const ia = recentPress(f, 'a', 3), ib = recentPress(f, 'b', 3);
  return ia >= 0 && ib >= 0 && (ia === f.buf.length - 1 || ib === f.buf.length - 1);
}

// ---------- canonical sequences (CPU macros and verification) ----------
// Frames of [relX, y, a, b]; relX +1 means toward where the fighter faces.
const hold = (n, x, y) => Array.from({ length: n }, () => [x, y, 0, 0]);
export function motionFrames(motion, button) {
  const A = button === 'a' ? 1 : 0, B = button === 'b' ? 1 : 0, p = (x, y) => [x, y, A, B];
  switch (motion) {
    case 'qcf': return [[0, 1, 0, 0], [1, 1, 0, 0], p(1, 0)];
    case 'qcb': return [[0, 1, 0, 0], [-1, 1, 0, 0], p(-1, 0)];
    case 'dp': return [[1, 0, 0, 0], [0, 1, 0, 0], p(1, 1)];
    case 'rdp': return [[-1, 0, 0, 0], [0, 1, 0, 0], p(-1, 1)];
    case 'hcf': return [[-1, 0, 0, 0], [-1, 1, 0, 0], [0, 1, 0, 0], [1, 1, 0, 0], p(1, 0)];
    case 'hcb': return [[1, 0, 0, 0], [1, 1, 0, 0], [0, 1, 0, 0], [-1, 1, 0, 0], p(-1, 0)];
    case 'qcf2': return [[0, 1, 0, 0], [1, 1, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [1, 1, 0, 0], p(1, 0)];
    case 'charge-bf': return [...hold(CHARGE + 4, -1, 1), p(1, 0)];
    case 'charge-du': return [...hold(CHARGE + 4, 0, 1), p(0, -1)];
    case 'tap-dd': return [[0, 1, 0, 0], [0, 0, 0, 0], p(0, 1)];
    case 'tap-bf': return [[-1, 0, 0, 0], [0, 0, 0, 0], p(1, 0)];
    default: return [p(0, 0)];
  }
}
/** Turn a relative frame into held input for a fighter facing `facing`. */
export const toInput = ([x, y, a, b], facing) => ({ x: x * facing, y, a: !!a, b: !!b });
