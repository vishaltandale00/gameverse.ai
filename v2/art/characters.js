// Procedural characters: a rig per body plan, assembled from parts and painted
// as outlined, cel-shaded SVG. Every pose comes from the same rig, so a
// character stays on model in every frame, and a change to one part ("a red
// cap") repaints only what that part touches.
//
// Units: a 100×100 box, facing right, feet on y = 97. Angles are degrees from
// straight down; positive swings forward (toward +x).
import { defs as makeDefs, document, f, pt, smoothPath } from './svg.js';
import { hex, light, shade, outlineOf, mix, inkOf } from './color.js';

export const BODIES = ['biped', 'quadruped', 'blob', 'flyer', 'robot', 'ghost'];
export const PARTS = {
  ears: ['none', 'pointed', 'round', 'long', 'floppy', 'fins'],
  top: ['none', 'quills', 'spikes', 'tuft', 'mohawk', 'long-hair', 'antenna', 'leaf'],
  headwear: ['none', 'cap', 'helmet', 'crown', 'wizard-hat', 'hood', 'horns', 'bandana', 'goggles'],
  snout: ['none', 'muzzle', 'beak', 'nose', 'big-nose'],
  facial: ['none', 'mustache', 'beard', 'goatee'],
  outfit: ['none', 'overalls', 'gi', 'jacket'],
  arms: ['body', 'skin'],
  eyes: ['cartoon', 'dots', 'visor', 'angry', 'sleepy', 'cyclops'],
  tail: ['none', 'fluffy', 'thin', 'spiky', 'flame', 'fish'],
  feet: ['shoes', 'boots', 'paws', 'none'],
  hands: ['gloves', 'paws', 'claws', 'none'],
  accessory: ['none', 'scarf', 'cape', 'backpack', 'belt', 'spots', 'stripes'],
  held: ['none', 'sword', 'blaster', 'staff', 'shield', 'hammer'],
};
// Curated looks for well-known character archetypes. A small model assembling parts freely can
// turn a plumber into a bear (round ears + muzzle); a preset gets the silhouette right every time,
// and the director only recolors it. Drawn in our own style: no logos, emblems or copied art.
export const PRESETS = {
  'plumber-hero': { body: 'biped', build: 'stocky', colors: { primary: '#e0302a', secondary: '#f5c99b', accent: '#7a4a2a', outfit: '#2a52be', hair: '#3a2418', eye: '#2a5ad8' , hat: '#e0302a' }, headwear: 'cap', snout: 'big-nose', facial: 'mustache', outfit: 'overalls', feet: 'boots', hands: 'gloves', ears: 'none', top: 'none', eyes: 'cartoon', tail: 'none' },
  'plumber-brother': { body: 'biped', build: 'tall', colors: { primary: '#2ea84a', secondary: '#f5c99b', accent: '#7a4a2a', outfit: '#2a52be', hair: '#3a2418', eye: '#2a5ad8' , hat: '#2ea84a' }, headwear: 'cap', snout: 'big-nose', facial: 'mustache', outfit: 'overalls', feet: 'boots', hands: 'gloves', ears: 'none', top: 'none', eyes: 'cartoon', tail: 'none' },
  'blue-hedgehog': { body: 'biped', build: 'chibi', colors: { primary: '#1f5fd6', secondary: '#f2c79a', accent: '#e0302f', eye: '#1f9a4c' }, ears: 'pointed', top: 'quills', snout: 'muzzle', arms: 'skin', tail: 'spiky', feet: 'shoes', hands: 'gloves', eyes: 'cartoon', headwear: 'none' },
  'fox-sidekick': { body: 'biped', build: 'chibi', colors: { primary: '#f0a030', secondary: '#fff4e0', accent: '#e0302f', eye: '#2a6ad8' }, ears: 'pointed', snout: 'muzzle', tail: 'fluffy', feet: 'shoes', hands: 'gloves', eyes: 'cartoon' },
  'spiky-martial-artist': { body: 'biped', build: 'normal', colors: { primary: '#f07a1a', secondary: '#f5c99b', accent: '#2a52be', outfit: '#2a52be', hair: '#1a1a22', eye: '#1a1a22' }, top: 'spikes', outfit: 'gi', feet: 'boots', hands: 'none', eyes: 'cartoon', ears: 'none', snout: 'none' },
  'princess': { body: 'biped', build: 'tall', colors: { primary: '#ff8ac8', secondary: '#f8d8c0', accent: '#f5c542', outfit: '#ff8ac8', hair: '#f5d040', eye: '#2a6ad8' }, headwear: 'crown', top: 'long-hair', feet: 'boots', hands: 'gloves', eyes: 'cartoon', snout: 'none', ears: 'none' },
  'turtle-king': { body: 'biped', build: 'stocky', colors: { primary: '#f0b429', secondary: '#f0e08a', accent: '#3a9a3a', hair: '#e8402a', eye: '#d82a2a' }, headwear: 'horns', top: 'mohawk', snout: 'muzzle', eyes: 'angry', hands: 'claws', feet: 'paws', tail: 'spiky', accessory: 'spots' },
  'mushroom-walker': { body: 'blob', colors: { primary: '#a0683a', secondary: '#f0d8b0', accent: '#5a3a1a', eye: '#1a1a1a' }, eyes: 'angry' },
  'green-elf-hero': { body: 'biped', build: 'normal', colors: { primary: '#3a9a3a', secondary: '#f5d0a8', accent: '#7a4a2a', hair: '#e8c040', eye: '#2a6ad8' }, headwear: 'wizard-hat', ears: 'pointed', held: 'sword', feet: 'boots', hands: 'gloves', eyes: 'cartoon', snout: 'none' },
  'space-hunter': { body: 'biped', build: 'stocky', colors: { primary: '#e07a2a', secondary: '#e0e0e8', accent: '#d8302a', eye: '#3ad0e8' }, headwear: 'helmet', eyes: 'visor', held: 'blaster', feet: 'boots', hands: 'gloves', snout: 'none', ears: 'none' },
  'ninja': { body: 'biped', build: 'normal', colors: { primary: '#2a2a38', secondary: '#f0c8a0', accent: '#d8262c', eye: '#202020' }, headwear: 'bandana', accessory: 'scarf', held: 'sword', feet: 'boots', eyes: 'angry' },
  'knight': { body: 'biped', build: 'stocky', colors: { primary: '#8d99ae', secondary: '#f0c8a0', accent: '#b8323a', eye: '#3060c0' }, headwear: 'helmet', feet: 'boots', hands: 'gloves', held: 'sword', accessory: 'cape' },
  'yellow-electric-mouse': { body: 'quadruped', colors: { primary: '#f8d030', secondary: '#f8d030', accent: '#e8402a', eye: '#202020' }, ears: 'long', tail: 'thin', snout: 'nose', eyes: 'dots' },
};
export const PRESET_NAMES = ['none', ...Object.keys(PRESETS)];

export const POSE_NAMES = ['idle', 'idleB', 'runA', 'runB', 'runC', 'runD', 'jump', 'fall', 'hurt'];

const pick = (v, list, d) => list.includes(v) ? v : d;
/** Fill defaults so painters never see missing fields. */
export function normalizeLook(input = {}) {
  // A preset sets the silhouette and parts; colors given alongside it recolor it ("make his overalls green").
  const preset = PRESETS[input?.preset];
  const look = preset ? { ...preset, colors: { ...preset.colors, ...(input.recolor ? input.colors : {}) } } : input;
  const c = look.colors || {};
  const primary = hex(c.primary, '#3a7bd5');
  return {
    body: pick(look.body, BODIES, 'biped'),
    colors: { primary, secondary: hex(c.secondary, '#f2d2a9'), accent: hex(c.accent, '#d63c3c'), eye: hex(c.eye, '#1f8a4c'), detail: hex(c.detail, '#ffffff'), outfit: hex(c.outfit, hex(c.accent, '#2a52be')), hair: hex(c.hair, '#3a2418'), hat: hex(c.hat, hex(c.accent, '#d63c3c')) },
    ears: pick(look.ears, PARTS.ears, 'none'), top: pick(look.top, PARTS.top, 'none'), headwear: pick(look.headwear, PARTS.headwear, 'none'),
    snout: pick(look.snout, PARTS.snout, 'none'), eyes: pick(look.eyes, PARTS.eyes, 'cartoon'), tail: pick(look.tail, PARTS.tail, 'none'),
    feet: pick(look.feet, PARTS.feet, 'shoes'), hands: pick(look.hands, PARTS.hands, 'gloves'), accessory: pick(look.accessory, PARTS.accessory, 'none'),
    held: pick(look.held, PARTS.held, 'none'),
    facial: pick(look.facial, PARTS.facial, 'none'), outfit: pick(look.outfit, PARTS.outfit, 'none'), arms: pick(look.arms, PARTS.arms, 'body'),
    build: pick(look.build, ['chibi', 'normal', 'stocky', 'tall'], 'chibi'),
  };
}

