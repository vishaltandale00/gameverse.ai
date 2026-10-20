// graphics.camera.isometric: 3D isometric view (orthographic projection,
// fixed elevation, 90-degree rotation steps eased), following the player with
// smoothing and a slight look-ahead. Publishes its yaw so movement can be
// screen-relative.
import { joinStage, presentationOnly, lerpAngle } from './three-stage.js';
import { registerCamera } from './three-camera.js';

/** Pure: camera offset for elevation angle (deg), yaw (rad) and distance. */
export function isoOffset(angleDeg, yaw, distance) {
  const e = angleDeg * Math.PI / 180;
  return [-Math.sin(yaw) * Math.cos(e) * distance, Math.sin(e) * distance, -Math.cos(yaw) * Math.cos(e) * distance];
}

export default {
  id: 'graphics.camera.isometric',
  card: {
    intent: '3D isometric camera: orthographic projection at a fixed elevation, rotatable in eased 90-degree steps (rotate_camera action, or Q/E without an input primitive), following the player with smoothing and look-ahead.',
    views: ['iso'],
    params: {
      angle: { type: 'number', default: 35, min: 10, max: 89, unit: 'deg', effect: 'elevation above the horizon (35 ≈ classic isometric)' },
      zoom: { type: 'number', default: 1, min: 0.2, max: 6, effect: 'zoom (1 frames about 24 m)' },
      rotatable: { type: 'boolean', default: true, effect: 'allow 90-degree rotation steps' },
      yaw: { type: 'number', default: 45, min: 0, max: 360, unit: 'deg', effect: 'initial heading of the view' },
      perspective: { type: 'boolean', default: false, effect: 'narrow-FOV perspective instead of orthographic (keeps fog and depth cues)' },
    },
    provides: {},
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    const THREE = stage.THREE;
    const ortho = new THREE.OrthographicCamera(-12, 12, 12, -12, -500, 2000);
    let yaw = config.yaw * Math.PI / 180, focus = null, turn = 0;
    const persp = stage.camera;
    const cam = {
      id: instance.key, view: 'iso',
      update(ctx) {
        const player = ctx.player; if (!player) return;
        const pose = stage.pose(player.id); if (!pose) return;
        if (config.rotatable) {
          if (rt.input?.actions?.rotate_camera) stage.isoTurn = (stage.isoTurn || 0) + (rt.input.actions.rotate_camera < 0 ? -1 : 1);
          turn = stage.isoTurn || 0;
        }
        const targetYaw = config.yaw * Math.PI / 180 + turn * Math.PI / 2;
        yaw = lerpAngle(yaw, targetYaw, 1 - Math.exp(-ctx.dt * 8));
        const ahead = [pose.vel[0] * 0.25, 0, pose.vel[2] * 0.25];
        const want = [pose.at[0] + ahead[0], pose.at[1] + 1, pose.at[2] + ahead[2]];
        if (!focus) focus = want; else for (let i = 0; i < 3; i++) focus[i] += (want[i] - focus[i]) * (1 - Math.exp(-ctx.dt * 6));
        const span = 12 / config.zoom, aspect = persp.aspect || 1.5;
        const off = isoOffset(config.angle, yaw, 120);
        const c = config.perspective ? persp : ortho;
        if (config.perspective) { persp.fov = 18 / config.zoom * 1.6; persp.updateProjectionMatrix(); }
        else { ortho.left = -span * aspect; ortho.right = span * aspect; ortho.top = span; ortho.bottom = -span; ortho.updateProjectionMatrix(); stage.camera = ortho; }
        c.position.set(focus[0] + off[0], focus[1] + off[1], focus[2] + off[2]);
        c.up.set(0, 1, 0); c.lookAt(focus[0], focus[1], focus[2]);
        stage.viewYaw = yaw; stage.viewPitch = -config.angle * Math.PI / 180;
        stage.focus.set(pose.at[0], pose.at[1], pose.at[2]);
        stage.shadowExtent = Math.max(20, span * 2);
        // The camera sits 120 m out: fog starts at the followed point, not at the lens.
        stage.fogOffset = 120; stage.fogScale = 0.18;
      },
      deactivate() { stage.camera = persp; stage.fogOffset = 0; stage.fogScale = 1; },
    };
    registerCamera(stage, cam);
  },
};
