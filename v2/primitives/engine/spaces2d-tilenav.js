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

/** Landing clearance of a jump arc (tiles): an arc onto a ledge dy rows up rises at least dy + LIP (arcTemplates). */
export const LIP = 0.6;

/**
 * Navigation options from the kernel reachability opts ({abilities, envelope, who}, KERNEL_API §3) plus the body box.
 * The movement envelope is physical reach (card.envelope: the feet's rise, the gap crossed at speed); navigation
 * counts whole tiles the controller makes: a ledge N rows up only when the rise clears it by the arc's LIP
 * (N = floor(rise − LIP), the rise of both jumps with a double jump), gaps and dashes rounded down (jumpGap is the envelope's name for jumpDistance).
 * Ability flags and navigation-native fields in `abilities` apply on top as given. The body width and height are in
 * tiles (1 × 1 when the mover declares no body, as spaces size undeclared bodies). The tilemap's path/reachable/canReach
 * and every generator proof over a tile raster read movers through this one mapping.
 */
export function navOptions(o = {}) {
  const env = { ...(o.envelope || {}) };
  if (env.jumpGap !== undefined && env.jumpDistance === undefined) env.jumpDistance = env.jumpGap;
  // With a double jump the graph doubles jumpHeight, so the clearance applies to the combined rise.
  if (Number.isFinite(env.jumpHeight)) { const k = env.doubleJump ? 2 : 1; env.jumpHeight = Math.max(0, Math.floor(env.jumpHeight * k - LIP + 1e-9)) / k; }
  for (const k of ['jumpDistance', 'dash']) if (Number.isFinite(env[k])) env[k] = Math.max(0, Math.floor(env[k] + 1e-9));
  const ab = { ...env, ...(o.abilities || {}) };
  if (ab.jumpGap !== undefined && (o.abilities || {}).jumpDistance === undefined && (o.abilities || {}).jumpGap !== undefined) ab.jumpDistance = ab.jumpGap;
  return { abilities: ab, width: o.width ?? (o.radius != null ? o.radius * 2 : 1), height: o.height ?? 1, avoid: o.avoid, diagonals: o.diagonals, maxNodes: o.maxNodes, obstacles: o.obstacles ?? 'static', who: o.who };
}

/** Jump reach in tiles of navigation abilities (as makeNav reads them): double jump doubles height and adds half the distance, dash adds tiles. */
export function jumpReach(abilities = {}) {
  const ab = { ...DEFAULT_ABILITIES, ...abilities };
  return { height: ab.jumpHeight * (ab.doubleJump ? 2 : 1), distance: ab.jumpDistance * (ab.doubleJump ? 1.5 : 1) + (ab.dash || 0) };
}

/**
 * q = { W, H, mode, wrapX, wrapY, kindAt(x,y) → 'solid'|'oneway'|'slope'|'none', tagsAt(x,y) → string[], costAt(x,y) → n }
 * opts = { abilities, width=1, height=1 (tiles), avoid=['hazard'], diagonals=false, maxNodes }
 */
