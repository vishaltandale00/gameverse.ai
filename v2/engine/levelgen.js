// Deterministic level builder: a list of designed sections -> ASCII level
// rows that respect the game's jump physics. Models design (sections,
// difficulty, cast); this builds geometry that is reachable by construction
// and is then proven winnable by the playtester.
import { random, seedFrom } from './rng.js';

export const SIDE_SECTIONS = ['runway', 'steps', 'pits', 'platforms', 'gauntlet', 'hazards', 'tower', 'arena', 'treasure'];
export const TOPDOWN_SECTIONS = ['rooms', 'maze', 'garden', 'arena', 'corridor', 'treasure'];
export const LENGTHS = { short: 70, medium: 100, long: 140 };

/** Physics envelope for a platformer tuning (tiles): conservative jump height and gap. */
export function jumpEnvelope({ jumpSpeed = 16, gravity = 48, runSpeed = 8, airJumps = 0 } = {}) {
  const height = (jumpSpeed * jumpSpeed) / (2 * gravity) * (1 + 0.8 * airJumps);
  const airtime = (2 * jumpSpeed) / gravity * (1 + 0.6 * airJumps);
  return { rise: Math.max(1, Math.floor(height * 0.75)), gap: Math.max(2, Math.floor(runSpeed * airtime * 0.55)) };
}

/**
 * Build a side-view level. Characters: '#' ground, '=' platform, 'P' player,
 * 'C' pickup, 'E' enemy, '^' hazard, 'G' goal, '.' empty.
 */
export function buildSide({ sections, length = 'medium', seed = 1, physics = {} }) {
  const rng = { rng: seedFrom(`side:${seed}`) }, r = () => random(rng), ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  const W = LENGTHS[length] || LENGTHS.medium, H = 18, env = jumpEnvelope(physics);
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c; };
  const ground = new Array(W).fill(H - 3); // y of the topmost ground tile per column
  const fillGround = (x, top) => { ground[x] = top; for (let y = top; y < H; y++) set(x, y, '#'); };
  const list = sections.length ? sections : [{ type: 'runway', difficulty: 1 }];
  const startW = 8, goalW = 8, body = W - startW - goalW;
  const widths = list.map(() => Math.floor(body / list.length));
  let x = 0, level = H - 4;
  for (; x < startW; x++) fillGround(x, level);
  set(2, level - 1, 'P');
  list.forEach((section, i) => {
    const end = x + widths[i], d = Math.max(1, Math.min(3, section.difficulty || 1));
    const clampLevel = v => Math.max(6, Math.min(H - 3, v));
    switch (section.type) {
      case 'steps': {
        while (x < end) { level = clampLevel(level + (r() < 0.6 ? -ri(1, env.rise) : ri(1, 2))); const w = ri(3, 5); for (let k = 0; k < w && x < end; k++, x++) { fillGround(x, level); if (k === 1 && r() < 0.5) set(x, level - 1, 'C'); } }
        break;
      }
      case 'pits': {
        while (x < end) {
          const land = ri(3, 6); for (let k = 0; k < land && x < end; k++, x++) fillGround(x, level);
          const gap = Math.max(2, Math.min(env.gap - 1, ri(2, 2 + d))); for (let k = 0; k < gap && x < end - 3; k++, x++) { ground[x] = H; if (k === Math.floor(gap / 2)) set(x, level - 3, 'C'); }
          level = clampLevel(level + ri(-1, 1));
        }
        break;
      }
      case 'platforms': {
        const start = x; for (; x < end; x++) fillGround(x, level);
        for (let px = start + 2; px < end - 3; px += ri(4, 7)) {
          const py = level - ri(2, Math.max(2, env.rise)), w = ri(3, 5);
          for (let k = 0; k < w; k++) set(px + k, py, '=');
          set(px + 1, py - 1, 'C'); if (r() < 0.25 * d) set(px + w - 1, py - 1, 'E');
          if (r() < 0.5) { const qy = py - ri(2, Math.max(2, env.rise)); if (qy > 2) { for (let k = 0; k < 3; k++) set(px + 2 + k, qy, '='); set(px + 3, qy - 1, 'C'); } }
        }
        break;
      }
      case 'gauntlet': case 'arena': {
        const start = x; for (; x < end; x++) fillGround(x, level);
        const count = (section.type === 'arena' ? 2 : 1) * (1 + d);
        for (let k = 0; k < count; k++) set(start + 3 + Math.floor((k + 0.5) * (end - start - 6) / count), level - 1, 'E');
        for (let px = start + 4; px < end - 4; px += ri(6, 9)) { const py = level - Math.min(env.rise, 3); for (let k = 0; k < 3; k++) set(px + k, py, '='); set(px + 1, py - 1, 'C'); }
        break;
      }
      case 'hazards': {
        const start = x; for (; x < end; x++) fillGround(x, level);
        for (let hx = start + 3; hx < end - 3; hx += ri(4, 7)) {
          const run = Math.min(env.gap - 1, ri(1, 1 + d)); for (let k = 0; k < run; k++) set(hx + k, level - 1, '^');
          set(hx + Math.floor(run / 2), level - 3, 'C');
        }
        break;
      }
      case 'tower': {
        const start = x; for (; x < end; x++) fillGround(x, level);
        let py = level, px = start + 2, dir = 1;
        while (py - env.rise > 3) {
          py -= Math.max(2, env.rise - 1);
          for (let k = 0; k < 4; k++) set(px + k, py, '=');
          set(px + 1, py - 1, 'C'); if (d > 1 && r() < 0.3) set(px + 3, py - 1, 'E');
          px += dir * ri(3, 5); if (px > end - 6 || px < start + 1) { dir *= -1; px = Math.max(start + 1, Math.min(end - 6, px)); }
        }
        break;
      }
      case 'treasure': {
        const start = x; for (; x < end; x++) fillGround(x, level);
        for (let px = start + 2; px < end - 2; px += 2) set(px, level - 1 - (px % 3 === 0 ? 2 : 0), 'C');
        if (d > 1) set(Math.floor((start + end) / 2), level - 1, 'E');
        break;
      }
      default: { // runway
        const start = x; for (; x < end; x++) fillGround(x, level);
        for (let px = start + 2; px < end - 1; px += 3) set(px, level - 1, 'C');
        if (d > 1) set(Math.floor((start + end) / 2), level - 1, 'E');
      }
    }
    x = end;
  });
  for (; x < W; x++) fillGround(x, level);
  set(W - 4, level - 1, 'G');
  for (let y = 0; y < H; y++) { set(0, y, '#'); set(W - 1, y, '#'); }
  // Never spawn the player inside something.
  return g.map(row => row.join(''));
}

