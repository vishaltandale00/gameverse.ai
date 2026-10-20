import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { mount } from './v2-p-ui-dom.js';
import feedback from '../v2/primitives/graphics/ui-feedback.js';
import audioSynth, { cueTable, scheduleCues, selectMusic, musicPlan, nextBar, uiRecipe, DEFAULT_CUES } from '../v2/primitives/graphics/audio-synth.js';
import { composeStems, stemsFor, pitchClasses, voiceRecipe, createMixer, noteLayers, SCALE_NAMES, LAYER_STEMS, STEM_PARTS, VOICE_NAMES } from '../v2/art/audio.js';

const GAMES = new URL('../v2/games/', import.meta.url);

// Fixture: actions that emit events and run effects, so behaviour goes through rt.step.
const fixture = {
  id: 'gameplay.test.audio-fixture',
  card: { intent: 'Test-only emitter.', params: { effects: { type: 'effects', default: [] } }, provides: { events: ['jumped', 'hit', 'defeated:*', 'damaged', 'combo', 'play_sound'] } },
  install(rt, config) {
    rt.action('emit', list => { for (const [name, data, typed] of list) typed ? rt.emitTyped(name, typed, data || {}) : rt.emit(name, data || {}); });
    rt.action('fire', () => rt.run(config.effects));
  },
};
const PRIMS = [testSpace, audioSynth, fixture, feedback];

const base = (audio = {}, systems = [{ use: 'gameplay.test.audio-fixture' }]) => ({
  schema: 'gameverse.v2.game/0.2', id: 't', title: 'T', logline: 'A quiet lantern in a hollow cave',
  spaces: [{ id: 's', use: 'engine.space.test', with: { size: [8, 8, 1] }, zones: [{ id: 'a', rect: [0, 0, 4, 8] }, { id: 'b', rect: [4, 0, 8, 8] }] }],
  content: { archetypes: [{ id: 'hero', kind: 'player', components: {} }] },
  player: { archetype: 'hero', at: [1, 1, 0] }, systems,
  graphics: [{ use: 'graphics.audio.synth', with: audio }],
});
const AUDIO = {
  cues: [
    { event: 'hit', voice: 'bell', pitch: 990, gain: 0.5, when: { var: 'danger', gte: 1 } },
    { event: 'hit', voice: 'noise', pitch: 300, gain: 0.5 },
    { event: 'defeated:boss', voice: 'chord', pitch: 392, gain: 0.6 },
    { event: 'jumped', voice: 'pluck', pitch: 600, cooldown: 0.1 },
  ],
  music: [
    { zone: 'a', mode: 'dorian', bpm: 60, layers: ['pad', 'pluck'] },
    { zone: 'b', mode: 'locrian', bpm: 50, layers: ['drone'] },
    { when: { var: 'danger', gte: 1 }, mode: 'aeolian', bpm: 140, priority: 1, layers: ['perc', 'strings'] },
    { when: { var: 'danger', gte: 2 }, mode: 'phrygian', bpm: 160, priority: 5, layers: ['perc', 'bass'] },
  ],
};
const errorsOf = doc => {
  const registry = new Registry(PRIMS), logic = buildLogic(registry, Logic);
  return preflight(doc, registry, logic).errors;
};

test('(a) preflight fills defaults for cues, music and mix levels', () => {
  const { checked } = compile(base(AUDIO), { primitives: PRIMS });
  const cfg = checked.doc.graphics[0].with;
  assert.equal(cfg.defaults, true);
  assert.equal(cfg.beatSync, true);
  assert.equal(cfg.duck, 0.3);
  assert.deepEqual(cfg.volume, { master: 1, music: 0.8, sfx: 1 });
  assert.equal(cfg.cues[2].cooldown, 0.05);
  assert.equal(cfg.cues[3].gain, 0.4);
  assert.equal(cfg.music[0].priority, 0);
  const plain = compile(base({ cues: [{ event: 'x' }], music: [{}] }), { primitives: PRIMS }).checked.doc.graphics[0].with;
  assert.deepEqual(plain.cues[0], { event: 'x', voice: 'blip', pitch: 440, gain: 0.4, cooldown: 0.05 });
  assert.deepEqual(plain.music[0].layers, ['pad', 'bass', 'lead', 'drums']);
});

