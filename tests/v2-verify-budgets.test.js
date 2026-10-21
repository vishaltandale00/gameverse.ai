// Verdicts never depend on wall time (ARCHITECTURE.md §1 reproducible, §6): every budget that decides what a bot, the
// explorer, the plot solver, the feature checks or the invariants play is counted in states and simulated frames, so the
// same document and seed give the same result on a loaded machine or across a laptop's sleep (a sleep once made the
// shmup's replay check fail). Catalogue-wide over the discovered templates:
//   budget    v2/verify/util.js budget takes no wall-time limit, and meters every frame a world simulates;
//   bots      every strategy that plays a template (the bots its loops name and the ones detection picks) gives the
//             same result for a seed under a tiny ms budget on a clock that jumps an hour on every read and under a
//             huge ms budget on the real clock, with the same step budget;
//   gate      verifyDocument gives the same verdict, problems and feature table on the jumping clock (small stage
//             budgets, to stay lean); the launcher's feature table (its in-flight ability, once decided by wall time)
//             at the gate's own budgets;
//   wall cap  verify's optional wallMs stops whole stages only, and the report says which (budget-limited), never a
//             different verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, templateById } from '../v2/templates/registry.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { verifyDocument } from '../v2/planner/verify-adapter.js';
import { verify, GATE_BUDGET } from '../v2/verify/index.js';
import { budget } from '../v2/verify/util.js';
import { playContext } from '../v2/templates/contract.js';
import { strategies, select, modeBots } from '../v2/verify/strategies/index.js';
import { hostPreflight } from '../v2/verify/controls.js';

const { registry, logic } = buildCatalogue();
/** Results without their wall-time measurements (`ms`: reports of how long, never what was played). */
const timeless = v => JSON.parse(JSON.stringify(v, (k, x) => (k === 'ms' || k === 'wallMs' || k === 'timings' ? undefined : x)));
/** Run `fn` on a clock that jumps an hour every time anything reads it (performance.now and Date.now). */
async function onJumpingClock(fn) {
  const now = performance.now, date = Date.now;
  let t = now.call(performance);
  performance.now = () => (t += 3.6e6);
  Date.now = () => Math.round(t += 3.6e6);
  try { return await fn(); } finally { performance.now = now; Date.now = date; }
}
const STEPS = 600;

test('budget: no wall-time limit is accepted, and a metered world counts every frame it simulates (lookahead included)', () => {
  assert.throws(() => budget({ ms: 100 }), /wall time decides nothing/);
  const b = budget({ steps: 5 }), rt = b.meter({ state: { frame: 0 }, step() { this.state.frame++; } });
  for (let i = 0; i < 4; i++) rt.step({});
  assert.equal(b.over(), false);
  rt.step({});
  assert.equal(b.over(), true); assert.equal(b.hit, 'steps');
  assert.equal(b.meter(rt), rt, 'metering is once per world');
  rt.step({}); assert.equal(b.usedSteps, 6);
});

for (const t of TEMPLATES) test(`bots: every strategy playing ${t.id} gives the same result under a tiny and a huge ms budget with the same step budget`, async () => {
  const ctx = playContext(preflight(structuredClone(t.doc), registry, logic), registry, logic);
  const ids = [...new Set([...modeBots(ctx).map(x => x.s.id), ...select(ctx, { modes: false }).chosen.map(c => c.s.id)])];
  assert.ok(ids.length, `${t.id}: some strategy plays it`);
  for (const id of ids) {
    const s = strategies.get(id), opts = { seeds: [1], maxSteps: STEPS };
    const huge = s.run(ctx, { ...opts, budgetMs: 1e9 });
    const tiny = await onJumpingClock(() => s.run(ctx, { ...opts, budgetMs: 1 }));
    assert.deepEqual(timeless(tiny), timeless(huge), `${t.id}: ${id}`);
  }
});

const SMALL = Object.freeze({ plotStates: 100, plotSteps: 200, playtestRounds: 30, playtestFrames: 600, botSteps: STEPS, featureSteps: 2000, invariantMacros: 15 });
const verdict = v => timeless({ viable: v.viable, viability: v.viability, verified: v.verified, problems: v.problems.map(p => `${p.code} ${p.path} ${p.message}`), features: v.features?.table ?? null });

for (const t of TEMPLATES) test(`gate: ${t.id}'s verdict, problems and feature table are the same on a clock that jumps an hour per read`, async () => {
  const run = () => verifyDocument(structuredClone(t.doc), registry, logic, { playable: true, budget: SMALL });
  const a = await run(), b = await onJumpingClock(run);
  assert.deepEqual(verdict(b), verdict(a), t.id);
});

test('gate: the launcher\'s feature table (its in-flight ability) is the same under a tiny and a huge ms budget at the gate\'s budgets', async () => {
  const doc = hostPreflight(templateById('launcher').doc, registry, logic).doc;
  const run = budgetMs => verify(doc, registry, logic, { seed: doc.seed, budgetMs, playtest: {}, strategies: {} });
  const huge = await run(1e9), tiny = await onJumpingClock(() => run(1));
  assert.ok(huge.features?.table?.length, 'the gate ran its feature checks');
  assert.deepEqual(timeless(tiny.features), timeless(huge.features));
  assert.deepEqual(huge.budget, { ...GATE_BUDGET });
});

test('wall cap: verify stops only whole stages when its wallMs passes, and says which (budget-limited, not a verdict)', async () => {
  const doc = hostPreflight(templateById('farm').doc, registry, logic).doc;
  const r = await onJumpingClock(() => verify(doc, registry, logic, { seed: doc.seed, wallMs: 1000, budget: SMALL }));
  assert.ok(r.budgetLimited.length > 0, 'the jumping clock passes the cap');
  const capped = r.problems.find(p => p.code === 'budget_exhausted' && p.wall);
  assert.deepEqual(capped?.skipped, r.budgetLimited, 'the report names every stage the cap stopped');
  assert.equal(r.plot, null, 'a stopped stage did not run at all');
  const v = await onJumpingClock(() => verifyDocument(structuredClone(templateById('farm').doc), registry, logic, { playable: true, budget: SMALL, wallMs: 1000 }));
  assert.equal(v.viable, false);
  assert.match(v.viability, /^budget_limited: /);
});