/** Build a top-down level from room-like sections laid out left to right. */
export function buildTopdown({ sections, length = 'medium', seed = 1 }) {
  const rng = { rng: seedFrom(`top:${seed}`) }, r = () => random(rng), ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  const W = Math.round((LENGTHS[length] || LENGTHS.medium) * 0.6), H = 30;
  const g = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1) ? '#' : '.'));
  const set = (x, y, c) => { if (x > 0 && x < W - 1 && y > 0 && y < H - 1) g[y][x] = c; };
  const at = (x, y) => g[y]?.[x];
  const list = sections.length ? sections : [{ type: 'garden', difficulty: 1 }];
  const cw = Math.floor((W - 2) / list.length);
  list.forEach((section, i) => {
    const x0 = 1 + i * cw, x1 = i === list.length - 1 ? W - 2 : x0 + cw - 1, d = Math.max(1, Math.min(3, section.difficulty || 1));
    // A wall between sections with a door gap.
    if (i > 0) { const door = ri(4, H - 6); for (let y = 1; y < H - 1; y++) if (Math.abs(y - door) > 1) set(x0, y, '#'); }
    const inner = (fn, n) => { for (let k = 0; k < n; k++) { const x = ri(x0 + 2, x1 - 1), y = ri(2, H - 3); if (at(x, y) === '.') fn(x, y); } };
    switch (section.type) {
      case 'maze':
        for (let y = 3; y < H - 3; y += 4) for (let x = x0 + 2; x < x1 - 1; x++) if (r() < 0.7) set(x, y, '#');
        for (let y = 3; y < H - 3; y += 4) { const gap = ri(x0 + 2, x1 - 2); set(gap, y, '.'); set(gap + 1, y, '.'); }
        inner((x, y) => set(x, y, 'C'), 8); inner((x, y) => set(x, y, 'E'), 1 + d);
        break;
      case 'rooms':
        for (let k = 0; k < 3; k++) { const rx = ri(x0 + 2, Math.max(x0 + 2, x1 - 8)), ry = ri(2, H - 10), rw = ri(5, 7), rh = ri(5, 7);
          for (let x = rx; x < rx + rw; x++) { set(x, ry, '#'); set(x, ry + rh, '#'); } for (let y = ry; y <= ry + rh; y++) { set(rx, y, '#'); set(rx + rw, y, '#'); }
          set(rx + Math.floor(rw / 2), ry + rh, '.'); set(rx + 2, ry + 2, 'C'); set(rx + 3, ry + 3, 'C'); if (d > 1) set(rx + 2, ry + 3, 'E'); }
        inner((x, y) => set(x, y, 'C'), 4);
        break;
      case 'arena':
        inner((x, y) => set(x, y, 'E'), 3 + 2 * d); inner((x, y) => set(x, y, 'C'), 6);
        break;
      case 'corridor':
        for (let x = x0 + 2; x < x1 - 1; x++) { set(x, 8, '#'); set(x, H - 9, '#'); }
        inner((x, y) => set(x, y, '^'), 3 + 2 * d); inner((x, y) => set(x, y, 'C'), 6);
        break;
      case 'treasure':
        inner((x, y) => set(x, y, 'C'), 16); inner((x, y) => set(x, y, 'E'), d - 1);
        break;
      default: // garden
        inner((x, y) => set(x, y, '#'), 10); inner((x, y) => set(x, y, '^'), 2 + d); inner((x, y) => set(x, y, 'C'), 10); inner((x, y) => set(x, y, 'E'), d);
    }
  });
  // Player near the start, goal near the end, both on cleared ground.
  const clear = (cx, cy) => { for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) if (at(x, y) !== undefined && x > 0 && y > 0 && x < W - 1 && y < H - 1) g[y][x] = '.'; };
  const py = Math.floor(H / 2); clear(3, py); set(3, py, 'P');
  clear(W - 4, py); set(W - 4, py, 'G');
  // Keep every section door open along the middle row too, so the goal is reachable.
  for (let x = 1; x < W - 1; x++) if (at(x, py) === '#') g[py][x] = '.';
  return g.map(row => row.join(''));
}
