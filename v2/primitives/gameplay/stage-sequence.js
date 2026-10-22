// gameplay.stage.sequence: ordered levels/stages as data. Each stage has
// intro / play / clear / fail phases, its own parameters applied to other
// primitives' configs and to vars (per-stage tables such as maze speed and
// fright seconds, shmup loop scaling, falling-block gravity), a placement for
// the player, spawns, a goal (the nine puzzle goal kinds, a predicate, or
// none), move and time limits, stars, and a fail policy (retry with lives,
// restart, end, skip). After the last stage the sequence completes, loops
// harder (loopScale), or continues endlessly. Ladders (arcade mode) are stages
// whose spawns are the next opponent; stage select unlocks as stages clear.
//
// Targets: 'var:<name>' and 'flag:<name>' write state; 'use:<primitive id>[#n].<path>'
// writes in place into the n-th instance's `with` (primitives that read config
// lazily see it). Config writes are re-applied after restore() and extend().
import { ENTITY_KINDS } from '../../kernel/params.js';
import { compare } from '../../kernel/logic.js';
import { alive, matchesAny, sortedEntities, has, err, runBound, r6 } from './modes-lib-util.js';
import { allowInTurnModal } from './turns.js';

/** The space a zone belongs to (a stage's spawn into a zone lands in that zone's space, not the player's). */
const zoneSpace = (rt, zone) => (zone ? (rt.doc.spaces || []).find(s => (s.zones || []).some(z => z.id === zone))?.id : undefined);

