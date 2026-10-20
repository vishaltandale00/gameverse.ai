// 3D adapters for the shared effect primitives owned by the flat workstream
// (graphics.particles, graphics.post, graphics.fx.feedback). Those primitives
// call rt.caches.three.adapters[id](rt, config, instance) when the active
// space is 3D; the adapters draw the same configs with three.js:
// - particles: CPU particles in world space (dust, spark, smoke, debris,
//   rain, snow, ember, leaf, splash, glow) bound to gameplay events and
//   footsteps, soft round sprites, additive for sparks/embers/glow, budgeted;
// - post: HDR render target -> bloom (threshold + blur pyramid), tone
//   mapping, depth outlines, a cheap depth-crease AO, vignette, grain,
//   colour quantisation, scanlines, damage flash;
// - feedback: hit-stop and slow-mo scale the display clock of animation.

const SHAPES = ['dust', 'spark', 'smoke', 'debris', 'rain', 'snow', 'ember', 'leaf', 'splash', 'glow'];
const ADDITIVE = new Set(['spark', 'ember', 'glow']);

/** Initial velocity, size and drag for one particle of a shape (pure; tested). r() -> [0,1). */
export function emitParticle(shape, speed, r) {
  const a = r() * Math.PI * 2, u = r() * 2 - 1, s = Math.sqrt(1 - u * u);
  const dir = [Math.cos(a) * s, Math.abs(u), Math.sin(a) * s];
  const v = speed * (0.4 + r() * 0.6);
  switch (shape) {
    case 'dust': return { vel: [dir[0] * v * 0.6, 0.3 + r() * v * 0.3, dir[2] * v * 0.6], size: 0.25 + r() * 0.2, grow: 1.8, drag: 2.5 };
    case 'smoke': return { vel: [dir[0] * v * 0.3, v * (0.6 + r() * 0.4), dir[2] * v * 0.3], size: 0.35 + r() * 0.3, grow: 2.6, drag: 0.8 };
    case 'spark': return { vel: [dir[0] * v, (u * 0.5 + 0.6) * v, dir[2] * v], size: 0.06 + r() * 0.05, grow: -0.6, drag: 1.2 };
    case 'debris': return { vel: [dir[0] * v * 0.7, (0.5 + r() * 0.6) * v, dir[2] * v * 0.7], size: 0.12 + r() * 0.1, grow: 0, drag: 0.3, bounce: true };
    case 'splash': return { vel: [dir[0] * v * 0.5, (0.7 + r() * 0.5) * v, dir[2] * v * 0.5], size: 0.08 + r() * 0.06, grow: 0.2, drag: 0.4 };
    case 'ember': return { vel: [dir[0] * v * 0.3, v * (0.5 + r()), dir[2] * v * 0.3], size: 0.05 + r() * 0.06, grow: -0.3, drag: 0.6, flicker: true };
    case 'leaf': return { vel: [dir[0] * v * 0.5, -0.2 - r() * 0.4, dir[2] * v * 0.5], size: 0.1 + r() * 0.06, grow: 0, drag: 1.5, flutter: true };
    case 'snow': return { vel: [dir[0] * 0.3, -v * 0.3, dir[2] * 0.3], size: 0.06 + r() * 0.04, grow: 0, drag: 1, flutter: true };
    case 'rain': return { vel: [0, -v, 0], size: 0.04, grow: 0, drag: 0 };
    default: return { vel: [dir[0] * v, dir[1] * v, dir[2] * v], size: 0.3 + r() * 0.3, grow: 1.2, drag: 1.5 }; // glow
  }
}

export function installEffectAdapters(stage) {
  stage.adapters['graphics.particles'] = (rt, config, instance) => particles(stage, rt, config, instance);
  stage.adapters['graphics.post'] = (rt, config) => post(stage, rt, config);
  stage.adapters['graphics.fx.feedback'] = (rt, config) => feedback(stage, rt, config);
}

