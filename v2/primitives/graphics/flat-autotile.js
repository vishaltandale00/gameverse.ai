// Autotiling: which variant of a tile to draw from its neighbours.
// blob47: 8-neighbour masks where a corner counts only when both of its edges
// connect, giving the 47 distinct tiles of the classic blob set.
// wang16: 4 edge bits (corners ignored). Directions are SCREEN directions
// (N is up on screen); callers convert from their space's y axis.
export const N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128;
const DIRS = [[N, 0, 1], [NE, 1, 1], [E, 1, 0], [SE, 1, -1], [S, 0, -1], [SW, -1, -1], [W, -1, 0], [NW, -1, 1]];

/** Reduce a raw 8-bit neighbour mask to its blob47 canonical form. */
export function canonical(mask) {
  let m = mask & (N | E | S | W);
  if (mask & NE && mask & N && mask & E) m |= NE;
  if (mask & SE && mask & S && mask & E) m |= SE;
  if (mask & SW && mask & S && mask & W) m |= SW;
  if (mask & NW && mask & N && mask & W) m |= NW;
  return m;
}
/** The 47 canonical masks, sorted; index into this list is the tile variant. */
export const BLOB47 = [...new Set(Array.from({ length: 256 }, (_, i) => canonical(i)))].sort((a, b) => a - b);
const INDEX = new Map(BLOB47.map((m, i) => [m, i]));
export const blobIndex = mask => INDEX.get(canonical(mask));

/**
 * Neighbour mask for the cell at (x, y). same(dx, dyUp) says whether the neighbour
 * one step right (dx) and one step UP on screen (dyUp) belongs to the same terrain.
 */
export function neighbourMask(same) {
  let m = 0;
  for (const [bit, dx, dy] of DIRS) if (same(dx, dy)) m |= bit;
  return m;
}
export const blobMask = same => canonical(neighbourMask(same));
export const wangMask = same => neighbourMask(same) & (N | E | S | W);
/** wang16 index 0..15 as NESW bits (N=1, E=2, S=4, W=8). */
export const wangIndex = mask => (mask & N ? 1 : 0) | (mask & E ? 2 : 0) | (mask & S ? 4 : 0) | (mask & W ? 8 : 0);

/**
 * Exposed features of a tile for painting: open edges, outer corners (both edges open)
 * and inner corners (both edges closed but the diagonal open).
 */
export function features(mask, mode = 'blob47') {
  const has = b => Boolean(mask & b);
  const open = { n: !has(N), e: !has(E), s: !has(S), w: !has(W) };
  const outer = { ne: open.n && open.e, se: open.s && open.e, sw: open.s && open.w, nw: open.n && open.w };
  const inner = mode === 'blob47'
    ? { ne: !open.n && !open.e && !has(NE), se: !open.s && !open.e && !has(SE), sw: !open.s && !open.w && !has(SW), nw: !open.n && !open.w && !has(NW) }
    : { ne: false, se: false, sw: false, nw: false };
  return { open, outer, inner };
}
