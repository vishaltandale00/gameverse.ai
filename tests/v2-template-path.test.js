// The template path (ARCHITECTURE.md §5, v2/planner/templates.js and kernel-pipeline.js create): one strict pick,
// composition by code, parallel strict content forms derived from the composed document, the publish gate. Fake
// writers only (no network). The idea fixtures are one line per template id: a template added to v2/templates
// (farm, dungeon...) is covered by adding its line to IDEAS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, templateById } from '../v2/templates/index.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { createKernelPipeline } from '../v2/planner/kernel-pipeline.js';
import {
  pickForm, checkPick, composeTemplates, namedSections, namesForm, frameTuneForm, writeContent, askPick, tuneTarget, offeredTemplates,
  PICK_KINDS, RELATIONS, NAME_PATTERN,
} from '../v2/planner/templates.js';
import { fakeWriter, mazeWriter } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();
const cat = { registry, logic };

/** One line per template: the idea, the game it names, and its themes as [name, kind]. */
const IDEAS = {
  'maze-chase': { idea: 'Pac-Man in a haunted library', game: 'Pac-Man', themes: [['haunted library', 'setting']] },
  race: { idea: 'Mario Kart with shopping carts', game: 'Mario Kart', themes: [['shopping carts', 'theme']] },
};
test('every template has an idea fixture', () => assert.deepEqual(TEMPLATES.map(t => t.id).filter(id => !IDEAS[id]), []));

const pickOf = id => ({ title: `${IDEAS[id].game} Remix`, premise: `${IDEAS[id].idea}. Win the game.`,
  concepts: [{ name: IDEAS[id].game, kind: 'game', template: id, relation: 'primary' }, ...IDEAS[id].themes.map(([name, kind]) => ({ name, kind, template: 'none', relation: 'theme' }))] });
const concept = (name, kind, template, relation) => ({ name, kind, template, relation });
const theme = id => IDEAS[id].themes[0][0];
/** A slot's tune path (its description starts with it). */
const slotPath = p => String(p.description).split(':')[0];

/** A reply function for one template's forms: the pick, each tune param at its current value, names from `nameFor`. */
function replies(id, nameFor = k => `${theme(id)} ${k}`.slice(0, 40)) {
  const t = templateById(id);
  return req => {
    const name = req.schema.name, props = req.schema.schema.properties;
    if (name === 'pick_templates') return JSON.stringify(pickOf(id));
    if (name === 'frame_tune') return JSON.stringify(Object.fromEntries(Object.entries(props).map(([k, p]) => {
      if (k === 'logline') return [k, `${IDEAS[id].game} in ${theme(id)}.`];
      const target = tuneTarget(t.doc, slotPath(p), registry);
      return [k, target.instances[0].with?.[target.param] ?? target.spec.default];
    })));
    return JSON.stringify(Object.fromEntries(Object.keys(props).map(k => [k, nameFor(k, req)])));
  };
}
/** A fake model for one template's idea. */
const ideaWriter = id => fakeWriter([replies(id)]);

function memoryCtx() {
  const versions = [], stages = [], checkpoints = {};
  return { versions, stages, checkpoints, ctx: {
    stage(name, detail = {}) { stages.push({ name, ...detail }); }, draft() {}, checkpoint(name, value) { checkpoints[name] = value; },
    async publish(p) { const r = { version: versions.length + 1, ...p }; versions.push(r); return r; },
    store: { async updateMeta() {}, async version(_, v) { return versions[v - 1]; } },
  } };
}

