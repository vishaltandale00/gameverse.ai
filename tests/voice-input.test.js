import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceInput } from '../src/voice-input.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const reply = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function fixture(options = {}) {
  const calls = [], views = [], tracks = [Object.assign(new EventTarget(), { stopped: false, stop() { this.stopped = true; } })], streams = [];
  let resumed = 0;
  const context = { role: 'subgame', gameId: 'firered', identity: { cartridgeSha256: 'original' } };
  const voice = new VoiceInput({ captureContext: () => context, pause: async () => async () => { resumed++; }, changed: view => views.push(view),
    getUserMedia: async () => ({ getTracks: () => tracks }),
    createStream: streamOptions => {
      const stream = { options: streamOptions, cancelled: false, start: async () => {},
        stop: async () => { tracks.forEach(track => track.stop()); return { text: 'Add a forest quest.', transcriptionMs: 12 }; },
        cancel() { this.cancelled = true; tracks.forEach(track => track.stop()); } };
      streams.push(stream); return stream;
    },
    fetchImpl: async (path, init) => {
      calls.push({ path, init });
      if (path.endsWith('/config')) return reply({ provider: 'openai', mode: 'realtime', model: 'gpt-live-transcribe', available: true, maxBytes: 1000, maxSeconds: 120, recordButton: 11 });
      return reply({ requestId: JSON.parse(init.body || '{}').requestId, status: init.method === 'DELETE' ? 'cancelled' : 'received' });
    }, ...options });
  return { voice, calls, views, tracks, streams, context, resumed: () => resumed };
}
const pad = () => ({ index: 0, id: 'Xbox', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) });

test('R3 streams once per press, shows live text, then submits and completes in the background', async () => {
  const f = fixture(), controller = pad(); f.voice.poll([controller], true);
  controller.buttons[11].pressed = true; f.voice.poll([controller], true); await tick();
  assert.equal(f.voice.state, 'recording'); f.voice.poll([controller], true); assert.equal(f.streams.length, 1);
  const started = f.voice.run.startedAt;
  f.streams[0].options.onText('Add a forest');
  assert.equal(f.views.at(-1).text, 'Add a forest'); assert.equal(f.views.at(-1).startedAt, started);
  assert.equal(f.calls.some(call => call.path === '/api/voice/requests'), false, 'partials cannot submit work');
  f.context.gameId = 'other-game';
  controller.buttons[11].pressed = false; f.voice.poll([controller], true);
  controller.buttons[11].pressed = true; f.voice.poll([controller], true); await tick();
  assert.equal(f.voice.state, 'idle'); assert.ok(f.tracks.every(track => track.stopped));
  const submission = JSON.parse(f.calls.find(call => call.path === '/api/voice/requests').init.body);
  assert.equal(submission.context.gameId, 'firered'); assert.equal(submission.text, 'Add a forest quest.'); assert.equal(submission.transcriptionMode, 'realtime');
  assert.equal(f.views.at(-1).state, 'received'); assert.equal(f.views.at(-1).background, true);
  assert.equal(f.resumed(), 0, 'background completion must not steal gameplay focus or resume twice');
  assert.equal(f.calls.some(call => call.init?.method === 'DELETE'), false);

});

test('cancel during microphone permission stops a late-granted stream without connecting', async () => {
  const permission = deferred(), f = fixture({ getUserMedia: () => permission.promise });
  const starting = f.voice.start(); await tick(); await f.voice.cancel();
  permission.resolve({ getTracks: () => f.tracks }); await starting;
  assert.equal(f.voice.state, 'idle'); assert.equal(f.streams.length, 0);
  assert.ok(f.tracks.every(track => track.stopped)); assert.equal(f.calls.length, 1); assert.equal(f.resumed(), 1);
});

test('B cancels live streaming and ignores partial or final events that arrive late', async () => {
  const pending = deferred(), f = fixture(); await f.voice.start();
  const stream = f.streams[0]; stream.options.onText('Provisional text'); stream.stop = () => pending.promise;
  f.voice.stop(); await tick(); assert.equal(f.voice.state, 'transcribing'); await f.voice.cancel();
  stream.options.onText('Late partial'); pending.resolve({ text: 'Late final' }); await tick();
  assert.equal(f.voice.state, 'idle'); assert.equal(f.calls.some(call => call.path === '/api/voice/requests'), false);
  assert.equal(stream.cancelled, true); assert.ok(f.tracks.every(track => track.stopped));
});

test('cancel during request submission records a cancellation and ignores a late receipt', async () => {
  const pending = deferred(), f = fixture(), realFetch = f.voice.fetchImpl;
  f.voice.fetchImpl = (path, init) => path === '/api/voice/requests' ? pending.promise : realFetch(path, init);
  await f.voice.start(); f.voice.stop(); await tick(); assert.equal(f.voice.state, 'processing');
  const id = f.voice.run.id; await f.voice.cancel(); pending.resolve(reply({ requestId: id, status: 'received' })); await tick();
  assert.equal(f.voice.state, 'idle'); assert.equal(f.calls.at(-1).path, `/api/voice/requests/${id}`); assert.equal(f.resumed(), 1);
});

