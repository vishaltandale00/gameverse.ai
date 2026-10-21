// graphics.model.lowpoly: models composed of boxes, cylinders, spheres, cones
// and capsules with matte/metal/glow materials and bone tags. Rigged specs
// (rig: humanoid | quadruped | custom) get a full generated body along the
// skeleton (hair styles, clothing layers, snouts, manes, antlers, saddles)
// with the spec's own parts layered on top; meshes are skinned (one draw call
// per material class) with blended weights across elbows and knees.
import { joinStage, presentationOnly } from './three-stage.js';
import { humanoidRig, PART_ALIASES } from './rig-humanoid.js';
import { quadrupedRig, legFraction } from './rig-quadruped.js';
import { customRig } from './three-rig.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mid = (a, b, t = 0.5) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const len = v => Math.hypot(v[0], v[1], v[2]);

/** A capsule/cylinder between two joints, blended into `blendTo` near its far end. */
const limb = (from, to, r, c, bone, extra = {}) => ({ shape: extra.shape || 'cap', from, to, size: [r * 2, len(sub(to, from)), r * 2], c, bone, ...extra });
const box = (at, size, c, bone, extra = {}) => ({ shape: 'box', at, size, c, bone, ...extra });

/** Rig for a spec (humanoid / quadruped / custom / none). rigCfg: graphics.rig.* params. */
export function rigForSpec(spec, rigCfg = {}) {
  if (spec.rig === 'humanoid') return humanoidRig({ height: spec.height || 1.8, proportions: { ...(rigCfg.humanoid?.proportions || {}), ...(spec.proportions || {}) }, build: spec.build || {}, scale: rigCfg.humanoid?.scale || 1 });
  if (spec.rig === 'quadruped') {
    const q = rigCfg.quadruped || {};
    const length = spec.length || q.bodyLength / 0.62 || 1.6, height = spec.height || (q.legLength ? q.legLength / legFraction(q.legLength, q.bodyLength || 1.4) : 1.2);
    return quadrupedRig({ length, height, legLength: q.legLength ? legFraction(q.legLength, q.bodyLength || 1.4) : undefined, neck: spec.features?.neck ?? 0.3 });
  }
  if (spec.rig === 'custom' || (spec.bones && spec.parts?.length)) return customRig(spec.parts || [], { bones: typeof spec.bones === 'number' ? spec.bones : 8 });
  return null;
}

/** Resolve a part color key/hex against the palette. */
export const resolveColor = (c, palette) => (typeof c === 'string' && c.startsWith('#')) ? c : (palette?.[c] ?? '#888888');

