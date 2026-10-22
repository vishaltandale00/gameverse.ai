// Parallax backdrop: the painted art.background (mirrored tiles so seams
// never show) behind code-drawn silhouette layers that scroll at their own
// depth. Layers are hashed from world position, so they are stable as the
// camera moves and identical every run.
import { image, mixHex, TAU } from './common.js';

const hash = n => { let x = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b; x = Math.imul(x ^ (x >>> 15), 0xc2b2ae35); return ((x ^ (x >>> 13)) >>> 0) / 4294967296; };

const SKY = { day: ['#5aa8e8', '#9fd0f4', '#e8f4ff'], sunset: ['#3a2a6a', '#e86a5a', '#ffc88a'], night: ['#0c1030', '#1e2a5a', '#3a4a7a'], dawn: ['#4a6ab8', '#f0a0b0', '#ffe0c0'] };

/** The painted background, tiled horizontally and offset vertically. */
export function drawSky(ctx, look, w, h, scrollX = 0, scrollY = 0, zoom = 1.08) {
  const img = image(look.art.background);
  const sky = SKY[look.time] || SKY.day;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, sky[0]); g.addColorStop(0.6, sky[1]); g.addColorStop(1, sky[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  if (!img) return;
  // One painted image, wider than the view, panned back and forth (a ping-pong) as the camera moves:
  // no seams and no duplicated sun or moon.
  const aspect = img.naturalWidth / img.naturalHeight;
  const dw = Math.max(w * 1.3, h * zoom * aspect), dh = dw / aspect;
  const y = Math.min(0, Math.max(h - dh, -(dh - h) / 2 + scrollY));
  const range = dw - w, t = ((scrollX % (range * 2)) + range * 2) % (range * 2);
  ctx.drawImage(img, -(t < range ? t : range * 2 - t), y, dw, dh);
}

/** A silhouette band: city blocks for urban themes, ridges with trees elsewhere. depth 0 (far) .. 1 (near). */
export function drawLayer(ctx, look, w, h, scroll, { base, height, depth, color, alpha = 1, unit = 40 }) {
  const city = ['city', 'factory', 'space'].includes(look.theme);
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color;
  if (city) {
    const bw = unit * (1.6 + depth), start = Math.floor(scroll / bw) - 1;
    for (let i = start; (i - start) * bw - bw < w + bw * 2; i++) {
      const x = i * bw - scroll, r = hash(i * 7 + Math.round(depth * 100));
      const bh = height * (0.35 + r * 0.65), ww = bw * (0.7 + hash(i * 13) * 0.3);
      ctx.fillStyle = color;
      ctx.fillRect(x, base - bh, ww, bh + h);
      if (r > 0.7) ctx.fillRect(x + ww * 0.4, base - bh - unit * 0.6, unit * 0.12, unit * 0.6);
      if (look.night) {
        ctx.fillStyle = mixHex('#ffe08a', color.startsWith('#') ? color : '#202030', 0.35 + depth * 0.3);
        for (let wy = base - bh + unit * 0.3; wy < base - unit * 0.2; wy += unit * 0.42) for (let wx = x + unit * 0.18; wx < x + ww - unit * 0.2; wx += unit * 0.34) if (hash(Math.round(wx * 3 + wy * 7 + i)) > 0.62) ctx.fillRect(wx, wy, unit * 0.14, unit * 0.18);
      }
    }
  } else {
    const k = 0.004 / (0.5 + depth), off = depth * 37;
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let x = 0; x <= w + 8; x += 8) {
      const X = x + scroll;
      const y = base - height * (0.55 + 0.25 * Math.sin(X * k + off) + 0.15 * Math.sin(X * k * 2.7 + off * 2) + 0.05 * Math.sin(X * k * 7.1));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    // Trees or rocks on the ridge.
    const tw = unit * (1.1 + depth), start = Math.floor(scroll / tw) - 1;
    for (let i = start; (i - start) * tw < w + tw * 3; i++) {
      if (hash(i * 31 + Math.round(depth * 10)) < 0.45) continue;
      const X = i * tw, x = X - scroll, ts = unit * (0.6 + hash(i * 17) * 0.6) * (0.7 + depth * 0.6);
      const y = base - height * (0.55 + 0.25 * Math.sin(X * k + off) + 0.15 * Math.sin(X * k * 2.7 + off * 2) + 0.05 * Math.sin(X * k * 7.1)) + 2;
      if (['snow', 'forest', 'haunted'].includes(look.theme)) { ctx.beginPath(); ctx.moveTo(x - ts * 0.45, y); ctx.lineTo(x, y - ts * 1.5); ctx.lineTo(x + ts * 0.45, y); ctx.fill(); }
      else if (look.theme === 'desert') { ctx.fillRect(x - ts * 0.1, y - ts * 1.1, ts * 0.2, ts * 1.1); ctx.fillRect(x - ts * 0.4, y - ts * 0.8, ts * 0.12, ts * 0.4); }
      else { ctx.fillRect(x - ts * 0.07, y - ts * 0.7, ts * 0.14, ts * 0.7); ctx.beginPath(); ctx.arc(x, y - ts * 0.85, ts * 0.42, 0, TAU); ctx.fill(); }
    }
  }
  ctx.restore();
}

/** Ambient motes (snow, embers, stars, leaves) drifting with the camera. */
export function drawMotes(ctx, look, w, h, clock, scrollX, scrollY, reduced) {
  const n = reduced ? 12 : 34;
  const kind = look.theme === 'snow' ? 'snow' : ['volcano', 'factory'].includes(look.theme) ? 'ember' : look.night ? 'star' : ['forest', 'meadow', 'jungle'].includes(look.theme) ? 'leaf' : 'dust';
  ctx.save();
  for (let i = 0; i < n; i++) {
    const z = 0.3 + hash(i * 3) * 0.7;
    const x = ((hash(i) * w * 1.4 - scrollX * z * 0.6 + Math.sin(clock * 0.7 + i) * 12) % (w * 1.4) + w * 1.4) % (w * 1.4) - w * 0.2;
    const fall = kind === 'snow' ? 30 : kind === 'leaf' ? 22 : kind === 'ember' ? -26 : 4;
    const y = ((hash(i * 5) * h + clock * fall * z - scrollY * z * 0.6) % h + h) % h;
    ctx.globalAlpha = 0.25 + z * 0.45;
    ctx.fillStyle = kind === 'ember' ? '#ffb04a' : kind === 'leaf' ? '#d8a040' : '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, (kind === 'star' ? 1.1 : 1.6) * (0.6 + z), 0, TAU); ctx.fill();
  }
  ctx.restore();
}