test('(b) cues from stepped events: defaults merge, overrides, typed dedupe, cooldowns and when', () => {
  const { rt, checked } = compile(base(AUDIO), { primitives: PRIMS });
  const cfg = checked.doc.graphics[0].with, ctx = { last: {}, rt };
  const table = cueTable(cfg);
  assert.equal(table.hit.length, 2, 'document cues replace the built-in hit');
  assert.equal(table.hit[0].when.var, 'danger', 'cues with a when are tried first');
  assert.equal(table.landed[0].builtin, true, 'built-ins cover events the document does not name');
  assert.equal(cueTable({ ...cfg, defaults: false }).landed, undefined);
  for (const ev of ['jumped', 'damaged', 'item_gained', 'quest_complete', 'level_up', 'enter_zone', 'game_end', 'combo', 'chain', 'block_mined', 'boss_start'])
    assert.ok(DEFAULT_CUES.some(c => c.event === ev), ev);

  const frame = list => { rt.step({ actions: { emit: list } }); return scheduleCues(rt.state.events, cfg, { ...ctx, time: rt.state.time }); };
  let plays = frame([['jumped'], ['jumped'], ['hit'], ['defeated', {}, 'goblin'], ['defeated', {}, 'boss'], ['landed']]);
  const by = ev => plays.filter(p => p.event === ev);
  assert.equal(by('jumped').length, 1, 'one play per event name per frame');
  assert.equal(by('jumped')[0].voice, 'pluck', 'document cue overrides the built-in');
  assert.equal(by('hit')[0].voice, 'noise', 'when fails: falls through to the plain cue');
  assert.equal(by('defeated').length, 1, "'defeated' and 'defeated:goblin' play once");
  assert.equal(by('defeated:boss').length, 1, 'typed document cue wins for its subject');
  assert.equal(by('defeated:boss')[0].voice, 'chord');
  assert.equal(by('landed')[0].voice, 'thud', 'built-in cue');
  assert.ok(plays.every(p => p.at === rt.state.time));

  plays = frame([['jumped'], ['hit']]);
  assert.equal(by('jumped').length, 0, 'jumped is cooling down (0.1 s)');
  assert.equal(by('hit').length, 0, 'hit is cooling down (0.05 s)');
  run(rt, 6);
  rt.state.vars.danger = 1; // tests may set vars directly; the primitive never does
  plays = frame([['jumped'], ['hit'], ['combo', { count: 1 }]]);
  assert.equal(by('jumped').length, 1, 'cooled down');
  assert.equal(by('hit')[0].voice, 'bell', 'when cue plays while its predicate holds');
  const low = by('combo')[0].pitch;
  run(rt, 3);
  plays = frame([['combo', { count: 4 }]]);
  assert.ok(by('combo')[0].pitch > low, 'combo pitch rises with count');

  plays = frame([['damaged', { who: 'goblin' }]]);
  const soft = by('damaged')[0];
  run(rt, 6);
  plays = frame([['damaged', { who: 'player' }]]);
  assert.ok(by('damaged')[0].gain > soft.gain, 'player hurt is louder');

  // Not all of these come from rt.step: play the data helpers directly as well.
  const won = scheduleCues([{ name: 'game_end', outcome: 'won' }], cfg, { time: 0 })[0], lost = scheduleCues([{ name: 'game_end', outcome: 'lost' }], cfg, { time: 0 })[0];
  assert.equal(won.sting, 'win'); assert.equal(lost.sting, 'lose'); assert.notEqual(won.voice, lost.voice);
  const unknown = scheduleCues([{ name: 'hit' }], { cues: [{ event: 'hit', voice: 'bell', when: { nope: 1 } }] }, { time: 0, rt });
  assert.deepEqual(unknown, [], 'an unregistered predicate is false, never throws');
  assert.deepEqual(scheduleCues([{ name: 'constructor' }, { name: 'toString:x' }, { name: 'play_sound', cue: '__proto__' }, {}, null], cfg, { time: 0 }), [], 'odd names are ignored');
});

