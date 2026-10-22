// Who is on whose side (KERNEL_API.md §2 Sides, kernel/sides.js): one reading of the cards' side declarations
// (card.sides) decides the player's side and its opponents for every consumer. Catalogue-wide:
//   cards     every card.sides is well formed against the card's own declarations (its list param, the component field
//             naming a side, the members field, the control value); every loop played against participants declares
//             the sides of its participants param (its own card or its card.mode.via host's);
//   worlds    over every template and every composed nested and union pair, on the document a person plays: the
//             opponents a win reads (verify/objective.js winMeasure, `component` of 'opponents') never include the
//             player's side, and wearing an opponent down moves it while wearing the player's own pieces down does
//             not; the bots' foes (verify/drive.js) are exactly the entities with health not on the player's side;
//             combat (combat-lib.js hostile: friendly fire, shots, contact) and AI hostility (ai-brain.js hostile)
//             never set the player's side against itself and always set it against a declared opponent side; and the
//             static reading the loop check makes (staticSides) agrees with the world's on every entity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { cardLoop, readsOf, loopInstances } from '../v2/kernel/loop.js';
import { catalogueDocuments } from './v2-catalogue-documents.js';
import { preflight } from '../v2/kernel/document.js';
import { sideDecl, sideOf, onPlayerSide, sidesOf, staticSides } from '../v2/kernel/sides.js';
import { winMeasure } from '../v2/verify/objective.js';
import { foes, hpOf } from '../v2/verify/drive.js';
import { hostile as combatHostile } from '../v2/primitives/gameplay/combat-lib.js';
import { hostile as aiHostile } from '../v2/primitives/gameplay/ai-brain.js';
import { controlledMaker, hostPreflight } from '../v2/verify/controls.js';

const { registry, logic } = buildCatalogue();
const cat = { registry, logic };

test('cards: every card.sides is well formed against the card\'s own declarations', () => {
  const checked = [];
  for (const card of registry.cards()) {
    if (card.sides === undefined) continue;
    const d = sideDecl(card), where = card.id;
    assert.ok(d, `${where}: card.sides { param, control?, component?, field?, members?, each? }`);
    checked.push(where);
    const spec = card.params?.[d.param];
    assert.equal(spec?.type, 'list', `${where}: sides.param '${d.param}' is a list param`);
    if (d.each) { assert.equal(spec.of?.type, 'string', `${where}: an each-side list holds participant selectors`); continue; }
    const fields = spec.of?.fields || {};
    assert.ok(fields.id, `${where}: every side entry has an id`);
    if (d.members) assert.equal(fields[d.members]?.type, 'list', `${where}: sides.members '${d.members}' is a list field of the entries`);
    if (d.control) assert.ok((fields.control?.options || []).includes(d.control), `${where}: sides.control '${d.control}' is a value of the entries' control field`);
    if (d.component || d.field) assert.equal(card.components?.[d.component]?.fields?.[d.field]?.type, 'string', `${where}: components.${d.component}.${d.field} is the declared string field naming a side`);
    assert.ok(d.members || (d.component && d.field) || d.each, `${where}: sides say how an entity is placed on one (members, a component field, or each)`);
  }
  assert.ok(checked.length >= 5, checked.join());
});

test('cards: every loop played against participants declares their sides (card.sides on its participants param, or its via host\'s)', () => {
  const checked = [];
  for (const card of registry.cards()) {
    const loop = cardLoop(card), P = loop?.needs.participants;
    if (typeof P !== 'string') continue;
    const owner = loop.via ? registry.get(loop.via)?.card : card;
    checked.push(card.id);
    assert.equal(sideDecl(owner)?.param, P, `${card.id}: its participants '${P}' are on sides the reading knows (card.sides { param: '${P}' }${loop.via ? ` on ${loop.via}` : ''})`);
  }
  assert.ok(checked.length >= 5, checked.join());
});

