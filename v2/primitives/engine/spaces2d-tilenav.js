// Ability-aware navigation over a tile map (engine.space.tilemap pathfind and
// reachable). Nodes are the cells a body's feet can occupy; edges are moves the
// stated abilities allow. Side view: walk (and step along slopes), walk off
// ledges and fall, drop through one-way platforms, jump arcs bounded by jump
// height and distance (double jump and dash extend them) checked for clearance
// against the body box, climb (climbable tiles; wallJump treats any wall as
// climbable), swim (liquid tiles) and fly (any free cell). Top-down: free cells
// with clearance, liquids need swim, one-way tiles are ledges entered only
// moving -y, optional diagonals. Hazard-tagged cells are avoided by default.
import { astar, flood, key2, unkey, mod } from './spaces2d-lib.js';

export const DEFAULT_ABILITIES = { jumpHeight: 3, jumpDistance: 4, doubleJump: false, dash: 0, climb: false, wallJump: false, swim: false, fly: false, dropThrough: true };

/**
 * q = { W, H, mode, wrapX, wrapY, kindAt(x,y) → 'solid'|'oneway'|'slope'|'none', tagsAt(x,y) → string[], costAt(x,y) → n }
 * opts = { abilities, width=1, height=1 (tiles), avoid=['hazard'], diagonals=false, maxNodes }
 */