function particles(stage, rt, config) {
  const THREE = stage.THREE;
  const N = Math.max(100, Math.min(20000, config.budget ?? 3000));
  const P = { pos: new Float32Array(N * 3), vel: new Float32Array(N * 3), col: new Float32Array(N * 3), age: new Float32Array(N), life: new Float32Array(N), size: new Float32Array(N), grow: new Float32Array(N), drag: new Float32Array(N), grav: new Float32Array(N), flags: new Uint8Array(N), add: new Uint8Array(N) };
  let head = 0, live = 0, seed = 1;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const make = additive => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('psize', new THREE.BufferAttribute(new Float32Array(N), 1));
    g.setAttribute('palpha', new THREE.BufferAttribute(new Float32Array(N), 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: true,
      vertexShader: 'attribute float psize; attribute float palpha; uniform float uScale; varying vec3 vC; varying float vA; void main(){ vC = color; vA = palpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = psize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard; float s = smoothstep(0.25, 0.05, r); gl_FragColor = vec4(vC, vA * s); #include <tonemapping_fragment>\n #include <colorspace_fragment>\n }',
    });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 4; pts.name = additive ? 'particles+' : 'particles';
    stage.scene.add(pts); return pts;
  };
  const layers = [make(false), make(true)];
  const presets = new Map((config.presets || []).map(p => [p.id, p]));
  const colorRgb = new THREE.Color();
  function spawn(id, at, opts = {}) {
    const p = presets.get(id); if (!p || !at) return;
    const shape = SHAPES.includes(p.shape) ? p.shape : 'dust';
    colorRgb.set(p.color || '#ffffff');
    const n = Math.min(opts.count ?? p.count ?? 10, 400);
    for (let k = 0; k < n; k++) {
      const i = head; head = (head + 1) % N; if (P.life[i] <= P.age[i]) live++;
      const e = emitParticle(shape, p.speed ?? 2, r);
      P.pos[i * 3] = at[0] + (r() - 0.5) * 0.2; P.pos[i * 3 + 1] = at[1] + (r() - 0.5) * 0.2; P.pos[i * 3 + 2] = at[2] + (r() - 0.5) * 0.2;
      P.vel.set(e.vel, i * 3);
      const j = 0.85 + r() * 0.3;
      P.col[i * 3] = colorRgb.r * j; P.col[i * 3 + 1] = colorRgb.g * j; P.col[i * 3 + 2] = colorRgb.b * j;
      P.age[i] = 0; P.life[i] = (p.life ?? 1) * (0.6 + r() * 0.6); P.size[i] = e.size * (opts.scale ?? 1); P.grow[i] = e.grow; P.drag[i] = e.drag;
      P.grav[i] = -(p.gravity ?? 0); P.flags[i] = (e.bounce ? 1 : 0) | (e.flicker ? 2 : 0) | (e.flutter ? 4 : 0); P.add[i] = ADDITIVE.has(shape) ? 1 : 0;
    }
  }
  // Where an event happens: an entity named by the binding's `at` field, else event coordinates.
  const whereOf = (ev, at) => {
    const pick = at === 'target' ? (ev.target ?? ev.id ?? ev.who) : at === 'self' || at === 'feet' || at === 'wheels' ? (ev.who ?? ev.by ?? ev.id ?? ev.attacker) : (ev[at] ?? ev.who ?? ev.target);
    if (Array.isArray(ev.at) && (at === 'target' || !pick || !rt.state.entities[pick])) {
      const cell = stage.spaceApi(rt.player()?.space)?.cell ?? 1;
      return ev.at.length === 3 && ev.at.every(Number.isInteger) ? ev.at.map(v => (v + 0.5) * cell) : ev.at;
    }
    if (typeof pick !== 'string') return null;
    const pose = stage.pose(pick); if (!pose) return null;
    const h = stage.actors?.get(pick)?.height ?? 1.6;
    return [pose.at[0], pose.at[1] + (at === 'feet' || at === 'wheels' ? 0.05 : h * 0.55), pose.at[2]];
  };
  const binds = config.bind || [];
  rt.on('*', ev => {
    for (const b of binds) {
      const match = b.event === ev.name || (b.event.endsWith(':*') && ev.name.startsWith(b.event.slice(0, -1)));
      if (match) spawn(b.preset, whereOf(ev, b.at || 'self'));
    }
  });
  // Footstep dust at speed (POLISH: run dust) when a dust preset exists.
  const dust = [...presets.values()].find(p => p.shape === 'dust');
  if (dust) stage.animListeners.push(e => { if (e.event === 'step' && e.speed > 3.5 && e.at) spawn(dust.id, [e.at[0], e.at[1] + 0.05, e.at[2]], { count: Math.ceil((dust.count ?? 6) / 3), scale: 0.6 }); if (e.event === 'land' && e.at) spawn(dust.id, e.at, { count: dust.count ?? 6 }); });
  stage.hook('world', ctx => {
    const dt = ctx.dt * (stage.timeScale ?? 1);
    const out = [layers[0].geometry.attributes, layers[1].geometry.attributes], n = [0, 0];
    for (let i = 0; i < N; i++) {
      if (P.age[i] >= P.life[i]) continue;
      P.age[i] += dt;
      const t = P.age[i] / P.life[i];
      if (t >= 1) { live--; continue; }
      const k = Math.exp(-P.drag[i] * dt);
      P.vel[i * 3] *= k; P.vel[i * 3 + 2] *= k; P.vel[i * 3 + 1] = P.vel[i * 3 + 1] * k + P.grav[i] * dt;
      if (P.flags[i] & 4) { P.vel[i * 3] += Math.sin(P.age[i] * 5 + i) * dt * 2; P.vel[i * 3 + 2] += Math.cos(P.age[i] * 4 + i) * dt * 2; }
      for (let a = 0; a < 3; a++) P.pos[i * 3 + a] += P.vel[i * 3 + a] * dt;
      if (P.flags[i] & 1) { const gy = stage.groundAt(stage.activeSpace, P.pos[i * 3], P.pos[i * 3 + 2]).y + 0.05; if (P.pos[i * 3 + 1] < gy) { P.pos[i * 3 + 1] = gy; P.vel[i * 3 + 1] *= -0.35; P.vel[i * 3] *= 0.6; P.vel[i * 3 + 2] *= 0.6; } }
      const L = P.add[i], o = out[L], j = n[L]++;
      o.position.array[j * 3] = P.pos[i * 3]; o.position.array[j * 3 + 1] = P.pos[i * 3 + 1]; o.position.array[j * 3 + 2] = P.pos[i * 3 + 2];
      o.color.array[j * 3] = P.col[i * 3]; o.color.array[j * 3 + 1] = P.col[i * 3 + 1]; o.color.array[j * 3 + 2] = P.col[i * 3 + 2];
      o.psize.array[j] = Math.max(0.005, P.size[i] * (1 + P.grow[i] * t));
      o.palpha.array[j] = (1 - t) * (t < 0.1 ? t * 10 : 1) * ((P.flags[i] & 2) ? 0.6 + 0.4 * Math.sin(P.age[i] * 30 + i) : 1);
    }
    layers.forEach((l, L) => { l.geometry.setDrawRange(0, n[L]); for (const k of ['position', 'color', 'psize', 'palpha']) l.geometry.attributes[k].needsUpdate = true; l.material.uniforms.uScale.value = stage.renderer.domElement.height || 400; });
    stage.stats.particles = n[0] + n[1];
  }, 'graphics.particles:3d');
  return { spawn, dispose() { for (const l of layers) { stage.scene.remove(l); l.geometry.dispose(); l.material.dispose(); } } };
}

