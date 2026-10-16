// Mono PCM16 at the AudioContext's verified 24 kHz rate, in 100 ms frames.
// Flush and its acknowledgement share the ordered MessagePort with audio frames.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = new Int16Array(2400); this.length = 0; this.capturing = true;
    this.port.onmessage = ({ data }) => {
      if (data.type !== 'flush') return;
      this.capturing = false; this.flush(); this.port.postMessage({ type: 'flushed' });
    };
  }
  flush() {
    if (!this.length) return;
    const buffer = this.samples.buffer.slice(0, this.length * 2);
    this.port.postMessage({ type: 'audio', buffer }, [buffer]); this.length = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (this.capturing && input) for (const value of input) {
      const clipped = Math.max(-1, Math.min(1, value));
      this.samples[this.length++] = clipped < 0 ? clipped * 32768 : clipped * 32767;
      if (this.length === this.samples.length) this.flush();
    }
    return true;
  }
}
registerProcessor('voice-capture', VoiceCapture);
