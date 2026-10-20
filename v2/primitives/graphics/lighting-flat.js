// graphics.lighting.flat (catalog: graphics.lighting.2d; the registry id pattern rejects a digit-led segment, see kernel/requests/flat.md) — dynamic 2D light over any flat renderer: an ambient
// darkness level (per zone from darkZones or zone rules.light, crossfading),
// soft radial lights that follow entities (by id, archetype or tag; entities
// with a light component or a glowing model light themselves), flicker, and
// shadow-casting lights whose rays stop at solid cells of tile and grid
// spaces. Darkness is punched out of a half-resolution light map, then the
// lights add a colored glow.
import { hubOf, bindAny, ORDER } from './flat-stage.js';
import { terrain } from './render-tilemap.js';
import { lookOf } from './flat-models.js';
import { TAU, rgba, col, isHex, clamp01, lerp, surface, ctx2d, noise1, seedOf } from './flat-util.js';

/** Visibility polygon (world points) from p within radius r over a solid(x, y) cell test. Pure. */
export function lightPolygon(p, r, solid, rays = 96) {
  const pts = [];
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * TAU, dx = Math.cos(a), dy = Math.sin(a);
    // DDA through cells.
    let cx = Math.floor(p[0]), cy = Math.floor(p[1]), t = r;
    const sx = Math.sign(dx), sy = Math.sign(dy), tdx = Math.abs(1 / (dx || 1e-9)), tdy = Math.abs(1 / (dy || 1e-9));
    let tx = (sx > 0 ? cx + 1 - p[0] : p[0] - cx) * tdx, ty = (sy > 0 ? cy + 1 - p[1] : p[1] - cy) * tdy;
    for (let guard = 0; guard < 256; guard++) {
      const tn = Math.min(tx, ty); if (tn > r) break;
      if (tx < ty) { cx += sx; tx += tdx; } else { cy += sy; ty += tdy; }
      if (solid(cx, cy)) { t = tn + 0.25; break; }
    }
    pts.push([p[0] + dx * Math.min(r, t), p[1] + dy * Math.min(r, t)]);
  }
  return pts;
}

