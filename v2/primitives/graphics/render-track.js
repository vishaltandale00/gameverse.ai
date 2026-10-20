// graphics.render.track — pseudo-3D rail track for engine.space.track (lane
// runners, rail shooters, kart-style circuits), ported from the runner kit.
// The camera rides behind the leader; the track bends and rolls with seeded
// curve and hill functions measured from the camera's tangent (so the near
// track stays straight), with striped ground, ballast bed, sleepers and rails
// per lane, fogged roadside scenery (buildings and lamps, trees, rocks or
// pylons by theme), 3D-box obstacles (barriers, gates, trains), billboarded
// characters and pickups, speed lines and atmospheric fog.
import { ensureJuice } from './flat-juice.js';
import { hubOf, bindSpace, ORDER, checkBinding } from './flat-stage.js';
import { drawEntity, lookOf } from './flat-models.js';
import { sceneryImage, themeFor } from './flat-art.js';
import { TAU, mix, clamp, lerp, rgba, hash, seedOf, roundRect, col, isHex } from './flat-util.js';

const FAR = 95, SEG = 2.5, BACK = 5.2;
const OBSTACLE = /obstacle|barrier|wall|train|car|truck|block|gate|crate|hurdle|fence|cone/;

/** Track projection: pure, for tests. opts: { w, h, zc, camX, camH, curve, hill } → proj(X, Y, Z) → [sx, sy, k] | null. */
export function trackView({ w, h, zc, camX = 0, camH = 2.7, curve = () => 0, hill = () => 0 }) {
  const F = Math.min(h * 1.1, w * 0.95), horizon = h * 0.34;
  const d = 0.01, c0 = curve(zc), cd = (curve(zc + d) - c0) / d, h0 = hill(zc), hd = (hill(zc + d) - h0) / d;
  const proj = (X, Y, Z) => {
    const dz = Z - zc;
    if (dz < 0.25) return null;
    const ox = curve(Z) - c0 - cd * dz, oy = hill(Z) - h0 - hd * dz, k = F / dz;
    return [w / 2 + (X + ox - camX) * k, horizon + (camH - Y - oy) * k, k];
  };
  return { proj, zc, F, horizon, heading: cd, camX, camH };
}
export function curves(seed, { curvature = 1, hills = 1 } = {}) {
  const a = hash(seed) * 6, b = hash(seed + 1) * 6;
  return {
    curve: z => curvature * (9 * Math.sin(z / 130 + a) + 4.5 * Math.sin(z / 53 + 1.3 + b)),
    hill: z => hills * (2.4 * Math.sin(z / 95 + 0.4 + b) + 1.1 * Math.sin(z / 41 + a)),
  };
}

