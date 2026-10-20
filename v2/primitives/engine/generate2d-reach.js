// Movement-model reachability on a role raster, used by 2D generators to PROVE
// "traversable with abilities X" at generation time. Rasters are y-up (row 0 is
// the bottom), cells hold ROLE values. Out of bounds is solid.
//
// Side view (platformer): a player stands on a passable cell over solid ground,
// a ladder, one-way platform, wall (climb/wallJump) or in water (swim). It walks,
// falls straight down, and jumps along parabolic arcs: with jump height h and
// jump distance D (landing at the same height), at horizontal speed k·max the
// arc is y(s) = 4h·(s/kD)·(1 − s/kD); k ∈ {1, ¾, ½, ¼, 0}. Every swept cell must
// be passable; descending arcs land on the first standable cell. This is
// conservative (no air steering beyond the sampled speeds), so a proof here
// holds in a real platformer with those tunables.
// Top-down: 4-neighbour moves through passable cells (water with swim; fly
// crosses water and hazards).
export const ROLE = { EMPTY: 0, SOLID: 1, HAZARD: 2, WATER: 3, LADDER: 4, ONEWAY: 5 };
const { EMPTY, SOLID, HAZARD, WATER, LADDER, ONEWAY } = ROLE;

/** Movement tunables in tiles, matching the tilemap space's ability names. */
export const BASE_MOVEMENT = { jumpHeight: 3, jumpDistance: 4, doubleJump: false, dash: 0, climb: false, wallJump: false, swim: false, fly: false };
/** Common ability names → movement deltas (numbers add, booleans OR). Documents may extend or override. */
export const ABILITY_EFFECTS = {
  double_jump: { doubleJump: true }, doublejump: { doubleJump: true }, high_jump: { jumpHeight: 2 }, dash: { dash: 3 }, air_dash: { dash: 3 },
  glide: { jumpDistance: 4 }, climb: { climb: true }, wall_climb: { climb: true }, wall_jump: { wallJump: true }, wallJump: { wallJump: true },
  swim: { swim: true }, dive: { swim: true }, fly: { fly: true }, flight: { fly: true },
};

/** Movement for a set of abilities: base + each ability's deltas from `table` (then the built-in names). */
export function movementFor(base = {}, abilities = [], table = {}) {
  const m = { ...BASE_MOVEMENT, ...base };
  for (const a of abilities) {
    const d = table[a] ?? ABILITY_EFFECTS[a]; if (!d) continue;
    for (const [k, v] of Object.entries(d)) m[k] = typeof v === 'number' ? (m[k] ?? 0) + v : Boolean(m[k]) || Boolean(v);
  }
  const h = m.doubleJump ? m.jumpHeight * 2 - 1 : m.jumpHeight;
  return { ...m, h: Math.max(0, h), D: Math.max(0, m.jumpDistance * (m.doubleJump ? 1.5 : 1) + (m.dash || 0)) };
}

const SPEEDS = [1, 0.75, 0.5, 0.25];

/**
 * Reachability on a side-view raster. starts: [{x, y, launch?}] — a start
 * lands by falling unless `launch` (a virtual foothold: jump from it as if
 * standing, e.g. entering through a floor hole). goals: Map(index → id).
 * Returns { nodes: Set<index>, hit: Set<goalId> }.
 */
