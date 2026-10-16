import * as THREE from '/runtime/three/three.module.js';
import { createNeighborhoodWorld } from './neighborhood-world.js';
import { NeighborhoodController } from './neighborhood-controller.js';
import { FIRE_RED_ENTRANCE } from './neighborhood-math.js';

const VERSION = 'alder-neighborhood-certified-safety-3';

export async function openNeighborhood(container, onMenu, initialPose, onEnterFireRed, configuration = {}) {
  const started = performance.now(), abort = new AbortController();
  let renderer, world, controller, frame, observer, disposed = false, paused = false, failed = false, suspended = false, entering = false;
  let renderedFrames = 0, lastTime = performance.now(), activeMs = 0, sampleMs = 0, sampleFrames = 0, fps = null;
  container.innerHTML = `<div class="neighborhood-canvas"></div>
    <div class="neighborhood-heading"><span class="neighborhood-kicker">YOUR WORLD, YOUR ADVENTURE</span><h1>Gameverse<span>Alder District · take your time.</span></h1><p class="neighborhood-input-status">Keyboard + mouse · press a controller button to connect</p></div>
    <button class="neighborhood-return" type="button">Menu <span>☰</span></button>
    <div class="neighborhood-destination"><span class="neighborhood-kicker">PLAY IN THE NEIGHBORHOOD</span><strong>Pokémon FireRed</strong><span class="neighborhood-directions">Alder Arcade · across Alder Street</span><span class="neighborhood-distance"></span></div>
    <div class="neighborhood-entry" hidden><span class="neighborhood-kicker">ALDER ARCADE</span><strong>Pokémon FireRed</strong><p>Continue your adventure. Your place in the city will wait.</p><button class="neighborhood-enter" type="button">Enter FireRed <kbd>E</kbd></button><p class="neighborhood-entry-message" role="status" aria-live="polite"></p></div>
    <div class="neighborhood-location"><span class="neighborhood-location-dot"></span><div><strong>ALDER STREET</strong><span>Original neighborhood · exploration prototype</span></div></div>
    <div class="neighborhood-controls"><span class="neighborhood-key-hints"><kbd>W A S D</kbd> Walk · <kbd>Shift</kbd> Run · drag to look</span><span class="neighborhood-pad-hints" hidden>Left stick · move &nbsp; Right stick · look &nbsp; LB · run &nbsp; A · enter &nbsp; Start · menu &nbsp; R3 · voice</span><button type="button" class="neighborhood-capture">Capture mouse</button><button type="button" class="neighborhood-pause">Pause <kbd>Esc</kbd></button></div>
    <div class="neighborhood-overlay"><div><p class="neighborhood-kicker">A LITTLE WORLD OF YOUR OWN</p><h2>Opening Gameverse…</h2><p class="neighborhood-message">Building the streets, light and sky.</p><button type="button" class="neighborhood-resume" hidden>Keep exploring →</button></div></div>`;
  const query = s => container.querySelector(s), overlay = query('.neighborhood-overlay'), message = query('.neighborhood-message');
  const returnButton = query('.neighborhood-return'), resumeButton = query('.neighborhood-resume');
  const locationLabel = document.createElement('span'); locationLabel.textContent = `${configuration.location || 'Alder District'} · take your time.`;
  query('.neighborhood-heading h1').replaceChildren(document.createTextNode(configuration.title || 'Gameverse'), locationLabel);
  query('.neighborhood-destination').hidden = configuration.hasFireRed === false;
  function pause(value) {
    if (disposed || failed || suspended || !controller) return;
    paused = value; controller.setPaused(value); overlay.hidden = !value; resumeButton.hidden = !value;
    query('.neighborhood-overlay h2').textContent = 'A moment in the city.';
    message.textContent = 'Your walk is paused. Pick up where you left off.';
    query('.neighborhood-pause').textContent = value ? 'Paused' : 'Pause · Esc';
    lastTime = performance.now();
    if (value) { suspend(); onMenu(controller.pose()); }
  }
  function suspend() {
    if (disposed) return;
    suspended = true; paused = true; controller?.setPaused(true); overlay.hidden = true;
  }
  function resume(note = '') {
    if (disposed) return;
    suspended = false; entering = false; query('.neighborhood-enter').disabled = false;
    query('.neighborhood-enter').innerHTML = 'Enter FireRed <kbd>E</kbd>';
    query('.neighborhood-entry-message').textContent = note;
    if (failed) { overlay.hidden = false; returnButton.focus(); }
    else pause(false);
  }
  function entranceDistance() { return controller ? Math.hypot(controller.position.x - FIRE_RED_ENTRANCE.x, controller.position.z - FIRE_RED_ENTRANCE.z) : Infinity; }
  async function enterFireRed() {
    if (!onEnterFireRed || configuration.hasFireRed === false || entering || paused || suspended || failed || disposed || entranceDistance() > FIRE_RED_ENTRANCE.radius) return;
    entering = true; query('.neighborhood-enter').disabled = true; query('.neighborhood-enter').textContent = 'Opening FireRed…';
    query('.neighborhood-entry-message').textContent = ''; suspend();
    try { await onEnterFireRed(); }
    catch (error) { resume(error.message || 'FireRed could not open. Try again.'); }
  }
  query('.neighborhood-enter').addEventListener('click', enterFireRed, { signal: abort.signal });
  function dispose() {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(frame); abort.abort(); observer?.disconnect(); controller?.dispose(); world?.dispose();
    renderer?.dispose(); renderer?.forceContextLoss();
    container.replaceChildren();
  }
  returnButton.addEventListener('click', () => { const pose = controller?.pose(); suspend(); onMenu(pose); }, { signal: abort.signal });
  resumeButton.addEventListener('click', () => pause(false), { signal: abort.signal });
  query('.neighborhood-pause').addEventListener('click', () => pause(true), { signal: abort.signal });
  query('.neighborhood-capture').addEventListener('click', async () => {
    if (paused || failed || !controller) return;
    renderer.domElement.focus({ preventScroll: true });
    try { await renderer.domElement.requestPointerLock(); if (!disposed) renderer.domElement.focus({ preventScroll: true }); }
    catch { query('.neighborhood-capture').textContent = 'Drag to look'; renderer.domElement.focus(); }
  }, { signal: abort.signal });
  window.addEventListener('keydown', event => {
    if (suspended || disposed || document.querySelector('dialog[open]:not(#voice-dialog)')) return;
    if (event.code === 'Escape' && !event.repeat) { event.preventDefault(); pause(!paused); }
    if (event.code === 'KeyE' && !event.repeat && !event.target.closest?.('button, input')) { event.preventDefault(); enterFireRed(); }
  }, { signal: abort.signal });
  let firstRenderMs = null;
  const diagnostics = Object.freeze({
    read() { return { version: VERSION, state: disposed ? 'disposed' : failed ? 'failed' : suspended ? 'suspended' : paused ? 'paused' : controller ? 'playing' : 'loading',
      ...controller?.observe(), renderer: 'Three.js WebGL2', rendererVersion: THREE.REVISION, renderedFrames, activeMs, recentFps: fps,
      loadToFirstRenderMs: firstRenderMs, drawCalls: renderer?.info.render.calls ?? null,
      triangles: renderer?.info.render.triangles ?? null, colliderCount: world?.colliders.length ?? 0,
      entrance: { ...FIRE_RED_ENTRANCE, distance: entranceDistance(), available: !suspended && !paused && entranceDistance() <= FIRE_RED_ENTRANCE.radius } }; },
    colliders() { return world?.colliders.map(box => ({ ...box })) || []; },
    cameraColliders() { return world?.cameraColliders.map(box => ({ ...box })) || []; },
  });
  // Read-only developer observations; no mutation or gameplay controls are exposed.
  window.__gameverseNeighborhood = diagnostics;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.04;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    const canvas = renderer.domElement; canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Gameverse, Alder District. WASD or left stick to walk, Shift or LB to run, drag or right stick to look, E or A at the arcade, Escape or Start for menu.');
    query('.neighborhood-canvas').append(canvas);
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fail(Error('The graphics context was interrupted. Open Menu to reopen Gameverse.')); }, { signal: abort.signal });
    // Let the loading/recovery controls paint before constructing the scene.
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (disposed) return { dispose };
    const camera = new THREE.PerspectiveCamera(55, 1, 0.08, 600);
    world = createNeighborhoodWorld(renderer, { hasFireRed: configuration.hasFireRed !== false });
    controller = new NeighborhoodController(canvas, camera, world, pause, initialPose, enterFireRed);
    function resize() {
      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      renderer.setSize(Math.max(1, width), Math.max(1, height), false); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix();
      try {
        controller.updateCamera(0); // Aspect changes can enlarge near-plane clearance.
        if (paused && !suspended && !failed) renderer.render(world.scene, camera);
      } catch (error) { fail(error); }
    }
    observer = new ResizeObserver(resize); observer.observe(container); resize();
    if (failed) return { dispose, suspend, resume, observe: diagnostics.read };
    renderer.render(world.scene, camera); renderedFrames++; firstRenderMs = performance.now() - started;
    overlay.hidden = true; canvas.focus({ preventScroll: true }); lastTime = performance.now();
    function animate(now) {
      if (disposed || failed) return;
      frame = requestAnimationFrame(animate);
      const elapsed = now - lastTime; lastTime = now;
      if (paused || document.hidden) return;
      const dt = Math.min(elapsed / 1000, 0.05);
      try { controller.update(dt); } catch (error) { fail(error); return; }
      if (paused || suspended) return;
      renderer.render(world.scene, camera); renderedFrames++; activeMs += elapsed;
      sampleMs += elapsed; sampleFrames++;
      if (sampleMs >= 1000) { fps = Math.round(sampleFrames * 1000 / sampleMs); sampleMs = 0; sampleFrames = 0; }
      const { x, z } = controller.position;
      query('.neighborhood-location strong').textContent = z > 18 && x < -10 ? 'ALDER GARDEN' : Math.abs(x) < 10 ? 'JUNIPER AVENUE' : 'ALDER STREET';
      const distance = entranceDistance();
      query('.neighborhood-distance').textContent = distance <= FIRE_RED_ENTRANCE.radius ? 'You are at the entrance' : `${Math.round(distance)} m · look for the amber arcade sign`;
      query('.neighborhood-entry').hidden = configuration.hasFireRed === false || distance > FIRE_RED_ENTRANCE.radius;
      const gamepad = controller.observe().gamepad;
      query('.neighborhood-key-hints').hidden = Boolean(gamepad?.connected);
      query('.neighborhood-pad-hints').hidden = !gamepad?.connected;
      query('.neighborhood-input-status').textContent = gamepad?.connected ? (gamepad.armed ? 'Controller connected · explore with the sticks' : 'Controller connected · release sticks and buttons to continue') : 'Keyboard + mouse · press a controller button to connect';
    }
    frame = requestAnimationFrame(animate);
  } catch (error) { fail(error); }
  function fail(error) {
    if (disposed) return;
    failed = true; cancelAnimationFrame(frame); controller?.setPaused(true); overlay.hidden = false; resumeButton.hidden = true;
    query('.neighborhood-overlay h2').textContent = 'Gameverse needs a moment.';
    message.textContent = `${error.message} Menu gives you recovery and character options.`;
    returnButton.focus();
  }
  return { dispose, suspend, resume, observe: diagnostics.read };
}
