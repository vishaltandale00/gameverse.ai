// graphics.audio.synth: procedural sound for any document, with no assets.
// - Cues map game events to synthesized voices (art/audio.js voiceRecipe).
//   Built-in cues cover common events; document cues override the same event.
//   Typed events ('defeated:goblin') match their base cue without playing twice,
//   and each cue plays at most once per frame, after its cooldown.
// - Music entries pick adaptive stems by predicate, then by the player's zone,
//   then a default; switches are quantized to the next bar and crossfaded.
// - Browser only: install() returns at once without a DOM view, so headless
//   runs stay data-only. It never writes rt.state and never uses Math.random.
// The pure helpers (cueTable, scheduleCues, selectMusic, musicPlan, nextBar,
// uiRecipe) are exported for tests and other hosts.
import { uiHost, clamp, isNum } from './ui-lib.js';
import {
  voiceRecipe, createMixer, resolveMusic, nextBar, VOICE_NAMES, MOOD_NAMES, SCALE_NAMES, KEY_NAMES, INSTRUMENT_NAMES, DEFAULT_LAYERS,
} from '../../art/audio.js';

export { nextBar };
export const ID = 'graphics.audio.synth';

// ------------------------------------------------------------------ built-in cues
// rule: hurt (louder when the player is hurt), outcome (win/lose stinger),
// first_zone (only the player's first visit), rise (pitch climbs with count).
const D = (event, voice, pitch, gain, cooldown = 0.05, rule) => ({ event, voice, pitch, gain, cooldown, builtin: true, ...(rule ? { rule } : {}) });
export const DEFAULT_CUES = [
  D('jumped', 'blip', 520, 0.25), D('double_jumped', 'blip', 700, 0.25), D('landed', 'thud', 140, 0.22, 0.12), D('dashed', 'sweep', 260, 0.3, 0.1),
  D('hit', 'noise', 320, 0.4, 0.04), D('damaged', 'noise', 220, 0.3, 0.08, 'hurt'), D('healed', 'chord', 523, 0.3, 0.3),
  D('defeated', 'zap', 330, 0.4, 0.12), D('died', 'thud', 110, 0.45, 0.3), D('player_died', 'drone', 98, 0.6, 1),
  D('item_gained', 'coin', 880, 0.3), D('collected', 'coin', 988, 0.3, 0.03), D('bought', 'coin', 660, 0.35, 0.1), D('sold', 'coin', 523, 0.3, 0.1),
  D('crafted', 'bell', 660, 0.35, 0.15), D('equipped', 'pluck', 392, 0.3, 0.1), D('quest_started', 'bell', 440, 0.4, 0.5), D('quest_complete', 'chord', 392, 0.5, 0.5),
  D('objective_done', 'bell', 784, 0.35, 0.3), D('level_up', 'chord', 523, 0.55, 0.5), D('ability_unlocked', 'chord', 659, 0.5, 0.5), D('checkpoint_set', 'pad', 330, 0.4, 0.5),
  D('block_mined', 'noise', 180, 0.3), D('block_placed', 'thud', 300, 0.25), D('fired', 'zap', 600, 0.25, 0.06), D('parried', 'bell', 1320, 0.45, 0.08),
  D('blocked', 'thud', 200, 0.3, 0.08), D('boss_start', 'drone', 73, 0.55, 2), D('boss_defeated', 'chord', 392, 0.6, 1), D('game_end', 'chord', 523, 0.55, 1, 'outcome'),
  D('notify', 'blip', 988, 0.2, 0.2), D('discovered', 'bell', 587, 0.4, 0.5), D('dialogue_start', 'blip', 660, 0.15, 0.3), D('enter_zone', 'bell', 880, 0.2, 0.5, 'first_zone'),
  D('wave_start', 'sweep', 220, 0.4, 0.5), D('round_start', 'sweep', 330, 0.4, 0.5), D('turn_start', 'blip', 784, 0.18, 0.2), D('card_played', 'pluck', 523, 0.25),
  D('combo', 'blip', 660, 0.3, 0.03, 'rise'), D('chain', 'coin', 660, 0.3, 0.03, 'rise'),
];
const RISE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]; // major pentatonic climb, semitones