/** What OpenAI strict json_schema accepts: closed objects, every property required. */
function strictProblems(schema, path = '$', out = []) {
  if (schema.anyOf) schema.anyOf.forEach((s, i) => strictProblems(s, `${path}|${i}`, out));
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) out.push(`${path}: open object`);
    const keys = Object.keys(schema.properties || {});
    if (JSON.stringify([...(schema.required || [])].sort()) !== JSON.stringify([...keys].sort())) out.push(`${path}: not every property required`);
    for (const k of keys) { if (k.endsWith('_json')) out.push(`${path}.${k}: free JSON`); strictProblems(schema.properties[k], `${path}.${k}`, out); }
  }
  if (schema.type === 'array') strictProblems(schema.items, `${path}[]`, out);
  return out;
}
/** Does a value satisfy a strict schema (the dialect the forms use)? */
function accepts(s, v) {
  if (s.anyOf) return s.anyOf.some(x => accepts(x, v));
  if (s.type === 'null') return v === null;
  if (s.enum && !s.enum.includes(v)) return false;
  if (s.type === 'string') return typeof v === 'string' && (!s.pattern || new RegExp(s.pattern, 'u').test(v));
  if (s.type === 'boolean') return typeof v === 'boolean';
  if (s.type === 'number' || s.type === 'integer') return typeof v === 'number' && Number.isFinite(v) && (s.type !== 'integer' || Number.isInteger(v)) && (s.minimum === undefined || v >= s.minimum) && (s.maximum === undefined || v <= s.maximum);
  if (s.type === 'array') return Array.isArray(v) && v.every(x => accepts(s.items, x));
  if (s.type === 'object') return v && typeof v === 'object' && Object.keys(v).every(k => k in s.properties) && s.required.every(k => k in v && accepts(s.properties[k], v[k]));
  return false;
}

test('pickForm: one strict form, every property required, enums exactly the kinds, template ids and relations, no free JSON', () => {
  const f = pickForm(TEMPLATES);
  assert.equal(f.name, 'pick_templates');
  assert.deepEqual(strictProblems(f.schema), []);
  assert.deepEqual(Object.keys(f.schema.properties), ['title', 'premise', 'concepts']);
  const c = f.schema.properties.concepts.items.properties;
  assert.deepEqual(Object.keys(c), ['name', 'kind', 'template', 'relation']);
  assert.deepEqual(c.kind.enum, ['game', 'genre', 'theme', 'setting', 'character']);
  assert.deepEqual(c.template.enum, [...TEMPLATES.map(t => t.id), 'none']);
  assert.deepEqual(c.relation.enum, ['primary', 'nested', 'union', 'theme']);
  assert.deepEqual([...PICK_KINDS], c.kind.enum); assert.deepEqual([...RELATIONS], c.relation.enum);
  for (const k of ['title', 'premise']) assert.ok(f.schema.properties[k].pattern, `${k} must be written`);
  // The templates offered are those the catalogue can compose.
  assert.deepEqual(offeredTemplates(TEMPLATES, registry).map(t => t.id), TEMPLATES.map(t => t.id));
  assert.deepEqual(offeredTemplates(TEMPLATES, { has: () => false }), []);
});

