// Live scenery: the moving features of a scene (traffic, pedestrians, birds, falling leaves,
// fireflies, weather, trains), drawn on a canvas over the painted background in the same 384×256
// layout (features.js). Pure function of time and a seed, so it is cheap and repeatable.
import { W, H, STREET, DEPTH_Y, normalizeFeatures, MOVING_FEATURES } from './features.js';
import { rng } from './svg.js';

const CAR_COLORS = ['#e8402a', '#3a7ad8', '#f0b429', '#e8e8f0', '#2a2c36', '#4aae5a', '#9a4ae0', '#ff8a3a'];
const TAU = Math.PI * 2;

/** createAmbient(features, { seed, night }) → draw(ctx, rect, t, { reduced, parallax }) or null when nothing moves. */
export function createAmbient(features, { seed = 'ambient', night = false } = {}) {
  const list = normalizeFeatures(features).filter(x => MOVING_FEATURES.includes(x.kind));
  if (!list.length) return null;
  const r = rng(`${seed}|ambient`);
  const layers = list.map(x => ({ ...x, items: Array.from({ length: COUNT[x.kind](x.density) }, (_, i) => ({ i, a: r(), b: r(), c: r(), d: r() })) }));
  return function draw(ctx, rect, t, { reduced = false, parallax = 0 } = {}) {
    if (reduced) t = 0; // still frame: everything stays put
    const sx = rect.w / W, sy = rect.h / H;
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    ctx.translate(rect.x, rect.y); ctx.scale(sx, sy);
    for (const layer of layers) DRAW[layer.kind]?.(ctx, layer, t, night, parallax);
    ctx.restore();
  };
}

const COUNT = {
  traffic: d => Math.round(3 + d * 13), pedestrians: d => Math.round(2 + d * 10), birds: d => Math.round(2 + d * 8),
  'falling-leaves': d => Math.round(6 + d * 30), fireflies: d => Math.round(6 + d * 24), rain: d => Math.round(40 + d * 140),
  snow: d => Math.round(30 + d * 110), fog: d => 3, 'drifting-clouds': d => Math.round(2 + d * 5), embers: d => Math.round(8 + d * 30),
  bubbles: d => Math.round(6 + d * 20), train: () => 1,
};
const wrap = (v, span) => ((v % span) + span) % span;

function car(ctx, x, y, w, color, dir, night) {
  const h = w * 0.42;
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x - w / 2, y - 0.6, w, 1.6);
  ctx.fillStyle = color; roundRect(ctx, x - w / 2, y - h, w, h * 0.62, 1.6); ctx.fill();
  roundRect(ctx, x - w * 0.28 + dir * w * 0.04, y - h * 1.32, w * 0.52, h * 0.5, 2); ctx.fill();
  ctx.fillStyle = night ? '#ffe8a0' : '#bfe0ff'; ctx.globalAlpha = night ? 0.55 : 0.85;
  ctx.fillRect(x - w * 0.22 + dir * w * 0.04, y - h * 1.24, w * 0.18, h * 0.34); ctx.fillRect(x + w * 0.0 + dir * w * 0.04, y - h * 1.24, w * 0.18, h * 0.34);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#16161c'; for (const k of [-0.3, 0.3]) { ctx.beginPath(); ctx.arc(x + k * w, y - 0.4, h * 0.22, 0, TAU); ctx.fill(); }
  const front = x + dir * w / 2, back = x - dir * w / 2;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(front - (dir > 0 ? 1.2 : 0), y - h * 0.62, 1.2, 1.4);
  ctx.fillStyle = '#ff3a3a'; ctx.fillRect(back - (dir > 0 ? 0 : 1.2), y - h * 0.62, 1.2, 1.4);
  if (night) {
    const g = ctx.createLinearGradient(front, 0, front + dir * w * 1.6, 0);
    g.addColorStop(0, 'rgba(255,240,180,.55)'); g.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(front, y - h * 0.6); ctx.lineTo(front + dir * w * 1.6, y - h * 0.95); ctx.lineTo(front + dir * w * 1.6, y + 1); ctx.closePath(); ctx.fill();
  }
}
function roundRect(ctx, x, y, w, h, rr) { ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath(); }

