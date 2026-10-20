// graphics.anim.secondary: spring bones for capes, hair, manes, tails and
// straps. Chains come from the params (bone names) plus every chain the model
// builder generated for secondary parts and tail_/mane_ bones, so they lag,
// swing and settle with the character's motion and gravity.
import { joinStage, presentationOnly } from './three-stage.js';
import { springStep } from './three-ik.js';
import { worldPos, aimBone } from './three-rig.js';

export default {
  id: 'graphics.anim.secondary',
  card: {
    intent: 'Spring-bone secondary motion for capes, hair, manes, tails and straps: chains lag behind, swing with turns and settle under gravity; chains are named in params or found automatically on the model.',
    views: ['1p', '3p', 'iso'],
    params: {
      chains: { type: 'list', default: [], effect: 'spring chains by bone names (missing bones are skipped)', of: { type: 'object', fields: {
        bones: { type: 'list', of: { type: 'string' }, min: 1, required: true },
        stiffness: { type: 'number', default: 0.4, min: 0, max: 1 }, damping: { type: 'number', default: 0.6, min: 0, max: 1 },
        gravity: { type: 'number', default: 1, min: 0, max: 4, effect: 'gravity multiplier' },
      } } },
      auto: { type: 'boolean', default: true, effect: 'also spring generated chains (capes, long hair, tails, manes)' },
      maxActors: { type: 'integer', default: 24, min: 1, max: 256, effect: 'nearest actors simulated; others keep the animated pose' },
    },
    provides: {},
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    const THREE = stage.THREE;
    stage.anim.post ??= [];
    let frame = 0, ranked = new Set();
    stage.hook('anim', () => {
      if (++frame % 20) return;
      const c = stage.viewCenter();
      ranked = new Set([...(stage.actors?.values() || [])].filter(a => a.bones).sort((a, b) => a.root.position.distanceToSquared(c) - b.root.position.distanceToSquared(c)).slice(0, config.maxActors).map(a => a.id));
    }, 'graphics.anim.secondary');
    const chainsFor = actor => {
      if (actor.anim.springChains) return actor.anim.springChains;
      const B = actor.bones, out = [];
      const add = (bones, opts) => { const list = bones.filter(b => B.has(b)); if (list.length) out.push({ bones: list, ...opts, state: {} }); };
      for (const c of config.chains) add(c.bones, c);
      if (config.auto) {
        const taken = new Set(out.flatMap(c => c.bones));
        const groups = new Map();
        for (const name of B.keys()) { const m = /^(.*)_(\d+)$/.exec(name); if (!m || taken.has(name) || !/tail|mane|cape|hair|braid|banner|strap|chain|scarf|ear|tassel|robe|skirt/.test(m[1])) continue; if (!groups.has(m[1])) groups.set(m[1], []); groups.get(m[1]).push(name); }
        for (const [, names] of groups) add(names.sort((a, b) => +a.split('_').pop() - +b.split('_').pop()), { stiffness: 0.35, damping: 0.6, gravity: 1 });
      }
      return actor.anim.springChains = out;
    };
    stage.anim.post.push((actor, entity, pose, dt) => {
      if (!actor.bones || !ranked.has(actor.id) || actor.anim.ragdoll) return;
      const chains = chainsFor(actor); if (!chains.length) return;
      actor.root.updateMatrixWorld(true);
      for (const c of chains) {
        // Joints: parent of the first chain bone, every chain bone, then the end (child) of the last.
        const first = actor.bones.get(c.bones[0]);
        const last = actor.bones.get(c.bones[c.bones.length - 1]);
        const end = last.children.find(ch => ch.isBone);
        const nodes = [first.parent, ...c.bones.map(n => actor.bones.get(n)), ...(end ? [end] : [])].filter(Boolean);
        const rest = nodes.map(n => worldPos(THREE, n));
        if (!end) { const l = rest.length; const d = rest[l - 1].map((v, i) => v - rest[l - 2][i]); rest.push(rest[l - 1].map((v, i) => v + d[i] * 0.8)); }
        springStep(c.state, rest, Math.min(dt, 1 / 30), { stiffness: c.stiffness, damping: c.damping, gravity: [0, -9.8 * (c.gravity ?? 1), 0] });
        // Rotate each chain bone so its segment points at the simulated next joint.
        for (let i = 1; i < nodes.length; i++) {
          const bone = nodes[i]; if (!c.bones.includes(bone.name)) continue;
          const childNow = i + 1 < nodes.length ? worldPos(THREE, nodes[i + 1]) : null;
          if (!childNow) continue;
          aimBone(THREE, bone, childNow, c.state.pos[i + 1]);
        }
      }
    });
  },
};