test('checkPick: stable codes for every rule, a none game concept goes to the step path', () => {
  const ctx = { templates: TEMPLATES, registry };
  const codes = pick => checkPick({ title: 'T', premise: 'P.', ...pick }, ctx).problems.map(p => `${p.code}@${p.field}`);
  assert.deepEqual(codes(pickOf('maze-chase')), []);
  assert.deepEqual(codes({ concepts: [] }), ['pick_concepts_missing@concepts']);
  assert.deepEqual(checkPick({ title: ' ', premise: '', concepts: pickOf('race').concepts }, ctx).problems.map(p => p.code), ['pick_title_missing', 'pick_premise_missing']);
  assert.deepEqual(codes({ concepts: [concept('Pac-Man', 'game', 'maze-chase', 'theme')] }), ['pick_game_relation@concepts[0].relation', 'pick_primary_count@concepts']);
  assert.deepEqual(codes({ concepts: [concept('Pac-Man', 'game', 'maze-chase', 'primary'), concept('Mario Kart', 'game', 'race', 'primary')] }), ['pick_primary_count@concepts']);
  assert.deepEqual(codes({ concepts: [concept('library', 'setting', 'none', 'primary')] }), ['pick_theme_relation@concepts[0].relation', 'pick_primary_kind@concepts[0]']);
  assert.deepEqual(codes({ concepts: [concept('Pac-Man', 'game', 'maze-chase', 'primary'), concept('library', 'setting', 'none', 'nested')] }), ['pick_theme_relation@concepts[1].relation']);
  assert.deepEqual(codes({ concepts: [concept('Pac-Man', 'game', 'maze-chase', 'primary'), concept('library', 'setting', 'race', 'theme')] }), ['pick_theme_template@concepts[1].template']);
  assert.deepEqual(codes({ concepts: [concept('Pac-Man', 'game', 'pacman', 'primary')] }), ['pick_template_unknown@concepts[0].template']);
  assert.deepEqual(codes({ concepts: [concept('Pac-Man', 'arcade', 'maze-chase', 'primary')] }), ['pick_kind_unknown@concepts[0].kind']);
  assert.deepEqual(codes({ concepts: [concept('Pac-Man', 'game', 'maze-chase', 'main')] }), ['pick_relation_unknown@concepts[0].relation', 'pick_primary_count@concepts']);
  assert.deepEqual(codes({ concepts: [concept('', 'game', 'maze-chase', 'primary')] }), ['pick_concept_name_missing@concepts[0].name']);
  // nested only onto a primary whose loops declare an entry event (card.loop.involves): the race's declare none.
  assert.deepEqual(codes({ concepts: [concept('Mario Kart', 'game', 'race', 'primary'), concept('Pac-Man', 'game', 'maze-chase', 'nested')] }), ['pick_nested_no_entry@concepts[1].relation']);
  assert.deepEqual(codes({ concepts: [concept('Pac-Man', 'game', 'maze-chase', 'primary'), concept('Mario Kart', 'game', 'race', 'nested')] }), []);
  // A game or genre no template is: the step path, not a problem.
  const step = checkPick({ title: 'T', premise: 'P.', concepts: [concept('Tetris', 'game', 'none', 'primary'), concept('space', 'setting', 'none', 'theme')] }, ctx);
  assert.deepEqual(step, { problems: [], stepPath: ['Tetris'] });
  assert.deepEqual(checkPick({ title: 'T', premise: 'P.', concepts: [concept('Pac-Man', 'game', 'maze-chase', 'primary'), concept('roguelike', 'genre', 'none', 'union')] }, ctx).stepPath, ['roguelike']);
});

for (const t of TEMPLATES) test(`compose ${t.id} + theme: the template's document, the pick's title and premise, the theme kept for the content forms`, () => {
  const before = structuredClone(t.doc);
  const c = composeTemplates(pickOf(t.id), { templates: TEMPLATES, registry });
  assert.deepEqual(c.problems, []); assert.deepEqual(c.stepPath, []);
  assert.equal(c.template, t);
  assert.deepEqual(c.themes, IDEAS[t.id].themes.map(([name, kind]) => ({ name, kind })));
  const { title, plot, ...rest } = c.doc, { title: _, plot: tplot, ...trest } = t.doc;
  assert.deepEqual(rest, trest, 'structure is the template\'s, untouched');
  assert.equal(title, pickOf(t.id).title);
  assert.deepEqual(plot, { ...(tplot || {}), premise: pickOf(t.id).premise });
  assert.deepEqual(t.doc, before, 'the template itself is never mutated');
  assert.ok(preflight(structuredClone(c.doc), registry, logic).ok);
});

test('nested and union fail loudly with composition_pending, naming the relation, both templates and the missing composition', () => {
  const ctx = { templates: TEMPLATES, registry };
  const nested = composeTemplates({ title: 'T', premise: 'P.', concepts: [concept('Pac-Man', 'game', 'maze-chase', 'primary'), concept('Mario Kart', 'game', 'race', 'nested'), concept('library', 'setting', 'none', 'theme')] }, ctx);
  assert.equal(nested.doc, null);
  assert.deepEqual(nested.problems.map(p => [p.code, p.path]), [['composition_pending', 'concepts[1]']]);
  for (const s of ['nested', "'race'", "'maze-chase'", 'engine.adapt.nested', 'not yet implemented']) assert.ok(nested.problems[0].message.includes(s), `${s}: ${nested.problems[0].message}`);
  const union = composeTemplates({ title: 'T', premise: 'P.', concepts: [concept('Mario Kart', 'game', 'race', 'primary'), concept('Pac-Man', 'game', 'maze-chase', 'union')] }, ctx);
  assert.equal(union.doc, null);
  assert.deepEqual(union.problems.map(p => p.code), ['composition_pending']);
  for (const s of ['union', "'race'", "'maze-chase'", 'not yet implemented']) assert.ok(union.problems[0].message.includes(s), `${s}: ${union.problems[0].message}`);
});