test('(b) first-time zone chime and music selection by zone and when', () => {
  const { rt, checked } = compile(base(AUDIO), { primitives: PRIMS });
  const cfg = checked.doc.graphics[0].with;
  assert.equal(rt.player().zone, 'a');
  assert.equal(selectMusic(rt, cfg), 0);
  rt.step({});
  rt.run([{ do: 'teleport', zone: 'b' }]);
  assert.equal(rt.player().zone, 'b');
  assert.equal(selectMusic(rt, cfg), 1, 'zone b entry');
  const chime = scheduleCues(rt.state.events, cfg, { time: 1, rt });
  assert.equal(chime.filter(p => p.event === 'enter_zone').length, 1, 'first visit to b chimes once');
  rt.step({}); rt.run([{ do: 'teleport', zone: 'a' }]); rt.run([{ do: 'teleport', zone: 'b' }]);
  assert.equal(scheduleCues(rt.state.events, cfg, { time: 5, rt }).filter(p => p.event === 'enter_zone').length, 0, 'no chime on a repeat visit');

  rt.state.vars.danger = 1;
  assert.equal(selectMusic(rt, cfg), 2, 'when entry beats the zone');
  rt.state.vars.danger = 2;
  assert.equal(selectMusic(rt, cfg), 3, 'higher priority wins');
  rt.state.vars.danger = 0;
  assert.equal(selectMusic(rt, cfg), 1);
  assert.equal(selectMusic(rt, { music: [{ when: { nope: 1 }, layers: ['pad'] }, { layers: ['bass'] }] }), 1, 'unknown predicate is false; plain entry is the default');
  assert.equal(selectMusic(rt, { music: [{ zone: 'zz', layers: ['pad'] }] }), -1);
  assert.equal(selectMusic({ player: () => ({ at: 'hall' }) }, { music: [{ zone: 'x' }, { zone: 'hall' }] }), 1, 'graph spaces: player.at is the zone');

  const plan = musicPlan(cfg.music[1], cfg, checked.doc);
  assert.deepEqual({ ...plan, key: 'k' }, { mood: 'mysterious', bpm: 50, key: 'k', scale: 'locrian', instrument: 'bell', layers: ['drone'] });
  assert.equal(musicPlan(null, cfg, checked.doc).mood, 'mysterious', 'mood from title and logline');
  assert.deepEqual(musicPlan(cfg.music[1], cfg, checked.doc), musicPlan(cfg.music[1], cfg, checked.doc));
  assert.equal(nextBar(1.3, 0.1, 120), 2.1);
  assert.equal(nextBar(2.1, 0.1, 120), 2.1);
  assert.equal(nextBar(0, 0.5, 120), 0.5);
});

test('(c) the play_sound effect emits play_sound and plays the named cue', () => {
  const { rt, checked } = compile(base(AUDIO, [{ use: 'gameplay.test.audio-fixture', with: { effects: [{ do: 'play_sound', cue: 'quest_complete' }, { do: 'play_sound', cue: 'jumped' }] } }]), { primitives: PRIMS });
  rt.step({ actions: { fire: 1 } });
  const ev = rt.state.events.filter(e => e.name === 'play_sound');
  assert.deepEqual(ev.map(e => e.cue), ['quest_complete', 'jumped']);
  assert.equal(rt.state.counts.play_sound, 2);
  const plays = scheduleCues(rt.state.events, checked.doc.graphics[0].with, { time: 0, rt });
  assert.deepEqual(plays.map(p => [p.event, p.voice]), [['quest_complete', 'chord'], ['jumped', 'pluck']]);
  assert.deepEqual(scheduleCues([{ name: 'play_sound', cue: 'bell' }], {}, { time: 0 }).map(p => p.voice), ['bell'], 'a bare voice name plays that voice');
  const errs = errorsOf(base({}, [{ use: 'gameplay.test.audio-fixture', with: { effects: [{ do: 'play_sound' }] } }]));
  assert.ok(errs.some(e => e.code === 'audio_cue_missing'), JSON.stringify(errs));
});

