// Wall contour tracing for neon maze walls (ported from the maze kit): trace
// the outlines of wall regions on a cell grid and offset them `inset` cells
// into the walls, so a maze reads as glowing double-stroked contours. Pure.
// Coordinates: cell (i, j) covers [i, i+1) × [j, j+1); callers shift for
// center-anchored grids. Out-of-bounds counts as wall (a 1-cell pad) except on
// wrapped axes, so tunnels stay open and every loop closes.

/** wall(i, j) → bool for in-bounds cells. Returns loops of {x, y} with .box = [x0,y0,x1,y1]. */
export function wallLoops(W, H, wall, { inset = 0.5, wrapX = false, wrapY = false } = {}) {
  const solid = (i, j) => {
    if (i < -1 || i > W || j < -1 || j > H) return false;
    if (i < 0 || i >= W) return !wrapX;
    if (j < 0 || j >= H) return !wrapY;
    return wall(i, j);
  };
  const starts = new Map(), all = [];
  const add = (x, y, dx, dy) => { const e = { x, y, dx, dy, used: false }; all.push(e); const k = `${x},${y}`; (starts.get(k) || starts.set(k, []).get(k)).push(e); };
  for (let j = -1; j <= H; j++) for (let i = -1; i <= W; i++) {
    if (!solid(i, j)) continue;
    if (!solid(i, j - 1)) add(i, j, 1, 0);
    if (!solid(i + 1, j)) add(i + 1, j, 0, 1);
    if (!solid(i, j + 1)) add(i + 1, j + 1, -1, 0);
    if (!solid(i - 1, j)) add(i, j + 1, 0, -1);
  }
  const loops = [];
  for (const e0 of all) {
    if (e0.used) continue;
    const pts = [];
    let e = e0;
    for (let guard = 0; guard < 1e6; guard++) {
      e.used = true;
      const ex = e.x + e.dx, ey = e.y + e.dy, next = (starts.get(`${ex},${ey}`) || []).filter(n => !n.used || n === e0);
      // Prefer a right turn (keeps hugging the same wall where two touch at a corner), then straight, then left.
      const pick = next.find(n => n.dx === -e.dy && n.dy === e.dx) || next.find(n => n.dx === e.dx && n.dy === e.dy) || next[0];
      if (!pick) break;
      if (pick.dx !== e.dx || pick.dy !== e.dy) pts.push({ x: ex, y: ey, inX: e.dx, inY: e.dy, outX: pick.dx, outY: pick.dy });
      if (pick === e0) break;
      e = pick;
    }
    if (pts.length < 4) continue;
    const loop = pts.map(p => ({ x: p.x + inset * (-p.inY - p.outY), y: p.y + inset * (p.inX + p.outX) }));
    loop.box = loop.reduce((b, p) => [Math.min(b[0], p.x), Math.min(b[1], p.y), Math.max(b[2], p.x), Math.max(b[3], p.y)], [Infinity, Infinity, -Infinity, -Infinity]);
    loops.push(loop);
  }
  return loops;
}

/** Add a loop to the current path with rounded corners; toScreen maps loop points to screen. */
export function roundedLoop(g, pts, toScreen, radiusPx) {
  const n = pts.length, P = i => toScreen(pts[(i + n) % n]);
  const a0 = P(-1), b0 = P(0);
  g.moveTo((a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2);
  for (let i = 0; i < n; i++) {
    const a = P(i - 1), b = P(i), c = P(i + 1);
    const r = Math.min(radiusPx, Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, Math.hypot(c[0] - b[0], c[1] - b[1]) / 2);
    g.arcTo(b[0], b[1], c[0], c[1], Math.max(0, r));
  }
  g.closePath();
}
