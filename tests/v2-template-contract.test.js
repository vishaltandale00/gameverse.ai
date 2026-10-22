// The template contract (v2/templates/contract.js) and discovery (v2/templates/registry.js): every discovered template
// passes checkTemplate against the live catalogue (promoted primitives included), and a copy broken for each check
// fails it with that check's stable code. Discovery finds every template module and promoted file without a hand list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { checkTemplate, formatProblems, tuneProblems, boundsProblems, boundValues, CODES, STAGES, SEEDS } from '../v2/templates/contract.js';
import { tuneRanges, tuneTarget, tunedSpec } from '../v2/planner/templates.js';
import { TEMPLATES, templateById, loadTemplates, promotedTemplates, PROMOTED_SCHEMA, INFRASTRUCTURE } from '../v2/templates/registry.js';
import { readdirSync } from 'node:fs';
import { liveCatalogue, buildCatalogue } from '../v2/planner/catalog.js';
import { PRIMITIVES } from '../v2/primitives/index.js';

const live = await liveCatalogue();
const farm = templateById('farm');
const broken = (base, change) => { const t = structuredClone(base); change(t); return t; };
const codes = r => r.problems.map(p => p.code);
const tmp = mkdtempSync(join(os.tmpdir(), 'gv-templates-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

test('contract: stages in order, every code stable and owned by one stage', () => {
  assert.deepEqual(STAGES, ['format', 'tune', 'preflight', 'composition', 'loop', 'presentation', 'gate', 'controls', 'features', 'bots', 'bounds']);
  const all = Object.values(CODES).flat();
  assert.equal(new Set(all).size, all.length, 'no code belongs to two stages');
  assert.deepEqual(SEEDS, [1, 2, 3]);
});

test('discovery: every template module is discovered (no hand list); ids are unique', () => {
  const files = readdirSync(new URL('../v2/templates/', import.meta.url)).filter(f => f.endsWith('.js') && !INFRASTRUCTURE.includes(f));
  assert.equal(TEMPLATES.length, files.length, `registry.js discovers every template module (${files.join(', ')})`);
  assert.equal(new Set(TEMPLATES.map(t => t.id)).size, TEMPLATES.length);
  for (const t of TEMPLATES) assert.equal(templateById(t.id), t);
  assert.equal(templateById('none'), null);
  assert.deepEqual(INFRASTRUCTURE, ['registry.js', 'contract.js']);
});

test('discovery: modules and promoted files are found without a list; malformed ones and duplicate modules throw', async () => {
  const dir = join(tmp, 'disc'), promoted = join(dir, 'promoted');
  mkdirSync(dir, { recursive: true });
  const mod = t => `export default ${JSON.stringify(t)};\n`;
  writeFileSync(join(dir, 'farm-copy.js'), mod({ ...structuredClone(farm), id: 'farm-copy', doc: { ...farm.doc, id: 'farm-copy' } }));
  writeFileSync(join(dir, 'contract.js'), 'export const checkTemplate = () => ({ ok: true });\n');
  assert.deepEqual((await loadTemplates({ dir })).map(t => t.id), ['farm-copy'], 'no promoted directory: none promoted; infrastructure files are not templates');
  mkdirSync(promoted);
  const file = t => JSON.stringify({ schema: PROMOTED_SCHEMA, template: t, provenance: { job: 'test' } });
  writeFileSync(join(promoted, 'farm-copy.json'), file({ ...structuredClone(farm), id: 'farm-copy', doc: { ...farm.doc, id: 'farm-copy' }, concept: 'A promoted duplicate of a module id.' }));
  writeFileSync(join(promoted, 'farm-two.json'), file({ ...structuredClone(farm), id: 'farm-two', doc: { ...farm.doc, id: 'farm-two' } }));
  const found = await loadTemplates({ dir });
  assert.deepEqual(found.map(t => t.id), ['farm-copy', 'farm-two']);
  assert.equal(found[0].concept, farm.concept, 'a promoted template whose id a module has is the module\'s');
  writeFileSync(join(promoted, 'farm-three.json'), file({ ...structuredClone(farm), id: 'farm-two', doc: { ...farm.doc, id: 'farm-two' } }));
  assert.throws(() => promotedTemplates(promoted), /farm-three\.json: its id is 'farm-two'/);
  rmSync(join(promoted, 'farm-three.json'));
  writeFileSync(join(promoted, 'bad.json'), file({ id: 'bad', concept: 'x', doc: {}, tune: [] }));
  await assert.rejects(loadTemplates({ dir }), e => e.code === 'template_invalid' && e.problems.some(p => p.code === 'template_concept_invalid'));
  rmSync(join(promoted, 'bad.json'));
  writeFileSync(join(dir, 'again.js'), mod({ ...structuredClone(farm), id: 'farm-copy', doc: { ...farm.doc, id: 'farm-copy' } }));
  await assert.rejects(loadTemplates({ dir }), e => e.code === 'template_duplicate');
});

// The bounds stage plays every bound of every template's tune: its runs are sharded over the files
// tests/v2-template-bounds-<n>.test.js so they run beside this one.
for (const t of TEMPLATES) test(`contract: template ${t.id} passes every check through the bots against the live catalogue`, async tc => {
  const r = await checkTemplate(t, live, { through: 'bots' });
  // With a person's hands (HUMAN_INPUT): which templates only a hand faster than a person's wins (evidence, reported).
  for (const b of r.evidence.bots) tc.diagnostic(`human-rate ${b.humanRate}/s: ${b.id} ${(b.human || []).map(h => `seed ${h.seed} ${h.status}`).join(', ')}`);
  assert.deepEqual(r.problems, [], `${t.id}: ${JSON.stringify(r.problems).slice(0, 800)}`);
  assert.deepEqual(Object.keys(r.evidence.stages), STAGES.slice(0, STAGES.indexOf('bots') + 1), 'every stage through the bots ran');
  assert.ok(r.evidence.bots.length && r.evidence.bots.every(b => b.runs.map(x => x.seed).join() === SEEDS.join()), JSON.stringify(r.evidence.bots));
});

test('contract format: each malformed field has its code, and nothing past format runs', async () => {
  const cases = [
    [broken(farm, t => { t.id = 'Farm Two'; t.doc.id = 'Farm Two'; }),'template_id_invalid'],
    [broken(farm, t => { t.id = 'none'; t.doc.id = 'none'; }), 'template_id_reserved'],
    [broken(farm, t => { t.concept = 'Farming.\nTwo lines.'; }), 'template_concept_invalid'],
    [broken(farm, t => { t.doc.schema = 'gameverse.v2.game/0.1'; }), 'template_doc_invalid'],
    [broken(farm, t => { t.doc.id = 'other'; }), 'template_doc_id_mismatch'],
    [broken(farm, t => { t.tune = ['gameplay.farming.daySec', 'gameplay.farming.daySec']; }), 'template_tune_invalid'],
  ];
  for (const [t, code] of cases) {
    const r = await checkTemplate(t, live);
    assert.deepEqual(codes(r), [code], `${code}: ${JSON.stringify(r.problems)}`);
    assert.deepEqual(Object.keys(r.evidence.stages), ['format']);
  }
  assert.deepEqual(formatProblems(null).map(p => p.code), ['template_shape']);
});

test('contract tune: a path naming no declared param, a non-scalar param, or several instances', async () => {
  const cases = [
    [broken(farm, t => { t.tune = ['gameplay.farming.speed']; }), 'tune_unknown'],
    [broken(farm, t => { t.tune = ['gameplay.farming.crops']; }), 'tune_not_scalar'],
    [broken(farm, t => { t.doc.systems.push({ use: 'gameplay.farming', with: { ...t.doc.systems.find(s => s.use === 'gameplay.farming').with } }); }), 'tune_ambiguous'],
  ];
  for (const [t, code] of cases) assert.deepEqual(codes(await checkTemplate(t, live)), [code]);
});

test('contract tune: a playable range narrows the card\'s, is finite and holds the template\'s own value', () => {
  const dungeon = templateById('dungeon'), rooms = 'engine.generate.dungeon.rooms.rooms';
  const tune = entries => broken(dungeon, t => { t.tune = entries; });
  const cases = [
    [[{ path: rooms, min: 2, max: 12 }], 'tune_range_invalid'], // below the card's min 3
    [[{ path: rooms, min: 4, max: 100 }], 'tune_range_invalid'], // above the card's max 80
    [[{ path: rooms, min: 9, max: 4 }], 'tune_range_invalid'],
    [[{ path: rooms, min: 4.5, max: 9 }], 'tune_range_invalid'], // an integer's bounds are integers
    [[{ path: 'gameplay.death.lives', options: ['a'] }], 'tune_range_invalid'],
    [[{ path: rooms, min: 10, max: 12 }], 'tune_value_outside'], // the template's 8 rooms
  ];
  for (const [entries, code] of cases) assert.deepEqual(tuneProblems(tune(entries), live.registry).map(p => p.code), [code], JSON.stringify(entries));
  assert.deepEqual(tuneProblems(broken(farm, t => { t.tune = ['gameplay.farming.daySec']; }), live.registry).map(p => p.code), ['tune_unbounded'], 'daySec has no max on its card: the template declares its playable range');
  assert.deepEqual(formatProblems(tune([{ path: rooms }])).map(p => p.code), ['template_tune_invalid'], 'a range entry names a range');
  assert.deepEqual(formatProblems(tune([{ path: rooms, min: 4, step: 2 }])).map(p => p.code), ['template_tune_invalid']);
});

test('contract tune: every template\'s tune slots allow exactly its playable range, every bound of which the bounds stage plays', () => {
  for (const t of TEMPLATES) for (const range of tuneRanges(t)) {
    const target = tuneTarget(t.doc, range.path, live.registry), values = boundValues(tunedSpec(target.spec, range));
    assert.ok(values?.length, `${t.id} ${range.path}: a finite playable range`);
    if (range.min !== undefined) assert.ok(values.includes(range.min), `${t.id} ${range.path}: its declared min is a bound`);
    if (range.max !== undefined) assert.ok(values.includes(range.max), `${t.id} ${range.path}: its declared max is a bound`);
  }
});

test('contract bounds: a bound that breaks a declared cross-field rule fails bound_invalid; one the bot cannot win fails bound_not_won', () => {
  const dungeon = templateById('dungeon');
  // Two keys need at least four rooms (engine.generate.dungeon.rooms card.rules dungeon_keys_many).
  const rooms = broken(dungeon, t => { t.tune = [{ path: 'engine.generate.dungeon.rooms.rooms', min: 3, max: 8 }]; });
  const ev = { bounds: [] }, p = boundsProblems(rooms, live.registry, live.logic, ev);
  assert.deepEqual(p.map(x => `${x.code}:${x.cause}:${x.value}`), ['bound_invalid:dungeon_keys_many:3'], JSON.stringify(p));
  assert.deepEqual(ev.bounds.map(b => [b.value, b.ok]), [[3, false]], 'the template\'s own value is not replayed');
  // Rivals faster than the karts can be beaten (the race template's playable range stops below this).
  const fast = broken(templateById('race'), t => { t.tune = [{ path: 'gameplay.ai.seek.speed', min: 16, max: 40 }]; });
  const lost = boundsProblems(fast, live.registry, live.logic, { bounds: [] });
  assert.ok(lost.length && lost.every(x => x.code === 'bound_not_won' && x.value === 40), JSON.stringify(lost).slice(0, 400));
});

test('contract static stages: preflight, composition and loop failures stop the check before anything simulates', async () => {
  const pre = await checkTemplate(broken(farm, t => { t.doc.plot.endings = []; }), live);
  assert.ok(pre.problems.length && pre.problems.every(p => p.code === 'preflight_failed' && p.cause), JSON.stringify(pre.problems));
  const comp = await checkTemplate(broken(farm, t => { t.doc.spaces[0].generators = []; t.tune = [{ path: 'gameplay.farming.daySec', min: 3, max: 20 }]; }), live);
  assert.deepEqual([...new Set(codes(comp))], ['composition_failed'], JSON.stringify(comp.problems));
  const loop = await checkTemplate(broken(farm, t => { t.doc.systems = t.doc.systems.filter(s => s.use !== 'plot.ending'); }), live);
  assert.deepEqual(loop.problems.map(p => `${p.code}:${p.cause}`), ['loop_problem:loop_win_unwired']);
  for (const r of [pre, comp, loop]) assert.equal(r.evidence.gate, null, 'the gate did not run');
});

test('contract dynamic stages: an unwinnable document fails the gate and every seed; a loop naming no bot fails', async () => {
  const unwinnable = await checkTemplate(broken(farm, t => { t.doc.systems.find(s => s.use === 'gameplay.inventory').with.start = [{ item: 'hoe' }]; }), live);
  assert.ok(codes(unwinnable).includes('gate_not_viable'), JSON.stringify(unwinnable.problems));
  assert.deepEqual(unwinnable.problems.filter(p => p.code === 'bot_not_won').map(p => p.seed), SEEDS);
  const modeless = buildCatalogue([], PRIMITIVES.map(p => (p.id === 'gameplay.farming' ? { ...p, card: { ...p.card, mode: undefined } } : p)));
  assert.ok(codes(await checkTemplate(farm, modeless)).includes('bot_unnamed'));
});

test('contract replay: a document whose play depends on anything but its seed and inputs fails replay', async () => {
  let worlds = 0;
  // Ends the game won a few frames earlier or later depending on how many worlds were built before it.
  const noise = { id: 'gameplay.contract.noise', card: { intent: 'Test stand-in whose play depends on process state.', ambient: true, params: {} },
    install(rt) { const k = ++worlds; rt.system('rules', w => { const s = w.store('gameplay.contract.noise'); s.t = (s.t || 0) + 1; if (s.t === 600 + (k % 2) * 7) w.run([{ do: 'end_game', outcome: 'won' }], {}); }); } };
  const r = await checkTemplate(broken(farm, t => { t.doc.systems.push({ use: 'gameplay.contract.noise' }); }), buildCatalogue([noise]));
  assert.deepEqual(codes(r), ['replay_mismatch'], JSON.stringify(r.problems));
});

// The controls and features stages (ARCHITECTURE §6.3), each failing with its code on a catalogue broken for it.
const swap = (id, change) => buildCatalogue([], PRIMITIVES.map(p => (p.id === id ? change(p) : p)));

test('contract controls: a steering frame that turns the kart away from the screen\'s right fails direction_mismatch', async () => {
  // The defect the kart had: the car turned by the frame of a top-down plane on a track whose lanes count to the right.
  const cat = swap('engine.space.track', p => ({ ...p, card: { ...p.card, frame: { up: 2, handed: 'right' } } }));
  const r = await checkTemplate(templateById('race'), cat, { through: 'controls' });
  assert.ok(r.problems.some(p => p.code === 'direction_mismatch' && /right/.test(p.message)), JSON.stringify(r.problems).slice(0, 600));
});

test('contract controls: a loop verb no control issues fails, statically, before anything simulates', async () => {
  // till as a chosen value with no UI primitive to choose it: no key (a choice) and no control. The composition check
  // judges the document a person plays with the controls' own reading (v2/verify/controls.js uncontrolledVerbs), so the
  // static composition stage names the verb; the controls stage (controls_missing) is the same reading after the gate.
  const cat = buildCatalogue([], PRIMITIVES.filter(p => p.id !== 'graphics.ui.choices').map(p => (p.id === 'gameplay.farming' ? { ...p, card: { ...p.card, actionSpace: { till: { type: 'choice', of: 'a cell' } } } } : p)));
  const r = await checkTemplate(farm, cat, { through: 'controls' });
  assert.ok(r.problems.some(p => p.code === 'composition_failed' && p.cause === 'mode' && /'till \(choice\)'/.test(p.message)), JSON.stringify(r.problems).slice(0, 600));
  assert.equal(r.evidence.gate, null, 'nothing simulated');
});

test('contract features: a loop verb that does nothing when pressed fails feature_inert, naming the primitive and verb', async () => {
  const cat = swap('gameplay.farming', p => ({ ...p, card: { ...p.card, loop: { ...p.card.loop, verbs: [...p.card.loop.verbs, 'whistle'] }, provides: { ...p.card.provides, actions: [...p.card.provides.actions, 'whistle'] } },
    install(rt, config, inst) { p.install(rt, config, inst); rt.action('whistle', () => {}); } }));
  const r = await checkTemplate(farm, cat, { through: 'features' });
  const f = r.problems.find(p => p.code === 'feature_inert');
  assert.ok(f && f.use === 'gameplay.farming' && f.verb === 'whistle', JSON.stringify(r.problems).slice(0, 600));
  assert.ok(Array.isArray(r.evidence.features) && r.evidence.features.some(row => row.use === 'gameplay.farming' && row.verbs.till?.works === true), 'the feature table is in the evidence');
});
