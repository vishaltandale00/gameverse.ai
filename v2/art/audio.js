// Procedural sound with no assets and no dependencies: sfxr-style effects,
// cue voices, a procedural music loop split into adaptive stems, and two
// WebAudio players (createAudio for the arcade kits, createMixer for
// graphics.audio.synth).
//
// The pure helpers (resolveMusic, composeLoop, composeStems, composeSting,
// sfxRecipe, voiceRecipe, stemsFor) turn a spec into note events and effect
// recipes; they run in Node and are what tests check. The players create the
// AudioContext lazily in unlock(), so nothing is built or heard before a user
// gesture (browser autoplay rule).
import { seedFrom, random } from '../kernel/rng.js';

export const EVENT_NAMES = ['jump', 'land', 'collect', 'hurt', 'stomp', 'shoot', 'hit', 'defeated', 'reach_goal', 'time_up', 'fell', 'spawn'];
export const UI_SOUNDS = ['menu_move', 'menu_confirm'];

const PITCH = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], pentatonic: [0, 2, 4, 7, 9], pentatonicMinor: [0, 3, 5, 7, 10],
  // Modal names used by documents (ionian = major, aeolian = natural minor).
  ionian: [0, 2, 4, 5, 7, 9, 11], aeolian: [0, 2, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10], locrian: [0, 1, 3, 5, 6, 8, 10], harmonicMinor: [0, 2, 3, 5, 7, 8, 11], blues: [0, 3, 5, 6, 7, 10],
};
/** Key names accepted by every helper (sharps and flats). */
export const KEY_NAMES = Object.keys(PITCH);
export const SCALE_NAMES = Object.keys(SCALES);
const has = (obj, k) => typeof k === 'string' && Object.hasOwn(obj, k);
export const INSTRUMENT_NAMES = ['chip', 'synth', 'bell', 'pluck'];

// Each mood sets defaults plus the arrangement: chord progressions (scale
// degrees, one chord per bar) for the A and B sections, bass and drum
// patterns (16 steps per bar), melody density and an optional arpeggio.
const MOODS = {
  heroic: { tempo: 132, scale: 'major', instrument: 'chip', dark: false, words: /hero|knight|quest|brave|castle|sword|legend|kingdom|dragon|epic|valor|royal|warrior/,
    A: [[0, 4, 5, 3], [0, 5, 3, 4]], B: [[3, 4, 0, 5], [5, 3, 0, 4]], bass: 'octaves', drums: 'march', lead: 0.6, arp: 0 },
  mysterious: { tempo: 96, scale: 'dorian', instrument: 'bell', dark: true, words: /myster|cave|cavern|ancient|ruin|secret|lantern|hollow|well|cistern|deep|shadow|riddle|temple|tomb/,
    A: [[0, 3, 0, 6], [0, 1, 0, 3]], B: [[5, 6, 0, 3], [3, 6, 5, 4]], bass: 'long', drums: 'sparse', lead: 0.35, arp: 2, arpIn: 'B' },
  playful: { tempo: 124, scale: 'major', instrument: 'pluck', dark: false, words: /cute|candy|bunny|garden|bounce|fun|toy|jelly|puppy|kitten|cat|frog|duck|silly|party|sweet|coin|flower/,
    A: [[0, 3, 4, 0], [0, 5, 1, 4]], B: [[3, 0, 1, 4], [5, 1, 3, 4]], bass: 'walk', drums: 'bouncy', lead: 0.55, arp: 2, arpIn: 'B' },
  tense: { tempo: 148, scale: 'minor', instrument: 'synth', dark: true, words: /escape|chase|race|danger|survive|lava|volcano|fire|alarm|hunt|siege|collapse|countdown|storm/,
    A: [[0, 0, 5, 6], [0, 6, 5, 6]], B: [[3, 5, 4, 4], [5, 3, 6, 4]], bass: 'pulse', drums: 'driving', lead: 0.5, arp: 1, arpIn: 'all' },
  dreamy: { tempo: 84, scale: 'major', instrument: 'bell', dark: false, words: /dream|cloud|sky|float|moon|star|sleep|wish|fairy|bubble|glow|drift|aurora/,
    A: [[0, 3, 5, 3], [3, 0, 5, 1]], B: [[1, 4, 2, 5], [5, 3, 1, 4]], bass: 'long', drums: 'soft', lead: 0.3, arp: 2, arpIn: 'all' },
  spooky: { tempo: 100, scale: 'minor', instrument: 'bell', dark: true, words: /ghost|haunt|manor|skelet|witch|zombie|grave|crypt|spook|vampire|curse|night|bone|spider|pumpkin/,
    A: [[0, 5, 0, 1], [0, 3, 0, 5]], B: [[5, 1, 6, 4], [3, 1, 4, 4]], bass: 'creep', drums: 'creep', lead: 0.35, arp: 0 },
  energetic: { tempo: 156, scale: 'mixolydian', instrument: 'synth', dark: false, words: /blast|blaster|run|speed|rocket|neon|turbo|robot|laser|space|zoom|dash|cyber|power|arcade/,
    A: [[0, 6, 3, 0], [0, 3, 6, 3]], B: [[5, 6, 3, 0], [3, 6, 0, 4]], bass: 'pulse', drums: 'dance', lead: 0.65, arp: 1, arpIn: 'all' },
  melancholy: { tempo: 78, scale: 'minor', instrument: 'pluck', dark: true, words: /lonely|rain|lost|ember|autumn|quiet|sad|memory|last|fading|winter|grief|alone/,
    A: [[0, 5, 2, 6], [0, 3, 5, 4]], B: [[5, 3, 0, 4], [3, 6, 2, 5]], bass: 'long', drums: 'ballad', lead: 0.35, arp: 2, arpIn: 'B' },
};
export const MOOD_NAMES = Object.keys(MOODS);

// Bass: R root, F fifth (chord tone +4 scale steps), O octave, '.' rest.
const BASS = { octaves: 'R.O.R.O.R.O.R.O.', long: 'R.......F.......', walk: 'R...F...O...F...', pulse: 'R.R.R.R.R.R.R.R.', creep: 'R.....R.....F...' };
const DRUMS = {
  march: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
  sparse: { kick: 'x.........x.....', snare: '............x...', hat: '..x...x...x...x.' },
  bouncy: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: '..x...x...x...x.' },
  driving: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx' },
  dance: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.' },
  soft: { kick: 'x...............', snare: '................', hat: '....x.......x...' },
  creep: { kick: 'x.....x.........', snare: '........x.......', hat: '..x.....x.x...x.' },
  ballad: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x...x...x...x...' },
};
const DRUM_VEL = { kick: 0.9, snare: 0.55, hat: 0.35 };

// ---------------------------------------------------------------- helpers
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export function rngFrom(seed) { const state = { rng: seedFrom(seed) }; return () => random(state); }
const pick = (r, list) => list[Math.floor(r() * list.length)];
export const midiToHz = m => 440 * 2 ** ((m - 69) / 12);

/** Semitone offsets of the music's scale (pentatonic is minor for dark moods). */
export function scaleOf(music) {
  if (music.scale === 'pentatonic' && MOODS[music.mood]?.dark) return SCALES.pentatonicMinor;
  return has(SCALES, music.scale) ? SCALES[music.scale] : SCALES.major;
}
/** The pitch classes (0–11) every pitched note must belong to. */
export function pitchClasses(music) { return scaleOf(music).map(s => (s + PITCH[music.key]) % 12).sort((a, b) => a - b); }

function guessMood(text, r) {
  const words = text.toLowerCase();
  let best = null, score = 0;
  for (const [name, m] of Object.entries(MOODS)) {
    const n = (words.match(new RegExp(`\\b(?:${m.words.source})`, 'g')) || []).length;
    if (n > score) { best = name; score = n; }
  }
  return best || pick(r, ['playful', 'heroic', 'energetic', 'dreamy']);
}

/** Fill design.music defaults: mood from the title/pitch words, the rest from the mood and spec id. */
export function resolveMusic(spec, design) {
  const given = design?.music || spec?.music || {};
  const seed = String(spec?.id || design?.title || spec?.title || 'gameverse');
  const r = rngFrom(`${seed}:music`);
  const jitter = Math.round((r() - 0.5) * 12), keyGuess = pick(r, ['C', 'D', 'E', 'F', 'G', 'A']);
  const text = [spec?.title, spec?.pitch, design?.title, design?.pitch, design?.summary].filter(Boolean).join(' ');
  const mood = MOODS[given.mood] ? given.mood : guessMood(text, r);
  const m = MOODS[mood];
  return {
    mood,
    tempo: Number.isFinite(given.tempo) ? clamp(Math.round(given.tempo), 70, 170) : clamp(m.tempo + jitter, 70, 170),
    key: has(PITCH, given.key) ? given.key : keyGuess,
    scale: has(SCALES, given.scale) && given.scale !== 'pentatonicMinor' ? given.scale : m.scale,
    instrument: INSTRUMENT_NAMES.includes(given.instrument) ? given.instrument : m.instrument,
  };
}

