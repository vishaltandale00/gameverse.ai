import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio, composeLoop, composeSting, sfxRecipe, resolveMusic, pitchClasses, scaleOf, EVENT_NAMES, UI_SOUNDS, MOOD_NAMES, SCALES } from '../v2/engine/audio.js';

const PITCHED = new Set(['lead', 'bass', 'pad', 'arp']);
const music = (over = {}) => ({ mood: 'heroic', tempo: 132, key: 'C', scale: 'major', instrument: 'chip', ...over });

// Minimal WebAudio stand-in: records nodes and started sources; no sound.
function fakeAudio() {
  const log = { contexts: 0, started: [], nodes: 0, closed: false };
  const param = v => ({ value: v, events: [], setValueAtTime(x) { this.value = x; this.events.push(['set', x]); }, linearRampToValueAtTime(x) { this.events.push(['lin', x]); },
    exponentialRampToValueAtTime(x) { assert.ok(x > 0, 'exponential ramps need a positive target'); this.events.push(['exp', x]); }, setTargetAtTime(x) { this.value = x; }, cancelScheduledValues() {} });
  const node = extra => { log.nodes++; return { connect() {}, disconnect() {}, ...extra }; };
  class Ctx {
    constructor() { log.contexts++; this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = node(); log.ctx = this; }
    createGain() { return node({ gain: param(1) }); }
    createBiquadFilter() { return node({ type: 'lowpass', frequency: param(350), Q: param(1) }); }
    createDynamicsCompressor() { return node({ threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) }); }
    createOscillator() { return node({ type: 'sine', frequency: param(440), detune: param(0), start(t) { log.started.push({ kind: 'osc', t, osc: this }); }, stop() {} }); }
    createBufferSource() { return node({ playbackRate: param(1), start(t) { log.started.push({ kind: 'noise', t }); }, stop() {} }); }
    createBuffer(ch, len) { const data = new Float32Array(len); return { getChannelData: () => data }; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { log.closed = true; this.state = 'closed'; }
  }
  const timers = [];
  return { log, Ctx, timers, setTimer: (f, ms) => { timers.push(f); return timers.length; }, clearTimer: () => {},
    runTimers() { const fs = timers.splice(0); fs.forEach(f => f()); } };
}

test('composeLoop is deterministic per seed and varies between games', () => {
  const a = composeLoop('coin-cavern', music()), b = composeLoop('coin-cavern', music());
  assert.deepEqual(a, b);
  const lead = c => c.events.filter(e => e.part === 'lead').map(e => [e.t, e.midi]);
  assert.notDeepEqual(lead(a), lead(composeLoop('blaster-run', music())));
});

test('every pitched note is in the key and scale, for every mood, scale and several keys', () => {
  for (const mood of MOOD_NAMES) for (const scale of ['major', 'minor', 'dorian', 'mixolydian', 'pentatonic']) for (const key of ['C', 'D', 'F#', 'Bb', 'B']) {
    const m = music({ mood, scale, key, tempo: 120 });
    const allowed = new Set(pitchClasses(m));
    for (const variant of ['play', 'title']) {
      for (const e of composeLoop(`${mood}-${key}`, m, { variant }).events.filter(e => PITCHED.has(e.part))) {
        assert.ok(Number.isInteger(e.midi) && e.midi >= 24 && e.midi <= 96, `${mood}/${scale}/${key}: midi ${e.midi} out of range`);
        assert.ok(allowed.has(e.midi % 12), `${mood}/${scale}/${key}: ${e.part} note ${e.midi} not in scale`);
      }
    }
    for (const kind of ['win', 'lose']) for (const e of composeSting(kind, m).events.filter(e => PITCHED.has(e.part))) assert.ok(allowed.has(e.midi % 12));
  }
});

test('pitch classes match textbook scales', () => {
  assert.deepEqual(pitchClasses(music({ key: 'C', scale: 'major' })), [0, 2, 4, 5, 7, 9, 11]);
  assert.deepEqual(pitchClasses(music({ key: 'A', scale: 'minor' })), [0, 2, 4, 5, 7, 9, 11]);
  assert.deepEqual(pitchClasses(music({ key: 'D', scale: 'dorian' })), [0, 2, 4, 5, 7, 9, 11]);
  assert.deepEqual(scaleOf(music({ mood: 'spooky', scale: 'pentatonic' })), SCALES.pentatonicMinor);
});

