// graphics.rig.humanoid: a procedural 21-bone humanoid skeleton (plus attach
// sockets) sized from height and proportions, fitted to a model's tagged parts
// (voxel part boxes or lowpoly bone tags) and skinned to its generated mesh.
import { joinStage, presentationOnly } from './three-stage.js';

export const HUMANOID_BONES = ['hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'lowerArmL', 'handL', 'shoulderR', 'upperArmR', 'lowerArmR', 'handR',
  'upperLegL', 'lowerLegL', 'footL', 'toesL', 'upperLegR', 'lowerLegR', 'footR', 'toesR'];
export const SOCKETS = ['back', 'hip', 'headTop'];
// Names a model's parts commonly use, mapped onto bones (voxel parts: head, torso, armL...).
export const PART_ALIASES = {
  torso: 'chest', body: 'chest', pelvis: 'hips', waist: 'hips', belly: 'spine', abdomen: 'spine',
  armL: 'upperArmL', armR: 'upperArmR', legL: 'upperLegL', legR: 'upperLegR', forearmL: 'lowerArmL', forearmR: 'lowerArmR',
  shinL: 'lowerLegL', shinR: 'lowerLegR', bootL: 'footL', bootR: 'footR', hair: 'head', hat: 'head', cap: 'head', helmet: 'head', hood: 'head', face: 'head',
  backpack: 'back', cape: 'chest', cloak: 'chest', quiver: 'back', sheath: 'back', belt: 'hips',
};

const DEFAULT_PROPORTIONS = { legs: 0.47, arms: 0.38, torso: 0.33, head: 0.13 };

/**
 * Build the humanoid bone list for a body of `height` metres.
 * proportions: fractions of height { legs, arms, torso, head } (normalised so legs+torso+head = 1 when they exceed it).
 * build: { width, shoulders, head } multipliers.
 */
export function humanoidRig({ height = 1.8, proportions = {}, build = {}, scale = 1 } = {}) {
  const P = { ...DEFAULT_PROPORTIONS, ...proportions };
  const H = height * scale;
  const sum = P.legs + P.torso + P.head;
  const k = sum > 1 ? 1 / sum : 1;
  const legs = P.legs * k * H, torso = P.torso * k * H;
  const width = build.width ?? 1, shoulders = build.shoulders ?? 1;
  const hipW = 0.055 * H * width, shW = 0.12 * H * shoulders * Math.max(0.8, width * 0.9);
  const footH = Math.max(0.035 * H, 0.03);
  const hipY = legs;
  const neckY = hipY + torso, chestY = hipY + torso * 0.55, spineY = hipY + torso * 0.18;
  const arm = P.arms * H, head = H - neckY; // neck base to crown
  const shY = neckY - 0.035 * H;
  const bones = [
    ['hips', null, [0, hipY, 0]], ['spine', 'hips', [0, spineY, 0]], ['chest', 'spine', [0, chestY, 0]],
    ['neck', 'chest', [0, neckY, 0]], ['head', 'neck', [0, neckY + head * 0.22, 0]],
  ];
  for (const [s, x] of [['L', 1], ['R', -1]]) {
    bones.push([`shoulder${s}`, 'chest', [x * shW * 0.35, shY, 0]]);
    bones.push([`upperArm${s}`, `shoulder${s}`, [x * shW, shY, 0]]);
    bones.push([`lowerArm${s}`, `upperArm${s}`, [x * shW, shY - arm * 0.47, 0]]);
    bones.push([`hand${s}`, `lowerArm${s}`, [x * shW, shY - arm * 0.9, 0]]);
  }
  for (const [s, x] of [['L', 1], ['R', -1]]) {
    bones.push([`upperLeg${s}`, 'hips', [x * hipW, hipY - 0.02 * H, 0]]);
    bones.push([`lowerLeg${s}`, `upperLeg${s}`, [x * hipW, (hipY - 0.02 * H) * 0.5 + footH * 0.5, 0.005 * H]]);
    bones.push([`foot${s}`, `lowerLeg${s}`, [x * hipW, footH, 0]]);
    bones.push([`toes${s}`, `foot${s}`, [x * hipW, footH * 0.35, 0.09 * H]]);
  }
  bones.push(['back', 'chest', [0, chestY + 0.02 * H, -0.09 * H * width]]);
  bones.push(['hip', 'hips', [0.12 * H * width, hipY - 0.03 * H, 0]]);
  bones.push(['headTop', 'head', [0, neckY + head, 0]]);
  return {
    kind: 'humanoid', height: H, headSize: head, armLength: arm, legLength: legs, footHeight: footH, hipWidth: hipW, shoulderWidth: shW,
    bones: bones.map(([name, parent, h]) => ({ name, parent, head: h.map(v => +v.toFixed(5)) })),
  };
}

