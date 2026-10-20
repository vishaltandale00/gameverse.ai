// Studio placeholder art: a blueprint well where outlined blocks drop and stack
// while a game is being built. Pure canvas, no assets. progress() (0..1) speeds
// the drops up as the build advances; reduced motion draws one still frame.
const SHAPES = [
  [[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1]], [[0, 0], [1, 0], [2, 0], [0, 1]], [[0, 0], [1, 0], [1, 1], [2, 1]],
  [[1, 0], [2, 0], [0, 1], [1, 1]], [[0, 0], [0, 1], [0, 2], [1, 0]], [[0, 0], [0, 1], [0, 2]], [[0, 0], [1, 0]],
];
const CHALK = [143, 208, 255], SIGNAL = [255, 201, 74];
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

export function blueprintArt(canvas, { progress = () => 0, idle = false } = {}) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, cell = 20, cols = 12, rows = 10, ox = 0, oy = 0, heights = [], landed = [], falling = null, nextAt = 0, fade = 1, clearing = 0, raf = 0, stopped = false;
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  function layout() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (!r.width || !r.height) return false;
    if (Math.round(r.width) === w && Math.round(r.height) === h) return true;
    w = Math.round(r.width); h = Math.round(r.height);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = Math.max(10, Math.round(Math.min(w / 26, h / 13)));
    cols = Math.max(6, Math.min(14, Math.floor(w * 0.42 / cell)));
    rows = Math.max(6, Math.floor((h - cell * 1.5) / cell));
    ox = Math.round((w - cols * cell) / 2); oy = Math.round(h - cell * 0.75);
    reset();
    if (reduced) { for (let i = 0; i < cols * 2 && Math.max(...heights) < rows * 0.55; i++) place(spawn(), true); }
    return true;
  }
  function reset() { heights = Array(cols).fill(0); landed = []; falling = null; fade = 1; clearing = 0; }
  function spawn() {
    const shape = SHAPES[Math.floor(rand() * SHAPES.length)];
    const width = Math.max(...shape.map(c => c[0])) + 1;
    const x = Math.floor(rand() * (cols - width + 1));
    let land = 0;
    for (const [dx, dy] of shape) land = Math.max(land, heights[x + dx] - dy);
    return { shape, x, land };
  }
  function place(p, settle) {
    for (const [dx, dy] of p.shape) { heights[p.x + dx] = Math.max(heights[p.x + dx], p.land + dy + 1); landed.push({ x: p.x + dx, y: p.land + dy, t: settle ? -1e9 : performance.now() }); }
  }
  const cellRect = (x, y) => [ox + x * cell, oy - (y + 1) * cell];

  function drawCell(x, y, stroke, fill) {
    const [px, py] = cellRect(x, y), inset = Math.max(1.5, cell * 0.08);
    ctx.fillStyle = fill; ctx.fillRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2);
    ctx.strokeStyle = stroke; ctx.strokeRect(px + inset + .5, py + inset + .5, cell - inset * 2 - 1, cell - inset * 2 - 1);
  }

  function draw(now) {
    ctx.clearRect(0, 0, w, h);
    // drafting grid
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(CHALK, 0.06);
    ctx.beginPath();
    for (let x = (ox % cell) + .5; x < w; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = (oy % cell) + .5; y < h; y += cell) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    // well walls and floor, dashed like a construction line
    ctx.setLineDash([cell * 0.3, cell * 0.2]); ctx.strokeStyle = rgba(CHALK, 0.35);
    ctx.beginPath(); ctx.moveTo(ox - 4.5, oy - rows * cell); ctx.lineTo(ox - 4.5, oy + 4.5); ctx.lineTo(ox + cols * cell + 4.5, oy + 4.5); ctx.lineTo(ox + cols * cell + 4.5, oy - rows * cell); ctx.stroke();
    ctx.setLineDash([]);
    // dimension tick marks along the floor
    ctx.strokeStyle = rgba(CHALK, 0.25);
    ctx.beginPath();
    for (let i = 0; i <= cols; i++) { const x = ox + i * cell + .5; ctx.moveTo(x, oy + 9); ctx.lineTo(x, oy + (i % 5 ? 12 : 16)); }
    ctx.stroke();
    ctx.globalAlpha = fade;
    for (const c of landed) {
      const age = (now - c.t) / 260;
      if (age < 1) drawCell(c.x, c.y, rgba(SIGNAL, 0.9 - age * 0.35), rgba(SIGNAL, 0.22 * (1 - age) + 0.06));
      else drawCell(c.x, c.y, rgba(CHALK, 0.55), rgba(CHALK, 0.07));
    }
    if (falling) {
      const t = Math.min(1, (now - falling.t0) / falling.dur), e = t * t;
      const startY = rows + 1, y = startY + (falling.land - startY) * e;
      for (const [dx, dy] of falling.shape) {
        const [px, py] = cellRect(falling.x + dx, y + dy), inset = Math.max(1.5, cell * 0.08);
        ctx.strokeStyle = rgba(SIGNAL, 0.95); ctx.fillStyle = rgba(SIGNAL, 0.14);
        ctx.fillRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2);
        ctx.strokeRect(px + inset + .5, py + inset + .5, cell - inset * 2 - 1, cell - inset * 2 - 1);
      }
      // guide line from the piece to where it lands
      ctx.strokeStyle = rgba(SIGNAL, 0.18); ctx.setLineDash([2, 4]);
      const gx = ox + (falling.x + 0.5) * cell + .5; ctx.beginPath(); ctx.moveTo(gx, cellRect(0, y)[1] + cell); ctx.lineTo(gx, cellRect(0, falling.land)[1] + cell); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    if (stopped || !canvas.isConnected) { stopped = true; return; }
    if (layout()) {
      if (!reduced) {
        if (clearing) { fade = Math.max(0, 1 - (now - clearing) / 700); if (!fade) { reset(); nextAt = now + 200; } }
        else if (falling && now - falling.t0 >= falling.dur) { place(falling); falling = null; if (Math.max(...heights) > rows * 0.72) clearing = now; }
        else if (!falling && now >= nextAt) {
          const pace = idle ? 0.15 : Math.max(0, Math.min(1, progress()));
          falling = { ...spawn(), t0: now, dur: 900 - pace * 420 };
          nextAt = now + falling.dur + 380 - pace * 260;
        }
      }
      draw(now);
    }
    if (!reduced) raf = requestAnimationFrame(frame);
  }
  if (reduced) { new ResizeObserver(() => { if (!stopped && canvas.isConnected) frame(performance.now()); }).observe(canvas); }
  raf = requestAnimationFrame(frame);
  return { stop() { stopped = true; cancelAnimationFrame(raf); } };
}