/** Generated humanoid body along the rig. */
export function humanoidBody(rig, spec) {
  const pal = spec.palette || {}, J = Object.fromEntries(rig.bones.map(b => [b.name, b.head]));
  const H = rig.height, w = spec.build?.width ?? 1, headScale = spec.build?.head ?? 1;
  const skin = 'skin' in pal ? 'skin' : '#d8b090', cloth = 'cloth' in pal ? 'cloth' : '#556070', pants = 'pants' in pal ? 'pants' : cloth, boots = 'boots' in pal ? 'boots' : '#2a2018', trim = 'trim' in pal ? 'trim' : cloth, hair = 'hair' in pal ? 'hair' : '#2a2420';
  const mat = spec.material === 'metal' ? 'metal' : 'matte', alpha = spec.alpha;
  const P = [];
  const add = p => P.push(alpha != null && !p.mat?.includes('glow') ? { ...p, alpha } : p);
  const torsoD = 0.13 * H * Math.max(0.8, w), shW = rig.shoulderWidth, hipW = rig.hipWidth;
  // Torso: pelvis, abdomen, chest (tapered wider at the shoulders), collar, belt.
  add(box(mid(J.hips, J.spine, 0.3), [hipW * 2 + 0.07 * H * w, (J.spine[1] - J.hips[1]) * 1.6 + 0.04 * H, torsoD * 0.95], pants, 'hips', { mat }));
  add(box(mid(J.spine, J.chest), [hipW * 2 + 0.06 * H * w, J.chest[1] - J.spine[1] + 0.02 * H, torsoD * 0.92], cloth, 'spine', { mat }));
  add(box(mid(J.chest, J.neck, 0.45), [shW * 1.75, (J.neck[1] - J.chest[1]) * 1.25, torsoD], cloth, 'chest', { taper: 1.12, mat }));
  add(box([0, J.neck[1] - 0.012 * H, 0], [shW * 1.2, 0.02 * H, torsoD * 1.02], trim, 'chest', { mat }));
  add(box([0, J.hips[1] + 0.012 * H, 0], [hipW * 2 + 0.075 * H * w, 0.025 * H, torsoD * 1.0], trim, 'hips', { name: 'belt', mat: 'metal' }));
  // Neck and head.
  add(limb(J.neck, J.head, 0.035 * H, skin, 'neck', { shape: 'cyl', blendTo: 'head' }));
  const hs = rig.headSize * headScale, hc = [0, J.head[1] + hs * 0.38, 0.005 * H];
  add(box(hc, [hs * 0.66, hs * 0.76, hs * 0.72], skin, 'head', { name: 'head', bevel: true }));
  add(box([0, hc[1] - hs * 0.06, hc[2] + hs * 0.37], [hs * 0.1, hs * 0.14, hs * 0.08], skin, 'head', { name: 'nose' }));
  const eye = spec.eyes === 'glow' ? { c: 'glow' in pal ? 'glow' : '#ffe080', mat: 'glow' } : { c: 'eye' in pal ? 'eye' : '#1a1410', mat: 'matte' };
  for (const x of [1, -1]) {
    add(box([x * hs * 0.16, hc[1] + hs * 0.06, hc[2] + hs * 0.355], [hs * 0.1, hs * 0.08, hs * 0.03], eye.c, 'head', { mat: eye.mat }));
    if (spec.hair !== 'helmet' && spec.hair !== 'hood') add(box([x * hs * 0.16, hc[1] + hs * 0.16, hc[2] + hs * 0.36], [hs * 0.16, hs * 0.035, hs * 0.03], hair, 'head'));
  }
  hairStyle(spec.hair || 'short', hc, hs, hair, cloth, trim, H).forEach(add);
  // Arms: sleeve, forearm, hand.
  for (const s of ['L', 'R']) {
    const x = s === 'L' ? 1 : -1;
    add(box(mid(J[`shoulder${s}`], J[`upperArm${s}`], 0.7), [0.09 * H, 0.08 * H, torsoD * 0.85], cloth, 'chest', { mat }));
    add(limb(J[`upperArm${s}`], J[`lowerArm${s}`], 0.036 * H * Math.max(0.85, w), cloth, `upperArm${s}`, { blendTo: `lowerArm${s}`, mat }));
    add(limb(J[`lowerArm${s}`], J[`hand${s}`], 0.03 * H * Math.max(0.85, w), spec.sleeves === 'long' ? cloth : skin, `lowerArm${s}`, { blendTo: `hand${s}` }));
    add(box([J[`hand${s}`][0] + x * 0.004 * H, J[`hand${s}`][1] - 0.04 * H, J[`hand${s}`][2]], [0.045 * H, 0.08 * H, 0.05 * H], skin, `hand${s}`, { name: `hand${s}` }));
    add(box([J[`lowerArm${s}`][0], mid(J[`lowerArm${s}`], J[`hand${s}`], 0.85)[1], J[`lowerArm${s}`][2]], [0.07 * H, 0.03 * H, 0.07 * H], trim, `lowerArm${s}`, { name: `cuff${s}` }));
  }
  // Legs: thigh, shin, boot (or a robe for floating spirits).
  if (spec.legs === 'robe') {
    add(box([0, J.hips[1] * 0.55, 0], [hipW * 2 + 0.12 * H, J.hips[1] * 1.0, torsoD * 1.15], cloth, 'hips', { taper: 0.65, alpha: alpha ?? 0.8, name: 'robe' }));
  } else for (const s of ['L', 'R']) {
    add(limb(J[`upperLeg${s}`], J[`lowerLeg${s}`], 0.05 * H * Math.max(0.85, w), pants, `upperLeg${s}`, { blendTo: `lowerLeg${s}`, mat }));
    add(limb(J[`lowerLeg${s}`], J[`foot${s}`], 0.042 * H * Math.max(0.85, w), boots, `lowerLeg${s}`, { blendTo: `foot${s}`, mat }));
    const f = J[`foot${s}`], t = J[`toes${s}`];
    add(box([f[0], f[1] * 0.55, (f[2] + t[2]) / 2 + 0.005 * H], [0.06 * H, f[1] * 1.15, (t[2] - f[2]) + 0.09 * H], boots, `foot${s}`, { name: `boot${s}` }));
  }
  return P;
}