// ---------------------------------------------------------------- music
// Note events: { t, dur } in beats from loop start, midi (pitched parts),
// vel 0..1, part: lead | bass | pad | arp | kick | snare | hat.

function makeMotif(r, density, busy) {
  const onsets = [0];
  for (let s = 1; s < 16; s++) {
    const chance = s % 4 === 0 ? density + 0.15 : s % 2 === 0 ? density : busy ? density * 0.25 : 0;
    if (r() < chance) onsets.push(s);
  }
  if (onsets.length < 2) onsets.push(8);
  const moves = onsets.map((_, i) => (i === 0 ? 0 : pick(r, [-2, -1, -1, 1, 1, 2, 0, 3, -3])));
  return { onsets, moves, anchor: pick(r, [0, 2, 4]) };
}

/** A 16- or 32-bar loop in A A B A form, deterministic per seed. variant 'title' is calmer and sparser. */
export function composeLoop(seed, musicIn, opts) { return composeResolved(seed, resolveMusic(null, { music: musicIn }), opts); }

// composeLoop on an already-resolved music direction (composeStems passes
// tempos and scales that resolveMusic would clamp or reject).
function composeResolved(seed, music, { variant = 'play' } = {}) {
  const mood = MOODS[music.mood] || MOODS.playful, title = variant === 'title';
  const scale = scaleOf(music), n = scale.length;
  const root = 48 + ((PITCH[music.key] + 6) % 12) - 6; // F#2..F3, so every key sits in the same register
  const note = (base, idx) => base + 12 * Math.floor(idx / n) + scale[((idx % n) + n) % n];
  const isChordTone = (idx, deg) => [0, 2, 4].includes((((idx - deg) % n) + n) % n);
  const bpm = title ? Math.round(music.tempo * 0.92) : music.tempo;
  // Loop for at least ~36 s so a minute of play hears it at most twice.
  const bars = (16 * 4 * 60) / bpm >= 36 ? 16 : 32, sectionBars = bars / 4;
  const r = rngFrom(`${seed}:loop:${music.mood}`);
  const progA = pick(r, mood.A).map(d => d % n), progB = pick(r, mood.B).map(d => d % n);
  const motifs = { A: [makeMotif(r, mood.lead, !mood.dark), makeMotif(r, mood.lead, false)], B: [makeMotif(r, mood.lead * 0.9, false), makeMotif(r, mood.lead, !mood.dark)] };
  const plan = title ? ['A', 'B'] : ['A', 'A', 'B', 'A'];
  const drums = DRUMS[mood.drums], events = [];
  const add = (t, dur, part, vel, midi) => events.push(midi === undefined ? { t, dur, part, vel } : { t, dur, part, vel, midi });

  plan.forEach((name, si) => {
    const prog = name === 'A' ? progA : progB, lastSection = si === plan.length - 1;
    for (let b = 0; b < sectionBars; b++) {
      const bar = si * sectionBars + b, t0 = bar * 4, deg = prog[b % prog.length];
      const chord = [0, 2, 4].map(o => note(root, deg + o));
      // Pad: the chord held for the bar.
      for (const m of chord) add(t0, 4, 'pad', title ? 0.6 : 0.5, m);
      // Bass from the mood's pattern, an octave below the root.
      [...BASS[mood.bass]].forEach((c, s, pat) => {
        if (c === '.') return;
        let next = s + 1; while (next < 16 && pat[next] === '.') next++;
        const idx = deg + (c === 'F' ? 4 : c === 'O' ? n : 0);
        add(t0 + s / 4, ((next - s) / 4) * 0.9, 'bass', s === 0 ? 0.9 : 0.75, note(root - 12, idx));
      });
      // Arpeggio of chord tones, an octave above the pad.
      if (mood.arp && !title && (mood.arpIn === 'all' || name === 'B')) {
        const tones = [0, 2, 4, n];
        for (let s = 0, i = 0; s < 16; s += mood.arp, i++) add(t0 + s / 4, mood.arp / 4, 'arp', s % 4 === 0 ? 0.7 : 0.5, note(root + 12, deg + tones[i % 4]));
      }
      // Lead: motif per bar, re-rooted on the chord; bar 4 of each phrase cadences.
      const cadence = b % 4 === 3, motif = motifs[name][b % 4 === 2 ? 1 : 0];
      // Start on a chord tone in the middle of the range; the second half of a long section lifts.
      const lift = b >= 4 ? 2 : 0, lo = 2, hi = 2 * n;
      let idx = n - 2 + ((((deg + motif.anchor + lift - n + 2) % n) + n) % n);
      const onsets = motif.onsets.filter(s => (!cadence || s < 8) && (!title || s % 4 === 0));
      if (cadence) onsets.push(8);
      onsets.forEach((s, i) => {
        if (cadence && s === 8) idx = n + deg + (lastSection && b === sectionBars - 1 ? 0 : 2);
        else idx += motif.moves[motif.onsets.indexOf(s)] || 0;
        if (idx > hi) idx = 2 * hi - idx;
        if (idx < lo) idx = 2 * lo - idx;
        if (s % 8 === 0 && !isChordTone(idx, deg)) idx += isChordTone(idx + 1, deg) ? 1 : -1;
        const end = i + 1 < onsets.length ? onsets[i + 1] : 16;
        add(t0 + s / 4, ((end - s) / 4) * 0.85, 'lead', (s % 4 === 0 ? 0.85 : 0.7) * (title ? 0.75 : 1), note(root + 12, idx));
      });
      // Drums: full in play, sparse in title; B opens the hats; fills end sections.
      for (let s = 0; s < 16; s++) {
        if (title) {
          if (s === 0 && bar % 2 === 0 && drums.kick[0] === 'x') add(t0, 0.25, 'kick', 0.6);
          if ((s === 4 || s === 12) && mood.drums !== 'soft') add(t0 + s / 4, 0.25, 'hat', 0.18);
          continue;
        }
        const fill = b === sectionBars - 1 && s >= 12 && (name === 'B' || lastSection);
        if (drums.kick[s] === 'x') add(t0 + s / 4, 0.25, 'kick', DRUM_VEL.kick);
        if (drums.snare[s] === 'x' || (fill && s % 2 === 0 && mood.drums !== 'soft')) add(t0 + s / 4, 0.25, 'snare', DRUM_VEL.snare * (fill ? 0.6 + (s - 12) * 0.1 : 1));
        if (drums.hat[s] === 'x' || (name === 'B' && s % 2 === 0 && mood.drums !== 'soft')) add(t0 + s / 4, 0.25, 'hat', DRUM_VEL.hat * (s % 4 === 0 ? 1 : 0.7));
      }
    }
  });
  events.sort((p, q) => p.t - q.t);
  return { bpm, bars: plan.length * sectionBars, beats: plan.length * sectionBars * 4, sections: plan.map((name, i) => ({ name, startBar: i * sectionBars, bars: sectionBars })), events };
}

/** Short win/lose stingers in the game's key: a rising tonic arpeggio or a falling resolve. */
export function composeSting(kind, musicIn) {
  const music = resolveMusic(null, { music: musicIn });
  const scale = scaleOf(music), n = scale.length, root = 60 + ((PITCH[music.key] + 6) % 12) - 6;
  const note = idx => root + 12 * Math.floor(idx / n) + scale[((idx % n) + n) % n];
  const steps = kind === 'win' ? [0, 2, 4, n] : [4, 3, 1, 0];
  const beat = 0.5, events = [];
  steps.forEach((idx, i) => {
    const last = i === steps.length - 1;
    events.push({ t: i * beat, dur: last ? 3 * beat : beat * 0.9, part: 'lead', vel: last ? 0.9 : 0.75, midi: note(idx) });
  });
  const end = steps.length - 1;
  for (const o of kind === 'win' ? [0, 2, 4] : [0, 2]) events.push({ t: end * beat, dur: 3 * beat, part: 'pad', vel: 0.7, midi: note(o) });
  events.push({ t: end * beat, dur: 3 * beat, part: 'bass', vel: 0.9, midi: note(0) - 24 });
  if (kind === 'win') events.push({ t: end * beat, dur: 0.25, part: 'kick', vel: 0.8 });
  // Stingers run a little faster than the loop and never longer than ~2.5 s.
  return { bpm: clamp(music.tempo * 1.1, 110, 190), beats: (end + 3) * beat, events };
}

