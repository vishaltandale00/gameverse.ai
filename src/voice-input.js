import {RecordedTranscription} from './recorded-transcription.js';
import { StandardGamepadInput } from './gamepad.js';
import { LiveTranscription } from './live-transcription.js';

// The host supplies pause/resume and target capture; this module owns microphone
// lifetime, asynchronous cancellation and the audio -> transcript -> receipt flow.
export class VoiceInput {
  constructor({ captureContext, pause, changed, canStart = () => true, transcriptOnly = false, fetchImpl = (...args) => fetch(...args),
    getUserMedia = options => navigator.mediaDevices.getUserMedia(options), createStream = null, prepare = async () => {}, onCancel = () => {} }) {
    Object.assign(this, { captureContext, pause, changed, canStart, transcriptOnly, fetchImpl, getUserMedia, createStream, prepare, onCancel });
    this.pad = new StandardGamepadInput(); this.config = { recordButton: 11, maxSeconds: 120, maxBytes: 10 * 1024 * 1024 };
    this.state = 'idle'; this.run = null;
  }
  get active() { return this.run !== null; }
  get capturing() { return this.active && !this.run.background; }
  emit(state, data = {}) { this.state = state; this.changed({ state, background: Boolean(this.run?.background), ...data }); }
  async configure() {
    const response = await this.fetchImpl('/api/voice/config', { signal: AbortSignal.timeout(35000) });
    if (!response.ok) throw Error('The voice backend is unavailable. Check your account and connection.');
    this.config = await response.json(); return this.config;
  }
  poll(gamepads, enabled) {
    if (!enabled) { this.pad.reset(); return; }
    const pad = this.pad.sample(gamepads);
    if (pad.disconnected && this.active) { void this.cancel(); return; }
    if (!pad.buttons[1]) this.cancelHeld = false;
    const ownsB = this.cancelHeld || (this.active && !this.run.background);
    if (ownsB && pad.buttons[1]) this.cancelHeld = true;
    if (this.active && !this.run.background) {
      if (pad.pressed[1]) void this.cancel();
      else if (pad.pressed[this.config.recordButton]) this.toggle();
    } else if (!this.active && pad.pressed[this.config.recordButton] && this.canStart()) this.toggle();
    return Boolean(this.cancelHeld);
  }