// Pose table for two-legged rigs: limbs as [hip/shoulder angle, knee/elbow bend].
// Hips stay put across idle, run and fall frames; the renderer adds bob, breathing and squash.
const BIPED_POSES = {
  idle:  { lean: 0, bob: 0, legN: [5, 4], legF: [-7, 4], armN: [8, 22], armF: [-10, 22], eyes: 'open', wind: 0.2 },
  idleB: { lean: 0, bob: 0, legN: [5, 6], legF: [-7, 6], armN: [10, 28], armF: [-12, 28], eyes: 'open', wind: 0.3 },
  runA:  { lean: 12, bob: 0, legN: [42, 28], legF: [-38, 75], armN: [-55, 60], armF: [55, 75], eyes: 'open', wind: 1 },
  runB:  { lean: 12, bob: 0, legN: [8, 50], legF: [-8, 20], armN: [5, 70], armF: [-5, 60], eyes: 'open', wind: 0.9 },
  runC:  { lean: 12, bob: 0, legN: [-38, 75], legF: [42, 28], armN: [55, 75], armF: [-55, 60], eyes: 'open', wind: 1 },
  runD:  { lean: 12, bob: 0, legN: [-8, 20], legF: [8, 50], armN: [-5, 60], armF: [5, 70], eyes: 'open', wind: 0.9 },
  jump:  { lean: 6, bob: -3, legN: [45, 95], legF: [15, 70], armN: [205, -15], armF: [165, -10], eyes: 'open', wind: 0.6 },
  fall:  { lean: 0, bob: 0, legN: [18, 25], legF: [-14, 15], armN: [100, 20], armF: [-120, -20], eyes: 'wide', wind: -0.8 },
  hurt:  { lean: -16, bob: -1, legN: [28, 15], legF: [-22, 35], armN: [195, 25], armF: [150, 30], eyes: 'hurt', wind: 0.5 },
};

const rad = d => d * Math.PI / 180;
const dirOf = a => [Math.sin(rad(a)), Math.cos(rad(a))];
function joint([x, y], angle, length) { const [dx, dy] = dirOf(angle); return [x + dx * length, y + dy * length]; }

/** opts.ink: an art look's outline { mode, width (box units) }; opts.shading: its cel bands (svg.js defs). */
function painter(look, { soft = false, outlineWidth = 2.4, ink = null, shading = null } = {}) {
  const d = makeDefs('c', shading);
  const O = ink ? inkOf(ink.mode, look.colors.primary) : outlineOf(mix(look.colors.primary, '#000000', 0.35));
  const W = ink ? ink.width : outlineWidth;
  const fill = color => d.cel(color, { soft });
  return {
    d, O, W,
    shape: (path, color, extra = '') => `<path d="${path}" fill="${fill(color)}" stroke="${O}" stroke-width="${W}" stroke-linejoin="round"${extra}/>`,
    flat: (path, color, extra = '') => `<path d="${path}" fill="${color}"${extra}/>`,
    ellipse: (cx, cy, rx, ry, color, extra = '') => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill(color)}" stroke="${O}" stroke-width="${W}"${extra}/>`,
    circle: (cx, cy, r, color, extra = '') => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill(color)}" stroke="${O}" stroke-width="${W}"${extra}/>`,
    /** An outlined limb: a thick dark stroke under a colored one, with a light rim. */
    limb(points, width, color) {
      const p = points.map(q => pt(...q)).join(' ');
      return `<polyline points="${p}" fill="none" stroke="${O}" stroke-width="${f(width + 2 * W)}" stroke-linecap="round" stroke-linejoin="round"/>`
        + `<polyline points="${p}" fill="none" stroke="${color}" stroke-width="${f(width)}" stroke-linecap="round" stroke-linejoin="round"/>`
        + `<polyline points="${points.map(q => pt(q[0] - width * 0.18, q[1] - width * 0.12)).join(' ')}" fill="none" stroke="${light(color, 0.22)}" stroke-width="${f(width * 0.32)}" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>`;
    },
  };
}

// ---------- faces and heads (shared by every plan with a head) ----------

function eyes(P, look, hx, hy, R, mode) {
  const c = look.colors, out = [];
  if (look.eyes === 'visor') {
    out.push(`<path d="M${pt(hx - R * 0.15, hy - R * 0.28)}H${f(hx + R * 0.92)}Q${pt(hx + R * 1.02, hy - R * 0.05)} ${pt(hx + R * 0.9, hy + R * 0.18)}H${f(hx - R * 0.15)}Z" fill="${shade(c.eye, 0.35)}" stroke="${P.O}" stroke-width="${P.W}" stroke-linejoin="round"/>`);
    out.push(`<rect x="${f(hx + R * 0.35)}" y="${f(hy - R * 0.2)}" width="${f(R * 0.42)}" height="${f(R * 0.26)}" rx="${f(R * 0.08)}" fill="${light(c.eye, 0.4)}"/>`);
    out.push(`<rect x="${f(hx + R * 0.42)}" y="${f(hy - R * 0.17)}" width="${f(R * 0.14)}" height="${f(R * 0.08)}" fill="#ffffff" opacity=".9"/>`);
    return out.join('');
  }
  if (look.eyes === 'cyclops') {
    const ex = hx + R * 0.42, ey = hy - R * 0.08;
    out.push(`<ellipse cx="${f(ex)}" cy="${f(ey)}" rx="${f(R * 0.34)}" ry="${f(R * 0.36)}" fill="#ffffff" stroke="${P.O}" stroke-width="${P.W}"/>`);
    if (mode === 'hurt') out.push(xEye(ex, ey, R * 0.2, P.O));
    else out.push(`<circle cx="${f(ex + R * 0.1)}" cy="${f(ey)}" r="${f(R * 0.18)}" fill="${c.eye}"/><circle cx="${f(ex + R * 0.12)}" cy="${f(ey)}" r="${f(R * 0.09)}" fill="#101018"/><circle cx="${f(ex + R * 0.04)}" cy="${f(ey - R * 0.08)}" r="${f(R * 0.06)}" fill="#ffffff"/>`);
    return out.join('');
  }
  // Two eyes in three-quarter view: the far eye is narrower and tucked behind the near one.
  const pair = [{ x: hx + R * 0.12, s: 0.78 }, { x: hx + R * 0.52, s: 1 }];
  for (const { x, s } of pair) {
    const ey = hy - R * 0.1;
    if (mode === 'hurt') { out.push(xEye(x, ey, R * 0.16 * s, P.O)); continue; }
    if (look.eyes === 'dots') { out.push(`<ellipse cx="${f(x)}" cy="${f(ey)}" rx="${f(R * 0.09 * s)}" ry="${f(R * 0.14)}" fill="#141420"/><circle cx="${f(x - R * 0.03)}" cy="${f(ey - R * 0.05)}" r="${f(R * 0.035)}" fill="#fff"/>`); continue; }
    const rx = R * 0.2 * s, ry = R * (look.eyes === 'sleepy' ? 0.17 : 0.3) * (mode === 'wide' ? 1.1 : 1);
    out.push(`<ellipse cx="${f(x)}" cy="${f(ey)}" rx="${f(rx)}" ry="${f(ry)}" fill="#ffffff" stroke="${P.O}" stroke-width="${f(P.W * 0.8)}"/>`);
    const px = x + rx * 0.35, py = ey + (look.eyes === 'sleepy' ? ry * 0.15 : 0);
    out.push(`<ellipse cx="${f(px)}" cy="${f(py)}" rx="${f(rx * 0.62)}" ry="${f(ry * 0.66)}" fill="${c.eye}"/>`);
    out.push(`<ellipse cx="${f(px + rx * 0.08)}" cy="${f(py)}" rx="${f(rx * 0.34)}" ry="${f(ry * 0.42)}" fill="#0d0d16"/>`);
    out.push(`<circle cx="${f(px - rx * 0.2)}" cy="${f(py - ry * 0.35)}" r="${f(rx * 0.24)}" fill="#ffffff"/>`);
    if (look.eyes === 'sleepy') out.push(`<path d="M${pt(x - rx * 1.1, ey - ry * 0.2)}Q${pt(x, ey - ry * 1.5)} ${pt(x + rx * 1.1, ey - ry * 0.2)}Z" fill="${look.colors.primary}" stroke="${P.O}" stroke-width="${f(P.W * 0.7)}"/>`);
    if (look.eyes === 'angry') out.push(`<path d="M${pt(x - rx * 1.2, ey - ry * 1.25)}L${pt(x + rx * 1.15, ey - ry * 0.7)}" stroke="${P.O}" stroke-width="${f(P.W * 1.4)}" stroke-linecap="round"/>`);
  }
  return out.join('');
}
const xEye = (x, y, r, O) => `<path d="M${pt(x - r, y - r)}L${pt(x + r, y + r)}M${pt(x + r, y - r)}L${pt(x - r, y + r)}" stroke="${O}" stroke-width="${f(r * 0.55)}" stroke-linecap="round"/>`;

