import test from 'node:test';
import assert from 'node:assert/strict';
import { NeighborhoodController } from '../src/neighborhood-controller.js';
import { OverworldCharacterSurface, SpectatorCameraSurface } from '../src/overworld-control-surface.js';
import { AgentHost } from '../src/agent-host.js';

function fixture(t) {
  const original = Object.fromEntries(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const window = new EventTarget(), document = new EventTarget();
  document.pointerLockElement = null; document.hidden = false;
  for (const [key, value] of Object.entries({ window, document, navigator: { getGamepads: () => [] } })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const position = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } });
  const canvas = Object.assign(new EventTarget(), { focus() {} });
  const camera = { position: position(), lookAt() {} };
  const world = { colliders: [], heightAt: () => 0, avatar: { root: { position: position(), rotation: {} }, animate() {} },
    venues: [{ id: 'pitch', gameId: 'soccer', x: 6, z: 9 }] };
  const controller = new NeighborhoodController(canvas, camera, world, () => {}, { x: 0, z: 0, yaw: 0, pitch: 0.24 }, () => {});
  t.after(() => {
    controller.dispose();
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { controller, world, canvas };
}

const run = (controller, seconds = 1, dt = 1 / 60) => { for (let elapsed = 0; elapsed < seconds; elapsed += dt) controller.update(dt); };

test('an agent-driven character ignores human gameplay keys but keeps moving', t => {
  const { controller, world } = fixture(t);
  const surface = new OverworldCharacterSurface({ controller, world });
  surface.apply({ type: 'walk', direction: 'north' });
  controller.keys.add('KeyS'); // the human presses "walk back"
  run(controller, 1);
  const observed = surface.observe();
  assert.ok(observed.z > 0.5, `agent travelled north, got z=${observed.z}`);
  assert.equal(observed.agentDriven, true);
});

test('spectator camera input does not bend the agent character trajectory', t => {
  const { controller, world } = fixture(t);
  const surface = new OverworldCharacterSurface({ controller, world });
  surface.apply({ type: 'run', direction: 'north' });
  run(controller, 1.5);
  const quiet = surface.observe();
  surface.safeIdle(); controller.position = { x: 0, z: 0 }; controller.velocity = { x: 0, z: 0 }; controller.yaw = 0;

  // Same agent action, but now the human is orbiting and dollying the camera.
  surface.apply({ type: 'run', direction: 'north' });
  for (let elapsed = 0; elapsed < 1.5; elapsed += 1 / 60) {
    controller.keys.add('KeyD'); controller.keys.add('KeyW'); // human spectator input
    controller.update(1 / 60);
  }
  const orbited = surface.observe();
  assert.notEqual(Math.round(controller.yaw * 100), 0, 'the human actually moved the camera');
  assert.ok(Math.abs(orbited.z - quiet.z) < 0.05, `agent z unchanged: ${orbited.z} vs ${quiet.z}`);
  assert.ok(Math.abs(orbited.x - quiet.x) < 0.05, `agent x unchanged: ${orbited.x} vs ${quiet.x}`);
  assert.equal(orbited.humanSpectatorInput, true);
  // Camera safety still comes from the existing certified pose path.
  assert.ok(Number.isFinite(orbited.camera.distance) && orbited.camera.distance > 0);
});

test('the host grants the character surface and refuses the spectator camera', t => {
  const { controller, world } = fixture(t);
  const host = new AgentHost();
  const character = new OverworldCharacterSurface({ controller, world });
  const session = host.registerSession({ gameId: 'neighborhood', version: '1.0.0',
    surfaces: [character, new SpectatorCameraSurface({ controller })] });
  const started = host.startRun({ sessionId: session.sessionId, surface: 'character', goal: 'walk to the pitch' });
  const grant = host.runs.get(started.runId).grant;
  grant.apply({ type: 'walk', direction: 'north_east' });
  run(controller, 0.5);
  assert.ok(grant.observe().x > 0 && grant.observe().z > 0);
  assert.throws(() => host.startRun({ sessionId: session.sessionId, surface: 'camera', goal: 'take the camera' }), /human/i);
  // Stop clears the drive vector and rejects late actions.
  host.stopRun(started.runId);
  const stopped = character.observe();
  run(controller, 0.4);
  assert.ok(Math.abs(character.observe().speed) < 0.2, 'the character comes to rest after stop');
  assert.throws(() => grant.apply({ type: 'walk', direction: 'north' }), /released|revoked/i);
  assert.equal(typeof stopped.venues[0].distance, 'number');
});