/**
 * Fit the rig's joints to a model's part boxes (voxel models: boxes in model metres).
 * parts: [{ name, min:[x,y,z], max:[x,y,z] }] already in metres, facing +z, left at +x.
 * Joints move to the part pivots: arms hinge at the top of the arm box, legs at the top of the leg box, head at its base.
 */
export function fitHumanoidToParts(rig, parts) {
  const by = name => parts.find(p => p.name === name || PART_ALIASES[p.name] === name);
  const bones = new Map(rig.bones.map(b => [b.name, { ...b, head: b.head.slice() }]));
  const set = (name, h) => { if (bones.has(name)) bones.get(name).head = h.map(v => +v.toFixed(5)); };
  const c = p => [(p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2];
  const head = by('head'), torso = by('chest'), armL = by('upperArmL'), armR = by('upperArmR'), legL = by('upperLegL'), legR = by('upperLegR');
  if (torso) {
    const t = c(torso);
    set('hips', [t[0], torso.min[1], t[2]]); set('spine', [t[0], torso.min[1] + (torso.max[1] - torso.min[1]) * 0.25, t[2]]);
    set('chest', [t[0], torso.min[1] + (torso.max[1] - torso.min[1]) * 0.6, t[2]]); set('neck', [t[0], torso.max[1], t[2]]);
    set('back', [t[0], (torso.min[1] + torso.max[1]) / 2, torso.min[2]]);
    set('hip', [torso.max[0], torso.min[1], t[2]]);
  }
  if (head) { const h = c(head); set('head', [h[0], head.min[1], h[2]]); set('headTop', [h[0], head.max[1], h[2]]); }
  for (const [s, arm] of [['L', armL], ['R', armR]]) if (arm) {
    const a = c(arm), top = arm.max[1] - Math.min(0.06, (arm.max[0] - arm.min[0]) / 2), len = top - arm.min[1];
    set(`shoulder${s}`, [(a[0] + (torso ? c(torso)[0] : 0)) / 2, top, a[2]]);
    set(`upperArm${s}`, [a[0], top, a[2]]); set(`lowerArm${s}`, [a[0], top - len * 0.5, a[2]]); set(`hand${s}`, [a[0], arm.min[1] + len * 0.08, a[2]]);
  }
  for (const [s, leg] of [['L', legL], ['R', legR]]) if (leg) {
    const l = c(leg), top = leg.max[1], len = top - leg.min[1];
    set(`upperLeg${s}`, [l[0], top, l[2]]); set(`lowerLeg${s}`, [l[0], top - len * 0.5, l[2]]);
    set(`foot${s}`, [l[0], leg.min[1] + len * 0.08, l[2]]); set(`toes${s}`, [l[0], leg.min[1], leg.max[2]]);
  }
  const out = rig.bones.map(b => bones.get(b.name));
  return { ...rig, bones: out, fitted: true, height: Math.max(...parts.map(p => p.max[1])) };
}

export default {
  id: 'graphics.rig.humanoid',
  card: {
    intent: 'Procedural humanoid skeleton (21 bones + back/hip/headTop sockets) sized from height and proportions, fitted to a model\'s tagged parts and skinned to its generated mesh; attach weapons, packs and lanterns to bones. Required by graphics.anim.* on humanoids.',
    views: ['1p', '3p', 'iso'],
    params: {
      scale: { type: 'number', default: 1, min: 0.1, max: 10, effect: 'uniform skeleton scale on top of the model height' },
      proportions: { type: 'object', default: {}, effect: 'fractions of height: legs, arms, torso, head', fields: {
        legs: { type: 'number', min: 0.2, max: 0.7 }, arms: { type: 'number', min: 0.2, max: 0.7 }, torso: { type: 'number', min: 0.15, max: 0.6 }, head: { type: 'number', min: 0.08, max: 0.4 } } },
      attach: { type: 'list', default: [], effect: 'models or equipment slots shown on bones', of: { type: 'object', fields: {
        bone: { type: 'string', required: true, options: [...HUMANOID_BONES, ...SOCKETS], effect: 'bone or socket' },
        slot: { type: 'string', effect: 'equipment slot whose equipped item is drawn here (weapon, backpack, torch...)' },
        model: { type: 'string', effect: 'a fixed model to always show: a content.models id, an item id, or a plain name (sword, lantern, shield...) generated procedurally' },
      } } },
    },
    provides: {},
    reads: ['content.models'],
  },
  validate(config) {
    const errs = [];
    for (const [i, a] of (config.attach || []).entries()) if (!a.slot && !a.model) errs.push({ code: 'attach_empty', path: `attach[${i}]`, message: 'an attachment needs a slot or a model', hint: 'set slot (e.g. "weapon") or model' });
    return errs;
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    stage.rigs.humanoid = { ...config };
  },
};