test('content forms: one strict names form per named section of the composed document (ids fixed by code), plus frame_tune', () => {
  const expected = { 'maze-chase': ['content_archetypes', 'content_statuses', 'content_blocks'], race: ['content_archetypes', 'zones_circuit'] };
  for (const t of TEMPLATES) {
    const doc = composeTemplates(pickOf(t.id), { templates: TEMPLATES, registry }).doc;
    const sections = namedSections(doc);
    if (expected[t.id]) assert.deepEqual(sections.map(s => s.form), expected[t.id]);
    for (const s of sections) {
      const f = namesForm(s);
      assert.deepEqual(strictProblems(f.schema.schema), []);
      assert.deepEqual(Object.keys(f.schema.schema.properties), s.entries.map(e => e.id), `${s.form}: a slot per existing id`);
      for (const p of Object.values(f.schema.schema.properties)) assert.deepEqual([p.type, p.pattern], ['string', NAME_PATTERN]);
      assert.deepEqual(f.check(f.narrow(Object.fromEntries(s.entries.map(e => [e.id, 'x'.repeat(40)])))), []);
      assert.deepEqual(f.check(f.narrow(Object.fromEntries(s.entries.map((e, i) => [e.id, i ? 'Ok' : 'x'.repeat(41)])))).map(p => [p.code, p.field]), [['name_invalid', s.entries[0].id]]);
      assert.equal(accepts(f.schema.schema.properties[s.entries[0].id], ''), false); assert.equal(accepts(f.schema.schema.properties[s.entries[0].id], 'x'.repeat(41)), false);
    }
    const frame = frameTuneForm(t, doc, cat);
    assert.deepEqual(strictProblems(frame.schema.schema), []);
    assert.deepEqual(frame.slots.map(s => s.path), t.tune);
  }
});

test('content forms are asked in parallel; a failing name re-asks only that field, then escalates that form once', async () => {
  const t = templateById('maze-chase'), doc = composeTemplates(pickOf(t.id), { templates: TEMPLATES, registry }).doc;
  let inFlight = 0, most = 0;
  const base = ideaWriter(t.id);
  const writer = { ...base, async complete(req) { inFlight++; most = Math.max(most, inFlight); await new Promise(r => setTimeout(r, 20)); inFlight--; return base.complete(req); } };
  const calls = [];
  const r = await writeContent({ writer, escalate: null, attempts: 2, template: t, doc, pick: pickOf(t.id), themes: [{ name: 'haunted library', kind: 'setting' }], registry, logic, calls, clock: { codeMs: 0 } });
  assert.equal(most, 4, 'frame_tune and the three names forms are in flight together');
  assert.equal(r.rounds, 1);
  assert.equal(r.doc.content.archetypes.find(a => a.id === 'hero').name, 'haunted library hero');
  assert.equal(r.doc.logline, 'Pac-Man in haunted library.');
  for (const c of base.calls) assert.match(c.system, /haunted library \(setting\)/), assert.match(c.system, /Premise: Pac-Man in a haunted library/);
  // A bad name: only that field is asked again; still bad, the escalation writer gets that form alone.
  const bad = fakeWriter([replies(t.id, k => (k === 'hero' || k.startsWith('field_') ? '' : 'Fine'))]);
  const code = fakeWriter([req => JSON.stringify(Object.fromEntries(Object.keys(req.schema.schema.properties).map(k => [k, 'Ghost Reader'])))], { model: 'escalation' });
  const c2 = [];
  const r2 = await writeContent({ writer: bad, escalate: code, attempts: 2, template: t, doc, pick: pickOf(t.id), themes: [], registry, logic, calls: c2, clock: { codeMs: 0 } });
  const arch = c2.filter(c => c.form === 'content_archetypes');
  assert.deepEqual(arch.map(c => [c.fields ?? null, Boolean(c.escalated)]), [[null, false], [['hero'], false], [['hero'], true]]);
  assert.equal(code.calls.length, 1); assert.deepEqual(Object.keys(code.calls[0].schema.schema.properties), ['field_1']);
  assert.equal(r2.doc.content.archetypes.find(a => a.id === 'hero').name, 'Ghost Reader');
  assert.equal(r2.doc.content.archetypes.find(a => a.id === 'pellet').name, 'Fine', 'answers that passed are kept');
  assert.equal(r2.rounds, 3);
});

