// Traversal proofs on a role raster, used by 2D generators to PROVE "traversable
// for the document's movers" at generation time. Rasters are y-up (row 0 is the
// bottom), cells hold ROLE values; out of bounds is solid.
//
// The proof is the tilemap's own navigation (spaces2d-tilenav.js makeNav): the
// same graph engine.space.tilemap's path/reachable/canReach build, so a layout a
// generator proves is one the verifier and the bots can walk. The mover comes in
// the kernel reachability opts ({abilities, envelope, who}, KERNEL_API §3) plus
// its body box (width, height), mapped by navOptions exactly as the space maps
// them: jump arcs are checked against the whole body, nodes need the body's
// clearance, hazards are avoided, one-way cells are jumped through and dropped
// through, climbable cells need climb (any wall with wallJump), liquids need swim
// in top-down mode. Roles map to the space's cell kinds and tags:
//   SOLID → solid; ONEWAY → oneway; LADDER → passable, tagged climbable;
//   HAZARD → passable, tagged hazard; WATER → passable, tagged liquid.
import { makeNav, navOptions, jumpReach } from './spaces2d-tilenav.js';
import { unkey } from './spaces2d-lib.js';

export const ROLE = { EMPTY: 0, SOLID: 1, HAZARD: 2, WATER: 3, LADDER: 4, ONEWAY: 5 };
const { SOLID, HAZARD, WATER, LADDER, ONEWAY } = ROLE;
const KIND = { [SOLID]: 'solid', [ONEWAY]: 'oneway' };
const TAGS = { [HAZARD]: ['hazard'], [WATER]: ['liquid'], [LADDER]: ['climbable'] };
const NONE = [];

/** A mover in navigation form ({ abilities: tilemap ability fields, width, height }) from kernel reachability opts. */
export const navMover = opts => navOptions(opts);
/** Jump height and distance (tiles) of a mover in navigation form. */
export const moverReach = mover => jumpReach(mover.abilities);
/** Body extent in whole cells [columns, rows] of a mover in navigation form. */
export const moverCells = mover => [Math.max(1, Math.ceil((mover.width ?? 1) - 1e-6)), Math.max(1, Math.ceil((mover.height ?? 1) - 1e-6))];

/** The navigation graph of a role raster for a mover (mode 'side' | 'topdown'). */
export function rasterNav(grid, mode, mover) {
  const at = (x, y) => (x < 0 || y < 0 || x >= grid.w || y >= grid.h ? SOLID : grid.cells[y * grid.w + x]);
  const q = { W: grid.w, H: grid.h, mode: mode === 'topdown' ? 'topdown' : 'side', wrapX: false, wrapY: false, kindAt: (x, y) => KIND[at(x, y)] ?? 'none', tagsAt: (x, y) => TAGS[at(x, y)] ?? NONE, costAt: () => 1 };
  return makeNav(q, mover);
}

/**
 * Reachability on a role raster for a mover. starts: [{x, y}] feet cells (snapped onto the graph: a start in the
 * air falls). goals: Map(raster index → id); a goal is hit when a reached node's body box covers its cell.
 * -> { nodes: Set<raster index of a reachable feet cell>, hit: Set<goalId> }
 */
export function proveReach(grid, mode, mover, starts, goals = new Map()) {
  const nav = rasterNav(grid, mode, mover), [cw, ch] = moverCells(mover);
  const keys = starts.map(s => nav.snap([s.x, s.y])).filter(Boolean);
  const nodes = new Set(), hit = new Set();
  if (!keys.length) return { nodes, hit };
  for (const k of nav.reach(keys)) {
    const [x, y] = unkey(k); nodes.add(y * grid.w + x);
    if (goals.size) for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const cx = x + i, cy = y + j; if (cx < 0 || cy < 0 || cx >= grid.w || cy >= grid.h) continue;
      const g = goals.get(cy * grid.w + cx); if (g !== undefined) hit.add(g);
    }
  }
  return { nodes, hit };
}
