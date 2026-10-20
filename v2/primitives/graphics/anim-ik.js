// graphics.anim.ik: post-animation IK passes on rigged actors.
// - Feet: two-bone legs plant on the ground under each foot (surface
//   groundAt / terrain), the pelvis drops so the lower foot still reaches,
//   feet keep their animated lift during the swing phase.
// - Look-at: head/neck/chest turn toward the nearest target of the listed
//   kinds (npc, player, enemy, lockon, interactable) within joint limits.
// - Hands: the right hand reaches (FABRIK over shoulder-elbow-wrist) for the
//   interactable being used during interact/use clips.
// - Aim: the chest pitches with body.look while aiming or shooting.
import { joinStage, presentationOnly } from './three-stage.js';
import { solveTwoBone, solveFabrik, lookAtAngles, plantFeet } from './three-ik.js';
import { worldPos, aimBone, offsetBoneWorld } from './three-rig.js';

const deg = d => d * Math.PI / 180;

export default {
  id: 'graphics.anim.ik',
  card: {
    intent: 'Inverse kinematics after animation: two-bone foot placement on uneven ground with pelvis adjust, head/neck look-at toward nearby targets within joint limits, FABRIK hand reach toward the thing being used, and chest aim pitch from the look direction.',
    views: ['1p', '3p', 'iso'],
    params: {
      foot: { type: 'boolean', default: true, effect: 'plant feet on the ground (needs a surface)' },
      hand: { type: 'boolean', default: true, effect: 'reach for interactables while using them' },
      lookAt: { type: 'object', default: {}, effect: 'head look-at', fields: {
        maxYaw: { type: 'number', default: 70, min: 0, max: 120, unit: 'deg' }, maxPitch: { type: 'number', default: 35, min: 0, max: 80, unit: 'deg' },
        targets: { type: 'list', of: { type: 'string' }, default: ['npc', 'player', 'lockon', 'interactable'], effect: 'what to look at: npc, player, enemy, lockon, interactable, or archetype kinds/ids' },
        range: { type: 'number', default: 8, min: 1, max: 40, unit: 'm' },
      } },
      pelvisAdjust: { type: 'boolean', default: true, effect: 'lower the hips so the lower foot reaches the ground' },
      iterations: { type: 'integer', default: 8, min: 1, max: 16, effect: 'FABRIK iterations for hand reach' },
      maxStep: { type: 'number', default: 0.45, min: 0.05, max: 2, unit: 'm', effect: 'largest height difference a foot adapts to' },
    },
    provides: {},
    requires: { capabilities: ['surface'] },
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    const THREE = stage.THREE;
    const look = { maxYaw: 70, maxPitch: 35, targets: ['npc', 'player', 'lockon', 'interactable'], range: 8, ...config.lookAt };
    stage.anim.ik = config;
    const kindOf = e => rt.archetype(e.archetype)?.kind || '';
    const lookTarget = (actor, entity) => {
      const me = actor.root.position;
      let best = null, bd = look.range * look.range;
      const lock = entity?.components?.target?.id ?? entity?.components?.lockOn;
      if (lock && look.targets.includes('lockon')) { const p = stage.pose(lock); if (p) return [p.at[0], p.at[1] + 1.5, p.at[2]]; }
      for (const o of Object.values(rt.state.entities)) {
        if (o.space !== actor.space || o.id === actor.id) continue;
        const k = kindOf(o);
        const ok = look.targets.some(t => t === k || t === o.archetype || (t === 'player' && o.id === 'player') || (t === 'interactable' && o.components?.interact) || (t === 'npc' && (k === 'npc' || o.components?.dialogue)));
        if (!ok) continue;
        const p = stage.pose(o.id); if (!p) continue;
        const d = (p.at[0] - me.x) ** 2 + (p.at[2] - me.z) ** 2;
        if (d < bd) { bd = d; best = [p.at[0], p.at[1] + (stage.actors?.get(o.id)?.height ?? 1.7) * 0.9, p.at[2]]; }
      }
      return best;
    };
    stage.anim.post ??= [];
    stage.anim.post.push((actor, entity, pose) => {
      if (!actor.bones || actor.anim.ragdoll || !actor.root.visible) return;
      const B = actor.bones, kind = actor.rig.kind, a = actor.anim;
      actor.root.updateMatrixWorld(true);
      // Feet.
      if (config.foot && pose.grounded !== false && !a.dead && !/swim|climb|glide|ride|drive/.test(a.loco?.state || '')) {
        const legs = kind === 'humanoid' ? [['upperLegL', 'lowerLegL', 'footL'], ['upperLegR', 'lowerLegR', 'footR']]
          : kind === 'quadruped' ? [['upperLegFL', 'lowerLegFL', 'hoofFL'], ['upperLegFR', 'lowerLegFR', 'hoofFR'], ['upperLegBL', 'lowerLegBL', 'hoofBL'], ['upperLegBR', 'lowerLegBR', 'hoofBR']] : [];
        if (legs.length && legs.every(l => l.every(n => B.has(n)))) {
          const rootY = actor.root.position.y, scale = actor.body.scale.y;
          const feet = legs.map(([, , f]) => ({ ankle: worldPos(THREE, B.get(f)), height: (actor.rig.footHeight ?? 0.06) * scale }));
          const planted = plantFeet(feet, (x, z) => stage.groundAt(actor.space, x, z), rootY, { maxStep: config.maxStep });
          const w = Math.max(0, 1 - (pose.speed || 0) / 7); // fade out at sprint speeds
          if (config.pelvisAdjust && planted.pelvis < 0) offsetBoneWorld(THREE, B.get('hips'), [0, planted.pelvis * w, 0]);
          legs.forEach(([u, l, f], i) => {
            const hip = worldPos(THREE, B.get(u)), knee = worldPos(THREE, B.get(l)), ankle = worldPos(THREE, B.get(f));
            const target = [ankle[0], ankle[1] + (planted.feet[i].target[1] - feet[i].ankle[1]) * w, ankle[2]];
            if (Math.abs(target[1] - ankle[1]) < 0.004) return;
            const fwd = [Math.sin(a.yaw || 0), 0, Math.cos(a.yaw || 0)];
            const pole = [knee[0] + fwd[0] * (kind === 'quadruped' && u.includes('F') ? -1 : 1), knee[1], knee[2] + fwd[2] * (kind === 'quadruped' && u.includes('F') ? -1 : 1)];
            const s = solveTwoBone(hip, knee, ankle, target, pole);
            aimBone(THREE, B.get(u), knee, s.mid);
            aimBone(THREE, B.get(l), worldPos(THREE, B.get(f)), s.end);
          });
        }
      }
      // Look-at.
      if (look.maxYaw > 0 && B.has('head') && !a.dead) {
        const target = lookTarget(actor, entity);
        a.lookW = (a.lookW ?? 0) + ((target ? 1 : 0) - (a.lookW ?? 0)) * 0.1;
        if (target) a.lookAt = target;
        if (a.lookW > 0.01 && a.lookAt) {
          const head = B.get('head'), origin = worldPos(THREE, head);
          const yaw = a.yaw || 0, fwd = [Math.sin(yaw), 0, Math.cos(yaw)];
          const ang = lookAtAngles(origin, fwd, [0, 1, 0], a.lookAt, deg(look.maxYaw), deg(look.maxPitch));
          a.lookYaw = (a.lookYaw ?? 0) + (ang.yaw * ang.weight * a.lookW - (a.lookYaw ?? 0)) * 0.15;
          a.lookPitch = (a.lookPitch ?? 0) + (ang.pitch * ang.weight * a.lookW - (a.lookPitch ?? 0)) * 0.15;
          // Spread over chest, neck and head.
          for (const [name, share] of [['chest', 0.2], ['neck', 0.3], ['head', 0.5]]) {
            const b = B.get(name); if (!b) continue;
            b.rotation.y += a.lookYaw * share; b.rotation.x -= a.lookPitch * share * (kind === 'quadruped' ? -1 : 1);
          }
          B.get('chest')?.updateMatrixWorld(true);
        }
      }
      // Aim: chest pitch follows look while aiming/shooting.
      const lookP = entity?.components?.body?.look?.[1];
      if (kind === 'humanoid' && Number.isFinite(lookP) && a.layers.some(l => /aim|shoot|bow|cast/.test(l.clip.id))) {
        const chest = B.get('chest'); chest.rotation.x -= lookP * 0.7; chest.updateMatrixWorld(true);
      }
      // Hand reach toward the thing being used.
      if (config.hand && kind === 'humanoid' && a.layers.some(l => /interact|place|cook|drink/.test(l.clip.id) && l.w > 0.3)) {
        const me = actor.root.position;
        let tgt = null, bd = 2.2 * 2.2;
        for (const o of Object.values(rt.state.entities)) {
          if (o.space !== actor.space || o.id === actor.id || !o.components?.interact) continue;
          const p = stage.pose(o.id); const d = (p.at[0] - me.x) ** 2 + (p.at[2] - me.z) ** 2;
          if (d < bd) { bd = d; tgt = [p.at[0], p.at[1] + Math.min(1.2, (stage.actors?.get(o.id)?.height ?? 1) * 0.7), p.at[2]]; }
        }
        if (tgt) {
          const names = ['upperArmR', 'lowerArmR', 'handR'];
          const joints = names.map(n => worldPos(THREE, B.get(n)));
          const res = solveFabrik(joints, tgt, { iterations: config.iterations });
          const w = Math.max(...a.layers.filter(l => /interact|place|cook|drink/.test(l.clip.id)).map(l => l.w));
          aimBone(THREE, B.get(names[0]), joints[1], res.joints[1], w);
          aimBone(THREE, B.get(names[1]), worldPos(THREE, B.get(names[2])), res.joints[2], w);
        }
      }
    });
  },
};