// UI sounds requested by other UI primitives through host.sound(name).
const UI = {
  move: { voice: 'blip', pitch: 1320, gain: 0.12, cooldown: 0.03 }, confirm: { voice: 'coin', pitch: 784, gain: 0.22, cooldown: 0.06 },
  back: { voice: 'blip', pitch: 520, gain: 0.14, cooldown: 0.05 }, open: { voice: 'sweep', pitch: 392, gain: 0.16, cooldown: 0.08 },
  close: { voice: 'sweep', pitch: 392, gain: 0.14, cooldown: 0.08, reverse: true }, error: { voice: 'zap', pitch: 180, gain: 0.2, cooldown: 0.15 },
  type: { voice: 'blip', pitch: 1800, gain: 0.05, cooldown: 0.045, decay: 0.018 },
};
const UI_ALIASES = { menu_move: 'move', menu_confirm: 'confirm' };
export const UI_SOUND_NAMES = Object.keys(UI);

/** Recipe and cooldown for a UI sound name, or null. 'type' is a very short, quiet blip (one per 45 ms). */
export function uiRecipe(name, seed = 'gameverse') {
  const spec = UI[UI_ALIASES[name] || name]; if (!spec) return null;
  const recipe = voiceRecipe(spec.voice, { pitch: spec.pitch, gain: spec.gain, seed, decay: spec.decay });
  if (spec.reverse) recipe.layers = recipe.layers.map(L => (L.f1 ? { ...L, f0: L.f1, f1: L.f0 } : L));
  return { recipe: { ...recipe, name: `ui:${UI_ALIASES[name] || name}`, priority: 3 }, cooldown: spec.cooldown };
}

// ------------------------------------------------------------------ card
const cueFields = {
  event: { type: 'string', required: true, effect: "event name; 'defeated' also matches 'defeated:goblin'" },
  voice: { type: 'string', default: 'blip', options: VOICE_NAMES, effect: 'synth voice' },
  pitch: { type: 'number', default: 440, min: 40, max: 8000, unit: 'Hz', effect: 'fundamental' },
  gain: { type: 'number', default: 0.4, min: 0, max: 1, effect: 'loudness' },
  cooldown: { type: 'number', default: 0.05, min: 0, max: 30, unit: 's', effect: 'minimum gap between plays of this cue' },
  when: { type: 'predicate', effect: 'play only while this holds (cues with a when are tried first)' },
};
const musicFields = {
  zone: { type: 'ref', to: 'zone', effect: "plays while the player is in this zone" },
  when: { type: 'predicate', effect: 'plays while this holds; beats zone entries' },
  mood: { type: 'string', options: MOOD_NAMES, effect: 'arrangement (drums, bass, density); default from the title and logline' },
  mode: { type: 'string', options: SCALE_NAMES, effect: 'scale or mode' },
  bpm: { type: 'number', min: 40, max: 200, unit: 'bpm', effect: 'tempo' },
  key: { type: 'string', options: KEY_NAMES, effect: 'tonic' },
  instrument: { type: 'string', options: INSTRUMENT_NAMES, effect: 'voice for lead, bass, pad and arp layers' },
  layers: { type: 'list', of: { type: 'string' }, min: 1, default: DEFAULT_LAYERS, effect: 'stems: bass perc drums synth drone strings choir organ pad pluck lute bell whistle horn radio wind surf drip lead arp piano brass ...' },
  priority: { type: 'integer', default: 0, effect: 'higher wins among matching when entries' },
};

