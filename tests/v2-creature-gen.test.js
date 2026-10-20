import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import kit, { expand } from '../v2/kits/creature/index.js';
import { COMPACT_SCHEMA } from '../v2/kits/creature/generate/compact.js';
import { gymOrder } from '../v2/kits/creature/content.js';
import { random } from '../v2/kernel/rng.js';

// Real gpt-4.1-mini outputs for the compact schema (kit-qualify ideas), kept as fixtures.
const real = name => JSON.parse(readFileSync(new URL(`../v2/kits/creature/fixtures/${name}.json`, import.meta.url), 'utf8'));

test('the compact schema is small enough for a ~10 s generation', () => {
  const size = JSON.stringify(COMPACT_SCHEMA).length;
  assert.ok(size < 9000, `schema ${size} bytes`);
  assert.equal(kit.content.schema, COMPACT_SCHEMA);
});

test('real model outputs validate, repair and verify on the first try', () => {
  for (const name of ['model-robots', 'model-desert']) {
    const raw = real(name);
    const v = kit.validate(raw);
    assert.equal(v.ok, true, `${name}: ${JSON.stringify(v.errors)}`);
    assert.ok(v.content.starters[0].forms, 'the stored content is the compact shape the model wrote');
    const again = kit.validate(v.content);
    assert.deepEqual(again.content, v.content, 'idempotent');
    const r = kit.verify(v.content, { seed: 1, budgetMs: 2000 });
    assert.equal(r.ok, true, `${name}: ${JSON.stringify(r.problems)}`);
    assert.ok(r.report.balance.leaders.every(l => l.worst >= 0.7));
  }
  // The robot game's third leader started at a 49% sim win rate; the kit repaired it.
  const fixes = kit.validate(real('model-robots')).fixes.map(f => f.code);
  assert.ok(fixes.some(c => c.startsWith('leader_') || c === 'counter_added'), fixes.join(','));
});

/** Seeded mutations that keep the schema's shape but break the content in the ways models do. */
function mutate(base, seed) {
  const c = structuredClone(base), s = { rng: seed };
  const r = () => random(s), pick = list => list[Math.floor(r() * list.length)] || {};
  const ops = [
    () => { pick(c.types).beats = []; },
    () => { pick(c.types).beats = ['Nonsense', 'Also Fake']; },
    () => { c.types = c.types.slice(0, 2 + Math.floor(r() * 3)); },
    () => { pick(c.starters).types = ['Unknown']; },
    () => { c.starters[1].types = [...c.starters[0].types]; },
    () => { const l = pick(c.starters); l.forms = (l.forms || []).slice(0, 1); },
    () => { c.wild = []; },
    () => { if (c.wild.length) pick(c.wild).forms = []; },
    () => { pick(c.chapters).routes = []; },
    () => { pick(c.chapters).gym.type = 'Glitter'; },
    () => { const rs = pick(c.chapters).routes || []; if (rs.length) pick(rs).wild = ['Nobody', 'Missingmon']; },
    () => { c.finale.champion.team = []; },
    () => { c.finale.routes = []; },
    () => { c.chapters = c.chapters.slice(0, 1); },
    () => { c.chapters.push(structuredClone(c.chapters[0]), structuredClone(c.chapters[0])); },
    () => { c.settings = { routeLength: 9999, encounterRate: 0, difficulty: 'hard', levelStep: 50 }; },
    () => { c.items = { ball: '', greatBall: '', potion: '', superPotion: '', cure: '', revive: '' }; },
    () => { pick(c.types).name = c.types[0].name; },
    () => { for (const l of c.wild) l.role = 'strong'; },
    () => { if (c.wild.length) (pick(c.wild).forms ||= []).push(...structuredClone(c.starters[0].forms)); },
  ];
  for (let i = 0; i < 3; i++) pick(ops)();
  return c;
}

test('repair first: broken but schema-shaped content still validates and verifies', () => {
  const base = real('model-robots');
  for (let seed = 1; seed <= 12; seed++) {
    const c = mutate(base, seed);
    const v = kit.validate(c);
    assert.equal(v.ok, true, `seed ${seed}: ${JSON.stringify(v.errors.slice(0, 3))}`);
    const r = kit.verify(v.content, { seed: 1, budgetMs: 1000, playthrough: false, runsPerGym: 60 });
    for (const p of r.problems) assert.ok(p.path && p.hint, `seed ${seed}: problem without path/hint ${JSON.stringify(p)}`);
    assert.equal(r.ok, true, `seed ${seed}: ${JSON.stringify(r.problems)}`);
    assert.ok(gymOrder(expand(v.content)).length >= 1);
  }
});

test('the playthrough is informational: a bot that stalls is not a content problem', () => {
  const v = kit.validate(real('model-desert'));
  const r = kit.verify(v.content, { seed: 1, budgetMs: 300 });
  assert.equal(r.ok, true);
  assert.ok(!r.problems.some(p => /playthrough/.test(p.code)));
});
