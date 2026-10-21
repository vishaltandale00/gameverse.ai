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
import { BONE, color, rigClips, modelsData, docExample } from './model-lib.js';

const PRESET_NAMES = ['fighter', ...Object.keys(BONE_PRESETS)];

/** Errors for a bone list: duplicates, parents that do not precede, clip keys naming unknown bones (the clip states are declared: rigClips). */
export function checkBones(bones = [], clips = {}, path = 'bones') {
  const errs = [], seen = new Set();
  (Array.isArray(bones) ? bones : []).forEach((b, i) => {
    if (!b?.id) return;
    if (seen.has(b.id)) errs.push({ code: 'flat_bone_duplicate', path: `${path}[${i}].id`, message: `duplicate bone '${b.id}'` });
    if (b.parent && !seen.has(b.parent)) errs.push({ code: 'flat_bone_parent', path: `${path}[${i}].parent`, message: `parent '${b.parent}' must be defined before '${b.id}'` });
    seen.add(b.id);
  });
  for (const [state, clip] of Object.entries(clips && typeof clips === 'object' ? clips : {})) {
    (Array.isArray(clip?.keys) ? clip.keys : []).forEach((k, j) => { for (const id of Object.keys(k?.pose || {})) if (!seen.has(id)) errs.push({ code: 'flat_clip_bone', path: `${path.replace(/bones$/, 'clips')}.${state}.keys[${j}]`, message: `unknown bone '${id}'` }); });
  }
  return errs;
}

export default {
  id: 'graphics.rig.custom',
  card: {
    intent: 'Cel-shaded 2D skeleton rigs: the humanoid fighter rig with full pose and move keyframes and outfit/hair/headwear looks, creature presets (serpent, spider, bird, tentacle), or author bone trees with keyframe pose clips per state.',
    views: ['side', 'td'],
    params: {
      rigs: { type: 'list', default: [], of: { type: 'object', open: true, fields: { id: { type: 'string', required: true }, preset: { type: 'string', options: PRESET_NAMES }, bones: { type: 'list', of: BONE }, palette: { type: 'object', values: color(), default: {} }, clips: rigClips(STATES, { default: {} }), look: { type: 'object', open: true, fields: { outfit: { type: 'string', options: OUTFITS }, hair: { type: 'string', options: HAIRS }, headwear: { type: 'string', options: HEADWEAR }, build: { type: 'string', options: BUILDS } }, effect: 'fighter look: outfit, hair, headwear, build plus skin/primary/secondary/accent/hairColor hexes' } } }, effect: 'named rigs models refer to' },
      bones: { type: 'list', default: [], of: BONE, effect: "a bone tree available as rig 'custom'" },
      archetypes: { type: 'object', default: {}, values: { type: 'string', effect: 'a rigs[] id, a preset or custom' }, effect: 'archetype id → rig id, for archetypes without a model' },
    },
    reads: ['content.models'],
    data: { 'content.models': modelsData(['kind', 'rig', 'preset', 'bones', 'clips', 'look', 'palette'], { states: STATES }) },
    rules: {
      flat_rig_duplicate: { fields: ['rigs[].id'], message: 'rig ids are unique among rigs (a rig may reuse a preset name to replace it)' },
      flat_rig_empty: { fields: ['rigs[].preset', 'rigs[].bones'], message: 'a rig has a preset or at least one bone' },
      flat_rig_unknown: { fields: ['archetypes', 'content.models.*.rig'], message: `a rig named by archetypes or a rig model is a rigs[] id, a preset (${PRESET_NAMES.join(', ')}), custom (with bones) or humanoid (models)`,
        example: { doc: { graphics: [{ use: 'graphics.rig.custom', with: { archetypes: { hero: 'no_such_rig' } } }] } } },
      flat_bone_duplicate: { fields: ['rigs[].bones[].id', 'bones[].id', 'content.models.*.bones[].id'], message: 'bone ids are unique in their bone tree',
        example: { doc: { graphics: [{ use: 'graphics.rig.custom', with: { bones: [{ id: 'root' }, { id: 'root' }] } }] } } },
      flat_bone_parent: { fields: ['rigs[].bones[].parent', 'bones[].parent', 'content.models.*.bones[].parent'], message: "a bone's parent is a bone listed before it",
        example: { doc: { graphics: [{ use: 'graphics.rig.custom', with: { bones: [{ id: 'tip', parent: 'root' }, { id: 'root' }] } }] } } },
      flat_clip_bone: { fields: ['rigs[].clips', 'content.models.*.clips'], message: "a clip key's pose names bones of the rig",
        example: { doc: { graphics: [{ use: 'graphics.rig.custom', with: { rigs: [{ id: 'worm', bones: [{ id: 'root' }], clips: { idle: { dur: 1, keys: [{ t: 0, pose: { tail: 10 } }] } } }] } }] } } },
    },
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
      if (typeof m.rig === 'string' && !m.bones && !ids.has(m.rig) && m.rig !== 'humanoid') errs.push({ code: 'flat_rig_unknown', path: `content.models.${id}.rig`, message: `unknown rig '${m.rig}'`, hint: [...ids].join(', ') });
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
