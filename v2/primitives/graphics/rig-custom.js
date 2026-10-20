// graphics.rig.custom — 2D skeleton rigs for side and top-down renderers.
// Named rigs are either the humanoid fighter rig (full pose and move keyframe
// tables: guard, walk, jump, crouch, block, dash, hit, launch, knockdown, win,
// jab, kick, sweep, uppercut, fireball...) with an outfit/hair/headwear/build
// look, a procedural creature preset (serpent, spider, bird, tentacle), or an
// author-defined bone tree with keyframe pose clips per state. Models use one
// with { kind:'rig', rig:'<id>' }; `archetypes` assigns rigs directly.
import { hubOf } from './flat-stage.js';
import { BONE_PRESETS, OUTFITS, HAIRS, HEADWEAR, BUILDS } from './flat-rig.js';
import { STATES } from './flat-models.js';

const PRESET_NAMES = ['fighter', ...Object.keys(BONE_PRESETS)];
const SHAPES = ['limb', 'blob', 'head', 'segment', 'wing', 'spike', 'poly'];
const bone = { type: 'object', open: true, fields: {
  id: { type: 'string', required: true }, parent: { type: 'string' }, at: { type: 'list', of: { type: 'number' }, default: [0, 0], effect: 'offset from the parent tip (roots: from the feet), rig units, y down' },
  len: { type: 'number', default: 10, min: 0, max: 200 }, angle: { type: 'number', default: 0, unit: 'deg', effect: 'rest angle from straight down; + swings forward' },
  w: { type: 'number', default: 6, min: 0.5, max: 80 }, shape: { type: 'string', default: 'limb', options: SHAPES }, c: { type: 'string', effect: 'palette key or hex' }, z: { type: 'number', default: 0 },
  wave: { type: 'object', fields: { amp: { type: 'number', default: 10 }, freq: { type: 'number', default: 1 }, phase: { type: 'number', default: 0 } }, effect: 'procedural sway when no clip covers the state' },
} };

/** Errors for a bone list: duplicates, parents that do not precede, clip keys naming unknown bones. */
export function checkBones(bones = [], clips = {}, path = 'bones') {
  const errs = [], seen = new Set();
  bones.forEach((b, i) => {
    if (!b?.id) return;
    if (seen.has(b.id)) errs.push({ code: 'flat_bone_duplicate', path: `${path}[${i}].id`, message: `duplicate bone '${b.id}'` });
    if (b.parent && !seen.has(b.parent)) errs.push({ code: 'flat_bone_parent', path: `${path}[${i}].parent`, message: `parent '${b.parent}' must be defined before '${b.id}'` });
    seen.add(b.id);
  });
  for (const [state, clip] of Object.entries(clips || {})) {
    if (!STATES.includes(state)) errs.push({ code: 'flat_anim_state', path: `${path.replace(/bones$/, 'clips')}.${state}`, message: `unknown state '${state}'` });
    (clip?.keys || []).forEach((k, j) => { for (const id of Object.keys(k.pose || {})) if (!seen.has(id)) errs.push({ code: 'flat_clip_bone', path: `${path.replace(/bones$/, 'clips')}.${state}.keys[${j}]`, message: `unknown bone '${id}'` }); });
  }
  return errs;
}

export default {
  id: 'graphics.rig.custom',
  card: {
    intent: 'Cel-shaded 2D skeleton rigs: the humanoid fighter rig with full pose and move keyframes and outfit/hair/headwear looks, creature presets (serpent, spider, bird, tentacle), or author bone trees with keyframe pose clips per state.',
    views: ['side', 'td'],
    params: {
      rigs: { type: 'list', default: [], of: { type: 'object', open: true, fields: { id: { type: 'string', required: true }, preset: { type: 'string', options: PRESET_NAMES }, bones: { type: 'list', of: bone }, palette: { type: 'object', open: true, default: {} }, clips: { type: 'object', open: true, default: {}, effect: 'state → { dur s, loop, keys:[{ t s, pose:{ bone: deg } }] }' }, look: { type: 'object', open: true, fields: { outfit: { type: 'string', options: OUTFITS }, hair: { type: 'string', options: HAIRS }, headwear: { type: 'string', options: HEADWEAR }, build: { type: 'string', options: BUILDS } }, effect: 'fighter look: outfit, hair, headwear, build plus skin/primary/secondary/accent/hairColor hexes' } } }, effect: 'named rigs models refer to' },
      bones: { type: 'list', default: [], of: bone, effect: "a bone tree available as rig 'custom'" },
      archetypes: { type: 'object', default: {}, open: true, effect: 'archetype id → rig id, for archetypes without a model' },
    },
    reads: ['content.models'],
  },
  validate(config, doc) {
    const errs = [], ids = new Set(PRESET_NAMES);
    config.rigs.forEach((r, i) => {
      if (ids.has(r.id) && !PRESET_NAMES.includes(r.id)) errs.push({ code: 'flat_rig_duplicate', path: `rigs[${i}].id`, message: `duplicate rig '${r.id}'` });
      ids.add(r.id);
      if (!r.preset && !r.bones?.length) errs.push({ code: 'flat_rig_empty', path: `rigs[${i}]`, message: `rig '${r.id}' needs a preset or bones` });
      errs.push(...checkBones(r.bones || [], r.clips, `rigs[${i}].bones`));
    });
    if (config.bones.length) { ids.add('custom'); errs.push(...checkBones(config.bones, {}, 'bones')); }
    for (const [a, r] of Object.entries(config.archetypes)) if (!ids.has(r)) errs.push({ code: 'flat_rig_unknown', path: `archetypes.${a}`, message: `unknown rig '${r}'`, hint: [...ids].join(', ') });
    for (const [id, m] of Object.entries(doc.content?.models || {})) {
      if (m?.kind !== 'rig') continue;
      if (m.rig && !m.bones && !ids.has(m.rig) && m.rig !== 'humanoid') errs.push({ code: 'flat_rig_unknown', path: `content.models.${id}.rig`, message: `unknown rig '${m.rig}'`, hint: [...ids].join(', ') });
      if (m.bones) errs.push(...checkBones(m.bones, m.clips, `content.models.${id}.bones`));
    }
    return errs;
  },
  install(rt, config) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt);
    const rigs = Object.fromEntries(config.rigs.map(r => [r.id, r]));
    if (config.bones.length) rigs.custom = { id: 'custom', bones: config.bones };
    H.cfg.rig = { rigs, archetypes: config.archetypes };
    H.looks?.clear();
  },
};
