// The step path (kernel-pipeline.js stepCreate, ARCHITECTURE §5): for a game no template is. It builds once, each step a
// small model choice among the options the declarations prove valid; a pick that fails its checks is dropped and the
// step asked again without it; the outline's failing fields are re-asked alone. A stage that still fails fails the
// build with its stage and problems: nothing is re-planned around it, substituted or published. It is time-boxed
// (cfg.stepPathMs) and its use is reported; without a model nothing is chosen.
// Scripted fake writers; test primitives; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKernelPipeline } from '../v2/planner/kernel-pipeline.js';
import { selectPrimitives } from '../v2/planner/select.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { testCatalogue, fakeWriter, broken, picky, buildAnswer, decomposer, planFrom, stepPick } from './v2-p-pipeline-fixtures.js';

/** A juggling loop that works: toss is a player verb, every toss is the loop's progress, enough tosses win. */
const clubs = {
  id: 'gameplay.test.clubs',
  card: {
    intent: 'Toss clubs high and catch them for applause, juggling.',
    // Played on a menu: nothing spatial to see; the HUD shows the win's count (card.loop.shows, KERNEL_API.md).
    loop: { shows: [], verbs: ['toss'], progress: ['tossed'], win: { when: { count: 'tossed', gte: '$target' } } },
    params: {}, provides: { actions: ['toss'], events: ['tossed'] },
  },
  install(rt) { rt.action('toss', (v, r) => { if (v) r.emit('tossed', {}); }); },
};
/** The test catalogue's `broken` juggler (its install throws) declares a playable loop too (a verb that juggles), so only its crash is wrong. */
const brokenJuggler = { ...broken, card: { ...broken.card, loop: { shows: [], verbs: ['juggle'], progress: ['juggled'], win: { when: { count: 'juggled', gte: '$target' } } }, provides: { events: ['juggled'], actions: ['juggle'] } } };
/** picky (the title must start with "The"): a field only the model can fix. */
const pickyLoop = { ...picky, card: { ...picky.card, loop: { verbs: [], progress: ['titled'] }, provides: { events: ['titled'] } } };
const endingRunner = PRIMITIVES.find(p => p.id === 'plot.ending');

/** The juggling show is played on a menu (views ui): the space that shows it. */
const uiSpace = PRIMITIVES.find(p => p.id === 'engine.space.none');
// engine.input.actions is the input primitive the real catalogue declares for menu interaction (card.interactions).
const inputActions = PRIMITIVES.find(p => p.id === 'engine.input.actions');
const catalogue = () => testCatalogue([brokenJuggler, clubs, pickyLoop, endingRunner, uiSpace, inputActions]);
const memoryCtx = () => {
  const versions = [], stages = [], checkpoints = {};
  return { versions, stages, checkpoints, ctx: {
    stage(name, detail = {}) { stages.push({ name, ...detail }); }, draft() {}, checkpoint(name, value) { checkpoints[name] = value; },
    async publish(p) { const r = { version: versions.length + 1, ...p }; versions.push(r); return r; },
    store: { async updateMeta() {}, async version(_, v) { return versions[v - 1]; } },
  } };
};

/** The scripted spec model: decomposes, maps the juggling mechanic onto the catalogue, and fills the outline forms. */
function scripted({ title = 'Torch Show', picks = ['gameplay.test.clubs'] } = {}) {
  const decompose = decomposer(planFrom({ title: 'The Torch Show', premise: 'Juggle for a crowd. Do not drop anything.', tone: 'bright', views: ['ui'], acts: 1, zones: 2,
    mechanics: [{ id: 'juggle', verb: 'juggle', description: 'juggling flaming torches for a crowd', from: '', importance: 'core' }, { id: 'titles', verb: 'insist', description: 'insists that the title starts with The', from: '', importance: 'core' }],
    spaces: [{ role: 'stage', kind: 'none', description: 'a stage' }], movement: 'none',
    core: { loop: 'juggle', interaction: 'menu', opponent: 'none', win: 'keep the crowd cheering', lose: '', theme: 'circus', narrative: false, mashup: [] } }));
  return fakeWriter([(req) => {
    // The template pick: no template is this idea, so the step path builds it (what this test exercises).
    const picked = stepPick(req); if (picked) return picked;
    const name = String(req.schema?.name || '');
    const decomposed = decompose(req);
    if (decomposed) return decomposed;
    const built = buildAnswer(req, { picks: { juggle: picks, titles: ['gameplay.test.picky'] } });
    if (built) return built;
    // A field-level re-ask: the title field gets fixed.
    if (name.endsWith('_fields')) return JSON.stringify(Object.fromEntries(Object.entries(req.schema.schema.properties).map(([k, p]) => [k, /^title/.test(p.description) ? `The ${title}` : null])));
    if (name.endsWith('_frame')) return JSON.stringify({ title, logline: 'Juggle.', premise: 'Juggle for a crowd.', spaces: {}, player: { archetype: req.schema.schema.properties.player.properties.archetype.enum?.[0] ?? 'player_side', zone: '' }, endings: [] });
    if (name.endsWith('_cast')) return JSON.stringify({ archetypes: [], items: [], characters: [] });
    if (name.startsWith('game_outline')) return '{}';
    return '{}';
  }]);
}