export const card = {
  intent: 'Procedural sound with no assets: a cue map from game events to synthesized voices (built-in cues for common events, document cues override), plus adaptive music stems chosen by predicate or zone, switched on the bar with a crossfade. Silent and data-only headless.',
  views: ['any'],
  params: {
    cues: { type: 'list', default: [], of: { type: 'object', fields: cueFields }, effect: 'event -> voice map' },
    defaults: { type: 'boolean', default: true, effect: 'built-in cues for common events (jumped, hit, item_gained, quest_complete, level_up...)' },
    music: { type: 'list', default: [], of: { type: 'object', fields: musicFields }, effect: 'music entries; when beats zone beats an entry with neither' },
    mood: { type: 'string', options: MOOD_NAMES, effect: 'default mood for every entry' },
    tempo: { type: 'number', min: 40, max: 200, unit: 'bpm', effect: 'default tempo for every entry' },
    key: { type: 'string', options: KEY_NAMES, effect: 'default key for every entry' },
    instrument: { type: 'string', options: INSTRUMENT_NAMES, effect: 'default instrument for every entry' },
    volume: { type: 'object', default: { master: 1, music: 0.8, sfx: 1 }, effect: 'mix levels, multiplied by the player settings',
      fields: { master: { type: 'number', default: 1, min: 0, max: 1 }, music: { type: 'number', default: 0.8, min: 0, max: 1 }, sfx: { type: 'number', default: 1, min: 0, max: 1 } } },
    beatSync: { type: 'boolean', default: true, effect: 'follow beat.bpm and realign the music clock on bar events when engine.beat runs' },
    duck: { type: 'number', default: 0.3, min: 0, max: 1, effect: 'music level while paused (also lowpassed)' },
  },
  provides: { events: ['play_sound'] },
  rules: { audio_cue_duplicate: { fields: ['cues[].event', 'cues[].when'], message: 'cues without a when name distinct events (merge them, or give one a when)' } },
};

// ------------------------------------------------------------------ pure helpers
const normCue = c => ({ voice: 'blip', pitch: 440, gain: 0.4, cooldown: 0.05, ...c });

/** Merged cue map { event: [cue, ...] }: document cues (those with a when first), then built-ins for events the document does not name. */
export function cueTable(config = {}) {
  const table = Object.create(null);
  for (const c of config.cues || []) if (c && typeof c.event === 'string') (table[c.event] ??= []).push(normCue(c));
  for (const list of Object.values(table)) list.sort((a, b) => (b.when ? 1 : 0) - (a.when ? 1 : 0));
  if (config.defaults !== false) for (const c of DEFAULT_CUES) if (!table[c.event]) table[c.event] = [c];
  return table;
}

/** Evaluate a predicate without throwing: unknown kinds and missing runtimes are false. */
export function safeTest(rt, predicate, context = {}) {
  if (!rt?.logic?.kindOf?.(predicate)) return false;
  try { return Boolean(rt.test(predicate, context)); } catch { return false; }
}

const candidates = (name, subject) => {
  const i = name.indexOf(':');
  if (i > 0) return [name, name.slice(0, i)];
  return subject !== undefined && subject !== null ? [`${name}:${subject}`, name] : [name];
};
const whoOf = e => e.who ?? e.target ?? e.subject ?? e.id;

function applyRule(rule, play, e, rt) {
  switch (rule) {
    case 'hurt': return whoOf(e) === 'player' ? { ...play, pitch: play.pitch * 0.75, gain: clamp(play.gain * 2, 0, 1), voice: 'thud' } : play;
    case 'outcome': { const won = e.outcome === 'won' || e.outcome === 'win'; return won ? { ...play, sting: 'win' } : { ...play, voice: 'drone', pitch: 110, sting: 'lose' }; }
    case 'first_zone': {
      const zone = e.zone ?? e.subject ?? (e.name?.includes(':') ? e.name.slice(e.name.indexOf(':') + 1) : null);
      if ((e.who ?? 'player') !== 'player' || !zone || rt?.state?.counts?.[`enter_zone:${zone}`] !== 1) return null;
      return play;
    }
    case 'rise': {
      const n = [e.count, e.combo, e.chain, e.n, e.length].find(isNum) ?? 1;
      return { ...play, pitch: play.pitch * 2 ** (RISE[clamp(Math.floor(n) - 1, 0, RISE.length - 1)] / 12) };
    }
    default: return play;
  }
}

/**
 * Cue plays for one frame's events, as data: [{event, voice, pitch, gain, at, sting?}].
 * ctx = { time, last: {cue: time} (updated in place), rt?, table? }. A cue plays at
 * most once per call and only after its cooldown; typed events resolve to the most
 * specific cue ('defeated:boss', else 'defeated'); `play_sound {cue}` plays that cue
 * (or a bare voice name); cues whose `when` fails are skipped.
 */