test('worlds: over every template and composed pair, the opponents are never the player\'s side, for the win, the bots, combat and AI', t => {
  const t0 = performance.now(), docs = catalogueDocuments(cat);
  let sided = 0, wins = 0;
  for (const { label, doc } of docs) {
    const pre = preflight(structuredClone(doc), registry, logic);
    assert.ok(pre.ok, `${label}: ${JSON.stringify(pre.errors?.slice(0, 2))}`);
    const host = hostPreflight(pre.doc, registry, logic).doc;
    if (!sidesOf(host, registry).length) continue;
    sided++;
    const rt = controlledMaker(host, registry, logic)(host.seed ?? 1);
    for (let i = 0; i < 30 && rt.state.status === 'playing'; i++) rt.step({});
    const ents = Object.values(rt.state.entities), player = rt.player();
    const mine = ents.filter(e => onPlayerSide(rt, e)), theirs = ents.filter(e => !onPlayerSide(rt, e) && sideOf(rt, e));
    // The static reading (the loop check's) agrees with the world's on every entity it places.
    const st = staticSides(host, registry);
    for (const e of ents) if (e.id !== 'player' && sideOf(rt, e)) assert.equal(Boolean(st.archetype(e.archetype, e.components)?.mine), Boolean(sideOf(rt, e).mine), `${label}: ${e.id} is read on the same side statically`);
    // The wins a loop reads of its opponents' component: its carriers are never the player's side.
    for (const l of loopInstances(host, registry)) {
      const r = readsOf(l.loop.win);
      if (!r?.component || (r.of || 'opponents') !== 'opponents') continue;
      const C = r.component, own = mine.filter(e => e.components[C] !== undefined && e.id !== 'player'), foe = theirs.filter(e => e.components[C] !== undefined);
      if (!own.length && !foe.length) continue;
      wins++;
      const wm = winMeasure({ component: C, of: 'opponents' }), snap = rt.snapshot();
      const c = wm.start(rt);
      // (Entities by id: restoring a snapshot replaces the state's entity objects.)
      const wear = e => { const x = rt.state.entities[e.id]; x.components[C] = { ...x.components[C], hp: (x.components[C].hp ?? 1) - 1, worn: true }; };
      own.forEach(wear);
      assert.equal(wm.advance(rt, c), 0, `${label}: ${l.use} wins on its opponents' ${C}; wearing the player's own pieces down (${own.map(e => e.id).join(', ')}) is no progress`);
      if (foe.length) { wear(foe[0]); assert.equal(wm.advance(rt, c), 1, `${label}: wearing ${foe[0].id} down is`); }
      rt.restore(snap);
    }
    // The bots' foes: the entities with health in the player's space not on its side.
    if (player) {
      const expect = ents.filter(e => e !== player && e.space === player.space && hpOf(e) !== null && !onPlayerSide(rt, e)).map(e => e.id).sort();
      assert.deepEqual(foes(rt).map(e => e.id).sort(), expect, `${label}: the bots' foes`);
    }
    // Combat and AI: never against their own side, always against a declared opposing side.
    for (const a of mine) for (const b of mine) if (a !== b) {
      assert.equal(combatHostile(rt, a, b), false, `${label}: combat sets ${a.id} against ${b.id}, both the player's side`);
      assert.equal(aiHostile(rt, a, b), false, `${label}: AI sets ${a.id} against ${b.id}, both the player's side`);
    }
    for (const a of mine) for (const b of theirs) {
      assert.equal(combatHostile(rt, a, b), true, `${label}: combat sets ${a.id} against ${b.id}`);
      assert.equal(aiHostile(rt, b, a), true, `${label}: AI sets ${b.id} against ${a.id}`);
    }
  }
  assert.ok(sided >= 5 && wins >= 3, `${sided} documents with sides, ${wins} opponent wins`);
  t.diagnostic(`${sided} with sides, ${wins} opponent wins, ${docs.length} documents in ${Math.round(performance.now() - t0)} ms`);
});
