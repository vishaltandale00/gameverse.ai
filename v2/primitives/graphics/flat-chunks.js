// Chunked tile rasterization shared by the tilemap and grid renderers. A chunk
// is C×C cells painted once into an offscreen canvas at the tileset's native
// pixel size (crisp when scaled by an integer), with autotiling, overhang
// shadows, wall occlusion and decorations; liquids and animated hazards are
// returned as lists drawn live each frame. A small LRU keeps memory bounded.
import { blobMask, wangMask } from './flat-autotile.js';
import { paintTile, decorations } from './flat-tiles.js';
import { hexToRgb, surface, ctx2d, light, shade } from './flat-util.js';

export const MARGIN = 6;

/**
 * cells: Map('x,y' → block) covering the chunk plus a 1-cell border; solidAt(x,y) for the collision layer (overhang shadows).
 * info(block, x?, y?) → { kind: 'solid'|'oneway'|'liquid'|'gas'|'hazard'|'none'|'deco', theme } (x, y given when painting).
 * back: 0 for front layers, else how much to darken a back layer (0..1).
 * Returns { canvas|null, buf, w, h, liquids:[{x,y,block,top}], hazards:[{x,y,block}] }.
 */
export function buildChunk({ cells, cx, cy, C, T, info, back = false, mode = 'side', autotile = 'blob47', solidAt = null, occlusion = 0.5, decor = true }) {
  const W = C * T + MARGIN * 2, Hh = C * T + MARGIN * 2, buf = new Uint8ClampedArray(W * Hh * 4);
  const liquids = [], hazards = [];
  const key = (x, y) => `${x},${y}`;
  const kindAt = (x, y) => { const b = cells.get(key(x, y)); return b == null ? 'none' : info(b).kind; };
  const connects = k => k === 'solid' || k === 'deco';
  const x0 = cx * C, y0 = cy * C;
  // Buffer pixel of a cell's top-left (y up in the world, down in the buffer).
  const px = (x, y) => [MARGIN + (x - x0) * T, MARGIN + (C - 1 - (y - y0)) * T];
  const decoQueue = [];
  for (let y = y0; y < y0 + C; y++) for (let x = x0; x < x0 + C; x++) {
    const b = cells.get(key(x, y));
    if (b == null) continue;
    const I = info(b, x, y);
    if (I.kind === 'liquid' || I.kind === 'gas') { liquids.push({ x, y, block: b, top: kindAt(x, y + 1) !== I.kind, theme: I.theme, gas: I.kind === 'gas', color: I.color, glowing: I.glowing }); continue; }
    if (I.kind === 'hazard') { hazards.push({ x, y, block: b, theme: I.theme, up: kindAt(x, y - 1) === 'solid' || kindAt(x, y - 1) === 'oneway' ? 1 : kindAt(x, y + 1) === 'solid' ? -1 : 1 }); continue; }
    if (I.kind === 'none') continue;
    const [bx, by] = px(x, y);
    const same = (dx, dy) => (I.kind === 'oneway' ? kindAt(x + dx, y + dy) === 'oneway' && dy === 0 : connects(kindAt(x + dx, y + dy)));
    const mask = autotile === 'none' ? 255 : autotile === 'wang16' ? wangMask(same) : blobMask(same);
    const F = paintTile(buf, W, bx, by, T, I.theme, x, -y, mask, { mode: autotile, background: back || 0, oneway: I.kind === 'oneway', face: mode === 'topdown' && !back });
    if (decor && !back && I.kind === 'solid') for (const d of decorations(I.theme, x, -y, T, F)) decoQueue.push([bx + d.x, by + d.y, d.c]);
  }
  for (const [x, y, c] of decoQueue) { if (x < 0 || y < 0 || x >= W || y >= Hh) continue; const i = (y * W + x) * 4; if (buf[i + 3]) continue; const [r, g, b] = hexToRgb(c); buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255; }
  // Soft shadow under overhangs and beside walls, on open cells of the front layer.
  if (!back && solidAt && occlusion > 0) for (let y = y0; y < y0 + C; y++) for (let x = x0; x < x0 + C; x++) {
    if (solidAt(x, y)) continue;
    const above = solidAt(x, y + 1), left = solidAt(x - 1, y), right = solidAt(x + 1, y);
    if (!above && !left && !right) continue;
    const [bx, by] = px(x, y);
    for (let yy = 0; yy < T; yy++) for (let xx = 0; xx < T; xx++) {
      let a = 0;
      if (above) a = Math.max(a, (1 - yy / (T * 0.55)) * 0.55);
      if (left) a = Math.max(a, (1 - xx / (T * 0.3)) * 0.35);
      if (right) a = Math.max(a, (1 - (T - 1 - xx) / (T * 0.3)) * 0.35);
      if (a <= 0) continue;
      const i = ((by + yy) * W + bx + xx) * 4;
      if (buf[i + 3]) continue;
      buf[i + 3] = Math.round(Math.min(1, a * occlusion * 2) * 160);
    }
  }
  const canvas = surface(W, Hh), g = ctx2d(canvas);
  if (g) {
    const img = typeof ImageData !== 'undefined' ? new ImageData(buf, W, Hh) : g.createImageData?.(W, Hh);
    if (img && img.data !== buf) img.data.set?.(buf);
    if (img) g.putImageData?.(img, 0, 0);
  }
  return { canvas: g ? canvas : null, buf: g ? null : buf, w: W, h: Hh, liquids, hazards };
}

