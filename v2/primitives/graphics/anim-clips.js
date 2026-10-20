// graphics.anim.clips: procedural and authored keyframe clips (idle, attack
// swings and combos, hurt, die, emotes, interact, mount, drink, casting...)
// with frame events (hit, step, release, land, thud) emitted as presentation
// events ('gv:anim' on the view container). Gameplay events trigger clips on
// the entity they name (attack -> combo chain, hurt, defeated -> die...).
import { joinStage, presentationOnly } from './three-stage.js';
import { resolvePreset, PRESETS } from './three-anim.js';

export default {
  id: 'graphics.anim.clips',
  card: {
    intent: 'Animation clips for rigged characters: a procedural preset library (idle, walk, run, sprint, jump, fall, land, swing, light_attack_1..3, heavy_attack, mine, place, shoot, aim, bow_draw/release, sign_cast, block_idle, parry, dodge_roll, hurt, die, talk, wave, sit, meditate, drive, ride_walk/gallop, mount/dismount, climb_up/idle, swim, glide_pose, drink, cook, interact, victory; quadruped idle/walk/run/sprint/jump/hurt/die/eat/attack) plus authored keyframe clips, with frame events, triggered by gameplay events.',
    views: ['1p', '3p', 'iso', 'td'],
    params: {
      presets: { type: 'list', of: { type: 'string' }, default: ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'swing', 'hurt', 'die', 'talk'], effect: 'preset clip names to use; unknown names resolve by keyword (e.g. "spin_slash" -> attack)' },
      clips: { type: 'list', default: [], effect: 'authored clips', of: { type: 'object', fields: {
        id: { type: 'string', required: true }, rig: { type: 'string', options: ['humanoid', 'quadruped', 'custom'], default: 'humanoid' },
        dur: { type: 'number', required: true, min: 0.05, max: 30, unit: 's' }, loop: { type: 'boolean', default: false },
        keys: { type: 'json', required: true, effect: '{ bone: [[t, rx, ry, rz], ...] } radians, offsets from rest; $root: [[t, x, y, z]]' },
        events: { type: 'list', default: [], of: { type: 'object', fields: { t: { type: 'number', required: true, min: 0 }, event: { type: 'string', required: true } } } },
      } } },
      triggers: { type: 'list', default: [], effect: 'extra gameplay event -> clip bindings', of: { type: 'object', fields: {
        event: { type: 'string', required: true }, clip: { type: 'string', required: true }, who: { type: 'string', default: 'who', effect: 'event field naming the entity' },
      } } },
    },
    provides: {},
  },
  validate(config) {
    const errs = [];
    config.presets.forEach((name, i) => { if (!resolvePreset(name, 'humanoid') && !resolvePreset(name, 'quadruped')) errs.push({ code: 'clip_unknown', path: `presets[${i}]`, message: `no preset or keyword match for '${name}'`, hint: `presets: ${PRESETS.humanoid.join(', ')}` }); });
    (config.clips || []).forEach((c, i) => {
      if (!c.keys || typeof c.keys !== 'object' || Array.isArray(c.keys)) { errs.push({ code: 'clip_keys', path: `clips[${i}].keys`, message: 'keys must be { bone: [[t, rx, ry, rz], ...] }' }); return; }
      for (const [bone, list] of Object.entries(c.keys)) if (!Array.isArray(list) || list.some(k => !Array.isArray(k) || k.length !== 4 || k.some(v => !Number.isFinite(v)) || k[0] < 0 || k[0] > c.dur)) errs.push({ code: 'clip_keys', path: `clips[${i}].keys.${bone}`, message: 'each key is [t, rx, ry, rz] with 0 <= t <= dur' });
      (c.events || []).forEach((e, j) => { if (e.t > c.dur) errs.push({ code: 'clip_event_time', path: `clips[${i}].events[${j}].t`, message: `event at ${e.t}s is after the clip ends (${c.dur}s)` }); });
    });
    return errs;
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    for (const c of config.clips) for (const list of Object.values(c.keys)) list.sort((a, b) => a[0] - b[0]);
    stage.anim.clips = { presets: config.presets, authored: config.clips.map(c => ({ ...c, events: (c.events || []).map(e => ({ ...e })) })), triggers: config.triggers };
    if (stage.animator) stage.animator.clips.clear();
  },
};
