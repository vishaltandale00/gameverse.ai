// A revision that names a player mechanic the game lacks is built by the extension step, exactly as a create builds an
// idea's extra mechanics (ARCHITECTURE.md §5; v2/planner/kernel-pipeline.js revise, extend.js): one strict form in the
// pick's mechanics shape, held to the change's own words, asked side by side with the tweak; a mechanic no primitive of
// the game gives goes to extendDocument (a strict option question over cards proven valid by declarations, the gap
// layer, else the change fails naming it), its params form, engagement, the usable check, preflight and the version
// gate. A change naming no new mechanic takes the tweak, else the model's ops, as before, in no more sequential rounds.
// (A person asked a kart game "can I have ramps" and the model's ops wrote solid walls named 'ramp' across the track.)
// Scripted fake writers only (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { templateById } from '../v2/templates/registry.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { hashOf } from '../v2/server/store.js';
import { createKernelPipeline } from '../v2/planner/kernel-pipeline.js';
import { applyOps } from '../v2/planner/doc-revise.js';
import { tuneLimits } from '../v2/planner/version-gate.js';
import { changeMechanicsForm, pickForm, CHANGE_RULES } from '../v2/planner/templates.js';
import { TEMPLATES } from '../v2/templates/registry.js';

const { registry, logic } = buildCatalogue();
const cat = { registry, logic };

/** A game made from a template: its first version as the template path publishes it. */
function templateGame(id, seed = 3) {
  const doc = preflight({ ...structuredClone(templateById(id).doc), seed }, registry, logic).doc;
  const versions = [{ version: 1, stage: 'first_playable', doc, report: { kind: 'kernel', path: 'template', templates: [id] }, provenance: { pipeline: 'test', templates: [id], seed, prompt: id, outlineHash: hashOf(doc) } }];
  const stages = [], checkpoints = {};
  const ctx = {
    stage(name, detail = {}) { stages.push({ name, ...detail }); }, draft() {}, checkpoint(name, value) { checkpoints[name] = value; },
    async publish(p) { const r = { version: versions.length + 1, ...p }; versions.push(r); return r; },
    store: { async updateMeta() {}, async version(_, v) { return versions[v - 1]; }, async latest() { return versions.at(-1); } },
  };
  return { versions, stages, checkpoints, ctx };
}

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
  return { ...v, weapons: [{ ...nulls(item), id: 'blaster' }] };
}

/**
 * A scripted model: the tweak (`tweak(enum)`: a param path or 'none', with `number`), the change's mechanics, the
 * extension step's pick (the first of `picks` offered), the gun's params (any other params form: its smallest answer), and the ops (a model asked to write ops). Each call is
 * recorded with when it started and ended; `delay` ms per call.
 */
function writer({ tweak = () => 'none', number = null, mechanics = [], picks = ['gameplay.combat.projectile'], ops = [], delay = 0 } = {}) {
  const calls = [];
  return { provider: 'fake', model: 'fake-writer', calls, async complete(req) {
    const call = { form: req.schema?.name ?? 'reply', req, start: performance.now(), end: 0 };
    calls.push(call);
    if (delay) await new Promise(res => setTimeout(res, delay));
    const props = req.schema?.schema?.properties ?? {};
    let text;
    if (call.form === 'tweak_param') text = JSON.stringify({ param: tweak(props.param.enum), number, flag: null, why: 'scripted' });
    else if (call.form === 'change_mechanics') text = JSON.stringify({ mechanics });
    else if (call.form === 'pick_primitive') text = JSON.stringify({ pick: picks.find(id => props.pick.enum.includes(id)) ?? 'none', why: 'it', spec: 'a gun the player fires' });
    else if (call.form === 'pick_category') text = JSON.stringify({ pick: 'none', why: '', spec: '' });
    else if (call.form === 'params_gameplay__combat__projectile') text = JSON.stringify(weaponAnswer(req.schema.schema));
    else if (call.form.startsWith('params_')) text = JSON.stringify(nulls(req.schema.schema));
    else text = JSON.stringify({ ops, unsupported: [], summary: 'done' });
    call.end = performance.now();
    return { text, ms: 1, model: 'fake-writer' };
  } };
}
const forms = w => w.calls.map(c => c.form);
const GUN = { name: 'fire a gun', says: 'a gun', verb: 'fire', importance: 'core' };

