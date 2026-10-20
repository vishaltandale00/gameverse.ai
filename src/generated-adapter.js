// Hosts a Gameverse v2 generated game (gameverse.v2.game-spec/0.1, or a genre-kit
// game, gameverse.v2.kit-game/0.1) in the v1
// shell with the same surface as CustomSportsAdapter: load/resume/pause,
// checkpoint, health, dispose and a control handle. New versions published by
// the server hot-load in place; state carries over when the level and rules
// shape are unchanged, otherwise the game restarts cleanly.
import { defaultRegistry } from '/v2/modules/index.js';
import { preflight } from '/v2/engine/spec.js';
import { compose, DT, NEUTRAL_INPUT } from '/v2/engine/compose.js';
import { createRenderer } from '/v2/engine/render2d.js';
import { loadKit } from '/v2/kits/registry.js';
import { composeGame, composeRenderer } from '/v2/kits/mods/compose.js';
import { StandardGamepadInput } from './gamepad.js';
import { GENERATED_KEYS, generatedInput, encodeCheckpoint, decodeCheckpoint, canCarryState } from './generated-games.js';

const registry = defaultRegistry();
const KIT_GAME_SCHEMA = 'gameverse.v2.kit-game/0.1';
const STATUSES = new Set(['playing', 'won', 'lost']);
/** Kit states are plain JSON with a status and score; anything else can't be saved or carried. */
function kitCheck(state) {
  if (!state || !STATUSES.has(state.status)) return ['the game state has no valid status'];
  if (!Number.isFinite(state.score ?? 0)) return ['the score is not a number'];
  try { JSON.stringify(state); } catch { return ['the game state is not serializable']; }
  return [];
}