function post(stage, rt, config) {
  const THREE = stage.THREE, renderer = stage.renderer;
  const tm = { none: THREE.NoToneMapping, aces: THREE.ACESFilmicToneMapping, filmic: THREE.AgXToneMapping ?? THREE.CineonToneMapping, neutral: THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping };
  renderer.toneMapping = tm[config.tonemap] ?? THREE.ACESFilmicToneMapping;
  const opts = { type: THREE.HalfFloatType, samples: 4 };
  let w = 0, h = 0, scene = null, b1 = null, b2 = null, b3 = null, b3b = null;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const fsScene = new THREE.Scene(); fsScene.add(quad);
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const vert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const bright = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uThreshold: { value: 0.9 } }, vertexShader: vert, fragmentShader: 'uniform sampler2D tSrc; uniform float uThreshold; varying vec2 vUv; void main(){ vec3 c = texture2D(tSrc, vUv).rgb; float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.6, l), 1.0); }', toneMapped: false });
  const blur = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: vert, fragmentShader: 'uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv; void main(){ vec3 c = texture2D(tSrc, vUv).rgb * 0.227; c += texture2D(tSrc, vUv + uDir * 1.385).rgb * 0.316; c += texture2D(tSrc, vUv - uDir * 1.385).rgb * 0.316; c += texture2D(tSrc, vUv + uDir * 3.23).rgb * 0.07; c += texture2D(tSrc, vUv - uDir * 3.23).rgb * 0.07; gl_FragColor = vec4(c, 1.0); }', toneMapped: false });
  const composite = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: null }, tDepth: { value: null }, tBloom: { value: null }, uBloom: { value: config.bloom ?? 0 }, uVignette: { value: config.vignette ?? 0 }, uGrain: { value: config.grain ?? 0 }, uOutline: { value: config.outline ?? 0 },
      uQuant: { value: config.quantize ?? 0 }, uScan: { value: config.scanlines ? 1 : 0 }, uAO: { value: config.ssao ? 1 : 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.1 }, uFar: { value: 1000 }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color('#ffffff') }, uOrtho: { value: 0 } },
    vertexShader: vert,
    fragmentShader: `uniform sampler2D tScene, tDepth, tBloom; uniform float uBloom, uVignette, uGrain, uOutline, uQuant, uScan, uAO, uTime, uNear, uFar, uFlash, uOrtho; uniform vec2 uRes; uniform vec3 uFlashColor; varying vec2 vUv;
float lin(float d){ if (uOrtho > 0.5) return uNear + d * (uFar - uNear); float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 c = texture2D(tScene, vUv).rgb;
  vec2 px = 1.0 / uRes;
  float d0 = lin(texture2D(tDepth, vUv).r);
  if (uAO > 0.5) { float s = 0.0; for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; vec2 o = vec2(cos(a), sin(a)) * px * (6.0 + 8.0 / max(1.0, d0 * 0.2)); s += clamp((d0 - lin(texture2D(tDepth, vUv + o).r)) / max(0.3, d0 * 0.05), 0.0, 1.0); } c *= 1.0 - 0.35 * (s / 8.0); }
  if (uOutline > 0.0) { float e = 0.0; for (int i = 0; i < 4; i++) { vec2 o = (i < 2 ? vec2(float(i * 2 - 1), 0.0) : vec2(0.0, float(i * 2 - 5))) * px * uOutline; e = max(e, abs(lin(texture2D(tDepth, vUv + o).r) - d0) / max(0.5, d0 * 0.04)); } c *= 1.0 - 0.8 * clamp(e - 0.5, 0.0, 1.0); }
  c += texture2D(tBloom, vUv).rgb * uBloom;
  c = mix(c, uFlashColor * 2.0, uFlash * 0.45);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 o = gl_FragColor.rgb;
  if (uQuant > 1.0) { float lv = max(2.0, floor(pow(uQuant, 1.0 / 3.0) + 0.5)); o = floor(o * lv + 0.5) / lv; }
  if (uScan > 0.5) o *= 0.88 + 0.12 * sin(gl_FragCoord.y * 3.14159);
  float v = distance(vUv, vec2(0.5)); o *= 1.0 - uVignette * smoothstep(0.35, 0.85, v);
  o += (hash(vUv * uRes + fract(uTime) * 91.0) - 0.5) * uGrain;
  gl_FragColor = vec4(o, 1.0);
}`,
  });
  const pass = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); };
  const resize = () => {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (size.x === w && size.y === h) return; w = size.x; h = size.y;
    for (const t of [scene, b1, b2, b3, b3b]) t?.dispose();
    scene = new THREE.WebGLRenderTarget(w, h, { ...opts, depthTexture: new THREE.DepthTexture(w, h) });
    b1 = new THREE.WebGLRenderTarget(w >> 1, h >> 1, { type: THREE.HalfFloatType }); b2 = new THREE.WebGLRenderTarget(w >> 2, h >> 2, { type: THREE.HalfFloatType });
    b3 = new THREE.WebGLRenderTarget(w >> 2, h >> 2, { type: THREE.HalfFloatType }); b3b = new THREE.WebGLRenderTarget(w >> 3, h >> 3, { type: THREE.HalfFloatType });
    composite.uniforms.uRes.value.set(w, h);
  };
  const handle = {
    resize,
    render(ctx) {
      resize();
      const cam = stage.camera;
      renderer.setRenderTarget(scene); renderer.render(stage.scene, cam);
      const bloomOn = (config.bloom ?? 0) > 0;
      if (bloomOn) {
        bright.uniforms.tSrc.value = scene.texture; pass(bright, b1);
        blur.uniforms.tSrc.value = b1.texture; blur.uniforms.uDir.value.set(2 / w, 0); pass(blur, b2);
        blur.uniforms.tSrc.value = b2.texture; blur.uniforms.uDir.value.set(0, 4 / h); pass(blur, b3);
        blur.uniforms.tSrc.value = b3.texture; blur.uniforms.uDir.value.set(8 / w, 0); pass(blur, b3b);
        blur.uniforms.tSrc.value = b3b.texture; blur.uniforms.uDir.value.set(0, 8 / h); pass(blur, b3);
      }
      const u = composite.uniforms, fb = rt.caches.flat?.feedback;
      u.tScene.value = scene.texture; u.tDepth.value = scene.depthTexture; u.tBloom.value = bloomOn ? b3.texture : b1.texture; u.uBloom.value = bloomOn ? config.bloom : 0;
      u.uTime.value = ctx.time; u.uNear.value = cam.near; u.uFar.value = cam.far; u.uOrtho.value = cam.isOrthographicCamera ? 1 : 0;
      u.uFlash.value = fb?.flash ?? 0; if (fb?.flashColor) u.uFlashColor.value.set(fb.flashColor);
      pass(composite, null);
    },
    dispose() { for (const t of [scene, b1, b2, b3, b3b]) t?.dispose(); stage.adapters.$post = null; },
  };
  stage.adapters.$post = handle;
  return handle;
}

function feedback(stage, rt) {
  // Hit-stop freezes and slow-mo slows presentation time (animation, particles); the camera
  // already reads shake/zoom from rt.caches.flat.feedback.
  stage.hook('pre', () => {
    const fb = rt.caches.flat?.feedback;
    stage.timeScale = fb ? (fb.hitStop > 0 ? 0 : (fb.slowmo ?? 1)) : 1;
  }, 'graphics.fx.feedback:3d');
  return { dispose() { stage.timeScale = 1; } };
}