const ID = 'gameplay.stage.sequence';
export const GOALS = ['lines', 'score', 'survive', 'chain', 'viruses', 'blockers', 'jelly', 'collect', 'tile', 'when', 'none'];
/** How each goal kind is measured (overridable per goal with event/field/var/block/archetype/tag). */
const MEASURE = {
  lines: { m: 'sum', event: 'lines_cleared', field: 'count' }, score: { m: 'score' }, survive: { m: 'time' },
  chain: { m: 'max', event: 'chain', field: 'length' }, viruses: { m: 'remaining', var: 'match.viruses' },
  blockers: { m: 'remaining', var: 'match.blockers' }, jelly: { m: 'remaining', var: 'match.jelly' },
  collect: { m: 'sum', event: 'collected', field: 'count' }, tile: { m: 'max', event: 'merged', field: 'value' }, when: { m: 'pred' }, none: { m: 'none' },
};
const PHASES = ['waiting', 'intro', 'play', 'clear', 'fail', 'complete', 'over'];
const TARGET = /^(var|flag):[A-Za-z0-9_.:*-]+$|^use:[a-z][a-z0-9.-]*(#\d+)?\.[A-Za-z0-9_.[\]-]+$/;
const allInstances = doc => [...(doc.systems || []), ...(doc.spaces || []).flatMap(sp => [sp, ...(sp.generators || [])])];
/** 'use:<id>[#n].<path>': the longest dotted prefix naming a primitive used in the document is the id. */
function parseUse(target, instances) {
  const body = target.slice(4), parts = body.split('.');
  for (let k = parts.length - 1; k >= 1; k--) {
    const head = parts.slice(0, k).join('.'), hash = head.match(/^(.*)#(\d+)$/), use = hash ? hash[1] : head;
    const list = instances.filter(x => x.use === use);
    if (list.length) return { use, n: Number(hash?.[2] ?? 0), list, path: parts.slice(k).join('.').replace(/\[(\d+)\]/g, '.$1').split('.') };
  }
  return null;
}

/**
 * What a person reads for each goal kind (card.mode.parts.kinds): the sentence (placeholders: the goal's number fields)
 * and the label of the quantity (vars stage.goal / stage.target); null for a kind that sets nothing a person watches (a
 * predicate, or none: the stage is won by the wrapped play's own win).
 */
const GOAL_SAYS = {
  lines: { says: 'Clear {target} lines', label: 'Lines' }, score: { says: 'Score {target} points', label: 'Score' },
  survive: { says: 'Survive for {timeSec} seconds', label: 'Time' }, chain: { says: 'Make a chain of {target}', label: 'Chain' },
  viruses: { says: 'Clear every virus', label: 'Viruses' }, blockers: { says: 'Clear every blocker', label: 'Blockers' },
  jelly: { says: 'Clear all the jelly', label: 'Jelly' }, collect: { says: 'Collect {target} pickups', label: 'Collected' },
  tile: { says: 'Make a {target} tile', label: 'Best tile' }, when: null, none: null,
};
/** The instances whose sequence ends (neither loops nor runs endlessly): the win and the stage count exist only there. */
const ENDS = [{ param: 'loop', eq: false }, { param: 'endless', eq: false }];

const GOAL_FIELDS = {
  kind: { type: 'string', options: GOALS, default: 'none' }, target: { type: 'number', default: 1, min: 0 },
  moves: { type: 'integer', default: 0, min: 0, max: 100000, effect: 'move limit (0 = none)' }, timeSec: { type: 'number', default: 0, min: 0, max: 36000, unit: 's', effect: 'time limit; for survive, the time to survive' },
  event: { type: 'string' }, field: { type: 'string' }, var: { type: 'string' }, block: { type: 'list', of: { type: 'string' }, effect: 'cell ids counted by remaining goals; a token matches by id or any /-separated part' },
  archetype: { type: 'string', selects: ENTITY_KINDS }, tag: { type: 'string' }, area: { type: 'list', of: { type: 'list', of: { type: 'integer' }, min: 2, max: 3 }, min: 2, max: 2, effect: '[[min], [max]] cell box for block goals (default: the space size)' }, when: { type: 'predicate' },
  movesEvent: { type: 'string', default: 'move' },
};

export default {
  id: ID,
  card: {
    // select_stage exists when the instance allows choosing (select); next_stage skips an intro or a clear screen, so it
    // exists only when the stages have one (runtime-lib-controls.js instanceVerbs).
    loop: { shows: [], verbs: ['select_stage', 'next_stage'], verbsOf: config => [...(config.select ? ['select_stage'] : []), ...(config.introSec > 0 || config.clearSec > 0 ? ['next_stage'] : [])], progress: ['stage_clear', 'sequence_complete'] },
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { select_stage: { type: 'choice', of: 'a stage', from: 'options', emits: ['stage_selected'] } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "param", "param": "stages", "min": 3, "why": "a level sequence needs several stages, each with its own goal and parameters"},
    ],
    // Levels mode: a wrapper that sequences the stages of another mode; its bot plays the wrapped mode stage by stage.
    // The win reads stage.advance (stages cleared plus the current stage's goal progress): it moves within a stage, so
    // progress toward completing the sequence is measurable before the first stage clears.
    // A sequence that loops or runs endlessly never completes: its win and the stage count exist only for one that ends.
    // Each stage's goal is the wrapped play's goal while that stage runs (parts: what a person is told and watches).
    mode: { loop: 'levels', wraps: true, interaction: 'any', opponent: 'clock', space: [], needs: { content: [], participants: null },
      win: { param: 'onComplete', end: 'endOnComplete', says: { text: 'Clear all {stages} stages', applies: ENDS }, shown: { var: 'stage.number', label: 'Stage', max: { param: 'stages' }, applies: ENDS }, reads: { var: 'stage.advance', by: { events: ['*'] } } },
      lose: { param: null, end: 'endOnGameOver', says: { text: "Don't fail more than {lives} times", applies: { param: 'lives', gt: 0 } }, shown: { var: 'stage.lives', label: 'Lives', applies: { param: 'lives', gt: 0 } }, reads: { var: 'stage.lives', by: { events: ['*'] } } },
      parts: { param: 'stages', goal: 'goal', kind: 'kind', start: 'startAt', index: 'stage.index', value: 'stage.goal', target: 'stage.target', kinds: GOAL_SAYS },
      bot: 'stages' },
    intent: 'Ordered stages/levels with intro, play, clear and fail phases; per-stage parameter tables applied to other primitives and vars; stage goals (lines, score, survive, chain, viruses, blockers, jelly, collect, tile, predicate), move and time limits, stars, lives and retries, loops with difficulty scaling, endless mode, arcade ladders and stage select.',
    views: ['any'],
    params: {
      id: { type: 'string', default: 'stages', effect: 'name used by the stage predicate' },
      stages: { type: 'list', min: 1, required: true, of: { type: 'object', fields: {
        id: { type: 'string', required: true }, name: { type: 'string', display: true, effect: 'what a person reads for the stage' }, intro: { type: 'string', display: true, effect: 'the intro line a person reads' },
        params: { type: 'object', default: {}, values: { type: 'json', effect: 'the value written' }, effect: 'target -> value applied at stage start (see targets)' },
        goal: { type: 'object', fields: GOAL_FIELDS }, stars: { type: 'list', of: { type: 'number' }, default: [] },
        clear: { type: 'predicate' }, fail: { type: 'predicate' },
        onStart: { type: 'effects', default: [] }, onClear: { type: 'effects', default: [] }, onFail: { type: 'effects', default: [] },
        space: { type: 'ref', to: 'space' }, zone: { type: 'ref', to: 'zone' }, at: { type: 'list', of: { type: 'number' }, min: 2, max: 3, effect: 'position in space coordinates' },
        spawn: { type: 'list', default: [], of: { type: 'object', fields: { archetype: { type: 'ref', to: 'archetype', required: true }, id: { type: 'string' }, at: { type: 'list', of: { type: 'number' }, min: 2, max: 3, effect: 'position in space coordinates' }, zone: { type: 'ref', to: 'zone' }, space: { type: 'ref', to: 'space', effect: 'the space to spawn in (default: the zone\'s, else the player\'s)' } } } },
        clearOut: { type: 'list', of: { type: 'string', selects: ENTITY_KINDS }, default: [], effect: 'despawn entities (id/archetype/tag) at stage start, e.g. the previous opponent' },
      } } },
      apply: { type: 'list', default: [], of: { type: 'object', fields: { target: { type: 'string', pattern: TARGET.source, required: true, effect: "'var:<name>', 'flag:<name>' or 'use:<primitive id>[#n].<param path>'" }, table: { type: 'list', of: { type: 'json' }, min: 1, required: true }, op: { type: 'string', options: ['set', 'mul', 'add'], default: 'set' }, loopScale: { type: 'number', default: 0, min: 0, max: 10, effect: 'numeric values grow by this fraction per loop' } } }, effect: 'per-stage columns: stage i uses table[min(i, last)]' },
      introSec: { type: 'number', default: 1.5, min: 0, max: 60, unit: 's' },
      clearSec: { type: 'number', default: 2, min: 0, max: 60, unit: 's' },
      failSec: { type: 'number', default: 2, min: 0, max: 60, unit: 's' },
      onFailStage: { type: 'string', options: ['retry', 'restart', 'end', 'next'], default: 'retry', effect: 'what a failed stage does' },
      lives: { type: 'integer', default: 0, min: 0, max: 999, effect: 'retries before game over (0 = unlimited)' },
      loop: { type: 'boolean', default: false, effect: 'after the last stage, start again harder' },
      endless: { type: 'boolean', default: false, effect: 'after the last stage, keep replaying it harder' },
      loopScale: { type: 'object', default: {}, values: { type: 'number', min: 0, max: 10 }, effect: 'target -> fractional growth per loop for numeric stage params' },
      scoreVar: { type: 'string', default: 'score' },
      starsBy: { type: 'string', options: ['score', 'moves', 'time'], default: 'score', effect: 'what star thresholds compare (stage score, moves left, seconds left)' },
      select: { type: 'boolean', default: false, effect: 'allow the select_stage action (unlocked stages only)' },
      unlockAll: { type: 'boolean', default: false },
      autoStart: { type: 'boolean', default: true },
      startAt: { type: 'integer', default: 0, min: 0, max: 999 },
      onComplete: { type: 'effects', default: [] },
      endOnComplete: { type: 'boolean', default: true, effect: 'end_game won when the sequence completes' },
      endOnGameOver: { type: 'boolean', default: true, effect: 'end_game lost when lives run out' },
    },
    provides: {
      events: ['stage_intro', 'stage_intro:*', 'stage_start', 'stage_start:*', 'stage_clear', 'stage_clear:*', 'stage_fail', 'stage_fail:*', 'stars', 'stage_loop', 'sequence_complete', 'sequence_over', 'stage_selected'],
      vars: ['stage.index', 'stage.number', 'stage.loop', 'stage.stars', 'stage.progress', 'stage.advance', 'stage.moves', 'stage.time', 'stage.lives', 'stage.starsTotal', 'stage.score', 'stage.goal', 'stage.target'],
      actions: ['select_stage', 'next_stage'],
    },
    requires: {},
    defines: [{ kind: 'stage', in: 'stages' }],
    reads: [],
    rules: {
      stage_target: { fields: ['stages[].params', 'apply[].target', 'loopScale'], message: "a target is 'var:<name>', 'flag:<name>' or 'use:<primitive id>[#n].<param>' naming an instance of the document and one of its params",
        example: { doc: { systems: [{ use: ID, with: { stages: [{ id: 'one' }], apply: [{ target: 'use:gameplay.nothing.speed', table: [1] }] } }] } } },
      stage_goal: { fields: ['stages[].goal.kind', 'stages[].goal.when', 'stages[].goal.timeSec', 'stages[].goal.target'], message: "goal 'when' has a when predicate; 'survive' has timeSec > 0; lines, score, chain, collect and tile have target > 0; a tile target is a power of two" },
      stage_stars: { fields: ['stages[].stars'], message: 'star thresholds ascend', example: { doc: { systems: [{ use: ID, with: { stages: [{ id: 'one', stars: [3, 2] }] } }] } } },
      stage_loop: { fields: ['loop', 'endless'], message: 'loop and endless are not both on', example: { loop: true, endless: true } },
      stage_start_at: { fields: ['startAt', 'stages'], message: 'startAt is an index of stages (below its length)' },
    },
  },
  logic(logic) {
    logic.predicate('stage', {
      codes: [{ code: 'stage_phase', fields: ['phase'], message: `phase is one of ${PHASES.join(', ')}`, example: { stage: true, phase: 'party' } }],
      refs: p => (typeof p.stage === 'string' ? [['stage', p.stage]] : []),
      check: (p, path, errors) => { if (p.phase !== undefined && !PHASES.includes(p.phase)) errors.push(err('stage_phase', `${path}.phase`, `phase must be ${PHASES.join('|')}`)); },
      test: (p, rt) => {
        const s = Object.entries(rt.state.prim).find(([k]) => k === `${ID}:${p.of ?? 'stages'}`)?.[1]; if (!s) return false;
        if (typeof p.stage === 'string' && s.stageId !== p.stage) return p.cleared ? Boolean(s.best?.[p.stage]) : false;
        if (p.cleared) return Boolean(s.best?.[p.stage]);
        if (p.phase && s.phase !== p.phase) return false;
        const metric = p.metric ?? 'number', value = metric === 'stars' ? s.stars ?? 0 : metric === 'loop' ? s.loop ?? 0 : (s.index ?? 0) + 1;
        return ['gte', 'lte', 'gt', 'lt', 'eq', 'ne'].some(k => p[k] !== undefined) ? compare(value, p) : true;
      },
    });
    const req = (e, rt, what) => { rt.store(`${ID}:${e.of ?? 'stages'}`).request = what; };
    logic.effect('clear_stage', { run: (e, rt) => req(e, rt, { kind: 'clear' }) });
    logic.effect('fail_stage', { run: (e, rt) => req(e, rt, { kind: 'fail', reason: e.reason ?? 'effect' }) });
    logic.effect('next_stage', { run: (e, rt) => req(e, rt, { kind: 'next' }) });
    logic.effect('restart_stage', { run: (e, rt) => req(e, rt, { kind: 'restart' }) });
    logic.effect('goto_stage', { refs: e => [['stage', e.stage]], run: (e, rt) => req(e, rt, { kind: 'goto', stage: e.stage }) });
  },
  validate(config, doc, ctx) {
    const errors = [];
    // apply[].target holds the pattern as its declared shape; the keys of params and loopScale are checked here.
    const checkTarget = (t, path) => {
      if (!TARGET.test(t)) { errors.push(err('stage_target', path, `bad target '${t}'`, "use 'var:<name>', 'flag:<name>' or 'use:<primitive>[#n].<path>'")); return; }
      if (t.startsWith('use:')) {
        const m = parseUse(t, allInstances(doc));
        if (!m) errors.push(err('stage_target', path, `no instance of the primitive named in '${t}'`, 'use:<primitive id>[#n].<param path>'));
        else if (m.n >= m.list.length) errors.push(err('stage_target', path, `instance #${m.n} of '${m.use}' does not exist`));
        else { const p = ctx.registry.get(m.use); const first = m.path[0]; if (p && !(first in (p.card.params || {}))) errors.push(err('stage_target', path, `'${m.use}' has no param '${first}'`, `params: ${Object.keys(p.card.params || {}).join(', ')}`)); }
      }
    };
    config.stages.forEach((st, i) => {
      for (const t of Object.keys(st.params || {})) checkTarget(t, `with.stages[${i}].params.${t}`);
      if ((st.stars || []).some((t, k, a) => k && t <= a[k - 1])) errors.push(err('stage_stars', `with.stages[${i}].stars`, 'star thresholds must ascend'));
      const g = st.goal; if (!g) return;
      const path = `with.stages[${i}].goal`;
      if (g.kind === 'when' && !g.when) errors.push(err('stage_goal', path, "goal 'when' needs a when predicate"));
      if (g.kind === 'survive' && !(g.timeSec > 0)) errors.push(err('stage_goal', `${path}.timeSec`, "goal 'survive' needs timeSec"));
      if (['lines', 'score', 'chain', 'collect', 'tile'].includes(g.kind) && !(g.target > 0)) errors.push(err('stage_goal', `${path}.target`, `goal '${g.kind}' needs target > 0`));
      if (g.kind === 'tile' && g.target > 0 && Math.log2(g.target) % 1) errors.push(err('stage_goal', `${path}.target`, 'tile targets are powers of two'));
    });
    config.apply.forEach((a, i) => { if (TARGET.test(a.target)) checkTarget(a.target, `with.apply[${i}].target`); });
    for (const t of Object.keys(config.loopScale)) checkTarget(t, `with.loopScale.${t}`);
    if (config.loop && config.endless) errors.push(err('stage_loop', 'with.endless', 'choose loop or endless, not both'));
    if (config.startAt >= config.stages.length) errors.push(err('stage_start_at', 'with.startAt', `startAt ${config.startAt} has no stage`));
    return errors;
  },
  /** Solver progress: stages cleared plus the current stage's goal progress. */
  progress(rt, config) { return rt.state.prim[`${ID}:${config.id}`] ? rt.state.vars['stage.advance'] ?? 0 : 0; },
  install(rt, config) { install(rt, config); },
  extend(rt, config) { rt.caches[`${ID}:${config.id}:reapply`]?.(); },
};

function install(rt, config) {
  const key = `${ID}:${config.id}`, F = sec => Math.round(sec * 60), N = config.stages.length;
  const st = () => { const s = rt.store(key); s.phase ??= 'waiting'; s.best ??= {}; s.loop ??= 0; return s; };
  const origKey = `${key}:orig`;
  const originals = () => (rt.caches[origKey] ??= new Map());

  // ----- targets -----
  function locate(target) {
    const m = parseUse(target, allInstances(rt.doc)); if (!m) return null;
    const inst = m.list[m.n]; if (!inst) return null;
    inst.with ??= {};
    const parts = m.path;
    let obj = inst.with; for (const p of parts.slice(0, -1)) obj = (obj[p] ??= {});
    return { obj, leaf: parts[parts.length - 1] };
  }
  function read(target) {
    if (target.startsWith('var:')) return rt.state.vars[target.slice(4)];
    if (target.startsWith('flag:')) return rt.state.flags[target.slice(5)];
    const l = locate(target); return l ? l.obj[l.leaf] : undefined;
  }
  function write(target, value) {
    if (target.startsWith('var:')) { rt.state.vars[target.slice(4)] = value; return; }
    if (target.startsWith('flag:')) { if (value) rt.state.flags[target.slice(5)] = value; else delete rt.state.flags[target.slice(5)]; return; }
    const l = locate(target); if (!l) return;
    if (!originals().has(target)) originals().set(target, structuredClone(l.obj[l.leaf]));
    l.obj[l.leaf] = structuredClone(value); // in place: primitives hold the same `with` object
  }
  const baseOf = target => (target.startsWith('use:') && originals().has(target) ? originals().get(target) : read(target));
  const scaled = (target, value, loops, extra = 0) => {
    const f = (config.loopScale[target] ?? 0) + extra;
    return typeof value === 'number' && f && loops ? r6(value * (1 + f * loops)) : value;
  };
  /** All target values for virtual stage index i (endless/loop aware). */
  function valuesFor(i, loop) {
    const def = config.stages[Math.min(i, N - 1)], loops = loop + Math.max(0, i - (N - 1)) * (config.endless ? 1 : 0), out = new Map();
    for (const a of config.apply) {
      const raw = a.table[Math.min(i % (config.endless ? Infinity : N), a.table.length - 1)];
      let v = raw;
      if (a.op !== 'set') { const b = baseOf(a.target) ?? 0; v = a.op === 'mul' ? r6(b * raw) : r6(b + raw); }
      out.set(a.target, scaled(a.target, v, loops, a.loopScale));
    }
    for (const [t, v] of Object.entries(def.params || {})) out.set(t, scaled(t, v, loops));
    return out;
  }
  function applyStage(s) { for (const [t, v] of valuesFor(s.index, s.loop)) write(t, v); }
  const reapply = () => { const s = st(); if (s.phase !== 'waiting' && s.index !== undefined) for (const [t, v] of valuesFor(s.index, s.loop)) if (t.startsWith('use:')) write(t, v); };
  rt.caches[`${key}:reapply`] = reapply;
  rt.onRestore(reapply);

  // ----- goals -----
  const goalOf = s => { const def = config.stages[Math.min(s.index, N - 1)]; const g = def.goal; if (!g) return null; return { ...MEASURE[g.kind], ...Object.fromEntries(Object.entries(g).filter(([k, v]) => v !== undefined && k !== 'kind')), kind: g.kind }; };
  const scoreNow = s => (rt.state.vars[config.scoreVar] ?? 0) - (s.score0 ?? 0);
  const tokenMatch = (tok, list) => typeof tok === 'string' && list.some(b => tok === b || tok.split('/').includes(b));
  function remaining(g) {
    if (g.var !== undefined && g.block === undefined && g.archetype === undefined && g.tag === undefined) return rt.state.vars[g.var];
    if (g.block !== undefined) {
      const api = rt.space(); if (!has(api, 'cellsIn')) return undefined;
      const box = g.area ?? (api.size ? [[0, 0, 0], api.size.map(n => n - 1)] : null); if (!box) return undefined;
      return api.cellsIn(box).filter(c => tokenMatch(c.block, g.block)).length;
    }
    const sel = g.archetype ?? g.tag;
    return sortedEntities(rt).filter(e => matchesAny(e, [sel]) && alive(e)).length;
  }
  function measure(s, g) {
    switch (g.m) {
      case 'score': return scoreNow(s);
      case 'time': return s.playT / 60;
      case 'sum': case 'max': return s.acc ?? 0;
      case 'remaining': { const r = remaining(g); if (r === undefined) return 0; if (r > 0) s.seen = Math.max(s.seen ?? 0, r); return s.seen ? s.seen - r : 0; }
      default: return 0;
    }
  }
  function goalMet(s, g) {
    if (!g || g.kind === 'none') return null;
    if (g.m === 'pred') return rt.test(g.when);
    if (g.m === 'remaining') { measure(s, g); return (s.seen ?? 0) > 0 && remaining(g) === 0; }
    if (g.m === 'time') return s.playT >= F(g.timeSec);
    return measure(s, g) >= g.target;
  }
  rt.on('*', ev => {
    const s = rt.state.prim[key]; if (!s || s.phase !== 'play') return;
    const g = goalOf(s); if (!g) return;
    if (ev.name === (g.movesEvent ?? 'move') && g.moves) s.moves = (s.moves ?? 0) + 1;
    if ((g.m === 'sum' || g.m === 'max') && ev.name === g.event) {
      const v = g.field ? Number(ev[g.field] ?? (g.m === 'sum' ? 1 : 0)) : 1;
      s.acc = g.m === 'sum' ? (s.acc ?? 0) + v : Math.max(s.acc ?? 0, v);
    }
  });

  // ----- flow -----
  const def = s => config.stages[Math.min(s.index, N - 1)];
  function startStage(s, i) {
    s.index = i; s.stageId = config.stages[Math.min(i, N - 1)].id; s.pt = 0; s.playT = 0; s.acc = 0; s.moves = 0; s.seen = 0; s.stars = 0; s.score0 = rt.state.vars[config.scoreVar] ?? 0;
    s.phase = 'intro';
    const d = def(s);
    applyStage(s);
    for (const e of sortedEntities(rt)) if (e.id !== 'player' && d.clearOut.length && matchesAny(e, d.clearOut)) rt.despawn(e.id);
    const p = rt.player();
    if (p && (d.space || d.zone || d.at !== undefined)) {
      if (d.space && d.space !== p.space) rt.moveToSpace(p, d.space, d.at ?? null, d.zone);
      else rt.space(p.space).teleport(p, { zone: d.zone, at: d.at }, rt);
    }
    for (const sp of d.spawn) { if (sp.id && rt.entity(sp.id)) rt.despawn(sp.id); const e = rt.spawn(sp.archetype, { id: sp.id, space: sp.space ?? zoneSpace(rt, sp.zone), at: sp.at }); if (sp.zone) rt.space(e.space).teleport(e, { zone: sp.zone }, rt); }
    runBound(rt, d.onStart, { actor: 'player' });
    // title: the stage's declared name (display text; null when it declares none, never its id). A `name` key would
    // overwrite the event's name in state.events.
    rt.emitTyped('stage_intro', s.stageId, { stage: s.stageId, index: i, number: i + 1, loop: s.loop, title: d.name ?? null, intro: d.intro ?? '' });
    if (!F(config.introSec)) begin(s);
  }
  function begin(s) { s.phase = 'play'; s.pt = 0; rt.emitTyped('stage_start', s.stageId, { stage: s.stageId, index: s.index, loop: s.loop }); }
  function clear(s) {
    const d = def(s), g = goalOf(s);
    const by = config.starsBy === 'moves' ? (g?.moves ? g.moves - s.moves : 0) : config.starsBy === 'time' ? (g?.timeSec ? Math.max(0, g.timeSec - s.playT / 60) : 0) : scoreNow(s);
    s.stars = (d.stars || []).filter(t => by >= t).length;
    const prev = s.best[s.stageId];
    s.best[s.stageId] = { stars: Math.max(prev?.stars ?? 0, s.stars), score: Math.max(prev?.score ?? -Infinity, scoreNow(s)) };
    s.highest = Math.max(s.highest ?? -1, Math.min(s.index, N - 1));
    s.phase = 'clear'; s.pt = 0;
    rt.emitTyped('stage_clear', s.stageId, { stage: s.stageId, index: s.index, stars: s.stars, score: scoreNow(s), loop: s.loop });
    if (d.stars?.length) rt.emit('stars', { stage: s.stageId, stars: s.stars });
    runBound(rt, d.onClear, { actor: 'player' });
  }
  function fail(s, reason) {
    s.phase = 'fail'; s.pt = 0;
    rt.emitTyped('stage_fail', s.stageId, { stage: s.stageId, index: s.index, reason });
    runBound(rt, def(s).onFail, { actor: 'player' });
  }
  function advance(s) {
    if (s.index + 1 < N || config.endless) { startStage(s, s.index + 1); return; }
    if (config.loop) { s.loop++; rt.emit('stage_loop', { loop: s.loop }); startStage(s, 0); return; }
    s.phase = 'complete';
    rt.emit('sequence_complete', { stages: N, stars: totalStars(s) });
    runBound(rt, config.onComplete, { actor: 'player' });
    if (config.endOnComplete && rt.state.status === 'playing') rt.run([{ do: 'end_game', outcome: 'won' }]);
  }
  function afterFail(s) {
    if (config.lives) { s.lives = (s.lives ?? config.lives) - 1; if (s.lives < 0) { gameOver(s); return; } }
    if (config.onFailStage === 'retry') startStage(s, s.index);
    else if (config.onFailStage === 'restart') startStage(s, 0);
    else if (config.onFailStage === 'next') advance(s);
    else gameOver(s);
  }
  function gameOver(s) {
    s.phase = 'over'; rt.emit('sequence_over', { stage: s.stageId, index: s.index });
    if (config.endOnGameOver && rt.state.status === 'playing') rt.run([{ do: 'end_game', outcome: 'lost' }]);
  }
  const totalStars = s => Object.values(s.best).reduce((t, b) => t + b.stars, 0);
  const unlocked = (s, i) => config.unlockAll || i <= (s.highest ?? -1) + 1;

  // Skipping a stage's intro or clear screen works while the stages' loop holds a turn modal open (a card battle's).
  allowInTurnModal(rt, ['next_stage']);
  rt.action('select_stage', v => {
    const s = st(); if (!config.select) return;
    const i = config.stages.findIndex(x => x.id === v); if (i < 0 || !unlocked(s, i) || s.phase === 'play' || s.phase === 'intro') return;
    rt.emit('stage_selected', { stage: v }); startStage(s, i);
  });
  rt.action('next_stage', () => { const s = st(); if (s.phase === 'clear') s.pt = F(config.clearSec) + 1; if (s.phase === 'intro') s.pt = F(config.introSec); });

  rt.system('rules', rt => {
    const s = st();
    const r = s.request; s.request = null;
    if (s.phase === 'waiting') { if (config.autoStart && !s.auto) { s.auto = true; s.lives = config.lives; startStage(s, config.startAt); } }
    else if (r) {
      if (r.kind === 'goto') { const i = config.stages.findIndex(x => x.id === r.stage); if (i >= 0) startStage(s, i); }
      else if (r.kind === 'restart') startStage(s, s.index);
      else if (r.kind === 'next') advance(s);
      else if (r.kind === 'clear' && s.phase === 'play') clear(s);
      else if (r.kind === 'fail' && s.phase === 'play') fail(s, r.reason);
    }
    s.pt = (s.pt ?? 0) + 1;
    if (s.phase === 'intro' && s.pt >= F(config.introSec)) begin(s);
    else if (s.phase === 'play') {
      s.playT++;
      const d = def(s), g = goalOf(s);
      if (d.fail && rt.test(d.fail)) fail(s, 'condition');
      else {
        const met = goalMet(s, g), pred = d.clear ? rt.test(d.clear) : null;
        const done = (met !== null || pred !== null) && met !== false && pred !== false;
        if (done) clear(s);
        else if (g?.moves && s.moves >= g.moves) fail(s, 'moves');
        else if (g?.timeSec && g.kind !== 'survive' && s.playT >= F(g.timeSec)) fail(s, 'time');
      }
    } else if (s.phase === 'clear' && s.pt > F(config.clearSec)) advance(s);
    else if (s.phase === 'fail' && s.pt > F(config.failSec)) afterFail(s);
    // Vars.
    const v = rt.state.vars, g = s.index !== undefined ? goalOf(s) : null;
    v['stage.index'] = s.index ?? 0; v['stage.number'] = (s.index ?? 0) + 1; v['stage.loop'] = s.loop; v['stage.stars'] = s.stars ?? 0; v['stage.starsTotal'] = totalStars(s);
    v['stage.score'] = s.index !== undefined ? scoreNow(s) : 0;
    v['stage.lives'] = config.lives ? Math.max(0, s.lives ?? config.lives) : 0;
    // Moves left exist only while the stage has a move limit (a stage without one has no moves to count down).
    if (g?.moves) v['stage.moves'] = Math.max(0, g.moves - (s.moves ?? 0)); else delete v['stage.moves'];
    v['stage.time'] = g?.timeSec ? Math.max(0, Math.ceil(g.timeSec - (s.playT ?? 0) / 60)) : r6((s.playT ?? 0) / 60);
    v['stage.progress'] = !g || g.m === 'pred' || g.m === 'none' ? 0 : g.m === 'remaining' ? (s.seen ? r6(measure(s, g) / s.seen) : 0) : g.m === 'time' ? r6(Math.min(1, s.playT / Math.max(1, F(g.timeSec)))) : r6(Math.min(1, measure(s, g) / (g.target || 1)));
    // The current stage's goal quantity and its target (card.mode.parts value/target): lines cleared of the lines asked,
    // seconds survived of the seconds asked, the cleared of what there was to clear; 0 for a goal with no quantity.
    const counted = g && g.kind !== 'none' && g.m !== 'pred' && g.m !== 'none';
    v['stage.goal'] = counted ? r6(measure(s, g)) : 0;
    v['stage.target'] = !counted ? 0 : g.m === 'time' ? g.timeSec : g.m === 'remaining' ? (s.seen ?? 0) : g.target;
    // Stages cleared plus the current stage's goal progress: what the levels win reads (card.mode.win.reads).
    v['stage.advance'] = r6((s.phase === 'complete' ? N : (s.index ?? 0)) + (s.phase === 'complete' ? 0 : v['stage.progress']));
  }, ID);

  rt.options(rt => {
    const s = st(); if (!config.select || s.phase === 'play' || s.phase === 'intro') return [];
    return config.stages.map((x, i) => ({ x, i })).filter(({ i }) => unlocked(s, i)).map(({ x, i }) => ({ label: `stage ${x.id}`, text: x.name ? `Stage ${i + 1}: ${x.name}` : `Stage ${i + 1}`, actions: { select_stage: x.id } }));
  });
}
