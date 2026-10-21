// What a thing looks like in the 3D renderers and which icon the UI gives it come from declarations, never from words
// in its id, name or tags (ARCHITECTURE §1.2; the 2D side: tests/v2-p-presentation-names.test.js). Over every template
// and v2/games/*.json document: renaming an archetype, item or status — its id to words a word list would read (dragon,
// police, slime, sword, ghost, poison...), its themed name and tags — leaves the generated model spec, the item's held
// shape and icon and the status's icon identical, the id kept only as the seed of the variation it already was.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TEMPLATES } from '../v2/templates/registry.js';
import { catalogue } from '../v2/primitives/index.js';
import { synthesizeSpec, itemSpec, bodyPlan, BODY_PLANS } from '../v2/primitives/graphics/three-model-gen.js';
import { itemIcon, statusIcon, iconNames } from '../v2/primitives/graphics/ui-icons.js';

const { registry } = catalogue();
const games = fs.readdirSync(new URL('../v2/games/', import.meta.url)).filter(f => f.endsWith('.json')).map(f => ({ id: `v2/games/${f}`, doc: JSON.parse(fs.readFileSync(new URL(`../v2/games/${f}`, import.meta.url), 'utf8')) }));
const docs = [...TEMPLATES.map(t => ({ id: `template ${t.id}`, doc: t.doc })), ...games];
// Words the word lists this layer had would read as a shape or an icon.
const STEER = ['dragon', 'police_car', 'slime', 'ghost_wolf', 'sword', 'hunting_bow', 'poison', 'burning', 'golem', 'horse', 'spider', 'treasure_chest', 'stamina', 'gold'];

/** The document with every string value equal to the id replaced (the references to it follow it; keys stay). */
const renameId = (doc, from, to) => { const walk = v => (v === from ? to : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v); return walk(doc); };
const steer = k => STEER[k % STEER.length];
const titleOf = s => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

for (const { id, doc } of docs) {
  const archetypes = doc.content?.archetypes || [], items = doc.content?.items || [], statuses = doc.content?.statuses || [];
  if (!archetypes.length && !items.length && !statuses.length) continue;
  test(`${id}: renaming archetypes, items and statuses leaves their 3D models and icons identical`, () => {
    archetypes.forEach((a, k) => {
      const to = `${steer(k)}_${k}`, d2 = renameId(doc, a.id, to), a2 = { ...d2.content.archetypes[k], name: titleOf(steer(k + 3)), tags: [steer(k + 1), steer(k + 2)] };
      assert.deepEqual(synthesizeSpec(a2, { registry, doc: d2, seed: a.id }), synthesizeSpec(a, { registry, doc }), `archetype '${a.id}' renamed '${to}' changed its model`);
      assert.equal(bodyPlan(a2, { registry, doc: d2, seed: a.id }), bodyPlan(a, { registry, doc }));
    });
    items.forEach((it, k) => {
      const it2 = { ...it, id: `${steer(k)}_${k}`, name: titleOf(steer(k + 5)), tags: [steer(k + 6)] };
      assert.deepEqual(itemSpec(it2, { seed: it.id }), itemSpec(it), `item '${it.id}' renamed changed its held model`);
      assert.equal(itemIcon(it2).name, itemIcon(it).name, `item '${it.id}' renamed changed its icon`);
    });
    statuses.forEach((s, k) => {
      const s2 = { ...s, id: steer(k + 6), name: titleOf(steer(k + 7)), tags: [steer(k + 8)] };
      assert.equal(statusIcon(s2), statusIcon(s), `status '${s.id}' renamed changed its icon`);
    });
  });
}

test('model and icon declarations: presents.body names a body plan; status and item icons are icons', () => {
  const icons = new Set(iconNames());
  for (const c of registry.cards()) for (const [key, v] of Object.entries(c.presents || {})) for (const p of Array.isArray(v) ? v : [v]) {
    if (p.body !== undefined) assert.ok(BODY_PLANS.includes(p.body), `${c.id} presents ${key} with body '${p.body}', not one of ${BODY_PLANS.join(', ')}`);
  }
  for (const { doc } of docs) {
    for (const s of doc.content?.statuses || []) assert.ok(icons.has(statusIcon(s)), `status '${s.id}' icon`);
    for (const it of doc.content?.items || []) assert.ok(icons.has(itemIcon(it).name), `item '${it.id}' icon '${itemIcon(it).name}'`);
  }
  // What the declarations say, not the words: a status ticking fire is a flame whatever it is called; a stun a star.
  assert.equal(statusIcon({ id: 'frost', name: 'Frost', tick: { dps: 2, type: 'fire' } }), 'flame');
  assert.equal(statusIcon({ id: 'burning', mods: { 'stat.stun': 1 } }), 'star');
  assert.equal(itemIcon({ id: 'gold_coin', kind: 'weapon', weapon: {} }).name, 'sword');
});