export function makeNav(q, opts = {}) {
  const ab = { ...DEFAULT_ABILITIES, ...(opts.abilities || {}) };
  const w = Math.max(1, Math.ceil((opts.width ?? 1) - 1e-6)), h = Math.max(1, Math.ceil((opts.height ?? 1) - 1e-6));
  const avoid = new Set(opts.avoid ?? ['hazard']);
  const nx = x => (q.wrapX ? mod(x, q.W) : x), ny = y => (q.wrapY ? mod(y, q.H) : y);
  // Per-cell facts (kind and tag bits) are memoised for the life of this nav object, which the space caches
  // per map version: a typed array over the map plus a small margin (a Map for very large maps).
  const KINDS = ['none', 'oneway', 'slope', 'solid'], AV = 4, LQ = 8, CL = 16, PW = q.W + 8, PH = q.H + 4;
  const dense = PW * PH <= 4e6, memoA = dense ? new Int16Array(PW * PH).fill(-1) : null, memoM = dense ? null : new Map();
  const slot = (x, y) => (x >= -4 && x < q.W + 4 && y >= -2 && y < q.H + 2 ? (y + 2) * PW + x + 4 : -1);
  const compute = (x, y) => { const t = q.tagsAt(x, y); return KINDS.indexOf(q.kindAt(x, y)) | (avoid.size && t.some(z => avoid.has(z)) ? AV << 2 : 0) | (t.includes('liquid') ? LQ << 2 : 0) | (t.includes('climbable') ? CL << 2 : 0); };
  const info = (x, y) => {
    x = nx(x); y = ny(y); const k = slot(x, y); if (k < 0) return compute(x, y);
    let v = dense ? memoA[k] : memoM.get(k) ?? -1;
    if (v < 0) { v = compute(x, y); if (dense) memoA[k] = v; else memoM.set(k, v); }
    return v;
  };
  const kind = (x, y) => KINDS[info(x, y) & 3];
  const has = (x, y, t) => Boolean(info(x, y) & ((t === 'liquid' ? LQ : t === 'climbable' ? CL : 0) << 2));
  const avoided = (x, y) => Boolean(info(x, y) & (AV << 2));
  const liquid = (x, y) => has(x, y, 'liquid');
  const inMap = (x, y) => (q.wrapX || (x >= 0 && x < q.W)) && (q.wrapY || (y >= 0 && y < q.H));
  // A cell a body part may overlap: not solid, not a slope (except at the feet), not avoided.
  const open = (x, y) => { if (!inMap(x, y)) return false; const v = info(x, y), k = v & 3; return k <= 1 && !(v & (AV << 2)) && (q.mode === 'side' || !(v & (LQ << 2)) || ab.swim || ab.fly); };
  const feetOk = (x, y) => inMap(x, y) && !avoided(x, y) && (open(x, y) || (q.mode === 'side' && kind(x, y) === 'slope'));
  const clear = (x, y) => { for (let i = 0; i < w; i++) { if (!feetOk(x + i, y)) return false; for (let j = 1; j < h; j++) if (!open(x + i, y + j)) return false; } return true; };
  const supportAt = (x, y) => (info(x, y) & 3) > 0;
  const slopeNode = (x, y) => (info(x, y) & 3) === 2;
  const standable = (x, y) => { if (!clear(x, y)) return false; for (let i = 0; i < w; i++) if (slopeNode(x + i, y) || supportAt(x + i, y - 1)) return true; return false; };
  const climbable = (x, y) => clear(x, y) && (ab.climb && (has(x, y, 'climbable') || [-1, w].some(d => kind(x + d, y) === 'solid' && has(x + d, y, 'climbable'))) || ab.wallJump && [-1, w].some(d => kind(x + d, y) === 'solid'));
  const swimmable = (x, y) => ab.swim && clear(x, y) && liquid(x, y);
  const amemo = new Map();
  const anchored = (x, y) => { const k = slot(nx(x), ny(y)); let v = amemo.get(k); if (v === undefined) { v = inMap(x, y) && (standable(x, y) || climbable(x, y) || swimmable(x, y)); if (k >= 0) amemo.set(k, v); } return v; };
  const nodeKey = (x, y) => key2(nx(x), ny(y));
  const rmem = new Map(), pmem = new Map();

  /** Where a body released at (x, y) comes to rest (standable, climbable or swimmable), or null. */
  const fall = (x, y) => {
    for (let n = 0; n <= q.H + 1; n++, y--) { if (!inMap(x, y) || !clear(x, y)) return null; if (anchored(x, y)) return [x, y]; }
    return null;
  };
  // Jump reach (tiles). Double jump roughly doubles height and adds half the distance; dash adds tiles.
  const { height: JH, distance: JD } = jumpReach(ab);
  // Arc clearance: parabolas from feet (x0,y0) to (x1,y1), a low arc first and then higher apexes up to
  // the jump height (clearing hazards or lips needs a taller arc). The cells each arc sweeps depend only on
  // (dx, dy, apex, body size), so they come from precomputed templates (arcTemplates). An arc covers only the
  // distance its height gives it: a lower arc (under a ceiling) is a shorter hop, never the full jump distance.
  const templates = arcTemplates(w, h, JH, JD);
  const arcClear = (x0, y0, x1, y1) => {
    for (const cells of templates(x1 - x0, y1 - y0)) {
      let ok = true;
      for (let i = 0; i < cells.length && ok; i += 3) { const c = x0 + cells[i], r = y0 + cells[i + 1]; if (!inMap(c, r) || (!open(c, r) && !(cells[i + 2] && slopeNode(c, r)))) ok = false; }
      if (ok) return true;
    }
    return false;
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
  // Edges are memoised per node: the cached graph is built lazily as searches visit it.
  const emem = new Map(), stats = { nodes: 0 };
  const edges = k => { let out = emem.get(k); if (!out) { const [x, y] = unkey(k); out = q.mode === 'side' ? edgesSide(x, y) : edgesTop(x, y); emem.set(k, out); stats.nodes++; } return out; };
  const isNode = (x, y) => (q.mode === 'side' ? (ab.fly ? clear(x, y) : anchored(x, y)) : clear(x, y));
  /** Snap a tile coordinate (feet cell) onto the nav graph: itself, or where it falls to. */
  const snap = ([x, y]) => { if (isNode(x, y)) return nodeKey(x, y); if (!clear(x, y) && isNode(x, y + 1)) return nodeKey(x, y + 1); if (q.mode === 'side' && !ab.fly) { const l = fall(x, y); return l ? nodeKey(l[0], l[1]) : null; } return null; };
  return {
    snap, edges, isNode, standable, clear, stats,
    /** Reachable node keys from starts. Memoised per start set; the returned Set is shared: treat it as read-only. */
    reach(starts, maxNodes = opts.maxNodes ?? 1000000) {
      const key = starts.filter(Boolean).join(';'); let r = rmem.get(key);
      if (!r) { r = flood(starts.filter(Boolean), edges, maxNodes); rmem.set(key, r); } else stats.reachHits = (stats.reachHits || 0) + 1;
      return r;
    },
    /** A* path of node keys, memoised per (from, memoKey). Unreachable goals are answered from the reach set. */
    path(from, goal, goalKeys, memoKey) {
      const mk = memoKey && `${from}>${memoKey}`;
      if (mk && pmem.has(mk)) { stats.pathHits = (stats.pathHits || 0) + 1; return pmem.get(mk); }
      const set = goalKeys || new Set([goal]), [gx, gy] = goal ? unkey(goal) : [0, 0], seen = this.reach([from]);
      let out = null;
      if ([...set].some(k => seen.has(k))) {
        const hfn = goal ? k => { const [x, y] = unkey(k); return 0.5 * (Math.abs(x - gx) + Math.abs(y - gy)); } : () => 0;
        out = astar(from, k => set.has(k), edges, hfn, opts.maxNodes ?? 200000);
      }
      if (mk) { pmem.set(mk, out); if (pmem.size > 4096) pmem.delete(pmem.keys().next().value); }
      return out;
    },
  };
}

// Arc templates: for a body w×h tiles, jump height JH and distance JD, the relative cells swept by each candidate apex
// of a jump (dx, dy), as flat [dc, dr, endColumn] triples. Ballistic reach: the full arc (apex JH + LIP) spans JD on
// the flat; an arc of apex a landing dy higher stays aloft √a + √(a − dy) in those units, so it spans
// JD/2 · (√(a/A) + √((a − dy)/A)) with A = JH + LIP. Apexes that cannot span |dx| are not candidates. Pure and shared.
const TEMPLATES = new Map();
export function arcSpan(JH, JD, apex, dy) {
  const A = JH + LIP; if (!(A > 0)) return 0;
  return (JD / 2) * (Math.sqrt(Math.max(0, apex) / A) + Math.sqrt(Math.max(0, apex - dy) / A));
}
function arcTemplates(w, h, JH, JD) {
  const key = `${w},${h},${JH},${JD}`;
  let table = TEMPLATES.get(key);
  if (!table) { table = new Map(); TEMPLATES.set(key, table); if (TEMPLATES.size > 64) TEMPLATES.delete(TEMPLATES.keys().next().value); }
  return (dx, dy) => {
    const k = dx * 4096 + dy; let list = table.get(k);
    if (list) return list;
    const low = Math.max(0, dy) + LIP;
    list = [...new Set([low, (low + JH + LIP) / 2, JH + LIP])].filter(a => a >= low && (dx === 0 || Math.abs(dx) <= arcSpan(JH, JD, a, dy) + 1e-9)).map(apex => {
      const kk = Math.max(0.15, apex - dy / 2), n = Math.max(4, Math.ceil(Math.abs(dx) * 3 + Math.abs(dy) * 2 + apex * 2)), seen = new Set(), out = [];
      for (let i = 1; i < n; i++) {
        const s = i / n, fx = 0.5 + dx * s, fy = dy * s + 4 * kk * s * (1 - s);
        const c0 = Math.floor(fx - 0.4), c1 = Math.floor(fx + w - 1 + 0.4), r0 = Math.floor(fy + 0.02), r1 = Math.floor(fy + h - 0.06);
        for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) { const id = c * 8192 + r; if (!seen.has(id)) { seen.add(id); out.push(c, r, c === 0 || c === dx ? 1 : 0); } }
      }
      return Int32Array.from(out);
    });
    table.set(k, list);
    return list;
  };
}