// ---------------------------------------------------------------- effects
// Layer fields: wave (oscillator type or 'noise'), f0 → f1 Hz slide over
// slide × dur, at (s offset), dur (s), vol, attack, env ('decay' | 'hold'),
// optional lp/hp/bp filter Hz and q.
const SFX_RULES = {
  jump: { priority: 2, gap: 0.05 }, land: { priority: 1, gap: 0.15 }, collect: { priority: 3, gap: 0.03 },
  hurt: { priority: 4, gap: 0.25 }, stomp: { priority: 3, gap: 0.06 }, shoot: { priority: 1, gap: 0.06 },
  hit: { priority: 2, gap: 0.04 }, defeated: { priority: 5, gap: 0.5 }, reach_goal: { priority: 5, gap: 0.5 },
  time_up: { priority: 5, gap: 0.5 }, fell: { priority: 5, gap: 0.5 }, spawn: { priority: 0, gap: 0.1 },
  menu_move: { priority: 2, gap: 0.03 }, menu_confirm: { priority: 3, gap: 0.08 },
};
const STREAK = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]; // major pentatonic climb

/** Recipe for one effect, varied per game by seed. opts: streak (collect), air (jump), intensity (land). */
export function sfxRecipe(name, seed, { streak = 0, air = false, intensity = 1 } = {}) {
  if (!SFX_RULES[name]) return null;
  const r = rngFrom(`${seed}:sfx:${name}`);
  const v = (lo, hi) => lo + (hi - lo) * r();
  const b = 2 ** (Math.round(v(-3, 3)) / 12), len = v(0.88, 1.15);
  const bright = pick(r, ['square', 'square', 'triangle']), edge = pick(r, ['square', 'sawtooth']);
  const seq = (wave, ratios, gap, dur, vol, base) => ratios.map((k, i) => ({ wave, f0: base * k, at: i * gap, dur: i === ratios.length - 1 ? dur * 3 : dur, vol, env: 'decay' }));
  let layers;
  switch (name) {
    case 'jump': {
      const k = air ? 1.25 : 1;
      layers = [{ wave: bright, f0: 260 * b * k, f1: 640 * b * k * (air ? 1.15 : 1), slide: 0.7, dur: 0.16 * len, vol: 0.2, env: 'decay' }];
      if (air) layers.push({ wave: 'triangle', f0: 1300 * b, f1: 1900 * b, at: 0.03, dur: 0.1, vol: 0.06, env: 'decay' });
      break;
    }
    case 'land': {
      const k = clamp(intensity, 0.3, 1);
      layers = [{ wave: 'noise', lp: 500, dur: 0.07, vol: 0.22 * k, env: 'decay' }, { wave: 'sine', f0: 140 * b, f1: 55, dur: 0.08, vol: 0.28 * k, env: 'decay' }];
      break;
    }
    case 'collect': {
      const f = 880 * b * 2 ** (STREAK[Math.min(streak, STREAK.length - 1)] / 12), up = pick(r, [4 / 3, 3 / 2]);
      layers = [{ wave: bright, f0: f, dur: 0.06, vol: 0.13, env: 'hold' }, { wave: bright, f0: f * up, at: 0.06, dur: 0.2 * len, vol: 0.13, env: 'decay' }];
      break;
    }
    case 'hurt':
      layers = [{ wave: edge, f0: 520 * b, f1: 120 * b, dur: 0.28 * len, vol: 0.18, env: 'decay', lp: 2600 }, { wave: 'noise', bp: 1200, q: 0.8, dur: 0.12, vol: 0.18, env: 'decay' }];
      break;
    case 'stomp':
      layers = [{ wave: 'square', f0: 180 * b, f1: 70, dur: 0.1, vol: 0.24, env: 'decay' }, { wave: 'noise', lp: 1200, dur: 0.06, vol: 0.22, env: 'decay' },
        { wave: 'triangle', f0: 520 * b, f1: 1040 * b, at: 0.06, dur: 0.1, vol: 0.12, env: 'decay' }];
      break;
    case 'shoot':
      layers = [{ wave: edge, f0: v(900, 1300) * b, f1: 180 * b, dur: 0.11 * len, vol: 0.1, env: 'decay', lp: 4000 }];
      break;
    case 'hit':
      layers = [{ wave: 'noise', bp: 2400, q: 1.2, dur: 0.07, vol: 0.22, env: 'decay' }, { wave: 'square', f0: 640 * b, f1: 260 * b, dur: 0.08, vol: 0.11, env: 'decay' }];
      break;
    case 'defeated':
      layers = seq(bright, [1, 0.84, 0.707, 0.5], 0.12, 0.11, 0.16, 660 * b);
      layers[3].f1 = 330 * b * 0.6;
      break;
    case 'reach_goal':
      layers = [...seq(bright, [1, 1.26, 1.5, 2], 0.08, 0.1, 0.14, 523 * b), { wave: 'triangle', f0: 2093 * b, at: 0.24, dur: 0.35, vol: 0.06, env: 'decay' }];
      break;
    case 'time_up':
      layers = [0, 1, 2, 3].map(i => ({ wave: 'square', f0: (i % 2 ? 660 : 880) * b, at: i * 0.13, dur: 0.1, vol: 0.12, env: 'hold' }));
      break;
    case 'fell':
      layers = [{ wave: 'sine', f0: 1000 * b, f1: 140, dur: 0.7 * len, vol: 0.18, env: 'hold' }];
      break;
    case 'spawn':
      layers = [{ wave: 'sine', f0: 420 * b, f1: 840 * b, dur: 0.09, vol: 0.07, env: 'decay' }];
      break;
    case 'menu_move':
      layers = [{ wave: 'square', f0: 1320 * b, dur: 0.035, vol: 0.07, env: 'decay', lp: 5000 }];
      break;
    case 'menu_confirm':
      layers = [{ wave: 'square', f0: 660 * b, dur: 0.07, vol: 0.1, env: 'hold' }, { wave: 'square', f0: 990 * b, at: 0.07, dur: 0.14, vol: 0.1, env: 'decay' }];
      break;
  }
  return { name, ...SFX_RULES[name], layers };
}

// ---------------------------------------------------------------- playback
const RELEASE = 0.05;
const DRUM_LAYERS = {
  kick: [{ wave: 'sine', f0: 150, f1: 45, slide: 0.6, dur: 0.18, vol: 0.5, env: 'decay' }],
  snare: [{ wave: 'noise', bp: 1800, q: 0.7, dur: 0.12, vol: 0.16, env: 'decay' }, { wave: 'triangle', f0: 190, f1: 150, dur: 0.06, vol: 0.1, env: 'decay' }],
  hat: [{ wave: 'noise', hp: 7000, dur: 0.035, vol: 0.07, env: 'decay' }],
};
// Per instrument and part: layers with a frequency ratio; vol is scaled by note velocity.
const INSTRUMENTS = {
  chip: { lead: [{ wave: 'square', vol: 0.08, env: 'hold', lp: 3800 }], bass: [{ wave: 'triangle', vol: 0.3, env: 'hold' }],
    pad: [{ wave: 'triangle', vol: 0.035, env: 'hold', attack: 0.15 }], arp: [{ wave: 'square', vol: 0.03, env: 'decay', decay: 0.12, lp: 3000 }] },
  synth: { lead: [{ wave: 'sawtooth', vol: 0.05, env: 'hold', lp: 2400 }, { wave: 'sawtooth', vol: 0.04, env: 'hold', lp: 2400, detune: 9 }],
    bass: [{ wave: 'sawtooth', vol: 0.16, env: 'hold', lp: 420 }], pad: [{ wave: 'sawtooth', vol: 0.02, env: 'hold', attack: 0.25, lp: 900 }],
    arp: [{ wave: 'sawtooth', vol: 0.035, env: 'decay', decay: 0.14, lp: 1800 }] },
  bell: { lead: [{ wave: 'sine', vol: 0.15, env: 'decay', decay: 0.9 }, { wave: 'sine', ratio: 3, vol: 0.03, env: 'decay', decay: 0.35 }],
    bass: [{ wave: 'sine', vol: 0.34, env: 'hold' }], pad: [{ wave: 'sine', vol: 0.05, env: 'hold', attack: 0.3 }],
    arp: [{ wave: 'sine', vol: 0.06, env: 'decay', decay: 0.4 }, { wave: 'sine', ratio: 4, vol: 0.012, env: 'decay', decay: 0.15 }] },
  pluck: { lead: [{ wave: 'triangle', vol: 0.17, env: 'decay', decay: 0.4 }, { wave: 'sawtooth', vol: 0.035, env: 'decay', decay: 0.12, lp: 2000 }],
    bass: [{ wave: 'triangle', vol: 0.38, env: 'decay', decay: 0.55 }], pad: [{ wave: 'triangle', vol: 0.035, env: 'hold', attack: 0.2 }],
    arp: [{ wave: 'triangle', vol: 0.07, env: 'decay', decay: 0.18 }] },
};

