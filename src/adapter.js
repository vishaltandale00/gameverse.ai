export class GbaAdapter {
  constructor(canvas, onFailure) {
    this.worker = new Worker('/src/emulator-worker.js');
    this.canvas = canvas;
    this.pending = new Map();
    this.audio = new AudioContext();
    this.gain = this.audio.createGain(); this.gain.gain.value = .5; this.gain.connect(this.audio.destination);
    this.audio.resume().catch(() => {});
    this.audioTime = 0;
    this.voices = new Set();
    this.allowAudio = false;
    this.onFailure = onFailure;
    this.worker.onmessage = ({ data }) => {
      if (data.event === 'failure') { this.silence(); onFailure(Error(data.error)); return; }
      if (data.event === 'audio') { this.playAudio(data); return; }
      const pending = this.pending.get(data.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(data.id);
      if (data.error) pending.reject(Error(data.error)); else pending.resolve(data.result);
    };
    this.worker.onerror = event => { this.silence(); onFailure(Error(event.message || 'Emulator worker failed.')); };
  }
  playAudio({ samples, rate }) {
    if (!this.allowAudio || this.audio.state !== 'running' || this.audioTime - this.audio.currentTime > .2) return;
    const buffer = this.audio.createBuffer(2, samples.length / 2, rate);
    for (let ch = 0; ch < 2; ch++) {
      const output = buffer.getChannelData(ch);
      for (let i = 0; i < output.length; i++) output[i] = samples[i * 2 + ch] / 32768;
    }
    const source = this.audio.createBufferSource(); source.buffer = buffer; source.connect(this.gain);
    this.voices.add(source); source.onended = () => this.voices.delete(source);
    this.audioTime = Math.max(this.audio.currentTime + .015, this.audioTime);
    source.start(this.audioTime); this.audioTime += buffer.duration;
  }
  silence() { this.allowAudio = false; for (const voice of this.voices) voice.stop(); this.voices.clear(); this.audioTime = 0; }
  request(op, payload = {}, transfers = []) {
    if (this.disposed) return Promise.reject(Error('Session is disposed.'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`${op} timed out. The last confirmed checkpoint is retained.`)); }, op === 'load' ? 15000 : 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, op, ...payload }, transfers);
    });
  }
  load(rom, state, battery) {
    const canvas = this.canvas.transferControlToOffscreen();
    return this.request('load', { rom, state, battery, canvas }, [canvas]);
  }
  input(mask) { if (!this.disposed) this.worker.postMessage({ op: 'input', mask }); }
  async resume() {
    // Audio permission must not trap gameplay when a programmatic gamepad click lacks a gesture.
    this.audio.resume().catch(() => {});
    await this.request('resume'); this.allowAudio = true;
  }
  pause() { this.silence(); return this.request('pause'); }
  async checkpoint() { this.silence(); return this.request('checkpoint'); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.silence(); this.worker.terminate(); this.audio.close().catch(() => {});
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(Error('Session disposed.')); }
    this.pending.clear();
  }
}
