// Shared model and canvas drawing for graphics.ui.map and graphics.ui.minimap.
// mapModel() is pure: zones with discovery and the current zone, the player's
// position and heading, markers by tag, and quest pins, in map-plane
// coordinates (see ui-spatial). drawMap() paints a model through a transform.
import { spaceGeometry, project, heading, insideShape } from './ui-spatial.js';
import { hashHue, titleCase } from './ui-lib.js';
import * as S from './ui-sources.js';

export const TRAVEL_TAGS = ['fast_travel', 'travel', 'bench', 'shrine', 'hub', 'checkpoint', 'town', 'camp', 'station'];

const geoCache = new WeakMap();
export function geometryFor(rt, spaceId) {
  const space = rt.doc.spaces.find(s => s.id === spaceId) || rt.doc.spaces[0];
  let byDoc = geoCache.get(rt.doc); if (!byDoc) geoCache.set(rt.doc, (byDoc = new Map()));
  if (!byDoc.has(space.id)) byDoc.set(space.id, spaceGeometry(space, rt.doc.player?.at));
  return { space, geo: byDoc.get(space.id) };
}

/** Does an entity carry a marker tag (archetype/character/component tags, kind, or a component named like the tag)? */
export function entityHasTag(rt, e, tag) {
  const arch = rt.archetype(e.archetype), ch = rt.doc.plot?.characters?.find(c => c.id === e.id);
  if ((arch?.tags || []).includes(tag) || (e.components?.tags || []).includes(tag) || (ch?.tags || []).includes(tag)) return true;
  if (arch?.kind === tag || (tag === 'enemy' && arch?.kind === 'boss')) return true;
  return Boolean(e.components && tag in e.components && typeof e.components[tag] === 'object');
}

/**
 * opts: { markers: [{tag, icon, color}], quests: true, fog: true }
 * Returns { space, plane, graph, zones:[{id,name,tags,shape,center,discovered,current,travel}], edges, player:{pos,heading}|null, markers:[{id,pos,icon,color,tag}], pins:[{zone,pos,kind,label,tracked}], bounds }
 */
export function mapModel(rt, opts = {}) {
  const p = rt.player();
  const { space, geo } = geometryFor(rt, p?.space);
  const graph = geo.graph;
  const here = p ? (graph ? geo.zones.find(z => z.id === p.at)?.center : project(p.at, geo.plane)) : null;
  const currentZone = p ? (graph ? p.at : p.zone || geo.zones.find(z => here && insideShape(z.shape, here))?.id) : null;
  const zones = geo.zones.map(z => ({ ...z, discovered: !opts.fog || S.discovered(rt, z.id) || z.id === currentZone, current: z.id === currentZone, travel: TRAVEL_TAGS.some(t => z.tags.includes(t)) }));
  const markers = [];
  if (opts.markers?.length) for (const e of Object.values(rt.state.entities)) {
    if (e.id === 'player' || e.space !== space.id || e.components?.health?.dead) continue;
    const m = opts.markers.find(mk => entityHasTag(rt, e, mk.tag)); if (!m) continue;
    const pos = graph ? geo.zones.find(z => z.id === e.at)?.center : project(e.at, geo.plane);
    if (pos) markers.push({ id: e.id, pos, icon: m.icon, color: m.color, tag: m.tag });
  }
  const pins = [];
  if (opts.quests !== false) {
    const list = S.quests(rt), tracked = S.trackedQuest(list);
    for (const q of list) {
      if (q.state === 'active') for (const o of q.objectives || []) {
        if (o.state === 'done' || o.hidden) continue;
        const zid = o.zone || (o.kind === 'talk' && rt.entity(o.character)?.zone) || null;
        const z = zid && zones.find(x => x.id === zid);
        if (z) { pins.push({ zone: z.id, pos: z.center, kind: 'objective', label: o.text || titleCase(o.id), quest: q.id, tracked: q === tracked }); break; }
      }
      if (q.state === 'available' && q.zone) { const z = zones.find(x => x.id === q.zone); if (z) pins.push({ zone: z.id, pos: z.center, kind: 'available', label: q.title || titleCase(q.id), quest: q.id, tracked: false }); }
    }
  }
  return { space: space.id, plane: geo.plane, graph, zones, edges: geo.edges, player: here ? { pos: here, heading: graph ? null : heading(p, geo.plane) } : null, markers, pins, bounds: geo.bounds, currentZone };
}

/** Zone fill colour: tag-aware, stable per id. */
export function zoneColor(z) {
  const t = z.tags || [];
  const hue = t.includes('water') || t.includes('docks') ? 205 : t.includes('cave') || t.includes('dark') ? 265 : t.includes('forest') || t.includes('moss') ? 120 : t.includes('desert') || t.includes('ash') ? 35 : t.includes('snow') || t.includes('frost') ? 195 : t.includes('city') || t.includes('district') ? 220 : hashHue(z.id);
  return { hue, fill: `hsla(${hue},32%,38%,0.55)`, edge: `hsla(${hue},45%,70%,0.75)` };
}

/**
 * Paint a model. tf: { scale, cx, cy, ou, ov, rot } maps plane (u,v) to canvas pixels:
 * x = cx + ((u-ou)cosθ - (v-ov)sinθ)·scale, y = cy - ((u-ou)sinθ + (v-ov)cosθ)·scale.
 * o: { selected, labels, dpr, time, iconGlyph(icon) }
 */
