// Experiments on top of a (modded) kit game, for every host: the studio (v2/web/kit-player.js) and
// the overworld (src/generated-adapter.js). Like composeGame/composeRenderer for mods, the result
// is a { createState, step, controls } game and a render(ctx, state, frame) renderer, so hosts treat
// an experimental game like any other. Experiments that fail or stall are disabled; the base game
// keeps running either way.
import { createSandboxedExperiment } from './runtime.js';
import { experimentWorld, freeButtons, experimentInput, safeSnapshot as snapshot } from './sandbox.js';

const TAU = Math.PI * 2;

/** Experiments a host should run: stored with code, and not marked as failing their check. */
export const runnableExperiments = list => (Array.isArray(list) ? list : []).filter(e => e && typeof e.code === 'string' && e.check?.ok !== false).slice(0, 4);

/**
 * Wrap a composed kit game and renderer with experiments.
 * `sandbox(experiment, { kit, world, seed, onNote })` hosts one experiment (default: a Worker, see runtime.js).
 * Returns { game, render, experiments, dispose }.
 */
export function composeExperiments(kit, game, renderer, experiments, { sandbox = createSandboxedExperiment, seed = 1, onNote = () => {} } = {}) {
  const list = runnableExperiments(experiments);
  if (!list.length) return { game, render: renderer, experiments: [], dispose() {} };
  const world = experimentWorld(kit, game);
  const free = freeButtons(kit, game);
  const entries = list.map(experiment => {
    const button = experiment.button === true ? free.shift() ?? null : null;
    let box;
    try { box = sandbox(experiment, { kit, world, seed, onNote }); }
    catch (error) { box = deadBox(experiment, `it could not start (${String(error?.message || error).slice(0, 120)})`); onNote(`Experiment “${experiment.label || 'Experiment'}” stopped: ${box.status.note}`); }
    return { experiment, id: experiment.id || null, label: String(experiment.label || box.label || 'Experiment').slice(0, 40), button, box, prevHeld: false, started: false };
  });

  const createState = (...args) => {
    const s = game.createState(...args);
    const snap = snapshot(kit, world, s, []);
    for (const e of entries) { e.prevHeld = false; e.started = true; try { e.box.reset(snap); } catch {} }
    return s;
  };
  const step = (s, input = {}) => {
    // A state the host didn't create here (a restored checkpoint, a run kept across a reload) starts the experiments now.
    if (entries.some(e => !e.started)) { const snap = snapshot(kit, world, s, []); for (const e of entries) if (!e.started) { e.started = true; try { e.box.reset(snap); } catch {} } }
    // The kit and its mods never see a button an experiment owns.
    const kitInput = { ...input };
    for (const e of entries) if (e.button) kitInput[e.button] = false;
    const next = game.step(s, kitInput) || s;
    const events = [...(next.events || [])];
    for (const e of entries) {
      const emit = (name, data = {}) => (next.events ||= []).push({ ...data, name, experiment: e.id || e.label });
      try { e.box.applyPending(next, emit); } catch {}
    }
    const snap = snapshot(kit, world, next, events);
    for (const e of entries) {
      const xin = experimentInput(input, e.button, e.prevHeld); e.prevHeld = xin.held;
      try { e.box.post(snap, xin); } catch {}
    }
    return next;
  };
  const controls = [...(game.controls || []),
    ...entries.map(e => e.button ? { input: e.button, label: `${e.label} (experimental)`, experimental: true } : { input: 'experiment', label: `Experimental: ${e.label} — not play-tested`, experimental: true })];
  const composed = { ...game, createState, step, controls, experiments: entries.map(e => ({ id: e.id, label: e.label, button: e.button, status: e.box.status })) };

  const wrapped = (ctx, state, frame = {}) => {
    renderer(ctx, state, frame);
    const view = renderer.view || renderer.inner?.view || null;
    for (const e of entries) { try { drawDisplayList(ctx, view, e.box.draws); } catch {} }
    try { drawBadge(ctx, frame, entries); } catch {}
  };
  wrapped.fx = renderer.fx; wrapped.inner = renderer;
  Object.defineProperty(wrapped, 'view', { get: () => renderer.view || renderer.inner?.view || null });
  const dispose = () => { for (const e of entries) { try { e.box.dispose(); } catch {} } };
  composed.dispose = dispose;
  return { game: composed, render: wrapped, experiments: composed.experiments, dispose };
}