/** LRU of built chunks keyed by string; evicts the least recently drawn. */
export function chunkCache(max = 160) {
  const map = new Map();
  return {
    get(k) { const v = map.get(k); if (v) { map.delete(k); map.set(k, v); } return v; },
    set(k, v) { map.set(k, v); while (map.size > max) map.delete(map.keys().next().value); },
    delete: k => map.delete(k), clear: () => map.clear(), keys: () => map.keys(), get size() { return map.size; },
  };
}

/** Draw a hazard cell (spikes, thorns, embers) live, pointing away from its support. */
export function drawHazard(g, X, Y, s, theme, t, up = 1, kind = 'spikes') {
  const p = theme.palette;
  g.save(); g.translate(X, Y + (up > 0 ? s : 0)); g.scale(1, up > 0 ? 1 : -1);
  if (kind === 'thorns') {
    g.strokeStyle = shade(p.a, 0.2); g.lineWidth = Math.max(1, s * 0.12); g.lineCap = 'round';
    for (let k = 0; k < 3; k++) { const x = s * (0.2 + k * 0.3), sway = Math.sin(t * 2 + X * 0.1 + k) * s * 0.05; g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x - s * 0.15 + sway, -s * 0.4, x + sway, -s * 0.75); g.stroke(); g.fillStyle = light(p.b, 0.1); g.beginPath(); g.moveTo(x + sway, -s * 0.75); g.lineTo(x + s * 0.08 + sway, -s * 0.55); g.lineTo(x - s * 0.04 + sway, -s * 0.6); g.fill(); }
  } else {
    const n = 3, w = s / n;
    for (let k = 0; k < n; k++) {
      g.beginPath(); g.moveTo(k * w, 0); g.lineTo(k * w + w / 2, -s * 0.62); g.lineTo((k + 1) * w, 0); g.closePath();
      g.fillStyle = light(p.a, 0.35); g.fill(); g.strokeStyle = shade(p.c, 0.2); g.lineWidth = Math.max(1, s * 0.05); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.moveTo(k * w + w * 0.38, -s * 0.12); g.lineTo(k * w + w / 2, -s * 0.55); g.lineTo(k * w + w * 0.47, -s * 0.12); g.fill();
    }
    g.fillStyle = shade(p.a, 0.3); g.fillRect(0, -s * 0.08, s, s * 0.08);
  }
  g.restore();
}

/** Draw a liquid cell live: translucent body, moving surface highlight and caustic glints. */
export function drawLiquid(g, X, Y, s, color, t, top, glowing = false) {
  const [r, gg, b] = hexToRgb(color);
  g.fillStyle = `rgba(${r},${gg},${b},${glowing ? 0.85 : 0.55})`;
  if (top) {
    g.beginPath(); g.moveTo(X, Y + s);
    for (let i = 0; i <= 8; i++) { const xx = X + (i / 8) * s; g.lineTo(xx, Y + s * 0.18 + Math.sin(t * 2.4 + xx * 0.08) * s * 0.06); }
    g.lineTo(X + s, Y + s); g.closePath(); g.fill();
    g.strokeStyle = `rgba(255,255,255,${glowing ? 0.7 : 0.5})`; g.lineWidth = Math.max(1, s * 0.06); g.beginPath();
    for (let i = 0; i <= 8; i++) { const xx = X + (i / 8) * s, yy = Y + s * 0.18 + Math.sin(t * 2.4 + xx * 0.08) * s * 0.06; i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); }
    g.stroke();
  } else g.fillRect(X, Y, s + 0.5, s + 0.5);
  const k = Math.sin(t * 1.7 + X * 0.05 + Y * 0.09);
  if (k > 0.6) { g.fillStyle = `rgba(255,255,255,${(k - 0.6) * 0.5})`; g.fillRect(X + s * (0.2 + 0.5 * ((X * 7 + Y * 3) % 10) / 10), Y + s * 0.55, s * 0.18, Math.max(1, s * 0.05)); }
  if (glowing) { g.fillStyle = `rgba(255,230,140,${0.12 + 0.08 * Math.sin(t * 3 + X)})`; g.fillRect(X, Y + s * 0.25, s, s * 0.75); }
}