function snoutAndMouth(P, look, hx, hy, R, mode) {
  const c = look.colors, out = [];
  if (look.snout === 'muzzle') {
    out.push(P.ellipse(hx + R * 0.55, hy + R * 0.38, R * 0.48, R * 0.32, c.secondary));
    out.push(`<ellipse cx="${f(hx + R * 0.98)}" cy="${f(hy + R * 0.2)}" rx="${f(R * 0.16)}" ry="${f(R * 0.13)}" fill="#151520"/><circle cx="${f(hx + R * 0.94)}" cy="${f(hy + R * 0.15)}" r="${f(R * 0.05)}" fill="#fff" opacity=".8"/>`);
  } else if (look.snout === 'beak') {
    out.push(P.shape(`M${pt(hx + R * 0.62, hy - R * 0.02)}Q${pt(hx + R * 1.5, hy + R * 0.12)} ${pt(hx + R * 0.66, hy + R * 0.46)}Z`, c.accent));
  } else if (look.snout === 'big-nose') {
    // A big round cartoon nose, in skin tone.
    out.push(P.ellipse(hx + R * 0.86, hy + R * 0.16, R * 0.26, R * 0.22, shade(c.secondary, 0.06)));
    out.push(`<ellipse cx="${f(hx + R * 0.8)}" cy="${f(hy + R * 0.08)}" rx="${f(R * 0.08)}" ry="${f(R * 0.06)}" fill="#ffffff" opacity=".6"/>`);
  } else if (look.snout === 'nose') {
    out.push(`<ellipse cx="${f(hx + R * 0.86)}" cy="${f(hy + R * 0.15)}" rx="${f(R * 0.14)}" ry="${f(R * 0.12)}" fill="${shade(c.secondary, 0.25)}" stroke="${P.O}" stroke-width="${f(P.W * 0.6)}"/>`);
  }
  if (look.snout !== 'beak' && look.eyes !== 'visor') {
    const mx = hx + R * (look.snout === 'muzzle' ? 0.62 : 0.5), my = hy + R * (look.snout === 'muzzle' ? 0.5 : 0.42);
    if (mode === 'hurt') out.push(`<ellipse cx="${f(mx)}" cy="${f(my + R * 0.04)}" rx="${f(R * 0.12)}" ry="${f(R * 0.14)}" fill="#3a1018" stroke="${P.O}" stroke-width="${f(P.W * 0.6)}"/>`);
    else if (look.eyes === 'angry') out.push(`<path d="M${pt(mx - R * 0.22, my + R * 0.05)}L${pt(mx + R * 0.24, my - R * 0.02)}" stroke="${P.O}" stroke-width="${f(P.W * 0.8)}" stroke-linecap="round"/>`);
    else out.push(`<path d="M${pt(mx - R * 0.24, my - R * 0.04)}Q${pt(mx, my + R * 0.2)} ${pt(mx + R * 0.26, my - R * 0.1)}" fill="none" stroke="${P.O}" stroke-width="${f(P.W * 0.8)}" stroke-linecap="round"/>`);
  }
  // Facial hair sits under the nose and over the mouth.
  const hair = look.colors.hair;
  if (look.facial === 'mustache') out.push(P.shape(`M${pt(hx + R * 0.32, hy + R * 0.34)}Q${pt(hx + R * 0.55, hy + R * 0.18)} ${pt(hx + R * 0.82, hy + R * 0.3)}Q${pt(hx + R * 1.08, hy + R * 0.22)} ${pt(hx + R * 1.18, hy + R * 0.4)}Q${pt(hx + R * 1.0, hy + R * 0.58)} ${pt(hx + R * 0.8, hy + R * 0.48)}Q${pt(hx + R * 0.56, hy + R * 0.62)} ${pt(hx + R * 0.32, hy + R * 0.34)}Z`, hair));
  if (look.facial === 'beard') out.push(P.shape(`M${pt(hx - R * 0.3, hy + R * 0.2)}Q${pt(hx - R * 0.2, hy + R * 1.15)} ${pt(hx + R * 0.45, hy + R * 1.1)}Q${pt(hx + R * 0.95, hy + R * 0.95)} ${pt(hx + R * 0.92, hy + R * 0.42)}Q${pt(hx + R * 0.5, hy + R * 0.7)} ${pt(hx - R * 0.3, hy + R * 0.2)}Z`, hair));
  if (look.facial === 'goatee') out.push(P.shape(`M${pt(hx + R * 0.4, hy + R * 0.62)}Q${pt(hx + R * 0.55, hy + R * 1.05)} ${pt(hx + R * 0.72, hy + R * 0.62)}Z`, hair));
  return out.join('');
}

