// Canvas host for genre-kit games (gameverse.v2.kit-game/0.1): the same
// screens, input, sound and hot reload for every kit. The kit owns rules and
// drawing (see v2/kits/KIT_CONTRACT.md); this file owns everything around play.
import { loadKit } from '/v2/kits/registry.js';
import { esc, titleParts } from './arcade-overlay.js';

const DT = 1 / 60;
const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyZ', 'KeyX', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyJ', 'KeyK']);
const CONFIRM = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyZ', 'KeyJ']);
const BACK = new Set(['Escape', 'KeyP']);
const PREV = new Set(['ArrowUp', 'ArrowLeft', 'KeyW', 'KeyA']), NEXT = new Set(['ArrowDown', 'ArrowRight', 'KeyS', 'KeyD']);
const MUTE_KEY = 'gameverse.v2.muted';
// Kit events → the shared sound bank.
const SOUND_OF = { power: 'reach_goal', extra_life: 'reach_goal', level_up: 'reach_goal', won: 'reach_goal', lost: 'fell' };

let storage = null;
try { storage = globalThis.localStorage ?? null; } catch {}
const store = { get: k => { try { return storage?.getItem(k) ?? null; } catch { return null; } }, set: (k, v) => { try { storage?.setItem(k, v); } catch {} } };

const kbd = k => `<kbd>${esc(k)}</kbd>`, pad = k => `<kbd class="pad">${esc(k)}</kbd>`;
const KEYS_FOR = { move: [`${kbd('←')}${kbd('↑')}${kbd('↓')}${kbd('→')} or ${kbd('WASD')}`, `${pad('✚')} or ${pad('L')}`], a: [`${kbd('Space')} or ${kbd('Z')}`, pad('A')], b: [`${kbd('X')} or ${kbd('K')}`, pad('X')] };
function controlRows(kit, device) {
  const gp = device === 'gamepad' ? 1 : 0;
  const rows = (kit.controls || [{ input: 'move', label: 'Move' }]).map(c => [c.label, KEYS_FOR[c.input]?.[gp] || '']);
  rows.push(['Pause', gp ? pad('Start') : kbd('Esc')]);
  if (!gp) rows.push(['Restart', kbd('R')]);
  return rows;
}
const controlsCard = (kit, device) => `<dl class="gv-keys">${controlRows(kit, device).map(([l, k]) => `<div><dt>${esc(l)}</dt><dd>${k}</dd></div>`).join('')}</dl>`;
const pressStart = device => device === 'gamepad' ? `Press ${pad('A')} or ${pad('Start')}` : `Press ${kbd('Enter')} to start`;