test('tune slots conform to their card specs across all templates: every declared value is allowed and preflights; out of range is not allowed', () => {
  for (const t of TEMPLATES) {
    const doc = composeTemplates(pickOf(t.id), { templates: TEMPLATES, registry }).doc;
    const frame = frameTuneForm(t, doc, cat);
    const current = Object.fromEntries(frame.slots.map(s => [s.key, tuneTarget(doc, s.path, registry).instances[0].with?.[s.param] ?? s.spec.default]));
    const answer = (key, value) => ({ logline: 'A line.', ...current, [key]: value });
    for (const s of frame.slots) {
      const slot = frame.schema.schema.properties[s.key], spec = s.spec;
      assert.equal(slot.type, spec.type === 'integer' ? 'integer' : spec.type, `${t.id} ${s.path}: type`);
      /** Values the card allows: its bounds, a midpoint, its default, every option. */
      let allowed = [];
      if (spec.type === 'number' || spec.type === 'integer') {
        assert.equal(slot.minimum, spec.min, `${s.path}: minimum`); assert.equal(slot.maximum, spec.max, `${s.path}: maximum`);
        const mid = (spec.min + spec.max) / 2;
        allowed = [spec.min, spec.max, spec.type === 'integer' ? Math.round(mid) : mid, spec.default].filter(v => v !== undefined);
        for (const out of [spec.min - 1, spec.max + 1, ...(spec.type === 'integer' ? [spec.min + 0.5] : [])]) assert.equal(accepts(slot, out), false, `${t.id} ${s.path}: ${out} is outside the card's range, so the form does not allow it`);
      } else if (spec.type === 'boolean') allowed = [true, false];
      else if (spec.type === 'string' && spec.options?.length) { assert.deepEqual(slot.enum, spec.options.map(String)); allowed = spec.options; assert.equal(accepts(slot, '__undeclared__'), false); }
      else if (spec.type === 'string') allowed = [spec.default, current[s.key]].filter(v => v !== undefined);
      else assert.fail(`${t.id} ${s.path}: tune params are scalars (${spec.type})`);
      assert.ok(allowed.length, `${t.id} ${s.path}: sampled`);
      for (const v of allowed) {
        assert.ok(accepts(slot, v), `${t.id} ${s.path}: the form allows ${JSON.stringify(v)}`);
        assert.deepEqual(frame.check(frame.narrow(answer(s.key, v))), [], `${t.id} ${s.path}=${JSON.stringify(v)} preflights`);
      }
      // A free-text param (no declared set): any value preflight rejects comes back as that slot's problem, never into the document.
      if (spec.type === 'string' && !spec.options?.length) {
        const problems = frame.check(frame.narrow(answer(s.key, '__undeclared__')));
        assert.ok(problems.every(p => p.field === s.key), `${t.id} ${s.path}: ${JSON.stringify(problems)}`);
      }
    }
  }
});