export function scheduleCues(events, config = {}, ctx = {}) {
  const table = ctx.table || cueTable(config), time = isNum(ctx.time) ? ctx.time : 0, rt = ctx.rt;
  const last = ctx.last || (ctx.last = {});
  const played = new Set(), out = [];
  for (const e of events || []) {
    if (!e || typeof e.name !== 'string') continue;
    let names;
    if (e.name === 'play_sound') { if (typeof e.cue !== 'string') continue; names = candidates(e.cue); }
    else names = candidates(e.name, e.subject);
    const key = names.find(n => table[n]) ?? (e.name === 'play_sound' && VOICE_NAMES.includes(e.cue) ? e.cue : null);
    if (key === null || played.has(key)) continue;
    const cue = table[key] ? table[key].find(c => !c.when || safeTest(rt, c.when)) : normCue({ event: key, voice: key });
    if (!cue) continue;
    let play = { event: key, voice: cue.voice, pitch: cue.pitch, gain: cue.gain };
    if (cue.rule) { play = applyRule(cue.rule, play, e, rt); if (!play) continue; }
    const prev = last[key], cooldown = cue.cooldown ?? 0.05;
    if (prev !== undefined && time >= prev && time - prev < cooldown) continue;
    played.add(key); last[key] = time;
    out.push({ ...play, pitch: +play.pitch.toFixed(3), at: time });
  }
  return out;
}

const best = list => list.reduce((a, b) => ((b.e.priority ?? 0) > (a.e.priority ?? 0) ? b : a)).i;

/**
 * Active music entry index: matching `when` entries first (highest priority, then
 * document order), then the entry for the player's zone (rt.player().zone, or
 * .at in graph spaces), then an entry with neither zone nor when; else -1.
 */
export function selectMusic(rt, config = {}) {
  const entries = (config.music || []).map((e, i) => ({ e: e || {}, i }));
  if (!entries.length) return -1;
  const p = rt?.player?.(), zone = p ? (p.zone ?? (typeof p.at === 'string' ? p.at : null)) : null;
  const zoneOk = x => !x.e.zone || x.e.zone === zone;
  const byWhen = entries.filter(x => x.e.when && zoneOk(x) && safeTest(rt, x.e.when));
  if (byWhen.length) return best(byWhen);
  const byZone = zone ? entries.filter(x => !x.e.when && x.e.zone === zone) : [];
  if (byZone.length) return best(byZone);
  const plain = entries.filter(x => !x.e.when && !x.e.zone);
  return plain.length ? best(plain) : -1;
}

/** Music plan {mood, bpm, key, scale, instrument, layers} for an entry (or {} for the default). The mood comes from the doc title and logline when not given. */
export function musicPlan(entry, config = {}, doc = {}) {
  const e = entry || {};
  const base = resolveMusic({ id: doc?.id, title: doc?.title, pitch: doc?.logline }, { music: { mood: e.mood ?? config.mood, key: e.key ?? config.key, scale: e.mode, instrument: e.instrument ?? config.instrument } });
  const bpm = e.bpm ?? config.tempo;
  return {
    mood: base.mood, bpm: isNum(bpm) ? clamp(bpm, 40, 200) : base.tempo, key: base.key,
    scale: SCALE_NAMES.includes(e.mode) ? e.mode : base.scale, instrument: base.instrument,
    layers: [...(Array.isArray(e.layers) ? e.layers : DEFAULT_LAYERS)],
  };
}

// ------------------------------------------------------------------ primitive
function validate(config) {
  const errors = [];
  const seen = new Map();
  (config.cues || []).forEach((c, i) => {
    if (!c || c.when !== undefined || typeof c.event !== 'string') return;
    if (seen.has(c.event)) errors.push({ code: 'audio_cue_duplicate', path: `cues[${i}].event`, message: `cues[${i}] repeats event '${c.event}' from cues[${seen.get(c.event)}] without a when`, hint: 'merge them, or give one a when predicate' });
    else seen.set(c.event, i);
  });
  return errors;
}

// play_sound {cue} is owned by graphics.ui.feedback (ambient), so documents without audio can use it.

const MODES = ['title', 'play', 'pause', 'off'];