function titleScreen({ doc, kit, device }) {
  const [name, sub] = titleParts(doc.title);
  const art = doc.art?.title || doc.art?.background || '';
  return `<section class="gv-title" aria-label="${esc(doc.title)} title screen">
    ${art ? `<div class="gv-keyart"><img src="${esc(art)}" alt=""></div>` : ''}
    <div class="gv-title-main">
      <h2 class="gv-name"><span>${esc(name)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</h2>
      ${doc.logline ? `<p class="gv-pitch">${esc(doc.logline)}</p>` : ''}
      <button type="button" class="gv-start" data-action="start" data-hint="press">${pressStart(device)}</button>
    </div>
    <aside class="gv-card gv-controls" aria-label="Controls">
      <h3>How to play</h3>
      <p class="gv-goal">${esc(kit.goal?.(doc.content) || kit.summary)}</p>
      <div data-hint="controls">${controlsCard(kit, device)}</div>
    </aside>
  </section>`;
}
const menuScreen = (title, cls, body, buttons) => `<section class="gv-menu ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${body}<div class="gv-buttons">${buttons.map(([a, l, extra = '']) => `<button type="button" data-action="${a}"${extra}>${esc(l)}</button>`).join('')}</div></section>`;
const statsList = rows => `<dl class="gv-stats">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
const bestKey = id => `gameverse.v2.best.${id}`;

function ensureStyles() {
  if (document.getElementById('gv-arcade-css')) return;
  document.head.append(Object.assign(document.createElement('link'), { id: 'gv-arcade-css', rel: 'stylesheet', href: '/v2/web/arcade.css' }));
}

/** Mount a kit game. Returns { version, update(record), dispose() } like the arcade player. */
export function mountKit(container, record) {
  ensureStyles();
  container.replaceChildren();
  const root = document.createElement('div');
  root.className = 'gv-arcade';
  root.innerHTML = `<canvas class="arcade" tabindex="0"></canvas><div class="gv-screen" aria-live="polite"></div><div class="gv-fade" aria-hidden="true"></div>`;
  const help = document.createElement('p'); help.className = 'arcade-help';
  container.append(root, help);
  const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d');
  const screenEl = root.querySelector('.gv-screen'), fadeEl = root.querySelector('.gv-fade');
  const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => !!motion?.matches;

  let doc = record.doc, kit = null, game = null, render = null, state = null;
  let screen = 'loading', screenT = 0, device = 'keyboard', muted = store.get(MUTE_KEY) === '1';
  let pending = [], endAt = null, fading = false, last = performance.now(), acc = 0, raf = 0, disposed = false, runStart = 0;
  // `tapped` holds keys pressed since the last step, so a tap shorter than one step still registers.
  const keys = new Set(), tapped = new Set(), timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!disposed) fn(); }, ms); timers.add(t); return t; };

  // ---------- sound ----------
  let audio = null, unlocked = false;
  const sound = (method, ...args) => { try { return audio?.[method]?.(...args); } catch { return undefined; } };
  const musicFor = s => ({ title: 'title', play: 'play', pause: 'pause', over: 'lose', won: 'win' }[s] || 'off');
  const unlock = () => { if (audio && !unlocked) { unlocked = true; sound('unlock'); sound('music', musicFor(screen)); } };
  import('/v2/engine/audio.js').catch(() => null).then(m => {
    if (disposed || !m?.createAudio) return;
    try { audio = m.createAudio({ spec: { id: doc.id, title: doc.title, pitch: doc.logline, music: doc.content?.music } }); } catch { audio = null; return; }
    sound('setMuted', muted); sound('music', musicFor(screen));
  });

  // ---------- screens ----------
  const buttons = () => [...screenEl.querySelectorAll('button')];
  function select(b) { for (const x of buttons()) x.toggleAttribute('data-selected', x === b); b?.focus({ preventScroll: true }); }
  const selected = () => buttons().find(b => b.hasAttribute('data-selected')) || null;
  const focusFirst = () => { const b = buttons()[0]; if (b) select(b); else canvas.focus({ preventScroll: true }); };
  function moveFocus(d) { const list = buttons(); if (!list.length) return; const i = list.indexOf(selected() || document.activeElement); select(list[(i + d + list.length) % list.length]); }
  screenEl.addEventListener('pointerover', e => { const b = e.target.closest?.('button'); if (b && !b.hasAttribute('data-selected')) select(b); });
  function setScreen(name, html = '') {
    screen = name; screenT = 0; keys.clear(); tapped.clear(); acc = 0;
    root.dataset.screen = name; screenEl.innerHTML = html;
    sound('music', musicFor(name));
    if (['pause', 'over', 'won'].includes(name)) focusFirst(); else canvas.focus({ preventScroll: true });
  }
  function fadeTo(fn) { if (fading) return; fading = true; fadeEl.classList.add('on'); later(() => { fn(); fadeEl.classList.remove('on'); fading = false; }, reduced() ? 60 : 170); }
  const fresh = () => { const s = game.createState(); s.best = Number(store.get(bestKey(doc.id))) || 0; return s; };
  function showTitle() { state = fresh(); setScreen('title', titleScreen({ doc, kit, device })); }
  function startRun() { state = fresh(); pending = []; endAt = null; runStart = performance.now(); setScreen('play'); }
  const pauseHtml = () => menuScreen('Paused', '', '', [['resume', 'Resume'], ['restart', 'Restart'], ['sound', `Sound: ${muted ? 'Off' : 'On'}`, ` aria-pressed="${!muted}"`], ['title', 'Quit to title']]);
  function pause() { if (screen === 'play') setScreen('pause', pauseHtml()); }
  function resume() { setScreen('play'); last = performance.now(); }
  function showEnd() {
    const seconds = Math.round((performance.now() - runStart) / 1000);
    const best = Math.max(Number(store.get(bestKey(doc.id))) || 0, state.score || 0);
    const isNew = (state.score || 0) > 0 && best === state.score;
    store.set(bestKey(doc.id), String(best));
    const rows = [['Score', String(state.score || 0)], ['Best', `${best}${isNew ? ' — new best!' : ''}`], ['Time', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`], ...(kit.stats?.(state) || [])];
    if (state.status === 'won') setScreen('won', menuScreen('You win!', 'gv-win', statsList(rows), [['restart', 'Play again'], ['title', 'Title screen']]));
    else setScreen('over', menuScreen('Game over', 'gv-over', `<p class="gv-reason">${esc(state.reason || 'Out of lives')}</p>${statsList(rows)}`, [['restart', 'Retry'], ['title', 'Title screen']]));
  }
  function action(name) {
    if (fading) return;
    if (name === 'start' || name === 'restart') fadeTo(startRun);
    else if (name === 'resume') resume();
    else if (name === 'title') fadeTo(showTitle);
    else if (name === 'sound') { muted = !muted; store.set(MUTE_KEY, muted ? '1' : '0'); sound('setMuted', muted); screenEl.innerHTML = pauseHtml(); select(screenEl.querySelector('[data-action="sound"]')); }
  }
  root.addEventListener('click', e => { const a = e.target.closest('[data-action]')?.dataset.action; if (a) { unlock(); action(a); } });

  // ---------- input ----------
  const editable = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const ours = () => { const a = document.activeElement; return !a || a === document.body || root.contains(a); };
  const menu = () => screen === 'pause' || screen === 'over' || screen === 'won';
  const renderHelp = () => { if (kit) help.innerHTML = controlRows(kit, device).map(([l, k]) => `<span>${esc(l)} ${k}</span>`).join(''); };
  function setDevice(next) {
    if (next === device) return; device = next; renderHelp();
    for (const el of screenEl.querySelectorAll('[data-hint="controls"]')) el.innerHTML = controlsCard(kit, device);
    for (const el of screenEl.querySelectorAll('[data-hint="press"]')) el.innerHTML = pressStart(device);
  }
  const down = e => {
    if (!ours() || editable(document.activeElement) || !kit) return;
    setDevice('keyboard'); unlock();
    const c = e.code;
    if (screen === 'title') { if (CONFIRM.has(c) && !e.repeat) { e.preventDefault(); action('start'); } return; }
    if (screen === 'play') {
      if (BACK.has(c)) { e.preventDefault(); if (!e.repeat) pause(); return; }
      if (c === 'KeyR') { e.preventDefault(); if (!e.repeat) action('restart'); return; }
      if (KEYS.has(c)) { e.preventDefault(); keys.add(c); if (!e.repeat) tapped.add(c); }
      return;
    }
    if (!menu()) return;
    if (PREV.has(c)) { e.preventDefault(); moveFocus(-1); }
    else if (NEXT.has(c)) { e.preventDefault(); moveFocus(1); }
    else if (CONFIRM.has(c)) { e.preventDefault(); if (!e.repeat) { const b = selected(); if (b) action(b.dataset.action); else focusFirst(); } }
    else if (BACK.has(c) && screen === 'pause') { e.preventDefault(); resume(); }
  };
  const up = e => keys.delete(e.code);
  const blur = () => { keys.clear(); tapped.clear(); };
  addEventListener('keydown', down); addEventListener('keyup', up); addEventListener('blur', blur);
  root.addEventListener('pointerdown', unlock);

  let padPrev = [];
  function readPad() {
    const p = [...(navigator.getGamepads?.() || [])].find(g => g?.connected);
    if (!p) { padPrev = []; return null; }
    const now = p.buttons.map(b => !!b?.pressed), edge = i => now[i] && !padPrev[i];
    if (now.some(Boolean) || p.axes.some(a => Math.abs(a) > 0.5)) { setDevice('gamepad'); unlock(); }
    if (screen === 'title' && (edge(0) || edge(9))) action('start');
    else if (screen === 'play' && edge(9)) pause();
    else if (menu()) { if (edge(12) || edge(14)) moveFocus(-1); else if (edge(13) || edge(15)) moveFocus(1); else if (edge(0)) { const b = selected(); if (b) action(b.dataset.action); } else if ((edge(1) || edge(9)) && screen === 'pause') resume(); }
    padPrev = now;
    return p;
  }
  const input = p => {
    const k = c => keys.has(c) || tapped.has(c), axis = i => (p && Math.abs(p.axes[i]) > 0.35 ? Math.sign(p.axes[i]) : 0);
    return {
      x: ((k('ArrowRight') || k('KeyD') || p?.buttons[15]?.pressed) ? 1 : 0) - ((k('ArrowLeft') || k('KeyA') || p?.buttons[14]?.pressed) ? 1 : 0) || axis(0),
      y: ((k('ArrowDown') || k('KeyS') || p?.buttons[13]?.pressed) ? 1 : 0) - ((k('ArrowUp') || k('KeyW') || p?.buttons[12]?.pressed) ? 1 : 0) || axis(1),
      a: k('Space') || k('KeyZ') || k('KeyJ') || !!p?.buttons[0]?.pressed,
      b: k('KeyX') || k('KeyK') || !!p?.buttons[2]?.pressed,
    };
  };

  // ---------- loop ----------
  function simulate(seconds, p) {
    acc = Math.min(acc + seconds, 0.25);
    const i = input(p);
    while (acc >= DT) {
      acc -= DT;
      if (state.status !== 'playing') { acc = 0; break; }
      game.step(state, i);
      if (tapped.size) { tapped.clear(); Object.assign(i, input(p)); }
      const events = state.events || [];
      if (events.length) { pending.push(...events); sound('onEvents', events.map(e => SOUND_OF[e.name] ? { ...e, name: SOUND_OF[e.name] } : e), state); }
      if (state.status !== 'playing') endAt = screenT;
    }
  }
  const frame = now => {
    if (disposed) return;
    const real = Math.min((now - last) / 1000, 0.25); last = now;
    const p = readPad();
    screenT += real;
    if (screen === 'play' && game) {
      simulate(real, p);
      if (state.status !== 'playing' && endAt != null && screenT - endAt > 1.2) { endAt = null; fadeTo(showEnd); }
    }
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (render && rect.width && rect.height) {
      if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      try { render(ctx, state, { cssWidth: rect.width, cssHeight: rect.height, dt: real, events: pending, reducedMotion: reduced(), paused: screen === 'pause', attract: screen === 'title' }); } catch (error) { console.error(error); }
      pending = [];
    }
    raf = requestAnimationFrame(frame);
  };

  async function load(nextDoc, { keepRun = false } = {}) {
    const nextKit = await loadKit(nextDoc.kit);
    if (disposed) return false;
    const checked = nextKit.validate(nextDoc.content);
    if (!checked.ok) { screenEl.innerHTML = `<p class="gv-reason">This game failed its checks in the browser.</p>`; return false; }
    const sameRules = kit === nextKit && JSON.stringify(doc.content) === JSON.stringify(nextDoc.content);
    doc = nextDoc; kit = nextKit;
    game = kit.createGame(checked.content, { seed: doc.seed ?? 1 });
    render = kit.createRenderer(game, { art: doc.art || {} });
    canvas.setAttribute('aria-label', doc.title);
    root.dataset.pixel = doc.art?.style && /pixel/i.test(doc.art.style) ? 'true' : 'false';
    renderHelp();
    // New art or theme only: keep the run going. New rules: restart from the title.
    if (!(keepRun && sameRules && screen !== 'loading')) showTitle();
    return true;
  }
  load(doc).then(() => { raf = requestAnimationFrame(frame); });

  return {
    version: record.version,
    update(next) {
      if (next.doc?.schema !== doc.schema) return false;
      this.version = next.version;
      load(next.doc, { keepRun: true });
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