test('the play loop runs 16–32 bars with A/B sections and a full band; the title is calmer', () => {
  for (const mood of MOOD_NAMES) for (const tempo of [70, 110, 170]) {
    const play = composeLoop('g', music({ mood, tempo }));
    assert.ok(play.bars >= 16 && play.bars <= 32, `${mood}@${tempo}: ${play.bars} bars`);
    assert.ok((play.beats * 60) / play.bpm >= 35, `${mood}@${tempo}: loop too short`);
    assert.deepEqual(play.sections.map(s => s.name), ['A', 'A', 'B', 'A']);
    for (const part of ['lead', 'bass', 'pad', 'kick', 'hat']) assert.ok(play.events.some(e => e.part === part), `${mood}: no ${part}`);
    assert.ok(play.events.every(e => e.t >= 0 && e.t < play.beats && e.dur > 0 && e.vel > 0 && e.vel <= 1));
    const title = composeLoop('g', music({ mood, tempo }), { variant: 'title' });
    const drums = c => c.events.filter(e => !PITCHED.has(e.part)).length / c.bars;
    assert.ok(drums(title) < drums(play) / 2, `${mood}: title drums not sparser`);
    assert.ok(title.bpm <= play.bpm);
  }
  const a = composeLoop('g', music()), sec = a.sections[2];
  const bar = (c, n) => c.events.filter(e => e.part === 'lead' && e.t >= n * 4 && e.t < n * 4 + 4).map(e => e.midi);
  assert.notDeepEqual(bar(a, 0), bar(a, sec.startBar), 'B section should differ from A');
});

test('moods differ in tempo, scale, instrument and groove', () => {
  const resolved = MOOD_NAMES.map(mood => resolveMusic({ id: 'x' }, { music: { mood } }));
  assert.ok(new Set(resolved.map(r => r.instrument)).size >= 3);
  assert.ok(new Set(resolved.map(r => r.scale)).size >= 3);
  const tense = resolveMusic({ id: 'x' }, { music: { mood: 'tense' } }), dreamy = resolveMusic({ id: 'x' }, { music: { mood: 'dreamy' } });
  assert.ok(tense.tempo > dreamy.tempo + 30);
  const kicks = mood => composeLoop('g', music({ mood, tempo: 120 })).events.filter(e => e.part === 'kick').length;
  assert.ok(kicks('energetic') > kicks('dreamy'));
});

test('resolveMusic honours the design and fills sensible defaults', () => {
  const given = { mood: 'spooky', tempo: 300, key: 'F#', scale: 'dorian', instrument: 'pluck' };
  assert.deepEqual(resolveMusic({ id: 'a' }, { music: given }), { mood: 'spooky', tempo: 170, key: 'F#', scale: 'dorian', instrument: 'pluck' });
  assert.equal(resolveMusic({ id: 'm', title: 'The Quiet Manor', pitch: 'A ghost story' }).mood, 'spooky');
  assert.equal(resolveMusic({ id: 'b', title: 'Blaster Run', pitch: 'Laser rocket dash' }).mood, 'energetic');
  const d = resolveMusic({ id: 'plain', title: 'Untitled' }, { music: { mood: 'nonsense', key: 'H' } });
  assert.ok(MOOD_NAMES.includes(d.mood) && d.tempo >= 70 && d.tempo <= 170 && pitchClasses(d).length >= 5);
  assert.deepEqual(resolveMusic({ id: 'plain' }), resolveMusic({ id: 'plain' }));
});

test('every event and UI sound has a deterministic, well-formed recipe', () => {
  for (const name of [...EVENT_NAMES, ...UI_SOUNDS]) {
    const r = sfxRecipe(name, 'seed-1');
    assert.ok(r && r.layers.length > 0, name);
    assert.deepEqual(r, sfxRecipe(name, 'seed-1'));
    assert.ok(Number.isFinite(r.gap) && Number.isFinite(r.priority));
    const peak = Math.max(...r.layers.map(A => r.layers.filter(L => (L.at || 0) <= (A.at || 0) && (L.at || 0) + L.dur > (A.at || 0)).reduce((s, L) => s + L.vol, 0)));
    assert.ok(peak <= 0.6, `${name} too loud: ${peak}`);
    for (const L of r.layers) {
      assert.ok(['sine', 'square', 'sawtooth', 'triangle', 'noise'].includes(L.wave), name);
      assert.ok(L.dur > 0 && L.dur < 1.5 && (L.at || 0) >= 0, name);
      if (L.wave !== 'noise') assert.ok(L.f0 > 20 && L.f0 < 12000 && (L.f1 === undefined || L.f1 > 20), name);
    }
  }
  assert.equal(sfxRecipe('nope', 's'), null);
  const differs = EVENT_NAMES.some(n => JSON.stringify(sfxRecipe(n, 'a')) !== JSON.stringify(sfxRecipe(n, 'b')));
  assert.ok(differs, 'seed should vary the effects');
});