/** Parts drawn behind the head (ears, quills, back hair) and in front (headwear). */
function headBack(P, look, hx, hy, R, wind) {
  const c = look.colors, out = [];
  if (look.top === 'quills') {
    // Swept-back quills, the hedgehog silhouette.
    const spikes = [[-150, 1.25, -165], [-118, 1.35, -140], [-88, 1.15, -112], [-62, 0.75, -78]];
    let d = '';
    for (const [a, len, tipA] of spikes) {
      const a1 = rad(a - 22), a2 = rad(a + 22), t = rad(tipA);
      d += `M${pt(hx + Math.cos(a1) * R * 0.8, hy + Math.sin(a1) * R * 0.8)}L${pt(hx + Math.cos(t) * R * (1 + len), hy + Math.sin(t) * R * (1 + len) + wind)}L${pt(hx + Math.cos(a2) * R * 0.8, hy + Math.sin(a2) * R * 0.8)}Z`;
    }
    out.push(P.shape(d, c.primary));
  }
  if (look.top === 'long-hair') out.push(P.shape(smoothPath([[hx - R * 0.9, hy - R * 0.5], [hx - R * 1.25, hy + R * 0.6], [hx - R * 1.05 - wind, hy + R * 1.5], [hx - R * 0.2, hy + R * 1.1], [hx + R * 0.2, hy - R * 0.2]]), c.accent));
  if (look.top === 'mohawk') out.push(P.shape(`M${pt(hx - R * 0.6, hy - R * 0.7)}Q${pt(hx - R * 0.2, hy - R * 1.9)} ${pt(hx + R * 0.5, hy - R * 1.2)}Q${pt(hx + R * 0.1, hy - R * 0.9)} ${pt(hx + R * 0.4, hy - R * 0.7)}Z`, c.accent));
  if (look.top === 'spikes') {
    let d = `M${pt(hx - R * 0.95, hy - R * 0.1)}`;
    [[-0.9, -1.3], [-0.45, -1.55], [0.05, -1.65], [0.55, -1.35], [0.85, -0.8]].forEach(([x, y], i, a) => { d += `L${pt(hx + x * R, hy + y * R)}L${pt(hx + (x + (a[i + 1]?.[0] ?? 0.95)) / 2 * R, hy - R * 0.75)}`; });
    out.push(P.shape(d + 'Z', c.accent));
  }
  const earPair = (fn) => { out.push(fn(-1)); out.push(fn(1)); };
  if (look.ears === 'pointed') earPair(s => {
    const bx = hx + s * R * 0.35 - R * 0.1;
    return P.shape(`M${pt(bx - R * 0.32, hy - R * 0.62)}L${pt(bx + s * R * 0.08 - R * 0.05, hy - R * 1.45)}L${pt(bx + R * 0.34, hy - R * 0.72)}Z`, c.primary)
      + P.flat(`M${pt(bx - R * 0.14, hy - R * 0.72)}L${pt(bx + s * R * 0.06 - R * 0.04, hy - R * 1.2)}L${pt(bx + R * 0.18, hy - R * 0.76)}Z`, c.secondary);
  });
  if (look.ears === 'round') earPair(s => P.circle(hx + s * R * 0.62 - R * 0.1, hy - R * 0.78, R * 0.32, c.primary) + `<circle cx="${f(hx + s * R * 0.62 - R * 0.1)}" cy="${f(hy - R * 0.78)}" r="${f(R * 0.16)}" fill="${c.secondary}"/>`);
  if (look.ears === 'long') earPair(s => P.ellipse(hx + s * R * 0.32 - R * 0.15, hy - R * 1.45, R * 0.2, R * 0.65, c.primary, ` transform="rotate(${f(s * 10 - 12 - wind * 4)} ${f(hx)} ${f(hy - R * 0.8)})"`));
  if (look.ears === 'floppy') out.push(P.ellipse(hx - R * 0.62, hy + R * 0.15, R * 0.24, R * 0.62, c.secondary, ` transform="rotate(${f(18 + wind * 6)} ${f(hx - R * 0.62)} ${f(hy - R * 0.4)})"`));
  if (look.ears === 'fins') out.push(P.shape(`M${pt(hx - R * 0.7, hy - R * 0.3)}L${pt(hx - R * 1.5, hy - R * 0.75)}L${pt(hx - R * 1.25, hy + R * 0.05)}L${pt(hx - R * 1.6, hy + R * 0.4)}L${pt(hx - R * 0.75, hy + R * 0.3)}Z`, c.accent));
  if (look.headwear === 'hood') out.push(P.shape(smoothPath([[hx - R * 1.25, hy + R * 0.9], [hx - R * 1.3, hy - R * 0.4], [hx - R * 0.4, hy - R * 1.3], [hx + R * 0.7, hy - R * 1.1], [hx + R * 1.2, hy - R * 0.2], [hx + R * 0.9, hy + R * 0.7]]), c.hat));
  return out.join('');
}

function headFront(P, look, hx, hy, R, wind) {
  const c = look.colors, out = [];
  if (look.top === 'tuft') out.push(P.shape(`M${pt(hx - R * 0.2, hy - R * 0.92)}Q${pt(hx - R * 0.1, hy - R * 1.6)} ${pt(hx + R * 0.5, hy - R * 1.45)}Q${pt(hx + R * 0.1, hy - R * 1.25)} ${pt(hx + R * 0.25, hy - R * 0.9)}Z`, c.primary));
  if (look.top === 'leaf') out.push(P.shape(`M${pt(hx, hy - R * 0.95)}Q${pt(hx + R * 0.2, hy - R * 1.9)} ${pt(hx + R * 1.0, hy - R * 1.7)}Q${pt(hx + R * 0.7, hy - R * 1.05)} ${pt(hx, hy - R * 0.95)}Z`, '#5fbf4a'));
  if (look.top === 'antenna') out.push(`<path d="M${pt(hx, hy - R)}L${pt(hx - R * 0.1 - wind, hy - R * 1.6)}" stroke="${P.O}" stroke-width="${f(P.W * 1.1)}" stroke-linecap="round"/>` + P.circle(hx - R * 0.1 - wind, hy - R * 1.65, R * 0.16, c.hat));
  if (look.headwear === 'cap') {
    out.push(P.shape(`M${pt(hx - R * 0.98, hy - R * 0.12)}C${pt(hx - R * 1.0, hy - R * 1.25)} ${pt(hx + R * 0.95, hy - R * 1.3)} ${pt(hx + R * 0.95, hy - R * 0.25)}Z`, c.hat));
    out.push(P.shape(`M${pt(hx + R * 0.55, hy - R * 0.3)}Q${pt(hx + R * 1.55, hy - R * 0.38)} ${pt(hx + R * 1.5, hy - R * 0.12)}Q${pt(hx + R * 1.0, hy - R * 0.02)} ${pt(hx + R * 0.45, hy - R * 0.08)}Z`, shade(c.hat, 0.12)));
    out.push(`<circle cx="${f(hx + R * 0.1)}" cy="${f(hy - R * 0.72)}" r="${f(R * 0.22)}" fill="#ffffff" stroke="${P.O}" stroke-width="${f(P.W * 0.6)}"/>`);
  }
  if (look.headwear === 'helmet') {
    out.push(P.shape(`M${pt(hx - R * 1.05, hy + R * 0.1)}C${pt(hx - R * 1.1, hy - R * 1.35)} ${pt(hx + R * 1.1, hy - R * 1.35)} ${pt(hx + R * 1.05, hy - R * 0.05)}L${pt(hx + R * 0.95, hy + R * 0.15)}L${pt(hx - R * 0.95, hy + R * 0.25)}Z`, c.hat));
    out.push(`<path d="M${pt(hx - R * 0.2, hy - R * 1.05)}Q${pt(hx + R * 0.1, hy - R * 0.4)} ${pt(hx - R * 0.05, hy + R * 0.15)}" fill="none" stroke="${light(c.hat, 0.35)}" stroke-width="${f(R * 0.12)}" stroke-linecap="round" opacity=".8"/>`);
  }
  if (look.headwear === 'crown') out.push(P.shape(`M${pt(hx - R * 0.55, hy - R * 0.78)}L${pt(hx - R * 0.65, hy - R * 1.5)}L${pt(hx - R * 0.25, hy - R * 1.1)}L${pt(hx + R * 0.05, hy - R * 1.65)}L${pt(hx + R * 0.35, hy - R * 1.1)}L${pt(hx + R * 0.75, hy - R * 1.5)}L${pt(hx + R * 0.65, hy - R * 0.8)}Z`, '#f5c542')
    + `<circle cx="${f(hx + R * 0.05)}" cy="${f(hy - R * 1.0)}" r="${f(R * 0.12)}" fill="${c.hat}"/>`);
  if (look.headwear === 'wizard-hat') out.push(P.shape(`M${pt(hx - R * 1.2, hy - R * 0.5)}Q${pt(hx, hy - R * 0.85)} ${pt(hx + R * 1.2, hy - R * 0.55)}L${pt(hx + R * 0.6, hy - R * 0.85)}Q${pt(hx - R * 0.2, hy - R * 2.6)} ${pt(hx - R * 1.3 - wind * 2, hy - R * 2.2)}Q${pt(hx - R * 0.4, hy - R * 1.6)} ${pt(hx - R * 0.6, hy - R * 0.8)}Z`, c.hat)
    + `<path d="M${pt(hx - R * 0.62, hy - R * 0.82)}Q${pt(hx, hy - R * 1.0)} ${pt(hx + R * 0.62, hy - R * 0.86)}" fill="none" stroke="#f5c542" stroke-width="${f(R * 0.16)}"/>`);
  if (look.headwear === 'horns') for (const s of [-1, 1]) out.push(P.shape(`M${pt(hx + s * R * 0.4 - R * 0.05, hy - R * 0.75)}Q${pt(hx + s * R * 0.9, hy - R * 1.2)} ${pt(hx + s * R * 0.75, hy - R * 1.7)}Q${pt(hx + s * R * 0.55, hy - R * 1.15)} ${pt(hx + s * R * 0.1, hy - R * 0.9)}Z`, '#f1e6cf'));
  if (look.headwear === 'bandana') {
    out.push(P.shape(`M${pt(hx - R * 0.98, hy - R * 0.35)}Q${pt(hx, hy - R * 0.75)} ${pt(hx + R * 0.98, hy - R * 0.4)}L${pt(hx + R * 0.98, hy - R * 0.12)}Q${pt(hx, hy - R * 0.45)} ${pt(hx - R * 0.98, hy - R * 0.05)}Z`, c.hat));
    out.push(P.shape(`M${pt(hx - R * 0.9, hy - R * 0.25)}L${pt(hx - R * 1.7, hy - R * 0.1 + wind * 3)}L${pt(hx - R * 1.55, hy + R * 0.25 + wind * 3)}Z`, c.hat));
  }
  if (look.headwear === 'goggles') out.push(`<path d="M${pt(hx - R * 0.98, hy - R * 0.55)}Q${pt(hx, hy - R * 0.9)} ${pt(hx + R * 0.98, hy - R * 0.55)}" fill="none" stroke="${P.O}" stroke-width="${f(R * 0.2)}"/>` + P.circle(hx + R * 0.15, hy - R * 0.72, R * 0.24, '#7fd3ff') + P.circle(hx + R * 0.62, hy - R * 0.62, R * 0.22, '#7fd3ff'));
  return out.join('');
}