function deadBox(experiment, note) {
  return { label: experiment.label || 'Experiment', button: false, status: { disabled: true, note, label: experiment.label || 'Experiment' }, draws: [], reset() {}, applyPending() { return { applied: 0, dropped: 0 }; }, post() {}, dispose() {} };
}

const clampAlpha = a => (Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1);
const span = (a, b) => [Math.min(a, b), Math.abs(b - a)];

/** Draw an experiment display list (world units) with the kit's render.view mapping: X(x), Y(y), s, clip. */
export function drawDisplayList(ctx, view, draws) {
  if (!view || typeof view.X !== 'function' || typeof view.Y !== 'function' || !draws?.length) return 0;
  const { X, Y } = view, s = Number.isFinite(view.s) && view.s > 0 ? view.s : 1;
  ctx.save();
  if (view.clip) { ctx.beginPath(); ctx.rect(view.clip.x, view.clip.y, view.clip.w, view.clip.h); ctx.clip(); }
  let n = 0;
  for (const d of draws) {
    ctx.globalAlpha = clampAlpha(d.alpha);
    if (d.t === 'rect') {
      const [x, w] = span(X(d.x), X(d.x + d.w)), [y, h] = span(Y(d.y), Y(d.y + d.h));
      ctx.fillStyle = d.color; ctx.fillRect(x, y, Math.max(w, 1), Math.max(h, 1));
    } else if (d.t === 'circle') {
      ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(X(d.x), Y(d.y), Math.max(0.5, d.r * s), 0, TAU); ctx.fill();
    } else if (d.t === 'line') {
      ctx.strokeStyle = d.color; ctx.lineWidth = Math.max(1, (d.width ?? 0.1) * s); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(X(d.x1), Y(d.y1)); ctx.lineTo(X(d.x2), Y(d.y2)); ctx.stroke();
    } else if (d.t === 'poly') {
      ctx.fillStyle = d.color; ctx.beginPath();
      d.points.forEach(([px, py], i) => (i ? ctx.lineTo(X(px), Y(py)) : ctx.moveTo(X(px), Y(py))));
      ctx.closePath(); ctx.fill();
    } else if (d.t === 'text') {
      const px = Math.max(8, Math.min(64, (d.size ?? 0.6) * s));
      ctx.font = `700 ${px}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = d.color; ctx.fillText(String(d.text).slice(0, 60), X(d.x), Y(d.y));
    } else continue;
    n++;
  }
  ctx.restore();
  return n;
}

/** The "EXPERIMENTAL" badge: bottom-left, one line per experiment; a stopped experiment says why. */
export function drawBadge(ctx, frame, entries) {
  const h = frame.cssHeight || 0;
  if (!h || !entries.length) return;
  ctx.save();
  ctx.globalAlpha = 1; ctx.font = '800 10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  let y = h - 14;
  for (const e of [...entries].reverse()) {
    const off = e.box.status?.disabled;
    const text = off ? `EXPERIMENT STOPPED · ${e.label} — ${e.box.status.note}`.slice(0, 90) : `EXPERIMENTAL · ${e.label} · not play-tested`;
    const w = (ctx.measureText ? ctx.measureText(text).width : text.length * 6) + 14;
    ctx.fillStyle = off ? 'rgba(90,16,24,.82)' : 'rgba(10,12,22,.72)';
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(8, y - 8, w, 16, 8); else ctx.rect(8, y - 8, w, 16); ctx.fill();
    ctx.fillStyle = off ? '#ffb3b3' : '#ffd23f'; ctx.fillText(text, 15, y + 0.5);
    y -= 20;
  }
  ctx.restore();
}
