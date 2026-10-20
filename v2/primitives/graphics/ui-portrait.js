// Portraits and figures for dialogue, battle, select and journal screens,
// painted from the same model specs the renderers use (catalog §5.2):
// pixel sprites (rect parts), voxel models (box parts, front view) and
// low-poly models (shapes, front view; humanoid rigs get a body). Anything
// else gets a silhouette medallion in a stable colour, so every character
// has a face. Pure geometry (portraitShapes) is separate from DOM output.
import { hex, shade, light, outlineOf } from '../../art/color.js';
import { h, hueColor } from './ui-lib.js';

const pal = (spec, c) => hex(spec.palette?.[c], null) || hex(c, null) || '#888888';

/** Resolve what to paint for a character id, archetype id or model id. */
export function modelFor(doc, id) {
  const models = doc.content?.models || {};
  const ch = doc.plot?.characters?.find(c => c.id === id);
  const arch = doc.content?.archetypes?.find(a => a.id === (ch?.archetype || id));
  const key = ch?.model || arch?.components?.model || id;
  return { id: key, spec: typeof key === 'string' ? models[key] : (typeof key === 'object' ? key : null), name: ch?.name || id, look: ch?.look || arch?.components?.look };
}

/**
 * Front-view shapes in a y-down box: { w, h, shapes:[{kind:'rect'|'ellipse'|'poly', x,y,w,h, points?, fill, stroke}], head:[cx,cy,r], pixel }.
 */
