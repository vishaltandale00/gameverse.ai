// graphics.material.palette: block and surface colors, per-face shade and the
// texture-free styles every 3D renderer shares (flat, noise = per-texel value
// noise like pixel textures, bevel = darkened block edges, toon = banded
// light). Emissive blocks/keys glow (and bloom when graphics.post is on).
// Without an instance in the document, renderers use paletteFor()'s default.
import { joinStage, presentationOnly } from './three-stage.js';
import { colorOf, hash01, isHex } from './three-util.js';
import { color, blocksData } from './model-lib.js';

export const STYLES = ['flat', 'noise', 'bevel', 'toon'];
const DEFAULT = { colors: {}, faceShade: [1, 0.6, 0.8], style: 'flat', emissive: [], glow: 1.6 };

// Name-based fallbacks so an unknown block id still reads as what it is.
const GUESS = [
  [/grass|lawn|moss/, '#5a9a3a'], [/dirt|soil|mud|farm/, '#7a5a3a'], [/sand|beach|dune/, '#e0d090'], [/snow|ice|frost/, '#eef4fa'],
  [/water|sea|lake|river/, '#2a6ad8'], [/lava|magma/, '#ff6a1a'], [/stone|rock|cobble|gravel|slate/, '#7a7a7a'], [/log|wood|plank|timber|bark/, '#8a6a3a'],
  [/leaf|leaves|foliage/, '#3a7a2a'], [/glass|window/, '#c8e8f0'], [/brick/, '#a8503a'], [/concrete|cement/, '#9a9aa0'], [/asphalt|road|tar/, '#2e2e34'],
  [/metal|steel|iron|beam/, '#6a707a'], [/gold/, '#e8c030'], [/copper/, '#c87a4a'], [/coal/, '#3a3a3a'], [/crystal|gem|diamond/, '#4ae8e8'],
  [/clay|terracotta/, '#b8704a'], [/ash|basalt|obsidian/, '#2a2428'], [/wool|cloth/, '#e8e8e8'], [/neon/, '#ff4ad8'], [/lamp|light|torch/, '#ffe8a0'],
];
export function guessColor(id) { for (const [re, c] of GUESS) if (re.test(id)) return c; const h = hash01(id) * 360; return `hsl(${h},30%,50%)`; }
const hslToHex = s => { const m = /hsl\(([\d.]+),([\d.]+)%,([\d.]+)%\)/.exec(s); if (!m) return s; const [h, sat, l] = [+m[1] / 360, +m[2] / 100, +m[3] / 100]; const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q; const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; return '#' + [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''); };

/** Block shape for the mesher from its definition: cross for plants/crops, flat for rails, panel for ladders/doors. */
export function blockShape(def = {}) {
  const tags = def.tags || [], id = def.id || '';
  if (tags.includes('crop') || tags.includes('plant') || /flower|crop|wheat|sapling|tall_grass|fern|reed/.test(id)) return 'cross';
  if (tags.includes('rail') || /rail|carpet|pressure/.test(id)) return 'flat';
  if (tags.includes('climbable') || tags.includes('door') || /ladder|door|vine|sign/.test(id)) return 'panel';
  return 'cube';
}

/** Pure palette description (testable): block id -> mesher material. */
export function blockMaterialOf(id, def, cfg) {
  const hex = cfg.colors?.[id] ?? (isHex(def?.color) ? def.color : hslToHex(guessColor(id)));
  const liquid = def?.tags?.includes('liquid') || /water|lava/.test(id);
  const transparent = !!def?.transparent || (liquid && !/lava/.test(id));
  const shape = blockShape({ ...def, id });
  const emissive = cfg.emissive?.includes(id) || def?.tags?.includes('emissive') ? 1 : def?.light ? Math.min(1, def.light / 15) : 0;
  const alpha = shape !== 'cube' ? 1 : /glass|window|ice/.test(id) ? 0.38 : liquid && transparent ? 0.72 : transparent ? 0.96 : 1;
  return { id, hex, color: colorOf(hex), opaque: !transparent && shape === 'cube', alpha, emissive, shape, liquid };
}

