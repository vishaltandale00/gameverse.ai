import * as THREE from './three.module.js';
import { SportsInput, SPORTS_KEYS } from './sports-input.js';
import { SportsFeedback, mergePendingInput } from './sports-feedback.js';

const DEFINITIONS = { soccer: () => import('./soccer.js').then(m => m.soccerDefinition), football: () => import('./football.js').then(m => m.footballDefinition) };
const clock = seconds => { const total = Math.ceil(Math.max(0, seconds)); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };

export class CustomSportsAdapter {
  constructor(container, game, onFailure, { onPause, ownsB = () => false, preferredPadIndex = null } = {}) {
    Object.assign(this, { container, game, onFailure, onPause, ownsB });
    this.keys = new Set(); this.controls = new SportsInput(game.id); this.controls.pad.index = preferredPadIndex; this.abort = new AbortController();
    this.paused = true; this.frame = 0; this.queued = []; this.accumulator = 0;
    this.feedback = new SportsFeedback({ getPad: () => Array.from(navigator.getGamepads?.() || []).find(p => p?.connected && p.index === this.controls.pad.index) });
    this.renderStats = { frames: 0, elapsed: 0, fps: null }; this.feedbackFade = 0;
  }
  async load(bytes) {
    this.definition = await DEFINITIONS[this.game.id]();
    if (bytes) {
      const saved = JSON.parse(new TextDecoder().decode(bytes));
      if (saved.schema !== 1 || saved.gameId !== this.game.id || saved.version !== this.game.version) throw Error('This match requires its original game version. Your saved match is retained.');
      this.definition.validateState(saved.state); this.state = saved.state; this.frame = saved.frame;
    } else this.state = this.definition.createState();
    this.container.innerHTML = `<div class="sports-stage"></div>
      <div class="sports-broadcast"><span class="sports-live">ALDER SPORTS / LOCAL PLAY</span><div class="sports-scoreboard"><span class="sports-team home">ALDER <small>YOU</small></span><strong class="sports-score">0 <i>:</i> 0</strong><span class="sports-team away">RIVALS <small>CPU</small></span><time>10:00</time></div><div class="sports-match-label"></div></div>
      <div class="sports-banner" aria-live="polite"><span class="sports-label"></span><h2></h2><p></p><button class="sports-start">Start match · A / Enter</button></div>
      <div class="sports-playbook" aria-label="Choose your play"></div>
      <div class="sports-radar"><span>FIELD MAP</span><canvas width="168" height="104" aria-label="Tactical field map"></canvas></div>
      <div class="sports-action" aria-hidden="true"></div>
      <div class="sports-bottom"><div class="sports-athlete"><span class="sports-skill-state"></span><label>STAMINA <meter min="0" max="1" low=".25" high=".65" optimum="1" value="1" aria-label="Selected athlete stamina"></meter></label></div><div class="sports-meter"><span>POWER</span><progress max="1" value="0" aria-label="Pass or shot power"></progress><b class="sports-power-value">0%</b></div><div class="sports-context"></div><div class="sports-skill-hint"></div><div class="sports-controls"></div></div>`;
    const elements = new Map();
    this.q = selector => { if (!elements.has(selector)) elements.set(selector, this.container.querySelector(selector)); return elements.get(selector); };
    this.setText = (selector, text) => { const node = this.q(selector); if (node.textContent !== text) node.textContent = text; };
    this.q('.sports-start').onclick = () => this.queued.push('confirm');
    this.radar = this.q('.sports-radar canvas').getContext('2d');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = this.renderer.domElement; canvas.tabIndex = 0; canvas.setAttribute('aria-label', `${this.game.name} playing field`);
    this.q('.sports-stage').append(canvas);
    this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(46, 1, .1, 600);
    this.view = this.definition.buildScene({ THREE, scene: this.scene, camera: this.camera, renderer: this.renderer });
    const signal = this.abort.signal;
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.fail(Error('Graphics were interrupted. Return and reopen the saved match.')); }, { signal });
    window.addEventListener('keydown', event => {
      if (this.paused || this.disposed || document.querySelector('dialog[open]:not(#voice-dialog)') || !SPORTS_KEYS.has(event.code)) return;
      event.preventDefault(); if (!event.repeat) this.keys.add(event.code);
    }, { signal });
    window.addEventListener('keyup', event => this.keys.delete(event.code), { signal });
    this.resize = new ResizeObserver(() => {
      const { width, height } = this.container.getBoundingClientRect();
      if (!width || !height) return;
      this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.paint(0);
    });
    this.resize.observe(this.container);
    this.paint(0); this.last = performance.now();
    const animate = now => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(animate);
      const rawElapsed = Math.max(0, (now - this.last) / 1000), elapsed = Math.min(rawElapsed, .1); this.last = now;
      if (this.paused || document.hidden || !document.hasFocus()) return;
      try {
        const input = mergePendingInput(this.controls.sample(this.keys, navigator.getGamepads?.() || [], this.ownsB()), this.pendingInput);
        if (input.disconnected) { this.onPause?.(); return; }
        this.accumulator += elapsed;
        this.pendingInput = input;
        if (this.accumulator >= 1 / 60 && this.queued.length) input.pressed[this.queued.shift()] = true;
        while (this.accumulator >= 1 / 60) {
          this.definition.step(this.state, 1 / 60, input); this.frame++; this.accumulator -= 1 / 60;
          const event = this.feedback.consume(this.state.feedback);
          if (event) { this.lastFeedback = event.kind; this.feedbackFade = event.kind === 'goal' ? 1.4 : .48; }
          input.pressed = {}; input.released = {}; input.cancelled = {}; input.gesture = null; input.skillDirection = null; this.pendingInput = null;
        }
        this.paint(elapsed, input);
        this.renderStats.frames++; this.renderStats.elapsed += rawElapsed;
        if (this.renderStats.elapsed >= 1) { this.renderStats.fps = this.renderStats.frames / this.renderStats.elapsed; this.renderStats.frames = 0; this.renderStats.elapsed = 0; }
      } catch (error) { this.fail(error); }
    };
    this.raf = requestAnimationFrame(animate);
    window.__gameverseSports = Object.freeze({ read: () => ({ gameId: this.game.id, frame: this.frame, paused: this.paused, ...structuredClone(this.state), hud: this.definition.hud(this.state), drawCalls: this.renderer.info.render.calls, recentFps: this.renderStats.fps,
      presentation: { events: this.feedback.observed, hapticRequests: this.feedback.hapticRequests, sounds: this.feedback.sounds, last: this.lastFeedback || null } }) });
    return { frame: this.frame };
  }
  paint(dt, input) {
    if (!this.view || this.disposed) return;
    this.definition.render({ state: this.state, view: this.view, camera: this.camera, dt });
    this.renderer.render(this.scene, this.camera);
    const hud = this.definition.hud(this.state), q = this.q, text = this.setText;
    if (hud.teamNames) { q('.sports-team.home').firstChild.textContent = hud.teamNames[0] + ' '; q('.sports-team.away').firstChild.textContent = hud.teamNames[1] + ' '; }
    text('.sports-score', `${hud.score[0]}  :  ${hud.score[1]}`);
    text('time', clock(hud.clock)); text('.sports-match-label', hud.label || '');
    text('.sports-label', this.game.name); text('.sports-banner h2', hud.message || '');
    const ready = this.state.phase === 'ready', finished = hud.finished;
    q('.sports-banner').classList.toggle('sports-intro', ready || finished);
    q('.sports-banner').hidden = !hud.message && !ready && !finished;
    q('.sports-banner p').textContent = ready ? 'Read the play. Create your chance.' : finished ? 'Play it back, or save & return to your neighborhood.' : '';
    q('.sports-start').hidden = !ready && !finished;
    q('.sports-start').textContent = finished ? 'Rematch · A / Enter' : 'Start match · A / Enter';
    text('.sports-context', hud.detail || '');
    q('progress').value = hud.power || 0;
    q('.sports-meter').hidden = !(hud.power > 0 || this.state.charging);
    text('.sports-power-value', `${Math.round((hud.power || 0) * 100)}%`);
    q('.sports-meter').classList.toggle('charging', (hud.power || 0) > 0);
    const athlete = this.state.players?.[this.state.active ?? this.state.controlled];
    q('meter').value = hud.stamina ?? athlete?.stamina ?? 1;
    text('.sports-skill-state', hud.skillReady === false || (athlete?.skillCooldown || athlete?.jukeCooldown) > 0 ? 'RECOVERING' : 'SKILL READY');
    text('.sports-skill-hint', hud.skillHint || (this.game.id === 'soccer' ? 'Create space, then release your pass or shot.' : 'Read the blockers. Cut across a defender’s momentum.'));
    this.feedbackFade = Math.max(0, this.feedbackFade - dt);
    q('.sports-action').style.opacity = String(Math.min(1, this.feedbackFade * 4));
    q('.sports-action').dataset.kind = this.lastFeedback || '';
    text('.sports-action', ({ pass: 'RELEASE', kick: 'STRIKE', skill: 'CUT', tackle: 'CONTACT', save: 'SAVE', catch: 'CAUGHT', denied: 'RECOVER', goal: 'SCORE' })[this.lastFeedback] || '');
    this.paintRadar();
    if (input) {
      this.connected = input.connected;
      const football = this.game.id === 'football';
      const controls = input.connected
        ? (football ? 'LS move / lead · A/B/X receivers · RS juke · RT sprint · Start pause' : 'LS move / direction · A pass · B shoot · X lob · Y through · RS skills · RT sprint · Start pause')
        : (football ? 'WASD move / lead · J/U/K receivers · Q switch · L tackle · E + arrows skill · Shift sprint · Esc pause' : 'WASD direction · J pass · K shoot · I lob · U through · F modifier · E + arrows skill · Shift sprint · Esc pause');
      text('.sports-controls', `${input.connected && !input.armed ? 'Release controls to continue · ' : ''}${controls}`);
    }
    const playKey = JSON.stringify([hud.plays, hud.selectedPlay]);
    if (playKey !== this.playKey) {
      this.playKey = playKey; q('.sports-playbook').replaceChildren();
      (hud.plays || []).forEach((name, index) => {
        const button = document.createElement('button'); button.textContent = name; button.setAttribute('aria-pressed', String(index === hud.selectedPlay));
        button.onclick = () => { const delta = index - (this.definition.hud(this.state).selectedPlay || 0); this.queued.push(...Array(Math.abs(delta)).fill(delta < 0 ? 'left' : 'right')); this.renderer.domElement.focus(); };
        q('.sports-playbook').append(button);
      });
    }
  }
  paintRadar() {
    const c = this.radar;
    if (!c) return;
    const s = this.state, soccer = this.game.id === 'soccer', width = 168, height = 104;
    const side = soccer || s.offense === 0 ? 1 : -1;
    const position = p => soccer ? [84 + p.x / 56 * 152, 52 + p.z / 34 * 88] : [84 + p.x * side / 50 * 152, 52 - p.y * side / 120 * 88];
    c.clearRect(0, 0, width, height); c.fillStyle = '#102e2fdc'; c.fillRect(0, 0, width, height);
    c.strokeStyle = '#a8d4c047'; c.lineWidth = 1; c.strokeRect(8, 8, 152, 88);
    c.beginPath();
    if (soccer) { c.moveTo(84, 8); c.lineTo(84, 96); c.moveTo(98, 52); c.ellipse(84, 52, 14, 14, 0, 0, Math.PI * 2); }
    else for (let y = 1; y < 6; y++) { c.moveTo(8, 8 + y * 88 / 6); c.lineTo(160, 8 + y * 88 / 6); }
    c.stroke();
    const active = s.active ?? s.controlled;
    for (const p of s.players) {
      const [x, y] = position(p); c.fillStyle = p.team === 0 ? '#6ce3ce' : '#ff946d';
      c.beginPath(); c.arc(x, y, p.id === active ? 3.8 : 2.6, 0, Math.PI * 2); c.fill();
      if (p.id === active) { c.strokeStyle = '#fff7bd'; c.lineWidth = 1.5; c.stroke(); }
    }
    const [x, y] = position(s.ball); c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x, y, 2.5, 0, Math.PI * 2); c.fill();
  }
  input() { /* Sports read analog controls directly; GBA masks never enter this runtime. */ }
  async resume() {
    if (this.disposed) throw Error('This match is closed.');
    this.keys.clear(); this.controls.reset(); this.pendingInput = null; this.queued = []; this.accumulator = 0; this.last = performance.now(); this.paused = false;
    this.renderer.domElement.focus({ preventScroll: true });
    this.feedback.resume(this.state.feedback);
  }
  silence() { if (this.state) this.definition?.cancelInput?.(this.state); this.paused = true; this.keys.clear(); this.controls.reset(); this.feedback.pause(); }
  async pause() { this.silence(); }
  async checkpoint() {
    await this.pause(); this.definition.validateState(this.state);
    return { state: new TextEncoder().encode(JSON.stringify({ schema: 1, gameId: this.game.id, version: this.game.version, frame: this.frame, state: this.state })), frame: this.frame };
  }
  async request(op) { if (op === 'health') return { frame: this.frame }; throw Error('Unsupported custom-game operation.'); }
  fail(error) { this.silence(); this.onFailure(error); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.raf); this.abort.abort(); this.resize?.disconnect(); this.feedback.dispose();
    const resources = new Set();
    this.scene?.traverse(object => { if (object.geometry) resources.add(object.geometry); for (const m of [object.material].flat().filter(Boolean)) { resources.add(m); for (const value of Object.values(m)) if (value?.isTexture) resources.add(value); } });
    for (const resource of resources) resource.dispose(); this.renderer?.dispose(); this.renderer?.forceContextLoss();
    this.container.replaceChildren(); delete window.__gameverseSports;
  }
}