test('the pick: a failing field is re-asked alone, then the escalation writer once, then 422 template_pick_failed with the problems', async () => {
  const bad = { title: 'T', premise: 'P.', concepts: [concept('Pac-Man', 'game', 'maze-chase', 'primary'), concept('library', 'setting', 'none', 'primary')] };
  const w = fakeWriter([JSON.stringify(bad)]), code = fakeWriter([JSON.stringify({ field_1: bad.concepts })], { model: 'escalation' });
  const calls = [];
  await assert.rejects(askPick({ writer: w, escalate: code, attempts: 2, prompt: 'Pac-Man in a haunted library', templates: TEMPLATES, registry, calls, clock: { codeMs: 0 } }),
    e => e.status === 422 && e.code === 'template_pick_failed' && e.problems.some(p => p.code === 'pick_theme_relation'));
  // The failing fields are concepts[1].relation, concepts[1] and concepts: the list holds the others, so it is the one slot re-asked.
  assert.deepEqual(calls.map(c => [c.fields ?? null, Boolean(c.escalated)]), [[null, false], [['concepts'], false], [['concepts'], true]]);
  assert.deepEqual(Object.keys(w.calls[1].schema.schema.properties), ['field_1'], 'the re-ask holds only the failing field');
  assert.match(w.calls[0].system, /- maze-chase: Maze chase/); assert.match(w.calls[0].system, /- race: Racing/);
  // A field re-ask that fixes it: the pick passes with the other answers kept.
  const fixed = fakeWriter([JSON.stringify(bad), JSON.stringify({ field_1: [bad.concepts[0], { ...bad.concepts[1], relation: 'theme' }] })]);
  const ok = await askPick({ writer: fixed, escalate: null, attempts: 2, prompt: 'x', templates: TEMPLATES, registry, calls: [], clock: { codeMs: 0 } });
  assert.deepEqual(ok.pick.concepts.map(c => c.relation), ['primary', 'theme']);
  assert.equal(ok.calls, 2);
});

for (const id of Object.keys(IDEAS)) test(`create "${IDEAS[id].idea}": the template path publishes ${id} + theme in at most 6 calls and 2 rounds`, async () => {
  const writer = ideaWriter(id);
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec: writer } });
  const m = memoryCtx();
  const out = await pipeline({ gameId: 'g', prompt: IDEAS[id].idea, kind: 'create', seed: 11 }, m.ctx);
  assert.equal(m.versions.length, 1);
  const v = m.versions[0], report = v.report;
  assert.equal(v.stage, 'first_playable');
  assert.equal(report.path, 'template'); assert.deepEqual(report.templates, [id]);
  assert.equal(report.verified, true);
  assert.ok(report.modelCalls <= 6, `${report.modelCalls} calls`); assert.equal(report.modelCalls, writer.calls.length);
  assert.equal(report.modelRounds, 2);
  assert.ok(report.timings.composeMs < 1000, `composition ${report.timings.composeMs} ms`);
  for (const k of ['pickMs', 'contentMs', 'composeMs', 'gateMs', 'requestToFirstPlayableMs']) assert.equal(typeof report.timings[k], 'number', k);
  const fp = m.stages.find(s => s.name === 'first_playable');
  assert.deepEqual([fp.modelCalls, fp.modelRounds], [report.modelCalls, report.modelRounds]);
  assert.ok(!m.stages.some(s => s.name === 'decomposing' || s.name === 'detail'), 'no step path, no detail tasks');
  assert.equal(v.doc.title, pickOf(id).title); assert.equal(v.doc.seed, 11);
  assert.ok(v.doc.content.archetypes.every(a => a.name.startsWith(theme(id))), 'every archetype is named for the theme');
  assert.deepEqual(v.doc.systems.map(s => s.use), templateById(id).doc.systems.map(s => s.use), 'the template\'s structure, nothing added or dropped');
  assert.equal(out.path, 'template');
});

test('a pick with a game concept no template is runs the step path for the whole idea, and says so', async () => {
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec: mazeWriter() }, config: { maxDetailTasks: 0 } });
  const m = memoryCtx();
  await pipeline({ gameId: 'g', prompt: 'collect coins in a maze', kind: 'create', seed: 5 }, m.ctx);
  const v = m.versions[0];
  assert.equal(v.report.path, 'step');
  assert.deepEqual(v.report.templatePick.stepPath, ['coin maze']);
  assert.match(v.report.why, /no template is 'coin maze'/);
  assert.equal(typeof v.report.timings.pickMs, 'number');
  assert.ok(m.stages.some(s => s.name === 'decomposing'));
});