function hairStyle(style, hc, hs, hair, cloth, trim, H) {
  const top = hc[1] + hs * 0.38, back = hc[2] - hs * 0.36, out = [];
  const cap = (extra = {}) => box([0, top + hs * 0.02, hc[2] - hs * 0.03], [hs * 0.72, hs * 0.16, hs * 0.8], hair, 'head', { name: 'hair', ...extra });
  const backHair = (h = 0.45) => box([0, top - hs * h / 2, back - hs * 0.02], [hs * 0.7, hs * h, hs * 0.1], hair, 'head', { name: 'hair' });
  switch (style) {
    case 'bald': break;
    case 'short': out.push(cap(), backHair(0.4)); break;
    case 'short-tied': out.push(cap(), backHair(0.4), box([0, hc[1] + hs * 0.1, back - hs * 0.1], [hs * 0.14, hs * 0.14, hs * 0.18], hair, 'head', { name: 'tie' })); break;
    case 'bun': out.push(cap(), backHair(0.35), { shape: 'sphere', at: [0, top - hs * 0.05, back - hs * 0.12], size: [hs * 0.32, hs * 0.32, hs * 0.3], c: hair, bone: 'head', name: 'bun' }); break;
    case 'braid': out.push(cap(), backHair(0.45), box([0, hc[1] - hs * 0.55, back - hs * 0.06], [hs * 0.15, hs * 0.9, hs * 0.13], hair, 'head', { name: 'braid', secondary: true })); break;
    case 'long': out.push(cap(), box([0, top - hs * 0.55, back - hs * 0.03], [hs * 0.76, hs * 1.15, hs * 0.12], hair, 'head', { name: 'hair', secondary: true }), box([hs * 0.36, top - hs * 0.35, hc[2]], [hs * 0.06, hs * 0.7, hs * 0.6], hair, 'head'), box([-hs * 0.36, top - hs * 0.35, hc[2]], [hs * 0.06, hs * 0.7, hs * 0.6], hair, 'head')); break;
    case 'ponytail': out.push(cap(), backHair(0.35), box([0, hc[1], back - hs * 0.12], [hs * 0.16, hs * 0.5, hs * 0.14], hair, 'head', { name: 'hair', secondary: true })); break;
    case 'spiky': out.push(cap()); for (let i = 0; i < 6; i++) out.push({ shape: 'cone', at: [Math.sin(i * 1.05) * hs * 0.24, top + hs * 0.14, hc[2] + Math.cos(i * 1.05) * hs * 0.26], size: [hs * 0.2, hs * 0.3, hs * 0.2], rot: [Math.cos(i * 1.05) * 0.5, 0, -Math.sin(i * 1.05) * 0.5], c: hair, bone: 'head', name: 'hair' }); break;
    case 'hood': out.push(box([0, top - hs * 0.2, hc[2] - hs * 0.06], [hs * 0.86, hs * 1.0, hs * 0.92], cloth, 'head', { name: 'hood' }), box([0, top - hs * 0.9, back + hs * 0.05], [hs * 0.9, hs * 0.5, hs * 0.3], cloth, 'chest', { name: 'hood_drape' })); break;
    case 'helmet': out.push(box([0, top - hs * 0.15, hc[2] - hs * 0.02], [hs * 0.8, hs * 0.55, hs * 0.86], '#7a8088', 'head', { mat: 'metal', name: 'helmet' }), box([0, top - hs * 0.42, hc[2] + hs * 0.42], [hs * 0.5, hs * 0.08, hs * 0.04], trim, 'head', { mat: 'metal' })); break;
    default: out.push(cap(), backHair(0.4));
  }
  return out;
}

