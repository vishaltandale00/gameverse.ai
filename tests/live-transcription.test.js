import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { LiveTranscription } from '../src/live-transcription.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const sockets = [], texts = [], errors = [], tracks = [{ stopped: false, stop() { this.stopped = true; } }], sent = [];
  class Socket {
    constructor() { this.readyState = 1; this.bufferedAmount = 0; sockets.push(this); queueMicrotask(() => this.event({ type: 'ready' })); }
    event(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
    send(data) { sent.push(data); if (typeof data === 'string' && JSON.parse(data).type === 'stop') queueMicrotask(() => this.event({ type: 'final', text: 'Correct final text' })); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  class Audio {
    constructor() { this.sampleRate = 24000; this.state = 'running'; this.audioWorklet = { addModule: async () => {} }; this.destination = {}; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    resume() { return Promise.resolve(); } close() { this.state = 'closed'; return Promise.resolve(); }
  }
  class Worklet {
    constructor() { this.port = { postMessage: () => queueMicrotask(() => {
      this.port.onmessage({ data: { type: 'audio', buffer: new ArrayBuffer(80) } }); this.port.onmessage({ data: { type: 'flushed' } });
    }) }; }
    connect() {} disconnect() {}
  }
  const abort = new AbortController();
  const live = new LiveTranscription({ stream: { getTracks: () => tracks }, requestId: crypto.randomUUID(), config: { maxBytes: 10000, timeoutMs: 100 },
    signal: abort.signal, onText: text => texts.push(text), onError: error => errors.push(error.message), Socket, Audio, Worklet, ...options });
  return { live, sockets, tracks, sent, texts, errors, abort };
}

test('live text arrives before stop; worklet tail audio precedes commit and final text wins', async () => {
  const f = fixture(); await f.live.start();
  f.sockets[0].event({ type: 'transcript', itemId: 'one', delta: 'Provisional ' }); f.sockets[0].event({ type: 'transcript', itemId: 'one', delta: 'text' });
  assert.equal(f.texts.at(-1), 'Provisional text'); assert.equal(f.sent.length, 0);
  const final = await f.live.stop(); assert.equal(final.text, 'Correct final text');
  assert.ok(f.sent[0] instanceof ArrayBuffer); assert.deepEqual(JSON.parse(f.sent[1]), { type: 'stop' });
  assert.equal(f.tracks[0].stopped, true); assert.equal(f.sockets[0].readyState, 3); assert.deepEqual(f.errors, []);
});

test('disconnection and backpressure fail visibly and release audio', async () => {
  for (const action of ['disconnect', 'pressure']) {
    const f = fixture(); await f.live.start();
    if (action === 'disconnect') f.sockets[0].close();
    else { f.sockets[0].bufferedAmount = 300000; f.live.node.port.onmessage({ data: { type: 'audio', buffer: new ArrayBuffer(100) } }); }
    assert.equal(f.tracks[0].stopped, true); assert.equal(f.errors.length, 1); assert.equal(f.live.cancelled, true);
  }
});

test('cancellation closes connection and late transcript events are ignored', async () => {
  const f = fixture(); await f.live.start(); f.abort.abort();
  f.sockets[0].event({ type: 'transcript', itemId: 'late', delta: 'Must not appear' });
  assert.deepEqual(f.texts, []); assert.ok(f.tracks[0].stopped); assert.equal(f.sockets[0].readyState, 3);
});

test('sample-rate mismatch cannot silently send audio at the wrong speed', async () => {
  class WrongAudio { constructor() { this.sampleRate = 48000; this.state = 'running'; } close() { return Promise.resolve(); } }
  const f = fixture({ Audio: WrongAudio }); await assert.rejects(f.live.start(), /sample rate/); f.live.cancel(); assert.ok(f.tracks[0].stopped);
});

test('actual worklet emits PCM16 with clipping, then flushes its final partial frame in order', async () => {
  const messages = [], sandbox = { AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } }, registerProcessor(name, processor) { sandbox.Processor = processor; } };
  vm.createContext(sandbox); vm.runInContext(await readFile(new URL('../src/voice-worklet.js', import.meta.url), 'utf8'), sandbox);
  const worklet = new sandbox.Processor(); worklet.process([[Float32Array.from([-2, -.5, 0, .5, 2])]]);
  assert.equal(messages.length, 0); worklet.port.onmessage({ data: { type: 'flush' } });
  assert.deepEqual(Array.from(new Int16Array(messages[0].buffer)), [-32768, -16384, 0, 16383, 32767]);
  assert.equal(messages[1].type, 'flushed'); worklet.process([[new Float32Array(3000)]]); assert.equal(messages.length, 2);
});