/** People (no animal ears, quills or muzzle) get skin-colored heads; creatures get fur with a face patch. */
const isHuman = look => look.body === 'biped' && look.ears === 'none' && look.top !== 'quills' && (look.snout === 'none' || look.snout === 'nose' || look.snout === 'big-nose');

function drawHead(P, look, hx, hy, R, mode, wind) {
  const c = look.colors, human = isHuman(look), skin = human ? c.secondary : c.primary;
  const skull = look.body === 'robot'
    ? P.shape(`M${pt(hx - R, hy - R * 0.7)}Q${pt(hx - R, hy - R)} ${pt(hx - R * 0.7, hy - R)}H${f(hx + R * 0.7)}Q${pt(hx + R, hy - R)} ${pt(hx + R, hy - R * 0.7)}V${f(hy + R * 0.7)}Q${pt(hx + R, hy + R)} ${pt(hx + R * 0.7, hy + R)}H${f(hx - R * 0.7)}Q${pt(hx - R, hy + R)} ${pt(hx - R, hy + R * 0.7)}Z`, c.primary)
    : P.shape(smoothPath([[hx, hy - R], [hx + R * 0.95, hy - R * 0.3], [hx + R * 0.88, hy + R * 0.62], [hx, hy + R * 0.98], [hx - R * 0.9, hy + R * 0.6], [hx - R * 0.98, hy - R * 0.32]]), skin);
  // A skin-colored face patch keeps characters readable at small sizes.
  const face = human || look.snout === 'muzzle' || look.body === 'robot' ? '' : `<path d="${smoothPath([[hx + R * 0.05, hy - R * 0.55], [hx + R * 0.86, hy - R * 0.3], [hx + R * 0.82, hy + R * 0.55], [hx + R * 0.15, hy + R * 0.8], [hx - R * 0.2, hy + R * 0.2]])}" fill="${c.secondary}" opacity="${look.top === 'quills' || look.ears !== 'none' ? 1 : 0}"/>`;
  return headBack(P, look, hx, hy, R, wind) + skull + face + eyes(P, look, hx, hy, R, mode) + snoutAndMouth(P, look, hx, hy, R, mode) + headFront(P, look, hx, hy, R, wind);
}

// ---------- held items, hands, feet ----------

function held(P, look, [x, y], angle) {
  const g = (body) => `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(-angle + 90)})">${body}</g>`;
  switch (look.held) {
    case 'sword': return g(P.shape(`M-2.5 -3L2.5 -3L2 -30L0 -34L-2 -30Z`, '#d9e4f0') + P.shape('M-7 -3H7V0H-7Z', '#c79a3a') + P.shape('M-1.6 0H1.6V6H-1.6Z', '#6b4325'));
    case 'blaster': return g(P.shape('M-3 -2H3V-16H-3Z', look.colors.accent) + P.shape('M-4 -16H4V-20H-4Z', '#555c6a') + `<rect x="-2" y="-14" width="4" height="3" fill="#7fe3ff"/>`);
    case 'staff': return g(P.shape('M-1.6 8H1.6V-30H-1.6Z', '#8a5a2b') + P.circle(0, -33, 5, look.colors.accent) + `<circle cx="-1.5" cy="-34.5" r="1.6" fill="#fff" opacity=".8"/>`);
    case 'hammer': return g(P.shape('M-1.6 6H1.6V-20H-1.6Z', '#8a5a2b') + P.shape('M-8 -28H8V-18H-8Z', '#9aa3b0'));
    case 'shield': return `<g transform="translate(${f(x + 2)} ${f(y - 4)})">${P.shape('M-8 -10H8V0Q8 9 0 13Q-8 9 -8 0Z', look.colors.accent)}<path d="M0 -8V10M-6 -1H6" stroke="#f5c542" stroke-width="2"/></g>`;
    default: return '';
  }
}

function hand(P, look, [x, y], r) {
  if (look.hands === 'none') return '';
  if (look.hands === 'gloves') return P.circle(x, y, r * 1.12, '#ffffff') + `<path d="M${pt(x - r * 0.9, y - r * 0.6)}Q${pt(x, y - r * 1.4)} ${pt(x + r * 0.9, y - r * 0.6)}" fill="none" stroke="#d8dbe4" stroke-width="${f(r * 0.4)}"/>`;
  if (look.hands === 'claws') return P.circle(x, y, r, look.colors.primary) + `<path d="M${pt(x + r * 0.6, y + r * 0.4)}l${f(r * 0.7)} ${f(r * 0.5)}M${pt(x + r * 0.2, y + r * 0.8)}l${f(r * 0.4)} ${f(r * 0.8)}" stroke="${P.O}" stroke-width="${f(r * 0.4)}" stroke-linecap="round"/>`;
  return P.circle(x, y, r, look.colors.secondary);
}

function foot(P, look, [x, y], angle, scale = 1) {
  const c = look.colors, s = scale;
  const g = body => `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(-angle * 0.45)})">${body}</g>`;
  if (look.feet === 'none') return '';
  if (look.feet === 'paws') return g(P.ellipse(2.5 * s, 1.2 * s, 6.5 * s, 4.2 * s, c.primary));
  if (look.feet === 'boots') return g(P.shape(`M${-5 * s} ${-8 * s}H${4 * s}V${-1 * s}Q${11 * s} ${-1 * s} ${11 * s} ${3.5 * s}V${5 * s}H${-5.5 * s}Z`, c.accent) + `<rect x="${f(-5.5 * s)}" y="${f(3 * s)}" width="${f(16.5 * s)}" height="${f(2 * s)}" fill="${shade(c.accent, 0.35)}"/>`);
  // Sneakers: a rounded toe, a white band and a light sole.
  return g(P.shape(`M${-6 * s} ${-3.5 * s}Q${-6 * s} ${-7 * s} ${0} ${-6.5 * s}Q${9 * s} ${-5.5 * s} ${11.5 * s} ${0}Q${12 * s} ${4.5 * s} ${6 * s} ${4.5 * s}H${-5 * s}Q${-7 * s} ${4.5 * s} ${-6 * s} ${-3.5 * s}Z`, c.accent)
    + `<path d="M${f(1.5 * s)} ${f(-6.6 * s)}L${f(-0.5 * s)} ${f(4.4 * s)}" stroke="#ffffff" stroke-width="${f(2.6 * s)}"/>`
    + `<path d="M${f(-5.8 * s)} ${f(3.2 * s)}H${f(10.5 * s)}" stroke="${light(c.accent, 0.55)}" stroke-width="${f(1.8 * s)}" stroke-linecap="round"/>`);
}