/**
 * Generated quadruped body along the rig (horse, deer, wolf, boar, cow, cat, dragon). Head features are the spec's
 * declared `features` ({ neck, ears: 'long' | 'pointed' | 'short', antlers, tusks, horns, bushy tail, mane, ruff }; `horns`
 * and `mane` also at the top level).
 */
export function quadrupedBody(rig, spec, { saddle = false } = {}) {
  const pal = spec.palette || {}, J = Object.fromEntries(rig.bones.map(b => [b.name, b.head])), ft = spec.features || {};
  const coat = 'coat' in pal ? 'coat' : '#7a6a5a', mane = 'mane' in pal ? 'mane' : coat, hooves = 'hooves' in pal ? 'hooves' : '#222', belly = 'belly' in pal ? 'belly' : coat;
  const L = rig.length, H = rig.height, hw = rig.halfWidth, P = [];
  const deep = Math.max(0.2 * H, 0.26 * (H - rig.legLength + 0.25 * H));
  const bodyH = Math.max(0.28 * H, H - rig.legLength) * 1.05;
  const torsoW = hw * 2.3;
  P.push(box(mid(J.hips, J.chest), [torsoW, bodyH, len(sub(J.chest, J.hips)) * 1.1], coat, 'spine', { name: 'barrel', bevel: true }));
  P.push(box([0, J.chest[1] - bodyH * 0.02, J.chest[2]], [torsoW * 1.05, bodyH * 1.05, bodyH * 0.9], coat, 'chest', { name: 'chest' }));
  P.push(box([0, J.hips[1] + bodyH * 0.02, J.hips[2]], [torsoW * 1.02, bodyH * 1.02, bodyH * 0.85], coat, 'hips', { name: 'rump' }));
  P.push(box([0, J.hips[1] - bodyH * 0.45, (J.hips[2] + J.chest[2]) / 2], [torsoW * 0.8, bodyH * 0.1, len(sub(J.chest, J.hips)) * 0.8], belly, 'spine', { name: 'belly' }));
  void deep;
  // Neck and head.
  P.push(limb(J.neck, J.neck_2, bodyH * 0.32, coat, 'neck', { blendTo: 'neck_2', shape: 'cyl' }));
  P.push(limb(J.neck_2, J.head, bodyH * 0.27, coat, 'neck_2', { blendTo: 'head', shape: 'cyl' }));
  const headL = rig.neckLength * 0.55, hh = bodyH * 0.42;
  P.push(box([0, J.head[1], J.head[2] + headL * 0.2], [hh * 0.9, hh, headL * 0.6], coat, 'head', { name: 'skull' }));
  P.push(box([0, J.head[1] - hh * 0.15, J.head[2] + headL * 0.65], [hh * 0.7, hh * 0.65, headL * 0.6], coat, 'head', { name: 'snout', taper: 0.85 }));
  P.push(box([0, J.head[1] - hh * 0.05, J.head[2] + headL * 0.96], [hh * 0.42, hh * 0.25, 0.04 * L], ft.tusks ? '#c88a88' : '#2a2220', 'head', { name: 'nose' }));
  const eyeGlow = 'glow' in pal;
  for (const x of [1, -1]) P.push(box([x * hh * 0.46, J.head[1] + hh * 0.18, J.head[2] + headL * 0.32], [0.03 * L, 0.035 * L, 0.035 * L], eyeGlow ? 'glow' : '#120c08', 'head', { mat: eyeGlow ? 'glow' : 'matte' }));
  for (const s of ['L', 'R']) P.push({ shape: 'cone', at: J[`ear${s}`], size: [hh * 0.28, hh * (ft.ears === 'long' ? 1.2 : ft.ears === 'pointed' ? 0.55 : 0.4), hh * 0.16], c: coat, bone: 'head', name: `ear${s}`, rot: [-0.2, 0, s === 'L' ? -0.25 : 0.25] });
  if (ft.antlers) for (const x of [1, -1]) {
    const base = [x * hh * 0.25, J.head[1] + hh * 0.5, J.head[2] + headL * 0.15];
    P.push(limb(base, [base[0] + x * hh * 0.5, base[1] + hh * 1.2, base[2] - hh * 0.2], 0.018 * L, 'hooves' in pal ? hooves : '#d8c8a0', 'head', { shape: 'cyl', name: 'antler' }));
    P.push(limb([base[0] + x * hh * 0.25, base[1] + hh * 0.6, base[2] - hh * 0.1], [base[0] + x * hh * 0.1, base[1] + hh * 1.0, base[2] + hh * 0.3], 0.014 * L, 'hooves' in pal ? hooves : '#d8c8a0', 'head', { shape: 'cyl' }));
  }
  if (ft.tusks) for (const x of [1, -1]) P.push({ shape: 'cone', at: [x * hh * 0.3, J.head[1] - hh * 0.25, J.head[2] + headL * 0.85], size: [0.03 * L, 0.12 * L, 0.03 * L], c: '#f0e8d8', bone: 'head', rot: [0.5, 0, x * 0.3] });
  if (ft.horns || spec.horns) for (const x of [1, -1]) P.push({ shape: 'cone', at: [x * hh * 0.42, J.head[1] + hh * 0.5, J.head[2] + headL * 0.1], size: [0.04 * L, 0.16 * L, 0.04 * L], c: '#e8e0d0', bone: 'head', rot: [-0.3, 0, -x * 0.6] });
  // Legs: upper (thick), lower, hoof/paw.
  for (const leg of ['FL', 'FR', 'BL', 'BR']) {
    const front = leg[0] === 'F', r0 = (front ? 0.085 : 0.1) * H * (L / H > 1.6 ? 1 : 1.2);
    P.push(limb(J[`upperLeg${leg}`], J[`lowerLeg${leg}`], r0, coat, `upperLeg${leg}`, { blendTo: `lowerLeg${leg}` }));
    P.push(limb(J[`lowerLeg${leg}`], J[`hoof${leg}`], r0 * 0.6, coat, `lowerLeg${leg}`, { blendTo: `hoof${leg}`, shape: 'cyl' }));
    P.push(box([J[`hoof${leg}`][0], J[`hoof${leg}`][1] * 0.5, J[`hoof${leg}`][2] + r0 * 0.15], [r0 * 1.4, J[`hoof${leg}`][1] * 1.2 + 0.02, r0 * 1.6], hooves, `hoof${leg}`, { name: `hoof${leg}` }));
  }
  // Tail and mane chains (spring-bone targets).
  const tails = rig.bones.filter(b => b.name.startsWith('tail_'));
  const bushy = Boolean(ft.bushy);
  let prevT = J.hips;
  tails.forEach((b, i) => { P.push(limb(prevT, b.head, (bushy ? 0.07 : 0.035) * L * (1 - i * 0.18), bushy ? coat : mane, i ? tails[i - 1].name : 'hips', { blendTo: b.name, name: b.name, secondary: true })); prevT = b.head; });
  if (ft.mane || spec.mane) rig.bones.filter(b => b.name.startsWith('mane_')).forEach(b => P.push(box([0, b.head[1] + 0.02 * L, b.head[2] - 0.03 * L], [0.05 * L, 0.18 * H, 0.13 * L], mane, b.name, { name: b.name, secondary: true })));
  if (ft.ruff && 'mane' in pal) P.push(box([0, J.chest[1] + bodyH * 0.35, J.chest[2] - 0.05 * L], [torsoW * 1.05, bodyH * 0.35, bodyH * 1.0], mane, 'chest', { name: 'ruff' }));
  if (spec.wings) for (const x of [1, -1]) P.push(box([x * (hw + L * 0.25), J.chest[1] + bodyH * 0.5, J.chest[2] - 0.15 * L], [L * 0.5, 0.02 * L, L * 0.35], mane, 'chest', { name: x > 0 ? 'wingL' : 'wingR' }));
  if (saddle || spec.saddle) {
    const s = J.saddle, saddleC = 'saddle' in pal ? 'saddle' : '#5a3a24', tack = 'tack' in pal ? 'tack' : '#c8a038';
    P.push(box([0, s[1] + bodyH * 0.04, s[2]], [torsoW * 1.1, bodyH * 0.14, bodyH * 0.8], saddleC, 'spine', { name: 'saddle' }));
    P.push(box([0, s[1] - bodyH * 0.25, s[2]], [torsoW * 1.12, bodyH * 0.5, 0.04 * L], tack, 'spine', { name: 'girth', mat: 'metal' }));
    P.push(box([0, J.head[1] + hh * 0.05, J.head[2] + headL * 0.3], [hh * 0.95, hh * 0.08, headL * 0.5], tack, 'head', { name: 'bridle' }));
  }
  return P;
}

