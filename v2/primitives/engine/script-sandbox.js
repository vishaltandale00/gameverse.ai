// Model-written mechanics as sandboxed code. A script is an ES module whose
// default export is { init?(world, rng) -> state, step(state, world, input, rng)
// -> { state, effects } }. Each step (or every N), the script receives a JSON
// read-model of rt.state (frame, time, vars, flags, counts, this step's
// events, the player and nearby entities with the components it asked for)
// and returns its next state plus kernel effects. Only effect kinds the
// document declares for the script are applied, after the same field checks
// preflight runs (nested effect lists included); everything else is dropped
// and counted. Script state and its RNG seed live in rt.state, so runs replay
// and snapshots restore exactly. A script that keeps failing is disabled.
import { moduleBody, createHost, syntaxError, sandboxKind, LIMITS } from './runtime-lib-sandbox.js';
import { hasEffect, zoneDef } from './runtime-lib.js';
import { ID_PATTERN } from '../../kernel/sections.js';
import { seedFrom } from '../../kernel/rng.js';

const ID = 'engine.script.sandbox';
const PHASES = ['input', 'ai', 'movement', 'physics', 'interaction', 'rules', 'plot', 'late'];
const READS = ['vars', 'flags', 'counts', 'events', 'player', 'entities'];
const STEP = 'export default { step(state, world) { return { state, effects: [] }; } };';
/** A rule example: one script with these fields (every other field unset, as the form writes it). */
const scriptExample = fields => ({ scripts: [{ id: 'mechanic', label: null, code: STEP, effects: ['add_var'], reads: null, components: null, radius: null, maxEntities: null, phase: null, every: null, button: null, maxEffects: null, ...fields }] });

