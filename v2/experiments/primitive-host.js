// Primitive experiments (ARCHITECTURE.md §4, step 4): a mechanic no primitive covers,
// written by a code model as a sandboxed module plus a card, and hosted as a real
// kernel primitive. The module never touches the runtime: each step it receives a
// JSON snapshot of the world and returns kernel effects ({do: ...}) that the host
// validates against the registered vocabulary and runs. Its state and rng live in
// rt.state (rt.store), so snapshots, restores, solvers and replays stay exact.
// Shared by Node (vm box, synchronous) and the browser (Worker box, one frame of lag).
import { cleanDraws } from './harness.js';
import { seedFrom } from '../kernel/rng.js';

export const PRIMITIVE_EXPERIMENT_SCHEMA = 'gameverse.v2.primitive-experiment/0.1';
export const HOST_LIMITS = { opsPerStep: 16, entities: 30, events: 30, counts: 60, maxErrors: 3 };
const ID = /^(engine|plot|graphics|gameplay)(\.[a-z][a-z0-9-]*){1,3}$/;
const PARAM_TYPES = new Set(['number', 'integer', 'boolean', 'string', 'list', 'object', 'json']);
const PHASES = ['input', 'ai', 'movement', 'physics', 'interaction', 'rules', 'plot', 'late'];

/** Card checks beyond the registry's: only plain param types (no refs/predicates/effects), string lists, a phase. */
export function cardProblems(card) {
  const out = [], p = (code, message) => out.push({ code, message });
  if (!card || typeof card !== 'object') return [{ code: 'card_invalid', message: 'the card must be an object' }];
  if (!ID.test(card.id || '')) p('card_invalid', `card.id '${card.id}' must look like family.domain.name (family: gameplay, engine, plot or graphics)`);
  if (/^engine\.(space|generate)\./.test(card.id || '') || /^graphics\./.test(card.id || '')) p('card_invalid', 'experiments are systems: not spaces, generators or graphics');
  if (typeof card.intent !== 'string' || card.intent.length < 10) p('card_invalid', 'card.intent must describe the mechanic in a sentence');
  for (const [name, s] of Object.entries(card.params || {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) p('card_invalid', `param name '${name}' must be camelCase`);
    if (!PARAM_TYPES.has(s?.type)) p('card_invalid', `param '${name}' type must be one of ${[...PARAM_TYPES].join(', ')}`);
    if ((s?.type === 'number' || s?.type === 'integer') && s.default !== undefined && (s.min !== undefined && s.default < s.min || s.max !== undefined && s.default > s.max)) p('card_invalid', `param '${name}' default is outside its range`);
  }
  for (const k of ['events', 'vars', 'actions']) if (card.provides?.[k] !== undefined && !(Array.isArray(card.provides[k]) && card.provides[k].every(x => typeof x === 'string' && /^[a-z][a-z0-9_.:*-]*$/.test(x)))) p('card_invalid', `card.provides.${k} must be a list of lowercase names`);
  if (card.requires?.capabilities !== undefined && !(Array.isArray(card.requires.capabilities) && card.requires.capabilities.every(x => typeof x === 'string'))) p('card_invalid', 'card.requires.capabilities must be a list');
  if (card.phase !== undefined && !PHASES.includes(card.phase)) p('card_invalid', `card.phase must be one of ${PHASES.join(', ')}`);
  if (card.defines || card.reads?.length) p('card_invalid', 'experiments cannot define reference kinds or read document sections');
  return out;
}

export function cleanCard(card) {
  return {
    id: card.id, intent: String(card.intent).slice(0, 400), views: Array.isArray(card.views) && card.views.length ? card.views.map(String).slice(0, 8) : ['any'],
    params: structuredClone(card.params || {}), phase: card.phase || 'rules', experimental: true,
    provides: { events: [...(card.provides?.events || [])], vars: [...(card.provides?.vars || [])], actions: [...(card.provides?.actions || [])] },
    requires: { capabilities: [...(card.requires?.capabilities || [])], primitives: [], services: [] },
  };
}

const small = v => typeof v === 'string' ? v.slice(0, 60) : typeof v === 'number' || typeof v === 'boolean' || v === null ? v : undefined;
function distance(rt, p, e) { try { const d = rt.space(p.space).distance?.(p.at, e.at); return Number.isFinite(d) ? d : 1e9; } catch { return 1e9; } }

/** The JSON view of the world an experiment receives each step. */
export function kernelSnapshot(rt, input = {}) {
  const s = rt.state, p = rt.player();
  const view = e => e && { id: e.id, archetype: e.archetype, space: e.space, at: e.at, zone: e.zone ?? null, hp: e.components?.health?.hp ?? null };
  let ents = Object.values(s.entities).filter(e => e.id !== 'player' && (!p || e.space === p.space));
  if (p && ents.length > HOST_LIMITS.entities) ents = ents.map(e => [e, distance(rt, p, e)]).sort((a, b) => a[1] - b[1] || (a[0].id < b[0].id ? -1 : 1)).slice(0, HOST_LIMITS.entities).map(x => x[0]);
  const zones = p?.space ? (rt.doc.spaces.find(x => x.id === p.space)?.zones || []).slice(0, 40).map(z => z.id) : [];
  return {
    frame: s.frame, time: s.time, status: s.status,
    player: p ? { ...view(p), body: p.components?.body ? { size: p.components.body.size, vel: p.components.body.vel, grounded: p.components.body.grounded } : null } : null,
    entities: ents.slice(0, HOST_LIMITS.entities).map(view), zones,
    vars: { ...s.vars }, flags: { ...s.flags },
    counts: Object.fromEntries(Object.entries(s.counts).slice(0, HOST_LIMITS.counts)),
    events: s.events.slice(-HOST_LIMITS.events).map(e => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, small(v)]).filter(([, v]) => v !== undefined).slice(0, 6))),
    input,
  };
}

