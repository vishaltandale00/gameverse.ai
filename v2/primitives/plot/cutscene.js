// Scripted sequences (plot.cutscenes): id -> { steps, skippable? }. A step is
// any of camera {pos, look, fov, ease, sec}, say {character, text, sec?},
// move {who, to: zone | position, sec?, run?}, wait <seconds>, fx <effects>.
// Headless, a cutscene is a timed effect list: each step emits its event
// (`camera`, `say`), starts its move (kernel move_to) or runs its effects,
// then holds for its duration; zero-length steps chain in the same frame.
// Moves snap to their destination when the step ends (snapMoves), so story
// state never depends on a renderer or on pathing finishing in time.
// `skip_cutscene` runs every remaining fx and move instantly.
import { err, checkEffects, checkRef, checkKeys, ticks, readSeconds, zoneIndex } from './story-lib.js';

const ID = 'plot.cutscene';
const STEP_KEYS = ['camera', 'say', 'move', 'wait', 'fx', 'sec'];
const st = rt => { const s = rt.store(ID); s.queue ??= []; s.played ??= {}; s.active ??= null; return s; };
const scenes = rt => rt.doc.plot?.cutscenes || {};

export default {
  id: ID,
  solverKey,
  card: {
    loop: { verbs: ['skip_cutscene'], progress: ['cutscene_end'] },
    intent: 'Scripted cutscenes from plot.cutscenes: camera moves, lines, scripted character moves, waits and effects, played by play_cutscene as timed steps (headless too) and skippable.',
    views: ['any'],
    params: {
      letterbox: { type: 'boolean', default: true, effect: 'renderers letterbox while a cutscene plays (presentation only)' },
      skippable: { type: 'boolean', default: true, effect: 'skip_cutscene is allowed unless a cutscene sets skippable:false' },
      sayCps: { type: 'number', default: 15, min: 0, max: 200, unit: 'chars/s', effect: 'how long a say step holds when it gives no sec (0 = no hold)' },
      minSay: { type: 'number', default: 1, min: 0, max: 30, unit: 's', effect: 'shortest hold for a say step' },
      snapMoves: { type: 'boolean', default: true, effect: 'teleport moved actors to their destination when a move step ends' },
      maxSeconds: { type: 'number', default: 120, min: 1, max: 3600, unit: 's', effect: 'longest allowed cutscene (preflight)' },
    },
    provides: { events: ['cutscene_start', 'cutscene_start:*', 'cutscene_end', 'cutscene_end:*', 'cutscene_step', 'camera', 'say'], services: ['cutscene'], actions: ['skip_cutscene'] },
    reads: ['plot.cutscenes'],
    defines: [{ kind: 'cutscene', at: 'plot.cutscenes' }],
  },
  logic(logic) {
    logic.effect('play_cutscene', { refs: e => [['cutscene', e.cutscene]], run: (e, rt) => rt.service('cutscene').play(e.cutscene) });
    logic.effect('skip_cutscene', { run: (e, rt) => rt.service('cutscene').skip(true) });
    logic.predicate('cutscene', { refs: p => [['cutscene', p.cutscene]], test: (p, rt) => { const s = st(rt), state = p.state ?? 'done'; return state === 'playing' ? s.active?.id === p.cutscene : state === 'done' ? Boolean(s.played[p.cutscene]) : !s.played[p.cutscene] && s.active?.id !== p.cutscene; } });
  },
  validate(config, doc, ctx) {
    const errors = [], all = doc.plot?.cutscenes;
    if (all === undefined) return errors;
    if (!all || typeof all !== 'object' || Array.isArray(all)) return [err('param_type', 'plot.cutscenes', 'must be an object of id -> cutscene')];
    for (const [id, c] of Object.entries(all)) {
      const path = `plot.cutscenes.${id}`;
      checkKeys(c, ['steps', 'skippable', 'title'], path, errors);
      if (!Array.isArray(c?.steps) || !c.steps.length) { errors.push(err('cutscene_invalid', `${path}.steps`, 'cutscene needs at least one step')); continue; }
      let total = 0;
      c.steps.forEach((s, i) => {
        const sp = `${path}.steps[${i}]`;
        checkKeys(s, STEP_KEYS, sp, errors, 'cutscene_step_invalid');
        if (!STEP_KEYS.some(k => k !== 'sec' && s?.[k] !== undefined)) errors.push(err('cutscene_step_invalid', sp, 'step needs camera, say, move, wait or fx'));
        if (s.camera !== undefined) { checkKeys(s.camera, ['pos', 'look', 'fov', 'ease', 'sec', 'target'], `${sp}.camera`, errors, 'cutscene_step_invalid'); total += s.camera.sec ?? 0; }
        if (s.say !== undefined) {
          checkKeys(s.say, ['character', 'text', 'sec'], `${sp}.say`, errors, 'cutscene_step_invalid');
          if (s.say.character !== undefined && s.say.character !== 'player') checkRef(ctx, 'character', s.say.character, `${sp}.say.character`, errors);
          if (typeof s.say?.text !== 'string') errors.push(err('cutscene_step_invalid', `${sp}.say.text`, 'say needs text'));
          total += s.say.sec ?? Math.max(config.minSay, readSeconds(s.say.text, config.sayCps));
        }
        if (s.move !== undefined) {
          checkKeys(s.move, ['who', 'to', 'sec', 'run'], `${sp}.move`, errors, 'cutscene_step_invalid');
          if (typeof s.move.who !== 'string') errors.push(err('cutscene_step_invalid', `${sp}.move.who`, 'move needs who (player or a character/entity id)'));
          else if (s.move.who !== 'player' && ctx.indexes.character && !ctx.indexes.character.has(s.move.who)) errors.push(err('ref_unknown', `${sp}.move.who`, `unknown character '${s.move.who}'`));
          if (typeof s.move.to === 'string') checkRef(ctx, 'zone', s.move.to, `${sp}.move.to`, errors);
          else if (s.move.to === undefined) errors.push(err('cutscene_step_invalid', `${sp}.move.to`, 'move needs to (zone id or position)'));
          total += s.move.sec ?? 0;
        }
        if (s.wait !== undefined) { if (!(typeof s.wait === 'number' && s.wait >= 0)) errors.push(err('cutscene_step_invalid', `${sp}.wait`, 'wait is a number of seconds')); else total += s.wait; }
        checkEffects(s.fx, `${sp}.fx`, errors, ctx);
        total += s.sec ?? 0;
      });
      if (total > config.maxSeconds) errors.push(err('cutscene_too_long', path, `cutscene runs ${total.toFixed(1)} s, over maxSeconds ${config.maxSeconds}`));
    }
    return errors;
  },
  install(rt, config) {
    st(rt); // create the store at install: UI reads (view/list/known) must never write state
    const holdOf = step => {
      let sec = step.sec ?? 0;
      if (step.camera) sec = Math.max(sec, step.camera.sec ?? 0);
      if (step.say) sec = Math.max(sec, step.say.sec ?? Math.max(config.minSay, readSeconds(step.say.text, config.sayCps)));
      if (step.move) sec = Math.max(sec, step.move.sec ?? 0);
      if (step.wait !== undefined) sec = Math.max(sec, step.wait);
      return ticks(rt, sec);
    };
    const moveEffect = (m, instant) => {
      const zone = typeof m.to === 'string' ? m.to : undefined, at = zone ? undefined : m.to;
      if (instant) {
        const e = rt.resolve(m.who); if (!e) return;
        const target = zone ? zoneIndex(rt.doc).get(zone)?.space : e.space;
        rt.run([{ do: 'teleport', who: m.who, ...(zone ? { zone } : { at }), ...(target && target !== e.space ? { space: target } : {}) }]);
        delete e.components.moveTo;
      } else rt.run([{ do: 'move_to', who: m.who, ...(zone ? { zone } : { at }), run: Boolean(m.run) }]);
    };
    const beginStep = a => {
      const scene = scenes(rt)[a.id], step = scene.steps[a.step];
      rt.emit('cutscene_step', { cutscene: a.id, step: a.step });
      if (step.camera) rt.emit('camera', { cutscene: a.id, ...step.camera });
      if (step.say) rt.emit('say', { cutscene: a.id, character: step.say.character ?? null, text: step.say.text });
      if (step.move) moveEffect(step.move, false);
      if (step.fx) rt.run(step.fx, { cutscene: a.id });
      a.hold = holdOf(step);
    };
    const endStep = a => { const step = scenes(rt)[a.id]?.steps[a.step]; if (step?.move && config.snapMoves) moveEffect(step.move, true); };
    const end = () => {
      const s = st(rt), a = s.active; if (!a) return;
      s.active = null; s.played[a.id] = (s.played[a.id] || 0) + 1;
      rt.emitTyped('cutscene_end', a.id, { cutscene: a.id, skipped: Boolean(a.skipped) });
      if (s.queue.length && rt.state.status === 'playing') begin(s.queue.shift());
    };
    // Run steps until one holds for time (or the scene ends).
    const pump = () => {
      const s = st(rt);
      for (let guard = 0; guard < 1000; guard++) {
        const a = s.active; if (!a || rt.state.status !== 'playing') return;
        if (a.hold > 0) return;
        if (a.step >= 0) endStep(a);
        a.step++;
        if (a.step >= scenes(rt)[a.id].steps.length) { end(); continue; }
        beginStep(a);
      }
    };
    const begin = id => {
      if (!scenes(rt)[id]) return false;
      st(rt).active = { id, step: -1, hold: 0 };
      rt.emitTyped('cutscene_start', id, { cutscene: id, letterbox: config.letterbox });
      pump();
      return true;
    };
    const canSkip = a => a && config.skippable && scenes(rt)[a.id]?.skippable !== false;
    const skip = (force = false) => {
      const s = st(rt), a = s.active; if (!a || (!force && !canSkip(a))) return false;
      a.skipped = true;
      const steps = scenes(rt)[a.id].steps;
      if (a.step >= 0) endStep(a);
      for (let i = a.step + 1; i < steps.length && rt.state.status === 'playing'; i++) { if (steps[i].fx) rt.run(steps[i].fx, { cutscene: a.id }); if (steps[i].move) moveEffect(steps[i].move, true); }
      a.step = steps.length; a.hold = 0;
      end(); pump();
      return true;
    };
    const remaining = () => {
      const a = st(rt).active; if (!a) return 0;
      const steps = scenes(rt)[a.id].steps;
      let n = a.hold; for (let i = a.step + 1; i < steps.length; i++) n += holdOf(steps[i]);
      return n;
    };
    const api = {
      play(id) { const s = st(rt); if (!scenes(rt)[id]) return false; if (s.active) { s.queue.push(id); return 'queued'; } return begin(id); },
      playing: () => st(rt).active?.id ?? null,
      queued: id => st(rt).queue.includes(id),
      skip, remaining,
      played: id => st(rt).played[id] || 0,
    };
    rt.provide('cutscene', api);
    rt.action('skip_cutscene', () => skip(false));
    rt.system('plot', rt => { const a = st(rt).active; if (!a) return; if (a.hold > 0) a.hold--; pump(); }, ID);
    rt.options(rt => {
      const a = st(rt).active; if (!a) return [];
      if (canSkip(a)) return [{ label: `skip ${a.id}`, actions: { skip_cutscene: true } }];
      return [{ label: `watch ${a.id}`, actions: {}, steps: Math.max(1, Math.min(remaining() + 1, ticks(rt, config.maxSeconds))) }];
    });
  },
};

export function solverKey(rt) { const s = rt.store(ID); return { active: s.active ? [s.active.id, s.active.step] : null, played: Object.keys(s.played || {}).sort(), queue: s.queue || [] }; }