function envelope(param, t, L) {
  const attack = L.attack ?? 0.004, peak = Math.max(0.0001, L.vol);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  if (L.env === 'hold') {
    param.linearRampToValueAtTime(peak * 0.8, t + Math.max(attack, L.dur));
    param.linearRampToValueAtTime(0, t + Math.max(attack, L.dur) + RELEASE);
    return t + Math.max(attack, L.dur) + RELEASE;
  }
  const end = t + attack + (L.decay ?? L.dur);
  param.exponentialRampToValueAtTime(0.0001, end);
  param.setValueAtTime(0, end);
  return end;
}

/** Play one layer into out at time t0; returns its end time. */
function playLayer(ctx, out, L, t0, noise) {
  const t = t0 + (L.at || 0);
  let src;
  if (L.wave === 'noise') { src = ctx.createBufferSource(); src.buffer = noise; src.loop = true; }
  else {
    src = ctx.createOscillator(); src.type = L.wave;
    src.frequency.setValueAtTime(L.f0, t);
    if (L.f1) src.frequency.exponentialRampToValueAtTime(L.f1, t + L.dur * (L.slide ?? 1));
    if (L.detune) src.detune.value = L.detune;
  }
  let node = src;
  for (const [type, hz] of [['lowpass', L.lp], ['highpass', L.hp], ['bandpass', L.bp]]) {
    if (!hz) continue;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; if (L.q) f.Q.value = L.q;
    node.connect(f); node = f;
  }
  const g = ctx.createGain();
  const end = envelope(g.gain, t, L) + 0.02;
  node.connect(g); g.connect(out);
  src.start(t); src.stop(end);
  src.onended = () => { try { g.disconnect(); } catch { /* already gone */ } };
  return end;
}

const MAX_VOICES = 8, LOOKAHEAD = 0.15, PUMP_MS = 30, LAND_MIN_SPEED = 6;

// Shared bus graph: musicIn -> lowpass (pause duck) -> music gain -> master,
// sfx -> master, master -> compressor -> limiter -> destination. Plus one
// second of seeded noise for noise layers.
function buildGraph(ctx, seed) {
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0), r = rngFrom(`${seed}:noise`);
  for (let i = 0; i < data.length; i++) data[i] = r() * 2 - 1;
  const master = ctx.createGain(), comp = ctx.createDynamicsCompressor(), limit = ctx.createDynamicsCompressor();
  Object.entries({ threshold: -18, knee: 12, ratio: 3.5, attack: 0.004, release: 0.2 }).forEach(([k, val]) => { comp[k].value = val; });
  Object.entries({ threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.1 }).forEach(([k, val]) => { limit[k].value = val; });
  const music = ctx.createGain(), musicFilter = ctx.createBiquadFilter(), musicIn = ctx.createGain(), sfx = ctx.createGain();
  musicFilter.type = 'lowpass'; musicFilter.frequency.value = 18000;
  musicIn.connect(musicFilter); musicFilter.connect(music); music.connect(master); sfx.connect(master);
  master.connect(comp); comp.connect(limit); limit.connect(ctx.destination);
  return { nodes: { master, music, musicFilter, musicIn, sfx, comp, limit }, noise };
}

export function createAudio({ spec, design, AudioContextImpl = globalThis.AudioContext,
  setTimer = (f, ms) => setTimeout(f, ms), clearTimer = id => clearTimeout(id) } = {}) {
  const seed = String(spec?.id || design?.title || 'gameverse');
  const musicCfg = resolveMusic(spec, design), instrument = INSTRUMENTS[musicCfg.instrument];
  const volume = { master: 0.8, music: 0.5, sfx: 0.8 };
  let ctx = null, nodes = null, noise = null, muted = false, paused = false, desired = 'off';
  let loop = null, pumpId = null, voices = [], lastPlayed = {}, streak = 0, lastCollect = -Infinity, disposed = false;

  function build() {
    ctx = new AudioContextImpl();
    ({ nodes, noise } = buildGraph(ctx, seed));
    applyLevels(true);
  }

  function applyLevels(now = false) {
    if (!nodes) return;
    const at = (param, value, tc = 0.05) => { if (now) param.value = value; else { param.cancelScheduledValues(ctx.currentTime); param.setTargetAtTime(value, ctx.currentTime, tc); } };
    at(nodes.master.gain, muted ? 0 : volume.master);
    at(nodes.sfx.gain, volume.sfx);
    at(nodes.music.gain, volume.music * (paused ? 0.3 : 1), 0.12);
    at(nodes.musicFilter.frequency, paused ? 700 : 18000, 0.12);
  }

  function playNote(ev, t, out, spb) {
    const drum = DRUM_LAYERS[ev.part];
    for (const L of drum || instrument[ev.part]) {
      const layer = drum ? { ...L, vol: L.vol * ev.vel }
        : { ...L, f0: midiToHz(ev.midi) * (L.ratio || 1), dur: Math.max(0.05, ev.dur * spb), vol: L.vol * ev.vel };
      playLayer(ctx, out, layer, t, noise);
    }
  }

  // Look-ahead scheduler: a coarse timer wakes up often, and every note is
  // placed on the AudioContext clock, so timer jitter never shifts the beat.
  function pump() {
    if (!loop || !ctx) return;
    const { comp, out } = loop, spb = 60 / comp.bpm, loopLen = comp.beats * spb, now = ctx.currentTime;
    if (now - (loop.start + loop.iter * loopLen) > loopLen) { // woke after a long stall: skip ahead, don't burst
      loop.iter = Math.floor((now - loop.start) / loopLen); loop.idx = 0;
    }
    for (let guard = 0; guard < 512 && comp.events.length; guard++) {
      const ev = comp.events[loop.idx], t = loop.start + loop.iter * loopLen + ev.t * spb;
      if (t >= now + LOOKAHEAD) break;
      if (t >= now - 0.02) playNote(ev, t, out, spb);
      if (++loop.idx >= comp.events.length) { loop.idx = 0; loop.iter++; }
    }
  }
  function schedulePump() {
    if (pumpId !== null || !loop) return;
    pumpId = setTimer(() => { pumpId = null; pump(); schedulePump(); }, PUMP_MS);
  }

  function fadeOut(gain, seconds = 0.35) {
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now); gain.gain.linearRampToValueAtTime(0, now + seconds);
    setTimer(() => { try { gain.disconnect(); } catch { /* already gone */ } }, (seconds + 1) * 1000);
  }
  function stopLoop() { if (loop) { fadeOut(loop.out); loop = null; } if (pumpId !== null) { clearTimer(pumpId); pumpId = null; } }

  function startLoop(variant) {
    stopLoop();
    const out = ctx.createGain(), now = ctx.currentTime;
    out.gain.setValueAtTime(0, now); out.gain.linearRampToValueAtTime(1, now + 0.4); out.connect(nodes.musicIn);
    loop = { variant, comp: composeLoop(seed, musicCfg, { variant }), out, start: now + 0.1, iter: 0, idx: 0 };
    pump(); schedulePump();
  }

  function playSting(kind) {
    const comp = composeSting(kind, musicCfg), spb = 60 / comp.bpm, out = ctx.createGain(), t0 = ctx.currentTime + 0.2;
    out.gain.value = 1; out.connect(nodes.musicIn);
    for (const ev of comp.events) playNote(ev, t0 + ev.t * spb, out, spb);
    setTimer(() => { try { out.disconnect(); } catch { /* already gone */ } }, (comp.beats * spb + 2) * 1000);
  }

  function apply(mode) {
    if (mode === 'pause') { if (!loop) startLoop('play'); paused = true; }
    else if (mode === 'title' || mode === 'play') { if (loop?.variant !== mode) startLoop(mode); paused = false; }
    else if (mode === 'win' || mode === 'lose') { stopLoop(); paused = false; playSting(mode); }
    else { stopLoop(); paused = false; }
    applyLevels();
  }

  function trigger(name, opts = {}) {
    const recipe = sfxRecipe(name, seed, opts);
    if (!recipe || !ctx) return false;
    const now = ctx.currentTime;
    if (now - (lastPlayed[name] ?? -Infinity) < recipe.gap) return false;
    voices = voices.filter(v => v.end > now);
    if (voices.length >= MAX_VOICES) {
      const victim = voices.reduce((a, v) => (v.priority < a.priority ? v : a));
      if (victim.priority > recipe.priority) return false;
      fadeOut(victim.out, 0.02); voices.splice(voices.indexOf(victim), 1);
    }
    lastPlayed[name] = now;
    const out = ctx.createGain(); out.connect(nodes.sfx);
    const end = Math.max(...recipe.layers.map(L => playLayer(ctx, out, L, now + 0.005, noise)));
    voices.push({ end, out, priority: recipe.priority });
    return true;
  }

  const ready = () => ctx && !disposed && ctx.state !== 'closed';

  return {
    /** Create/resume the AudioContext. Call from a user gesture; safe to repeat. */
    unlock() {
      if (disposed || typeof AudioContextImpl !== 'function') return;
      if (!ctx) { build(); apply(desired); }
      if (ctx.state === 'suspended') ctx.resume?.();
    },
    /** Play effects for one frame's state.events: one sound per event name, rate-limited, voice-capped. */
    onEvents(events, state) {
      if (!ready() || !events?.length) return;
      const seen = new Set();
      for (const e of events) {
        if (!e?.name || seen.has(e.name)) continue;
        seen.add(e.name);
        const opts = {};
        if (e.name === 'collect') {
          const clock = Number.isFinite(state?.time) ? state.time : ctx.currentTime;
          streak = clock - lastCollect < 0.75 ? streak + 1 : 0; lastCollect = clock; opts.streak = streak;
        } else if (e.name === 'jump') opts.air = !!e.air;
        else if (e.name === 'land') {
          const speed = e.speed ?? e.vy; // when the engine reports it; otherwise rate limiting keeps it soft
          if (Number.isFinite(speed)) { if (Math.abs(speed) < LAND_MIN_SPEED) continue; opts.intensity = Math.abs(speed) / 24; }
          else opts.intensity = 0.7;
        }
        trigger(e.name, opts);
      }
    },
    /** Play a UI or event sound by name (e.g. 'menu_move', 'menu_confirm'). */
    play(name, opts) { return ready() ? trigger(name, opts) : false; },
    /** 'title' | 'play' | 'pause' (duck) | 'win' | 'lose' (stingers) | 'off'. Remembered until unlock. */
    music(mode) {
      if (mode === 'title' || mode === 'play' || mode === 'pause' || mode === 'off') desired = mode;
      if (mode === 'win' || mode === 'lose') desired = 'off';
      if (ready()) apply(mode);
    },
    setVolume({ master, music, sfx } = {}) {
      for (const [k, val] of Object.entries({ master, music, sfx })) if (Number.isFinite(val)) volume[k] = clamp(val, 0, 1);
      applyLevels();
    },
    setMuted(value) { muted = !!value; applyLevels(); },
    get muted() { return muted; },
    /** The resolved music direction (mood, tempo, key, scale, instrument). */
    get settings() { return { ...musicCfg }; },
    dispose() {
      if (disposed) return;
      stopLoop(); disposed = true;
      ctx?.close?.();
    },
  };
}

