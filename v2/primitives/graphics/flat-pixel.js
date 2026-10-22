// Palette-indexed pixel sprites built from a part list (catalog §5.2):
//   { kind:'pixel', size:[w,h], palette:{k:hex}, parts:[{rect:[x,y,w,h], c:k, name?}],
//     anims:{name:{frames,fps,loop}}, pivot:[x,y], glow? }
// Rects are in sprite pixels with y UP from the feet. Every animation frame is
// generated from the same parts by name-aware procedural motion (legs stride,
// wings flap, held items swing, bodies breathe), shaded with a top-left light
// and outlined, so a ten-line spec animates in every state. Pure: frames are
// RGBA buffers, testable in Node; the browser copies them into canvases.
import { hexToRgb, light, shade, outlineOf, hash2 } from './flat-util.js';

export const PAD = 2;
export const DEFAULT_ANIMS = {
  idle: { frames: 4, fps: 6, loop: true }, run: { frames: 6, fps: 12, loop: true }, walk: { frames: 4, fps: 8, loop: true },
  jump: { frames: 2, fps: 8, loop: false }, fall: { frames: 2, fps: 8, loop: false }, hurt: { frames: 2, fps: 12, loop: false },
  die: { frames: 6, fps: 12, loop: false }, dash: { frames: 3, fps: 18, loop: false }, attack: { frames: 4, fps: 18, loop: false },
  wall: { frames: 2, fps: 6, loop: true }, flutter: { frames: 4, fps: 14, loop: true },
};
const ROLE = [
  ['legs', /leg|feet|foot|boot|paw|wheel/], ['wings', /wing|fin|cape/], ['arms', /arm|hand|claw/],
  ['held', /blade|sword|hammer|tong|axe|staff|spear|bow|gun|lantern|weapon|torch|scroll|wand|shield|book/],
  ['head', /head|hood|hat|hair|eye|face|beard|helm|veil|crown|horn|ear|mask|skull/], ['tail', /tail/],
];
export const roleOf = name => (ROLE.find(([, re]) => re.test(String(name || '').toLowerCase())) || ['body'])[0];

/** Animation timing for a spec: its own entry, else the procedural default. */
export function animInfo(spec, anim) { return spec?.anims?.[anim] || DEFAULT_ANIMS[anim] || DEFAULT_ANIMS.idle; }
/** Best available anim name for a state (spec anims first, then procedural names). */
export function resolveAnim(spec, state, map = {}) {
  const want = map[state] || state;
  if (spec?.anims?.[want]) return want;
  const alias = { run: ['walk', 'run'], walk: ['run'], wallslide: ['wall'], wall: ['wallslide'], fall: ['jump'], attack: ['swing', 'work'], dash: ['run'], die: ['hurt'] }[want] || [];
  for (const a of alias) if (spec?.anims?.[a]) return a;
  return DEFAULT_ANIMS[want] ? want : 'idle';
}
export function frameIndex(info, t) {
  const n = Math.max(1, info.frames | 0), i = Math.floor(t * (info.fps || 8));
  return info.loop === false ? Math.min(n - 1, i) : ((i % n) + n) % n;
}

