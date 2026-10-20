import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';

// A tiny mystery on a graph space: find the key in the garden, open the
// library, read the letter. Exercises spaces, gates, storyboard and items.
const mystery = () => ({
  schema: 'gameverse.v2.game/0.2', id: 'manor', title: 'The Quiet Manor', seed: 1,
  spaces: [{ id: 'manor', use: 'engine.space.graph', zones: [
    { id: 'hall', name: 'Hall', exits: [{ to: 'garden' }, { to: 'library', gate: { item: 'brass_key' } }] },
    { id: 'garden', name: 'Garden', exits: [{ to: 'hall' }] },
    { id: 'library', name: 'Library', exits: [{ to: 'hall' }] },
  ] }],
  systems: [{ use: 'gameplay.inventory' }, { use: 'plot.storyboard' }],
  plot: {
    characters: [{ id: 'butler', name: 'Hobbs' }],
    storyboard: { acts: [
      { id: 'arrival', beats: [{ id: 'greeting', do: [{ do: 'say', character: 'butler', text: 'The master is missing.' }] }] },
      { id: 'search', beats: [
        { id: 'find_key', when: { zone: 'garden' }, do: [{ do: 'give_item', item: 'brass_key' }, { do: 'set_flag', flag: 'key_found' }] },
        { id: 'find_letter', after: ['find_key'], when: { zone: 'library' }, do: [{ do: 'give_item', item: 'letter' }] },
        { id: 'solve', when: { item: 'letter' }, do: [{ do: 'end_game', ending: 'truth' }] },
      ] },
    ] },
    endings: [{ id: 'truth', title: 'The truth' }],
  },
  content: { items: [{ id: 'brass_key', name: 'Brass key' }, { id: 'letter', name: 'Letter' }], archetypes: [{ id: 'detective', components: { name: 'You' } }] },
  player: { archetype: 'detective', space: 'manor', at: 'hall' },
});

const { registry, logic } = catalogue();
const codes = r => r.errors.map(e => e.code);

test('a full document preflights in milliseconds', () => {
  const r = preflight(mystery(), registry, logic);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.ok(r.ms < 50);
  assert.deepEqual(r.capabilities.manor.sort(), ['distance', 'navigate', 'position', 'reachable']);
});

test('the story runs to its ending through gates, items and beats', () => {
  const rt = createWorld(preflight(mystery(), registry, logic).doc, registry, logic);
  rt.step();
  assert.equal(rt.state.counts.say, 1);
  rt.step({ actions: { go: 'library' } });
  assert.equal(rt.player().at, 'hall', 'library is locked without the key');
  assert.equal(rt.state.counts.blocked, 1);
  rt.step({ actions: { go: 'garden' } });
  assert.equal(rt.state.flags.key_found, true);
  rt.step({ actions: { go: 'hall' } }); rt.step({ actions: { go: 'library' } });
  assert.equal(rt.state.status, 'won');
  assert.equal(rt.state.ending, 'truth');
});

test('snapshots restore exactly and replay deterministically', () => {
  const rt = createWorld(preflight(mystery(), registry, logic).doc, registry, logic);
  rt.step(); rt.step({ actions: { go: 'garden' } });
  const snap = rt.snapshot();
  rt.step({ actions: { go: 'hall' } }); rt.step({ actions: { go: 'library' } });
  const end = rt.snapshot();
  rt.restore(snap);
  rt.step({ actions: { go: 'hall' } }); rt.step({ actions: { go: 'library' } });
  assert.deepEqual(rt.snapshot(), end);
});

test('preflight catches unknown primitives, references, capabilities and vocabulary', () => {
  const needsCells = { id: 'gameplay.blocks.mine', card: { intent: 'mine cells', requires: { capabilities: ['editCells'] } } };
  const c = catalogue([needsCells]);
  const bad = mystery();
  bad.systems.push({ use: 'gameplay.blocks.mine' }, { use: 'gameplay.teleporter' });
  bad.plot.storyboard.acts[1].beats[0].do.push({ do: 'give_item', item: 'crowbar' }, { do: 'explode' });
  bad.plot.storyboard.acts[1].beats[1].after = ['nonexistent'];
  bad.spaces[0].zones[0].exits.push({ to: 'attic' });
  const r = preflight(bad, c.registry, c.logic);
  for (const code of ['capability_missing', 'primitive_unknown', 'ref_unknown', 'effect_unknown']) assert.ok(codes(r).includes(code), code);
  const cap = r.errors.find(e => e.code === 'capability_missing');
  assert.match(cap.hint, /navigate/);
});

test('warnings flag flags nobody sets and data no primitive reads', () => {
  const doc = mystery();
  doc.plot.storyboard.acts[1].beats[2].when = { all: [{ item: 'letter' }, { flag: 'butler_confessed' }] };
  doc.content.recipes = [];
  const r = preflight(doc, registry, logic);
  assert.ok(r.ok);
  assert.ok(r.warnings.some(w => w.code === 'flag_never_set'));
  assert.ok(r.warnings.some(w => w.code === 'data_unused' && w.path === 'content.recipes'));
});