// ---------------------------------------------------------------- cue voices
// Generic voices for document cues ({event, voice, pitch, gain}). Layers use
// the sfxRecipe format; the loudest moment of a voice sums to at most
// 0.6 x gain, so gain 1 matches the loudest built-in effect.
export const VOICE_NAMES = ['blip', 'noise', 'chord', 'sweep', 'pad', 'drone', 'pluck', 'bell', 'kick', 'snare', 'hat', 'zap', 'coin', 'thud'];
const VOICE_PRIORITY = { blip: 2, noise: 2, chord: 4, sweep: 3, pad: 1, drone: 1, pluck: 2, bell: 3, kick: 2, snare: 2, hat: 1, zap: 2, coin: 3, thud: 2 };

/**
 * Recipe for one cue voice. pitch is the fundamental in Hz, gain 0..1, seed
 * varies the length slightly per game, decay (s) overrides the main length.
 * Returns { name, voice, priority, gap, layers } or null for an unknown voice.
 */
export function voiceRecipe(voice, { pitch = 440, gain = 0.4, seed = 'gameverse', decay } = {}) {
  if (!VOICE_NAMES.includes(voice)) return null;
  const f = clamp(Number.isFinite(pitch) ? pitch : 440, 30, 9000), g = clamp(Number.isFinite(gain) ? gain : 0.4, 0, 1);
  const r = rngFrom(`${seed}:voice:${voice}:${Math.round(f)}`);
  const len = d => +((Number.isFinite(decay) && decay > 0 ? decay : d) * (0.92 + 0.16 * r())).toFixed(4);
  const V = k => +(k * g).toFixed(4), hz = x => clamp(x, 25, 12000);
  let layers;
  switch (voice) {
    case 'blip': layers = [{ wave: 'square', f0: f, dur: len(0.08), vol: V(0.32), env: 'decay', lp: hz(f * 8) }]; break;
    case 'noise': layers = [{ wave: 'noise', lp: hz(f * 8), dur: len(0.12), vol: V(0.38), env: 'decay' }, { wave: 'sine', f0: f, f1: hz(f * 0.5), dur: len(0.1), vol: V(0.2), env: 'decay' }]; break;
    case 'chord': layers = [...[1, 5 / 4, 3 / 2].map((k, i) => ({ wave: 'triangle', f0: f * k, at: i * 0.035, dur: len(0.4), vol: V(0.17), env: 'decay' })),
      { wave: 'sine', f0: hz(f * 2), at: 0.07, dur: len(0.3), vol: V(0.07), env: 'decay' }]; break;
    case 'sweep': layers = [{ wave: 'sawtooth', f0: f, f1: hz(f * 2.5), slide: 0.9, dur: len(0.24), vol: V(0.22), env: 'decay', lp: hz(f * 10) },
      { wave: 'triangle', f0: hz(f * 2), f1: hz(f * 5), slide: 0.9, dur: len(0.2), vol: V(0.12), env: 'decay' }]; break;
    case 'pad': layers = [{ wave: 'triangle', f0: f, dur: len(0.6), vol: V(0.3), env: 'hold', attack: 0.08 }, { wave: 'sine', f0: hz(f * 1.5), dur: len(0.6), vol: V(0.15), env: 'hold', attack: 0.12 }]; break;
    case 'drone': layers = [{ wave: 'sawtooth', f0: f, dur: len(1.2), vol: V(0.16), env: 'hold', attack: 0.2, lp: hz(f * 3) },
      { wave: 'sawtooth', f0: f, detune: 7, dur: len(1.2), vol: V(0.14), env: 'hold', attack: 0.2, lp: hz(f * 3) }, { wave: 'sine', f0: hz(f * 0.5), dur: len(1.2), vol: V(0.2), env: 'hold', attack: 0.2 }]; break;
    case 'pluck': layers = [{ wave: 'triangle', f0: f, dur: len(0.3), vol: V(0.4), env: 'decay' }, { wave: 'sawtooth', f0: f, dur: len(0.08), vol: V(0.12), env: 'decay', lp: hz(f * 4) }]; break;
    case 'bell': layers = [{ wave: 'sine', f0: f, dur: len(0.9), vol: V(0.34), env: 'decay' }, { wave: 'sine', f0: hz(f * 2.76), dur: len(0.35), vol: V(0.12), env: 'decay' },
      { wave: 'sine', f0: hz(f * 5.4), dur: len(0.15), vol: V(0.05), env: 'decay' }]; break;
    case 'kick': layers = [{ wave: 'sine', f0: f, f1: hz(Math.min(f, 150) * 0.3), slide: 0.6, dur: len(0.18), vol: V(0.55), env: 'decay' }]; break;
    case 'snare': layers = [{ wave: 'noise', bp: hz(f * 4), q: 0.7, dur: len(0.13), vol: V(0.32), env: 'decay' }, { wave: 'triangle', f0: f, f1: hz(f * 0.8), dur: len(0.06), vol: V(0.2), env: 'decay' }]; break;
    case 'hat': layers = [{ wave: 'noise', hp: hz(Math.max(f * 12, 5000)), dur: len(0.04), vol: V(0.3), env: 'decay' }]; break;
    case 'zap': layers = [{ wave: 'square', f0: hz(f * 3), f1: hz(f * 0.5), slide: 0.8, dur: len(0.12), vol: V(0.25), env: 'decay', lp: hz(f * 12) },
      { wave: 'sawtooth', f0: hz(f * 2), f1: hz(f * 0.4), slide: 0.8, dur: len(0.12), vol: V(0.12), env: 'decay', detune: 12 }]; break;
    case 'coin': layers = [{ wave: 'square', f0: f, dur: 0.06, vol: V(0.25), env: 'hold' }, { wave: 'square', f0: hz(f * 4 / 3), at: 0.06, dur: len(0.2), vol: V(0.25), env: 'decay' }]; break;
    case 'thud': layers = [{ wave: 'sine', f0: f, f1: hz(f * 0.4), dur: len(0.14), vol: V(0.42), env: 'decay' }, { wave: 'noise', lp: hz(f * 3), dur: len(0.06), vol: V(0.16), env: 'decay' }]; break;
  }
  return { name: voice, voice, priority: VOICE_PRIORITY[voice], gap: 0, layers };
}