export function reachSide(grid, m, starts, goals = new Map()) {
  const { w, h: H } = grid;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= H ? SOLID : grid.cells[y * w + x]);
  const passable = (x, y) => { const c = at(x, y); return c === EMPTY || c === LADDER || c === ONEWAY || c === WATER; };
  const solid = (x, y) => at(x, y) === SOLID;
  const support = (x, y) => { const c = at(x, y - 1); return c === SOLID || c === ONEWAY || c === LADDER; };
  const clingy = (x, y) => (m.climb || m.wallJump) && (solid(x - 1, y) || solid(x + 1, y));
  const standable = (x, y) => passable(x, y) && (m.fly || support(x, y) || at(x, y) === LADDER || (m.swim && at(x, y) === WATER) || clingy(x, y));
  const nodes = new Set(), hit = new Set(), queue = [];
  const touch = (x, y) => { const g = goals.get(y * w + x); if (g !== undefined) hit.add(g); };
  const add = (x, y) => { const i = y * w + x; touch(x, y); if (!nodes.has(i)) { nodes.add(i); queue.push(i); } };
  /** Drop from a passable cell to the first standable one below (touching cells on the way). */
  const fall = (x, y) => { while (y >= 0 && passable(x, y)) { touch(x, y); if (standable(x, y)) return add(x, y); y--; } };
  /** Trace jump arcs from (x, y) in direction dir at each sampled speed. */
  const jump = (x, y) => {
    if (m.h <= 0) return;
    // Straight up: every cell of the column, landing on any foothold (ledge, ladder, wall) on the way.
    for (let a = 1; a <= m.h && passable(x, y + a); a++) { touch(x, y + a); if (standable(x, y + a)) add(x, y + a); }
    for (const dir of [-1, 1]) for (const k of SPEEDS) {
      const span = k * m.D; if (span <= 0) continue;
      const height = s => 4 * m.h * (s / span) * (1 - s / span);
      // Column i holds the arc for s in [i - ½, i + ½] (column 0 from s = 0).
      for (let i = 0; ; i++) {
        const cx = x + dir * i, sa = Math.max(0, i - 0.5), sb = i + 0.5;
        const ends = [height(sa), height(sb)]; if (sa < span / 2 && sb > span / 2) ends.push(m.h);
        const lo = Math.min(...ends), hi = Math.max(...ends), descending = sb > span / 2;
        if (y + hi < -1) break;
        let stop = false;
        const cells = []; for (let dy = Math.floor(lo); dy <= Math.floor(hi); dy++) cells.push(dy);
        if (descending) cells.reverse(); // feet sweep downward: the first foothold met is the landing
        for (const [n, dy] of cells.entries()) {
          const cy = y + dy;
          // Blocked: a landing only if the feet came down onto it inside this column (not into a wall face).
          if (!passable(cx, cy)) { stop = true; if (descending && n > 0 && standable(cx, cy + 1)) add(cx, cy + 1); break; }
          touch(cx, cy);
          if (descending && i > 0 && standable(cx, cy)) { add(cx, cy); stop = true; break; }
        }
        if (stop) break;
      }
    }
  };
  for (const s of starts) { if (s.launch) { touch(s.x, s.y); jump(s.x, s.y); } else if (passable(s.x, s.y)) fall(s.x, s.y); }
  while (queue.length) {
    const i = queue.shift(), x = i % w, y = (i / w) | 0;
    for (const dx of [-1, 1]) if (passable(x + dx, y)) { if (standable(x + dx, y)) add(x + dx, y); else fall(x + dx, y); }
    const c = at(x, y);
    const vertical = m.fly || c === LADDER || (m.swim && c === WATER) || clingy(x, y);
    if (vertical) { if (passable(x, y + 1)) { if (standable(x, y + 1)) add(x, y + 1); else jump(x, y); } if (passable(x, y - 1)) { if (standable(x, y - 1)) add(x, y - 1); else fall(x, y - 1); } }
    jump(x, y); // from ground, ladder, wall or the water surface
  }
  return { nodes, hit };
}

/** Top-down reachability: 4-neighbour moves. Same return shape. */
export function reachTop(grid, m, starts, goals = new Map()) {
  const { w, h } = grid;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? SOLID : grid.cells[y * w + x]);
  const passable = (x, y) => { const c = at(x, y); return c === EMPTY || c === LADDER || c === ONEWAY || (c === WATER && (m.swim || m.fly)) || (c === HAZARD && m.fly); };
  const nodes = new Set(), hit = new Set(), q = [];
  const add = (x, y) => { const i = y * w + x; if (nodes.has(i) || !passable(x, y)) return; nodes.add(i); q.push(i); const g = goals.get(i); if (g !== undefined) hit.add(g); };
  for (const s of starts) add(s.x, s.y);
  while (q.length) { const i = q.shift(), x = i % w, y = (i / w) | 0; add(x + 1, y); add(x - 1, y); add(x, y + 1); add(x, y - 1); }
  return { nodes, hit };
}

/** Standable-cell test exposed for feature placement (side view). */
export function standableSide(grid, m) {
  const { w, h } = grid;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? SOLID : grid.cells[y * w + x]);
  return (x, y) => { const c = at(x, y), b = at(x, y - 1); return (c === EMPTY || c === LADDER) && (b === SOLID || b === ONEWAY || b === LADDER); };
}