export default {
  id: 'graphics.render.track',
  card: {
    intent: 'Pseudo-3D rail/lane track renderer for track spaces: bending, rolling track with lanes, sleepers and rails, fogged roadside scenery by theme, 3D obstacle boxes, billboarded runners and pickups, chase camera and speed lines.',
    views: ['3p', 'side'],
    params: {
      scenery: { type: 'string', default: 'auto', options: ['auto', 'city', 'forest', 'desert', 'space', 'snow', 'none'], effect: 'roadside dressing' },
      curvature: { type: 'number', default: 1, min: 0, max: 3, effect: 'how much the track bends' },
      hills: { type: 'number', default: 1, min: 0, max: 3, effect: 'how much the track rolls' },
      rails: { type: 'boolean', default: true, effect: 'sleepers and rails per lane (off: a road with lane markings)' },
      groundColor: { type: 'string', default: '', effect: 'hex override for the verge' },
      speedLines: { type: 'boolean', default: true, effect: 'speed lines from the vanishing point at high speed' },
    },
    reads: ['content.models', 'content.archetypes'],
  },
  validate(config, doc, ctx, info) {
    const errs = checkBinding(doc, info, 'graphics.render.track', ['engine.space.track']);
    if (config.groundColor && !isHex(config.groundColor)) errs.push({ code: 'flat_color', path: `${info?.path || ''}.with.groundColor`, message: `'${config.groundColor}' is not a hex color` });
    return errs;
  },
  install(rt, config, instance) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt), space = bindSpace(rt, instance, ['track']), S = H.stage(space, 'track');
    ensureJuice(rt);
    const apiOf = () => { try { return rt.space(space); } catch { return null; } };
    const C = curves(seedOf(rt.doc.id || 'track'), config);
    const cam = { x: null, h: null };
    let view = null;
    const themeName = () => (config.scenery !== 'auto' ? config.scenery : (() => { const t = themeFor(rt.doc); return ['city', 'factory'].includes(t) ? 'city' : ['forest', 'jungle', 'meadow'].includes(t) ? 'forest' : ['desert'].includes(t) ? 'desert' : ['space'].includes(t) ? 'space' : ['snow'].includes(t) ? 'snow' : 'city'; })());
    S.renderer = {
      camera() {},
      transform(F, shake) {
        const api = apiOf(); if (!api) return null;
        const LW = api.config.laneWidth || 1, mid = (api.config.lanes - 1) / 2;
        const leader = rt.entity(api.config.leader || 'player') || F.player;
        const lp = leader ? (F.byId.get(leader.id)?.pos || leader.at) : [0, mid, 0.5];
        const zc = lp[0] - BACK;
        const targetX = (lp[1] - mid) * LW * 0.55;
        cam.x = cam.x == null ? targetX : lerp(cam.x, targetX, 0.12);
        const H0 = 2.7 + Math.max(0, (lp[2] || 0) - 0.5) * 0.45;
        cam.h = cam.h == null ? H0 : lerp(cam.h, H0, 0.15);
        view = trackView({ w: F.w, h: F.h, zc, camX: cam.x, camH: cam.h, ...C });
        view.LW = LW; view.mid = mid;
        const P = view.proj;
        const sx = shake?.[0] || 0, sy = shake?.[1] || 0;
        const toScreen = p => { const q = P((p[1] - mid) * LW, p[2] ?? 0, p[0]); return q ? [q[0] + sx, q[1] + sy] : [-9999, -9999]; };
        const lq = P((lp[1] - mid) * LW, 0, lp[0]);
        return { toScreen, unit: lq ? lq[2] : 40 };
      },
    };
    H.layer(ORDER.world, F => draw(F), { space, name: 'render.track' });

    const fog = (c, haze, dz) => mix(c, haze, clamp((dz - 12) / (FAR - 12), 0, 0.92));
    function quad(g, a, b, c, d, fill) { if (!a || !b || !c || !d) return; g.fillStyle = fill; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath(); g.fill(); }
    function box(g, v, X0, X1, Y0, Y1, Z0, Z1, colors, haze, decorate) {
      const z0 = Math.max(Z0, v.zc + 0.6); if (Z1 <= z0) return;
      const P = v.proj, f00 = P(X0, Y0, z0), f10 = P(X1, Y0, z0), f11 = P(X1, Y1, z0), f01 = P(X0, Y1, z0), b00 = P(X0, Y0, Z1), b10 = P(X1, Y0, Z1), b11 = P(X1, Y1, Z1), b01 = P(X0, Y1, Z1);
      if (!f00) return;
      const dz = z0 - v.zc, ox = C.curve(z0) - C.curve(v.zc) - v.heading * dz;
      if (X0 + ox > v.camX) quad(g, f00, b00, b01, f01, fog(colors.side, haze, dz));
      if (X1 + ox < v.camX) quad(g, f10, b10, b11, f11, fog(colors.side, haze, dz));
      if (Y1 < v.camH) quad(g, f01, f11, b11, b01, fog(colors.top, haze, dz));
      quad(g, f00, f10, f11, f01, fog(colors.front, haze, dz));
      if (decorate && Z0 >= v.zc + 0.6) decorate(f00, f10, f11, f01, dz);
    }
    function stripes(g, a, b, c, d, color, n) {
      g.save(); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath(); g.clip();
      const w = b[0] - a[0], hh = a[1] - d[1]; g.fillStyle = color;
      for (let i = -1; i < n + 1; i++) { const x = a[0] + (i / n) * w; g.beginPath(); g.moveTo(x, a[1]); g.lineTo(x + w / n / 2, a[1]); g.lineTo(x + w / n / 2 + hh * 0.6, d[1]); g.lineTo(x + hh * 0.6, d[1]); g.fill(); }
      g.restore();
    }

    function draw(F) {
      const api = apiOf(); if (!api || !view) return;
      const g = F.ctx, v = view, LW = v.LW, M = v.mid, lanes = api.config.lanes, HW = LW * (M + 0.5);
      const scen = themeName(), night = scen === 'space' || /night|neon/.test(`${rt.doc.title} ${rt.doc.logline}`.toLowerCase());
      const haze = scen === 'space' ? '#1a1440' : night ? '#2a3058' : scen === 'desert' ? '#f0d0a0' : scen === 'snow' ? '#e8f0f8' : '#c8dcf0';
      const ground = config.groundColor ? col(config.groundColor) : { city: '#6a6a70', forest: '#4a8a3a', desert: '#d8a860', space: '#2a2440', snow: '#e8eef6', none: '#5a5a60' }[scen] || '#5a7a4a';
      // Sky: painted scenery slid by the heading, or a gradient.
      const img = sceneryImage({ theme: scen === 'none' ? 'meadow' : scen === 'forest' ? 'forest' : scen, time: night ? 'night' : 'day' }, F.style === 'pixel', rt.doc.id);
      const hz = v.proj(0, 0, v.zc + FAR)?.[1] ?? v.horizon;
      if (img) { const ih = hz + F.h * 0.12, iw = ih * 1.5, off = ((-v.heading * 900 + v.zc * 0.4) % iw + iw) % iw; for (let x = -off; x < F.w; x += iw) g.drawImage(img.img, x, hz + F.h * 0.06 - ih, iw, ih); }
      else if (g.createLinearGradient) { const gr = g.createLinearGradient(0, 0, 0, hz); gr.addColorStop(0, night ? '#0a0c24' : '#4a8ae0'); gr.addColorStop(1, haze); g.fillStyle = gr; g.fillRect(0, 0, F.w, hz + 2); }
      g.fillStyle = fog(ground, haze, FAR); g.fillRect(0, hz, F.w, F.h - hz);
      const bed = mix('#7a7068', ground, 0.3), tie = '#5a4030', rail = '#d8dde6';
      const z0 = Math.floor((v.zc + 1) / SEG) * SEG;
      for (let Z = z0 + FAR; Z >= v.zc + 0.5; Z -= SEG) {
        const za = Z, zb = Math.max(v.zc + 0.4, Z - SEG), dz = za - v.zc, A = (x, y = 0) => v.proj(x, y, za), B = (x, y = 0) => v.proj(x, y, zb);
        const stripe = Math.floor(za / (SEG * 2)) % 2 === 0;
        quad(g, A(-60), A(60), B(60), B(-60), fog(stripe ? ground : mix(ground, '#000000', 0.08), haze, dz));
        const E = HW + 0.55;
        quad(g, A(-E - 0.5, 0.02), A(E + 0.5, 0.02), B(E + 0.5, 0.02), B(-E - 0.5, 0.02), fog(mix(ground, '#ffffff', 0.18), haze, dz));
        quad(g, A(-E), A(E), B(E), B(-E), fog(config.rails ? (stripe ? bed : mix(bed, '#000000', 0.07)) : (stripe ? '#3a3c44' : '#34363e'), haze, dz));
        if (!config.rails && stripe) for (let l = 1; l < lanes; l++) { const X = (l - M - 0.5) * LW; quad(g, A(X - 0.05, 0.03), A(X + 0.05, 0.03), B(X + 0.05, 0.03), B(X - 0.05, 0.03), fog('#f0f0f0', haze, dz)); }
      }
      if (config.rails) {
        const gap = 1.25;
        for (let Z = Math.floor((v.zc + FAR * 0.7) / gap) * gap; Z >= v.zc + 0.6; Z -= gap) { const dz = Z - v.zc; for (let l = 0; l < lanes; l++) { const X = (l - M) * LW; quad(g, v.proj(X - 0.68 * LW, 0.02, Z), v.proj(X + 0.68 * LW, 0.02, Z), v.proj(X + 0.68 * LW, 0.02, Z - 0.28), v.proj(X - 0.68 * LW, 0.02, Z - 0.28), fog(tie, haze, dz)); } }
        for (let Z = v.zc + FAR * 0.8; Z >= v.zc + 0.6; Z -= SEG) { const zb = Math.max(v.zc + 0.5, Z - SEG), dz = Z - v.zc, c = fog(rail, haze, dz); for (let l = 0; l < lanes; l++) for (const s of [-0.45, 0.45]) { const X = (l - M) * LW + s * LW; quad(g, v.proj(X - 0.045, 0.07, Z), v.proj(X + 0.045, 0.07, Z), v.proj(X + 0.045, 0.07, zb), v.proj(X - 0.045, 0.07, zb), c); } }
      }
      // Drawables far to near: roadside dressing, entities, obstacles.
      const items = [];
      if (scen !== 'none') {
        const step = 13;
        for (let i = Math.floor((v.zc + FAR) / step); i * step > v.zc - step; i--) for (const sgn of [-1, 1]) {
          const r = hash(i * 2 + (sgn > 0 ? 1 : 0)), Z = i * step + r * 4, x0 = sgn * (HW + 3.2 + r * 2.5);
          if (scen === 'city' || scen === 'snow') { const bw = 3 + r * 4, bh = 5 + hash(i * 7 + sgn) * 10; items.push({ z: Z + 6, draw: () => building(g, v, sgn > 0 ? x0 : x0 - bw, sgn > 0 ? x0 + bw : x0, bh, Z, Z + 10, ground, haze, night) }); if (hash(i * 11 + sgn) > 0.45) items.push({ z: Z, draw: () => lamp(g, v, sgn * (HW + 1.3), Z, haze, night) }); }
          else for (let k = 0; k < 3; k++) { const zz = Z + k * 4, xx = x0 + sgn * k * 1.4; items.push({ z: zz, draw: () => prop(g, v, scen, xx, zz, haze, hash(i * 5 + k)) }); }
        }
      }
      for (const it of F.entities) {
        const e = it.e, size = e.components?.body?.size || [1, 0.8, 1], L = lookOf(H, e, 'track');
        const z = it.pos[0], X = (it.pos[1] - M) * LW, base = Math.max(0, (it.pos[2] ?? size[2] / 2) - size[2] / 2);
        if (z - v.zc > FAR || z + size[0] / 2 < v.zc + 0.6) continue;
        const text = `${e.archetype} ${(rt.archetype(e.archetype)?.tags || []).join(' ')}`.toLowerCase();
        if ((L.role === 'hazard' || L.role === 'prop') && OBSTACLE.test(text) || (L.role === 'hazard' && size[2] >= 0.6)) items.push({ z: z + size[0] / 2, draw: () => obstacle(g, v, e, X, base, z, size, haze, text, F.t) });
        else items.push({ z, draw: () => { const q = v.proj(X, base, z); if (!q) return; const hpx = Math.max(4, size[2] * q[2]); drawEntity(F, it, { x: q[0], y: q[1], w: Math.max(4, size[1] * LW * q[2] * 0.9), h: hpx, view: 'track', unit: q[2], alpha: clamp((FAR * 0.9 - (z - v.zc)) / 10, 0, 1) }); } });
      }
      items.sort((a, b) => b.z - a.z);
      for (const it of items) it.draw();
      // Speed lines when the leader is fast.
      const lead = rt.entity(api.config.leader || 'player'), sp = Math.abs(lead?.components?.body?.vel?.[0] || 0);
      const k = clamp((sp - 8) / 20, 0, 1);
      if (config.speedLines && k > 0.05 && !F.reduced) {
        const vp = v.proj(0, 1, v.zc + FAR) || [F.w / 2, v.horizon];
        g.save(); g.strokeStyle = 'rgba(255,255,255,.55)';
        for (let i = 0; i < 6 + k * 16; i++) { const a = hash(i * 13) * TAU, ph = (F.t * (1.2 + hash(i) * 0.8) + hash(i * 7)) % 1, r0 = Math.max(F.w, F.h) * (0.25 + ph * 0.6), r1 = r0 + 30 + k * 90; g.globalAlpha = 0.12 + k * 0.25; g.lineWidth = 1 + (i % 3); g.beginPath(); g.moveTo(vp[0] + Math.cos(a) * r0, vp[1] + Math.sin(a) * r0); g.lineTo(vp[0] + Math.cos(a) * r1, vp[1] + Math.sin(a) * r1); g.stroke(); }
        g.restore();
      }
    }
    function building(g, v, X0, X1, Hh, Z0, Z1, ground, haze, night) {
      const base = night ? mix(ground, '#10142a', 0.55) : mix(ground, '#8a8aa0', 0.35), colors = { front: base, side: mix(base, '#000000', 0.22), top: mix(base, '#ffffff', 0.15) };
      box(g, v, X0, X1, 0, Hh, Z0, Z1, colors, haze, (a, b, c, d, dz) => {
        if (dz > 70) return;
        g.fillStyle = fog(night ? '#ffd678' : '#3a4660', haze, dz);
        const cols = 3, rows = Math.max(2, Math.floor(Hh / 2));
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
          if (night && hash(i * 5 + j * 11 + Math.round(Z0)) < 0.4) continue;
          const P = (u, w) => [lerp(lerp(a[0], b[0], u), lerp(d[0], c[0], u), w), lerp(lerp(a[1], b[1], u), lerp(d[1], c[1], u), w)];
          const q = [P((i + 0.25) / cols, (j + 0.3) / rows), P((i + 0.7) / cols, (j + 0.3) / rows), P((i + 0.7) / cols, (j + 0.75) / rows), P((i + 0.25) / cols, (j + 0.75) / rows)];
          g.beginPath(); q.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.fill();
        }
      });
    }
    function lamp(g, v, X, Z, haze, night) {
      const a = v.proj(X, 0, Z), b = v.proj(X, 4.2, Z); if (!a || !b) return;
      const dz = Z - v.zc; g.strokeStyle = fog('#3a3f4b', haze, dz); g.lineWidth = Math.max(1, a[2] * 0.12); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      g.fillStyle = night ? '#fff0b0' : fog('#e8e8f0', haze, dz); g.beginPath(); g.arc(b[0], b[1], Math.max(1.5, b[2] * 0.22), 0, TAU); g.fill();
      if (night && dz < 60 && g.createRadialGradient) { const gr = g.createRadialGradient(b[0], b[1], 0, b[0], b[1], b[2] * 2.2); gr.addColorStop(0, 'rgba(255,220,140,.35)'); gr.addColorStop(1, 'rgba(255,220,140,0)'); g.fillStyle = gr; g.beginPath(); g.arc(b[0], b[1], b[2] * 2.2, 0, TAU); g.fill(); }
    }
    function prop(g, v, scen, X, Z, haze, r) {
      const a = v.proj(X, 0, Z); if (!a) return; const dz = Z - v.zc, k = a[2];
      if (scen === 'forest') { const h = (2.5 + r * 2.5) * k, w = (1 + r * 0.6) * k; g.fillStyle = fog('#5a3a22', haze, dz); g.fillRect(a[0] - w * 0.12, a[1] - h * 0.35, w * 0.24, h * 0.35); g.fillStyle = fog(r > 0.5 ? '#2f7a3a' : '#3a8a3e', haze, dz); g.beginPath(); g.moveTo(a[0], a[1] - h); g.lineTo(a[0] + w, a[1] - h * 0.25); g.lineTo(a[0] - w, a[1] - h * 0.25); g.closePath(); g.fill(); }
      else if (scen === 'desert') { const h = (1.2 + r * 2) * k; g.fillStyle = fog('#4fae4a', haze, dz); roundRect(g, a[0] - h * 0.12, a[1] - h, h * 0.24, h, h * 0.12); g.fill(); g.fillRect(a[0] - h * 0.35, a[1] - h * 0.6, h * 0.24, h * 0.1); g.fillRect(a[0] - h * 0.35, a[1] - h * 0.8, h * 0.1, h * 0.3); }
      else if (scen === 'space') { const h = (3 + r * 3) * k; g.strokeStyle = fog('#7a80c0', haze, dz); g.lineWidth = Math.max(1, k * 0.1); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(a[0], a[1] - h); g.stroke(); g.fillStyle = rgba('#7af0ff', 0.6 + 0.4 * Math.sin(Z)); g.beginPath(); g.arc(a[0], a[1] - h, Math.max(1, k * 0.15), 0, TAU); g.fill(); }
      else { const s = (0.4 + r * 0.8) * k; g.fillStyle = fog('#8a8a90', haze, dz); g.beginPath(); g.ellipse(a[0], a[1] - s * 0.4, s, s * 0.6, 0, 0, TAU); g.fill(); }
    }
    function obstacle(g, v, e, X, base, z, size, haze, text, t) {
      const L = v.LW, w = size[1] * L * 0.5, dz = z - v.zc, front = z - size[0] / 2, back = z + size[0] / 2;
      if (/train|car|truck/.test(text)) {
        const c = /train/.test(text) ? '#3a6a8a' : '#d83a2a', colors = { front: mix(c, '#ffffff', 0.08), side: mix(c, '#000000', 0.25), top: mix(c, '#ffffff', 0.25) };
        box(g, v, X - w, X + w, base, base + size[2], front, back, colors, haze, (a, b, cc, d, dzz) => {
          const P = (u, ww) => [lerp(lerp(a[0], b[0], u), lerp(d[0], cc[0], u), ww), lerp(lerp(a[1], b[1], u), lerp(d[1], cc[1], u), ww)];
          const poly = (pts, fill) => { g.fillStyle = fill; g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.fill(); };
          poly([P(0.14, 0.52), P(0.86, 0.52), P(0.86, 0.85), P(0.14, 0.85)], fog('#1a2a3a', haze, dzz));
          poly([P(0, 0.3), P(1, 0.3), P(1, 0.36), P(0, 0.36)], fog('#f5c542', haze, dzz));
          const r = Math.abs(b[0] - a[0]) * 0.09; for (const u of [0.2, 0.8]) { const [hx, hy] = P(u, 0.15); g.fillStyle = fog('#ffe08a', haze, dzz); g.beginPath(); g.arc(hx, hy, r, 0, TAU); g.fill(); }
        });
      } else if (size[2] < 1.2 && base < 0.3) {
        box(g, v, X - w, X + w, base + 0.15, base + size[2], front, front + 0.25, { front: '#e8402a', side: '#a02a1a', top: '#ff7a5a' }, haze, (a, b, c, d) => stripes(g, a, b, c, d, fog('#ffffff', haze, dz), 4));
        for (const s of [-0.9, 0.75]) box(g, v, X + s * w, X + s * w + 0.1, base, base + 0.2, front + 0.05, front + 0.2, { front: '#3a3f4b', side: '#2a2d36', top: '#5c6370' }, haze);
      } else if (base > 0.6) {
        for (const s of [-1, 0.86]) box(g, v, X + s * w, X + s * w + 0.12, 0, base + size[2], front, front + 0.15, { front: '#5c6370', side: '#3a3f4b', top: '#9aa3b0' }, haze);
        box(g, v, X - w, X + w, base, base + size[2], front, front + 0.15, { front: '#f5c542', side: '#b08a20', top: '#ffe08a' }, haze, (a, b, c, d) => stripes(g, a, b, c, d, fog('#1a1a22', haze, dz), 5));
        const q = v.proj(X, base + size[2] + 0.25, front); if (q && dz < 50 && dz > 2) { g.fillStyle = Math.floor(t * 4 + z) % 2 === 0 ? "#ff3a3a" : "#5a2020"; g.beginPath(); g.arc(q[0], q[1], Math.min(9, Math.max(1.5, q[2] * 0.1)), 0, TAU); g.fill(); }
      } else {
        const c = '#6a7a8a', colors = { front: c, side: mix(c, '#000', 0.25), top: mix(c, '#fff', 0.2) };
        box(g, v, X - w, X + w, base, base + size[2], front, back, colors, haze, (a, b, cc, d) => stripes(g, a, b, cc, d, fog('#f5c542', haze, dz), 6));
      }
    }
  },
};
