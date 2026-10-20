// graphics.camera.first-person: eye camera with speed-scaled head bob, crouch
// and landing dip, strafe roll, and a view model (arm plus the equipped item)
// that sways with look, bobs with steps and swings on attack/mine/place.
import { joinStage, presentationOnly } from './three-stage.js';
import { registerCamera, viewAngles, orient } from './three-camera.js';
import { paletteFor } from './material-palette.js';

/** Pure head-bob offsets (tested): phase in cycles, amplitude scale 0..1, speed m/s. */
export function headBob(phase, amount, speed, grounded = true) {
  if (!grounded || amount <= 0) return { y: 0, x: 0, roll: 0 };
  const k = Math.min(1, speed / 4) * amount;
  return { y: Math.abs(Math.sin(phase * Math.PI * 2)) * 0.06 * k - 0.03 * k, x: Math.sin(phase * Math.PI * 2) * 0.035 * k, roll: Math.sin(phase * Math.PI * 2) * 0.006 * k };
}

export default {
  id: 'graphics.camera.first-person',
  card: {
    intent: 'First-person eye camera: speed-scaled head bob, crouch and landing dip, strafe roll, and a view model (arm plus equipped item) that sways, bobs and swings on attack/mine/place.',
    views: ['1p'],
    params: {
      fov: { type: 'number', default: 75, min: 50, max: 110, unit: 'deg', effect: 'field of view' },
      bob: { type: 'number', default: 0.5, min: 0, max: 1, effect: 'head bob amount (0 = none; reduced-motion players should use 0)' },
      sensitivity: { type: 'number', default: 1, min: 0.1, max: 5, effect: 'multiplier on look input when the camera integrates look itself' },
      eyeHeight: { type: 'number', default: 1.6, min: 0.2, max: 4, unit: 'm', effect: 'eye height above the feet' },
      viewModel: { type: 'boolean', default: true, effect: 'draw the arm and held item' },
    },
    provides: {},
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    const THREE = stage.THREE;
    let phase = 0, dip = 0, wasGrounded = true, roll = 0, crouch = 0, swing = 0, held = null, heldKey = null;
    const vm = new THREE.Group(); vm.visible = false; stage.camera.add(vm);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.42), new THREE.MeshStandardMaterial({ color: '#d0a080', roughness: 0.9 }));
    arm.position.set(0, 0, 0.12); arm.castShadow = false;
    const pivot = new THREE.Group(); pivot.position.set(0.28, -0.26, -0.42); pivot.add(arm); vm.add(pivot);
    rt.on('*', ev => {
      const who = ev.who ?? ev.by ?? ev.attacker;
      if (who === 'player' && /^(attack|swing|melee_swing|block_mined|block_placed|shoot|fired|mine|place|used|interacted)$/.test(ev.name)) swing = 1;
    });
    let lastYaw = null;
    const cam = {
      id: instance.key, view: '1p',
      update(ctx) {
        const player = ctx.player; if (!player) return;
        stage.baseFov = config.fov;
        const pose = stage.pose(player.id); if (!pose) return;
        const { yaw, pitch } = viewAngles(stage, player);
        const grounded = pose.grounded !== false;
        phase += pose.speed * ctx.dt / 2.6;
        if (grounded && !wasGrounded) dip = Math.min(0.2, 0.08 + Math.abs(pose.vel[1]) * 0.012);
        wasGrounded = grounded; dip *= Math.exp(-ctx.dt * 8);
        const wantCrouch = player.components?.body?.state === 'crouch' ? 0.45 : 0; crouch += (wantCrouch - crouch) * (1 - Math.exp(-ctx.dt * 10));
        const bob = headBob(phase, config.bob, pose.speed, grounded);
        const right = [-Math.cos(yaw), 0, Math.sin(yaw)];
        const sideSpeed = pose.vel[0] * right[0] + pose.vel[2] * right[2];
        roll += ((-sideSpeed * 0.006) - roll) * (1 - Math.exp(-ctx.dt * 6));
        const eye = [pose.at[0] + right[0] * bob.x, pose.at[1] + config.eyeHeight - crouch - dip + bob.y, pose.at[2] + right[2] * bob.x];
        stage.camera.position.set(...eye);
        orient(stage.camera, yaw, pitch);
        stage.camera.rotation.z = roll + bob.roll;
        stage.viewYaw = yaw; stage.viewPitch = pitch; stage.eyeHeight = config.eyeHeight - crouch;
        stage.focus.set(pose.at[0], pose.at[1], pose.at[2]);
        // View model.
        vm.visible = config.viewModel;
        if (config.viewModel) {
          const want = player.components?.equipment?.equipped?.weapon ?? player.components?.melee?.weapon ?? player.components?.equipment?.equipped?.hand ?? null;
          const wantKey = typeof want === 'object' ? want?.item : want;
          if (wantKey !== heldKey) {
            if (held) pivot.remove(held);
            held = null; heldKey = wantKey;
            if (wantKey) { const { id, spec } = stage.models.itemSpecFor(wantKey); held = stage.models.staticObject(id, spec).root; held.position.set(0, 0.03, -0.12); held.rotation.set(-1.1, 0, 0); held.scale.setScalar(0.8); pivot.add(held); }
          }
          const skin = player.components?.model && rt.doc.content?.models?.[player.components.model]?.palette?.s;
          if (skin && arm.material.userData.skin !== skin) { arm.material.color.set(skin); arm.material.userData.skin = skin; }
          const dy = lastYaw == null ? 0 : yaw - lastYaw; lastYaw = yaw;
          swing = Math.max(0, swing - ctx.dt * 3.2);
          const s = Math.sin((1 - swing) * Math.PI) * (swing > 0 ? 1 : 0);
          pivot.position.set(0.28 + Math.max(-0.04, Math.min(0.04, dy * 0.6)) + bob.x * 0.5, -0.26 + bob.y * 0.6 - dip * 0.3, -0.42);
          pivot.rotation.set(-0.15 - s * 1.1, 0.15 + s * 0.4, s * 0.3);
        }
        void paletteFor;
      },
    };
    registerCamera(stage, cam);
  },
};