export function portraitShapes(spec) {
  if (!spec) return null;
  if (spec.kind === 'pixel' && Array.isArray(spec.parts)) {
    const [W, H] = spec.size || [16, 16];
    const shapes = spec.parts.map(p => { const [x, y, w, hh] = p.rect; return { kind: 'rect', x, y: H - y - hh, w, h: hh, fill: pal(spec, p.c), name: p.name }; });
    return { w: W, h: H, shapes, head: headOf(shapes, W, H), pixel: true };
  }
  if (spec.kind === 'voxel' && Array.isArray(spec.parts)) {
    const [W, H] = spec.size || [16, 32, 8];
    const parts = [...spec.parts].sort((a, b) => (b.box[2] + b.box[5]) - (a.box[2] + a.box[5]) || b.box[2] - a.box[2]);
    const shapes = [];
    for (const p of parts) {
      const [x, y, , w, hh] = p.box, fill = pal(spec, p.c), top = H - y - hh;
      shapes.push({ kind: 'rect', x, y: top, w, h: hh, fill, name: p.name });
      shapes.push({ kind: 'rect', x, y: top, w, h: Math.min(1, hh), fill: light(fill, 0.3), name: `${p.name}-lit` });
      shapes.push({ kind: 'rect', x: x + w - Math.min(1, w), y: top, w: Math.min(1, w), h: hh, fill: shade(fill, 0.25), name: `${p.name}-side` });
    }
    return { w: W, h: H, shapes, head: headOf(shapes, W, H), pixel: true };
  }
  if (spec.kind === 'lowpoly') {
    const H = spec.height || 1.8, W = H * 0.75, cx = W / 2, shapes = [];
    const P = k => pal(spec, k);
    const has = k => Boolean(spec.palette?.[k]);
    const toBox = (at, size) => ({ x: cx + at[0] - size[0] / 2, y: H - at[1] - size[1] / 2, w: size[0], h: size[1] });
    const extras = [...(spec.parts || [])].sort((a, b) => (a.at?.[2] ?? 0) - (b.at?.[2] ?? 0));
    const behind = extras.filter(p => (p.at?.[2] ?? 0) < 0), front = extras.filter(p => (p.at?.[2] ?? 0) >= 0);
    const draw = p => {
      const b = toBox(p.at || [0, H / 2, 0], p.size || [0.2, 0.2, 0.2]), fill = P(p.c);
      if (p.shape === 'sphere') shapes.push({ kind: 'ellipse', x: b.x, y: b.y, w: b.w, h: b.h, fill, name: p.name });
      else if (p.shape === 'cone') shapes.push({ kind: 'poly', points: [[b.x, b.y + b.h], [b.x + b.w / 2, b.y], [b.x + b.w, b.y + b.h]], fill, name: p.name });
      else shapes.push({ kind: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, r: p.shape === 'cyl' || p.shape === 'cap' ? b.w / 2 : 0.02, fill, name: p.name });
    };
    behind.forEach(draw);
    if (!spec.rig || spec.rig === 'humanoid') {
      const s = spec.build?.shoulders ?? 1, hs = spec.build?.head ?? 1, skin = has('skin') ? P('skin') : '#d8b090', cloth = has('cloth') ? P('cloth') : P(Object.keys(spec.palette || { c: 0 })[0]);
      const legs = has('boots') ? P('boots') : shade(cloth, 0.3), headR = 0.12 * H * hs;
      shapes.push({ kind: 'rect', x: cx - 0.17 * H * 0.5, y: H * 0.52, w: 0.075 * H, h: H * 0.47, r: 0.03, fill: legs, name: 'legL' });
      shapes.push({ kind: 'rect', x: cx + 0.01 * H, y: H * 0.52, w: 0.075 * H, h: H * 0.47, r: 0.03, fill: legs, name: 'legR' });
      shapes.push({ kind: 'rect', x: cx - 0.13 * H * s - 0.06 * H, y: H * 0.2, w: 0.06 * H, h: H * 0.34, r: 0.03, fill: shade(cloth, 0.12), name: 'armL' });
      shapes.push({ kind: 'rect', x: cx + 0.13 * H * s, y: H * 0.2, w: 0.06 * H, h: H * 0.34, r: 0.03, fill: shade(cloth, 0.12), name: 'armR' });
      shapes.push({ kind: 'rect', x: cx - 0.13 * H * s, y: H * 0.19, w: 0.26 * H * s, h: H * 0.36, r: 0.05, fill: cloth, name: 'torso' });
      if (has('trim')) shapes.push({ kind: 'rect', x: cx - 0.13 * H * s, y: H * 0.5, w: 0.26 * H * s, h: H * 0.04, fill: P('trim'), name: 'belt' });
      shapes.push({ kind: 'rect', x: cx - 0.035 * H, y: H * 0.15, w: 0.07 * H, h: H * 0.06, fill: shade(skin, 0.15), name: 'neck' });
      shapes.push({ kind: 'ellipse', x: cx - headR * 0.9, y: H * 0.15 - headR * 2, w: headR * 1.8, h: headR * 2.1, fill: skin, name: 'head' });
      if (has('hair')) shapes.push({ kind: 'ellipse', x: cx - headR * 0.98, y: H * 0.15 - headR * 2.15, w: headR * 1.96, h: headR * 1.15, fill: P('hair'), name: 'hair' });
      const eyeY = H * 0.15 - headR * 0.95;
      shapes.push({ kind: 'ellipse', x: cx - headR * 0.45, y: eyeY, w: headR * 0.22, h: headR * 0.28, fill: outlineOf(skin), name: 'eyeL' });
      shapes.push({ kind: 'ellipse', x: cx + headR * 0.23, y: eyeY, w: headR * 0.22, h: headR * 0.28, fill: outlineOf(skin), name: 'eyeR' });
    }
    front.forEach(draw);
    return { w: W, h: H, shapes, head: [cx, H * 0.15 - 0.12 * H, 0.14 * H], pixel: false };
  }
  return null;
}

// The head is the shape named head/face/hood, else the topmost quarter of the figure.
function headOf(shapes, W, H) {
  const s = shapes.find(x => /^(head|face|hood|helmet|skull)$/.test(x.name || ''));
  if (s) return [s.x + s.w / 2, s.y + s.h / 2, Math.max(s.w, s.h) / 2];
  const top = Math.min(...shapes.map(x => x.y));
  return [W / 2, top + H * 0.15, H * 0.18];
}

