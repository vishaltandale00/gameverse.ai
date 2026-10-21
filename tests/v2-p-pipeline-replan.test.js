// Figuring out how to make the game (v2/planner/replan.js, kernel-pipeline.js): no fallback. A failing build is
// diagnosed to the primitive, mechanic or win it concerns, the collection is re-planned (another catalogue primitive
// for the failing mechanic, a primitive that declares the missing win), the failing fields are repaired, and the game
// is verified again; when the configured attempts run out the build fails with what it tried and what is missing.
// Scripted fake writers; test primitives; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKernelPipeline } from '../v2/planner/kernel-pipeline.js';
import { diagnose, replan } from '../v2/planner/replan.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { testCatalogue, fakeWriter, broken, picky, buildAnswer, decomposer, planFrom } from './v2-p-pipeline-fixtures.js';

/** A juggling loop that works: toss is a player verb, every toss is the loop's progress, enough tosses win. */
const clubs = {
  id: 'gameplay.test.clubs',
  card: {
    intent: 'Toss clubs high and catch them for applause, juggling.',
    loop: { verbs: ['toss'], progress: ['tossed'], win: { when: { count: 'tossed', gte: '$target' } } },
    params: {}, provides: { actions: ['toss'], events: ['tossed'] },
  },
  install(rt) { rt.action('toss', (v, r) => { if (v) r.emit('tossed', {}); }); },
};
/** The test catalogue's `broken` juggler (its install throws) declares a playable loop too (a verb that juggles), so only its crash is wrong. */
const brokenJuggler = { ...broken, card: { ...broken.card, loop: { verbs: ['juggle'], progress: ['juggled'], win: { when: { count: 'juggled', gte: '$target' } } }, provides: { events: ['juggled'], actions: ['juggle'] } } };
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
function scripted({ title = 'Torch Show' } = {}) {
  const decompose = decomposer(planFrom({ title: 'The Torch Show', premise: 'Juggle for a crowd. Do not drop anything.', tone: 'bright', views: ['ui'], acts: 1, zones: 2,
    mechanics: [{ id: 'juggle', verb: 'juggle', description: 'juggling flaming torches for a crowd', from: '', importance: 'core' }, { id: 'titles', verb: 'insist', description: 'insists that the title starts with The', from: '', importance: 'core' }],
    spaces: [{ role: 'stage', kind: 'none', description: 'a stage' }], movement: 'none',
    core: { loop: 'juggle', interaction: 'menu', opponent: 'none', win: 'keep the crowd cheering', lose: '', theme: 'circus', narrative: false, mashup: [] } }));
  return fakeWriter([(req) => {
    const name = String(req.schema?.name || '');
    const decomposed = decompose(req);
    if (decomposed) return decomposed;
    const built = buildAnswer(req, { picks: { juggle: ['gameplay.test.broken'], titles: ['gameplay.test.picky'] } });
    if (built) return built;
    // A field-level re-ask: the title field gets fixed.
    if (name.endsWith('_fields')) return JSON.stringify(Object.fromEntries(Object.entries(req.schema.schema.properties).map(([k, p]) => [k, /^title/.test(p.description) ? `The ${title}` : null])));
    if (name.endsWith('_frame')) return JSON.stringify({ title, logline: 'Juggle.', premise: 'Juggle for a crowd.', spaces: {}, player: { archetype: req.schema.schema.properties.player.properties.archetype.enum?.[0] ?? 'player_side', zone: '' }, endings: [] });
    if (name.endsWith('_cast')) return JSON.stringify({ archetypes: [], items: [], characters: [] });
    if (name.startsWith('game_outline')) return '{}';
    return '{}';
  }]);
}

