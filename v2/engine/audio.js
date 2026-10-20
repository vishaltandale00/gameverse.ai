// Sound for generated 2D games: sfxr-style effects and a procedural music
// loop, synthesized with WebAudio. No assets and no dependencies.
//
// The pure helpers (resolveMusic, composeLoop, composeSting, sfxRecipe) turn
// a spec and design into note events and effect recipes; createAudio plays
// them. The AudioContext is created lazily in unlock(), so nothing is built or
// heard before a user gesture (browser autoplay rule).
import { seedFrom, random } from './rng.js';

export const EVENT_NAMES = ['jump', 'land', 'collect', 'hurt', 'stomp', 'shoot', 'hit', 'defeated', 'reach_goal', 'time_up', 'fell', 'spawn'];
export const UI_SOUNDS = ['menu_move', 'menu_confirm'];

const PITCH = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], pentatonic: [0, 2, 4, 7, 9], pentatonicMinor: [0, 3, 5, 7, 10],
};
const INSTRUMENT_NAMES = ['chip', 'synth', 'bell', 'pluck'];

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
  return SCALES[music.scale] || SCALES.major;
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
    key: given.key in PITCH ? given.key : keyGuess,
    scale: given.scale in SCALES && given.scale !== 'pentatonicMinor' ? given.scale : m.scale,
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
export function composeLoop(seed, musicIn, { variant = 'play' } = {}) {
  const music = resolveMusic(null, { music: musicIn });
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

export function createAudio({ spec, design, AudioContextImpl = globalThis.AudioContext,
  setTimer = (f, ms) => setTimeout(f, ms), clearTimer = id => clearTimeout(id) } = {}) {
  const seed = String(spec?.id || design?.title || 'gameverse');
  const musicCfg = resolveMusic(spec, design), instrument = INSTRUMENTS[musicCfg.instrument];
  const volume = { master: 0.8, music: 0.5, sfx: 0.8 };
  let ctx = null, nodes = null, noise = null, muted = false, paused = false, desired = 'off';
  let loop = null, pumpId = null, voices = [], lastPlayed = {}, streak = 0, lastCollect = -Infinity, disposed = false;

  function build() {
    ctx = new AudioContextImpl();
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0), r = rngFrom(`${seed}:noise`);
    for (let i = 0; i < data.length; i++) data[i] = r() * 2 - 1;
    const master = ctx.createGain(), comp = ctx.createDynamicsCompressor(), limit = ctx.createDynamicsCompressor();
    Object.entries({ threshold: -18, knee: 12, ratio: 3.5, attack: 0.004, release: 0.2 }).forEach(([k, val]) => { comp[k].value = val; });
    Object.entries({ threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.1 }).forEach(([k, val]) => { limit[k].value = val; });
    const music = ctx.createGain(), musicFilter = ctx.createBiquadFilter(), musicIn = ctx.createGain(), sfx = ctx.createGain();
    musicFilter.type = 'lowpass'; musicFilter.frequency.value = 18000;
    musicIn.connect(musicFilter); musicFilter.connect(music); music.connect(master); sfx.connect(master);
    master.connect(comp); comp.connect(limit); limit.connect(ctx.destination);
    nodes = { master, music, musicFilter, musicIn, sfx };
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
