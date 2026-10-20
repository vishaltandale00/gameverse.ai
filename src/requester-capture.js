// Simulated-requester speech capture. The requester harness produces real audio
// bytes through the server-side speech boundary; this module plays them into a
// real MediaStream so the ordinary VoiceInput -> LiveTranscription -> agent path
// runs unchanged. There is deliberately no way to inject a transcript or call a
// gameplay tool from here: the requester's only route into the app is audio.
export const REQUESTER_CAPTURE_VERSION = 'requester-capture-v1';

// Base64 for retained audio. Spreading a whole utterance into String.fromCharCode
// overflows the argument limit (a 3 s 24 kHz 16-bit WAV is ~144 kB), so encode in
// chunks. Nothing is dropped silently: an over-cap utterance is flagged.
const MAX_RETAINED_AUDIO_BYTES = 8 * 1024 * 1024;
export function encodeAudioBase64(bytes) {
  const total = bytes.byteLength;
  const kept = Math.min(total, MAX_RETAINED_AUDIO_BYTES);
  let binary = '';
  for (let offset = 0; offset < kept; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 8192, kept)));
  }
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return { base64, bytes: total, retainedBytes: kept, truncated: kept < total };
}

export function createRequesterCapture({
  speech,                                   // ({text, runId}) -> {audio, mime}
  createAudioContext = () => new AudioContext(),
  preRollSeconds = Number(globalThis.__gameverseRequesterPreRoll ?? 1.2),
  log = () => {},
} = {}) {
  const emitted = [];
  const state = { capture: null };
  let queued = null;

  // The harness's speech action calls this. Audio is held for the next capture
  // the app opens; it never bypasses the microphone path.
  async function say({ text, voice = null, runId = null, requestedAt = null }) {
    const result = await speech({ text, voice, runId });
    if (!result?.audio?.byteLength) throw Error('The speech boundary returned no audio.');
    queued = { text, runId, audio: result.audio, mime: result.mime || 'audio/wav', requestedAt, queuedAt: Date.now() };
    // Retained so the host can mux real speech audio against frame timestamps.
    const encoded = encodeAudioBase64(result.audio);
    emitted.push({ text, runId, bytes: encoded.bytes, retainedBytes: encoded.retainedBytes, truncated: encoded.truncated,
      mime: queued.mime, at: queued.queuedAt, audioBase64: encoded.base64 });
    log({ event: 'requester-speech-queued', runId, bytes: result.audio.byteLength, mime: queued.mime });
    return { bytes: result.audio.byteLength, mime: queued.mime, requestId: null };
  }

  // Drop-in replacement for navigator.mediaDevices.getUserMedia. The returned
  // stream carries decoded speech audio, so transcription sees actual sound.
  async function getUserMedia(constraints = { audio: true }) {
    if (!queued) throw Object.assign(Error('No simulated requester speech is queued.'), { name: 'NotFoundError' });
    const pending = queued; queued = null;
    const context = createAudioContext();
    const buffer = await context.decodeAudioData(pending.audio.buffer ? pending.audio.buffer.slice(0) : pending.audio);
    const destination = context.createMediaStreamDestination();
    const source = context.createBufferSource();
    source.buffer = buffer; source.connect(destination);
    const stream = destination.stream;
    // Pre-roll: the consumer (VoiceInput -> LiveTranscription) needs its worklet
    // and realtime socket up before the first word, so playback starts a short
    // delay into the future instead of immediately.
    const startAt = (context.currentTime || 0) + preRollSeconds;
    state.capture = { text: pending.text, runId: pending.runId, bytes: pending.audio.byteLength,
      seconds: buffer.duration, startedAt: Date.now(), preRollSeconds, contextTimeAtOpen: context.currentTime ?? null,
      playbackStartsAt: startAt, drained: false, endedAt: null };
    // The utterance ending is NOT a device disconnect: leave every track live and
    // emitting silence so the app's own stop path owns the stream lifetime.
    source.onended = () => { state.capture.drained = true; state.capture.endedAt = Date.now();
      log({ event: 'requester-speech-drained', runId: pending.runId, seconds: buffer.duration }); };
    source.start(startAt);
    log({ event: 'requester-speech-capturing', runId: pending.runId, seconds: buffer.duration, preRollSeconds, constraints: Object.keys(constraints) });
    return stream;
  }

  return {
    version: REQUESTER_CAPTURE_VERSION, say, getUserMedia,
    // Real capture lifecycle, so circuits gate on audio instead of a fixed delay.
    get capture() { return state.capture ? { ...state.capture } : null; },
    get speaking() { return Boolean(state.capture && !state.capture.drained); },
    get pending() { return queued ? { text: queued.text, runId: queued.runId, bytes: queued.audio.byteLength } : null; },
    evidence: () => emitted.slice(-20),
  };
}

// Harness-side speech action for a requester run: the circuit chooses speech, the
// capture queues audio, and the app's own voice button/record path consumes it.
export function requesterSpeechAdapter(capture) {
  return async ({ text, voice, runId, requestedAt }) => {
    const queued = await capture.say({ text, voice, runId, requestedAt });
    return { ...queued, audio: new Uint8Array(0), viaCapture: true };
  };
}