/** Per-role pixel offsets [dx, dy] (dy up) for a frame of an animation. */
export function motion(anim, f, n) {
  const p = (f / Math.max(1, n)) * Math.PI * 2, s = Math.sin(p), c = Math.cos(p);
  const o = { body: [0, 0], head: [0, 0], legsL: [0, 0], legsR: [0, 0], arms: [0, 0], wings: [0, 0], held: [0, 0], tail: [0, 0] };
  const all = (dx, dy) => { for (const k of Object.keys(o)) { o[k][0] += dx; o[k][1] += dy; } };
  switch (anim) {
    case 'idle': case 'work': case 'heal': {
      const b = f >= n / 2 ? -1 : 0; for (const k of ['body', 'head', 'arms', 'held', 'wings']) o[k][1] += b;
      if (anim !== 'idle') o.held[1] += f % 2 ? 2 : 0; o.tail[0] += f >= n / 2 ? 1 : 0; break;
    }
    case 'run': case 'walk': {
      const bob = Math.round(Math.abs(s)); for (const k of ['body', 'head', 'arms', 'held', 'wings', 'tail']) o[k][1] += bob;
      o.legsL = [Math.round(s * 1.4), Math.max(0, Math.round(c))]; o.legsR = [-Math.round(s * 1.4), Math.max(0, Math.round(-c))];
      o.arms[0] += -Math.round(s); o.held[0] += -Math.round(s); o.head[0] += anim === 'run' ? 1 : 0; o.wings[1] += Math.round(c); o.tail[1] += Math.round(-s); break;
    }
    case 'jump': all(0, 1); o.legsL[1] += 1; o.legsR[1] += 1; o.arms[1] += 2; o.wings[1] += 3; o.held[1] += 1; break;
    case 'fall': o.arms[1] += 2; o.wings[1] += f % 2 ? 3 : 1; o.legsL[1] -= 0; o.head[1] += 0; o.tail[1] += 1; break;
    case 'hurt': all(f % 2 ? -1 : -2, 0); o.head[0] -= 1; o.arms[1] += 1; break;
    case 'dash': o.head[0] += 2; o.body[0] += 1; o.held[0] += 2; o.legsL[0] -= 1; o.legsR[0] -= 1; o.wings[0] -= 1; o.tail[0] -= 2; break;
    case 'attack': {
      const phase = f / Math.max(1, n - 1);
      const swing = phase < 0.3 ? [-2, 2] : phase < 0.75 ? [3, 0] : [1, 0];
      o.held = swing; o.arms = [swing[0] > 0 ? 2 : -1, swing[1]]; o.body[0] += swing[0] > 0 ? 1 : 0; o.head[0] += swing[0] > 0 ? 1 : 0; break;
    }
    case 'wall': case 'wallslide': all(-1, 0); o.arms[1] += 2; o.held[1] += 1; o.legsL[0] -= 1; break;
    case 'flutter': o.wings[1] += f % 2 ? 2 : -1; o.body[1] += f % 2 ? 1 : 0; o.head[1] += f % 2 ? 1 : 0; break;
    case 'die': break;
    default: { const b = f % 2 ? 1 : 0; o.body[1] += b; o.head[1] += b; }
  }
  return o;
}

/**
 * Build one frame. Returns { w, h, data:Uint8ClampedArray, pivot:[x,y] } in buffer pixels (y down),
 * pivot at the feet. opts: { outline: hex|'' (default: derived), shading: true, flash: 0..1 (white), tint,
 * and an art look's (art/look.js lookPrimitives): outlineWidth 1..4 px, bands 1..4 shading tones, palette: hex[] to snap to }
 */