function tail(P, look, [x, y], wind) {
  const c = look.colors;
  switch (look.tail) {
    case 'fluffy': return P.shape(smoothPath([[x, y], [x - 14, y - 6 - wind * 2], [x - 22, y - 22 - wind * 3], [x - 12, y - 30], [x - 8, y - 16], [x + 2, y - 5]]), c.primary) + `<path d="M${pt(x - 19, y - 24)}Q${pt(x - 13, y - 30)} ${pt(x - 10, y - 25)}" fill="${c.secondary}"/>`;
    case 'thin': return `<path d="M${pt(x, y)}Q${pt(x - 16, y + 2)} ${pt(x - 18, y - 14 - wind * 3)}" fill="none" stroke="${P.O}" stroke-width="${f(3 + 2 * P.W)}" stroke-linecap="round"/><path d="M${pt(x, y)}Q${pt(x - 16, y + 2)} ${pt(x - 18, y - 14 - wind * 3)}" fill="none" stroke="${c.primary}" stroke-width="3" stroke-linecap="round"/>` + P.circle(x - 18, y - 16 - wind * 3, 3.5, c.secondary);
    case 'spiky': return P.shape(`M${pt(x + 2, y - 4)}L${pt(x - 11, y - 3 - wind)}L${pt(x + 1, y + 3)}Z`, c.primary);
    case 'flame': return P.shape(`M${pt(x, y - 2)}Q${pt(x - 12, y + 2)} ${pt(x - 16, y - 10)}Q${pt(x - 20, y - 22 - wind * 3)} ${pt(x - 12, y - 30 - wind * 2)}Q${pt(x - 11, y - 20)} ${pt(x - 6, y - 18)}Q${pt(x - 2, y - 26)} ${pt(x + 1, y - 22)}Q${pt(x + 4, y - 10)} ${pt(x, y - 2)}Z`, '#ff8a2a') + P.flat(`M${pt(x - 3, y - 4)}Q${pt(x - 10, y - 6)} ${pt(x - 11, y - 13)}Q${pt(x - 11, y - 20)} ${pt(x - 7, y - 22)}Q${pt(x - 4, y - 12)} ${pt(x - 3, y - 4)}Z`, '#ffd84a');
    case 'fish': return P.shape(`M${pt(x + 1, y - 2)}L${pt(x - 14, y - 12 - wind * 2)}L${pt(x - 10, y)}L${pt(x - 14, y + 10 - wind * 2)}Z`, c.accent);
    default: return '';
  }
}

function accessoryBack(P, look, neck, hip, wind) {
  const c = look.colors;
  if (look.accessory === 'cape') return P.shape(`M${pt(neck[0] - 6, neck[1])}Q${pt(neck[0] - 20 - wind * 6, neck[1] + 14)} ${pt(hip[0] - 22 - wind * 9, hip[1] + 12)}L${pt(hip[0] - 4, hip[1] + 8)}Q${pt(neck[0] + 2, neck[1] + 14)} ${pt(neck[0] + 6, neck[1])}Z`, c.accent);
  if (look.accessory === 'backpack') return P.shape(`M${pt(neck[0] - 18, neck[1] + 2)}h12v20h-12Z`, '#9a6a3a');
  return '';
}
function accessoryFront(P, look, neck, hip, wind) {
  const c = look.colors;
  if (look.accessory === 'scarf') return P.shape(`M${pt(neck[0] - 9, neck[1] - 1)}Q${pt(neck[0], neck[1] + 5)} ${pt(neck[0] + 10, neck[1] - 2)}L${pt(neck[0] + 10, neck[1] + 4)}Q${pt(neck[0], neck[1] + 10)} ${pt(neck[0] - 9, neck[1] + 5)}Z`, c.accent)
    + P.shape(`M${pt(neck[0] - 7, neck[1] + 2)}L${pt(neck[0] - 22 - wind * 6, neck[1] + 2 + wind * 4)}L${pt(neck[0] - 20 - wind * 6, neck[1] + 9 + wind * 4)}L${pt(neck[0] - 6, neck[1] + 7)}Z`, c.accent);
  if (look.accessory === 'belt') return `<path d="M${pt(hip[0] - 12, hip[1] - 4)}Q${pt(hip[0], hip[1] - 1)} ${pt(hip[0] + 12, hip[1] - 4)}" fill="none" stroke="${P.O}" stroke-width="${f(5 + P.W)}"/><path d="M${pt(hip[0] - 12, hip[1] - 4)}Q${pt(hip[0], hip[1] - 1)} ${pt(hip[0] + 12, hip[1] - 4)}" fill="none" stroke="#6b4325" stroke-width="5"/><rect x="${f(hip[0] + 1)}" y="${f(hip[1] - 6.5)}" width="5" height="5" fill="#f5c542" stroke="${P.O}" stroke-width="1"/>`;
  return '';
}

// ---------- body plans ----------

