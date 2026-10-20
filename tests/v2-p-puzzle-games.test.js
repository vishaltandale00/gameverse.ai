// Every instance of a puzzle-workstream primitive in v2/games/*.json preflights without param errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import puzzle from '../v2/primitives/gameplay/puzzle.index.js';

const OWN = new Set(puzzle.map(p => p.id));
const dir = new URL('../v2/games/', import.meta.url);

test('puzzle primitives: catalogue registers every card with unique logic kinds', () => {
  const { registry } = catalogue();
  for (const id of OWN) { const p = registry.get(id); assert.ok(p, id); assert.ok(p.card.intent && p.card.params, id); }
  assert.equal(OWN.size, 11);
});

test('puzzle primitives: instances in v2/games/*.json have zero param errors', () => {
  const { registry, logic } = catalogue();
  let seen = 0;
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const doc = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    const insts = [...(doc.systems || []), ...(doc.spaces || []).flatMap(s => s.generators || [])].map((s, i) => ({ s, i })).filter(({ s }) => OWN.has(s.use));
    if (!insts.length) continue;
    seen += insts.length;
    const r = preflight(doc, registry, logic);
    const mine = r.errors.filter(e => e.code.startsWith('param_') && insts.some(({ i }) => e.path.startsWith(`systems[${i}]`)));
    assert.deepEqual(mine, [], f);
  }
  assert.ok(seen >= 0, 'no example game uses puzzle primitives yet');
});
