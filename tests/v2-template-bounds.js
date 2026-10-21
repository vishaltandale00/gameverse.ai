// The template contract's bounds stage (v2/templates/contract.js boundsProblems) over every discovered template, in
// shards: tests/v2-template-bounds-<n>.test.js each play the templates whose index in TEMPLATES is n modulo SHARDS, so
// the bot runs of every bound of every tune entry run in parallel files beside the contract test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boundsProblems } from '../v2/templates/contract.js';
import { TEMPLATES } from '../v2/templates/registry.js';
import { liveCatalogue } from '../v2/planner/catalog.js';

export const SHARDS = 3;
/** @param {number} shard */
export async function boundsShard(shard) {
  const live = await liveCatalogue();
  TEMPLATES.forEach((t, i) => {
    if (i % SHARDS !== shard) return;
    test(`bounds: template ${t.id} is won by its bots at every bound of its tune on world seeds 1-3`, () => {
      const evidence = { bounds: [] };
      const problems = boundsProblems(t, live.registry, live.logic, evidence);
      assert.deepEqual(problems, [], `${t.id}: ${JSON.stringify(problems).slice(0, 800)}`);
      assert.ok(evidence.bounds.every(b => b.ok), JSON.stringify(evidence.bounds).slice(0, 400));
    });
  });
}
