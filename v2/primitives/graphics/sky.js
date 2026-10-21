// graphics.sky: sky dome shader (zenith/horizon gradient by hour), sun and
// moon discs with glow, twinkling stars, drifting fbm clouds, fog matched to
// the horizon, sun/moon/hemisphere lighting from the `time.hour` var, and
// weather from the `weather` var (cloud cover, darkening, fog, lightning,
// rain/snow/ash precipitation around the camera).
import { joinStage, presentationOnly } from './three-stage.js';
import { clamp, smoothstep } from './three-util.js';
import { color6 } from './model-lib.js';

const hexRgb = h => { const n = parseInt(String(h).replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
let SRGB = 'srgb';
/** Palette math is in sRGB; three.js colors are linear, so convert on write. */
const srgb = (color, rgb) => color.setRGB(Math.max(0, rgb[0]), Math.max(0, rgb[1]), Math.max(0, rgb[2]), SRGB);

/** Weather presets: cloud cover, light, fog multiplier, precipitation kind/amount, lightning. */
export const WEATHER = {
  clear: { clouds: 0, light: 1, fog: 1, precip: null, amount: 0 }, cloudy: { clouds: 0.55, light: 0.78, fog: 1.3, precip: null, amount: 0 },
  overcast: { clouds: 0.85, light: 0.62, fog: 1.6, precip: null, amount: 0 }, rain: { clouds: 0.85, light: 0.58, fog: 2.2, precip: 'rain', amount: 0.7 },
  storm: { clouds: 1, light: 0.4, fog: 2.8, precip: 'rain', amount: 1, lightning: true }, fog: { clouds: 0.35, light: 0.75, fog: 7, precip: null, amount: 0 },
  snow: { clouds: 0.8, light: 0.8, fog: 2.5, precip: 'snow', amount: 0.8 }, ashfall: { clouds: 0.7, light: 0.55, fog: 3, precip: 'ash', amount: 0.7, tint: [0.75, 0.55, 0.45] },
  dripping: { clouds: 0.3, light: 0.85, fog: 1.4, precip: 'rain', amount: 0.15 }, sandstorm: { clouds: 0.4, light: 0.7, fog: 6, precip: 'ash', amount: 0.6, tint: [0.9, 0.75, 0.5] },
};
export const weatherOf = id => WEATHER[id] || (/rain|shower|drizzle/.test(id || '') ? WEATHER.rain : /storm|thunder/.test(id || '') ? WEATHER.storm : /snow|blizzard/.test(id || '') ? WEATHER.snow : /fog|mist|haze/.test(id || '') ? WEATHER.fog : /cloud|overcast/.test(id || '') ? WEATHER.cloudy : /ash|dust|sand/.test(id || '') ? WEATHER.ashfall : WEATHER.clear);

/**
 * Pure sky state for an hour (tested): sun direction, day/night factors and colors.
 * palette: { dawn, day, dusk, night } hex; phases: { dawn, day, dusk, night } hours; tiltDeg: sun path tilt.
 */
export function skyAt(hour, { palette, phases = {}, tiltDeg = 20 } = {}) {
  const rise = ((phases.dawn ?? 5) + (phases.day ?? 7)) / 2, set = ((phases.dusk ?? 18) + (phases.night ?? 21)) / 2;
  const h = ((hour % 24) + 24) % 24;
  const dayT = (h - rise) / (set - rise);
  const tilt = tiltDeg * Math.PI / 180;
  const ang = Math.PI * dayT; // 0 at sunrise, π at sunset; negative / > π below the horizon
  const sun = [Math.cos(ang), Math.sin(ang) * Math.cos(tilt), Math.sin(ang) * Math.sin(tilt) * -1];
  const l = Math.hypot(...sun); for (let i = 0; i < 3; i++) sun[i] /= l;
  const moon = [-sun[0], -sun[1], -sun[2] * 0.6 + 0.2]; const ml = Math.hypot(...moon); for (let i = 0; i < 3; i++) moon[i] /= ml;
  const elev = sun[1];
  const day = smoothstep(-0.08, 0.25, elev), night = 1 - smoothstep(-0.25, 0.02, elev);
  const twilight = clamp(1 - Math.abs(elev) / 0.3, 0, 1) * (1 - night * 0.6);
  const P = { dawn: hexRgb(palette?.dawn || '#f0b890'), day: hexRgb(palette?.day || '#78b0f0'), dusk: hexRgb(palette?.dusk || '#e07050'), night: hexRgb(palette?.night || '#0a1024') };
  const warm = h < 12 ? P.dawn : P.dusk;
  let zenith = mixRgb(P.night, P.day, day); zenith = mixRgb(zenith, mixRgb(warm, zenith, 0.55), twilight * 0.6);
  let horizon = mixRgb(mixRgb(P.night, [0.22, 0.26, 0.4], 0.5), mixRgb(P.day, [0.92, 0.95, 1], 0.55), day);
  horizon = mixRgb(horizon, warm, twilight * 0.85);
  const sunColor = mixRgb([1, 0.55, 0.32], [1, 0.96, 0.88], smoothstep(0, 0.45, elev));
  return { sun, moon, elev, day, night, twilight, zenith, horizon, sunColor, hour: h };
}

const VERT = `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const FRAG = `
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor, uMoonDir, uCloudLit, uCloudDark; uniform float uNight, uDay, uClouds, uTime, uStars, uFlash;
varying vec3 vDir;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.25, h));
  float sd = max(dot(d, uSunDir), 0.0), md = max(dot(d, uMoonDir), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 18.0 + pow(sd, 64.0) * 0.45 + pow(sd, 6.0) * 0.18 * (1.0 - uNight)) * smoothstep(-0.12, 0.02, uSunDir.y);
  float moon = smoothstep(0.9993, 0.9996, md); col += vec3(0.9, 0.93, 1.0) * (moon * 1.6 + pow(md, 120.0) * 0.25) * uNight;
  if (uStars > 0.5 && uNight > 0.01 && h > 0.0) {
    vec3 c = floor(d * 260.0); float s = h21(c.xy + c.z * 7.13);
    float tw = 0.6 + 0.4 * sin(uTime * (2.0 + s * 4.0) + s * 40.0);
    col += vec3(step(0.9965, s) * tw * smoothstep(0.0, 0.25, h) * uNight * (1.0 - uClouds * 0.9));
  }
  if (h > -0.02 && uClouds > 0.001) {
    vec2 uv = d.xz / (h + 0.12) * 0.9 + vec2(uTime * 0.012, uTime * 0.004);
    float n = fbm(uv * 1.3);
    float cover = smoothstep(1.0 - uClouds * 0.85 - 0.12, 1.05 - uClouds * 0.85, n);
    float lit = clamp(0.55 + dot(normalize(vec3(uSunDir.x, 0.6, uSunDir.z)), vec3(0.0, 1.0, 0.0)) * 0.3 + (n - 0.5) * 0.8, 0.0, 1.0);
    vec3 cc = mix(uCloudDark, uCloudLit, lit) + uSunColor * pow(sd, 8.0) * 0.35 * (1.0 - uNight);
    col = mix(col, cc, cover * smoothstep(-0.02, 0.18, h));
  }
  col += vec3(uFlash);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export default {
  id: 'graphics.sky',
  card: {
    intent: 'Sky and atmosphere for 3D: dome gradient by hour, sun and moon with glow, twinkling stars, drifting clouds, horizon-matched fog, sun/moon/ambient lighting from the time.hour var, and weather from the weather var (cover, darkening, fog, lightning, rain/snow/ash around the camera).',
    views: ['1p', '3p', 'iso', 'td'],
    params: {
      palette: { type: 'object', default: {}, effect: 'zenith colors by phase', fields: { dawn: color6(), day: color6(), dusk: color6(), night: color6() } },
      fogDensity: { type: 'number', default: 0.004, min: 0, max: 0.05, effect: 'exponential fog density in clear weather' },
      clouds: { type: 'number', default: 0.45, min: 0, max: 1, effect: 'cloud cover in clear weather' },
      sunTilt: { type: 'number', default: 20, min: 0, max: 80, unit: 'deg', effect: 'tilt of the sun path away from overhead' },
      stars: { type: 'boolean', default: true, effect: 'stars at night' },
      hour: { type: 'number', default: 13, min: 0, max: 24, effect: 'hour used when no time.hour var exists' },
      hourVar: { type: 'string', default: 'time.hour', effect: 'var holding the hour (0..24)' },
      weatherVar: { type: 'string', default: 'weather', effect: 'var holding the weather id (clear, cloudy, rain, storm, fog, snow, ashfall...)' },
      precipitation: { type: 'boolean', default: true, effect: 'draw rain/snow/ash around the camera for wet weather' },
    },
    provides: {},
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    const THREE = stage.THREE; SRGB = THREE.SRGBColorSpace;
    const timeCfg = (rt.doc.systems || []).find(s => s.use === 'engine.time')?.with || {};
    const uniforms = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3() }, uCloudLit: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() },
      uNight: { value: 0 }, uDay: { value: 1 }, uClouds: { value: config.clouds }, uTime: { value: 0 }, uStars: { value: config.stars ? 1 : 0 }, uFlash: { value: 0 },
    };
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false }));
    dome.frustumCulled = false; dome.renderOrder = -10; dome.name = 'sky';
    stage.scene.add(dome);
    stage.scene.background = null;
    const fog = new THREE.FogExp2('#a0b0c0', config.fogDensity); stage.scene.fog = fog;
    let linearFog = null;
    // Precipitation: instanced streaks/flakes in a box that follows the camera.
    const COUNT = 2400;
    const precipGeo = new THREE.BufferGeometry();
    const seeds = new Float32Array(COUNT * 3); for (let i = 0; i < COUNT * 3; i++) seeds[i] = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const pos = new Float32Array(COUNT * 6);
    precipGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const precipMat = new THREE.LineBasicMaterial({ color: '#b8c8e0', transparent: true, opacity: 0.55, depthWrite: false });
    const precip = new THREE.LineSegments(precipGeo, precipMat); precip.frustumCulled = false; precip.visible = false; stage.scene.add(precip);
    let flash = 0, nextBolt = 4, weatherBlend = { ...WEATHER.clear }, lastId = null;
    stage.skyState = null;

    stage.hook('world', ctx => {
      const vars = rt.state.vars;
      const hour = Number.isFinite(vars[config.hourVar]) ? vars[config.hourVar] : Number.isFinite(vars.hour) ? vars.hour : config.hour;
      const wid = vars[config.weatherVar] ?? vars['weather.id'] ?? 'clear';
      const target = weatherOf(typeof wid === 'string' ? wid : 'clear');
      if (wid !== lastId) lastId = wid;
      // Ease between weather states over a few seconds.
      const k = 1 - Math.exp(-ctx.dt * 0.6);
      const intensity = Number.isFinite(vars['weather.intensity']) ? vars['weather.intensity'] : 1;
      const goal = { clouds: target.clouds, light: 1 - (1 - target.light) * intensity, fog: 1 + (target.fog - 1) * intensity, amount: target.amount * intensity };
      for (const key of ['clouds', 'light', 'fog', 'amount']) weatherBlend[key] += ((goal[key] ?? 0) - (weatherBlend[key] ?? 0)) * k;
      weatherBlend.precip = target.precip ?? (weatherBlend.amount > 0.05 ? weatherBlend.precip : null); weatherBlend.tint = target.tint; weatherBlend.lightning = target.lightning;
      const s = skyAt(hour, { palette: config.palette, phases: timeCfg.phases, tiltDeg: config.sunTilt });
      const wl = weatherBlend.light, grey = [0.55, 0.58, 0.62];
      const tint = weatherBlend.tint ? c => c.map((v, i) => v * weatherBlend.tint[i]) : c => c;
      const zen = tint(mixRgb(s.zenith, mixRgb(grey, s.zenith, 0.3).map(v => v * (0.4 + 0.6 * s.day)), 1 - wl));
      const hor = tint(mixRgb(s.horizon, mixRgb(grey, s.horizon, 0.4).map(v => v * (0.45 + 0.55 * s.day)), (1 - wl) * 1.1));
      srgb(uniforms.uZenith.value, zen); srgb(uniforms.uHorizon.value, hor);
      srgb(uniforms.uGround.value, hor.map(v => v * 0.55));
      uniforms.uSunDir.value.set(...s.sun); uniforms.uMoonDir.value.set(...s.moon); srgb(uniforms.uSunColor.value, s.sunColor.map(v => v * wl));
      uniforms.uNight.value = s.night; uniforms.uDay.value = s.day; uniforms.uTime.value = ctx.time;
      uniforms.uClouds.value = Math.max(config.clouds, weatherBlend.clouds);
      srgb(uniforms.uCloudLit.value, mixRgb([0.35, 0.38, 0.48], [1, 0.98, 0.95], s.day).map(v => v * (0.55 + 0.45 * wl)));
      srgb(uniforms.uCloudDark.value, mixRgb([0.12, 0.13, 0.2], [0.62, 0.66, 0.74], s.day).map(v => v * (0.5 + 0.5 * wl)));
      // Lightning.
      if (weatherBlend.lightning) { nextBolt -= ctx.dt; if (nextBolt <= 0) { flash = 1; nextBolt = 3 + ((Math.sin(ctx.time * 91.7) + 1) * 4); } }
      flash *= Math.exp(-ctx.dt * 7); uniforms.uFlash.value = flash * 0.6;
      const far = stage.camera.far * 0.95; dome.scale.setScalar(far); dome.position.copy(stage.camera.position);
      // Lights: sun by day, moon by night, ambient from the sky.
      const sunUp = s.sun[1] > -0.05;
      stage.sunDir.set(...(sunUp ? s.sun : s.moon));
      srgb(stage.sun.color, (sunUp ? s.sunColor : [0.55, 0.65, 0.9]));
      stage.sun.intensity = (sunUp ? 2.6 * smoothstep(-0.05, 0.25, s.sun[1]) : 0.35 * smoothstep(-0.05, 0.3, s.moon[1])) * wl + flash * 3;
      srgb(stage.hemi.color, zen.map(v => Math.min(1, v * 1.1 + 0.08)));
      srgb(stage.hemi.groundColor, hor.map(v => v * 0.45));
      stage.hemi.intensity = 0.35 + 0.95 * s.day * (0.6 + 0.4 * wl) + 0.15 * s.night + flash;
      // Fog matched to the horizon: terrain-defined linear fog wins, tinted by the hour.
      const fogRgb = hor.map((v, i) => v * 0.85 + zen[i] * 0.15);
      const lin = stage.fogLinear;
      if (lin) {
        if (!linearFog) { linearFog = new THREE.Fog('#a8b8c8', lin.near, lin.far); }
        const base = hexRgb(lin.color || '#a8b8c8');
        srgb(linearFog.color, mixRgb(base, fogRgb, 0.55).map(v => v * (0.35 + 0.65 * Math.max(s.day, 0.2))));
        const off = stage.fogOffset ?? 0;
        linearFog.near = off + lin.near / weatherBlend.fog; linearFog.far = off + lin.far / Math.sqrt(weatherBlend.fog);
        stage.scene.fog = linearFog;
      } else {
        srgb(fog.color, fogRgb); fog.density = config.fogDensity * weatherBlend.fog * (stage.fogScale ?? 1); stage.scene.fog = fog;
      }
      stage.skyState = { ...s, zenith: zen, horizon: hor, fog: fogRgb, weather: wid, wet: weatherBlend.amount };
      // Precipitation.
      const kind = config.precipitation ? weatherBlend.precip : null, amt = weatherBlend.amount;
      precip.visible = !!kind && amt > 0.03 && !stage.indoors;
      if (precip.visible) {
        const n = Math.floor(COUNT * Math.min(1, amt)), c = stage.camera.position, box = 26;
        precipGeo.setDrawRange(0, n * 2);
        srgb(precipMat.color, (kind === 'rain' ? [0.7, 0.78, 0.9] : kind === 'snow' ? [1, 1, 1] : [0.45, 0.4, 0.38]));
        precipMat.opacity = kind === 'rain' ? 0.45 : 0.85;
        const fall = kind === 'rain' ? 18 : kind === 'snow' ? 1.6 : 1.1, len = kind === 'rain' ? 0.55 : 0.07;
        for (let i = 0; i < n; i++) {
          const sx = seeds[i * 3], sy = seeds[i * 3 + 1], sz = seeds[i * 3 + 2];
          const x = c.x + ((sx * box * 2 - c.x) % (box * 2) + box * 2) % (box * 2) - box;
          const z = c.z + ((sz * box * 2 - c.z) % (box * 2) + box * 2) % (box * 2) - box;
          const y = c.y + 14 - (((ctx.time * fall * (0.8 + sy * 0.4) + sy * 28) % 28));
          const drift = kind === 'rain' ? 0.12 : Math.sin(ctx.time * 1.3 + i) * 0.4;
          pos[i * 6] = x + drift; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
          pos[i * 6 + 3] = x + drift * 1.5 + (kind === 'rain' ? 0.04 : 0.05); pos[i * 6 + 4] = y - len; pos[i * 6 + 5] = z + (kind === 'rain' ? 0 : 0.05);
        }
        precipGeo.attributes.position.needsUpdate = true;
      }
    }, 'graphics.sky');
  },
};