const DRAW = {
  traffic(ctx, L, t, night) {
    const top = H * STREET.top, bottom = H * STREET.bottom, lanes = [top + (bottom - top) * 0.42, top + (bottom - top) * 0.92];
    for (const it of L.items) {
      const lane = it.i % 2, dir = lane ? 1 : -1, speed = 22 + it.b * 30, w = 13 + it.c * 6;
      const x = wrap(it.a * (W + 60) + dir * t * speed, W + 60) - 30;
      car(ctx, x, lanes[lane], w, CAR_COLORS[Math.floor(it.d * CAR_COLORS.length)], dir, night);
    }
  },
  pedestrians(ctx, L, t, night) {
    const y = H * STREET.top - 5;
    for (const it of L.items) {
      const dir = it.b < 0.5 ? -1 : 1, x = wrap(it.a * W + dir * t * (5 + it.c * 6), W + 20) - 10, step = Math.sin(t * 7 + it.i) * 1.2, h = 7 + it.d * 2;
      ctx.fillStyle = night ? '#1a1a26' : ['#3a3a5a', '#5a3a2a', '#2a4a6a', '#6a2a4a'][it.i % 4];
      ctx.fillRect(x - 1.2, y - h, 2.4, h * 0.55); ctx.beginPath(); ctx.arc(x, y - h - 1.4, 1.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - h * 0.45); ctx.lineTo(x + step, y); ctx.moveTo(x, y - h * 0.45); ctx.lineTo(x - step, y); ctx.stroke();
    }
  },
  birds(ctx, L, t) {
    ctx.strokeStyle = 'rgba(30,30,40,.7)'; ctx.lineWidth = 1.1;
    for (const it of L.items) {
      const x = wrap(it.a * W + t * (12 + it.b * 10), W + 40) - 20, y = 30 + it.c * 70 + Math.sin(t * 0.8 + it.i) * 5, flap = Math.sin(t * 9 + it.i * 2) * 2.2, s = 2.5 + it.d * 2;
      ctx.beginPath(); ctx.moveTo(x - s, y - flap); ctx.quadraticCurveTo(x - s * 0.4, y - 1, x, y); ctx.quadraticCurveTo(x + s * 0.4, y - 1, x + s, y - flap); ctx.stroke();
    }
  },
  'falling-leaves'(ctx, L, t) {
    const colors = L.color ? [L.color] : ['#e8902a', '#d8602a', '#f0c040', '#6aae3a', '#b8402a'];
    for (const it of L.items) {
      const fall = 10 + it.b * 14, y = wrap(it.c * H + t * fall, H + 10) - 5, x = wrap(it.a * W + Math.sin(t * 1.3 + it.i) * 10 + t * 6, W);
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * (1 + it.d * 2) + it.i);
      ctx.fillStyle = colors[it.i % colors.length]; ctx.beginPath(); ctx.ellipse(0, 0, 2.6, 1.3, 0, 0, TAU); ctx.fill(); ctx.restore();
    }
  },
  fireflies(ctx, L, t) {
    for (const it of L.items) {
      const x = it.a * W + Math.sin(t * 0.7 + it.i) * 12, y = H * DEPTH_Y.mid - it.b * 60 + Math.cos(t * 0.9 + it.i * 1.7) * 8, glow = 0.4 + 0.6 * Math.max(0, Math.sin(t * 2 + it.c * 6));
      const g = ctx.createRadialGradient(x, y, 0, x, y, 5); g.addColorStop(0, `rgba(220,255,140,${glow})`); g.addColorStop(1, 'rgba(220,255,140,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill();
    }
  },
  rain(ctx, L, t) {
    ctx.strokeStyle = 'rgba(190,210,255,.45)'; ctx.lineWidth = 0.8; ctx.beginPath();
    for (const it of L.items) { const y = wrap(it.b * H + t * (260 + it.c * 80), H + 20) - 10, x = wrap(it.a * W - t * 40, W); ctx.moveTo(x, y); ctx.lineTo(x - 2.5, y + 8); }
    ctx.stroke();
  },
  snow(ctx, L, t) {
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (const it of L.items) { const y = wrap(it.b * H + t * (14 + it.c * 16), H + 6) - 3, x = wrap(it.a * W + Math.sin(t + it.i) * 8, W); ctx.beginPath(); ctx.arc(x, y, 0.8 + it.d * 1.2, 0, TAU); ctx.fill(); }
  },
  fog(ctx, L, t) {
    for (const it of L.items) {
      const y = H * (0.45 + it.i * 0.12), x = wrap(it.a * W + t * (4 + it.b * 4), W * 2) - W * 0.5;
      const g = ctx.createLinearGradient(0, y - 18, 0, y + 18); g.addColorStop(0, 'rgba(230,236,245,0)'); g.addColorStop(0.5, `rgba(230,236,245,${0.18 + L.density * 0.22})`); g.addColorStop(1, 'rgba(230,236,245,0)');
      ctx.fillStyle = g; ctx.fillRect(x - W * 0.6, y - 18, W * 1.2, 36);
    }
  },
  'drifting-clouds'(ctx, L, t, night) {
    ctx.fillStyle = night ? 'rgba(90,100,150,.45)' : 'rgba(255,255,255,.8)';
    for (const it of L.items) {
      const x = wrap(it.a * W + t * (3 + it.b * 4), W + 80) - 40, y = 20 + it.c * 50, s = 12 + it.d * 14;
      for (const [dx, dy, rr] of [[-0.6, 0, 0.5], [0, -0.25, 0.65], [0.6, 0, 0.5]]) { ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, rr * s, 0, TAU); ctx.fill(); }
    }
  },
  embers(ctx, L, t) {
    for (const it of L.items) {
      const y = H - wrap(it.b * H + t * (18 + it.c * 20), H), x = wrap(it.a * W + Math.sin(t * 2 + it.i) * 6, W), a = Math.min(1, y / H * 1.5);
      ctx.fillStyle = `rgba(255,${120 + Math.floor(it.d * 100)},40,${a})`; ctx.beginPath(); ctx.arc(x, y, 0.9 + it.d, 0, TAU); ctx.fill();
    }
  },
  bubbles(ctx, L, t) {
    ctx.strokeStyle = 'rgba(220,240,255,.6)'; ctx.lineWidth = 0.7;
    for (const it of L.items) { const y = H - wrap(it.b * H + t * (10 + it.c * 14), H), x = it.a * W + Math.sin(t * 1.6 + it.i) * 4; ctx.beginPath(); ctx.arc(x, y, 1.2 + it.d * 2.4, 0, TAU); ctx.stroke(); }
  },
  train(ctx, L, t, night) {
    const period = 18, phase = wrap(t + L.items[0].a * period, period), y = H * (DEPTH_Y[L.depth] - 0.08);
    if (phase > 8) return; // the train crosses for 8 s, then the line is quiet
    const x0 = -160 + (phase / 8) * (W + 320);
    for (let k = 0; k < 5; k++) {
      const x = x0 - k * 34;
      ctx.fillStyle = k ? '#8a3a3a' : '#c84a3a'; roundRect(ctx, x, y - 13, 32, 12, 2); ctx.fill();
      ctx.fillStyle = night ? '#ffe28a' : '#bfe0ff'; for (let w = 0; w < 4; w++) ctx.fillRect(x + 3 + w * 7, y - 10, 4, 4);
    }
  },
};