// Minimal WebAudio stand-in: records nodes and started sources; no sound.
function fakeAudio() {
  const log = { contexts: 0, started: [], gains: 0, closed: false };
  const param = v => ({ value: v, events: [], setValueAtTime(x, t) { this.value = x; this.events.push(['set', x, t]); }, linearRampToValueAtTime(x, t) { this.events.push(['lin', x, t]); },
    exponentialRampToValueAtTime(x, t) { assert.ok(x > 0, 'exponential ramps need a positive target'); this.events.push(['exp', x, t]); }, setTargetAtTime(x) { this.value = x; }, cancelScheduledValues() {} });
  const node = extra => ({ connect() {}, disconnect() {}, ...extra });
  class Ctx {
    constructor() { log.contexts++; this.currentTime = 0; this.sampleRate = 4000; this.state = 'running'; this.destination = node(); log.ctx = this; }
    createGain() { log.gains++; return node({ gain: param(1) }); }
    createBiquadFilter() { return node({ type: 'lowpass', frequency: param(350), Q: param(1) }); }
    createDynamicsCompressor() { return node({ threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) }); }
    createOscillator() { return node({ type: 'sine', frequency: param(440), detune: param(0), start(t) { log.started.push({ kind: 'osc', t }); }, stop() {} }); }
    createBufferSource() { return node({ playbackRate: param(1), start(t) { log.started.push({ kind: 'noise', t }); }, stop() {} }); }
    createBuffer(ch, len) { const data = new Float32Array(len); return { getChannelData: () => data }; }
    resume() { return Promise.resolve(); }
    close() { log.closed = true; this.state = 'closed'; }
  }
  const timers = [];
  return { log, Ctx, setTimer: f => { timers.push(f); return timers.length; }, clearTimer: () => {}, runTimers() { timers.splice(0).forEach(f => f()); } };
}