export function pixelFrame(spec, anim = 'idle', f = 0, opts = {}) {
  const [SW, SH] = spec.size || [16, 16];
  const W = SW + PAD * 2, H = SH + PAD * 2 + 2, data = new Uint8ClampedArray(W * H * 4);
  const info = animInfo(spec, anim), n = Math.max(1, info.frames | 0);
  const off = motion(anim, f, n);
  const pal = spec.palette || {};
  const colorOf = k => (typeof k === 'string' && k.startsWith('#') ? k : pal[k] || '#c8c8d0');
  const set = (x, y, rgb, a = 255) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = a; };
  const bands = Math.max(1, Math.min(4, Math.round(opts.bands ?? 3)));
  const shading = opts.shading !== false && bands > 1;
  const parts = spec.parts?.length ? spec.parts : [{ rect: [Math.floor(SW * 0.2), 0, Math.ceil(SW * 0.6), Math.ceil(SH * 0.8)], c: Object.keys(pal)[0] || '#c8c8d0', name: 'body' }];
  for (const part of parts) {
    const [px, py, pw, ph] = part.rect || [0, 0, 1, 1], base = colorOf(part.c), role = roleOf(part.name);
    const mid = hexToRgb(base);
    const ramp = { top: bands >= 3 ? hexToRgb(light(base, 0.22)) : mid, top2: hexToRgb(light(base, 0.4)), mid, low: hexToRgb(shade(base, 0.22)), side: bands >= 3 ? hexToRgb(shade(base, 0.1)) : mid };
    for (let x = 0; x < pw; x++) for (let y = 0; y < ph; y++) {
      let key = role;
      if (role === 'legs') key = x < pw / 2 ? 'legsL' : 'legsR';
      const [dx, dy] = off[key] || off.body;
      let rgb = ramp.mid;
      if (shading && bands >= 4 && ph >= 5 && y === ph - 1) rgb = ramp.top2;
      else if (shading && ph >= 3 && y === ph - (bands >= 4 && ph >= 5 ? 2 : 1)) rgb = ramp.top;
      else if (shading && ph >= 3 && y === 0) rgb = ramp.low;
      else if (shading && pw >= 4 && x === pw - 1) rgb = ramp.side;
      // Dash leans the upper body forward a pixel per third of the height.
      const lean = anim === 'dash' ? Math.floor(((py + y) / SH) * 2) : 0;
      set(PAD + px + x + dx + lean, PAD + 2 + (SH - 1 - (py + y + dy)), rgb);
    }
  }
  // Death: rows collapse from the top and pixels dissolve.
  if (anim === 'die') {
    const k = f / Math.max(1, n - 1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4; if (!data[i + 3]) continue;
      if (hash2(x, y, 7) < k * 0.9) data[i + 3] = 0;
      else if (k > 0) for (let c = 0; c < 3; c++) data[i + c] += (255 - data[i + c]) * k * 0.6;
    }
  }
  if (opts.flash > 0 || (anim === 'hurt' && f === 0)) {
    const a = opts.flash > 0 ? opts.flash : 0.85;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3]) { data[i] += (255 - data[i]) * a; data[i + 1] += (255 - data[i + 1]) * a; data[i + 2] += (255 - data[i + 2]) * a; }
  }
  const outline = opts.outline === undefined ? outlineOf(colorOf(parts[0].c)) : opts.outline;
  if (outline) {
    // One ring per pixel of width (within the buffer's padding).
    const o = hexToRgb(outline), solid = new Uint8Array(W * H);
    for (let ring = 0; ring < Math.max(1, Math.min(PAD, Math.round(opts.outlineWidth ?? 1))); ring++) {
      for (let i = 0; i < W * H; i++) solid[i] = data[i * 4 + 3] > 0 ? 1 : 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (solid[y * W + x]) continue;
        if ((x > 0 && solid[y * W + x - 1]) || (x < W - 1 && solid[y * W + x + 1]) || (y > 0 && solid[(y - 1) * W + x]) || (y < H - 1 && solid[(y + 1) * W + x])) set(x, y, o);
      }
    }
  }
  if (Array.isArray(opts.palette) && opts.palette.length) {
    const pal = opts.palette.map(hexToRgb), near = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      let best = near.get(k);
      if (!best) { let bd = Infinity; for (const p of pal) { const e = (data[i] - p[0]) ** 2 * 0.3 + (data[i + 1] - p[1]) ** 2 * 0.59 + (data[i + 2] - p[2]) ** 2 * 0.11; if (e < bd) { bd = e; best = p; } } near.set(k, best); }
      data[i] = best[0]; data[i + 1] = best[1]; data[i + 2] = best[2];
    }
  }
  const pivot = spec.pivot || [SW / 2, 0];
  return { w: W, h: H, data, pivot: [PAD + pivot[0], PAD + 2 + SH - pivot[1]], size: [SW, SH] };
}

/** Bounding box of opaque pixels [x0,y0,x1,y1] (exclusive), for hit flashes and tests. */
export function opaqueBox(fr) {
  let x0 = fr.w, y0 = fr.h, x1 = -1, y1 = -1;
  for (let y = 0; y < fr.h; y++) for (let x = 0; x < fr.w; x++) if (fr.data[(y * fr.w + x) * 4 + 3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}
