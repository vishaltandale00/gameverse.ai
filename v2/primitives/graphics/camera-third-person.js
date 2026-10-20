// graphics.camera.third-person: orbit/chase camera with collision avoidance,
// lock-on framing, over-the-shoulder offset, auto-recentre behind the player
// while moving, wider framing when riding or driving, and smoothing.
import { joinStage, presentationOnly, lerpAngle } from './three-stage.js';
import { registerCamera, viewAngles, orient, clearDistance, forwardOf } from './three-camera.js';

/** Pure framing math (tested): camera position and look target for a pivot, angles and lock-on target. */
export function thirdPersonFrame({ pivot, yaw, pitch, distance, shoulder = 0, target = null, lockOnBlend = 0.6 }) {
  let y = yaw, p = pitch;
  let look = pivot.slice();
  if (target) {
    // Face the target from behind the player: yaw toward it, frame both.
    const dx = target[0] - pivot[0], dz = target[2] - pivot[2], dy = target[1] - pivot[1];
    const ty = Math.atan2(dx, dz), flat = Math.hypot(dx, dz);
    y = lerpAngle(yaw, ty, lockOnBlend);
    p = p * (1 - lockOnBlend) + Math.max(-0.5, Math.min(0.3, -Math.atan2(dy, flat) * 0.6 - 0.15)) * lockOnBlend;
    look = [pivot[0] + dx * 0.4 * lockOnBlend, pivot[1] + dy * 0.3 * lockOnBlend, pivot[2] + dz * 0.4 * lockOnBlend];
  }
  const f = forwardOf(y, p);
  const right = [-Math.cos(y), 0, Math.sin(y)];
  const origin = [look[0] + right[0] * shoulder, look[1], look[2] + right[2] * shoulder];
  const pos = [origin[0] - f[0] * distance, origin[1] - f[1] * distance, origin[2] - f[2] * distance];
  return { pos, look: origin, yaw: y, pitch: p, dir: [-f[0], -f[1], -f[2]] };
}

export default {
  id: 'graphics.camera.third-person',
  card: {
    intent: 'Third-person orbit/chase camera: collision avoidance against the world, lock-on framing of a target, over-the-shoulder offset, auto-recentring behind the player while moving, wider framing when riding or driving, smoothing.',
    views: ['3p'],
    params: {
      distance: { type: 'number', default: 4.5, min: 1, max: 12, unit: 'm', effect: 'orbit distance' },
      height: { type: 'number', default: 1.6, min: 0, max: 5, unit: 'm', effect: 'pivot height above the feet' },
      fov: { type: 'number', default: 65, min: 30, max: 110, unit: 'deg', effect: 'field of view' },
      lockOnBlend: { type: 'number', default: 0.6, min: 0, max: 1, effect: 'how strongly a locked target pulls the framing' },
      shoulder: { type: 'string', options: ['left', 'right', 'center'], default: 'center', effect: 'over-the-shoulder offset side' },
      collide: { type: 'boolean', default: true, effect: 'pull in when walls or terrain block the view' },
      recenter: { type: 'number', default: 1.5, min: 0, max: 10, unit: 's', effect: 'seconds without look input before the camera swings behind a moving player (0 = never)' },
      pitch: { type: 'number', default: -0.25, min: -1.4, max: 1.4, unit: 'rad', effect: 'initial pitch (negative looks down)' },
    },
    provides: {},
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    const THREE = stage.THREE;
    stage.raycaster ??= new THREE.Raycaster();
    if (!stage.look.set) stage.look.pitch = config.pitch;
    let dist = config.distance, lastLook = stage.look.yaw, idle = 0, pos = null;
    const cam = {
      id: instance.key, view: '3p',
      update(ctx) {
        const player = ctx.player; if (!player) return;
        stage.baseFov = config.fov;
        const pose = stage.pose(player.id); if (!pose) return;
        let { yaw, pitch, sim } = viewAngles(stage, player);
        // Chase: without look input, ease behind the moving player.
        if (!sim) {
          if (stage.look.yaw !== lastLook) { idle = 0; lastLook = stage.look.yaw; } else idle += ctx.dt;
          if (config.recenter > 0 && idle > config.recenter && pose.speed > 0.5) { stage.look.yaw = lerpAngle(stage.look.yaw, pose.yaw, 1 - Math.exp(-ctx.dt * 1.8)); lastLook = stage.look.yaw; yaw = stage.look.yaw; }
        }
        pitch = Math.max(-1.3, Math.min(0.9, pitch));
        const st = player.components?.body?.state;
        const wide = /ride|drive|ship|fly|glide/.test(st || '') || player.components?.body?.riding ? 1.6 : 1;
        const shoulder = config.shoulder === 'right' ? 0.55 : config.shoulder === 'left' ? -0.55 : 0;
        const pivot = [pose.at[0], pose.at[1] + config.height * (wide > 1 ? 1.2 : 1), pose.at[2]];
        const tid = player.components?.target?.locked ? player.components.target.id : player.components?.lockOn;
        const tgt = tid ? stage.pose(tid) : null;
        const want = config.distance * wide;
        const frame = thirdPersonFrame({ pivot, yaw, pitch, distance: want, shoulder: shoulder * (wide > 1 ? 0.3 : 1), target: tgt ? [tgt.at[0], tgt.at[1] + 1.2, tgt.at[2]] : null, lockOnBlend: config.lockOnBlend });
        let allowed = want;
        if (config.collide) allowed = Math.max(0.6, clearDistance(stage, ctx.space, frame.look, frame.dir, want) - 0.25);
        dist = allowed < dist ? allowed : dist + (allowed - dist) * (1 - Math.exp(-ctx.dt * 3));
        const p = [frame.look[0] + frame.dir[0] * dist, frame.look[1] + frame.dir[1] * dist, frame.look[2] + frame.dir[2] * dist];
        if (!pos) pos = p; else for (let i = 0; i < 3; i++) pos[i] += (p[i] - pos[i]) * (1 - Math.exp(-ctx.dt * 18));
        stage.camera.position.set(pos[0], pos[1], pos[2]);
        const look = new THREE.Vector3(...frame.look);
        stage.camera.up.set(0, 1, 0); stage.camera.lookAt(look);
        orient(stage.camera, Math.atan2(look.x - pos[0], look.z - pos[2]), Math.atan2(look.y - pos[1], Math.hypot(look.x - pos[0], look.z - pos[2])));
        stage.viewYaw = frame.yaw; stage.viewPitch = frame.pitch;
        stage.focus.set(pose.at[0], pose.at[1], pose.at[2]);
        stage.eyeHeight = config.height;
      },
    };
    registerCamera(stage, cam);
  },
};
