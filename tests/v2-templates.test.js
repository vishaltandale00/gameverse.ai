// The template suite (ARCHITECTURE.md §5): every template is a verified document. Each one preflights against the
// live catalogue, passes the static composition and loop checks, its `tune` names only declared params of its own
// instances, the publish gate finds it viable, and the bot its loop's card names wins it through the controls and
// replays deterministically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, templateById } from '../v2/templates/index.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { checkComposition } from '../v2/planner/compose-check.js';
import { loopProblems } from '../v2/planner/loop-check.js';
import { verifyDocument } from '../v2/planner/verify-adapter.js';
import { maker } from '../v2/verify/drive.js';
import { usedPrimitives } from '../v2/verify/util.js';
import { strategies, select, modeBots } from '../v2/verify/strategies/index.js';

const { registry, logic } = buildCatalogue();
/** Every primitive instance in a document: systems, spaces and their generators. */
export const instancesIn = doc => [...(doc.systems || []), ...(doc.spaces || []), ...(doc.spaces || []).flatMap(s => s.generators || [])];
/** A tune path '<primitive id>.<param>' resolved against the document's instances and the primitive's card. */
export function tuneTarget(doc, path, reg = registry) {
  const uses = new Set(instancesIn(doc).map(i => i.use));
  const use = [...uses].filter(u => path.startsWith(`${u}.`)).sort((a, b) => b.length - a.length)[0];
  if (!use) return null;
  const param = path.slice(use.length + 1), spec = reg.get(use)?.card?.params?.[param];
  return spec ? { use, param, spec, instances: instancesIn(doc).filter(i => i.use === use) } : null;
}
const checked = t => { const r = preflight(structuredClone(t.doc), registry, logic); assert.ok(r.ok, `${t.id}: ${JSON.stringify(r.errors?.slice(0, 5))}`); return r; };
const BOT_OPTS = { 'danger-field': { maxFrames: 15000 }, race: {}, crawl: {}, dodge: { seconds: 60, every: 8 } };

test('templates: unique ids, a one-line concept, a document and declared tune params', () => {
  assert.ok(TEMPLATES.length >= 2);
  assert.equal(new Set(TEMPLATES.map(t => t.id)).size, TEMPLATES.length);
  for (const t of TEMPLATES) {
    assert.equal(templateById(t.id), t);
    assert.ok(typeof t.concept === 'string' && t.concept.length > 10 && !t.concept.includes('\n'), `${t.id}: concept`);
    assert.equal(t.doc.id, t.id, `${t.id}: the document id is the template id`);
    for (const path of t.tune) {
      const target = tuneTarget(t.doc, path);
      assert.ok(target, `${t.id}: tune '${path}' names a param of an instance in the document`);
      assert.ok(['number', 'integer', 'boolean', 'string'].includes(target.spec.type), `${t.id}: tune '${path}' is a scalar (${target.spec.type})`);
      assert.equal(target.instances.length, 1, `${t.id}: tune '${path}' names one instance`);
    }
  }
});

for (const t of TEMPLATES) {
  test(`template ${t.id}: preflight, composition and loop checks pass from declarations`, () => {
    const r = checked(t);
    const c = checkComposition(r.doc, registry, { logic });
    assert.deepEqual(c.failures, [], `${t.id}: ${JSON.stringify(c.failures).slice(0, 600)}`);
    assert.deepEqual(loopProblems(r.doc, registry, { logic }), []);
  });

  test(`template ${t.id}: the publish gate finds it viable`, async () => {
    const v = await verifyDocument(structuredClone(t.doc), registry, logic, { budgetMs: 800, playtestMs: 1500 });
    assert.ok(v.viable, `${t.id}: ${v.viability} ${JSON.stringify((v.problems || []).filter(p => p.severity === 'error')).slice(0, 600)}`);
  });

  test(`template ${t.id}: the bot its loop names wins and replays`, () => {
    const r = checked(t), make = maker(r.doc, registry, logic);
    const ctx = { doc: r.doc, registry, logic, make, seed: 1, capabilities: r.capabilities, used: usedPrimitives(r.doc), playerSpace: make(1).player()?.space ?? r.doc.spaces[0].id };
    const named = modeBots(ctx).map(x => x.s.id);
    assert.ok(named.length, `${t.id}: a loop in the document names its bot (card.mode.bot)`);
    assert.deepEqual(select(ctx).chosen.map(c => c.s.id), named, 'the gate plays the bots the loops name');
    for (const id of named) {
      const bot = strategies.get(id), opts = { budgetMs: 60000, seeds: [1], ...BOT_OPTS[id] };
      const a = bot.run(ctx, opts), b = bot.run(ctx, opts);
      const runs = a.metrics.runs ?? a.metrics.matches;
      assert.equal(a.ok, true, `${t.id} ${id}: ${JSON.stringify(a.problems)}`);
      assert.equal(runs[0].status, 'won', `${t.id} ${id}: the game ended won (${JSON.stringify(runs[0]).slice(0, 300)})`);
      const strip = xs => xs.map(({ budget, ...x }) => x);
      assert.deepEqual(strip(b.metrics.runs ?? b.metrics.matches), strip(runs), `${t.id}: the same document and seed replay to the same result`);
    }
  });
}
