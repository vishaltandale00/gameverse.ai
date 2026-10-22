// Extensions and readings on the template path (ARCHITECTURE.md §1.1, §5; v2/HANDOFF.md "Templates + extension"):
//   readings    a concept the idea can mean two ways (a name that is both a game and a character) is listed in the
//               pick's strict `readings`; code turns it into one question through the job's answers, and the job that
//               carries the answer and the pick builds the reading chosen, asking nothing again;
//   extensions  the mechanics the pick names that the chosen templates do not give are added onto the composed
//               document by the step path's checked machinery (extend.js), or the gap layer writes them, or the build
//               fails naming them: never dropped.
// "sonic the hedgehog, but he has a gun and can drive fast cars" end to end with fake writers, both readings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { TEMPLATES } from '../v2/templates/registry.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { createKernelPipeline } from '../v2/planner/kernel-pipeline.js';
import { createGameService } from '../v2/server/api.mjs';
import {
  pickForm, checkPick, readingQuestions, chooseReading, otherReading, readingLabel, composeTemplates, catalogueVerbs, declaredVerbs, tuneTarget, PICK_RULES,
} from '../v2/planner/templates.js';
import { templateCoverage, extensionOptions, extensionProblems, paramsForm, withSystems, EXTEND_RULES } from '../v2/planner/extend.js';
import { fakeWriter } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();
const cat = { registry, logic };
const ctx = { templates: TEMPLATES, registry };
const compose = pick => composeTemplates(pick, { ...ctx, logic });
const IDEA = 'sonic the hedgehog, but he has a gun and can drive fast cars';
const GUN = { name: 'has a gun', says: 'has a gun', verb: 'fire', importance: 'core' };
/** The pick a model writes for the idea: Sonic the platformer, racing united with it; Sonic may also be the character. */
const SONIC = {
  title: 'Sonic: Gun Kart', premise: 'Sonic races rivals through a level with a gun in hand. Reach the goal first.',
  primary: { name: 'Sonic the Hedgehog', kind: 'game', template: 'platformer' },
  games: [{ name: 'fast cars', kind: 'genre', template: 'race', relation: 'union' }],
  themes: [],
  readings: [{ name: 'Sonic the Hedgehog', kind: 'character', template: 'none', relation: 'none' }],
  mechanics: [GUN],
};

test('the pick form: strict readings and mechanics, the mechanic\'s verb a closed set of the catalogue\'s declared verbs', () => {
  const p = pickForm(TEMPLATES, registry).schema.properties;
  assert.deepEqual(Object.keys(p.readings.items.properties), ['name', 'kind', 'template', 'relation']);
  assert.deepEqual(p.readings.items.properties.relation.enum, ['none', 'nested', 'union']);
  assert.deepEqual(Object.keys(p.mechanics.items.properties), ['name', 'says', 'verb', 'importance']);
  assert.deepEqual(p.mechanics.items.properties.verb.enum, [...catalogueVerbs(registry), 'none']);
  assert.ok(catalogueVerbs(registry).includes('fire'));
  assert.deepEqual(p.mechanics.items.properties.importance.enum, ['core', 'extra']);
  for (const s of [p.readings.items, p.mechanics.items]) { assert.equal(s.additionalProperties, false); assert.deepEqual(s.required, Object.keys(s.properties)); }
  assert.deepEqual(checkPick(SONIC, ctx).problems, []);
});