/** Keep the effects the registered vocabulary accepts. -> { effects, dropped, problems } */
export function cleanEffects(ops, logic) {
  if (ops == null) return { effects: [], dropped: 0, problems: [] };
  if (!Array.isArray(ops)) return { effects: [], dropped: 1, problems: ['ops must be a list of effects'] };
  const effects = [], problems = [];
  let dropped = 0;
  const ctx = { checkPredicate: (q, path, errs) => logic.checkPredicate(q, path, errs, ctx), checkEffect: (e, path, errs) => logic.checkEffect(e, path, errs, ctx), noteRef() {} };
  for (const op of ops.slice(0, HOST_LIMITS.opsPerStep)) {
    const errors = [];
    if (!op || typeof op !== 'object' || typeof op.do !== 'string') errors.push({ message: `not an effect: ${JSON.stringify(op)?.slice(0, 80)}` });
    else logic.checkEffect(op, 'op', errors, ctx);
    if (errors.length) { dropped++; if (problems.length < 3) problems.push(`${errors[0].message}${errors[0].hint ? ` (${String(errors[0].hint).slice(0, 160)})` : ''}`); }
    else effects.push(op);
  }
  dropped += Math.max(0, ops.length - HOST_LIMITS.opsPerStep);
  return { effects, dropped, problems };
}

/**
 * A kernel primitive hosting one experiment. `box(code)` loads the module: the vm box
 * (vm-pure.js) answers synchronously; a Worker box (primitive-runtime.js) answers on a
 * later frame (`lagged`), returning null meanwhile. Stats are in rt.caches['exp:<key>'].
 */