export default {
  id: 'graphics.lighting.flat',
  card: {
    intent: 'Dynamic 2D lighting: zone darkness (darkZones or zone rules.light) with crossfades, flickering radial lights following entities, archetypes or tags, automatic lights for light carriers, and shadow-casting rays against solid cells.',
    views: ['side', 'td', 'board'],
    params: {
      ambient: { type: 'number', default: 0.35, min: 0, max: 1, effect: 'brightness where it is dark (0 black, 1 fully lit)' },
      lights: { type: 'list', default: [], of: { type: 'object', fields: {
        follow: { type: 'string', required: true, effect: 'entity id, archetype, tag or player' },
        radius: { type: 'number', default: 5, min: 0.2, max: 64, unit: 'tiles' }, color: { type: 'string', default: '#ffd890' },
        flicker: { type: 'number', default: 0.05, min: 0, max: 1 }, shadow: { type: 'boolean', default: false, effect: 'rays stop at solid cells' }, intensity: { type: 'number', default: 1, min: 0, max: 2 },
      } }, effect: 'lights carried by entities' },
      darkZones: { type: 'list', default: [], of: { type: 'ref', to: 'zone' }, effect: 'zones at the ambient level (elsewhere lit); empty = darkness everywhere' },
      tint: { type: 'string', default: '#06040e', effect: 'color of the darkness' },
      auto: { type: 'boolean', default: true, effect: 'entities with a light component or glowing model emit light' },
      rays: { type: 'integer', default: 96, min: 16, max: 360, effect: 'shadow ray count per light' },
      max: { type: 'integer', default: 24, min: 1, max: 128, effect: 'most lights drawn (nearest the camera)' },
    },
  },
  validate(config) {
    const errs = [];
    config.lights.forEach((l, i) => { if (!isHex(l.color)) errs.push({ code: 'flat_color', path: `lights[${i}].color`, message: `'${l.color}' is not a hex color` }); });
    if (!isHex(config.tint)) errs.push({ code: 'flat_color', path: 'tint', message: `'${config.tint}' is not a hex color` });
    return errs;
  },
  install(rt, config, instance) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt), space = bindAny(rt, instance);
    H.cfg.lighting = config;
    let level = null, buf = null, bctx = null;
    const zoneLight = F => {
      const sp = F.doc.spaces.find(s => s.id === space), z = sp?.zones?.find(x => x.id === F.zone);
      if (Number.isFinite(z?.rules?.light)) return clamp01(z.rules.light);
      if (!config.darkZones.length) return config.ambient;
      return config.darkZones.includes(F.zone) ? config.ambient : 1;
    };
    H.layer(ORDER.lighting, F => {
      const target = zoneLight(F);
      level = level == null ? target : lerp(level, target, clamp01((F.realDt || 1 / 60) * 1.6));
      if (level > 0.985) return;
      const g = F.ctx, sc = 0.5, w = Math.ceil(F.w * sc), h = Math.ceil(F.h * sc);
      if (!buf || buf.width !== w || buf.height !== h) { buf = surface(w, h); bctx = ctx2d(buf); }
      if (!bctx) return;
      bctx.setTransform?.(1, 0, 0, 1, 0, 0);
      bctx.globalCompositeOperation = 'source-over'; bctx.clearRect(0, 0, w, h);
      bctx.fillStyle = rgba(config.tint, 1 - level); bctx.fillRect(0, 0, w, h);
      // Collect lights: configured followers plus light carriers.
      const lights = [];
      for (const L of config.lights) for (const it of F.entities) {
        if (it.ghost) continue;
        const arch = rt.archetype(it.e.archetype);
        if (L.follow === it.id || L.follow === it.e.archetype || (L.follow === 'player' && it.id === 'player') || arch?.tags?.includes(L.follow) || it.e.components?.interact?.id === L.follow) lights.push({ ...L, it });
      }
      if (config.auto) for (const it of F.entities) {
        if (it.ghost || lights.some(l => l.it === it)) continue;
        const lc = it.e.components?.light, look = lookOf(H, it.e, 'side');
        if (lc) lights.push({ radius: lc.radius || 4, color: col(lc.color, '#ffd890'), flicker: 0.05, shadow: false, intensity: 1, it });
        else if (look.glow) lights.push({ radius: Math.max(1.5, (look.glow.radius || 3) / 3), color: col(look.glow.color, '#ffd890'), flicker: 0.08, shadow: false, intensity: 0.7, it });
        else if (look.role === 'pickup' || look.role === 'goal') lights.push({ radius: look.role === 'goal' ? 3 : 1.2, color: look.role === 'goal' ? '#fff2a0' : '#ffe680', flicker: 0.02, shadow: false, intensity: 0.5, it });
      }
      const cx = F.cam.x, cy = F.cam.y;
      lights.sort((a, b) => Math.hypot(a.it.pos[0] - cx, a.it.pos[1] - cy) - Math.hypot(b.it.pos[0] - cx, b.it.pos[1] - cy));
      let api = null; try { api = rt.space(space); } catch { /* */ }
      const T = api?.kind === 'tilemap' ? terrain(H, F, api) : null;
      const solid = api?.kind === 'tilemap' ? (x, y) => { const b = api.getCell([x, y]); return b != null && T.info(b).kind === 'solid'; } : api?.kind === 'grid' ? (x, y) => { const b = api.getCell([x, y]); const r = b != null && api.config?.rules?.[b]; return b != null && (r ? r.pass === false || r.opaque === true : rt.doc.content?.blocks?.find(q => q.id === b)?.solid === true); } : null;
      const glows = [];
      for (const L of lights.slice(0, config.max)) {
        const body = L.it.e.components?.body, size = body?.size || [1, 1];
        const center = api?.kind === 'grid' ? (api.cellCenter ? api.cellCenter(L.it.pos) : L.it.pos) : [L.it.pos[0], L.it.pos[1] + (api?.anchor === 'center' ? size[1] * 0.15 : 0)];
        const fl = 1 + (F.reduced ? 0 : L.flicker * (noise1(F.t * 9, seedOf(L.it.id) % 97) * 0.7 + Math.sin(F.t * 23 + seedOf(L.it.id)) * 0.3));
        const r = L.radius * fl * L.intensity, s = F.toScreen(center), rp = r * F.unit;
        if (s[0] < -rp || s[1] < -rp || s[0] > F.w + rp || s[1] > F.h + rp) continue;
        bctx.save(); bctx.scale(sc, sc); bctx.globalCompositeOperation = 'destination-out';
        if (L.shadow && solid) { const poly = lightPolygon(center, r, solid, config.rays).map(F.toScreen); bctx.beginPath(); poly.forEach((p, i) => (i ? bctx.lineTo(p[0], p[1]) : bctx.moveTo(p[0], p[1]))); bctx.closePath(); bctx.clip(); }
        if (bctx.createRadialGradient) { const gr = bctx.createRadialGradient(s[0], s[1], 0, s[0], s[1], rp); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgba(0,0,0,.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); bctx.fillStyle = gr; }
        else bctx.fillStyle = 'rgba(0,0,0,.8)';
        bctx.fillRect(s[0] - rp, s[1] - rp, rp * 2, rp * 2);
        bctx.restore();
        glows.push({ s, rp, color: col(L.color, '#ffd890'), k: (1 - level) * 0.35 * L.intensity });
      }
      g.drawImage(buf, 0, 0, F.w, F.h);
      // Colored light on top of the lit areas.
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const q of glows) { if (!g.createRadialGradient) break; const gr = g.createRadialGradient(q.s[0], q.s[1], 0, q.s[0], q.s[1], q.rp * 0.8); gr.addColorStop(0, rgba(q.color, q.k)); gr.addColorStop(1, rgba(q.color, 0)); g.fillStyle = gr; g.fillRect(q.s[0] - q.rp, q.s[1] - q.rp, q.rp * 2, q.rp * 2); }
      g.restore();
    }, { space, name: 'lighting.2d' });
  },
};