test('readings: each is the concept\'s other kind or relation, checked with a declared code; a valid one is a question', () => {
  const codes = pick => checkPick(pick, ctx).problems.map(p => `${p.code}@${p.field}`);
  const with1 = r => ({ ...SONIC, readings: [r] });
  assert.deepEqual(codes(with1({ name: 'Knuckles', kind: 'character', template: 'none', relation: 'none' })), ['pick_reading_unknown@readings[0].name']);
  assert.deepEqual(codes(with1({ name: 'Sonic the Hedgehog', kind: 'game', template: 'race', relation: 'union' })), ['pick_reading_invalid@readings[0].kind']);
  assert.deepEqual(codes(with1({ name: 'Sonic the Hedgehog', kind: 'character', template: 'race', relation: 'none' })), ['pick_reading_invalid@readings[0].template']);
  assert.deepEqual(codes(with1({ name: 'fast cars', kind: 'genre', template: 'race', relation: 'union' })), ['pick_reading_invalid@readings[0].relation']);
  assert.deepEqual(codes({ ...SONIC, readings: [SONIC.readings[0], SONIC.readings[0]] }), ['pick_reading_duplicate@readings[1].name']);
  assert.deepEqual(codes({ ...SONIC, games: [...SONIC.games, { name: 'Pokémon', kind: 'game', template: 'creature-battle', relation: 'union' }] }).filter(c => c.startsWith('pick_reading')), ['pick_reading_no_primary@readings[0].kind']);
  // The other reading is held to the pick's own rules: race read as the primary cannot take a nested game.
  const theme = { ...SONIC, primary: { name: 'Mario Kart', kind: 'game', template: 'race' }, games: [], themes: [{ name: 'Pac-Man', kind: 'character' }], readings: [{ name: 'Pac-Man', kind: 'game', template: 'maze-chase', relation: 'nested' }] };
  assert.ok(codes(theme).includes('pick_reading_fails@readings[0]'), codes(theme).join(' '));
  for (const code of new Set(Object.keys(PICK_RULES))) assert.ok(code.startsWith('pick_'));
  // The Sonic reading: Sonic the character, the race the game played.
  const alt = otherReading(SONIC, SONIC.readings[0]);
  assert.deepEqual([alt.pick.primary, alt.pick.games, alt.pick.themes, alt.pick.readings], [{ name: 'fast cars', kind: 'genre', template: 'race' }, [], [{ name: 'Sonic the Hedgehog', kind: 'character' }], []]);
  const [q, ...more] = readingQuestions(SONIC);
  assert.deepEqual(more, []);
  assert.deepEqual(q.options, ['Sonic the Hedgehog (platformer) + fast cars (race, union)', 'fast cars (race) with Sonic the Hedgehog as the character']);
  assert.deepEqual(q.options, q.picks.map(readingLabel));
  assert.match(q.question, /Sonic the Hedgehog/);
  // Unanswered: no pick; an answer that is not an option is no answer; each option builds its reading.
  assert.deepEqual(chooseReading(SONIC, [], ctx).unanswered.map(x => x.id), [q.id]);
  assert.equal(chooseReading(SONIC, [{ question: q.question, answer: 'Sonic in a kart' }], ctx).pick, null);
  assert.deepEqual(chooseReading(SONIC, [{ question: q.question, answer: q.options[0] }], ctx).pick, { ...SONIC, readings: [] });
  assert.deepEqual(chooseReading(SONIC, [{ question: q.question, answer: q.options[1] }], ctx).pick, alt.pick);
  assert.deepEqual(chooseReading(SONIC, [{ question: q.question, answer: q.options[1] }], ctx).pick.mechanics, [GUN], 'the mechanics are the idea\'s in either reading');
});

test('template coverage: a mechanic whose verb a composed primitive gives the player is the template\'s; the gun is not the platformer\'s', () => {
  const doc = compose({ ...SONIC, readings: [] }).doc;
  assert.ok(declaredVerbs(doc, registry).get('jump').includes('gameplay.move.platformer'));
  const cover = templateCoverage([{ name: 'jumps', verb: 'jump', importance: 'core' }, GUN, { name: 'spin dash', verb: 'none', importance: 'extra' }], doc, registry);
  assert.deepEqual(cover.map(c => [c.mechanic, c.by, c.primitives]), [['jumps', 'template', ['gameplay.move.platformer']], ['has a gun', null, []], ['spin dash', null, []]]);
});