function biped(look, poseName, opts) {
  const P = painter(look, opts), c = look.colors;
  const pose = BIPED_POSES[poseName] || BIPED_POSES.idle;
  const build = { chibi: { R: 19, leg: 11, arm: 10, torso: 16, tw: 13, limbW: 7 }, normal: { R: 15, leg: 14, arm: 12, torso: 20, tw: 12, limbW: 7 }, stocky: { R: 17, leg: 10, arm: 11, torso: 18, tw: 16, limbW: 9 }, tall: { R: 13, leg: 17, arm: 14, torso: 23, tw: 10, limbW: 6 } }[look.build];
  const footY = 92;
  // Plant grounded frames: drop the hips until the lowest foot touches the ground, which gives the stride its natural bob.
  const reach = ([a, bend]) => build.leg * Math.cos(rad(a)) + build.leg * Math.cos(rad(a - bend));
  const airborne = poseName === 'jump' || poseName === 'hurt';
  const hip = [50, airborne ? footY - build.leg * 2 - 1 + pose.bob : footY - Math.max(reach(pose.legN), reach(pose.legF))];
  const neck = [hip[0] + Math.sin(rad(pose.lean)) * build.torso, hip[1] - Math.cos(rad(pose.lean)) * build.torso];
  const head = [neck[0] + Math.sin(rad(pose.lean)) * build.R * 0.85 + 1, neck[1] - build.R * 0.85];
  const sh = [neck[0], neck[1] + 4];
  const legPts = ([a, bend], dx) => { const h = [hip[0] + dx, hip[1]]; const k = joint(h, a, build.leg); const fo = joint(k, a - bend, build.leg); return [h, k, fo]; };
  const armPts = ([a, bend], dx) => { const s = [sh[0] + dx, sh[1]]; const e = joint(s, a, build.arm); const hd = joint(e, a + bend, build.arm * 0.9); return [s, e, hd]; };
  const legN = legPts(pose.legN, build.tw * 0.3), legF = legPts(pose.legF, -build.tw * 0.3), armN = armPts(pose.armN, build.tw * 0.42), armF = armPts(pose.armF, -build.tw * 0.42);
  const shinAngle = pts => Math.atan2(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]) * 180 / Math.PI;
  const farColor = shade(c.primary, 0.12);
  // A bean-shaped torso, wider at the belly; the lean shifts the chest over the hips.
  const tw = build.tw, mid = [(neck[0] + hip[0]) / 2, (neck[1] + hip[1]) / 2 + 1];
  const torsoPath = smoothPath([[neck[0] - tw * 0.7, neck[1] + 1], [neck[0] + tw * 0.72, neck[1]], [mid[0] + tw * 1.02, mid[1]], [hip[0] + tw * 0.85, hip[1] + 2], [hip[0], hip[1] + 5], [hip[0] - tw * 0.85, hip[1] + 2], [mid[0] - tw * 0.98, mid[1]]]);
  const human = isHuman(look);
  const torsoColor = human ? c.primary : c.primary;
  const belly = human ? '' : `<path d="${smoothPath([[neck[0] + tw * 0.05, neck[1] + 4], [neck[0] + tw * 0.62, neck[1] + 4], [mid[0] + tw * 0.86, mid[1] + 1], [hip[0] + tw * 0.55, hip[1] + 2], [hip[0] - tw * 0.1, hip[1] + 1], [mid[0] - tw * 0.2, mid[1]]])}" fill="${c.secondary}"/>`;
  // Outfits: overalls (bib, straps, buttons, matching legs), a gi (wrap and belt) or a jacket.
  const legColor = look.outfit === 'overalls' || look.outfit === 'gi' ? c.outfit : c.primary;
  const armColor = look.arms === 'skin' ? c.secondary : c.primary;
  const outfit = look.outfit === 'overalls' ? P.shape(smoothPath([[mid[0] - tw * 0.62, mid[1] - 1], [mid[0] + tw * 0.7, mid[1] - 2], [hip[0] + tw * 0.86, hip[1] + 2], [hip[0], hip[1] + 5.5], [hip[0] - tw * 0.86, hip[1] + 2]]), c.outfit)
      + `<path d="M${pt(mid[0] - tw * 0.45, mid[1])}L${pt(neck[0] - tw * 0.5, neck[1] + 2)}M${pt(mid[0] + tw * 0.5, mid[1] - 1)}L${pt(neck[0] + tw * 0.48, neck[1] + 1)}" stroke="${c.outfit}" stroke-width="${f(tw * 0.32)}" stroke-linecap="round"/>`
      + [[-0.4, 0], [0.45, -1]].map(([dx, dy]) => `<circle cx="${f(mid[0] + tw * dx)}" cy="${f(mid[1] + dy + 1)}" r="${f(tw * 0.13)}" fill="#f5c542" stroke="${P.O}" stroke-width="${f(P.W * 0.5)}"/>`).join('')
    : look.outfit === 'gi' ? `<path d="M${pt(neck[0] - tw * 0.4, neck[1] + 1)}L${pt(mid[0] + tw * 0.4, mid[1] + 3)}M${pt(neck[0] + tw * 0.45, neck[1])}L${pt(mid[0] - tw * 0.1, mid[1] + 2)}" stroke="${shade(c.primary, 0.3)}" stroke-width="${f(P.W * 1.2)}"/><path d="M${pt(hip[0] - tw * 0.9, hip[1] - 3)}Q${pt(hip[0], hip[1] + 1)} ${pt(hip[0] + tw * 0.9, hip[1] - 3)}" stroke="${c.outfit}" stroke-width="${f(tw * 0.4)}" fill="none"/>`
    : look.outfit === 'jacket' ? `<path d="M${pt(neck[0] + tw * 0.1, neck[1] + 2)}L${pt(hip[0] + tw * 0.2, hip[1] + 3)}" stroke="${shade(c.primary, 0.35)}" stroke-width="${f(P.W)}"/><path d="M${pt(neck[0] - tw * 0.2, neck[1] + 1)}L${pt(neck[0] + tw * 0.15, neck[1] + 6)}L${pt(neck[0] + tw * 0.5, neck[1])}" fill="none" stroke="${light(c.primary, 0.3)}" stroke-width="${f(P.W)}"/>` : '';
  const stripes = look.accessory === 'stripes' ? `<path d="M${pt(hip[0] - 9, hip[1] - 9)}h18M${pt(hip[0] - 9, hip[1] - 4)}h18" stroke="${c.accent}" stroke-width="3" opacity=".9"/>` : '';
  const body = [
    accessoryBack(P, look, neck, hip, pose.wind),
    P.limb(armF.slice(0, 3), build.limbW * 0.9, shade(armColor, 0.12)), hand(P, { ...look, colors: { ...c } }, armF[2], 4.5),
    P.limb(legF, build.limbW, shade(legColor, 0.12)), foot(P, look, legF[2], shinAngle(legF), 0.95),
    tail(P, look, [hip[0] - build.torso * 0.45, hip[1] - 2], pose.wind),
    P.shape(torsoPath, torsoColor), look.outfit === 'overalls' ? '' : belly, outfit, stripes,
    P.limb(legN, build.limbW, legColor), foot(P, look, legN[2], shinAngle(legN)),
    accessoryFront(P, look, neck, hip, pose.wind),
    drawHead(P, look, head[0], head[1], build.R, pose.eyes, pose.wind),
    P.limb(armN.slice(0, 3), build.limbW * 0.9, armColor), held(P, look, armN[2], pose.armN[0] + pose.armN[1]), hand(P, look, armN[2], 4.8),
  ].join('');
  return { P, body };
}

function quadruped(look, poseName, opts) {
  const P = painter(look, opts), c = look.colors;
  const cyc = { idle: [0, 0, 0], idleB: [0, 0, 1], runA: [30, -25, -2], runB: [10, -5, 0], runC: [-25, 30, -2], runD: [-5, 10, 0], jump: [-40, 40, -4], fall: [25, -20, -2], hurt: [10, 10, 0] }[poseName] || [0, 0, 0];
  const [front, back, bob] = cyc;
  const by = 60 + bob, legLen = 14;
  const legs = [[66, front, 1], [36, back, 1], [60, -front * 0.7, 0], [30, -back * 0.7, 0]];
  const out = [];
  for (const [x, a, near] of legs.filter(l => !l[2])) { const k = joint([x, by + 6], a, legLen); const fo = joint(k, a * 0.3, legLen * 0.8); out.push(P.limb([[x, by + 6], k, fo], 7, shade(c.primary, 0.12)), foot(P, { ...look, feet: 'paws' }, fo, a, 0.8)); }
  out.push(tail(P, look, [24, by - 4], cyc[0] / 30));
  out.push(P.shape(smoothPath([[24, by - 6], [44, by - 15], [70, by - 12], [78, by + 2], [62, by + 12], [30, by + 11], [20, by + 2]]), c.primary));
  out.push(`<path d="${smoothPath([[36, by + 8], [56, by + 4], [70, by + 6], [60, by + 11], [36, by + 11]])}" fill="${c.secondary}"/>`);
  if (look.accessory === 'spots') out.push(`<circle cx="40" cy="${f(by - 6)}" r="4" fill="${c.accent}" opacity=".9"/><circle cx="54" cy="${f(by - 9)}" r="3" fill="${c.accent}" opacity=".9"/>`);
  for (const [x, a, near] of legs.filter(l => l[2])) { const k = joint([x, by + 6], a, legLen); const fo = joint(k, a * 0.3, legLen * 0.8); out.push(P.limb([[x, by + 6], k, fo], 7.5, c.primary), foot(P, { ...look, feet: 'paws' }, fo, a, 0.85)); }
  out.push(drawHead(P, look, 78, by - 18, 15, poseName === 'hurt' ? 'hurt' : 'open', cyc[0] / 40));
  return { P, body: out.join('') };
}

function blob(look, poseName, opts) {
  const P = painter(look, opts), c = look.colors;
  const [sx, sy, lift] = { idle: [1, 1, 0], idleB: [1.04, 0.96, 0], runA: [1.12, 0.86, 0], runB: [0.92, 1.1, -4], runC: [1.12, 0.86, 0], runD: [0.92, 1.1, -4], jump: [0.84, 1.2, -8], fall: [0.94, 1.08, -4], hurt: [1.2, 0.8, 0] }[poseName] || [1, 1, 0];
  const w = 34 * sx, h = 36 * sy, base = 95 + lift;
  const path = `M${pt(50 - w, base)}C${pt(50 - w * 1.05, base - h * 0.9)} ${pt(50 - w * 0.55, base - h * 1.45)} ${pt(52, base - h * 1.4)}C${pt(50 + w * 0.65, base - h * 1.4)} ${pt(50 + w * 1.05, base - h * 0.8)} ${pt(50 + w, base)}Q${pt(50, base + 4)} ${pt(50 - w, base)}Z`;
  const out = [P.shape(path, c.primary)];
  out.push(`<ellipse cx="${f(36)}" cy="${f(base - h * 1.05)}" rx="${f(w * 0.22)}" ry="${f(h * 0.14)}" fill="#ffffff" opacity=".55" transform="rotate(-30 36 ${f(base - h * 1.05)})"/>`);
  if (look.accessory === 'spots') out.push(`<circle cx="34" cy="${f(base - h * 0.5)}" r="4" fill="${c.accent}" opacity=".8"/><circle cx="46" cy="${f(base - h * 0.25)}" r="3" fill="${c.accent}" opacity=".8"/>`);
  out.push(eyes(P, look, 54, base - h * 0.85, 22, poseName === 'hurt' ? 'hurt' : 'open'));
  out.push(snoutAndMouth(P, { ...look, snout: 'none' }, 56, base - h * 0.75, 22, poseName === 'hurt' ? 'hurt' : 'open'));
  out.push(headFront(P, look, 52, base - h * 0.95, 22 * Math.min(1.1, sx), 0));
  return { P, body: out.join('') };
}

