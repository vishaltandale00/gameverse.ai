import test from 'node:test';
import assert from 'node:assert/strict';
import { mountBuildRequirements, mountCreationLibrary, sourceWorldChoices } from '../src/creation-library.js';

class Element extends EventTarget {
  constructor(tagName) { super(); this.tagName = tagName; this.children = []; this.value = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('source chooser deduplicates ontology game aliases while exposing other worlds', () => {
  const games = [{ id: 'pokemon-leafgreen-version', name: 'LeafGreen' }, { id: 'pokemon-emerald-version', name: 'Emerald' }, { id: 'super-mario-advance', name: 'Mario' }];
  assert.deepEqual(sourceWorldChoices(['pokemon-leafgreen', 'pokemon-emerald'], games), ['pokemon-leafgreen', 'pokemon-emerald', games[2]]);
  assert.equal(games[0].id, 'pokemon-leafgreen-version');
});

test('snapshot browsing claims metadata only and build requirements retain missing-input status', async t => {
  const original = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = original; });
  const host = new Element('div'), inputs = new Element('div');
  const root = { querySelector: selector => selector.includes('creation-build-inputs') ? inputs : host };
  mountBuildRequirements(root, {
    operations: [{ id: 'sonic-player', backend: 'pokemon-character', required_inputs: [{ id: 'sonic-original', kind: 'original-cartridge', purpose: 'Pixel provenance' }] }],
    backends: [{ id: 'pokemon-character', available: false, missing_inputs: ['sonic-original'] }],
  });
  assert.match(inputs.children[0].textContent, /browsing needs no ROMs/);
  assert.match(inputs.children[1].children[0].textContent, /1 local inputs missing/);
  assert.match(inputs.children[1].children[1].children[0].textContent, /original cartridge: sonic-original — Pixel provenance/);
  assert.match(inputs.children[1].children[2].textContent, /Missing locally: sonic-original/);
  const dispose = mountCreationLibrary(root, { discovery_mode: 'snapshot', counts: { games: 33 } }, async () => ({ items: [{ id: 'mario', label: 'Mario movement', readiness: 'metadata-only' }], total: 1 }));
  const library = host.children[0];
  assert.match(library.children[0].textContent, /metadata snapshot/);
  assert.match(library.children[2].textContent, /have not been checked/);
  library.open = true; library.dispatchEvent(new Event('toggle')); await settle();
  assert.equal(library.children[5].children[0].children[0].children[1].textContent, 'Metadata only · local inputs not checked');
  dispose();
});

test('catalog browsing is lazy, filters all material and references context without rewriting intent or selecting sources', async t => {
  const original = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = original; });
  const host = new Element('div'), intent = new Element('textarea'); intent.value = 'Make a new adventure';
  const root = { querySelector: selector => selector.includes('creation-library') ? host : intent };
  const source = { id: 'mario-movement', kind: 'system', label: 'Mario movement', game_ids: ['sma4'], scope: 'Jump and acceleration rules', executable: false, readiness: 'research-available', provenance: [{ ref: 'ontology/mario.json' }], gaps: ['Needs runtime adapter'] };
  const requests = [], references = new Set();
  const dispose = mountCreationLibrary(root, { games: [{ id: 'sma4', name: 'Super Mario Advance 4' }], categories: [{ id: 'system', label: 'Systems', count: 13 }], counts: { games: 1, systems: 13 } }, async path => { requests.push(path); return { items: [source], total: 13 }; }, references);
  assert.equal(requests.length, 0);
  const library = host.children[0]; library.open = true; library.dispatchEvent(new Event('toggle')); await settle();
  assert.equal(requests.length, 1);
  const filters = library.children[3], game = filters.children[1].children[0], category = filters.children[2].children[0];
  assert.equal(game.children[1].textContent, 'Super Mario Advance 4');
  game.value = 'sma4'; category.value = 'system'; game.dispatchEvent(new Event('change')); await settle();
  assert.match(requests.at(-1), /game=sma4&kind=system/);
  const card = library.children[5].children[0];
  assert.equal(card.children[0].children[1].textContent, 'Source available · integration needed');
  card.children.at(-1).dispatchEvent(new Event('click'));
  assert.equal(intent.value, 'Make a new adventure');
  assert.deepEqual([...references], ['mario-movement']);
  assert.match(library.children[0].textContent, /1 referenced/);
  card.children.at(-1).dispatchEvent(new Event('click')); assert.equal(references.size, 0);
  library.children[6].children[1].dispatchEvent(new Event('click')); await settle(); assert.match(requests.at(-1), /offset=12/);
  dispose();
});
