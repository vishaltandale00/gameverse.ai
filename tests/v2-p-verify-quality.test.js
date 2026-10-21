// Quality report (v2/verify/quality.js) and the playtest data it reuses (v2/verify/playtest.js): event counts
// over the whole search, the progress timeline, the archive sample, and a non-blocking report whose unmeasured
// values are null. Real generated documents from tests/fixtures/v2-live, engaged as the pipeline does. Offline,
// no model calls; search budgets bind on rounds, never on wall time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { engageDocument } from '../v2/planner/engage.js';
import { preflight } from '../v2/kernel/document.js';
import { playtest, replayPlay } from '../v2/verify/playtest.js';
import { quality, QUALITY_CODES } from '../v2/verify/quality.js';
import { maker } from '../v2/verify/drive.js';
import { stateHash } from '../v2/verify/util.js';
import { qualityReport, summarizeVerify } from '../v2/planner/kernel-pipeline.js';
import { viability } from '../v2/planner/verify-adapter.js';

const { registry, logic } = buildCatalogue();
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/v2-live/${name}.json`, import.meta.url), 'utf8'));
const docs = new Map();
const engaged = name => {
  if (!docs.has(name)) { const f = fixture(name); docs.set(name, { doc: preflight(engageDocument(f.doc, registry, logic).doc, registry, logic).doc, mechanics: f.report.selection.mechanics }); }
  return docs.get(name);
};
const BOUNDED = { budgetMs: Infinity, maxRounds: 24 };
const runs = new Map();
const play = name => { if (!runs.has(name)) { const { doc } = engaged(name); runs.set(name, playtest(doc, registry, logic, { seed: doc.seed, ...BOUNDED })); } return runs.get(name); };
const SECTIONS = ['agency', 'coverage', 'progression', 'pacing', 'deadTime', 'variety', 'budget', 'exhaustive'];
const stable = q => JSON.parse(JSON.stringify(q, (k, v) => (k === 'ms' ? undefined : v)));

test('playtest counts every event of the search, not only the last frame of each macro', () => {
  const pt = play('kart');
  // These fire on the first frames of a macro (boarding, the race countdown, the opening beat), never on its last.
  for (const name of ['vehicle_entered', 'race_countdown', 'beat', 'spawn']) assert.ok(pt.eventsFired[name] >= 1, `${name}: ${JSON.stringify(pt.eventsFired).slice(0, 300)}`);
  assert.ok(Object.values(pt.eventsFired).every(n => Number.isInteger(n) && n > 0));
  assert.ok(Object.keys(pt.verbsUsed).length > 0, 'verbs the search pressed are kept');
});

test('playtest returns a frame-level timeline of the best path and a small archive sample that replays', () => {
  const pt = play('kart'), { doc } = engaged('kart');
  const tl = pt.timeline;
  assert.ok(tl && tl.frames > 0, 'a timeline');
  assert.equal(tl.source, pt.winnable ? 'win' : 'best');
  assert.ok(!('rt' in tl), 'no world is kept in the report');
  assert.ok(tl.marks.every((m, i, all) => m.f >= 0 && m.f <= tl.frames && (!i || m.f > all[i - 1].f) && typeof m.e === 'string'), 'marks ordered, one per frame');
  assert.ok(tl.marks.some(m => m.e === 'beat'), 'the opening beat is a progress mark');
  assert.ok(tl.cells >= 1 && tl.zones.length >= 1 && tl.labels.length >= 1);
  assert.ok(pt.sample.length >= 2 && pt.sample.length <= 7, `sample ${pt.sample.length}`);
  assert.deepEqual(pt.sample[0].path, [], 'the start cell comes first');
  const make = maker(doc, registry, logic);
  for (const c of pt.sample.slice(1, 3)) assert.equal(stateHash(replayPlay(make, doc.seed, c.path).snapshot()), stateHash(c.snap), `${c.key} replays to its snapshot`);
  // Same document, seed and rounds: the same timeline.
  assert.deepEqual(playtest(doc, registry, logic, { seed: doc.seed, ...BOUNDED }).timeline, tl);
});

test('quality: every section is measured on a playable document, findings are info with stable codes', () => {
  const { doc, mechanics } = engaged('kart');
  const q = quality(doc, registry, logic, { playtest: play('kart'), mechanics, budgetMs: Infinity });
  for (const k of SECTIONS) assert.ok(k in q, k);
  assert.equal(q.exhaustive, false);
  assert.deepEqual(q.unmeasured, {});
  assert.ok(q.agency.choices > 0 && q.agency.share > 0 && q.agency.share <= 1, JSON.stringify(q.agency));
  assert.ok(q.agency.verbs.drive?.effective > 0, 'driving changes the game');
  assert.equal(q.coverage.mechanics, mechanics.length);
  assert.ok(q.coverage.items.find(m => m.id === 'race_karts').exercised, 'the race is exercised');
  assert.ok(q.pacing.longestGap > 0 && q.deadTime.share >= 0 && q.variety.perMinute.cells > 0);
  assert.equal(q.budget.playtest, 'reused');
  for (const f of q.findings) {
    assert.equal(f.severity, 'info');
    assert.ok(QUALITY_CODES[f.code], `stable code ${f.code}`);
    assert.equal(typeof f.path, 'string');
  }
  assert.deepEqual(stable(quality(doc, registry, logic, { playtest: play('kart'), mechanics, budgetMs: Infinity })), stable(q), 'deterministic');
});

test('quality: what was not measured is null, never 0', () => {
  // The live platformer is lost on its first frame: no path survives past the start.
  const { doc, mechanics } = engaged('platformer');
  const q = quality(doc, registry, logic, { playtest: play('platformer'), mechanics, budgetMs: Infinity });
  for (const k of ['progression', 'pacing', 'deadTime', 'variety']) { assert.equal(q[k], null, k); assert.equal(typeof q.unmeasured[k], 'string'); }
  assert.ok(q.agency, 'agency is still measured at the start cell');
  assert.ok(q.findings.some(f => f.code === 'agency_low'));
  // No mechanics, no time: coverage and agency are unmeasured, not zero.
  const none = quality(engaged('kart').doc, registry, logic, { playtest: play('kart'), budgetMs: 0 });
  assert.equal(none.coverage, null);
  assert.equal(none.agency, null);
  assert.match(none.unmeasured.agency, /budget/);
  assert.equal(none.budget.truncated, true);
});

test('pipeline: quality never blocks; summarizeVerify keeps playtest and quality', () => {
  const { doc, mechanics } = engaged('kart');
  const pt = play('kart');
  const v = { ok: true, source: 'verify', doc, playtest: { winnable: pt.winnable, timeline: pt.timeline }, problems: [] };
  Object.defineProperty(v, 'playtestRun', { value: pt, enumerable: false });
  const q = qualityReport(v, registry, logic, { mechanics, budgetMs: 1e9 });
  assert.ok(q.agency && Number.isInteger(q.ms));
  const s = summarizeVerify(v);
  assert.equal(s.quality, q);
  assert.equal(s.playtest, v.playtest);
  assert.ok(!JSON.stringify(s).includes('"snap"'), 'no snapshots in the report');
  // A quality failure is a note, not an exception; quality off is null.
  const broken = qualityReport({ doc: { ...doc, spaces: null } }, registry, logic, { budgetMs: 50 });
  assert.equal(typeof broken.error, 'string');
  assert.equal(qualityReport(v, registry, logic, { budgetMs: 0 }), null);
  // The publish gate only looks at crash codes: quality findings cannot reach it.
  assert.deepEqual(viability(pt, q.findings.map(f => ({ ...f, severity: 'error' }))), { viable: true, viability: null });
});