// ---------------------------------------------------------------- stems
// Documents name music layers freely ("lute", "surf", "anvil"). Each name maps
// to a part of the composed loop and an instrument. `also` adds further parts
// to the same stem (a drum kit is kick + snare + hat). Instrument 'auto' uses
// the plan's instrument.
export const STEM_PARTS = ['lead', 'bass', 'pad', 'arp', 'kick', 'snare', 'hat', 'drone', 'texture'];
const KIT = { part: 'kick', instrument: 'kit', also: ['snare', 'hat'] };
export const LAYER_STEMS = {
  bass: { part: 'bass', instrument: 'auto' }, perc: KIT, drum: KIT, drums: KIT,
  anvil: { part: 'snare', instrument: 'anvil' }, synth: { part: 'lead', instrument: 'synth' },
  drone: { part: 'drone', instrument: 'drone' }, strings: { part: 'pad', instrument: 'strings' },
  choir: { part: 'pad', instrument: 'choir' }, organ: { part: 'pad', instrument: 'organ' },
  pad: { part: 'pad', instrument: 'auto' }, accordion: { part: 'lead', instrument: 'reed' },
  pluck: { part: 'arp', instrument: 'pluck' }, lute: { part: 'arp', instrument: 'pluck' },
  bell: { part: 'arp', instrument: 'bell' }, whistle: { part: 'lead', instrument: 'whistle' },
  horn: { part: 'lead', instrument: 'horn' }, radio: { part: 'lead', instrument: 'radio', also: ['bass', 'kick', 'snare', 'hat'] },
  wind: { part: 'texture', instrument: 'wind' }, surf: { part: 'texture', instrument: 'surf' },
  drip: { part: 'texture', instrument: 'drip' }, lead: { part: 'lead', instrument: 'auto' },
  arp: { part: 'arp', instrument: 'auto' }, piano: { part: 'lead', instrument: 'piano' },
  brass: { part: 'lead', instrument: 'horn' },
};
export const DEFAULT_LAYERS = ['pad', 'bass', 'lead', 'drums'];
// Longest names first so 'drums' wins over 'drum' in substring matches.
const STEM_KEYS = Object.keys(LAYER_STEMS).sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
const FALLBACK_PARTS = ['pad', 'arp', 'lead', 'texture'], FALLBACK_INSTRUMENTS = ['bell', 'pluck', 'synth', 'chip'];

function stemOf(name) {
  const key = name.toLowerCase().trim();
  const hit = has(LAYER_STEMS, key) ? key : STEM_KEYS.find(k => key.includes(k));
  if (hit) { const s = LAYER_STEMS[hit]; return s.also ? { ...s, also: [...s.also] } : { ...s }; }
  const h = seedFrom(key), part = FALLBACK_PARTS[h % FALLBACK_PARTS.length];
  return { part, instrument: part === 'texture' ? 'wind' : FALLBACK_INSTRUMENTS[(h >>> 4) % FALLBACK_INSTRUMENTS.length] };
}

