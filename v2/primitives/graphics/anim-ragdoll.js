// graphics.anim.ragdoll: simplified verlet ragdoll for deaths and big
// knockbacks. On a defeat it takes over from the animated pose (so the blend
// is continuous), inherits the body's velocity plus the hit direction,
// collides with the ground, settles, and fades after fadeSec. Presentation
// only: the simulation never sees it.
import { joinStage, presentationOnly } from './three-stage.js';
import { ragdollStep } from './three-ik.js';
import { worldPos, aimBone, offsetBoneWorld } from './three-rig.js';

const HUMANOID_JOINTS = ['hips', 'chest', 'head', 'upperArmL', 'lowerArmL', 'handL', 'upperArmR', 'lowerArmR', 'handR', 'upperLegL', 'lowerLegL', 'footL', 'upperLegR', 'lowerLegR', 'footR'];
const QUADRUPED_JOINTS = ['hips', 'chest', 'neck_2', 'head', 'upperLegFL', 'lowerLegFL', 'hoofFL', 'upperLegFR', 'lowerLegFR', 'hoofFR', 'upperLegBL', 'lowerLegBL', 'hoofBL', 'upperLegBR', 'lowerLegBR', 'hoofBR'];
// Extra links keep the torso from folding.
const BRACES = { humanoid: [['hips', 'head'], ['upperArmL', 'upperArmR'], ['upperArmL', 'hips'], ['upperArmR', 'hips'], ['upperLegL', 'upperLegR'], ['upperLegL', 'chest'], ['upperLegR', 'chest']], quadruped: [['hips', 'neck_2'], ['upperLegFL', 'upperLegFR'], ['upperLegBL', 'upperLegBR'], ['upperLegFL', 'hips'], ['upperLegBR', 'chest']] };

/** Build a ragdoll body from joint positions (pure; tested). parents: name -> parent joint name. */
export function ragdollBody(joints, names, parents, braces, velocity = [0, 0, 0], dt = 1 / 60) {
  const pos = names.map(n => joints[n].slice());
  const prev = pos.map(p => [p[0] - velocity[0] * dt, p[1] - velocity[1] * dt, p[2] - velocity[2] * dt]);
  const idx = new Map(names.map((n, i) => [n, i])), links = [];
  const link = (a, b) => { if (!idx.has(a) || !idx.has(b)) return; const i = idx.get(a), j = idx.get(b); links.push([i, j, Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1], pos[i][2] - pos[j][2])]); };
  for (const n of names) if (parents[n]) link(parents[n], n);
  for (const [a, b] of braces) link(a, b);
  return { pos, prev, links, names, idx, radius: 0.07 };
}

export default {
  id: 'graphics.anim.ragdoll',
  card: {
    intent: 'Simplified verlet ragdoll for deaths (and knockback when set): takes over from the animated pose, inherits velocity and hit direction, collides with the ground, settles, then fades; presentation only.',
    views: ['1p', '3p', 'iso'],
    params: {
      onDeath: { type: 'boolean', default: true, effect: 'ragdoll when an entity is defeated' },
      maxActive: { type: 'integer', default: 8, min: 1, max: 64, effect: 'simultaneous ragdolls (oldest settle first)' },
      fadeSec: { type: 'number', default: 6, min: 0.5, max: 120, unit: 's', effect: 'time a body stays before fading out' },
      impulse: { type: 'number', default: 3, min: 0, max: 20, unit: 'm/s', effect: 'push away from the hit direction' },
    },
    provides: {},
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    const THREE = stage.THREE;
    stage.anim.ragdoll = config;
    const active = [];
    const hitFrom = new Map();
    rt.on('hit', ev => { const t = ev.target, a = ev.attacker ?? ev.who; if (t && a) hitFrom.set(t, a); });
    stage.anim.post ??= [];
    stage.anim.post.push((actor, entity, pose, dt) => {
      const a = actor.anim, kind = actor.rig?.kind;
      if (!config.onDeath || !actor.bones || (kind !== 'humanoid' && kind !== 'quadruped')) return;
      if (a.dead && !a.ragdoll) {
        if (active.length >= config.maxActive) { const old = active.shift(); old.anim.ragdoll.frozen = true; }
        actor.root.updateMatrixWorld(true);
        const names = (kind === 'humanoid' ? HUMANOID_JOINTS : QUADRUPED_JOINTS).filter(n => actor.bones.has(n));
        const joints = Object.fromEntries(names.map(n => [n, worldPos(THREE, actor.bones.get(n))]));
        const parents = {};
        for (const n of names) { let p = actor.bones.get(n).parent; while (p && !names.includes(p.name)) p = p.parent; if (p?.isBone) parents[n] = p.name; }
        const v = (pose.vel || [0, 0, 0]).slice();
        const from = hitFrom.get(actor.id), fp = from && stage.pose(from);
        if (fp) { const dx = actor.root.position.x - fp.at[0], dz = actor.root.position.z - fp.at[2], l = Math.hypot(dx, dz) || 1; v[0] += dx / l * config.impulse; v[2] += dz / l * config.impulse; v[1] += config.impulse * 0.4; }
        a.ragdoll = { body: ragdollBody(joints, names, parents, BRACES[kind], v), t: 0, kind };
        a.layers = []; active.push(actor);
      }
      const rd = a.ragdoll; if (!rd) return;
      if (!a.dead) { a.ragdoll = null; const i = active.indexOf(actor); if (i >= 0) active.splice(i, 1); return; }
      rd.t += dt;
      if (!rd.frozen && !rd.body.asleep) ragdollStep(rd.body, Math.min(dt, 1 / 30), (x, z) => stage.groundAt(actor.space, x, z));
      // Drive bones: hips to its particle, then each bone toward its child's particle.
      actor.root.updateMatrixWorld(true);
      const B = actor.bones, P = rd.body.pos, I = rd.body.idx;
      const hp = worldPos(THREE, B.get('hips'));
      offsetBoneWorld(THREE, B.get('hips'), P[I.get('hips')].map((v, k) => v - hp[k]));
      for (const n of rd.body.names) {
        const bone = B.get(n);
        const child = rd.body.names.find(c => B.get(c).parent === bone || B.get(c).parent?.parent === bone);
        if (!child) continue;
        aimBone(THREE, bone, worldPos(THREE, B.get(child)), P[I.get(child)]);
      }
      if (rd.t > config.fadeSec) { const s = Math.max(0.001, 1 - (rd.t - config.fadeSec) / 0.8); actor.body.scale.setScalar((actor.template.scale || 1) * s); }
    });
  },
};
