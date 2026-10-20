// Visual-only effects for the physics kit: particles in world units, screen
// shake, floating score text. Uses its own seeded generator so it never
// touches game state or its RNG.

export function visualRand(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const TAU = Math.PI * 2;
export function createFx() {
  return { list: [], floats: [], rings: [], trauma: 0, flash: null, r: visualRand(97), time: 0 };
}

function add(fx, p) { if (fx.list.length > 900) fx.list.shift(); fx.list.push({ g: 0, drag: 0, rot: 0, spin: 0, grow: 0, alpha: 1, ...p, max: p.life }); }

export function stepFx(fx, dt) {
  fx.time += dt;
  let n = 0;
  for (const p of fx.list) {
    p.life -= dt; if (p.life <= 0) continue;
    p.vy += p.g * dt;
    const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt; p.size += p.grow * dt;
    if (p.floor != null && p.y > p.floor) { p.y = p.floor; p.vy *= -0.35; p.vx *= 0.6; p.spin *= 0.5; }
    fx.list[n++] = p;
  }
  fx.list.length = n;
  fx.floats = fx.floats.filter(f => (f.t += dt) < f.life);
  fx.trauma = Math.max(0, fx.trauma - dt * 1.6);
  if (fx.flash) { fx.flash.t += dt; if (fx.flash.t > fx.flash.life) fx.flash = null; }
}

export function shake(fx, amount, reduced) { if (!reduced) fx.trauma = Math.min(1, fx.trauma + amount); }
export function flash(fx, color, life = 0.18, alpha = 0.35) { fx.flash = { color, life, t: 0, alpha }; }
export function shakeOffset(fx, px) {
  const t = fx.trauma * fx.trauma, time = fx.time;
  return [Math.sin(time * 61.3) * Math.cos(time * 17.1) * px * t, Math.sin(time * 47.9 + 1.3) * px * t, Math.sin(time * 23.7) * 0.012 * t];
}

export function sparks(fx, x, y, color = '#fff6c8', n = 10, speed = 7) {
  const r = fx.r;
  for (let i = 0; i < n; i++) { const a = r() * TAU, s = speed * (0.4 + r() * 0.8); add(fx, { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 5, life: 0.18 + r() * 0.22, size: 0.05 + r() * 0.05, kind: 'spark', color, add: true }); }
}
export function ring(fx, x, y, color = '#ffffff', size = 0.3, grow = 5, life = 0.32) { add(fx, { x, y, vx: 0, vy: 0, life, size, grow, kind: 'ring', color }); }
export function dust(fx, x, y, n = 8, color = 'rgba(235,225,205,0.8)', spread = 1, floor = null) {
  const r = fx.r;
  for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (r() - 0.5) * Math.PI * 1.4; add(fx, { x: x + (r() - 0.5) * spread, y, vx: Math.cos(a) * (1 + r() * 2.5), vy: Math.sin(a) * (0.6 + r() * 1.6), drag: 2.6, g: -0.6, life: 0.5 + r() * 0.6, size: 0.18 + r() * 0.25, grow: 0.5, kind: 'smoke', color, floor }); }
}
/** Shards: little rotating polygons flung out from a breaking body. */
export function shards(fx, x, y, color, n = 10, { speed = 7, size = 0.22, g = 18, floor = null, glass = false, w = 0.6, h = 0.6 } = {}) {
  const r = fx.r;
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, s = speed * (0.3 + r() * 0.9);
    add(fx, { x: x + (r() - 0.5) * w, y: y + (r() - 0.5) * h, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.35, g, drag: 0.4, life: 0.7 + r() * 0.6, size: size * (0.5 + r()), kind: glass ? 'glass' : 'shard', rot: r() * TAU, spin: (r() - 0.5) * 22, color, floor, pts: [r(), r(), r()] });
  }
}
export function confetti(fx, x, y, colors, n = 50, speed = 12) {
  const r = fx.r;
  for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (r() - 0.5) * 2.4, s = speed * (0.5 + r() * 0.7); add(fx, { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 9, drag: 1.6, life: 1.4 + r() * 1.1, size: 0.12 + r() * 0.12, kind: 'confetti', rot: r() * TAU, spin: (r() - 0.5) * 14, color: colors[i % colors.length] }); }
}
export function stars(fx, x, y, color = '#ffe36a', n = 8, speed = 5) {
  const r = fx.r;
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU + r() * 0.3, s = speed * (0.6 + r() * 0.6); add(fx, { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 3, life: 0.45 + r() * 0.35, size: 0.14 + r() * 0.1, kind: 'star', spin: (r() - 0.5) * 10, color, add: true }); }
}
export function smoke(fx, x, y, n = 12, radius = 1, color = 'rgba(80,72,70,0.55)') {
  const r = fx.r;
  for (let i = 0; i < n; i++) { const a = r() * TAU, s = radius * (0.8 + r() * 2.2); add(fx, { x: x + Math.cos(a) * radius * 0.3, y: y + Math.sin(a) * radius * 0.3, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.6, drag: 2.2, g: -1.2, life: 0.8 + r() * 0.7, size: radius * (0.35 + r() * 0.3), grow: radius * 0.8, kind: 'smoke', color }); }
}
export function floatText(fx, x, y, text, color = '#ffffff', size = 1) { if (fx.floats.length > 40) fx.floats.shift(); fx.floats.push({ x, y, text, color, size, t: 0, life: 0.9 }); }

/** Draw particles; `px` is pixels per world unit (ctx is already in world space). */
export function drawFx(ctx, fx, px) {
  for (const p of fx.list) {
    const k = Math.max(0, p.life / p.max);
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.add) ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = p.kind === 'smoke' ? k * k * 0.9 : Math.min(1, k * 1.6);
    ctx.fillStyle = ctx.strokeStyle = p.color;
    const s = Math.max(0.01, p.size);
    switch (p.kind) {
      case 'spark': {
        const l = Math.min(0.6, Math.hypot(p.vx, p.vy) * 0.035) + s;
        ctx.rotate(Math.atan2(p.vy, p.vx)); ctx.lineWidth = s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-l, 0); ctx.lineTo(0, 0); ctx.stroke(); break;
      }
      case 'ring': ctx.lineWidth = Math.max(1.5 / px, s * 0.25 * k); ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.stroke(); break;
      case 'smoke': ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill(); break;
      case 'shard': case 'glass': {
        ctx.rotate(p.rot);
        const [a, b, c] = p.pts;
        ctx.beginPath(); ctx.moveTo(-s, -s * (0.3 + a * 0.5)); ctx.lineTo(s * (0.5 + b * 0.5), -s * 0.4); ctx.lineTo(s * 0.2, s * (0.5 + c * 0.6)); ctx.closePath();
        ctx.fill();
        if (p.kind === 'glass') { ctx.globalAlpha *= 0.9; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1 / px; ctx.stroke(); }
        else { ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1 / px; ctx.stroke(); }
        break;
      }
      case 'confetti': ctx.rotate(p.rot); ctx.scale(1, Math.abs(Math.cos(p.rot * 1.7)) + 0.15); ctx.fillRect(-s, -s * 0.5, s * 2, s); break;
      case 'star': {
        ctx.rotate(p.rot); ctx.beginPath();
        for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2, rr = i % 2 ? s * 0.42 : s; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill(); break;
      }
      default: ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}