test('permission denial and stream failure show errors, close audio and never submit partial text', async () => {
  const denied = fixture({ getUserMedia: async () => { throw Object.assign(Error('Denied'), { name: 'NotAllowedError' }); } });
  await denied.voice.start(); assert.equal(denied.voice.state, 'error'); assert.match(denied.views.at(-1).message, /permission was denied/); await denied.voice.cancel();
  const f = fixture(); await f.voice.start(); f.streams[0].options.onText('Unfinished text'); f.streams[0].options.onError(Error('Provider disconnected'));
  assert.equal(f.voice.state, 'error'); assert.ok(f.tracks.every(track => track.stopped));
  assert.equal(f.calls.some(call => call.path === '/api/voice/requests'), false); await f.voice.cancel(); assert.equal(f.resumed(), 1);
});

test('hidden input and held R3 on reconnect cannot start a stream', async () => {
  const f = fixture(), controller = pad(); controller.buttons[11].pressed = true;
  f.voice.poll([controller], false); f.voice.poll([controller], true); await tick(); assert.equal(f.voice.state, 'idle');
  controller.buttons[11].pressed = false; f.voice.poll([controller], true);
  controller.buttons[11].pressed = true; f.voice.poll([controller], true); await tick(); assert.equal(f.voice.state, 'recording');
  f.voice.poll([], true); await tick(); assert.equal(f.voice.state, 'idle');
});

test('empty final transcripts never submit a backend request', async () => {
  const f = fixture(); await f.voice.start(); f.streams[0].stop = async () => ({ text: ' ' });
  f.voice.stop(); await tick(); assert.equal(f.voice.state, 'idle'); assert.equal(f.views.at(-1).state, 'error');
  assert.equal(f.calls.some(call => call.path === '/api/voice/requests'), false); await f.voice.cancel();
});

test('name dictation returns the final draft in the foreground without saving feedback', async () => {
  const f = fixture({ transcriptOnly: true }); await f.voice.start();
  f.streams[0].options.onText('Vi');
  f.streams[0].stop = async () => ({ text: 'Vishal', transcriptionMs: 12 });
  f.voice.stop(); assert.equal(f.views.at(-1).background, false); await tick();
  assert.equal(f.views.at(-1).text, 'Vishal'); assert.equal(f.views.at(-1).state, 'received');
  assert.equal(f.voice.active, false); assert.ok(f.tracks.every(track => track.stopped));
  assert.equal(f.calls.some(call => call.path === '/api/voice/requests'), false);
});

test('B still cancels name finalization and a late final cannot replace the draft', async () => {
  const f = fixture({ transcriptOnly: true }), controller = pad(), final = deferred();
  f.voice.poll([controller], true); await f.voice.start();
  f.streams[0].stop = () => final.promise; f.voice.stop();
  controller.buttons[1].pressed = true; assert.equal(f.voice.poll([controller], true), true);
  await tick(); final.resolve({ text: 'Discarded name' }); await tick();
  assert.equal(f.voice.active, false); assert.equal(f.views.some(view => view.state === 'received'), false);
  assert.equal(f.voice.poll([controller], true), true, 'held B remains consumed');
  assert.equal(f.calls.length, 1, 'only config was fetched');
});

test('empty name speech remains an actionable foreground error and can be retried', async () => {
  const f = fixture({ transcriptOnly: true }); await f.voice.start();
  f.streams[0].stop = async () => ({ text: ' ' }); f.voice.stop(); await tick();
  assert.equal(f.voice.active, false); assert.equal(f.views.at(-1).state, 'error'); assert.equal(f.views.at(-1).background, false);
  await f.voice.cancel(); await f.voice.start(); assert.equal(f.voice.state, 'recording');
  await f.voice.cancel(); assert.equal(f.calls.some(call => call.path === '/api/voice/requests'), false);
});

test('cancel during connection closes a late-started stream without rearming recording', async () => {
  const ready = deferred(), f = fixture(); const original = f.voice.createStream;
  f.voice.createStream = options => { const stream = original(options); stream.start = () => ready.promise; return stream; };
  const starting = f.voice.start(); await tick(); await f.voice.cancel(); ready.resolve(); await starting;
  assert.equal(f.voice.state, 'idle'); assert.equal(f.streams[0].cancelled, true); assert.equal(f.resumed(), 1);
});

test('B cancels while recording without leaking the held press; after R3 submit B belongs to gameplay', async () => {
  const f = fixture(), controller = pad(); f.voice.poll([controller], true); await f.voice.start();
  controller.buttons[1].pressed = true;
  assert.equal(f.voice.poll([controller], true), true); await tick(); assert.equal(f.voice.state, 'idle');
  assert.equal(f.voice.poll([controller], true), true, 'held cancellation must not become a game B action');
  controller.buttons[1].pressed = false; assert.equal(f.voice.poll([controller], true), false);
  await f.voice.start(); const final = deferred(); f.streams.at(-1).stop = () => final.promise;
  f.voice.stop(); assert.equal(f.views.at(-1).background, true);
  controller.buttons[1].pressed = true; assert.equal(f.voice.poll([controller], true), false);
  assert.equal(f.voice.active, true, 'gameplay B must not cancel a submitted request');
  final.resolve({ text: 'Final request' }); await tick(); assert.equal(f.voice.active, false);
});