/** Map layer names to stems [{name, part, instrument, also?}]: known names, then substrings, then a stable hash. Duplicates collapse. */
export function stemsFor(layers = DEFAULT_LAYERS) {
  const seen = new Set(), out = [];
  for (const raw of Array.isArray(layers) ? layers : []) {
    const name = String(raw ?? '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, ...stemOf(name) });
  }
  return out;
}

const SCALE_MOOD = { major: 'playful', ionian: 'playful', pentatonic: 'playful', lydian: 'dreamy', mixolydian: 'energetic', dorian: 'mysterious',
  minor: 'melancholy', aeolian: 'melancholy', phrygian: 'tense', locrian: 'spooky', harmonicMinor: 'spooky', blues: 'melancholy', pentatonicMinor: 'mysterious' };

/**
 * Adaptive music: composeLoop's arrangement split into named stems.
 * plan = { mood?, bpm, key, scale, instrument?, layers: [names] }.
 * Returns { bpm, beats, bars, sections, music, stems: [{ name, part, instrument, events: [{ t, dur, midi?, vel, part }] }] }.
 * Pitched parts keep the loop's notes (a second stem on the same part moves up
 * an octave); arp stems arpeggiate every bar's chord; a drum part the mood's
 * groove leaves empty gets a plain backbeat; drone stems hold the tonic and fifth degree; texture stems are
 * noise swells (drip: high notes in the scale). Every pitched note stays in
 * pitchClasses(result.music).
 */
export function composeStems(seed, plan = {}, { variant = 'play' } = {}) {
  const scale = has(SCALES, plan.scale) ? plan.scale : null;
  const mood = has(MOODS, plan.mood) ? plan.mood : SCALE_MOOD[scale] || 'playful';
  const m = MOODS[mood];
  const music = {
    mood, tempo: clamp(Math.round(Number.isFinite(plan.bpm) ? plan.bpm : m.tempo), 40, 200),
    key: has(PITCH, plan.key) ? plan.key : 'C', scale: scale || m.scale,
    instrument: INSTRUMENT_NAMES.includes(plan.instrument) ? plan.instrument : m.instrument,
  };
  const loop = composeResolved(seed, music, { variant });
  const sc = scaleOf(music), n = sc.length, root = 48 + ((PITCH[music.key] + 6) % 12) - 6;
  const note = (base, idx) => base + 12 * Math.floor(idx / n) + sc[((idx % n) + n) % n];
  const used = {};
  const stems = stemsFor(plan.layers ?? DEFAULT_LAYERS).map(s => {
    const octave = 12 * (used[s.part] = (used[s.part] ?? -1) + 1);
    const r = rngFrom(`${seed}:stem:${s.name}`);
    let events = [];
    if (s.part === 'drone') {
      for (let bar = 0; bar < loop.bars; bar += 2) {
        events.push({ t: bar * 4, dur: 8, midi: note(root - 12, 0), vel: 0.7, part: 'drone' });
        events.push({ t: bar * 4, dur: 8, midi: note(root - 12, Math.min(4, n - 1)), vel: 0.35, part: 'drone' });
      }
    } else if (s.part === 'texture') {
      for (let bar = 0; bar < loop.bars; bar++) {
        if (s.instrument === 'drip') {
          for (let k = 0, drops = 1 + Math.floor(r() * 3); k < drops; k++) events.push({ t: bar * 4 + Math.floor(r() * 16) / 4, dur: 0.25, midi: note(root + 24, Math.floor(r() * n)), vel: +(0.4 + 0.4 * r()).toFixed(3), part: 'texture' });
        } else if (s.instrument === 'surf') events.push({ t: bar * 4, dur: 3.5, vel: +(0.5 + 0.4 * r()).toFixed(3), part: 'texture' });
        else if (bar % 2 === 0) events.push({ t: bar * 4 + Math.floor(r() * 4), dur: 4 + Math.floor(r() * 4), vel: +(0.4 + 0.5 * r()).toFixed(3), part: 'texture' });
      }
      events.sort((a, b) => a.t - b.t);
    } else {
      const parts = new Set([s.part, ...(s.also || [])]);
      // An arp layer plays through the whole loop (the loop itself only arpeggiates in some moods/sections).
      const source = loop.events.filter(e => parts.has(e.part) && e.part !== 'arp');
      if (parts.has('arp')) source.push(...arpeggio(loop, m, variant));
      for (const p of ['kick', 'snare', 'hat']) if (parts.has(p) && !source.some(e => e.part === p)) source.push(...backbeat(loop, p));
      events = source.sort((a, b) => a.t - b.t).map(e => (e.midi === undefined ? { ...e } : { ...e, midi: e.midi + octave <= 96 ? e.midi + octave : e.midi }));
    }
    return { name: s.name, part: s.part, instrument: s.instrument === 'auto' ? music.instrument : s.instrument, events };
  });
  return { bpm: loop.bpm, beats: loop.beats, bars: loop.bars, sections: loop.sections, music, stems };
}

// Arpeggio over each bar's pad chord, an octave up (chord tones only, so in scale).
function arpeggio(loop, mood, variant) {
  const rate = variant === 'title' ? 4 : mood.arp || 2, out = [];
  for (let bar = 0; bar < loop.bars; bar++) {
    const chord = loop.events.filter(e => e.part === 'pad' && e.t === bar * 4).map(e => e.midi).sort((a, b) => a - b);
    if (!chord.length) continue;
    const tones = [...chord, chord[0] + 12];
    for (let s = 0, i = 0; s < 16; s += rate, i++) out.push({ t: bar * 4 + s / 4, dur: rate / 4, part: 'arp', vel: s % 4 === 0 ? 0.7 : 0.5, midi: tones[i % tones.length] + 12 });
  }
  return out;
}
// A plain pattern for a drum part the mood's groove leaves empty (soft moods have no snare).
function backbeat(loop, part) {
  const steps = { kick: [0, 8], snare: [4, 12], hat: [0, 4, 8, 12] }[part], out = [];
  for (let bar = 0; bar < loop.bars; bar++) for (const s of steps) out.push({ t: bar * 4 + s / 4, dur: 0.25, part, vel: DRUM_VEL[part] * 0.8 });
  return out;
}

/** The first bar boundary at or after `now` on a clock that started at `start` (seconds) with `bpm` in 4/4. */
export function nextBar(now, start, bpm) {
  const bar = 240 / bpm;
  if (!(bar > 0) || !Number.isFinite(bar) || now <= start) return start;
  return start + Math.ceil((now - start) / bar - 1e-9) * bar;
}

// Stem instruments beyond the four loop instruments: one layer template for
// every pitched part (ratio scales the note frequency).
const STEM_INSTRUMENTS = {
  drone: [{ wave: 'sawtooth', vol: 0.03, env: 'hold', attack: 0.8, lp: 500 }, { wave: 'sine', ratio: 0.5, vol: 0.09, env: 'hold', attack: 0.8 }],
  strings: [{ wave: 'sawtooth', vol: 0.022, env: 'hold', attack: 0.35, lp: 1600 }, { wave: 'sawtooth', vol: 0.018, env: 'hold', attack: 0.35, lp: 1600, detune: 8 }],
  choir: [{ wave: 'triangle', vol: 0.04, env: 'hold', attack: 0.5, lp: 1200 }, { wave: 'sine', ratio: 2, vol: 0.012, env: 'hold', attack: 0.6 }],
  organ: [{ wave: 'sine', vol: 0.04, env: 'hold', attack: 0.03 }, { wave: 'sine', ratio: 2, vol: 0.02, env: 'hold', attack: 0.03 }, { wave: 'sine', ratio: 3, vol: 0.01, env: 'hold', attack: 0.03 }],
  reed: [{ wave: 'sawtooth', vol: 0.04, env: 'hold', attack: 0.03, lp: 1800 }, { wave: 'square', vol: 0.02, env: 'hold', attack: 0.03, lp: 1800, detune: 6 }],
  whistle: [{ wave: 'sine', vol: 0.09, env: 'hold', attack: 0.06 }],
  horn: [{ wave: 'sawtooth', vol: 0.05, env: 'hold', attack: 0.08, lp: 900 }],
  piano: [{ wave: 'triangle', vol: 0.14, env: 'decay', decay: 0.8 }, { wave: 'sine', ratio: 2, vol: 0.03, env: 'decay', decay: 0.3 }],
  radio: [{ wave: 'square', vol: 0.05, env: 'hold', bp: 1400, q: 0.8 }],
};
const ANVIL = [{ wave: 'square', f0: 1250, dur: 0.25, vol: 0.05, env: 'decay', bp: 2500, q: 4 }, { wave: 'sine', f0: 3150, dur: 0.18, vol: 0.03, env: 'decay' }, { wave: 'noise', hp: 4000, dur: 0.04, vol: 0.06, env: 'decay' }];

/** Layers (sfx format) for one stem note at spb seconds per beat. Pure; the mixer plays these. */
export function noteLayers(ev, instrument, spb) {
  const part = ev.part;
  if (part === 'kick' || part === 'snare' || part === 'hat') {
    const base = instrument === 'anvil' && part === 'snare' ? ANVIL : DRUM_LAYERS[part];
    return base.map(L => ({ ...L, vol: L.vol * ev.vel }));
  }
  const dur = Math.max(0.05, ev.dur * spb);
  if (part === 'texture') {
    if (Number.isFinite(ev.midi)) { const f = midiToHz(ev.midi); return [{ wave: 'sine', f0: f, f1: f * 1.6, slide: 0.5, dur: 0.09, vol: 0.06 * ev.vel, env: 'decay' }]; }
    const surf = instrument === 'surf';
    return [{ wave: 'noise', ...(surf ? { lp: 900 } : { bp: 520 }), q: 0.6, dur, attack: dur * (surf ? 0.45 : 0.35), vol: (surf ? 0.07 : 0.05) * ev.vel, env: 'hold' }];
  }
  const tmpl = has(INSTRUMENTS, instrument) ? (INSTRUMENTS[instrument][part] || INSTRUMENTS[instrument].lead)
    : has(STEM_INSTRUMENTS, instrument) ? STEM_INSTRUMENTS[instrument] : part === 'drone' ? STEM_INSTRUMENTS.drone : (INSTRUMENTS.chip[part] || INSTRUMENTS.chip.lead);
  const f = midiToHz(ev.midi);
  return tmpl.map(L => ({ ...L, f0: f * (L.ratio || 1), dur, vol: L.vol * ev.vel }));
}

// ---------------------------------------------------------------- mixer
const unrefTimer = (f, ms) => { const id = setTimeout(f, ms); id?.unref?.(); return id; };
function equalPower(param, t0, seconds, dir) {
  param.cancelScheduledValues?.(t0);
  param.setValueAtTime(dir === 'in' ? 0 : 1, t0);
  for (let i = 1; i <= 8; i++) { const x = i / 8; param.linearRampToValueAtTime(dir === 'in' ? Math.sin((x * Math.PI) / 2) : Math.cos((x * Math.PI) / 2), t0 + x * seconds); }
}

/**
 * WebAudio engine for adaptive stems and cue effects (graphics.audio.synth).
 * Buses: music (with the pause duck: lowpass plus gain) and sfx into a master
 * with compressor and limiter. Each stem has its own gain node. setMusic()
 * switches at the next bar boundary of the current music clock with an
 * equal-power crossfade of about one bar. The AudioContext is created lazily
 * in unlock(); before that every call is remembered or ignored silently.
 */
export function createMixer({ seed = 'gameverse', AudioContextImpl = globalThis.AudioContext, setTimer = unrefTimer, clearTimer = id => clearTimeout(id), voiceCap = 10, duck = 0.3 } = {}) {
  const volume = { master: 0.8, music: 0.5, sfx: 0.8 }, stemLevels = {}, cache = new Map();
  let ctx = null, nodes = null, noise = null, muted = false, paused = false, duckLevel = clamp(duck, 0, 1), disposed = false;
  let desired = null, tracks = [], voices = [], lastPlayed = {}, pumpId = null;
  const keyOf = (plan, variant) => `${variant}|${JSON.stringify(plan)}`;
  const ready = () => Boolean(ctx) && !disposed && ctx.state !== 'closed';
  const later = (fn, seconds) => setTimer(fn, Math.max(0, seconds) * 1000);
  const drop = node => { try { node.disconnect(); } catch { /* already gone */ } };

  function compose(plan, variant) {
    const key = keyOf(plan, variant);
    if (!cache.has(key)) { if (cache.size >= 16) cache.delete(cache.keys().next().value); cache.set(key, composeStems(seed, plan, { variant })); }
    return cache.get(key);
  }
  function applyLevels(now = false) {
    if (!nodes) return;
    const at = (param, value, tc = 0.05) => { if (now) param.value = value; else { param.cancelScheduledValues(ctx.currentTime); param.setTargetAtTime(value, ctx.currentTime, tc); } };
    at(nodes.master.gain, muted ? 0 : volume.master);
    at(nodes.sfx.gain, volume.sfx);
    at(nodes.music.gain, volume.music * (paused ? duckLevel : 1), 0.12);
    at(nodes.musicFilter.frequency, paused ? 700 : 18000, 0.12);
  }
  function startTrack(plan, variant, at, fade) {
    const comp = compose(plan, variant), out = ctx.createGain();
    out.connect(nodes.musicIn); equalPower(out.gain, at, fade, 'in');
    const stems = comp.stems.map(s => {
      const gain = ctx.createGain(); gain.gain.value = stemLevels[s.name] ?? 1; gain.connect(out);
      return { name: s.name, instrument: s.instrument, events: s.events, gain, idx: 0, iter: 0 };
    });
    const track = { key: keyOf(plan, variant), plan, variant, bpm: comp.bpm, beats: comp.beats, start: at, end: Infinity, out, stems };
    tracks.push(track);
    return track;
  }
  function retire(track, at, seconds) {
    track.end = at + seconds; equalPower(track.out.gain, at, seconds, 'out');
    later(() => drop(track.out), at - ctx.currentTime + seconds + 1);
  }
  function playNote(ev, t, out, spb, instrument) { for (const L of noteLayers(ev, instrument, spb)) playLayer(ctx, out, L, t, noise); }

  // Look-ahead scheduler, as in createAudio: notes go on the AudioContext clock.
  function pump() {
    if (!ready()) return;
    const now = ctx.currentTime;
    tracks = tracks.filter(t => t.end > now - 0.05);
    for (const tr of tracks) {
      const spb = 60 / tr.bpm, loopLen = tr.beats * spb, horizon = Math.min(now + LOOKAHEAD, tr.end);
      for (const st of tr.stems) {
        if (!st.events.length) continue;
        if (now - (tr.start + st.iter * loopLen) > loopLen) { st.iter = Math.max(0, Math.floor((now - tr.start) / loopLen)); st.idx = 0; }
        for (let guard = 0; guard < 512; guard++) {
          const ev = st.events[st.idx], t = tr.start + st.iter * loopLen + ev.t * spb;
          if (t >= horizon) break;
          if (t >= now - 0.02) playNote(ev, t, st.gain, spb, st.instrument);
          if (++st.idx >= st.events.length) { st.idx = 0; st.iter++; }
        }
      }
    }
  }
  function schedulePump() {
    if (pumpId !== null || !tracks.length || disposed) return;
    pumpId = setTimer(() => { pumpId = null; pump(); schedulePump(); }, PUMP_MS);
  }
  const audible = now => tracks.filter(t => t.start <= now && t.end > now).at(-1) || null;

  function switchMusic() {
    if (!ready() || !desired) return;
    const now = ctx.currentTime, cur = tracks.filter(t => t.end === Infinity).at(-1);
    if (cur && cur.key === desired.key) return;
    for (const t of tracks) if (t.start > now) { t.end = now; drop(t.out); } // never heard: drop
    tracks = tracks.filter(t => t.end > now);
    const ref = audible(now);
    if (!ref) startTrack(desired.plan, desired.variant, now + 0.1, 0.6);
    else {
      const at = nextBar(now + 0.05, ref.start, ref.bpm), fade = clamp(240 / ref.bpm, 0.5, 4);
      retire(ref, at, fade);
      startTrack(desired.plan, desired.variant, at, fade);
    }
    pump(); schedulePump();
  }

  const mixer = {
    /** Create/resume the AudioContext (call from a user gesture; safe to repeat). Returns true when audio is available. */
    unlock() {
      if (disposed || typeof AudioContextImpl !== 'function') return false;
      if (!ctx) { ctx = new AudioContextImpl(); ({ nodes, noise } = buildGraph(ctx, seed)); applyLevels(true); switchMusic(); }
      if (ctx.state === 'suspended') ctx.resume?.();
      return true;
    },
    get unlocked() { return ready(); },
    /** Play plan = {mood, bpm, key, scale, instrument, layers}; variant 'play' | 'title'. Quantized to the next bar. */
    setMusic(plan, { variant = 'play' } = {}) {
      if (!plan) { mixer.stopMusic(); return; }
      desired = { plan, variant, key: keyOf(plan, variant) };
      switchMusic();
    },
    stopMusic(seconds = 0.6) {
      desired = null;
      if (!ready()) return;
      const now = ctx.currentTime;
      for (const t of tracks) if (t.end > now) { if (t.start > now) { t.end = now; drop(t.out); } else retire(t, now, seconds); }
    },
    /** Short win/lose stinger in the plan's key; stops the music. */
    sting(kind, plan = {}) {
      mixer.stopMusic(0.3);
      if (!ready()) return false;
      const comp = composeSting(kind === 'win' ? 'win' : 'lose', { mood: plan.mood, tempo: plan.bpm, key: plan.key, scale: plan.scale, instrument: plan.instrument });
      const spb = 60 / comp.bpm, out = ctx.createGain(), t0 = ctx.currentTime + 0.2, inst = INSTRUMENT_NAMES.includes(plan.instrument) ? plan.instrument : 'chip';
      out.gain.value = 1; out.connect(nodes.musicIn);
      for (const ev of comp.events) playNote(ev, t0 + ev.t * spb, out, spb, inst);
      later(() => drop(out), comp.beats * spb + 2);
      return true;
    },
    /** Realign the current music clock so a bar starts now (beat sync). Small drifts only (under half a bar). */
    alignBar() {
      if (!ready()) return;
      const now = ctx.currentTime, tr = audible(now); if (!tr) return;
      const bar = 240 / tr.bpm, shift = now - Math.round((now - tr.start) / bar) * bar - tr.start;
      if (Math.abs(shift) > 0.005 && Math.abs(shift) < bar / 2) for (const t of tracks) if (t === tr || t.start > now) t.start += shift;
    },
    /** Fade one stem (by layer name) to level 0..1. */
    setStemLevel(name, level, seconds = 0.5) {
      stemLevels[name] = clamp(level, 0, 1);
      if (!ready()) return;
      for (const t of tracks) for (const s of t.stems) if (s.name === name) { s.gain.gain.cancelScheduledValues(ctx.currentTime); s.gain.gain.setTargetAtTime(stemLevels[name], ctx.currentTime, Math.max(0.01, seconds / 3)); }
    },
    /** Play a recipe ({name, priority, gap, layers}) on the sfx bus, with per-key cooldown and the voice cap. */
    playCue(recipe, { key = recipe?.name, cooldown = recipe?.gap ?? 0, priority = recipe?.priority ?? 1 } = {}) {
      if (!ready() || !recipe?.layers?.length) return false;
      const now = ctx.currentTime;
      if (now - (lastPlayed[key] ?? -Infinity) < cooldown) return false;
      voices = voices.filter(v => v.end > now);
      if (voices.length >= voiceCap) {
        const victim = voices.reduce((a, v) => (v.priority < a.priority ? v : a));
        if (victim.priority > priority) return false;
        drop(victim.out); voices.splice(voices.indexOf(victim), 1);
      }
      lastPlayed[key] = now;
      const out = ctx.createGain(); out.connect(nodes.sfx);
      const end = Math.max(...recipe.layers.map(L => playLayer(ctx, out, L, now + 0.005, noise)));
      voices.push({ end, out, priority });
      return true;
    },
    setVolume({ master, music, sfx } = {}) {
      for (const [k, val] of Object.entries({ master, music, sfx })) if (Number.isFinite(val)) volume[k] = clamp(val, 0, 1);
      applyLevels();
    },
    setMuted(value) { muted = Boolean(value); applyLevels(); },
    get muted() { return muted; },
    /** Pause duck: music through a lowpass at `duck` gain. */
    setPaused(value) { paused = Boolean(value); applyLevels(); },
    get paused() { return paused; },
    setDuck(value) { if (Number.isFinite(value)) duckLevel = clamp(value, 0, 1); applyLevels(); },
    /** Run the scheduler now (hosts may call it per display frame in addition to its timer). */
    tick() { pump(); },
    /** Read-only view for tests and debugging. */
    inspect() {
      return { unlocked: ready(), muted, paused, volume: { ...volume }, voices: voices.length, now: ctx?.currentTime ?? null, desired: desired?.key ?? null,
        tracks: tracks.map(t => ({ key: t.key, variant: t.variant, bpm: t.bpm, start: t.start, end: t.end, stems: t.stems.map(s => s.name) })) };
    },
    dispose() {
      if (disposed) return;
      mixer.stopMusic(0.05); disposed = true;
      if (pumpId !== null) { clearTimer(pumpId); pumpId = null; }
      ctx?.close?.();
    },
  };
  return mixer;
}
