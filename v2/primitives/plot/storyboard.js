// Story as data: acts of beats. A beat fires once when its `when` predicate
// holds and every beat in `after` has fired; it runs its effects. Acts are
// sequential unless `parallel` is set. The verifier can solve this graph.
// A beat named by a plot.gate lock (`beat:<id>`) waits until that gate opens.
import { TEXT, ENTRY_ID, KEY_ID } from './story-lib.js';

export default {
  id: 'plot.storyboard',
  solverKey, progress,
  card: {
    loop: { shows: [], verbs: [], progress: ['beat', 'act_complete'] },
    // Story mode: beats fire as the player explores and talks; an ending (or an end_game effect) wins. Beats are
    // predicates on the world (zones, talk, items), whatever moves the player: walked in real time or stepped on a grid.
    mode: { loop: 'story', interaction: ['avatar-realtime', 'avatar-grid'], opponent: 'none', space: ['engine.space.tilemap', 'engine.space.graph', ['position']], needs: { content: ['plot.storyboard'], participants: null }, win: { ending: 'plot.endings', shown: { count: 'beat' }, reads: { event: 'beat' } }, lose: { param: null }, bot: 'story' },
    intent: 'Runs the story: acts made of beats that fire when their trigger predicate holds (after prerequisite beats) and apply effects such as dialogue, items, flags, quests and endings.',
    views: ['any'],
    params: { sequentialActs: { type: 'boolean', default: true, effect: 'beats in act N+1 wait until every non-optional beat in act N has fired' } },
    provides: { events: ['say', 'beat', 'act_start', 'act_complete'] },
    reads: ['plot.storyboard', 'plot.characters', 'plot.endings'],
    // Section shapes this primitive reads (planner: composition renames the references they hold, repair and forms use them).
    data: { 'plot.storyboard': { type: 'object', required: true, fields: { acts: { type: 'list', min: 1, required: true, of: { type: 'object', fields: {
      id: KEY_ID, title: TEXT({ effect: 'the act\'s title a person reads' }),
      beats: { type: 'list', of: { type: 'object', fields: { id: ENTRY_ID, title: TEXT({ effect: 'the beat\'s title a person reads' }), when: { type: 'predicate' }, after: { type: 'list', of: { type: 'ref', to: 'beat' } }, optional: { type: 'boolean' }, do: { type: 'effects' } } } },
    } } } } } },
    rules: {
      // The story is the model's to write: a document with the storyboard and no plot.storyboard is missing it.
      plot_missing: { fields: ['plot.storyboard'], message: 'a document using plot.storyboard has a plot.storyboard section', example: { doc: { plot: {} }, at: 'plot.storyboard' } },
    },
  },
  logic(logic) {
    logic.predicate('beat', { refs: p => [['beat', p.beat]], test: (p, rt) => Boolean(rt.store('plot.storyboard').fired?.[p.beat]) });
    // act: active = the act the story is in (sequential) or any act with an unfired beat; done = all non-optional beats fired.
    logic.predicate('act', {
      check: (p, path, errors, ctx) => {
        if (!(ctx.doc.plot?.storyboard?.acts || []).some(a => a.id === p.act)) errors.push({ code: 'ref_unknown', path, message: `unknown act '${p.act}'` });
        if (p.state !== undefined && !['active', 'done'].includes(p.state)) errors.push({ code: 'predicate_invalid', path: `${path}.state`, message: 'state must be active|done' });
      },
      test: (p, rt) => {
        const s = rt.store('plot.storyboard'), acts = rt.doc.plot?.storyboard?.acts || [], i = acts.findIndex(a => a.id === p.act);
        if (i < 0) return false;
        const done = Boolean(s.done?.[p.act]);
        return (p.state ?? 'done') === 'done' ? done : !done && (s.act ?? 0) >= i;
      },
    });
    logic.effect('say', {
      refs: e => [['character', e.character]],
      run: (e, rt) => rt.emit('say', { character: e.character, text: e.text }),
    });
  },
  // The shape of plot.storyboard is declared (card.data); the kernel checks a section only when it is there.
  validate(config, doc) {
    return doc.plot?.storyboard === undefined ? [{ code: 'plot_missing', path: 'plot.storyboard', message: 'the story needs a storyboard with at least one act' }] : [];
  },
  install(rt, config) {
    rt.system('plot', rt => {
      const acts = rt.doc.plot.storyboard.acts; // read per step: hot-loaded beats appear here
      // Fetch state every step: restore() replaces it.
      const s = rt.store('plot.storyboard');
      s.fired ??= {}; s.act ??= 0; s.done ??= {};
      const gates = rt.hasService('gates') ? rt.service('gates') : null;
      // Bounded fixpoint: beats unlocked by this frame's beats can fire in the same frame.
      for (let pass = 0; pass < 8; pass++) {
        let progressed = false;
        acts.forEach((act, ai) => {
          if (config.sequentialActs && ai > s.act) return;
          for (const b of act.beats || []) {
            if (s.fired[b.id] || !(b.after || []).every(d => s.fired[d]) || (b.when && !rt.test(b.when))) continue;
            if (gates?.locked(`beat:${b.id}`)) continue;
            s.fired[b.id] = rt.state.frame + 1; progressed = true;
            rt.emit('beat', { beat: b.id, act: act.id });
            rt.run(b.do || [], { beat: b.id });
            if (rt.state.status !== 'playing') return;
          }
        });
        const current = acts[s.act];
        if (current && !s.done[current.id] && (current.beats || []).filter(b => !b.optional).every(b => s.fired[b.id])) {
          s.done[current.id] = true; rt.emit('act_complete', { act: current.id });
          if (s.act < acts.length - 1) { s.act++; rt.emit('act_start', { act: acts[s.act].id }); progressed = true; }
        }
        if (!progressed || rt.state.status !== 'playing') break;
      }
    });
  },
};

/** Solver key: which beats fired and which acts are done (not the frames they fired on). */
export function solverKey(rt) { const s = rt.store('plot.storyboard'); return [Object.keys(s.fired || {}).sort(), s.act ?? 0]; }
export function progress(rt) { return Object.keys(rt.store('plot.storyboard').fired || {}).length; }