  toggle() {
    if (this.state === 'cancelling') return;
    if (!this.active) { if (this.canStart()) void this.start(); }
    else if (this.state === 'recording') this.stop();
    else if (['received', 'error'].includes(this.state)) void this.close();
  }
  async start() {
    if (this.active || this.state === 'cancelling') return;
    const run = { id: crypto.randomUUID(), context: structuredClone(this.captureContext()), abort: new AbortController() };
    this.run = run; this.emit('opening', { context: run.context });
    try {
      run.resume = await this.pause();
      if (this.run !== run) { await run.resume?.(); return; }
      await this.configure();
      if (this.run !== run) return;
      if (!this.config.available) throw Error(this.config.reason || `Voice input is unavailable. Configure ${this.config.provider === 'openai' ? 'OPENAI_API_KEY' : 'the transcription provider'} on the server.`);
      if(this.transcriptOnly&&this.config.execution==='daytona')throw Error('Use typed character names with hosted voice. Game takeover is available while playing soccer.');
      await this.prepare({context:run.context,config:this.config,requestId:run.id});
      if(this.run!==run)return;
      const stream = await this.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
      if (this.run !== run) { stream.getTracks().forEach(track => track.stop()); return; }
      run.stream = stream;
      run.live = (this.createStream || (options => this.config.mode==='recorded' ? new RecordedTranscription({...options,fetchImpl:this.fetchImpl}) : new LiveTranscription(options)))({ stream, requestId: run.id, config: this.config, signal: run.abort.signal,
        onText: text => { if (this.run === run && this.state === 'recording') this.emit('recording', { text, maxSeconds: this.config.maxSeconds, startedAt: run.startedAt }); },
        onError: error => this.fail(run, error),
      });
      await run.live.start();
      if (this.run !== run) { run.live.cancel(); return; }
      for (const track of stream.getTracks()) track.addEventListener('ended', () => {
        if (this.run === run && this.state === 'recording') this.fail(run, Error('The microphone disconnected. Cancel and try again.'));
      });
      run.startedAt = Date.now();
      run.timer = setTimeout(() => this.stop(), this.config.maxSeconds * 1000);
      this.emit('recording', { maxSeconds: this.config.maxSeconds, startedAt: run.startedAt });
    } catch (error) { this.fail(run, error); }
  }
  release(run) {
    clearTimeout(run.timer);
    run.live?.cancel();
    run.stream?.getTracks().forEach(track => track.stop());
  }
  stop() {
    const run = this.run;
    if (!run || this.state !== 'recording') return;
    run.background = !this.transcriptOnly; clearTimeout(run.timer); this.emit('transcribing'); void this.transcribe(run);
  }
  async transcribe(run) {
    try {
      const transcript = await run.live.stop();
      if (this.run !== run) return;
      if (typeof transcript.text !== 'string' || !transcript.text.trim() || transcript.text.length > 32000) throw Error('No valid speech transcript was received. Try again.');
      if (this.transcriptOnly) {
        // Field dictation returns a draft to its owner, never an improvement request.
        this.release(run); this.run = null; this.state = 'idle';
        this.changed({ state: 'received', background: false, text: transcript.text });
        return;
      }
      this.emit('processing', { text: transcript.text });
      run.submitting = true;
      const receipt = await this.request('/api/voice/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: run.abort.signal,
        body: JSON.stringify({ requestId: run.id, text: transcript.text, context: run.context, transcriptionMs: transcript.transcriptionMs, transcriptionMode: this.config.mode || 'realtime' }),
      });
      if (this.run !== run) return;
      if (receipt.status === 'cancelled') { await this.close(); return; }
      this.emit('received', { text: transcript.text, requestId: receipt.requestId });
      if (run.background) { this.release(run); this.run = null; this.state = 'idle'; }
    } catch (error) { this.fail(run, error); }
  }
  async request(path, options) {
    const timeout = AbortSignal.timeout((this.config.timeoutMs || 30000) + 5000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const response = await this.fetchImpl(path, { ...options, signal });
    let result;
    try { result = await response.json(); } catch { throw Error('Voice backend returned an invalid response. Try again.'); }
    if (!response.ok) throw Error(result.error?.code || result.error || 'Voice request failed. Try again.');
    return result;
  }
  fail(run, error) {
    if (this.run !== run) return;
    if(this.config.execution==='daytona')this.onCancel({requestId:run.id});
    this.emit('error', { message: error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow the microphone in your browser, then try again.' : error.message });
    this.release(run);
    if (run.background || this.transcriptOnly) { this.run = null; this.state = 'idle'; }
  }
  async cancel() {
    const run = this.run;
    if (!run) return;
    // Invalidate before stopping: stream events, permission grants and late HTTP results
    // must never submit the cancelled recording.
    this.run = null; run.abort.abort(); this.release(run);
    this.onCancel({requestId:run.id});
    this.emit('cancelling', { background: Boolean(run.background) });
    try {
      if (run.submitting) await this.request(`/api/voice/requests/${run.id}`, { method: 'DELETE' });
      this.emit('idle', { cancelled: true, background: Boolean(run.background) });
    } catch {
      this.emit('idle', { warning: `Cancellation could not be confirmed for request ${run.id}. Check the local backend before retrying.` });
    } finally { await run.resume?.(); }
  }
  async close() {
    if (this.state !== 'received') { await this.cancel(); return; }
    const run = this.run; this.run = null; this.release(run); this.emit('idle'); await run.resume?.();
  }
}