function install(rt, config) {
  const host = uiHost(rt); if (!host) return;
  const seed = String(rt.doc.id || rt.doc.title || 'gameverse');
  const mixer = createMixer({ seed, AudioContextImpl: globalThis.AudioContext || globalThis.webkitAudioContext, duck: config.duck });
  rt.view?.onDispose?.(() => mixer.dispose());
  const table = cueTable(config), vol = config.volume || {};
  let pending = [], last = {}, musicIdx, musicBpm, plan = null, mode = 'play', ended = false;

  const num = (v, d) => (isNum(v) ? v : d);
  const applySettings = (s = {}) => {
    mixer.setVolume({ master: num(vol.master, 1) * num(s.master, 1), music: num(vol.music, 0.8) * num(s.music, 1), sfx: num(vol.sfx, 1) * num(s.sfx, 1) });
    mixer.setMuted(Boolean(s.muted));
  };
  const applyMode = () => {
    if (!plan) return;
    if (mode === 'off' || ended) { mixer.stopMusic(); mixer.setPaused(false); return; }
    mixer.setMusic(plan, { variant: mode === 'title' ? 'title' : 'play' });
    mixer.setPaused(mode === 'pause');
  };
  const playUi = name => {
    const ui = uiRecipe(name, seed);
    if (ui) { mixer.playCue(ui.recipe, { key: ui.recipe.name, cooldown: ui.cooldown, priority: 3 }); return; }
    for (const p of scheduleCues([{ name: 'play_sound', cue: String(name) }], config, { time: rt.state.time, last, rt, table })) mixer.playCue(voiceRecipe(p.voice, { pitch: p.pitch, gain: p.gain, seed }), { key: p.event, cooldown: 0 });
  };
  const unlock = () => mixer.unlock();

  applySettings(host.settings);
  host.on('settings', applySettings);
  host.on('ui_sound', ({ name } = {}) => playUi(name));
  host.on('music', ({ mode: m } = {}) => { if (MODES.includes(m)) { mode = m; applyMode(); } });
  host.on('unlock', unlock);
  host.on('restarted', () => { pending = []; last = {}; ended = false; musicIdx = undefined; });
  const win = host.doc?.defaultView || globalThis.window;
  // The first gesture unlocks audio; the listeners go with it, or with the view if the game is unloaded first.
  const stops = [];
  const gesture = () => { if (unlock()) for (const stop of stops.splice(0)) stop(); };
  stops.push(host.listen(win, 'pointerdown', gesture, true), host.listen(win, 'keydown', gesture, true));
  // A page the person has already interacted with may start audio at once: a hot-loaded version (view.continuing)
  // keeps playing sound without waiting for another key.
  if (rt.view.continuing || globalThis.navigator?.userActivation?.hasBeenActive) gesture();

  // Collect every step's events (the host may run several steps per display frame).
  rt.on('*', e => { if (pending.length < 256) pending.push(e); });

  rt.view.onFrame(() => {
    if (pending.length) {
      const events = pending; pending = [];
      for (const p of scheduleCues(events, config, { time: rt.state.time, last, rt, table })) {
        if (p.sting) { ended = true; mixer.sting(p.sting, plan || musicPlan(null, config, rt.doc)); continue; }
        mixer.playCue(voiceRecipe(p.voice, { pitch: p.pitch, gain: p.gain, seed }), { key: p.event, cooldown: 0 });
      }
      if (config.beatSync && events.some(e => e.name === 'bar')) mixer.alignBar();
    }
    if (rt.state.status !== 'playing') { if (!ended) { ended = true; mixer.stopMusic(); } mixer.tick(); return; }
    if (ended) { ended = false; musicIdx = undefined; }
    const vars = rt.state.vars, bpm = config.beatSync && isNum(vars['beat.bpm']) && vars['beat.index'] !== undefined ? clamp(vars['beat.bpm'], 40, 200) : null;
    const idx = selectMusic(rt, config);
    if (idx !== musicIdx || bpm !== musicBpm) {
      musicIdx = idx; musicBpm = bpm;
      plan = musicPlan(config.music?.[idx], config, rt.doc);
      if (bpm) plan.bpm = bpm;
      applyMode();
    }
    mixer.tick();
  });
}

export default { id: ID, card, validate, install };