test('the change\'s mechanics form is the pick\'s mechanics field: one shape, the catalogue\'s declared verbs, strict', () => {
  const change = changeMechanicsForm(registry).schema.properties.mechanics, pick = pickForm(TEMPLATES, registry).schema.properties.mechanics;
  assert.deepEqual(Object.keys(change.items.properties), Object.keys(pick.items.properties));
  assert.deepEqual(change.items.properties.verb.enum, pick.items.properties.verb.enum);
  assert.deepEqual(change.items.properties.importance.enum, pick.items.properties.importance.enum);
  assert.equal(change.items.additionalProperties, false);
  assert.deepEqual(change.items.required, Object.keys(change.items.properties));
  assert.deepEqual(Object.keys(CHANGE_RULES), ['change_form', 'change_mechanic_unsaid']);
});

test('"give him a gun" on a platformer without one: the extension step adds the gun, engaged and usable; the version publishes with the player able to fire', async () => {
  const g = templateGame('platformer');
  const base = g.versions[0];
  const w = writer({ mechanics: [GUN] });
  const r = await createKernelPipeline({ catalogue: async () => cat, writers: { spec: w } })({ gameId: 'g', kind: 'revise', change: 'give him a gun' }, g.ctx).then(x => ({ x }), e => ({ e }));
  assert.ok(r.x, r.e?.message);
  const v = g.versions[1], report = v.report;
  assert.equal(report.path, 'extension');
  assert.deepEqual(report.mechanics.map(c => [c.mechanic, c.by]), [['fire a gun', null]], 'the first round\'s coverage: no primitive of the game gives fire');
  assert.deepEqual(report.extension.mechanics.map(c => [c.mechanic, c.by, c.primitives]), [['fire a gun', 'extension', ['gameplay.combat.projectile']]]);
  assert.deepEqual(report.unnamedMechanics, []);
  const gun = v.doc.systems.find(s => s.use === 'gameplay.combat.projectile');
  assert.equal(gun.with.weapons[0].id, 'blaster');
  assert.equal(gun.with.playerWeapon, 'blaster', 'engaged: the player fires the weapon (card.engage.config)');
  // The game is the game it was: its primitives and its content kept, the gun added.
  for (const s of base.doc.systems) assert.ok(v.doc.systems.some(x => x.use === s.use), `${s.use} kept`);
  assert.deepEqual(v.doc.content, base.doc.content, 'the game\'s content kept');
  // The gate played the gun through the controls a person has.
  const row = report.features.table.find(x => x.use === 'gameplay.combat.projectile');
  assert.deepEqual([row.exists, row.controllable, row.verbs.fire?.works], [true, true, true], JSON.stringify(row));
  // The calls: the tweak and the mechanics side by side, the extension question, the gun's params: three rounds.
  assert.deepEqual(forms(w).slice(0, 2).sort(), ['change_mechanics', 'tweak_param']);
  assert.deepEqual(forms(w).slice(2), ['pick_primitive', 'params_gameplay__combat__projectile']);
  assert.match(w.calls[2].req.user, /The change also names "fire a gun"/);
  assert.equal(report.modelCalls, 4); assert.equal(report.modelRounds, 3);
  assert.ok(!forms(w).includes('reply'), 'no model ops wrote the gun');
  // Provenance: the extension, and ops that reproduce the version from its base.
  const p = v.provenance;
  assert.equal(p.revisePath, 'extension');
  assert.deepEqual(p.mechanics.map(m => [m.mechanic, m.by, m.option]), [['fire a gun', 'extension', 'gameplay.combat.projectile']]);
  assert.equal(hashOf(preflight(applyOps(base.doc, p.ops).doc, registry, logic).doc), hashOf(v.doc), 'base + ops reproduce the version');
  timings.gunMs = Math.round(report.timings.totalMs);
});