test('extension options: every card with player verbs valid on the composed document by its checks, the mechanic\'s verb first; rejected ones say why', () => {
  const union = compose({ ...SONIC, readings: [] }).doc;
  const u = extensionOptions({ doc: union, registry, logic, mechanic: GUN, interactions: ['avatar-realtime'] });
  assert.equal(u.options[0].id, 'gameplay.combat.projectile');
  assert.deepEqual(u.options[0].members, ['gameplay.combat.projectile'], 'the platformer already has the health the gun requires');
  for (const o of u.options) {
    const card = registry.get(o.id).card;
    assert.ok(card.loop?.verbs?.length || card.mode === undefined, o.id);
    assert.equal(card.mode, undefined, `${o.id}: a card carrying a whole loop is a game, never an extension`);
    assert.deepEqual(extensionProblems(withSystems(union, o.members), o.members, { ...cat, baseline: extensionProblems(union, [], cat).problems }).fresh, [], `${o.id}: valid by the same checks`);
  }
  // On the race alone the gun has no targets: its card's content contract (archetypes with health) is unmet.
  const race = compose(chooseReading(SONIC, [{ question: readingQuestions(SONIC)[0].question, answer: readingQuestions(SONIC)[0].options[1] }], ctx).pick).doc;
  const r = extensionOptions({ doc: race, registry, logic, mechanic: GUN, interactions: ['avatar-realtime'] });
  assert.ok(!r.options.some(o => o.id === 'gameplay.combat.projectile'));
  assert.match(r.rejected.find(x => x.id === 'gameplay.combat.projectile').why, /content_missing.*health/);
});