export function drawMap(ctx, model, tf, o = {}) {
  const dpr = o.dpr || 1, c = Math.cos(tf.rot || 0), s = Math.sin(tf.rot || 0);
  const X = (u, v) => [tf.cx + ((u - tf.ou) * c - (v - tf.ov) * s) * tf.scale, tf.cy - ((u - tf.ou) * s + (v - tf.ov) * c) * tf.scale];
  const path = shape => {
    ctx.beginPath();
    if (shape.kind === 'circle') { const [x, y] = X(...shape.c); ctx.arc(x, y, Math.max(2 * dpr, shape.r * tf.scale), 0, Math.PI * 2); return; }
    shape.points.forEach((p, i) => { const [x, y] = X(...p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath();
  };
  // Graph edges first.
  ctx.lineCap = 'round';
  for (const [a, b, gated] of model.edges || []) {
    const za = model.zones.find(z => z.id === a), zb = model.zones.find(z => z.id === b);
    if (!za || !zb || (!za.discovered && !zb.discovered)) continue;
    ctx.strokeStyle = gated ? 'rgba(255,190,90,0.6)' : 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2.5 * dpr;
    ctx.setLineDash?.(gated ? [6 * dpr, 6 * dpr] : []);
    ctx.beginPath(); ctx.moveTo(...X(...za.center)); ctx.lineTo(...X(...zb.center)); ctx.stroke();
  }
  ctx.setLineDash?.([]);
  for (const z of model.zones) {
    const col = zoneColor(z);
    path(z.shape);
    ctx.fillStyle = z.discovered ? col.fill : 'rgba(10,12,18,0.85)'; ctx.fill();
    ctx.lineWidth = (z.current ? 2.5 : z.id === o.selected ? 3 : 1.2) * dpr;
    ctx.strokeStyle = z.id === o.selected ? '#ffd36a' : z.current ? 'rgba(255,255,255,0.9)' : z.discovered ? col.edge : 'rgba(255,255,255,0.12)';
    ctx.stroke();
    if (z.travel && z.discovered) { const [x, y] = X(...z.center); ctx.fillStyle = '#7ad8ff'; ctx.beginPath(); ctx.arc(x, y - 12 * dpr, 3.5 * dpr, 0, Math.PI * 2); ctx.fill(); }
  }
  if (o.labels !== false) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(11 * dpr)}px system-ui, sans-serif`;
    for (const z of model.zones) {
      if (!z.discovered && !o.showUnknown) continue;
      const [x, y] = X(...z.center);
      ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.fillStyle = z.discovered ? '#f4f1ea' : 'rgba(244,241,234,0.4)';
      const label = z.discovered ? z.name : '?';
      ctx.strokeText(label, x, y + (model.graph ? 16 * dpr : 0)); ctx.fillText(label, x, y + (model.graph ? 16 * dpr : 0));
    }
  }
  for (const m of model.markers || []) dot(X(...m.pos), m.color || '#ffffff', 3.5 * dpr, m.icon);
  for (const p of model.pins || []) {
    const [x, y] = X(...p.pos), pulse = 1 + 0.18 * Math.sin((o.time || 0) * 4);
    ctx.fillStyle = p.kind === 'available' ? '#ffd36a' : p.tracked ? '#ffb347' : '#f2e6c8';
    ctx.beginPath(); ctx.moveTo(x, y - 4 * dpr); ctx.arc(x, y - 12 * dpr * pulse, 6 * dpr * pulse, Math.PI * 0.8, Math.PI * 2.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1a1206'; ctx.font = `900 ${Math.round(9 * dpr)}px system-ui, sans-serif`; ctx.fillText(p.kind === 'available' ? '!' : '•', x, y - 12 * dpr * pulse);
  }
  for (const p of o.userPins || []) { const z = model.zones.find(x => x.id === p); if (z) dot(X(...z.center), '#ff6ad5', 4.5 * dpr, '◆'); }
  if (model.player) {
    const [x, y] = X(...model.player.pos), h = model.player.heading;
    ctx.save(); ctx.translate(x, y);
    if (h !== null && h !== undefined) ctx.rotate(h - (tf.rot || 0));
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#11131a'; ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    if (h === null || h === undefined) ctx.arc(0, 0, 5 * dpr, 0, Math.PI * 2);
    else { ctx.moveTo(0, -8 * dpr); ctx.lineTo(6 * dpr, 6 * dpr); ctx.lineTo(0, 3 * dpr); ctx.lineTo(-6 * dpr, 6 * dpr); ctx.closePath(); }
    ctx.fill(); ctx.stroke(); ctx.restore();
  }
  function dot([x, y], color, r, glyph) {
    ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(x, y, r + 3 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (glyph && String(glyph).length <= 2) { ctx.fillStyle = '#11131a'; ctx.font = `900 ${Math.round(8 * dpr)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(glyph), x, y + 0.5); }
  }
  return X;
}

/** Fit bounds [u0,v0,u1,v1] into a w×h canvas with padding: a transform for drawMap. */
export function fitTransform(bounds, w, h, pad = 40) {
  const [u0, v0, u1, v1] = bounds, bw = Math.max(1e-6, u1 - u0), bh = Math.max(1e-6, v1 - v0);
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  return { scale, cx: w / 2, cy: h / 2, ou: (u0 + u1) / 2, ov: (v0 + v1) / 2, rot: 0 };
}