export function hostPrimitive(experiment, { box: makeBox }) {
  const card = cleanCard(experiment.card);
  return {
    id: card.id, card,
    install(rt, config, instance) {
      const key = `exp:${instance.key}`;
      const stats = rt.caches[key] = { label: experiment.label, disabled: false, note: '', errors: 0, steps: 0, applied: 0, dropped: 0, problems: [], draws: [] };
      let box = null;
      const disable = note => { if (stats.disabled) return; stats.disabled = true; stats.note = note; stats.draws = []; rt.emit('experiment_stopped', { experiment: experiment.id, note }); };
      const failed = (where, message) => { stats.errors++; if (stats.problems.length < 6) stats.problems.push(`${where}: ${message}`); if (where === 'init' || stats.errors >= HOST_LIMITS.maxErrors) disable(`${where} kept failing (${message})`); };
      const actions = card.provides.actions;
      for (const a of actions) rt.action(a, (value, rt) => { const s = rt.store(key); (s.pressed ??= {})[a] = value === true ? true : value; });
      if (actions.length) rt.options(rt => (stats.disabled ? [] : actions.map(a => ({ label: `${experiment.label}: ${a}`, actions: { [a]: true } }))));
      rt.system(card.phase, rt => {
        if (stats.disabled) return;
        box ??= makeBox(experiment.code);
        if (box.error) return disable(`it did not load (${box.error})`);
        const s = rt.store(key);
        const input = { actions: s.pressed || {}, axes: rt.input?.axes || {} };
        const snapshot = kernelSnapshot(rt, input);
        if (!s.ready) {
          const r = box.init({ snapshot, config, rng: s.rng ?? seedFrom(`${rt.doc.seed ?? rt.doc.id}:${experiment.id}`) });
          if (!r) return;
          if (!r.ok) return failed('init', r.error);
          s.state = r.value.state; s.rng = r.value.rng; s.ready = true; s.pressed = {};
          return;
        }
        const r = box.step({ state: s.state, rng: s.rng, snapshot, input, config });
        if (!r) return;
        s.pressed = {};
        if (!r.ok) return failed('step', r.error);
        s.state = r.value.state; s.rng = r.value.rng; stats.steps++;
        const { effects, dropped, problems } = cleanEffects(r.value.ops, rt.logic);
        stats.dropped += dropped;
        for (const p of problems) if (stats.problems.length < 6 && !stats.problems.includes(p)) stats.problems.push(p);
        for (const e of effects) {
          try { rt.run([e], { self: 'player', experiment: experiment.id }); stats.applied++; }
          catch (error) { failed('effect', `${e.do}: ${String(error?.message || error).slice(0, 120)}`); }
          if (rt.state.status !== 'playing') break;
        }
        if (!rt.headless && box.meta?.draws) {
          const d = box.draw({ state: s.state, snapshot });
          if (d?.ok) stats.draws = cleanDraws(d.value.draws).draws;
        }
      }, card.id);
      if (!rt.headless && rt.view?.container && typeof document !== 'undefined') paintOverlay(rt, stats);
    },
  };
}

/** Draws are in overlay units: x, y, w, h, r, size in fractions of the game view's height (x in fractions of its width). */
function paintOverlay(rt, stats) {
  const canvas = document.createElement('canvas');
  canvas.className = 'gv-overlay gv-experiment-overlay';
  rt.view.container.append(canvas);
  rt.view.onFrame(() => {
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = globalThis.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    for (const d of stats.draws) {
      g.globalAlpha = d.alpha ?? 1; g.fillStyle = g.strokeStyle = d.color;
      if (d.t === 'rect') g.fillRect(d.x * w, d.y * h, d.w * w, d.h * h);
      else if (d.t === 'circle') { g.beginPath(); g.arc(d.x * w, d.y * h, d.r * h, 0, Math.PI * 2); g.fill(); }
      else if (d.t === 'line') { g.lineWidth = (d.width ?? 0.004) * h; g.beginPath(); g.moveTo(d.x1 * w, d.y1 * h); g.lineTo(d.x2 * w, d.y2 * h); g.stroke(); }
      else if (d.t === 'poly') { g.beginPath(); d.points.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h))); g.closePath(); g.fill(); }
      else if (d.t === 'text') { g.font = `${Math.max(9, (d.size ?? 0.035) * h)}px system-ui, sans-serif`; g.fillText(String(d.text).slice(0, 60), d.x * w, d.y * h); }
    }
    g.globalAlpha = 1;
  });
}

/** Experiment primitives a document carries, as kernel primitives for this host. */
export function experimentPrimitives(doc, box) {
  return (doc?.experiments || []).filter(e => e?.schema === PRIMITIVE_EXPERIMENT_SCHEMA && e.card && e.code).map(e => hostPrimitive(e, { box }));
}