/** The dominant colour of a model (name plates, battle tints, map pins). */
export function portraitColor(doc, id) {
  const { spec } = modelFor(doc, id);
  const shapes = portraitShapes(spec)?.shapes || [];
  const area = new Map();
  for (const s of shapes) if (!/-lit$|-side$|eye/.test(s.name || '')) area.set(s.fill, (area.get(s.fill) || 0) + (s.w || 1) * (s.h || 1));
  return [...area].sort((a, b) => b[1] - a[1])[0]?.[0] || hueColor(id, 58, 60);
}

/**
 * An <svg> portrait. mode 'bust' frames head and shoulders; 'full' frames the figure.
 * Falls back to a medallion silhouette when the model cannot be painted.
 */
export function portrait(doc, id, { mode = 'bust', dom, flip = false } = {}) {
  const { spec, name } = modelFor(doc, id);
  const g = portraitShapes(spec);
  if (!g) return medallion(id, name, dom);
  let vb;
  if (mode === 'bust') { const [cx, cy, r] = g.head, size = Math.max(r * 4.2, Math.min(g.w, g.h) * 0.55); vb = [cx - size / 2, cy - size * 0.42, size, size]; }
  else { const size = Math.max(g.w, g.h) * 1.08; vb = [(g.w - size) / 2, (g.h - size) / 2 - g.h * 0.02, size, size]; }
  const svg = h('svg', { doc: dom, attrs: { viewBox: vb.map(v => +v.toFixed(3)).join(' '), 'shape-rendering': g.pixel ? 'crispEdges' : 'geometricPrecision', 'aria-label': name, role: 'img', preserveAspectRatio: 'xMidYMax meet' } });
  const root = h('g', { doc: dom, svg: true, attrs: flip ? { transform: `translate(${(vb[0] * 2 + vb[2]).toFixed(3)} 0) scale(-1 1)` } : {} });
  const sw = (g.pixel ? 0 : g.h * 0.008).toFixed(4);
  for (const s of g.shapes) {
    const stroke = g.pixel ? null : outlineOf(s.fill);
    const base = { fill: s.fill, ...(stroke ? { stroke, 'stroke-width': sw, 'stroke-linejoin': 'round' } : {}) };
    if (s.kind === 'ellipse') root.append(h('ellipse', { doc: dom, svg: true, attrs: { ...base, cx: s.x + s.w / 2, cy: s.y + s.h / 2, rx: s.w / 2, ry: s.h / 2 } }));
    else if (s.kind === 'poly') root.append(h('polygon', { doc: dom, svg: true, attrs: { ...base, points: s.points.map(p => p.join(',')).join(' ') } }));
    else root.append(h('rect', { doc: dom, svg: true, attrs: { ...base, x: s.x, y: s.y, width: s.w, height: s.h, ...(s.r ? { rx: s.r } : {}) } }));
  }
  svg.append(root);
  return svg;
}

function medallion(id, name, dom) {
  const c = hueColor(id || name, 50, 58);
  const svg = h('svg', { doc: dom, attrs: { viewBox: '0 0 100 100', role: 'img', 'aria-label': name || id } });
  svg.append(h('circle', { doc: dom, svg: true, attrs: { cx: 50, cy: 38, r: 19, fill: c, stroke: outlineOf(c), 'stroke-width': 2 } }));
  svg.append(h('path', { doc: dom, svg: true, attrs: { d: 'M14 100c2-24 17-38 36-38s34 14 36 38z', fill: shade(c, 0.25), stroke: outlineOf(c), 'stroke-width': 2 } }));
  svg.append(h('text', { doc: dom, svg: true, attrs: { x: 50, y: 45, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 800, fill: outlineOf(c), 'font-family': 'system-ui,sans-serif' }, text: String(name || id || '?').slice(0, 1).toUpperCase() }));
  return svg;
}
