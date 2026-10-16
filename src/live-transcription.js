const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {}); return { promise, resolve, reject };
};

// Provider-independent browser transport. Only the local backend knows the vendor.
export class LiveTranscription {
  constructor({ stream, requestId, config, signal, onText, onError,
    Socket = globalThis.WebSocket, Audio = globalThis.AudioContext, Worklet = globalThis.AudioWorkletNode,
    url = new URL(`/api/voice/stream?requestId=${requestId}`, globalThis.location?.href || 'http://localhost') }) {
    Object.assign(this, { stream, config, signal, onText, onError, Socket, Audio, Worklet });
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; this.url = url.href;
    this.ready = deferred(); this.final = deferred(); this.flushed = deferred(); this.items = new Map();
    this.cancelled = false; this.completed = false; this.bytes = 0;
  }
  async bounded(promise) {
    let timer;
    try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('Live transcription timed out. Try again.')), this.config.timeoutMs || 30000); })]); }
    finally { clearTimeout(timer); }
  }
  async start() {
    if (!this.Socket || !this.Audio || !this.Worklet) throw Error('Live voice input requires a browser with Web Audio and WebSocket support.');
    this.abort = () => this.cancel(); this.signal.addEventListener('abort', this.abort, { once: true });
    if (this.signal.aborted) { this.cancel(); throw Error('Voice input cancelled.'); }
    this.socket = new this.Socket(this.url);
    this.socket.binaryType = 'arraybuffer';
    this.socket.onmessage = ({ data }) => {
      if (this.cancelled) return;
      let event;
      try { event = JSON.parse(data); } catch { this.fail(Error('The voice backend returned an invalid event.')); return; }
      if (event.type === 'ready') this.ready.resolve(event);
      else if (event.type === 'transcript') {
        if (typeof event.delta !== 'string' || !event.itemId) { this.fail(Error('Invalid live transcript.')); return; }
        this.items.set(event.itemId, (this.items.get(event.itemId) || '') + event.delta);
        const text = [...this.items.values()].join(' ');
        if (text.length > 32000) { this.fail(Error('The transcript is too long. Try a shorter request.')); return; }
        this.onText(text);
      } else if (event.type === 'final') {
        this.completed = true; this.final.resolve(event);
      } else if (event.type === 'error') this.fail(Error(event.message || 'Live transcription failed.'));
    };
    this.socket.onerror = () => this.fail(Error('The live voice connection failed. Check that the local server is running.'));
    this.socket.onclose = () => { if (!this.cancelled && !this.completed) this.fail(Error('Live transcription disconnected. Your request was not submitted.')); };
    await this.bounded(this.ready.promise);
    if (this.cancelled) throw Error('Voice input cancelled.');
    this.audio = new this.Audio({ sampleRate: 24000 });
    if (this.audio.sampleRate !== 24000) throw Error('This browser cannot capture the required audio sample rate.');
    await this.audio.audioWorklet.addModule('/src/voice-worklet.js');
    if (this.cancelled) throw Error('Voice input cancelled.');
    this.node = new this.Worklet(this.audio, 'voice-capture');
    this.node.port.onmessage = ({ data }) => {
      if (this.cancelled || this.completed) return;
      if (data.type === 'flushed') this.flushed.resolve();
      else if (data.type === 'audio') {
        this.bytes += data.buffer.byteLength;
        if (this.bytes > this.config.maxBytes || this.socket.readyState !== 1 || this.socket.bufferedAmount > 256 * 1024) {
          this.fail(Error('The voice connection cannot keep up. Try again.')); return;
        }
        this.socket.send(data.buffer);
      }
    };
    this.source = this.audio.createMediaStreamSource(this.stream);
    this.source.connect(this.node); this.node.connect(this.audio.destination);
    await this.bounded(this.audio.resume());
    if (this.cancelled) throw Error('Voice input cancelled.');
  }
  releaseAudio() {
    this.source?.disconnect(); this.node?.disconnect();
    this.stream.getTracks().forEach(track => track.stop());
    if (this.audio && this.audio.state !== 'closed') void this.audio.close().catch(() => {});
  }
  async stop() {
    this.node.port.postMessage({ type: 'flush' });
    await this.bounded(this.flushed.promise);
    if (this.cancelled) throw Error('Voice input cancelled.');
    this.releaseAudio();
    this.socket.send(JSON.stringify({ type: 'stop' }));
    const result = await this.bounded(this.final.promise);
    this.signal.removeEventListener('abort', this.abort);
    this.socket.close(); return result;
  }
  fail(error) {
    if (this.cancelled || this.failed || this.completed) return;
    this.failed = true; this.ready.reject(error); this.final.reject(error); this.flushed.reject(error);
    this.cancel(); this.onError(error);
  }
  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    const error = Error('Voice input cancelled.'); this.ready.reject(error); this.final.reject(error); this.flushed.reject(error);
    this.signal.removeEventListener('abort', this.abort);
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: 'cancel' }));
    this.socket?.close(); this.releaseAudio();
  }
}
