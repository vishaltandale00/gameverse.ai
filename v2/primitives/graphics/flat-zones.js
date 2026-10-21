// What the flat renderers draw for a space beyond its cells and entities, from declarations (graphics/presentation.js):
// the zones the document's loops name (checkpoints, goal mouths) with their names, the per-cell marks primitives publish
// (crop stages), the labels blocks declare (a 2048 tile's number), and a distinct color for every block that declares
// none, so no two blocks ever look alike by construction.
import { shownZones, markServices } from './presentation.js';
import { rgba, light, shade, col, label, TAU } from './flat-util.js';
import { glow } from './flat-vector.js';

/** Colors given, in content.blocks order, to blocks that declare no color (distinct hues, readable on dark and light floors). */
export const BLOCK_PALETTE = Object.freeze(['#e8504a', '#f0a030', '#f2d43a', '#5cc25a', '#3aa6e8', '#9b6cf0', '#ec6fb0', '#3fc9b8', '#c08a52', '#8a96a8', '#d85a8a', '#7ad03a']);
const blockIndex = new WeakMap();
/** A block's color: the one it declares, else its content.blocks position's palette color. */
export function blockColorOf(doc, id) {
  const blocks = doc?.content?.blocks || [];
  let m = blockIndex.get(blocks);
  if (!m) { m = new Map(blocks.map((b, i) => [b.id, { b, i }])); blockIndex.set(blocks, m); }
  const e = m.get(id);
  if (!e) return '#7a8aa0';
  return col(e.b.color, BLOCK_PALETTE[e.i % BLOCK_PALETTE.length]);
}

const zoneCache = new WeakMap();
/** The zone ids this document's loops show (cached per document and registry). */
export function zonesShown(doc, registry) {
  if (!doc || !registry) return new Set();
  let m = zoneCache.get(doc);
  if (!m) { m = new WeakMap(); zoneCache.set(doc, m); }
  let z = m.get(registry);
  if (!z) { z = shownZones(doc, registry); m.set(registry, z); }
  return z;
}
const zoneColor = i => ['#ffd23f', '#4fd8ff', '#ff6a8a', '#7adf8a', '#c084ff', '#ff9a3a'][i % 6];
const titleCase = s => String(s).replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());

/**
 * Draw the shown zones of a plane space (rect zones; grid zones as rect or cells, whose cells are centred on integers).
 * `cellAnchored`: the space's integer positions are cell centres (engine.space.grid).
 */
export function drawZones(F, api, { cellAnchored = false } = {}) {
  const rt = F.hub.rt, ids = zonesShown(rt.doc, rt.registry);
  if (!ids.size || !api?.zones) return;
  const g = F.ctx, z = F.unit, off = cellAnchored ? 0.5 : 0;
  let i = 0;
  for (const id of ids) {
    const zone = api.zones.get?.(id); if (!zone) continue;
    const c = zoneColor(i++), boxes = zone.rect ? [[zone.rect[0] - off, zone.rect[1] - off, zone.rect[2] - off, zone.rect[3] - off]] : (zone.cells || []).map(([x, y]) => [x - 0.5, y - 0.5, x + 0.5, y + 0.5]);
    if (!boxes.length) continue;
    let top = null;
    for (const [x0, y0, x1, y1] of boxes) {
      const a = F.toScreen([x0, y0]), b = F.toScreen([x1, y1]);
      const sx = Math.min(a[0], b[0]), sy = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
      g.save(); g.fillStyle = rgba(c, 0.16 + 0.06 * Math.sin(F.t * 3)); g.fillRect(sx, sy, w, h);
      g.strokeStyle = rgba(c, 0.85); g.lineWidth = Math.max(1.5, z * 0.08); g.setLineDash?.([Math.max(3, z * 0.3), Math.max(2, z * 0.2)]); g.strokeRect(sx, sy, w, h); g.restore();
      if (!top || sy < top[1]) top = [sx + w / 2, sy];
    }
    // Its name (the themed one) above it, so a person knows what the area is.
    label(g, zone.name || titleCase(id), top[0], top[1] - Math.max(8, z * 0.35), { size: Math.max(10, Math.min(18, z * 0.45)), color: light(c, 0.3) });
  }
}

/** Per-cell marks every service the document's primitives name (card.marks) publishes for a space. */
export function marksOf(rt, spaceId) {
  const out = [];
  for (const name of markServices(rt.doc, rt.registry)) {
    let list = [];
    try { list = rt.service(name)?.marks?.(spaceId) || []; } catch { list = []; }
    for (const m of list) if (Array.isArray(m?.at)) out.push(m);
  }
  return out;
}
/** Draw one mark centred at screen (x, y), R the cell radius in px: a sprout growing with its stage, ripe when ready. */
export function drawMark(g, m, x, y, R, t) {
  const k = Math.max(0, Math.min(1, (Number(m.stage) || 0) / Math.max(1, Number(m.stages) || 1)));
  g.save(); g.translate(x, y);
  const stem = '#4fae4a', leaf = light(stem, 0.15);
  const h = R * (0.3 + 0.6 * k);
  g.strokeStyle = shade(stem, 0.2); g.lineWidth = Math.max(1.5, R * 0.12); g.lineCap = 'round';
  g.beginPath(); g.moveTo(0, R * 0.45); g.lineTo(0, R * 0.45 - h); g.stroke();
  g.fillStyle = leaf;
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * R * 0.22 * (0.6 + k), R * 0.45 - h * 0.6, R * 0.22 * (0.5 + k), R * 0.1 * (0.5 + k), s * 0.6, 0, TAU); g.fill(); }
  if (m.ready) { glow(g, 0, R * 0.45 - h, R * 0.9, '#ffd23f', 0.5 + 0.1 * Math.sin(t * 5)); g.fillStyle = '#ff8a3a'; g.beginPath(); g.arc(0, R * 0.45 - h, R * 0.24, 0, TAU); g.fill(); }
  if (m.watered) { g.fillStyle = rgba('#3aa6e8', 0.8); g.beginPath(); g.arc(R * 0.42, R * 0.32, R * 0.09, 0, TAU); g.fill(); }
  g.restore();
}
/** Draw a block's declared label centred at screen (x, y) in a cell of R px radius. */
export function drawLabel(g, text, x, y, R) {
  const s = String(text);
  label(g, s, x, y, { size: Math.max(9, R * (s.length > 3 ? 0.6 : s.length > 2 ? 0.75 : 0.95)), color: '#ffffff' });
}