test('a failing draft is re-planned and repaired, never substituted: the crashing primitive is replaced for its mechanic, the bad field re-asked, then verified', async () => {
  const cat = catalogue();
  const spec = scripted();
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec }, config: { replanAttempts: 3, maxDetailTasks: 0 } });
  const { ctx, versions, stages, checkpoints } = memoryCtx();
  const out = await pipeline({ gameId: 'g', prompt: 'juggle flaming torches', kind: 'create', seed: 3 }, ctx);
  const attempts = out.outline.attempts;
  assert.ok(attempts.length >= 2, JSON.stringify(attempts));
  // Attempt 1: the juggler crashed at boot; the diagnosis names it and the mechanic; re-planning replaced it.
  assert.ok(attempts[0].diagnoses.some(d => d.kind === 'primitive' && d.primitive === 'gameplay.test.broken' && d.mechanic === 'juggle'), JSON.stringify(attempts[0]));
  assert.ok(attempts[0].actions.some(a => a.action === 'replace' && a.primitive === 'gameplay.test.broken' && a.by === 'gameplay.test.clubs'));
  assert.ok(stages.some(s => s.name === 'replanned'));
  // The published game is the re-planned collection: the replacement is in, the crashing primitive is not, nothing isolated.
  const doc = versions[0].doc;
  assert.equal(versions[0].stage, 'first_playable');
  assert.ok(doc.systems.some(s => s.use === 'gameplay.test.clubs'));
  assert.ok(!doc.systems.some(s => s.use === 'gameplay.test.broken'));
  assert.ok(doc.systems.some(s => s.use === 'gameplay.test.picky'), 'the other core primitive stays');
  assert.deepEqual(out.selection.mechanics.find(m => m.id === 'juggle').primitives, ['gameplay.test.clubs']);
  // The bad field went back alone (a field form), and the model's fix is what published.
  assert.match(doc.title, /^The /);
  assert.ok(spec.calls.some(c => c.schema.name.endsWith('_fields') && /picky_title/.test(c.user)), 'the failing field was re-asked');
  // Verified again: the gate passed on the re-planned game and its loop (the clubs' progress) is declared.
  assert.ok(out.base.viable, out.base.viability);
  assert.ok(checkpoints.outline.attempts.length === attempts.length);
});

test('when the limits run out the build fails with every attempt and what is still missing (no degraded game)', async () => {
  const cat = testCatalogue([brokenJuggler, pickyLoop, endingRunner, uiSpace, inputActions]); // no other juggler in the catalogue
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec: scripted() }, config: { replanAttempts: 2, maxDetailTasks: 0 } });
  const { ctx, versions } = memoryCtx();
  await assert.rejects(pipeline({ gameId: 'g', prompt: 'juggle flaming torches', kind: 'create', seed: 3 }, ctx), e => {
    assert.equal(e.status, 422);
    assert.equal(e.code, 'not_buildable');
    assert.ok(e.report.attempts.length >= 1);
    assert.ok(e.report.missing.some(m => /gameplay\.test\.broken/.test(m)), JSON.stringify(e.report.missing));
    assert.match(e.message, /Tried \d time/);
    return true;
  });
  assert.equal(versions.length, 0, 'nothing publishes');
});

test('diagnose and replan: a failing primitive gets the next untried one; a missing win is never filled without the model (the win step asks it)', async () => {
  const { registry } = catalogue();
  const selection = { systems: ['gameplay.test.broken'], spaces: [{ id: 'w', use: 'engine.space.graph', with: {}, role: 'w', caps: [...registry.get('engine.space.graph').card.provides.capabilities] }], generators: [], graphics: [], bind: {}, gaps: [],
    mechanics: [{ id: 'juggle', verb: 'juggle', description: 'juggling flaming torches for a crowd', importance: 'core', primitives: ['gameplay.test.broken'], candidates: [], source: 'x', score: 1, from: '' }] };
  const ds = diagnose([{ code: 'install_threw', path: 'systems[0]', message: "'gameplay.test.broken' threw while installing: boom", primitive: 'gameplay.test.broken' }, { code: 'win_unwired', path: 'plot.endings', message: 'nothing in the game ends it with a win' }], { selection, registry });
  assert.deepEqual(ds.map(d => d.kind).sort(), ['primitive', 'win']);
  const tried = new Map();
  const r = await replan(selection, ds, { registry, decomposition: /** @type {any} */ ({ premise: '', core: null }), tried });
  assert.ok(r.actions.some(a => a.action === 'replace' && a.by === 'gameplay.test.clubs'));
  assert.ok(r.selection.systems.includes('gameplay.test.clubs') && !r.selection.systems.includes('gameplay.test.broken'));
  assert.ok(!r.actions.some(a => a.action === 'add'), 'no win provider is picked without the model');
  // Nothing is chosen twice: a second re-plan for the same mechanic finds nothing left and says so.
  const again = await replan(r.selection, [{ kind: 'primitive', primitive: 'gameplay.test.clubs', mechanic: 'juggle', codes: ['x'], message: 'still failing' }], { registry, decomposition: /** @type {any} */ ({ premise: '' }), tried });
  assert.equal(again.actions.filter(a => a.action === 'replace').length, 0);
  assert.equal(again.unresolved.length, 1);
  assert.equal(selection.systems[0], 'gameplay.test.broken', 'the input selection is not mutated');
});