test('(b) mixer: lazy context, quantized crossfades, stem gains, duck, cooldowns and voice cap', () => {
  const fake = fakeAudio();
  const mixer = createMixer({ seed: 't', AudioContextImpl: fake.Ctx, setTimer: fake.setTimer, clearTimer: fake.clearTimer, voiceCap: 4 });
  const A = { mood: 'mysterious', bpm: 120, key: 'D', scale: 'dorian', instrument: 'bell', layers: ['pad', 'pluck', 'drone'] };
  const B = { ...A, scale: 'locrian', layers: ['drone', 'perc'] };
  mixer.setMusic(A);
  assert.equal(fake.log.contexts, 0, 'no AudioContext before unlock');
  assert.equal(mixer.playCue(voiceRecipe('blip')), false);
  assert.equal(mixer.unlock(), true); mixer.unlock();
  assert.equal(fake.log.contexts, 1);
  const ctx = fake.log.ctx;
  let s = mixer.inspect();
  assert.equal(s.tracks.length, 1);
  assert.deepEqual(s.tracks[0].stems, ['pad', 'pluck', 'drone'], 'one gain node per stem');
  const t0 = s.tracks[0].start;
  for (let i = 0; i < 40; i++) { ctx.currentTime += 0.03; fake.runTimers(); }
  assert.ok(fake.log.started.length > 5, 'stems keep scheduling');
  assert.ok(fake.log.started.every(n => n.t <= ctx.currentTime + 0.2), 'within the look-ahead window');

  mixer.setMusic(A);
  assert.equal(mixer.inspect().tracks.length, 1, 'the same plan does not restart');
  mixer.setMusic(B);
  s = mixer.inspect();
  const [old, next] = s.tracks;
  assert.equal(next.start, nextBar(ctx.currentTime + 0.05, t0, 120), 'switch lands on the next bar of the current clock');
  assert.ok(Math.abs(((next.start - t0) / 2) - Math.round((next.start - t0) / 2)) < 1e-9, 'a whole number of 2 s bars');
  assert.equal(old.end, next.start + 2, 'old track fades out over one bar');
  mixer.setStemLevel('perc', 0);
  for (let i = 0; i < 120; i++) { ctx.currentTime += 0.03; fake.runTimers(); }
  assert.deepEqual(mixer.inspect().tracks.map(t => t.stems), [['drone', 'perc']], 'old track retired after the crossfade');

  mixer.setPaused(true); assert.equal(mixer.paused, true);
  mixer.setMuted(true); assert.equal(mixer.muted, true); mixer.setMuted(false);
  mixer.setVolume({ master: 3, music: 0.2 });
  assert.deepEqual(mixer.inspect().volume, { master: 1, music: 0.2, sfx: 0.8 });

  const r = voiceRecipe('coin', { pitch: 880, gain: 0.3, seed: 't' });
  assert.equal(mixer.playCue(r, { key: 'coin', cooldown: 0.1 }), true);
  assert.equal(mixer.playCue(r, { key: 'coin', cooldown: 0.1 }), false, 'cooldown');
  for (let i = 0; i < 12; i++) mixer.playCue(r, { key: `k${i}`, cooldown: 0 });
  assert.ok(mixer.inspect().voices <= 4, 'voice cap');
  assert.equal(mixer.sting('win', B), true);
  assert.equal(mixer.inspect().desired, null, 'stinger stops the music');
  mixer.dispose();
  assert.ok(fake.log.closed);
  assert.equal(mixer.playCue(r), false);
});

const DOM_DOC = () => base(AUDIO);
const inputs = i => (i === 3 ? { actions: { emit: [['jumped'], ['hit'], ['defeated', {}, 'goblin']] } } : i === 5 ? { actions: { fire: 1 } } : {});

test('(d) deterministic replay with and without the graphics instance; silent without AudioContext', () => {
  const headless = base(AUDIO); headless.graphics = [];
  const { rt: plain } = compile(headless, { primitives: PRIMS });
  for (let i = 0; i < 30; i++) plain.step(inputs(i));

  assert.equal(globalThis.AudioContext, undefined);
  const m = mount(DOM_DOC(), { primitives: PRIMS });
  m.key('a'); // the gesture listener must not throw without an AudioContext
  for (let i = 0; i < 30; i++) m.frame(1, inputs(i));
  assert.deepEqual(m.rt.snapshot(), plain.snapshot());

  // With an AudioContext: unlocked by a key, plays cues and music, still no state writes.
  const fake = fakeAudio();
  globalThis.AudioContext = fake.Ctx;
  try {
    const m2 = mount(DOM_DOC(), { primitives: PRIMS });
    assert.equal(fake.log.contexts, 0, 'lazy until a gesture');
    m2.key('a');
    assert.equal(fake.log.contexts, 1);
    for (let i = 0; i < 30; i++) { fake.log.ctx.currentTime += 1 / 60; m2.frame(1, inputs(i)); }
    assert.ok(fake.log.started.length > 0, 'cues and music scheduled');
    assert.deepEqual(m2.rt.snapshot(), plain.snapshot());
    fake.log.ctx.close();
  } finally { delete globalThis.AudioContext; }
});

