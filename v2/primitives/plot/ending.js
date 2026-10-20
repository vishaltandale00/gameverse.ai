// Endings (plot.endings): { id, title, when, epilogue, cutscene?, do?, outcome? }.
// Each plot tick the endings are tested in document order; the first whose
// `when` holds fires: ending_reached (with the epilogue), its `do` effects,
// its cutscene (when plot.cutscene is installed the game ends as the cutscene
// finishes), then end_game with the ending's outcome.
import { err, checkPred, checkEffects, checkRef, checkKeys, service } from './story-lib.js';

const ID = 'plot.ending';
const OUTCOMES = ['won', 'lost', 'neutral'];
const st = rt => rt.store(ID);

export default {
  id: ID,
  card: {
    intent: 'One or more endings from plot.endings: the first ending whose condition holds plays its effects and cutscene, shows its epilogue and ends the game with its outcome.',
    views: ['any'],
    params: {
      epilogue: { type: 'boolean', default: true, effect: 'include the epilogue text in ending_reached for the UI' },
      requireWhen: { type: 'boolean', default: true, effect: 'every ending needs a when predicate (false: endings without one only fire via end_game)' },
    },
    provides: { events: ['ending_reached', 'ending_reached:*'] },
    reads: ['plot.endings'],
  },
  logic(logic) {
    logic.predicate('ending_available', { refs: p => [['ending', p.ending_available]], test: (p, rt) => { const e = (rt.doc.plot?.endings || []).find(x => x.id === p.ending_available); return Boolean(e?.when) && rt.test(e.when); } });
  },
  validate(config, doc, ctx) {
    const errors = [], list = doc.plot?.endings;
    if (list === undefined) return errors;
    if (!Array.isArray(list) || !list.length) return [err('plot_missing', 'plot.endings', 'endings must be a non-empty list')];
    list.forEach((e, i) => {
      const path = `plot.endings[${i}]`;
      checkKeys(e, ['id', 'title', 'when', 'epilogue', 'cutscene', 'do', 'outcome'], path, errors);
      if (e.when === undefined && config.requireWhen) errors.push(err('ending_invalid', `${path}.when`, 'ending needs a when predicate', 'or set requireWhen:false and reach it with end_game'));
      checkPred(e.when, `${path}.when`, errors, ctx);
      checkEffects(e.do, `${path}.do`, errors, ctx);
      if (e.outcome !== undefined && !OUTCOMES.includes(e.outcome)) errors.push(err('ending_invalid', `${path}.outcome`, `outcome must be ${OUTCOMES.join('|')}`));
      if (e.cutscene !== undefined) checkRef(ctx, 'cutscene', e.cutscene, `${path}.cutscene`, errors);
    });
    return errors;
  },
  install(rt, config) {
    st(rt); // create the store at install: UI reads (view/list/known) must never write state
    const finish = e => rt.run([{ do: 'end_game', ending: e.id, outcome: e.outcome || 'won' }]);
    rt.on('cutscene_end', data => { const s = st(rt); if (s.pending && data.cutscene === s.pendingCutscene) { const e = (rt.doc.plot?.endings || []).find(x => x.id === s.pending); s.pending = null; if (e && rt.state.status === 'playing') finish(e); } });
    rt.system('plot', rt => {
      const s = st(rt);
      if (s.pending) return; // waiting for the ending cutscene
      for (const e of rt.doc.plot?.endings || []) {
        if (!e.when || !rt.test(e.when)) continue;
        s.reached = e.id;
        rt.emitTyped('ending_reached', e.id, { ending: e.id, title: e.title ?? e.id, outcome: e.outcome || 'won', epilogue: config.epilogue ? (e.epilogue ?? '') : undefined });
        rt.run(e.do || [], { ending: e.id });
        if (rt.state.status !== 'playing') return;
        const cs = service(rt, 'cutscene');
        if (e.cutscene && cs && cs.play(e.cutscene) !== false) { s.pending = e.id; s.pendingCutscene = e.cutscene; if (cs.playing() !== e.cutscene && !cs.queued(e.cutscene)) { s.pending = null; finish(e); } return; }
        finish(e);
        return;
      }
    }, ID);
  },
};
