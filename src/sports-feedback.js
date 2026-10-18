// Sensory feedback is presentation only. It never changes match state or timing.
const profiles = {
  pass: [110, 55, .09, .06, .10, .22],
  kick: [145, 42, .15, .12, .24, .46],
  skill: [170, 330, .10, 0, .04, .20],
  tackle: [85, 30, .19, .16, .50, .24],
  save: [120, 58, .14, .13, .28, .38],
  catch: [140, 72, .09, .06, .12, .26],
  denied: [160, 120, .07, 0, .03, .07],
  goal: [440, 660, .55, .03, .30, .55],
  whistle: [2600, 2350, .32, 0, 0, .12],
  card: [330, 220, .22, .02, .18, .2],
};

export function feedbackProfile(event) {
  const p = profiles[event?.kind];
  if (!p || !Number.isSafeInteger(event.id) || event.id < 0) return null;
  const strength = Number.isFinite(event.strength) ? Math.max(0, Math.min(1, event.strength)) : .65;
  return { kind: event.kind, frequency: p[0], endFrequency: p[1], seconds: p[2], noise: p[3],
    strongMagnitude: p[4] * strength, weakMagnitude: p[5] * strength, duration: Math.round(p[2] * 1000), strength };
}

// Preserve one-shot input across render frames that precede the next 60 Hz tick.
export function mergePendingInput(current, pending) {
  if (!pending) return current;
  const aimedAction = ['pass', 'shoot', 'through', 'lob', 'receiverA', 'receiverB', 'receiverX'].some(name => pending.pressed?.[name] || pending.released?.[name]
    || (pending.held?.[name] && current.released?.[name]));
  if (aimedAction && pending.aim && !Math.hypot(current.aim?.x || 0, current.aim?.y || 0)) current.aim = { ...pending.aim };
  for (const group of ['pressed', 'released', 'cancelled']) {
    current[group] ||= {};
    for (const [key, value] of Object.entries(pending[group] || {})) current[group][key] ||= value;
  }
  current.gesture ||= pending.gesture;
  current.skillDirection ||= pending.skillDirection;
  return current;
}

export class SportsFeedback {
  constructor({ getPad = () => null, audioFactory = () => new AudioContext() } = {}) {
    Object.assign(this, { getPad, audioFactory });
    this.lastId = null; this.enabled = false; this.disposed = false; this.nodes = new Set();
    this.observed = 0; this.hapticRequests = 0; this.sounds = 0;
  }
  resume(event) {
    if (this.disposed) return;
    this.lastId = event?.id ?? null; this.enabled = true;
    try {
      this.audio ||= this.audioFactory();
      this.audio.resume()?.catch?.(() => {});
    } catch { /* Browsers without audio still play the full game. */ }
  }
  consume(event) {
    if (!this.enabled || this.disposed || !event || event.id === this.lastId) return null;
    this.lastId = event.id;
    const profile = feedbackProfile(event);
    if (!profile) return null;
    this.observed++;
    const actuator = this.getPad()?.vibrationActuator;
    if (typeof actuator?.playEffect === 'function') {
      try {
        this.actuator = actuator;
        this.hapticRequests++;
        actuator.playEffect('dual-rumble', { startDelay: 0, duration: profile.duration,
          strongMagnitude: profile.strongMagnitude, weakMagnitude: profile.weakMagnitude })?.catch?.(() => {});
      } catch { /* Unsupported haptics must never interrupt a match. */ }
    }
    this.sound(profile);
    return profile;
  }
  sound(p) {
    const a = this.audio;
    if (a?.state !== 'running') return;
    try {
      const t = a.currentTime, gain = a.createGain(), oscillator = a.createOscillator();
      const volume = (p.kind === 'goal' ? .11 : .065) * (.35 + p.strength * .65);
      gain.gain.setValueAtTime(.001, t); gain.gain.linearRampToValueAtTime(volume, t + .008);
      gain.gain.exponentialRampToValueAtTime(.001, t + p.seconds);
      oscillator.type = p.kind === 'goal' || p.kind === 'skill' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(p.frequency, t);
      oscillator.frequency.exponentialRampToValueAtTime(p.endFrequency, t + p.seconds);
      oscillator.connect(gain); gain.connect(a.destination);
      this.nodes.add(oscillator);
      oscillator.onended = () => { this.nodes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(t); oscillator.stop(t + p.seconds + .02);
      if (p.noise) {
        // One reusable short noise buffer, filtered into a boot/ball/contact thud.
        if (!this.noise) {
          this.noise = a.createBuffer(1, Math.ceil(a.sampleRate * .25), a.sampleRate);
          const samples = this.noise.getChannelData(0);
          for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        }
        const source = a.createBufferSource(), filter = a.createBiquadFilter(), envelope = a.createGain();
        source.buffer = this.noise; filter.type = 'lowpass'; filter.frequency.value = p.kind === 'tackle' ? 550 : 1700;
        envelope.gain.setValueAtTime(p.noise * (.3 + p.strength * .7), t);
        envelope.gain.exponentialRampToValueAtTime(.001, t + Math.min(.23, p.seconds));
        source.connect(filter); filter.connect(envelope); envelope.connect(a.destination);
        this.nodes.add(source); source.onended = () => { this.nodes.delete(source); source.disconnect(); filter.disconnect(); envelope.disconnect(); };
        source.start(t); source.stop(t + Math.min(.24, p.seconds + .02));
      }
      this.sounds++;
    } catch { /* Audio output is optional, never a simulation dependency. */ }
  }
  pause() {
    this.enabled = false;
    for (const node of this.nodes) { try { node.stop(); } catch { /* Already ended. */ } }
    this.nodes.clear();
    try { this.actuator?.reset?.()?.catch?.(() => {}); } catch { /* Optional output. */ }
    this.actuator = null;
    try { this.audio?.suspend()?.catch?.(() => {}); } catch { /* Output device was removed. */ }
  }
  dispose() { this.pause(); this.disposed = true; this.audio?.close()?.catch?.(() => {}); }
}
