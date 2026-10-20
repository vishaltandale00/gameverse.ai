// Canvas host for generated 2D games (gameverse.v2.game-spec/0.1): fixed
// 60 Hz simulation, keyboard + gamepad input, and the screens around play:
// title, level intro, pause, game over and victory, with fades between them.
// Checkpoints, hit-stop and sound hooks live here; the engine's rules don't change.
import { defaultRegistry } from '/v2/modules/index.js';
import { preflight } from '/v2/engine/spec.js';
import { compose, DT } from '/v2/engine/compose.js';
import { createRenderer } from '/v2/engine/render2d.js';
import { hitStopFor, lossReason, tally, recordBest } from '/v2/engine/juice.js';
import { initialCheckpoint, updateCheckpoint, canRespawn, respawn } from './checkpoint.js';
import { esc, titleScreen, introBanner, pauseScreen, gameOverScreen, victoryScreen, controlsCard, controlsInfo, pressStart, helpLine } from './arcade-overlay.js';

const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyZ', 'KeyX', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyJ', 'KeyK']);
const CONFIRM = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyZ', 'KeyJ']);
const BACK = new Set(['Escape', 'KeyP']);
const PREV = new Set(['ArrowUp', 'ArrowLeft', 'KeyW', 'KeyA']), NEXT = new Set(['ArrowDown', 'ArrowRight', 'KeyS', 'KeyD']);
const INTRO_DROP = 0.55, INTRO_GO = 0.95; // seconds
const MUTE_KEY = 'gameverse.v2.muted';

let storage = null;
try { storage = globalThis.localStorage ?? null; } catch {}
const store = { get: k => { try { return storage?.getItem(k) ?? null; } catch { return null; } }, set: (k, v) => { try { storage?.setItem(k, v); } catch {} } };

function ensureStyles() {
  if (document.getElementById('gv-arcade-css')) return;
  const link = Object.assign(document.createElement('link'), { id: 'gv-arcade-css', rel: 'stylesheet', href: '/v2/web/arcade.css' });
  document.head.append(link);
}