export default {
  id: ID,
  card: {
    intent: 'Runs model-written mechanic code in a sandbox: each script reads a JSON view of the game state and returns its own state plus kernel effects, limited to the effect kinds the document declares. For ideas no primitive covers yet.',
    views: ['any'],
    params: {
      scripts: { type: 'list', default: [], effect: 'sandboxed scripts',
        of: { type: 'object', fields: {
          id: { type: 'string', pattern: ID_PATTERN, required: true }, label: { type: 'string', default: '' },
          code: { type: 'string', required: true, maxLength: LIMITS.codeBytes, effect: 'ES module: export default { init?(world, rng), step(state, world, input, rng) -> { state, effects } }' },
          effects: { type: 'list', of: { type: 'string' }, min: 1, required: true, effect: 'effect kinds the script may return (e.g. add_var, spawn, damage, emit)' },
          reads: { type: 'list', of: { type: 'string', options: READS }, default: READS, effect: 'state sections in the read-model' },
          components: { type: 'list', of: { type: 'string' }, default: ['body', 'health'], effect: 'entity components included in the read-model' },
          radius: { type: 'number', min: 0, effect: 'only entities within this distance of the player (default: all, up to maxEntities)' },
          maxEntities: { type: 'integer', default: 64, min: 0, max: 1000 },
          phase: { type: 'string', options: PHASES, default: 'rules' },
          every: { type: 'integer', default: 1, min: 1, max: 600, unit: 'frames' },
          when: { type: 'predicate', effect: 'run only while it holds' },
          button: { type: 'string', effect: 'verb the script reads as input.held / input.pressed (claimed from engine.input.actions when present)' },
          maxEffects: { type: 'integer', default: 16, min: 1, max: 256, effect: 'effects applied per call; extra ones are dropped' },
        } } },
      maxErrors: { type: 'integer', default: 3, min: 1, max: 100, effect: 'consecutive failures before a script is disabled' },
      timeoutMs: { type: 'number', default: 25, min: 1, max: 1000, unit: 'ms', effect: 'per-call time limit (node:vm hosts)' },
    },
    provides: { events: ['script_error', 'script_disabled', 'script_disabled:*', 'script_rejected'], services: ['scripts'] },
    requires: {},
    rules: {
      script_duplicate: { fields: ['scripts[].id'], message: 'script ids are distinct', example: { scripts: [scriptExample({}).scripts[0], scriptExample({}).scripts[0]] } },
      script_empty: { fields: ['scripts[].code'], message: 'code is not blank' },
      script_import: { fields: ['scripts[].code'], message: 'code imports nothing (no import statements, import() or import.meta)', example: scriptExample({ code: `import x from 'y';\n${STEP}` }) },
      script_async: { fields: ['scripts[].code'], message: 'code is synchronous: no async functions or await', example: scriptExample({ code: 'export default { async step(state) { return { state, effects: [] }; } };' }) },
      script_export: { fields: ['scripts[].code'], message: 'code has exactly one export, export default' },
      script_syntax: { fields: ['scripts[].code'], message: 'code is a syntactically valid ES module', example: scriptExample({ code: 'export default { step(state) { return { state, effects: [] }; };' }) },
      script_effect_unknown: { fields: ['scripts[].effects'], message: 'every effect kind is registered by a primitive of this game' },
      script_effect_unsafe: { fields: ['scripts[].effects', 'scripts[].when'], message: 'a script whose effects include end_game has a when guard', example: scriptExample({ effects: ['end_game'] }) },
    },
  },
  validate(config, doc, ctx) {
    const errors = [], seen = new Set();
    config.scripts.forEach((s, i) => {
      const path = `scripts[${i}]`;
      if (seen.has(s.id)) errors.push({ code: 'script_duplicate', path: `${path}.id`, message: `duplicate script '${s.id}'` }); seen.add(s.id);
      const m = moduleBody(typeof s.code === 'string' ? s.code : '');
      if (m.code === 'script_size') { /* the declared maxLength: preflight's */ } else if (m.code) errors.push({ code: m.code, path: `${path}.code`, message: m.message });
      else { const syn = syntaxError(s.code); if (syn) errors.push({ code: 'script_syntax', path: `${path}.code`, message: syn.slice(0, 200) }); }
      (s.effects || []).forEach((k, j) => { if (!hasEffect(ctx, k)) errors.push({ code: 'script_effect_unknown', path: `${path}.effects[${j}]`, message: `effect '${k}' is not registered by any primitive in this game` }); });
      if ((s.effects || []).includes('end_game') && !s.when) errors.push({ code: 'script_effect_unsafe', path: `${path}.effects`, message: 'a script that can end the game needs a `when` guard', hint: 'add when: a predicate for the situations where ending is allowed' });
    });
    return errors;
  },
  install(rt, config) {
    // The checks ran these scripts in a synchronous realm; a host without one would play a different game (the
    // scripts silently disabled), so it says so and does not run it.
    if (config.scripts.length && !sandboxKind()) throw Object.assign(Error(`${ID}: this host has no synchronous sandbox (node:vm or ShadowRealm), so the document's scripts cannot run here as they were checked`), { code: 'script_host_unsupported' });
    const hosts = new Map(); // compiled realms (non-JSON), rebuilt identically from the document
    const host = s => { if (!hosts.has(s.id)) hosts.set(s.id, createHost(s.code, { timeoutMs: config.timeoutMs })); return hosts.get(s.id); };
    const st = () => { const x = rt.store(ID); x.scripts ??= {}; return x; };
    const rec = s => (st().scripts[s.id] ??= { state: null, seed: seedFrom(`${rt.doc.id}:${s.id}`), errors: 0, calls: 0, applied: 0, dropped: 0, disabled: null });
    const buttons = {};
    // Runtime reference check for effects (preflight's indexes are not available at run time).
    const known = (kind, id) => {
      if (kind === 'archetype') return Boolean(rt.archetype(id));
      if (kind === 'item') return (rt.doc.content?.items || []).some(x => x.id === id);
      if (kind === 'zone') return Boolean(zoneDef(rt.doc, id));
      if (kind === 'space') return (rt.doc.spaces || []).some(x => x.id === id);
      return true;
    };
    const checker = allowed => {
      const ctx = {
        doc: rt.doc,
        checkPredicate: (p, path, errs) => rt.logic.checkPredicate(p, path, errs, ctx),
        checkEffect: (e, path, errs) => { if (!e || typeof e !== 'object' || !allowed.includes(e.do)) { errs.push({ code: 'script_effect_denied', path, message: `effect '${e?.do}' is not declared for this script` }); return; } rt.logic.checkEffect(e, path, errs, ctx); },
        noteRef: (kind, id, path, mode) => { if (!['flag', 'var', 'event'].includes(kind) && !known(kind, id)) ctxErrs.push({ code: 'ref_unknown', path, message: `unknown ${kind} '${id}'` }); },
      };
      let ctxErrs = [];
      return e => { ctxErrs = []; const errs = []; ctx.checkEffect(e, 'effect', errs); return [...errs, ...ctxErrs]; };
    };
    const checkers = new Map(config.scripts.map(s => [s.id, checker(s.effects)]));
    const view = (e, comps) => ({ id: e.id, archetype: e.archetype, space: e.space, at: e.at, zone: e.zone ?? null, components: Object.fromEntries(comps.filter(c => c in e.components).map(c => [c, e.components[c]])) });
    const world = s => {
      const st_ = rt.state, out = { frame: st_.frame, time: st_.time, status: st_.status };
      const p = rt.player();
      if (s.reads.includes('vars')) out.vars = st_.vars;
      if (s.reads.includes('flags')) out.flags = st_.flags;
      if (s.reads.includes('counts')) out.counts = st_.counts;
      if (s.reads.includes('events')) out.events = st_.events.slice(-64);
      if (s.reads.includes('player')) out.player = p ? view(p, s.components) : null;
      if (s.reads.includes('entities')) {
        let list = Object.values(st_.entities).filter(e => e.id !== 'player');
        if (s.radius !== undefined && p) list = list.filter(e => e.space === p.space && Array.isArray(e.at) && Array.isArray(p.at) && rt.space(e.space).distance?.(p.at, e.at) <= s.radius);
        out.entities = list.sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, s.maxEntities).map(e => view(e, s.components));
      }
      return out;
    };
    const input = s => {
      const verb = buttons[s.id], svc = rt.hasService('input') ? rt.service('input') : null;
      const axes = svc ? svc.axis('player', 'move') : rt.input.axes?.move || [0, 0];
      if (!verb) return { move: axes, held: false, pressed: false };
      return { move: axes, held: svc ? svc.held('player', verb) : Boolean(rt.input.held?.[verb]), pressed: svc ? svc.pressed('player', verb) : Boolean(rt.input.actions?.[verb]) };
    };
    const fail = (s, r, error) => {
      r.errors++; rt.emit('script_error', { script: s.id, error });
      if (r.errors >= config.maxErrors || r.state === null) { r.disabled = error; rt.emitTyped('script_disabled', s.id, { script: s.id, reason: error }); }
    };
    const runScript = s => {
      const r = rec(s); if (r.disabled) return;
      const h = host(s);
      if (h.error) { r.disabled = h.error; rt.emitTyped('script_disabled', s.id, { script: s.id, reason: h.error }); return; }
      if (r.state === null) {
        const out = h.call('init', { world: world(s), seed: r.seed });
        if (!out.ok) { fail(s, r, out.error); return; }
        r.state = out.value.state; r.seed = out.value.seed;
      }
      const out = h.call('step', { state: r.state, world: world(s), input: input(s), seed: r.seed });
      r.calls++;
      if (!out.ok) { fail(s, r, out.error); return; }
      r.errors = 0; r.state = out.value.state; r.seed = out.value.seed;
      const list = Array.isArray(out.value.effects) ? out.value.effects : [];
      const ok = [], rejected = [];
      for (const e of list.slice(0, s.maxEffects)) { const errs = checkers.get(s.id)(e); if (errs.length) rejected.push(errs[0]); else ok.push(e); }
      const dropped = rejected.length + Math.max(0, list.length - s.maxEffects);
      r.applied += ok.length; r.dropped += dropped;
      if (dropped) rt.emit('script_rejected', { script: s.id, dropped, reason: rejected[0]?.message ?? `more than ${s.maxEffects} effects` });
      rt.run(ok, { script: s.id });
    };
    rt.provide('scripts', {
      status: id => { const r = st().scripts[id]; return r ? { calls: r.calls, applied: r.applied, dropped: r.dropped, errors: r.errors, disabled: r.disabled } : null; },
      state: id => structuredClone(st().scripts[id]?.state ?? null),
      sandbox: sandboxKind,
    });
    for (const phase of PHASES) {
      const list = config.scripts.filter(s => s.phase === phase); if (!list.length) continue;
      rt.system(phase, rt => {
        for (const s of list) {
          if (s.button && !(s.id in buttons)) buttons[s.id] = rt.hasService('input') ? rt.service('input').claim(`${ID}:${s.id}`, { prefer: [s.button] }) ?? s.button : s.button;
          if (rt.state.frame % s.every || (s.when && !rt.test(s.when))) continue;
          runScript(s);
          if (rt.state.status !== 'playing') return;
        }
      }, ID);
    }
  },
};