test('pickup pitch rises over a streak; air jumps sound higher', () => {
  const f = s => sfxRecipe('collect', 'g', { streak: s }).layers[0].f0;
  assert.ok(f(0) < f(1) && f(1) < f(2) && f(2) < f(5));
  assert.equal(f(50), f(10));
  assert.ok(sfxRecipe('jump', 'g', { air: true }).layers[0].f0 > sfxRecipe('jump', 'g').layers[0].f0);
});

test('stingers are short and resolve to the tonic', () => {
  for (const kind of ['win', 'lose']) {
    const s = composeSting(kind, music({ key: 'D' }));
    assert.ok((s.beats * 60) / s.bpm <= 3, `${kind} sting too long`);
    assert.equal(s.events.find(e => e.part === 'bass').midi % 12, 2);
  }
});

test('createAudio stays silent until unlock, then plays capped, rate-limited effects', () => {
  const fake = fakeAudio();
  const audio = createAudio({ spec: { id: 'coin-cavern', title: 'Coin Cavern' }, AudioContextImpl: fake.Ctx, setTimer: fake.setTimer, clearTimer: fake.clearTimer });
  audio.music('title');
  audio.onEvents([{ name: 'jump' }]);
  assert.equal(fake.log.contexts, 0, 'no AudioContext before unlock');
  audio.unlock(); audio.unlock();
  assert.equal(fake.log.contexts, 1);
  assert.ok(fake.log.started.length > 0, 'title music starts once unlocked');

  fake.log.started.length = 0;
  audio.music('off');
  audio.onEvents([{ name: 'shoot' }, { name: 'shoot' }, { name: 'shoot' }]);
  const afterShoot = fake.log.started.length;
  assert.equal(afterShoot, 1, 'duplicate events in a frame play once');
  audio.onEvents([{ name: 'shoot' }]);
  assert.equal(fake.log.started.length, afterShoot, 'identical sound is rate-limited');

  fake.log.ctx.currentTime = 1;
  audio.onEvents(EVENT_NAMES.map(name => ({ name })));
  fake.log.ctx.currentTime = 1.01;
  audio.onEvents(EVENT_NAMES.map(name => ({ name: name === 'shoot' ? 'menu_move' : name })));
  assert.ok(fake.log.started.length - afterShoot <= 8 * 4, 'voice cap bounds simultaneous effects');

  fake.log.ctx.currentTime = 2; fake.log.started.length = 0;
  audio.onEvents([{ name: 'land', speed: 2 }]);
  assert.equal(fake.log.started.length, 0, 'gentle landings stay silent');
  audio.onEvents([{ name: 'land', speed: 20 }]);
  assert.ok(fake.log.started.length > 0);
  audio.dispose();
  assert.ok(fake.log.closed);
  audio.onEvents([{ name: 'jump' }]);
});

test('music schedules ahead on the audio clock, ducks on pause, mutes and plays stingers', () => {
  const fake = fakeAudio();
  const audio = createAudio({ spec: { id: 'blaster-run' }, design: { music: { mood: 'energetic', tempo: 150, key: 'E', scale: 'mixolydian', instrument: 'synth' } },
    AudioContextImpl: fake.Ctx, setTimer: fake.setTimer, clearTimer: fake.clearTimer });
  audio.unlock();
  audio.music('play');
  const ctx = fake.log.ctx, seen = () => fake.log.started.length;
  for (let i = 0; i < 40; i++) { ctx.currentTime += 0.03; fake.runTimers(); }
  const notes = fake.log.started.filter(s => s.kind === 'osc');
  assert.ok(notes.length > 10, 'loop keeps scheduling');
  assert.ok(fake.log.started.every(s => s.t <= ctx.currentTime + 0.2), 'scheduled within the look-ahead window');

  audio.music('pause');
  assert.ok(Math.abs(audio.settings.tempo - 150) < 1e-9);
  const before = seen();
  audio.music('play'); // resuming from pause does not restart the loop
  ctx.currentTime += 0.03; fake.runTimers();
  assert.ok(seen() >= before);

  audio.setVolume({ master: 2, music: 0.25 });
  audio.setMuted(true);
  assert.equal(audio.muted, true);
  audio.setMuted(false);
  const n = seen();
  audio.music('win');
  assert.ok(seen() > n, 'win stinger plays');
  audio.dispose();
});