function flyer(look, poseName, opts) {
  const P = painter(look, opts), c = look.colors;
  const flap = { idle: 0, idleB: 0.5, runA: -1, runB: 0.2, runC: 1, runD: 0.2, jump: -1, fall: 1, hurt: 0.6 }[poseName] ?? 0;
  const bob = flap * -3, cx = 50, cy = 52 + bob;
  const wing = (dx, dy, color, s) => P.shape(`M${pt(cx + dx, cy + dy)}Q${pt(cx + dx - 18 * s, cy + dy - 22 * flap - 8)} ${pt(cx + dx - 34 * s, cy + dy - 30 * flap - 2)}Q${pt(cx + dx - 26 * s, cy + dy - 4)} ${pt(cx + dx - 30 * s, cy + dy + 6)}Q${pt(cx + dx - 14 * s, cy + dy + 8)} ${pt(cx + dx, cy + dy + 8)}Z`, color);
  const out = [wing(-4, -4, shade(c.primary, 0.15), 0.9)];
  out.push(tail(P, { ...look, tail: look.tail === 'none' ? 'fish' : look.tail }, [cx - 18, cy + 8], flap));
  out.push(P.ellipse(cx, cy, 22, 20, c.primary));
  out.push(`<ellipse cx="${f(cx + 6)}" cy="${f(cy + 7)}" rx="13" ry="11" fill="${c.secondary}"/>`);
  out.push(`<path d="M${pt(cx - 2, cy + 19)}v7m6 -7v7" stroke="#e8a23a" stroke-width="3" stroke-linecap="round"/>`);
  out.push(eyes(P, look, cx + 6, cy - 5, 18, poseName === 'hurt' ? 'hurt' : 'open'));
  out.push(snoutAndMouth(P, { ...look, snout: look.snout === 'none' ? 'beak' : look.snout }, cx + 6, cy - 2, 18, poseName === 'hurt' ? 'hurt' : 'open'));
  out.push(headFront(P, look, cx + 2, cy - 4, 18, flap));
  out.push(wing(6, 0, c.primary, 0.75));
  return { P, body: out.join('') };
}

function robot(look, poseName, opts) {
  // A wheeled shell bot: dome shell, face plate, wheel with spokes that turn per frame.
  const P = painter(look, opts), c = look.colors;
  const spin = { idle: 0, idleB: 0, runA: 0, runB: 30, runC: 60, runD: 90, jump: 15, fall: 45, hurt: 0 }[poseName] ?? 0;
  const bob = { runA: -1, runC: -1, jump: -4, fall: -2 }[poseName] ?? 0;
  const cy = 62 + bob, out = [];
  out.push(`<path d="M${pt(30, cy + 20)}L${pt(26, cy + 30)}" stroke="${P.O}" stroke-width="5" stroke-linecap="round"/>`);
  out.push(`<g transform="translate(52 ${f(84 + bob * 0.3)}) rotate(${spin})">${P.circle(0, 0, 11, '#3a3f4b')}<circle r="5" fill="#9aa3b0" stroke="${P.O}" stroke-width="1.6"/>${[0, 60, 120].map(a => `<path d="M0 0L${f(9 * Math.cos(rad(a)))} ${f(9 * Math.sin(rad(a)))}M0 0L${f(-9 * Math.cos(rad(a)))} ${f(-9 * Math.sin(rad(a)))}" stroke="#c9d0da" stroke-width="1.6"/>`).join('')}</g>`);
  out.push(P.shape(`M${pt(20, cy + 12)}C${pt(18, cy - 22)} ${pt(72, cy - 30)} ${pt(80, cy + 4)}L${pt(82, cy + 14)}Q${pt(50, cy + 22)} ${pt(20, cy + 12)}Z`, c.primary));
  if (look.accessory !== 'stripes') out.push(`<circle cx="38" cy="${f(cy - 6)}" r="5" fill="${c.secondary}" stroke="${P.O}" stroke-width="1.6"/><circle cx="54" cy="${f(cy - 12)}" r="4" fill="${c.secondary}" stroke="${P.O}" stroke-width="1.6"/><circle cx="30" cy="${f(cy + 4)}" r="3.2" fill="${c.secondary}" stroke="${P.O}" stroke-width="1.6"/>`);
  else out.push(`<path d="M${pt(30, cy - 14)}Q${pt(34, cy)} ${pt(30, cy + 12)}M${pt(44, cy - 18)}Q${pt(48, cy)} ${pt(44, cy + 15)}" stroke="${c.secondary}" stroke-width="4" fill="none"/>`);
  out.push(`<path d="M${pt(22, cy + 12)}Q${pt(50, cy + 20)} ${pt(82, cy + 13)}" fill="none" stroke="${shade(c.primary, 0.4)}" stroke-width="3"/>`);
  out.push(drawHead(P, { ...look, eyes: look.eyes === 'cartoon' ? 'visor' : look.eyes, top: look.top === 'none' ? 'antenna' : look.top }, 78, cy - 6, 12, poseName === 'hurt' ? 'hurt' : 'open', bob));
  out.push(P.shape(`M${pt(76, cy + 6)}L${pt(92, cy + 12)}L${pt(88, cy + 4)}L${pt(94, cy + 2)}L${pt(80, cy - 1)}Z`, '#9aa3b0'));
  return { P, body: out.join('') };
}

function ghost(look, poseName, opts) {
  const P = painter(look, { ...opts, soft: true }), c = look.colors;
  const t = { idle: 0, idleB: 1, runA: 2, runB: 3, runC: 4, runD: 5, jump: 1, fall: 3, hurt: 0 }[poseName] ?? 0;
  const bob = Math.sin(t) * 2.5, cy = 48 + bob, out = [];
  let d = `M${pt(24, cy + 30)}C${pt(18, cy - 28)} ${pt(82, cy - 28)} ${pt(76, cy + 30)}`;
  for (let i = 0; i < 4; i++) { const x0 = 76 - i * 13, wave = Math.sin(t + i) * 3; d += `Q${pt(x0 - 3.2, cy + 40 + wave)} ${pt(x0 - 6.5, cy + 31)}Q${pt(x0 - 9.8, cy + 24 - wave)} ${pt(x0 - 13, cy + 30)}`; }
  out.push(P.shape(d + 'Z', c.primary));
  out.push(P.ellipse(80, cy + 8, 6, 4, c.primary), P.ellipse(22, cy + 10, 6, 4, c.primary));
  out.push(eyes(P, look, 54, cy - 2, 20, poseName === 'hurt' ? 'hurt' : 'open'));
  out.push(snoutAndMouth(P, { ...look, snout: 'none' }, 54, cy + 2, 20, poseName === 'hurt' ? 'hurt' : 'open'));
  out.push(headFront(P, look, 50, cy - 4, 22, 0));
  return { P, body: out.join('') };
}

const PLANS = { biped, quadruped, blob, flyer, robot, ghost };

/**
 * Paint one character pose as an SVG document.
 * `pixel` renders at a small natural size with crisp edges for the pixel-art look.
 * An art look (art/look.js paintOptions) adds `size`, `ink` (outline mode and width) and `shading` (cel bands).
 */
export function paintCharacter(lookInput, pose = 'idle', { pixel = false, size, ink = null, shading = null } = {}) {
  const look = normalizeLook(lookInput);
  const { P, body } = PLANS[look.body](look, pose, { soft: false, outlineWidth: pixel ? 3.2 : 2.4, ink, shading });
  const px = size || (pixel ? 64 : 256);
  return document({ width: px, height: px, viewBox: '0 0 100 100', defs: P.d.toString(), body: `<g>${body}</g>`, crisp: pixel });
}

/** All animation frames for a character, keyed by pose name. */
export function paintCharacterFrames(look, opts = {}) {
  return Object.fromEntries(POSE_NAMES.map(p => [p, paintCharacter(look, p, opts)]));
}