test('(e) preflight rejects bad configs with stable codes', () => {
  const codes = audio => errorsOf(base(audio)).map(e => e.code);
  assert.ok(codes({ cues: [{ event: 'hit', voice: 'kazoo' }] }).includes('param_option'));
  assert.ok(codes({ cues: [{ voice: 'blip' }] }).includes('param_missing'));
  assert.ok(codes({ cues: [{ event: 'hit', pitch: 9 }] }).includes('param_range'));
  assert.ok(codes({ music: [{ zone: 'a', layers: [] }] }).includes('audio_music_empty'));
  assert.ok(codes({ music: [{ zone: 'nowhere' }] }).includes('ref_unknown'));
  assert.ok(codes({ music: [{ mode: 'hypermode' }] }).includes('param_option'));
  assert.ok(codes({ cues: [{ event: 'hit' }, { event: 'hit', voice: 'bell' }] }).includes('audio_cue_duplicate'));
  assert.ok(!codes({ cues: [{ event: 'hit' }, { event: 'hit', when: { var: 'x', gte: 1 } }] }).includes('audio_cue_duplicate'));
  assert.deepEqual(codes(AUDIO), []);
});

test('(f) every graphics.audio.synth instance in v2/games preflights without param, ref or audio errors', () => {
  let found = 0;
  for (const file of fs.readdirSync(GAMES).filter(f => f.endsWith('.json'))) {
    const game = JSON.parse(fs.readFileSync(new URL(file, GAMES), 'utf8'));
    for (const inst of (game.graphics || []).filter(g => g.use === 'graphics.audio.synth')) {
      found++;
      const doc = {
        schema: game.schema, id: game.id, title: game.title, logline: game.logline,
        spaces: game.spaces.map(s => ({ id: s.id, use: 'engine.space.test', zones: s.zones || [] })),
        content: { archetypes: game.content?.archetypes || [] }, player: structuredClone(game.player), systems: [], graphics: [inst],
      };
      const bad = errorsOf(doc).filter(e => e.path.startsWith('graphics[0]') && /^(param_|ref_|audio_)/.test(e.code));
      assert.deepEqual(bad, [], file);
      const registry = new Registry(PRIMS), logic = buildLogic(registry, Logic);
      const cfg = preflight({ ...doc, graphics: [{ use: inst.use, with: { ...inst.with, music: inst.with.music.filter(m => !m.when || logic.kindOf(m.when)) } }] }, registry, logic);
      for (const entry of cfg.doc?.graphics[0].with.music || []) {
        const plan = musicPlan(entry, cfg.doc.graphics[0].with, doc);
        assert.ok(composeStems(doc.id, plan).stems.length === plan.layers.length, `${file}: every layer becomes a stem`);
      }
    }
  }
  assert.ok(found >= 3, `found ${found} instances`);
});