test('the params form of an extension: strict (no free JSON), its check engages the primitive and requires the player to get its verbs', () => {
  const doc = withSystems(compose({ ...SONIC, readings: [] }).doc, ['gameplay.combat.projectile']);
  const f = paramsForm(doc, 'gameplay.combat.projectile', cat);
  const walk = (s, path = '$') => { assert.ok(!/_json$/.test(path), path); if (s.anyOf) s.anyOf.forEach(x => walk(x, path)); if (s.type === 'object') { assert.equal(s.additionalProperties, false, path); assert.deepEqual(s.required, Object.keys(s.properties), path); for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`); } if (s.type === 'array') walk(s.items, `${path}[]`); };
  walk(f.schema.schema);
  assert.ok(!('lanes' in f.schema.schema.properties.weapons.anyOf[0].items.properties), 'a json field keeps its declaration, never free JSON');
  const empty = f.narrow(nulls(f.schema.schema));
  assert.deepEqual(f.check(empty).map(p => `${p.code}@${p.field}`), ['extension_unengaged@weapons']);
  assert.deepEqual(f.check(f.narrow(weaponAnswer(f.schema.schema))), []);
});

/** The smallest answer a strict schema allows: null where nullable, [] for lists, the first enum value. */
function nulls(s) {
  if (s.anyOf) return null;
  if (s.type === 'object') return Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, nulls(v)]));
  if (s.type === 'array') return [];
  if (s.enum) return s.enum[0];
  if (s.type === 'string') return 'x';
  if (s.type === 'boolean') return false;
  return s.minimum ?? 1;
}
/** The gun's params as a model writes them: one weapon. */
function weaponAnswer(schema) {
  const v = nulls(schema), item = schema.properties.weapons.anyOf[0].items;
  return { ...v, weapons: [{ ...nulls(item), id: 'chaos_blaster' }] };
}

/** The fake model for the idea: the pick; the extension step picks `gun` (or none); tune slots at their values; names; the gun's params. */
function sonicWriter({ gun = 'gameplay.combat.projectile' } = {}) {
  return fakeWriter([req => {
    const name = req.schema.name, props = req.schema.schema.properties;
    if (name === 'pick_templates') return JSON.stringify(SONIC);
    if (name === 'pick_primitive') return JSON.stringify({ pick: props.pick.enum.includes(gun) ? gun : 'none', why: 'the gun', spec: 'a gun the player fires at what is ahead' });
    if (name === 'pick_category') return JSON.stringify({ pick: 'none', why: '', spec: '' });
    if (name === 'frame_tune') return JSON.stringify(Object.fromEntries(Object.entries(props).map(([k, p]) => {
      if (k === 'logline') return [k, 'Sonic with a gun.'];
      const doc = compose({ ...SONIC, readings: [] }).doc, alt = compose(otherReading(SONIC, SONIC.readings[0]).pick).doc;
      const path = String(p.description).split(':')[0], target = tuneTarget(doc, path, registry) ?? tuneTarget(alt, path, registry);
      return [k, target.instances[0].with?.[target.param] ?? target.spec.default];
    })));
    if (name.startsWith('params_')) return JSON.stringify(weaponAnswer(req.schema.schema));
    const names = ps => Object.fromEntries(Object.entries(ps).map(([k, p]) => [k, p.type === 'object' ? names(p.properties) : `Sonic ${k}`.slice(0, 40)]));
    return JSON.stringify(names(props));
  }]);
}
function memoryCtx() {
  const versions = [], stages = [], checkpoints = {};
  return { versions, stages, checkpoints, ctx: {
    stage(name, detail = {}) { stages.push({ name, ...detail }); }, draft() {}, checkpoint(name, value) { checkpoints[name] = value; },
    async publish(p) { const r = { version: versions.length + 1, ...p }; versions.push(r); return r; },
    store: { async updateMeta() {}, async version(_, v) { return versions[v - 1]; } },
  } };
}
/** Ask, then answer with option `i`: the second job carries the answer and the first job's pick. */
async function askThenAnswer(i, { writer = sonicWriter(), config = {}, gapService = null, catalogue = async () => cat } = {}) {
  const pipeline = createKernelPipeline({ catalogue, writers: { spec: writer }, gapService, config });
  const first = memoryCtx();
  const asked = await pipeline({ gameId: 'g', prompt: IDEA, kind: 'create', seed: 7 }, first.ctx).then(() => null, e => e);
  assert.ok(asked, 'the first job asks');
  const callsToAsk = writer.calls.length;
  const { questions, pick } = first.checkpoints.question;
  const second = memoryCtx();
  const answers = [{ question: questions[0].question, answer: questions[0].options[i] }];
  const out = await pipeline({ gameId: 'g', prompt: IDEA, kind: 'create', seed: 7, answers, pick }, second.ctx).then(r => ({ r }), e => ({ e }));
  return { asked, first, second, questions, out, writer, callsToAsk };
}

test(`"${IDEA}" asks which game: the platformer united with the race, or the race with Sonic as the character; nothing is built before the answer`, async () => {
  const writer = sonicWriter(), m = memoryCtx();
  const e = await createKernelPipeline({ catalogue: async () => cat, writers: { spec: writer } })({ gameId: 'g', prompt: IDEA, kind: 'create', seed: 7 }, m.ctx).then(() => null, x => x);
  assert.equal(e.status, 409); assert.equal(e.code, 'needs_answer');
  assert.equal(writer.calls.length, 1, 'only the pick was asked');
  assert.equal(m.versions.length, 0);
  assert.deepEqual(m.checkpoints.question.questions.map(q => q.options), [['Sonic the Hedgehog (platformer) + fast cars (race, union)', 'fast cars (race) with Sonic the Hedgehog as the character']]);
  assert.deepEqual(m.checkpoints.question.pick, SONIC);
  assert.ok(m.stages.some(s => s.name === 'question'));
});

test('answer "the platformer united with the race": the gun is added onto the composed game by an extension step, engaged and usable; published', async () => {
  const t0 = performance.now();
  const { second, out, writer, callsToAsk } = await askThenAnswer(0);
  assert.ok(out.r, out.e?.message);
  const v = second.versions[0], report = v.report;
  assert.deepEqual(report.templates, ['platformer', 'race']);
  assert.deepEqual(report.mechanics.map(c => [c.mechanic, c.by, c.primitives]), [['has a gun', 'extension', ['gameplay.combat.projectile']]]);
  assert.equal(report.mechanics[0].asks.length, 1);
  const gun = v.doc.systems.find(s => s.use === 'gameplay.combat.projectile');
  assert.equal(gun.with.weapons[0].id, 'chaos_blaster');
  assert.equal(gun.with.playerWeapon, 'chaos_blaster', 'engaged: the player fires the weapon (card.engage.config)');
  for (const use of ['gameplay.move.platformer', 'gameplay.race', 'gameplay.goal']) assert.ok(v.doc.systems.some(s => s.use === use), `${use}: the templates' structure is kept`);
  // The calls: 1 to ask, then 0 pick + 1 extension question + the content round (frame, two names forms, the gun's params).
  assert.equal(callsToAsk, 1);
  assert.equal(report.extensionCalls, 1);
  assert.deepEqual(report.content.map(f => f.form), ['frame_tune', 'names_platformer', 'names_race', 'params_gameplay__combat__projectile']);
  assert.equal(report.modelCalls, 5); assert.equal(writer.calls.length, 6, '6 calls over both jobs, one of them the extension\'s');
  assert.equal(report.modelRounds, 2);
  assert.equal(report.verified, true);
  // The gate's feature check plays the gun through the controls a person has.
  const row = report.features.table.find(r => r.use === 'gameplay.combat.projectile');
  assert.deepEqual([row.exists, row.controllable, row.verbs.fire?.works], [true, true, true], JSON.stringify(row));
  assert.deepEqual(report.features.problems.filter(p => p.severity !== 'warning'), []);
  timings.unionMs = Math.round(performance.now() - t0);
});

test('answer "the race with Sonic as the character": no valid catalogue option gives the race a gun; without the gap layer the build fails naming the mechanic', async () => {
  const { second, out, writer, callsToAsk } = await askThenAnswer(1);
  assert.ok(out.e, 'nothing publishes');
  assert.equal(out.e.status, 422); assert.equal(out.e.code, 'extension_missing');
  assert.match(out.e.message, /"has a gun".*still missing/);
  assert.equal(second.versions.length, 0);
  assert.equal(writer.calls.length - callsToAsk, 1, 'the extension question only: no content is asked for a game that cannot be built');
  const stage = second.stages.find(s => s.name === 'not_buildable');
  assert.ok(stage.missing.some(x => /has a gun/.test(x)));
  assert.deepEqual(second.stages.find(s => s.name === 'templates_picked').templates, ['race'], 'the race is the game played, Sonic its character');
});

// A primitive the gap layer "writes" (the fake service: a test card with the verb 'shoot' and its event), held to the
// same checks as an extension and played by the gate through the controls.
const BLASTER = {
  id: 'gameplay.test.blaster',
  card: {
    intent: 'Test blaster written by the gap layer: shoot to fire a shot.', views: ['any'], params: {},
    loop: { verbs: ['shoot'], progress: ['shot'] }, provides: { events: ['shot'], actions: ['shoot'] }, requires: {},
    actionSpace: { shoot: { type: 'enum', options: [true] } },
  },
  install(rt) { rt.action('shoot', () => { rt.emit('shot', {}); }); },
};
const withBlaster = buildCatalogue([BLASTER]);

test('answer "the race with Sonic as the character" with the gap layer (V2_GAPS=auto): the gap layer writes the gun; it is checked, played and reported', async () => {
  const requests = [];
  const gapService = { async fill({ doc, request, gap }) { requests.push({ request, gap }); return { ok: true, experiment: { id: 'exp_blaster' }, doc: { ...doc, systems: [...doc.systems, { use: BLASTER.id }] } }; } };
  const catalogue = async doc => (doc?.systems?.some(s => s.use === BLASTER.id) ? withBlaster : cat);
  const { second, out, writer, callsToAsk } = await askThenAnswer(1, { config: { gaps: 'auto' }, gapService, catalogue });
  assert.ok(out.r, out.e?.message);
  assert.equal(requests.length, 1);
  assert.match(requests[0].request, /has a gun/); assert.equal(requests[0].gap.mechanic, 'has a gun');
  const report = second.versions[0].report;
  assert.deepEqual(report.templates, ['race']);
  assert.deepEqual(report.mechanics.map(c => [c.by, c.primitives, c.experiment]), [['gap', [BLASTER.id], 'exp_blaster']]);
  assert.ok(second.versions[0].doc.systems.some(s => s.use === BLASTER.id));
  assert.ok(report.themes.some(t => t.name === 'Sonic the Hedgehog' && t.kind === 'character'), 'Sonic is the character');
  assert.equal(writer.calls.length - callsToAsk, report.modelCalls);
  const row = report.features.table.find(r => r.use === BLASTER.id);
  assert.deepEqual([row.exists, row.controllable, row.verbs.shoot?.works], [true, true, true], JSON.stringify(row));
});

test('the gap layer failing: the build fails naming the mechanic, with the attempt', async () => {
  const gapService = { async fill() { return { ok: false, experiment: { id: 'x' }, problems: ['check_failed'] }; } };
  const { out } = await askThenAnswer(1, { config: { gaps: 'auto' }, gapService });
  assert.equal(out.e.code, 'extension_missing');
  assert.match(out.e.message, /has a gun.*gap layer could not write it/);
});

test('an extension question whose answers keep failing leaves the mechanic missing: the build fails naming it, no gap layer, no content', async () => {
  const inner = sonicWriter();
  const w = { ...inner, calls: [], async complete(req) { w.calls.push(req); return req.schema.name === 'pick_primitive' ? { text: JSON.stringify({ pick: 'a laser', why: '', spec: '' }), ms: 1, model: 'fake' } : inner.complete(req); } };
  let gaps = 0;
  const { out } = await askThenAnswer(0, { writer: w, config: { gaps: 'auto' }, gapService: { async fill() { gaps++; return { ok: false, experiment: {} }; } } });
  assert.equal(out.e.code, 'extension_missing');
  assert.match(out.e.message, /"has a gun".*the extension question failed/);
  assert.equal(gaps, 0, 'a failing answer is not "none fits"');
  assert.ok(!w.calls.some(r => r.schema.name === 'frame_tune'));
});

test('an idea with no extension and no other reading asks nothing more: the pick, then the content round (at most 6 calls, 2 rounds)', async () => {
  const pick = { ...SONIC, readings: [], mechanics: [{ name: 'jumps over pits', says: 'jumps over pits', verb: 'jump', importance: 'core' }] };
  // The pick here, every other form as the Sonic writer answers it.
  const inner = sonicWriter();
  const w = { ...inner, calls: [], async complete(req) { w.calls.push(req); return req.schema.name === 'pick_templates' ? { text: JSON.stringify(pick), ms: 1, model: 'fake' } : inner.complete(req); } };
  const m = memoryCtx();
  await createKernelPipeline({ catalogue: async () => cat, writers: { spec: w } })({ gameId: 'g', prompt: 'Sonic the Hedgehog racing fast cars, he jumps over pits', kind: 'create', seed: 7 }, m.ctx);
  const report = m.versions[0].report;
  assert.deepEqual(report.mechanics.map(c => [c.by, c.primitives]), [['template', ['gameplay.move.platformer']]]);
  assert.equal(report.extensionCalls, 0);
  assert.ok(report.modelCalls <= 6); assert.equal(report.modelRounds, 2);
});

test('the studio flow: the job asks, the failure record keeps the question, POST /answers builds the chosen reading', async () => {
  const svc = createGameService({ root: mkdtempSync(join(os.tmpdir(), 'gv-ext-')), env: { V2_IMPROVE: 'off', V2_DECISIONS: 'off' }, writers: { spec: sonicWriter(), code: null }, decisions: null, improve: null, experiments: null });
  const call = async (method, path, body) => {
    const res = { code: 0, body: null, writeHead(c) { this.code = c; return this; }, end(b) { this.body = b; } };
    try { await svc.handle({ method, url: path }, res, path, async () => body); } catch (error) { return { code: error.status || 500, json: { error: error.message } }; }
    return { code: res.code, json: JSON.parse(res.body) };
  };
  const done = id => new Promise(resolve => { const off = svc.jobs.subscribe(e => { if (e.gameId === id && (e.type === 'job_done' || e.type === 'job_failed')) { off(); resolve(e); } }); });
  const { json: created } = await call('POST', '/api/v2/games', { prompt: IDEA });
  const failed = await done(created.gameId);
  assert.equal(failed.type, 'job_failed'); assert.equal(failed.code, 'needs_answer');
  const { json: record } = await call('GET', `/api/v2/games/${created.gameId}/failures/${failed.failure}`);
  const [q] = record.question.questions;
  assert.equal((await call('POST', `/api/v2/games/${created.gameId}/answers`, { answers: [{ question: q.question, answer: 'something else' }] })).code, 400, 'an answer must be one of the options');
  const finished = done(created.gameId);
  const posted = await call('POST', `/api/v2/games/${created.gameId}/answers`, { answers: [{ question: q.question, answer: q.options[0] }] });
  assert.equal(posted.code, 200);
  assert.equal((await finished).type, 'job_done');
  const { json: game } = await call('GET', `/api/v2/games/${created.gameId}`);
  assert.deepEqual(game.latest.report.mechanics.map(c => c.by), ['extension']);
  assert.deepEqual(game.latest.report.templates, ['platformer', 'race']);
});

test('an extension the gate proves does not work in the game is dropped and its step asked again: the content kept, only the new pick\'s params asked', async () => {
  // A one-on-one fighter: lock-on targeting has no second target to cycle to (the gate's feature check: pressing
  // `cycle` fires none of its events), so the pick is dropped and the step offered again without it.
  const prompt = 'Street Fighter in a kitchen where you can lock on to a rival';
  const PICK = { title: 'Kitchen Brawl', premise: 'Two chefs fight. Win the rounds.', primary: { name: 'Street Fighter', kind: 'game', template: 'fighting' }, games: [], themes: [{ name: 'kitchen', kind: 'setting' }], readings: [],
    mechanics: [{ name: 'lock on to a rival', says: 'lock on to a rival', verb: 'cycle', importance: 'extra' }] };
  const fighter = TEMPLATES.find(t => t.id === 'fighting').doc, asks = [];
  const writer = fakeWriter([req => {
    const name = req.schema.name, props = req.schema.schema.properties;
    if (name === 'pick_templates') return JSON.stringify(PICK);
    if (name === 'pick_primitive') { asks.push({ offered: props.pick.enum, user: req.user }); const pick = ['gameplay.combat.target', 'gameplay.move.dodge'].find(id => props.pick.enum.includes(id)) ?? 'none'; return JSON.stringify({ pick, why: 'it', spec: '' }); }
    if (name === 'pick_category') return JSON.stringify({ pick: 'none', why: '', spec: '' });
    if (name === 'frame_tune') return JSON.stringify(Object.fromEntries(Object.entries(props).map(([k, p]) => { if (k === 'logline') return [k, 'Chefs fight.']; const t = tuneTarget(fighter, String(p.description).split(':')[0], registry); return [k, t.instances[0].with?.[t.param] ?? t.spec.default]; })));
    if (name.startsWith('params_')) return JSON.stringify(nulls(req.schema.schema));
    const names = ps => Object.fromEntries(Object.entries(ps).map(([k, p]) => [k, p.type === 'object' ? names(p.properties) : `Chef ${k}`.slice(0, 40)]));
    return JSON.stringify(names(props));
  }]);
  const m = memoryCtx();
  const out = await createKernelPipeline({ catalogue: async () => cat, writers: { spec: writer } })({ gameId: 'g', prompt, kind: 'create', seed: 1 }, m.ctx).then(r => ({ r }), e => ({ e }));
  assert.ok(out.r, out.e?.message);
  const dropped = m.stages.filter(s => s.name === 'extension_dropped').flatMap(s => s.picks);
  assert.deepEqual(dropped.map(d => [d.mechanic, d.id]), [['lock on to a rival', 'gameplay.combat.target']]);
  assert.match(dropped[0].why, /^feature_inert: gameplay\.combat\.target: pressing 'cycle'/);
  assert.equal(asks.length, 2);
  assert.ok(asks[0].offered.includes('gameplay.combat.target') && !asks[1].offered.includes('gameplay.combat.target'), 'the dropped pick is not offered again');
  assert.match(asks[1].user, /dropped, as they do not work in this game: gameplay\.combat\.target \(feature_inert/);
  const report = m.versions[0].report;
  assert.deepEqual(report.mechanics.map(c => [c.mechanic, c.by, c.option]), [['lock on to a rival', 'extension', 'gameplay.move.dodge']]);
  // Retries redo only what changed: the frame and names forms once, the extension question and params per pick.
  const forms = writer.calls.map(c => c.schema.name);
  assert.deepEqual(forms, ['pick_templates', 'pick_primitive', 'frame_tune', 'names_fighting', 'params_gameplay__combat__target', 'pick_primitive', 'params_gameplay__move__dodge']);
  assert.equal(report.verified, true);
});

test('a mechanic the idea does not name (a theme\'s suggestion) is removed by code before the pick\'s check and reported; nothing is built for it', async () => {
  const pick = { ...SONIC, readings: [], mechanics: [{ name: 'swim', says: 'swim underwater', verb: 'none', importance: 'core' }, { name: 'drive fast', says: 'fast cars', verb: 'none', importance: 'extra' }, GUN] };
  const inner = sonicWriter();
  const w = { ...inner, calls: [], async complete(req) { w.calls.push(req); return req.schema.name === 'pick_templates' ? { text: JSON.stringify(pick), ms: 1, model: 'fake' } : inner.complete(req); } };
  const m = memoryCtx();
  await createKernelPipeline({ catalogue: async () => cat, writers: { spec: w } })({ gameId: 'g', prompt: 'Sonic the Hedgehog racing fast cars, and he has a gun', kind: 'create', seed: 7 }, m.ctx);
  const report = m.versions[0].report;
  assert.deepEqual(report.unnamedMechanics.map(x => [x.name, x.why.split(':')[0]]), [['swim', 'pick_mechanic_unsaid'], ['drive fast', 'pick_mechanic_is_concept']]);
  assert.deepEqual(report.pick.mechanics.map(x => x.name), ['has a gun'], 'the one the idea names is kept');
  assert.deepEqual(report.mechanics.map(c => [c.mechanic, c.by]), [['has a gun', 'extension']]);
  assert.equal(w.calls.filter(r => r.schema.name === 'pick_templates').length, 1, 'no re-ask for it');
});

test('a reading no rule admits (the primary read as a character with no other game to play) is removed by code before the check and reported; a valid one is still asked', async () => {
  // The live pick for "can I have a Mario game but with sonic as the character" listed the primary itself as a character.
  const MARIO = { title: 'Sonic in Mario', premise: 'Sonic runs Mario\'s levels.', primary: { name: 'Mario game', kind: 'game', template: 'platformer' }, games: [], themes: [{ name: 'sonic', kind: 'character' }],
    readings: [{ name: 'Mario game', kind: 'character', template: 'none', relation: 'none' }], mechanics: [] };
  const inner = sonicWriter();
  const w = { ...inner, calls: [], async complete(req) { w.calls.push(req); return req.schema.name === 'pick_templates' ? { text: JSON.stringify(MARIO), ms: 1, model: 'fake' } : inner.complete(req); } };
  const m = memoryCtx();
  await createKernelPipeline({ catalogue: async () => cat, writers: { spec: w } })({ gameId: 'g', prompt: 'can I have a Mario game but with sonic as the character', kind: 'create', seed: 7 }, m.ctx);
  const report = m.versions[0].report;
  assert.deepEqual(report.invalidReadings.map(x => [x.name, x.kind, x.why.split(':')[0]]), [['Mario game', 'character', 'pick_reading_no_primary']]);
  assert.deepEqual(report.pick.readings, []);
  assert.equal(w.calls.filter(r => r.schema.name === 'pick_templates').length, 1, 'no re-ask for it');
  // A valid other reading is still the player's question (the Sonic idea above asks which game).
  const valid = await createKernelPipeline({ catalogue: async () => cat, writers: { spec: sonicWriter() } })({ gameId: 'g', prompt: IDEA, kind: 'create', seed: 7 }, memoryCtx().ctx).then(() => null, e => e);
  assert.equal(valid?.code, 'needs_answer');
});

test('extension rules are declared', () => { assert.deepEqual(Object.keys(EXTEND_RULES), ['extension_missing', 'extension_unengaged', 'extension_unusable', 'extension_params']); });

const timings = {};
test('timings (AGENTS.md: reported, not budgeted)', t => { t.diagnostic(JSON.stringify(timings)); });