test('a collection the checks pass publishes through the step path, its failing field re-asked alone, its use reported', async () => {
  const cat = catalogue();
  const spec = scripted();
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec }, config: { stepPathMs: 60000 } });
  const { ctx, versions, stages } = memoryCtx();
  const out = await pipeline({ gameId: 'g', prompt: 'juggle flaming torches', kind: 'create', seed: 3 }, ctx);
  assert.deepEqual(versions.map(v => v.stage), ['first_playable']);
  const doc = versions[0].doc;
  assert.ok(doc.systems.some(s => s.use === 'gameplay.test.clubs') && doc.systems.some(s => s.use === 'gameplay.test.picky'));
  // The bad field went back alone (a field form), and the model's fix is what published.
  assert.match(doc.title, /^The /);
  assert.ok(spec.calls.some(c => c.schema.name.endsWith('_fields') && /picky_title/.test(c.user)), 'the failing field was re-asked');
  assert.ok(out.base.viable, out.base.viability);
  // Its use is reported: why the step path ran, its time box, what it took.
  const report = versions[0].report;
  assert.equal(report.path, 'step');
  assert.match(report.why, /no template is/);
  assert.equal(report.stepPath.budgetMs, 60000);
  assert.equal(typeof report.stepPath.ms, 'number');
  assert.ok(report.stepPath.calls > 0);
  assert.equal(typeof report.timings.stepPathMs, 'number');
  assert.ok(stages.some(s => s.name === 'step_path' && s.budgetMs === 60000));
});

test('a stage that fails fails the build with its stage and problems: nothing is re-planned, substituted or published', async () => {
  const cat = catalogue();
  // The model picks the juggler whose install throws: the build fails, naming it.
  const spec = scripted({ picks: ['gameplay.test.broken'] });
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec } });
  const { ctx, versions, stages } = memoryCtx();
  await assert.rejects(pipeline({ gameId: 'g', prompt: 'juggle flaming torches', kind: 'create', seed: 3 }, ctx), e => {
    assert.equal(e.status, 422);
    assert.equal(e.report.path, 'step');
    // The outline boots every draft: the throw is found there, named, never removed.
    assert.equal(e.report.stage, 'outline');
    assert.ok(e.report.problems.some(p => p.primitive === 'gameplay.test.broken' || /gameplay\.test\.broken/.test(String(p.message))), JSON.stringify(e.report.problems).slice(0, 400));
    assert.ok(e.report.problems.some(p => p.code === 'install_threw'), 'the report names the throw');
    assert.match(e.message, /^This isn't the game you asked for yet\. The game crashed/, 'a person reads that it crashed');
    assert.equal(e.report.stepPath.stage, 'outline');
    return true;
  });
  assert.equal(versions.length, 0, 'nothing publishes');
  // One build: the juggling mechanic was asked once, and the clubs (valid, never picked) were never swapped in.
  assert.equal(spec.calls.filter(c => c.schema.name === 'pick_primitive' && /Mechanic juggle /.test(c.user)).length, 1);
  assert.ok(stages.some(s => s.name === 'not_buildable' && s.path === 'step' && s.stage === 'outline'));
});

test('the step path is time-boxed: no question is asked after its time box, and the build fails naming the step', async () => {
  const cat = catalogue();
  const spec = scripted();
  const { ctx, versions } = memoryCtx();
  // Every call takes a little time, so the 1 ms time box is over once the decomposition is written.
  const slow = { ...spec, async complete(req) { await new Promise(r => setTimeout(r, 2)); return spec.complete(req); } };
  const timed = createKernelPipeline({ catalogue: async () => cat, writers: { spec: slow }, config: { stepPathMs: 1 } });
  await assert.rejects(timed({ gameId: 'g', prompt: 'juggle flaming torches', kind: 'create', seed: 3 }, ctx), e => {
    assert.equal(e.status, 422);
    assert.equal(e.code, 'step_path_timeout');
    assert.equal(e.report.stage, 'select');
    assert.match(e.message, /Building it took longer than its time limit/);
    assert.ok(e.report.problems.some(p => /time box ran out before pick_/.test(String(p.message))), 'the report says which question');
    return true;
  });
  assert.equal(versions.length, 0);
  assert.ok(!spec.calls.some(c => /^pick_(space|primitive|win|lose|driver|coverage)$/.test(c.schema.name)), 'no build question was sent');
});

test('without a model nothing is chosen: the build fails saying so, and selection asks nothing', async () => {
  const cat = catalogue();
  const pipeline = createKernelPipeline({ catalogue: async () => cat });
  const { ctx, versions } = memoryCtx();
  await assert.rejects(pipeline({ gameId: 'g', prompt: 'juggle flaming torches', kind: 'create', seed: 3 }, ctx), e => e.status === 422 && e.code === 'step_path_model_missing');
  assert.equal(versions.length, 0);
  const d = /** @type {any} */ ({ title: 'T', premise: 'p', views: ['ui'], spaces: [], references: [], mechanics: [{ id: 'juggle', verb: 'juggle', description: 'juggling', from: '', importance: 'core' }], core: null });
  await assert.rejects(selectPrimitives({ decomposition: d, registry: cat.registry }), e => e.code === 'step_path_model_missing');
});