test('(g) composeStems keeps every pitched note in the scale; stemsFor is deterministic', () => {
  const layers = [...Object.keys(LAYER_STEMS), 'mystery_layer', 'war_drums'];
  for (const scale of SCALE_NAMES) for (const key of ['C', 'F#', 'Bb']) for (const mood of [undefined, 'spooky']) {
    const out = composeStems(`g-${scale}`, { mood, bpm: 90, key, scale, layers }, { variant: key === 'C' ? 'title' : 'play' });
    const allowed = new Set(pitchClasses(out.music));
    assert.equal(out.stems.length, layers.length);
    for (const stem of out.stems) for (const e of stem.events) {
      assert.ok(e.t >= 0 && e.t < out.beats && e.dur > 0 && e.vel > 0 && e.vel <= 1, `${scale}/${stem.name}`);
      if (e.midi === undefined) continue;
      assert.ok(Number.isInteger(e.midi) && e.midi >= 24 && e.midi <= 108, `${scale}/${stem.name}: midi ${e.midi}`);
      assert.ok(allowed.has(e.midi % 12), `${scale}/${key}/${mood}: ${stem.name} note ${e.midi} not in scale`);
    }
  }
  const s = composeStems('x', { bpm: 50, key: 'E', scale: 'phrygian', layers: ['drone', 'drip', 'wind', 'perc', 'strings', 'choir'] });
  assert.equal(s.bpm, 50);
  assert.deepEqual(s.stems.map(x => x.part), ['drone', 'texture', 'texture', 'kick', 'pad', 'pad']);
  assert.ok(s.stems.every(x => x.events.length > 0), 'every stem has events');
  const pads = s.stems.filter(x => x.part === 'pad');
  assert.ok(pads[1].events[0].midi === pads[0].events[0].midi + 12, 'a second pad stem sits an octave up');
  assert.ok(new Set(s.stems[3].events.map(e => e.part)).size === 3, 'perc is kick, snare and hat');
  assert.deepEqual(composeStems('x', { bpm: 50, key: 'E', scale: 'phrygian', layers: ['drone'] }), composeStems('x', { bpm: 50, key: 'E', scale: 'phrygian', layers: ['drone'] }));
  for (const st of s.stems) for (const ev of st.events.slice(0, 3)) assert.ok(noteLayers(ev, st.instrument, 0.5).length > 0);
  // Requested layers play through the loop even where the mood's arrangement is thin.
  const heroic = composeStems('h', { mood: 'heroic', bpm: 120, key: 'G', scale: 'major', layers: ['lute'] });
  assert.ok(heroic.sections.every(sec => heroic.stems[0].events.some(e => e.t >= sec.startBar * 4 && e.t < (sec.startBar + sec.bars) * 4)), 'arp in every section');
  assert.ok(composeStems('d', { mood: 'dreamy', bpm: 80, key: 'G', scale: 'lydian', layers: ['anvil'] }).stems[0].events.length > 0, 'soft groove still gets an anvil');

  const names = ['lute', 'war_drums', 'zz-unknown', 'Glass Harp', 'lute'];
  assert.deepEqual(stemsFor(names), stemsFor(names));
  assert.equal(stemsFor(names).length, 4, 'duplicates collapse');
  assert.equal(stemsFor(['war_drums'])[0].part, 'kick');
  for (const n of ['zz-unknown', 'qqq', 'glass harp']) assert.ok(STEM_PARTS.includes(stemsFor([n])[0].part), n);
  for (const n of ['bass', 'perc', 'drum', 'drums', 'anvil', 'synth', 'drone', 'strings', 'choir', 'organ', 'pad', 'accordion', 'pluck', 'lute', 'bell', 'whistle', 'horn', 'radio', 'wind', 'surf', 'drip', 'lead', 'arp', 'piano', 'brass'])
    assert.ok(STEM_PARTS.includes(LAYER_STEMS[n]?.part), n);
});

test('voice recipes are well formed, bounded by gain and deterministic; UI sounds exist', () => {
  for (const v of VOICE_NAMES) for (const gain of [0.2, 1]) {
    const r = voiceRecipe(v, { pitch: 440, gain, seed: 's' });
    assert.deepEqual(r, voiceRecipe(v, { pitch: 440, gain, seed: 's' }));
    const peak = Math.max(...r.layers.map(A => r.layers.filter(L => (L.at || 0) <= (A.at || 0) && (L.at || 0) + L.dur > (A.at || 0)).reduce((s, L) => s + L.vol, 0)));
    assert.ok(peak <= 0.6 * gain + 1e-9, `${v} too loud: ${peak}`);
    for (const L of r.layers) {
      assert.ok(['sine', 'square', 'sawtooth', 'triangle', 'noise'].includes(L.wave), v);
      assert.ok(L.dur > 0 && L.dur < 2 && (L.at || 0) >= 0, v);
      if (L.wave !== 'noise') assert.ok(L.f0 > 20 && L.f0 < 12000 && (L.f1 === undefined || L.f1 > 20), v);
    }
  }
  assert.equal(voiceRecipe('kazoo'), null);
  assert.ok(voiceRecipe('blip', { decay: 0.5 }).layers[0].dur > voiceRecipe('blip').layers[0].dur);
  for (const n of ['move', 'confirm', 'back', 'open', 'close', 'error', 'type', 'menu_move']) assert.ok(uiRecipe(n)?.recipe.layers.length, n);
  assert.equal(uiRecipe('type').cooldown, 0.045);
  assert.ok(uiRecipe('type').recipe.layers[0].vol < 0.05 && uiRecipe('type').recipe.layers[0].dur < 0.03);
  assert.equal(uiRecipe('nope'), null);
});
