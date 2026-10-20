import test from 'node:test';
import assert from 'node:assert/strict';
import kit, { expand } from '../v2/kits/creature/index.js';
import { JOURNEY } from '../v2/kits/creature/fixtures/journey.js';
import { MODEL_SCHEMA } from '../v2/kits/creature/generate/schema.js';
import { fromModel } from '../v2/kits/creature/generate/from-model.js';
import { balance } from '../v2/kits/creature/generate/balance.js';
import { gymOrder, levelCurve } from '../v2/kits/creature/content.js';
import { generateMaps } from '../v2/kits/creature/world/maps.js';
import { creatureLook, personLook } from '../v2/kits/creature/ui/looks.js';
import { loadKit } from '../v2/kits/registry.js';

/** Walk a JSON schema and collect strict-mode violations. */
function strictProblems(node, path = '$', out = []) {
  if (!node || typeof node !== 'object') return out;
  for (const k of ['oneOf', 'anyOf', 'allOf', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength']) if (k in node) out.push(`${path}: ${k}`);
  if (node.type === 'object') {
    if (node.additionalProperties !== false) out.push(`${path}: additionalProperties`);
    const keys = Object.keys(node.properties || {});
    if (JSON.stringify([...node.required].sort()) !== JSON.stringify([...keys].sort())) out.push(`${path}: required`);
    for (const [k, v] of Object.entries(node.properties)) strictProblems(v, `${path}.${k}`, out);
  }
  if (node.type === 'array') strictProblems(node.items, `${path}[]`, out);
  return out;
}

test('the kit module satisfies the kit contract and is registered', async () => {
  assert.equal(kit.id, 'creature');
  for (const k of ['name', 'version', 'summary']) assert.equal(typeof kit[k], 'string');
  assert.deepEqual(kit.examples, ['Pokémon Red/Blue', 'Pokémon Gold/Silver', 'Pokémon Ruby/Sapphire']);
  for (const fn of ['validate', 'cast', 'createGame', 'createRenderer', 'verify', 'goal']) assert.equal(typeof kit[fn], 'function', fn);
  assert.ok(kit.controls.some(c => c.input === 'move') && kit.controls.some(c => c.input === 'a') && kit.controls.some(c => c.input === 'b'));
  assert.equal((await loadKit('creature')).id, 'creature');
  const { brief, entities } = kit.cast(kit.content.sample);
  assert.equal(brief.player.name, 'Wren');
  assert.deepEqual(entities.player.tags, ['player']);
  assert.deepEqual(entities.rival.tags, ['enemy']);
  assert.match(kit.goal(kit.content.sample), /2 badges/);
});

test('the model schema is OpenAI-strict and compact', () => {
  assert.deepEqual(strictProblems(MODEL_SCHEMA), []);
  assert.ok(JSON.stringify(MODEL_SCHEMA).length < 20000);
});

test('the sample validates, plays deterministically and verifies within budget', () => {
  const v = kit.validate(kit.content.sample);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const run = () => {
    const game = kit.createGame(v.content, { seed: 4 });
    const s = game.createState();
    for (let i = 0; i < 600; i++) game.step(s, { x: 0, y: i % 90 < 45 ? 1 : 0, a: i % 7 === 0, b: false });
    return JSON.stringify(s);
  };
  assert.equal(run(), run());
  const t0 = performance.now();
  const r = kit.verify(v.content, { seed: 1, budgetMs: 2000 });
  const ms = performance.now() - t0;
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.ok(ms < 2500, `verify took ${Math.round(ms)} ms`);
  assert.ok(r.report.balance.leaders.every(l => l.worst >= 0.7));
  assert.ok(r.report.balance.wild.winRate >= 0.95);
  assert.ok(r.report.playthrough.some(p => p.cleared), 'the bot reached the ending');
});

test('a generated journey expands, balances and verifies; rough edges are repaired', () => {
  const v = kit.validate(JOURNEY);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.ok(v.content.chapters, 'the stored content is the journey the model wrote');
  const full = expand(v.content);
  assert.equal(gymOrder(full).length, 2);
  assert.ok(full.moves.find(m => m.id === 'flare-dive').power <= 150, 'power clamped');
  assert.ok(!full.species.find(s => s.id === 'shellby').learnset.some(l => l.move === 'nope'), 'unknown move dropped');
  for (const s of full.species) { const bst = Object.values(s.base).reduce((a, b) => a + b, 0); assert.ok(bst >= 290 && bst <= 540, `${s.id} bst ${bst}`); }
  assert.ok(v.fixes.length > 0);
  const r = kit.verify(v.content, { seed: 1, budgetMs: 1500, playthrough: false });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
});

test('common change requests are real parameters', () => {
  const variant = mut => { const j = structuredClone(JOURNEY); mut(j); return expand(kit.validate(j).content); };
  const base = expand(kit.validate(JOURNEY).content);
  // Bigger world: route length makes routes longer; more routes per chapter adds areas.
  const big = variant(j => { j.settings.routeLength = 120; j.chapters[0].routes.push({ ...j.chapters[0].routes[0], id: 'dunes', name: 'Dunes' }); });
  assert.ok(big.areas.length > base.areas.length);
  const h = c => generateMaps(c, 1).maps.sandbar.h;
  assert.ok(h(big) > h(base) * 1.8, `route length ${h(base)} → ${h(big)}`);
  // More gyms: a chapter adds a gym and moves the champion up the curve.
  const more = variant(j => { j.chapters.push({ ...structuredClone(j.chapters[1]), routes: [{ ...j.chapters[1].routes[0], id: 'reef-road' }], town: { ...j.chapters[1].town, id: 'reeftown', name: 'Reeftown' }, gym: { ...structuredClone(j.chapters[1].gym), id: 'reef-gym', leader: { ...j.chapters[1].gym.leader, id: 'leader-ana', name: 'Ana', badge: 'Reef Crown' } } }); });
  assert.equal(gymOrder(more).length, 3);
  assert.ok(Math.max(...more.champion.party.map(m => m.level)) > Math.max(...base.champion.party.map(m => m.level)));
  // Harder: difficulty and level step raise trainer levels; encounter rate is the real per-step chance.
  const hard = variant(j => { j.settings.difficulty = 'hard'; j.settings.levelStep = 9; j.settings.encounterRate = 25; });
  assert.equal(levelCurve(2, hard), 23);
  const lead = c => Math.max(...gymOrder(c)[1].leader.party.map(m => m.level));
  assert.ok(lead(hard) > lead(base));
  assert.equal(hard.areas.find(a => a.id === 'sandbar').encounterRate, 0.25);
  // More creatures: a new species is real content the world can use.
  const more2 = variant(j => { j.species.push({ ...structuredClone(j.species.at(-1)), id: 'kelpup', name: 'Kelpup' }); j.chapters[0].routes[0].encounters.push({ species: 'kelpup', weight: 20 }); });
  assert.equal(more2.species.length, base.species.length + 1);
  assert.ok(more2.areas.find(a => a.id === 'sandbar').encounters.some(e => e.species === 'kelpup'));
});

test('balance closes the starter triangle and gives every type a weakness and a resistance', () => {
  const j = structuredClone(JOURNEY);
  j.chart = j.chart.filter(c => !(c.attacking === 'surf' && c.defending === 'blaze'));
  const { content, fixes } = balance(fromModel(j));
  assert.ok(fixes.some(f => f.code === 'chart'));
  const types = content.types.map(t => t.id), m = (a, d) => content.chart[a]?.[d] ?? 1;
  for (const t of types) { assert.ok(types.some(a => m(a, t) > 1), `${t} weakness`); assert.ok(types.some(a => m(a, t) < 1), `${t} resistance`); }
});

test('rig looks come from content text, deterministically', () => {
  const full = expand(kit.validate(JOURNEY).content);
  assert.equal(creatureLook(full, 'puffin').body, 'flyer');
  assert.equal(creatureLook(full, 'cindle').tail, 'flame');
  assert.equal(creatureLook(full, 'budling').build, 'chibi');
  assert.notEqual(creatureLook(full, 'grovezar').build, 'chibi');
  assert.deepEqual(creatureLook(full, 'zapling'), creatureLook(full, 'zapling'));
  const p = personLook('a kid with a yellow cap and a blue vest', 'p');
  assert.equal(p.headwear, 'cap');
  assert.equal(p.colors.primary, '#3a6ad8');
});

test('the renderer draws every screen headless without throwing', async () => {
  const { createBot } = await import('../v2/kits/creature/verify/bot.js');
  const { createCreature } = await import('../v2/kits/creature/rules/index.js');
  let texts = 0;
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 30 }) : typeof k === 'string' && k.startsWith('create') ? () => ({ addColorStop() {} }) : () => { if (k === 'fillText') texts++; }), set: (t, k, v) => { t[k] = v; return true; } });
  const content = kit.validate(kit.content.sample).content;
  const game = kit.createGame(content, { seed: 2 });
  const s = game.createState();
  const render = kit.createRenderer(game, { art: {} });
  const modes = new Set(), phases = new Set();
  // Render every third step the bot (or the test) takes.
  const step = game.step;
  let n = 0;
  game.step = (st, inp) => {
    const r = step(st, inp);
    if (n++ % 3 === 0) { render(ctx, st, { cssWidth: 720, cssHeight: 480, dt: 1 / 60, events: st.events, reducedMotion: false, attract: false }); modes.add(st.mode); if (st.battle) phases.add(st.battle.phase); }
    return r;
  };
  const bot = createBot(game, s, { catchSpecies: 'any' });
  bot.settle(); bot.goTo('route-1'); bot.grind(120);
  for (const inp of [{ b: true }, {}, { a: true }, {}, {}, { b: true }, {}, { b: true }, {}]) game.step(s, inp);
  s.party[0].level = 16; s.script.push({ op: 'evolve', uid: s.party[0].uid });
  for (let i = 0; i < 400; i++) game.step(s, { a: i % 20 === 0 });
  s.party.push(createCreature(content, 'galewing', 20, s));
  s.script.push({ op: 'end_game' });
  for (let i = 0; i < 200; i++) game.step(s, {});
  game.step = step;
  for (const m of ['dialogue', 'overworld', 'transition', 'battle', 'menu', 'evolution', 'ending']) assert.ok(modes.has(m), `rendered ${m}`);
  for (const p of ['beats', 'menu', 'moves']) assert.ok(phases.has(p), `rendered battle ${p}`);
  assert.ok(texts > 100);
});