export function makeNav(q, opts = {}) {
  const ab = { ...DEFAULT_ABILITIES, ...(opts.abilities || {}) };
  const w = Math.max(1, Math.ceil((opts.width ?? 1) - 1e-6)), h = Math.max(1, Math.ceil((opts.height ?? 1) - 1e-6));
  const avoid = new Set(opts.avoid ?? ['hazard']);
  const nx = x => (q.wrapX ? mod(x, q.W) : x), ny = y => (q.wrapY ? mod(y, q.H) : y);
  const kind = (x, y) => q.kindAt(nx(x), ny(y));
  const tags = (x, y) => q.tagsAt(nx(x), ny(y));
  const has = (x, y, t) => tags(x, y).includes(t);
  const avoided = (x, y) => avoid.size > 0 && tags(x, y).some(t => avoid.has(t));
  const liquid = (x, y) => has(x, y, 'liquid');
  const inMap = (x, y) => (q.wrapX || (x >= 0 && x < q.W)) && (q.wrapY || (y >= 0 && y < q.H));
  // A cell a body part may overlap: not solid, not a slope (except at the feet), not avoided.
  const open = (x, y) => inMap(x, y) && (kind(x, y) === 'none' || kind(x, y) === 'oneway') && !avoided(x, y) && (q.mode === 'side' || !liquid(x, y) || ab.swim || ab.fly);
  const feetOk = (x, y) => inMap(x, y) && !avoided(x, y) && (open(x, y) || (q.mode === 'side' && kind(x, y) === 'slope'));
  const clear = (x, y) => { for (let i = 0; i < w; i++) { if (!feetOk(x + i, y)) return false; for (let j = 1; j < h; j++) if (!open(x + i, y + j)) return false; } return true; };
  const supportAt = (x, y) => { const k = kind(x, y); return k === 'solid' || k === 'oneway' || k === 'slope'; };
  const slopeNode = (x, y) => kind(x, y) === 'slope';
  const standable = (x, y) => { if (!clear(x, y)) return false; for (let i = 0; i < w; i++) if (slopeNode(x + i, y) || supportAt(x + i, y - 1)) return true; return false; };
  const climbable = (x, y) => clear(x, y) && (ab.climb && (has(x, y, 'climbable') || [-1, w].some(d => kind(x + d, y) === 'solid' && has(x + d, y, 'climbable'))) || ab.wallJump && [-1, w].some(d => kind(x + d, y) === 'solid'));
  const swimmable = (x, y) => ab.swim && clear(x, y) && liquid(x, y);
  const anchored = (x, y) => standable(x, y) || climbable(x, y) || swimmable(x, y);
  const nodeKey = (x, y) => key2(nx(x), ny(y));

  /** Where a body released at (x, y) comes to rest (standable, climbable or swimmable), or null. */
  const fall = (x, y) => {
    for (let n = 0; n <= q.H + 1; n++, y--) { if (!inMap(x, y) || !clear(x, y)) return null; if (anchored(x, y)) return [x, y]; }
    return null;
  };
  // Jump reach (tiles). Double jump roughly doubles height and adds half the distance; dash adds tiles.
  const JH = ab.jumpHeight * (ab.doubleJump ? 2 : 1), JD = ab.jumpDistance * (ab.doubleJump ? 1.5 : 1) + (ab.dash || 0);
  // Arc clearance: sample parabolas from feet (x0,y0) to (x1,y1), trying a low arc first and then
  // higher apexes up to the jump height (clearing hazards or lips needs a taller arc).
  const arcClear = (x0, y0, x1, y1) => {
    const dx = x1 - x0, dy = y1 - y0, low = Math.max(0, dy) + 0.6;
    for (const apex of [...new Set([low, (low + JH + 0.6) / 2, JH + 0.6])].filter(a => a >= low)) if (arcOk(x0, y0, dx, dy, apex)) return true;
    return false;
  };
  const arcOk = (x0, y0, dx, dy, apex) => {
    const k = Math.max(0.15, apex - dy / 2), x1 = x0 + dx;
    const n = Math.max(4, Math.ceil(Math.abs(dx) * 3 + Math.abs(dy) * 2 + apex * 2));
    for (let i = 1; i < n; i++) {
      const s = i / n, fx = x0 + 0.5 + dx * s, fy = y0 + dy * s + 4 * k * s * (1 - s);
      const c0 = Math.floor(fx - 0.4), c1 = Math.floor(fx + w - 1 + 0.4), r0 = Math.floor(fy + 0.02), r1 = Math.floor(fy + h - 0.06);
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) { if (!inMap(c, r)) return false; if (!open(c, r) && !((c === x1 || c === x0) && slopeNode(c, r))) return false; }
    }
    return true;
  };

  function edgesSide(x, y) {
    const out = [], push = (p, cost) => { if (p) out.push([nodeKey(p[0], p[1]), cost]); };
    if (ab.fly) { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (clear(x + dx, y + dy)) push([x + dx, y + dy], q.costAt(nx(x + dx), ny(y + dy))); return out; }
    const st = standable(x, y), cl = climbable(x, y), sw = swimmable(x, y);
    for (const sx of [1, -1]) {
      const tx = x + sx;
      for (const dy of slopeNode(x, y) || slopeNode(tx, y) || slopeNode(tx, y - 1) || slopeNode(tx, y + 1) ? [0, 1, -1] : [0]) if (standable(tx, y + dy)) push([tx, y + dy], q.costAt(nx(tx), ny(y + dy)));
      if (!standable(tx, y) && clear(tx, y)) { const l = fall(tx, y); if (l && (l[0] !== x || l[1] !== y)) push(l, 1 + (y - l[1]) * 0.5); }
    }
    if (st && ab.dropThrough) for (let i = 0; i < w; i++) if (kind(x + i, y - 1) === 'oneway' && !supportAt(x + (i ? 0 : w - 1), y - 1) || (w === 1 && kind(x, y - 1) === 'oneway')) { const l = fall(x, y - 1); if (l) push(l, 1 + (y - l[1]) * 0.5); break; }
    if (cl || sw) for (const dy of [1, -1]) if (anchored(x, y + dy) || (sw && clear(x, y + dy) && dy > 0)) push([x, y + dy], 1.5);
    if (sw) for (const sx of [1, -1]) if (swimmable(x + sx, y)) push([x + sx, y], 1.5);
    if (st || cl || (sw && !liquid(x, y + 1))) {
      const dmax = Math.ceil(JD + (JH + q.H) / 2);
      for (let dy = Math.floor(JH); dy >= -Math.min(q.H, 2 * JD + JH + 6); dy--) {
        const reach = Math.floor(JD + Math.max(0, -dy) / 2);
        for (let dx = -Math.min(reach, dmax); dx <= Math.min(reach, dmax); dx++) {
          if ((dx === 0 && dy <= 0) || (Math.abs(dx) <= 1 && dy === 0)) continue;
          const tx = x + dx, ty = y + dy;
          if (!anchored(tx, ty) || !arcClear(x, y, tx, ty)) continue;
          push([tx, ty], Math.abs(dx) + Math.abs(dy) + 1);
        }
      }
    }
    return out;
  }
  function edgesTop(x, y) {
    const out = [], dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (opts.diagonals) dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    for (const [dx, dy] of dirs) {
      const tx = x + dx, ty = y + dy;
      if (!ab.fly && kind(tx, ty) === 'oneway') { if (dy === -1 && dx === 0 && clear(tx, ty - 1)) out.push([nodeKey(tx, ty - 1), 2]); continue; } // ledges hop down only
      if (!clear(tx, ty)) continue;
      if (dx && dy && (!clear(x + dx, y) || !clear(x, y + dy))) continue;
      out.push([nodeKey(tx, ty), q.costAt(nx(tx), ny(ty)) * (dx && dy ? Math.SQRT2 : 1)]);
    }
    return out;
  }
  const edges = k => { const [x, y] = unkey(k); return q.mode === 'side' ? edgesSide(x, y) : edgesTop(x, y); };
  const isNode = (x, y) => (q.mode === 'side' ? (ab.fly ? clear(x, y) : anchored(x, y)) : clear(x, y));
  /** Snap a tile coordinate (feet cell) onto the nav graph: itself, or where it falls to. */
  const snap = ([x, y]) => { if (isNode(x, y)) return nodeKey(x, y); if (!clear(x, y) && isNode(x, y + 1)) return nodeKey(x, y + 1); if (q.mode === 'side' && !ab.fly) { const l = fall(x, y); return l ? nodeKey(l[0], l[1]) : null; } return null; };
  return {
    snap, edges, isNode, standable, clear,
    reach(starts, maxNodes = opts.maxNodes ?? 1000000) { return flood(starts.filter(Boolean), edges, maxNodes); },
    path(from, goal, goalKeys) {
      const set = goalKeys || new Set([goal]), [gx, gy] = goal ? unkey(goal) : [0, 0];
      const hfn = goal ? k => { const [x, y] = unkey(k); return 0.5 * (Math.abs(x - gx) + Math.abs(y - gy)); } : () => 0;
      return astar(from, k => set.has(k), edges, hfn, opts.maxNodes ?? 200000);
    },
  };
}