export function mountArcade(container, record) {
  const registry = defaultRegistry();
  const checked = preflight(record.doc, registry);
  if (!checked.ok) throw Object.assign(Error('This game failed checks in the browser.'), { errors: checked.errors });
  let spec = checked.spec, game = compose(spec, registry), render = createRenderer(game);
  ensureStyles();
  container.replaceChildren();
  const root = document.createElement('div');
  root.className = 'gv-arcade';
  root.innerHTML = `<canvas class="arcade" tabindex="0" aria-label="${esc(spec.title)}"></canvas><div class="gv-screen" aria-live="polite"></div><div class="gv-fade" aria-hidden="true"></div>`;
  const help = document.createElement('p'); help.className = 'arcade-help';
  container.append(root, help);
  const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d');
  const screenEl = root.querySelector('.gv-screen'), fadeEl = root.querySelector('.gv-fade');
  const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => !!motion?.matches;

  let screen = 'title', screenT = 0, device = 'keyboard', howto = false, muted = store.get(MUTE_KEY) === '1';
  let state = game.createState(), start = structuredClone(state), checkpoint = initialCheckpoint(state);
  let history = [], pending = [], hitStop = 0, endAt = null, snap = true, fading = false, goShown = false, bannerTimer = 0;
  let last = performance.now(), acc = 0, raf = 0, disposed = false;
  const keys = new Set(), timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!disposed) fn(); }, ms); timers.add(t); return t; };

  // ---------- sound (optional module built separately) ----------
  let audio = null, unlocked = false;
  const sound = (method, ...args) => { try { return audio?.[method]?.(...args); } catch { return undefined; } };
  const musicFor = s => ({ title: 'title', intro: 'play', play: 'play', pause: 'pause', over: 'lose', won: 'win' }[s] || 'off');
  import('/v2/engine/audio.js').catch(() => null).then(m => {
    if (disposed || !m?.createAudio) return;
    try { audio = m.createAudio({ spec, design: record.report?.design }); } catch { audio = null; return; }
    sound('setMuted', muted); sound('music', musicFor(screen));
  });
  const unlock = () => { if (audio && !unlocked) { unlocked = true; sound('unlock'); sound('music', musicFor(screen)); } };

  // ---------- palette and help ----------
  function applyTheme() {
    const p = render.palette;
    for (const [k, v] of Object.entries({ bg: p.background, panel: p.panel, solid: p.panelSolid, edge: p.edge, ink: p.ink, muted: p.muted, accent: p.accent, 'accent-ink': p.accentInk, accent2: p.accent2 })) root.style.setProperty(`--gv-${k}`, v);
    root.dataset.pixel = /pixel/i.test(spec.art?.style || '') ? 'true' : 'false';
    root.dataset.view = spec.view;
  }
  const renderHelp = () => { help.innerHTML = helpLine(device, controlsInfo(spec)); };
  function setDevice(next) {
    if (next === device) return;
    device = next; renderHelp();
    for (const el of screenEl.querySelectorAll('[data-hint="controls"]')) el.innerHTML = controlsCard(device, controlsInfo(spec));
    for (const el of screenEl.querySelectorAll('[data-hint="press"]')) el.innerHTML = pressStart(device);
  }
  applyTheme(); renderHelp();

  // ---------- screens ----------
  // Menus track their own selection (data-selected) as well as DOM focus, so
  // the highlight stays visible for gamepad play and when the window is blurred.
  const buttons = () => [...screenEl.querySelectorAll('button')];
  function select(b) {
    for (const x of buttons()) x.toggleAttribute('data-selected', x === b);
    b?.focus({ preventScroll: true });
  }
  const selected = () => buttons().find(b => b.hasAttribute('data-selected')) || null;
  function focusFirst() { const b = buttons()[0]; if (b) select(b); else canvas.focus({ preventScroll: true }); }
  function moveFocus(d) {
    const list = buttons(); if (!list.length) return;
    const i = list.indexOf(selected() || document.activeElement);
    select(list[(i + d + list.length) % list.length]);
  }
  screenEl.addEventListener('focusin', e => { if (e.target.matches?.('button') && !e.target.hasAttribute('data-selected')) select(e.target); });
  screenEl.addEventListener('pointerover', e => { const b = e.target.closest?.('button'); if (b && !b.hasAttribute('data-selected')) select(b); });
  function setScreen(name, html = '') {
    screen = name; screenT = 0; keys.clear(); acc = 0;
    root.dataset.screen = name; screenEl.innerHTML = html;
    sound('music', musicFor(name));
    if (['pause', 'over', 'won'].includes(name)) focusFirst(); else canvas.focus({ preventScroll: true });
  }
  function fadeTo(fn) {
    if (fading) return; fading = true;
    fadeEl.classList.add('on');
    later(() => { fn(); fadeEl.classList.remove('on'); fading = false; }, reduced() ? 60 : 170);
  }
  const titleArt = () => spec.art?.title || spec.art?.background || '';
  function showTitle() { state = game.createState(); snap = true; setScreen('title', titleScreen({ spec, device, art: titleArt() })); }
  function startRun() {
    state = game.createState(); start = structuredClone(state); checkpoint = initialCheckpoint(state);
    history = []; pending = []; hitStop = 0; endAt = null; snap = true; goShown = false;
    setScreen('intro', introBanner({ spec }));
  }
  function pause() { if (screen !== 'play' && screen !== 'intro') return; howto = false; setScreen('pause', pauseScreen({ spec, device, muted, howto })); }
  function resume() { setScreen('play'); last = performance.now(); }
  function showEnd() {
    if (state.status === 'won') {
      const stats = tally(state, start), { best, isNew } = recordBest(storage, spec.id, stats.seconds);
      setScreen('won', victoryScreen({ stats, best, isNew }));
    } else setScreen('over', gameOverScreen({ reason: lossReason(history, spec), stats: tally(state, start) }));
  }
  function action(name) {
    if (fading) return;
    if (name === 'start') fadeTo(startRun);
    else if (name === 'resume') resume();
    else if (name === 'restart') fadeTo(startRun);
    else if (name === 'title') fadeTo(showTitle);
    else if (name === 'sound') {
      muted = !muted; store.set(MUTE_KEY, muted ? '1' : '0'); sound('setMuted', muted);
      screenEl.innerHTML = pauseScreen({ spec, device, muted, howto }); select(screenEl.querySelector('[data-action="sound"]'));
    } else if (name === 'howto') {
      howto = !howto; screenEl.innerHTML = pauseScreen({ spec, device, muted, howto }); select(screenEl.querySelector('[data-action="howto"]'));
    }
  }
  function back() {
    if (screen === 'pause') resume();
    else if (screen === 'play' || screen === 'intro') pause();
  }
  const onClick = e => { const a = e.target.closest('[data-action]')?.dataset.action; if (a) { unlock(); action(a); } };
  root.addEventListener('click', onClick);

  // ---------- input ----------
  const editable = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const ours = () => { const a = document.activeElement; return !a || a === document.body || root.contains(a); };
  const menu = () => screen === 'pause' || screen === 'over' || screen === 'won';
  const down = e => {
    if (!ours() || editable(document.activeElement)) return;
    setDevice('keyboard'); unlock();
    const c = e.code;
    if (screen === 'title') { if (CONFIRM.has(c) && !e.repeat) { e.preventDefault(); action('start'); } return; }
    if (screen === 'play' || screen === 'intro') {
      if (BACK.has(c)) { e.preventDefault(); if (!e.repeat) pause(); return; }
      if (c === 'KeyR') { e.preventDefault(); if (!e.repeat) action('restart'); return; }
      if (KEYS.has(c)) { e.preventDefault(); keys.add(c); }
      return;
    }
    if (!menu()) return;
    if (PREV.has(c)) { e.preventDefault(); moveFocus(-1); }
    else if (NEXT.has(c)) { e.preventDefault(); moveFocus(1); }
    else if (CONFIRM.has(c)) { e.preventDefault(); if (!e.repeat) { const b = selected(); if (b) action(b.dataset.action); else focusFirst(); } }
    else if (BACK.has(c)) { e.preventDefault(); if (!e.repeat) back(); }
  };
  const up = e => { keys.delete(e.code); if (menu() && (e.code === 'Space' || e.code === 'Enter')) e.preventDefault(); };
  const pointer = () => unlock();
  const blur = () => keys.clear();
  addEventListener('keydown', down); addEventListener('keyup', up); addEventListener('blur', blur);
  root.addEventListener('pointerdown', pointer);

  let padPrev = [], stickPrev = 0;
  function readPad() {
    const pad = [...(navigator.getGamepads?.() || [])].find(p => p?.connected);
    if (!pad) { padPrev = []; return null; }
    const prev = padPrev, now = pad.buttons.map(b => !!b?.pressed), edge = i => now[i] && !prev[i];
    if (now.some(Boolean) || pad.axes.some(a => Math.abs(a) > 0.5)) { setDevice('gamepad'); unlock(); }
    const stick = Math.abs(pad.axes[1] || 0) > 0.6 ? Math.sign(pad.axes[1]) : 0, stickEdge = stick !== stickPrev ? stick : 0;
    stickPrev = stick; padPrev = now;
    if (screen === 'title' && (edge(0) || edge(9))) action('start');
    else if ((screen === 'play' || screen === 'intro') && edge(9)) pause();
    else if (menu()) {
      if (edge(12) || edge(14) || stickEdge < 0) moveFocus(-1);
      else if (edge(13) || edge(15) || stickEdge > 0) moveFocus(1);
      else if (edge(0)) { const b = selected(); if (b) action(b.dataset.action); else focusFirst(); }
      else if (edge(1) || edge(9)) back();
    }
    return pad;
  }
  const input = pad => {
    const k = c => keys.has(c), axis = i => (pad && Math.abs(pad.axes[i]) > 0.3 ? Math.sign(pad.axes[i]) : 0);
    return {
      x: ((k('ArrowRight') || k('KeyD') || pad?.buttons[15]?.pressed) ? 1 : 0) - ((k('ArrowLeft') || k('KeyA') || pad?.buttons[14]?.pressed) ? 1 : 0) || axis(0),
      y: ((k('ArrowDown') || k('KeyS') || pad?.buttons[13]?.pressed) ? 1 : 0) - ((k('ArrowUp') || k('KeyW') || pad?.buttons[12]?.pressed) ? 1 : 0) || axis(1),
      a: k('Space') || k('KeyZ') || k('KeyJ') || !!pad?.buttons[0]?.pressed,
      b: k('KeyX') || k('KeyK') || !!pad?.buttons[2]?.pressed,
    };
  };

  // ---------- simulation ----------
  function simulate(seconds, pad) {
    acc = Math.min(acc + seconds, 0.25);
    const i = input(pad);
    while (acc >= DT) {
      acc -= DT;
      if (hitStop > 0) { hitStop--; continue; } // freeze a few frames on impacts
      if (state.status !== 'playing') { acc = 0; break; }
      const hpBefore = state.vars.hp;
      game.step(state, i);
      // Hazards emit hurt every frame of contact; only hits that cost hp count.
      let events = state.events.filter(e => e.name !== 'hurt' || state.vars.hp < hpBefore);
      if (canRespawn(state, checkpoint)) { state = respawn(state, checkpoint); events = [...events, { name: 'respawn' }]; }
      else checkpoint = updateCheckpoint(checkpoint, state, game);
      hitStop = Math.max(hitStop, hitStopFor(events));
      if (events.length) { pending.push(...events); history.push(...events); if (history.length > 60) history = history.slice(-60); sound('onEvents', events, state); }
      if (state.status !== 'playing') endAt = screenT;
    }
  }

  const frame = now => {
    if (disposed) return;
    const real = Math.min((now - last) / 1000, 0.25); last = now;
    const pad = readPad();
    screenT += real;
    let intro = 1;
    if (screen === 'intro') {
      intro = reduced() ? 1 : Math.min(1, screenT / INTRO_DROP);
      if (screenT >= INTRO_GO && !goShown) {
        goShown = true; screen = 'play'; root.dataset.screen = 'play'; screenEl.innerHTML = introBanner({ spec, go: true });
        clearTimeout(bannerTimer); bannerTimer = later(() => { if (screen === 'play') screenEl.innerHTML = ''; }, 700);
      }
    } else if (screen === 'play') {
      simulate(real, pad);
      if (state.status !== 'playing' && endAt != null && screenT - endAt > (state.status === 'won' ? 1.4 : 1.1)) { endAt = null; fadeTo(showEnd); }
    }
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (rect.width && rect.height) {
      if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(ctx, state, { cssWidth: rect.width, cssHeight: rect.height, dt: real, events: pending, reducedMotion: reduced(), paused: screen === 'pause', intro, attract: screen === 'title', hud: screen !== 'title', screens: true, snap });
      pending = []; snap = false;
    }
    raf = requestAnimationFrame(frame);
  };
  showTitle();
  raf = requestAnimationFrame(frame);
  // Read-only hook for browser checks and playtest tooling.
  Object.defineProperty(root, 'arcade', { value: { get screen() { return screen; }, get state() { return state; }, get checkpoint() { return checkpoint; }, get fx() { return render.fx; } } });

  return {
    version: record.version,
    /** Hot-swap a newer version: same level and rules (e.g. new art) keeps the run going; otherwise restart. */
    update(next) {
      const nextChecked = preflight(next.doc, registry);
      if (!nextChecked.ok) return false;
      const same = JSON.stringify([next.doc.level, next.doc.modules, next.doc.win, next.doc.lose]) === JSON.stringify([record.doc.level, record.doc.modules, record.doc.win, record.doc.lose]);
      spec = nextChecked.spec; game = compose(spec, registry); render = createRenderer(game, { fx: same ? render.fx : undefined });
      record = next; this.version = next.version;
      applyTheme(); renderHelp(); canvas.setAttribute('aria-label', spec.title);
      if (screen === 'title') showTitle();
      else if (!same) startRun();
      return true;
    },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); for (const t of timers) clearTimeout(t);
      removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur);
      sound('music', 'off'); sound('dispose');
      container.replaceChildren();
    },
  };
}
