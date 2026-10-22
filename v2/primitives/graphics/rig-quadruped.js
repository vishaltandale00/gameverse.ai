// graphics.rig.quadruped: four-legged skeleton (hips, spine, chest, neck chain,
// head, jaw, ears, 4 legs x 3 bones, tail chain, mane chain, saddle socket) for
// horses, dogs, deer, wolves and boars, sized from body length and leg length.
import { joinStage, presentationOnly } from './three-stage.js';
import { modelsData } from './model-lib.js';

export const QUADRUPED_LEGS = ['FL', 'FR', 'BL', 'BR'];

/** Leg length as a fraction of withers height from reference metres (torso depth ~28% of its length). */
export const legFraction = (legLength, bodyLength) => Math.min(0.8, Math.max(0.3, legLength / (legLength + 0.28 * bodyLength)));

/**
 * length: nose-to-rump body length (m); height: withers height (m).
 * legLength: fraction of withers height (see legFraction); bodyLength: torso fraction of length.
 * Facing +z, left at +x.
 */
export function quadrupedRig({ length = 1.6, height = 1.2, legLength, bodyLength, neck = 0.35, tail = 3, mane = 3, scale = 1 } = {}) {
  const L = length * scale, H = height * scale;
  const leg = (legLength ?? 0.58) * H, body = (bodyLength ?? 0.62) * L;
  const backY = leg + H * 0.02, hipZ = -body / 2, chestZ = body / 2, halfW = Math.max(0.08, L * 0.09);
  const bones = [
    ['hips', null, [0, backY, hipZ]], ['spine', 'hips', [0, backY + H * 0.02, 0]], ['chest', 'spine', [0, backY, chestZ]],
  ];
  const neckLen = neck * L;
  bones.push(['neck', 'chest', [0, backY + H * 0.05, chestZ + L * 0.04]]);
  bones.push(['neck_2', 'neck', [0, backY + neckLen * 0.55, chestZ + neckLen * 0.35]]);
  bones.push(['head', 'neck_2', [0, backY + neckLen * 0.95, chestZ + neckLen * 0.62]]);
  bones.push(['jaw', 'head', [0, backY + neckLen * 0.85, chestZ + neckLen * 0.75]]);
  bones.push(['earL', 'head', [halfW * 0.5, backY + neckLen * 1.12, chestZ + neckLen * 0.58]]);
  bones.push(['earR', 'head', [-halfW * 0.5, backY + neckLen * 1.12, chestZ + neckLen * 0.58]]);
  for (const leg4 of QUADRUPED_LEGS) {
    const front = leg4[0] === 'F', x = leg4[1] === 'L' ? halfW : -halfW, z = front ? chestZ - L * 0.03 : hipZ + L * 0.04;
    const parent = front ? 'chest' : 'hips';
    bones.push([`upperLeg${leg4}`, parent, [x, leg, z]]);
    bones.push([`lowerLeg${leg4}`, `upperLeg${leg4}`, [x, leg * 0.5, z + (front ? -0.02 : 0.05) * H]]);
    bones.push([`hoof${leg4}`, `lowerLeg${leg4}`, [x, leg * 0.06, z]]);
  }
  let prev = 'hips';
  for (let i = 1; i <= tail; i++) { bones.push([`tail_${i}`, prev, [0, backY + H * 0.05 - i * H * 0.07, hipZ - L * 0.05 - i * L * 0.07]]); prev = `tail_${i}`; }
  prev = 'neck';
  for (let i = 1; i <= mane; i++) { const t = i / (mane + 1); bones.push([`mane_${i}`, prev, [0, backY + neckLen * (0.2 + 0.8 * t) + H * 0.05, chestZ + neckLen * 0.55 * t]]); prev = `mane_${i}`; }
  bones.push(['saddle', 'spine', [0, backY + H * 0.08, 0]]);
  return {
    kind: 'quadruped', height: H, length: L, legLength: leg, bodyLength: body, halfWidth: halfW, neckLength: neckLen,
    bones: bones.map(([name, parent, h]) => ({ name, parent, head: h.map(v => +v.toFixed(5)) })),
  };
}

export default {
  id: 'graphics.rig.quadruped',
  card: {
    intent: 'Four-legged skeleton (spine, neck chain, head and jaw, 4 legs x 3 bones, tail and mane chains, saddle socket) for horses, dogs, deer, wolves, boars; used by lowpoly and voxel quadruped models and graphics.anim.*.',
    views: ['1p', '3p', 'iso'],
    params: {
      legLength: { type: 'number', default: 0.8, min: 0.05, max: 8, unit: 'm', effect: 'reference leg length; models without a height use it directly, models with one keep its ratio to bodyLength (long-legged deer vs short boar)' },
      bodyLength: { type: 'number', default: 1.4, min: 0.1, max: 20, unit: 'm', effect: 'reference torso length; default model length when a model gives none' },
      saddle: { type: 'boolean', default: false, effect: 'draw a saddle and tack on mounts (archetypes with components.mount or kind mount)' },
    },
    provides: {},
    reads: ['content.models'],
    data: { 'content.models': modelsData(['kind', 'rig', 'height', 'length', 'species', 'saddle']) },
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    stage.rigs.quadruped = { ...config };
  },
};