/** Create the palette service (materials + block lookups) for a stage. */
export function createPalette(stage, config = {}) {
  const cfg = { ...DEFAULT, ...config };
  const THREE = stage.THREE;
  const blockDefs = () => new Map((stage.rt.doc.content?.blocks || []).map(b => [b.id, b]));
  let defs = null, docRef = null;
  const blockCache = new Map();
  const toon = (() => { const d = new Uint8Array([70, 70, 70, 255, 150, 150, 150, 255, 255, 255, 255, 255]); const t = new THREE.DataTexture(d, 3, 1); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
  const uniforms = { uGlow: { value: cfg.glow }, uTime: { value: 0 } };
  stage.hook('pre', ctx => { uniforms.uTime.value = ctx.time; }, 'graphics.material.palette');

  function patch(mat, { world = false, style = cfg.style } = {}) {
    mat.onBeforeCompile = shader => {
      shader.uniforms.uGlow = uniforms.uGlow; shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = 'attribute float emissiveMask;\nattribute float alphaMask;\nvarying float vEm;\nvarying float vAl;\nvarying vec3 vWPos;\nvarying vec3 vONrm;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vEm = emissiveMask; vAl = alphaMask; vONrm = normal;\n  vWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      let frag = 'uniform float uGlow;\nuniform float uTime;\nvarying float vEm;\nvarying float vAl;\nvarying vec3 vWPos;\nvarying vec3 vONrm;\n' +
        'float gvHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\n' + shader.fragmentShader;
      let styleCode = '';
      if (world && style === 'noise') styleCode = `
  { vec3 cell = floor(vWPos - vONrm * 0.5); vec3 tex = floor((vWPos - vONrm * 0.01) * 8.0);
    float n = (gvHash(cell) - 0.5) * 0.08 + (gvHash(tex) - 0.5) * 0.14; diffuseColor.rgb *= 1.0 + n; }`;
      if (world && style === 'bevel') styleCode = `
  { vec3 f = fract(vWPos); vec3 a = abs(vONrm); vec2 uv = a.x > 0.5 ? f.yz : a.y > 0.5 ? f.xz : f.xy;
    vec2 e = min(uv, 1.0 - uv); float edge = smoothstep(0.0, 0.07, min(e.x, e.y));
    diffuseColor.rgb *= mix(0.72, 1.0, edge) * (1.0 + (gvHash(floor(vWPos - vONrm * 0.5)) - 0.5) * 0.06); }`;
      frag = frag.replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.a *= vAl;${styleCode}`);
      frag = frag.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vEm * uGlow * (0.92 + 0.08 * sin(uTime * 7.0 + vWPos.x * 3.1 + vWPos.z * 2.3));');
      shader.fragmentShader = frag;
    };
    mat.customProgramCacheKey = () => `gv:${world}:${style}:${mat.type}`;
    return mat;
  }
  const make = (opts, kind) => {
    const base = { vertexColors: true, ...opts };
    if (cfg.style === 'toon') { const { flatShading, ...rest } = base; void flatShading; return new THREE.MeshToonMaterial({ ...rest, gradientMap: toon }); }
    if (kind === 'metal') return new THREE.MeshStandardMaterial({ ...base, roughness: 0.38, metalness: 0.65 });
    if (kind === 'world') return new THREE.MeshLambertMaterial(base);
    return new THREE.MeshStandardMaterial({ ...base, roughness: 0.82, metalness: 0.02 });
  };
  const cache = {};
  const palette = {
    config: cfg, faceShade: cfg.faceShade, style: cfg.style, emissiveKeys: new Set(cfg.emissive), uniforms,
    /** Mesher material for a block id. */
    block(id) {
      if (docRef !== stage.rt.doc) { docRef = stage.rt.doc; defs = blockDefs(); blockCache.clear(); }
      let m = blockCache.get(id);
      if (!m) { const def = stage.spaceDef?.(id) || defs.get(id); m = blockMaterialOf(id, def, cfg); blockCache.set(id, m); }
      return m;
    },
    /** [opaque, transparent] materials for voxel chunks and terrain. */
    worldMaterials() {
      return cache.world ??= [
        patch(make({ flatShading: true }, 'world'), { world: true }),
        patch(make({ transparent: true, depthWrite: false, side: THREE.DoubleSide, flatShading: true }, 'world'), { world: true }),
      ];
    },
    /** [matte, metal, transparent] for models (order = three-geometry MATERIAL_CLASSES). */
    actorMaterials({ skinned = false } = {}) {
      const key = skinned ? 'skinned' : 'static';
      const flat = stage.models?.configs?.lowpoly?.flatShade ?? true;
      return cache[key] ??= [
        patch(make({ flatShading: flat }, 'matte'), { style: 'flat' }),
        patch(make({ flatShading: flat }, 'metal'), { style: 'flat' }),
        patch(make({ flatShading: flat, transparent: true, depthWrite: false }, 'matte'), { style: 'flat' }),
      ];
    },
    patch,
  };
  return palette;
}

/** The stage's palette, creating the default one when no graphics.material.palette instance exists. */
export function paletteFor(stage) { return stage.palette ??= createPalette(stage, {}); }

export default {
  id: 'graphics.material.palette',
  card: {
    intent: 'Block and surface colors, per-face shade and texture-free styles for 3D worlds and models: flat, noise (pixel-texture value noise), bevel (darkened block edges), toon (banded light); emissive blocks and color keys glow.',
    views: ['1p', '3p', 'iso', 'td'],
    params: {
      colors: { type: 'object', values: color(), default: {}, effect: 'block id or color key -> #hex, overriding content.blocks colors' },
      faceShade: { type: 'list', of: { type: 'number', min: 0, max: 1.5 }, min: 3, max: 3, default: [1, 0.6, 0.8], effect: '[top, x-faces, z-faces] brightness; bottom faces get half the darker side' },
      style: { type: 'string', options: STYLES, default: 'flat', effect: 'surface treatment' },
      emissive: { type: 'list', of: { type: 'string' }, default: [], effect: 'block ids or palette color keys that glow' },
      glow: { type: 'number', default: 1.6, min: 0, max: 8, effect: 'emissive strength' },
    },
    provides: {},
    reads: ['content.blocks'],
    data: { 'content.blocks': blocksData(['color', 'tags', 'transparent', 'light']) },
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    stage.palette = createPalette(stage, config);
  },
};