test('a change naming a mechanic nothing can give the game fails with extension_missing and says so plainly; nothing is faked or published', async () => {
  // The race has no targets with health for a gun (the projectile's content contract), and the gap layer is off.
  const g = templateGame('race');
  const w = writer({ mechanics: [GUN], ops: [{ op: 'add', path: 'systems', value: { use: 'gameplay.combat.projectile' } }] });
  const e = await createKernelPipeline({ catalogue: async () => cat, writers: { spec: w } })({ gameId: 'g', kind: 'revise', change: 'give me a gun' }, g.ctx).then(() => null, x => x);
  assert.ok(e, 'refused');
  assert.equal(e.status, 422); assert.equal(e.code, 'extension_missing');
  assert.match(e.message, /^That change wasn't published\. This game cannot have “fire a gun” yet/);
  assert.equal(e.report.path, 'extension');
  assert.ok(e.report.problems.some(p => /"fire a gun".*still missing/.test(String(p.message))), JSON.stringify(e.report.problems).slice(0, 300));
  assert.equal(g.versions.length, 1, 'nothing published');
  assert.ok(!forms(w).includes('reply'), 'the model\'s ops are never asked to fake it');
  assert.ok(!forms(w).some(f => f.startsWith('params_')), 'no params for a mechanic that cannot be built');
  assert.equal(g.checkpoints.revision.code, 'extension_missing');
});

test('an extension the gate proves does not work in the game is dropped and its step asked again, as on create (one shared loop)', async () => {
  // A one-on-one fighter: lock-on targeting has no second target to cycle to (pressing `cycle` fires none of its events).
  const g = templateGame('fighting');
  const w = writer({ mechanics: [{ name: 'lock on to a rival', says: 'lock on to a rival', verb: 'cycle', importance: 'extra' }], picks: ['gameplay.combat.target', 'gameplay.move.dodge'] });
  const r = await createKernelPipeline({ catalogue: async () => cat, writers: { spec: w } })({ gameId: 'g', kind: 'revise', change: 'let me lock on to a rival' }, g.ctx).then(x => ({ x }), e => ({ e }));
  assert.ok(r.x, r.e?.message);
  const dropped = g.stages.filter(s => s.name === 'extension_dropped').flatMap(s => s.picks);
  assert.deepEqual(dropped.map(d => [d.mechanic, d.id]), [['lock on to a rival', 'gameplay.combat.target']]);
  assert.match(dropped[0].why, /^feature_inert: gameplay\.combat\.target: pressing 'cycle'/);
  const picks = w.calls.filter(c => c.form === 'pick_primitive');
  assert.equal(picks.length, 2);
  assert.ok(!picks[1].req.schema.schema.properties.pick.enum.includes('gameplay.combat.target'), 'the dropped pick is not offered again');
  assert.deepEqual(r.x.report.extension.mechanics.map(c => [c.mechanic, c.by, c.option]), [['lock on to a rival', 'extension', 'gameplay.move.dodge']]);
  assert.deepEqual(r.x.report.extension.dropped, { 'lock on to a rival': [{ id: 'gameplay.combat.target', why: dropped[0].why }] });
  assert.ok(r.x.doc.systems.some(s => s.use === 'gameplay.move.dodge') && !r.x.doc.systems.some(s => s.use === 'gameplay.combat.target'));
});

test('"make it faster: two laps" names no new mechanic: the tweak path, unchanged, with no extension question', async () => {
  const g = templateGame('race');
  const t = templateById('race'), limits = tuneLimits(t, g.versions[0].doc, cat);
  const key = [...limits.keys()].find(k => k.endsWith('.with.laps'));
  const w = writer({ tweak: ids => ids.find(id => id === key), number: 2 });
  const r = await createKernelPipeline({ catalogue: async () => cat, writers: { spec: w } })({ gameId: 'g', kind: 'revise', change: 'make it faster: two laps' }, g.ctx);
  assert.equal(r.report.path, 'tweak');
  assert.deepEqual(r.report.ops.map(o => o.path), [key]);
  assert.deepEqual(r.report.mechanics, []);
  assert.equal(r.report.extension, undefined);
  assert.deepEqual(forms(w).sort(), ['change_mechanics', 'tweak_param']);
  assert.equal(r.report.modelRounds, 1);
});

test('a mechanic the change does not say (the model inventing one) is removed by code and reported; nothing is built for it', async () => {
  const g = templateGame('race');
  const t = templateById('race'), limits = tuneLimits(t, g.versions[0].doc, cat);
  const key = [...limits.keys()].find(k => k.endsWith('.with.laps'));
  const w = writer({ tweak: ids => ids.find(id => id === key), number: 2, mechanics: [{ name: 'shoot rivals', says: 'shoot the rivals', verb: 'fire', importance: 'extra' }] });
  const r = await createKernelPipeline({ catalogue: async () => cat, writers: { spec: w } })({ gameId: 'g', kind: 'revise', change: 'make it faster: two laps' }, g.ctx);
  assert.deepEqual(r.report.unnamedMechanics.map(x => [x.name, x.why.split(':')[0]]), [['shoot rivals', 'change_mechanic_unsaid']]);
  assert.deepEqual(r.report.mechanics, []);
  assert.equal(r.report.path, 'tweak');
  assert.ok(!forms(w).includes('pick_primitive'));
  assert.equal(forms(w).filter(f => f === 'change_mechanics').length, 1, 'no re-ask for it');
});

test('a mechanic whose verb the game already gives needs nothing added: the change takes the model\'s ops as before', async () => {
  const g = templateGame('platformer');
  const w = writer({ mechanics: [{ name: 'jump', says: 'jump', verb: 'jump', importance: 'core' }], ops: [{ op: 'set', path: 'title', value: 'Jump Quest' }] });
  const r = await createKernelPipeline({ catalogue: async () => cat, writers: { spec: w } })({ gameId: 'g', kind: 'revise', change: 'call it Jump Quest, a game where you jump' }, g.ctx);
  assert.equal(r.report.path, 'model');
  assert.deepEqual(r.report.mechanics.map(c => [c.mechanic, c.by]), [['jump', 'template']]);
  assert.ok(!forms(w).includes('pick_primitive'));
  assert.equal(r.doc.title, 'Jump Quest');
});

test('timing: a revision naming no mechanic asks its mechanics side by side with the tweak (no sequential model round added)', async () => {
  const g = templateGame('race');
  const t = templateById('race'), limits = tuneLimits(t, g.versions[0].doc, cat);
  const key = [...limits.keys()].find(k => k.endsWith('.with.laps'));
  const delay = 150;
  const w = writer({ tweak: ids => ids.find(id => id === key), number: 2, delay });
  const r = await createKernelPipeline({ catalogue: async () => cat, writers: { spec: w } })({ gameId: 'g', kind: 'revise', change: 'make it faster: two laps' }, g.ctx);
  const [a, b] = w.calls;
  assert.equal(w.calls.length, 2);
  assert.ok(a.start < b.end && b.start < a.end, 'the two calls overlap');
  assert.equal(r.report.modelRounds, 1);
  assert.ok(r.report.timings.firstRoundMs < 2 * delay, `the first round took ${r.report.timings.firstRoundMs} ms, one call's delay is ${delay} ms`);
  timings.firstRoundMs = r.report.timings.firstRoundMs;
});

const timings = {};
test('timings (AGENTS.md: reported, not budgeted)', t => { t.diagnostic(JSON.stringify(timings)); });