/**
 * The full part list for a spec: generated body for rigged specs plus the
 * spec's own parts (bone tags resolved through the rig). Parts get world-space
 * at/size; `from/to` limbs are kept for orientation.
 */
export function lowpolyParts(spec, rig, opts = {}) {
  const neck = rig?.bones.find(b => b.name === 'neck')?.head;
  const own = (spec.parts || []).map(p => {
    const q = { ...p, bone: p.bone ? (PART_ALIASES[p.bone] || p.bone) : p.bone, mat: p.mat || (p.glow ? 'glow' : undefined) };
    // Capes and back items hang from the shoulders: keep torso-tagged hanging parts below the neck.
    if (neck && q.at && q.size && ['spine', 'chest', 'back'].includes(q.bone) && q.secondary) {
      const top = q.at[1] + q.size[1] / 2, limit = neck[1] + 0.02 * rig.height;
      if (top > limit) q.at = [q.at[0], q.at[1] - (top - limit), q.at[2]];
    }
    return q;
  });
  if (!rig) return own;
  if (rig.kind === 'humanoid') return [...humanoidBody(rig, spec), ...own];
  if (rig.kind === 'quadruped') return [...quadrupedBody(rig, spec, opts), ...own];
  return own;
}

export default {
  id: 'graphics.model.lowpoly',
  card: {
    intent: 'Low-poly models composed of boxes, cylinders, spheres, cones and capsules with matte/metal/glow materials and bone tags. Rigged specs (rig humanoid | quadruped | custom) get a full generated body (hair styles, clothing, snouts, manes, antlers, saddles) with their own parts layered on; archetypes with no model get one generated from kind, id and tags.',
    views: ['1p', '3p', 'iso', 'td'],
    params: {
      segments: { type: 'integer', default: 12, min: 6, max: 32, effect: 'radial segments for round shapes (lower = chunkier, faster)' },
      flatShade: { type: 'boolean', default: true, effect: 'faceted flat shading (the low-poly look) instead of smooth normals' },
      outline: { type: 'number', default: 0, min: 0, max: 0.1, unit: 'm', effect: 'inverted-hull outline thickness around characters (0 = none)' },
    },
    provides: {},
    reads: ['content.models'],
  },
  validate(config, doc) {
    const errs = [];
    for (const [id, m] of Object.entries(doc.content?.models || {})) {
      if (m.kind !== 'lowpoly') continue;
      (m.parts || []).forEach((p, i) => {
        if (!['box', 'cyl', 'sphere', 'cone', 'cap'].includes(p.shape)) errs.push({ code: 'model_shape', path: `content.models.${id}.parts[${i}].shape`, message: `unknown shape '${p.shape}'`, hint: 'box | cyl | sphere | cone | cap' });
        if (!p.from && (!Array.isArray(p.at) || !Array.isArray(p.size))) errs.push({ code: 'model_part', path: `content.models.${id}.parts[${i}]`, message: 'a part needs at:[x,y,z] and size:[w,h,d] (or from/to)' });
      });
    }
    return errs;
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    stage.models.configure('lowpoly', config);
  },
};