export class GeneratedGameAdapter {
  constructor(container, game, onFailure, { onPause, ownsB = () => false, preferredPadIndex = null, onUpdate = () => {}, onEvent = () => {} } = {}) {
    Object.assign(this, { container, game, onFailure, onPause, ownsB, onUpdate, onEvent });
    this.keys = new Set(); this.pad = new StandardGamepadInput(); this.pad.index = preferredPadIndex;
    this.abort = new AbortController(); this.paused = true; this.frame = 0; this.accumulator = 0; this.previousA = false;
  }
  async fetchJson(path) {
    const response = await fetch(path, { signal: this.abort.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || `The game service answered ${response.status}.`);
    return data;
  }
  async fetchVersion(version) { return this.fetchJson(`/api/v2/games/${encodeURIComponent(this.game.v2Id)}/v/${version}`); }
  async build(record) {
    if (record.doc?.schema === KIT_GAME_SCHEMA) {
      const kit = await loadKit(record.doc.kit);
      const checked = kit.validate(record.doc.content);
      if (!checked.ok) throw Error(`Version ${record.version} of this game failed its checks (${checked.errors[0]?.message || 'invalid content'}).`);
      let made = composeGame(kit, checked.content, { seed: record.doc.seed ?? 1, mods: record.doc.mods || {} });
      let render = composeRenderer(kit, made, { art: record.doc.art || {} });
      // Experiments run sandboxed on top (v2/experiments); without them the game still plays.
      if (record.doc.experiments?.length) {
        try {
          const { composeExperiments } = await import('/v2/experiments/compose.js');
          ({ game: made, render } = composeExperiments(kit, made, render, record.doc.experiments, { seed: record.doc.seed ?? 1, onNote: note => this.toast?.(note) }));
        } catch (error) { console.warn('[generated] experiments unavailable', error?.message || error); }
      }
      const game = { createState: () => made.createState(), step: (state, input) => made.step(state, input), check: kitCheck };
      return { version: record.version, kit, spec: { id: record.doc.id, title: record.doc.title, kit: kit.id, content: record.doc.content, mods: record.doc.mods || {}, experiments: record.doc.experiments || [] }, game, render, controls: made.controls || [], dispose: () => made.dispose?.() };
    }
    const checked = preflight(record.doc, registry);
    if (!checked.ok) throw Error(`Version ${record.version} of this game failed its checks (${checked.errors[0]?.message || 'invalid spec'}).`);
    const game = compose(checked.spec, registry);
    return { version: record.version, spec: checked.spec, game, render: createRenderer(game) };
  }
  async load(bytes) {
    this.current = await this.build(await this.fetchVersion(this.game.version));
    let restarted = false, note = '';
    if (bytes) {
      const saved = decodeCheckpoint(bytes, { gameId: this.game.id, version: this.current.version });
      if (saved.restored) {
        const issues = this.current.game.check(saved.state);
        if ((!this.current.kit && saved.state.specId !== this.current.spec.id) || issues.length) throw Error('This saved moment does not fit its game version. Your earlier progress is retained.');
        this.state = saved.state; this.frame = saved.frame;
      } else { restarted = true; note = saved.reason; this.state = this.current.game.createState(); }
    } else this.state = this.current.game.createState();
    this.container.innerHTML = `<div class="generated-stage"><canvas tabindex="0"></canvas>
      <div class="generated-hud"><span class="generated-kicker">CREATOR’S LOT</span><strong class="generated-title"></strong><span class="generated-version"></span></div>
      <p class="generated-toast" role="status" aria-live="polite" hidden></p>
      <p class="generated-help">Move · arrows / WASD / left stick &nbsp; A · Space / Z / J &nbsp; B · X / K &nbsp; Restart · R &nbsp; Menu · Esc / Start</p><p class="generated-help generated-experimental" hidden></p></div>`;
    this.canvas = this.container.querySelector('canvas'); this.context = this.canvas.getContext('2d');
    this.updateHud();
    if (note) this.toast(note);
    const signal = this.abort.signal;
    window.addEventListener('keydown', event => {
      if (this.paused || this.disposed || document.querySelector('dialog[open]:not(#voice-dialog)') || !GENERATED_KEYS.has(event.code)) return;
      event.preventDefault(); if (!event.repeat) this.keys.add(event.code);
    }, { signal });
    window.addEventListener('keyup', event => this.keys.delete(event.code), { signal });
    this.resize = new ResizeObserver(() => this.paint()); this.resize.observe(this.container);
    this.last = performance.now();
    const animate = now => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(animate);
      const elapsed = Math.min(Math.max(0, (now - this.last) / 1000), 0.1); this.last = now;
      if (this.paused || document.hidden || !document.hasFocus()) return;
      try {
        const pad = this.pad.sample(navigator.getGamepads?.() || []);
        if (pad.disconnected) { this.onPause?.(); return; }
        const input = this.agentInput || generatedInput(this.keys, pad, { ownsB: this.ownsB() });
        const restart = this.keys.has('KeyR') || (this.state.status !== 'playing' && input.a && !this.previousA);
        this.previousA = input.a;
        if (restart) { this.keys.delete('KeyR'); this.state = this.current.game.createState(); }
        this.accumulator += elapsed;
        while (this.accumulator >= DT) { this.current.game.step(this.state, input); this.frame++; this.accumulator -= DT; if (this.current.kit && this.state.events?.length) (this.pending ??= []).push(...this.state.events); }
        this.paint(elapsed);
      } catch (error) { this.fail(error); }
    };
    this.raf = requestAnimationFrame(animate);
    this.subscribe();
    this.paint();
    return { frame: this.frame, restarted, note };
  }
  paint(dt = 0) {
    if (!this.canvas || this.disposed) return;
    const rect = this.canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (!rect.width || !rect.height) return;
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Kit renderers animate from frame time and this frame's events (KIT_CONTRACT.md).
    const frame = this.current.kit ? { cssWidth: rect.width, cssHeight: rect.height, dt, events: this.pending || [], reducedMotion: !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches, paused: this.paused, attract: false } : { cssWidth: rect.width, cssHeight: rect.height };
    this.pending = [];
    this.current.render(this.context, this.state, frame);
  }
  updateHud() {
    this.canvas.setAttribute('aria-label', `${this.current.spec.title} — generated game, version ${this.current.version}`);
    this.container.querySelector('.generated-title').textContent = this.current.spec.title;
    this.container.querySelector('.generated-version').textContent = `v${this.current.version}`;
    // Experiments are labelled as such, with the button they use (v2/experiments).
    const experimental = (this.current.controls || []).filter(c => c.experimental), note = this.container.querySelector('.generated-experimental');
    if (note) { note.hidden = !experimental.length; note.textContent = experimental.map(c => c.input === 'a' ? `A · ${c.label}` : c.input === 'b' ? `B · ${c.label}` : c.label).join('  ·  '); }
  }
  toast(text) {
    const node = this.container.querySelector('.generated-toast'); if (!node) return;
    node.textContent = text; node.hidden = false; clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { node.hidden = true; }, 6000);
  }
  // Live updates for this game only. A reconnect re-checks the latest version
  // so a publish missed while disconnected still arrives.
  subscribe() {
    if (typeof EventSource === 'undefined') return;
    this.events = new EventSource(`/api/v2/events?game=${encodeURIComponent(this.game.v2Id)}`);
    const forward = type => this.events.addEventListener(type, message => {
      let event; try { event = JSON.parse(message.data); } catch { return; }
      if (type === 'hello') { void this.checkLatest(); return; }
      this.onEvent({ type, ...event });
      if (type === 'version') void this.hotLoad(event.version);
    });
    for (const type of ['hello', 'job_started', 'queued', 'stage', 'draft', 'version', 'job_done', 'job_failed']) forward(type);
  }
  async checkLatest() {
    try { const { meta } = await this.fetchJson(`/api/v2/games/${encodeURIComponent(this.game.v2Id)}`); if (meta?.latest > this.current.version) await this.hotLoad(meta.latest); }
    catch (error) { if (!this.disposed) console.debug('[generated] latest check failed', error.message); }
  }
  /** Load a newer published version in place. Never fails the session. */
  async hotLoad(version) {
    if (this.disposed || !(version > (this.loadingVersion || this.current.version))) return;
    this.loadingVersion = version;
    try {
      const next = await this.build(await this.fetchVersion(version));
      if (this.disposed || next.version <= this.current.version) { next.dispose?.(); return; }
      // Kit games carry state across versions whose content is unchanged (new art, same rules).
      let carried = next.kit || this.current.kit ? next.kit === this.current.kit && JSON.stringify([next.spec.content, next.spec.mods, next.spec.experiments]) === JSON.stringify([this.current.spec.content, this.current.spec.mods, this.current.spec.experiments]) : canCarryState(this.current.spec, next.spec);
      if (carried) {
        try {
          const probe = structuredClone(this.state);
          next.game.step(probe, NEUTRAL_INPUT);
          carried = next.game.check(probe).length === 0;
        } catch { carried = false; }
      }
      this.current.dispose?.();
      this.current = next;
      if (!carried) { this.state = next.game.createState(); this.accumulator = 0; }
      this.game.version = next.version;
      this.updateHud(); this.paint();
      const message = carried ? `Updated to v${next.version}. Your progress carried over.` : `Updated to v${next.version}. The level changed, so it restarted.`;
      this.toast(message);
      this.onUpdate({ version: next.version, carried, title: next.spec.title, message });
    } catch (error) {
      if (!this.disposed) { this.toast(`Version ${version} could not load: ${error.message}`); this.onUpdate({ version, error: error.message }); }
    } finally { if (this.loadingVersion === version) this.loadingVersion = 0; }
  }
  input() { /* Generated games read keys and pads directly; GBA masks never enter here. */ }
  controlHandle() {
    return { gameId: this.game.id, version: this.game.version, state: () => this.state, frame: () => this.frame, paused: () => this.paused,
      setAgentInput: input => { this.agentInput = input ? { ...NEUTRAL_INPUT, ...input } : null; },
      hold: held => { if (!held) this.agentInput = null; } };
  }
  async resume() {
    if (this.disposed) throw Error('This game is closed.');
    this.keys.clear(); this.pad.reset(); this.accumulator = 0; this.previousA = true; this.last = performance.now(); this.paused = false;
    this.canvas?.focus({ preventScroll: true });
  }
  silence() { this.paused = true; this.keys.clear(); this.pad.reset(); }
  async pause() { this.silence(); this.paint(); }
  async checkpoint() {
    await this.pause();
    const issues = this.current.game.check(this.state);
    if (issues.length) throw Error(`This moment cannot be saved (${issues[0]}).`);
    return { state: encodeCheckpoint({ gameId: this.game.id, version: this.current.version, frame: this.frame, state: this.state }), frame: this.frame };
  }
  async request(op) { if (op === 'health') return { frame: this.frame, version: this.current?.version ?? null }; throw Error('Unsupported generated-game operation.'); }
  fail(error) { this.silence(); this.onFailure(error); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.raf); this.abort.abort(); this.events?.close(); this.resize?.disconnect(); this.current?.dispose?.();
    clearTimeout(this.toastTimer); this.container.replaceChildren();
  }
}
