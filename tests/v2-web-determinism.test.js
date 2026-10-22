// The browser runs the game the gate verified (ARCHITECTURE §2: the same simulation runs headless for verification
// and in the browser for play). For every template, the winning run of the bot its loops name (seed SEEDS[0], through
// the controls: v2/verify/controls.js) is recorded as the kernel input of each step, then replayed in the real browser
// host (v2/web/player.js mountGame in the fake browser of tests/v2-web-host.js, graphics and UI mounted, not
// headless): the state after every step equals the headless state frame by frame, and the browser run wins too.
//
// Cost: one bot run per template on one seed (the template contract plays three seeds twice) plus one headless and
// one browser replay of the winning run; the file runs in its own process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { installBrowser } from './v2-web-host.js';
import { TEMPLATES } from '../v2/templates/registry.js';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { hostPreflight, controlled } from '../v2/verify/controls.js';
import { createWorld } from '../v2/kernel/world.js';
import { strategies, modeBots } from '../v2/verify/strategies/index.js';
import { usedPrimitives } from '../v2/verify/util.js';
import { SEEDS, BOT_OPTS, BOT_STEPS } from '../v2/templates/contract.js';

const B = installBrowser();
test.after(() => B.restore());
const { mountGame, loadPromoted } = await import('../v2/web/player.js');
await loadPromoted();
const { registry, logic } = await liveCatalogue();
const SEED = SEEDS[0];
// Object key order is not game state: states are compared as canonical JSON (keys sorted), as deepStrictEqual does.
const canonical = v => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null');
const hash = state => createHash('sha1').update(canonical(state)).digest('hex');
const flush = () => new Promise(r => setImmediate(r));

/**
 * Play the document's named bots headless through the controls and return a winning run as the kernel input of each
 * step. Each world keeps its steps as a chain; a snapshot remembers the chain it was taken at and a restore goes back
 * to it, so a bot's lookahead and retries leave only the steps of the line it played.
 */
function winningRun(doc) {
  const host = hostPreflight(doc, registry, logic);
  assert.ok(host.ok, JSON.stringify(host.errors?.slice(0, 3)));
  const chainAt = new WeakMap(), worlds = [];
  const make = seed => {
    const rt = createWorld(host.doc, registry, logic, { seed, headless: true });
    const w = { seed, rt, node: null, foreign: 0 };
    const step = rt.step.bind(rt), snapshot = rt.snapshot.bind(rt), restore = rt.restore.bind(rt);
    let parts = null;
    rt.step = input => { if (rt.state.status === 'playing') w.node = { input: structuredClone(input), parts, frame: rt.state.frame, prev: w.node }; return step(input); };
    rt.snapshot = () => { const s = snapshot(); chainAt.set(s, w.node); return s; };
    rt.restore = s => { if (chainAt.has(s)) w.node = chainAt.get(s); else w.foreign++; return restore(s); };
    worlds.push(w);
    // Each step's two channels: what the devices give (view.input) and what mounted UI sends (view.act).
    const c = controlled(rt, registry), driven = c.step;
    c.step = (intent = {}) => { parts = rt.state.status === 'playing' ? structuredClone(c.controls.parts(intent)) : null; return driven(intent); };
    return c;
  };
  const docBefore = canonical(host.doc);
  const ctx = { doc: host.doc, registry, logic, make, seed: SEED, capabilities: host.capabilities, used: usedPrimitives(host.doc) };
  ctx.playerSpace = make(SEED).player()?.space ?? host.doc.spaces[0].id;
  for (const { s } of modeBots(ctx)) {
    strategies.get(s.id).run(ctx, { maxSteps: BOT_STEPS, seeds: [SEED], ...BOT_OPTS[s.id] });
    assert.equal(canonical(host.doc), docBefore, 'playing changes no document: every world owns its copy');
    const won = worlds.find(w => w.seed === SEED && w.rt.state.status === 'won' && !w.foreign);
    if (!won) continue;
    const steps = []; for (let n = won.node; n; n = n.prev) steps.push(n); steps.reverse();
    assert.ok(steps.every((n, i) => n.frame === i), 'the winning line is one step per frame from the start');
    return { bot: s.id, doc: host.doc, inputs: steps.map(n => n.input), parts: steps.map(n => n.parts) };
  }
  return null;
}

/** The headless states of a run: the hash after each step (index = frame), and the final status. */
function headless(doc, inputs) {
  const rt = createWorld(doc, registry, logic, { seed: SEED, headless: true });
  const hashes = [hash(rt.state)];
  for (const input of inputs) { if (rt.state.status !== 'playing') break; rt.step(input); hashes.push(hash(rt.state)); }
  return { hashes, status: rt.state.status, frames: rt.state.frame, at: f => { const r = createWorld(doc, registry, logic, { seed: SEED, headless: true }); for (const i of inputs.slice(0, f)) r.step(i); return r.state; } };
}

/** The first paths where two states differ (for the failure message). */
function differences(a, b, path = 'state', out = []) {
  if (out.length >= 6) return out;
  if (canonical(a) === canonical(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[k], b[k], `${path}.${k}`, out); return out; }
  out.push(`${path}: headless ${JSON.stringify(a)?.slice(0, 80)} / browser ${JSON.stringify(b)?.slice(0, 80)}`);
  return out;
}

// The UI lists the options every display frame and bots list them whenever they decide: listing is a read.
test('listing options changes no state, for every template host document (at the start and in play)', () => {
  const writes = [];
  for (const t of TEMPLATES) {
    const host = hostPreflight(t.doc, registry, logic), rt = createWorld(host.doc, registry, logic, { seed: SEED, headless: true });
    for (const steps of [0, 60]) {
      for (let i = 0; i < steps && rt.state.status === 'playing'; i++) rt.step({});
      const before = structuredClone(rt.state);
      rt.availableOptions();
      for (const d of differences(before, rt.state)) writes.push(`${t.id} at frame ${rt.state.frame}: ${d}`);
    }
  }
  assert.deepEqual(writes, []);
});

for (const t of TEMPLATES) {
  test(`determinism ${t.id}: the bot's winning run replayed in the browser host equals the headless run frame by frame`, async () => {
    const run = winningRun(t.doc);
    assert.ok(run, `a bot its loops name wins on seed ${SEED}`);
    const ref = headless(run.doc, run.inputs);
    assert.equal(ref.status, 'won', 'the recorded run wins headless');
    const g = mountGame(B.container, { doc: t.doc, version: 1 }, { now: B.now, seed: SEED });
    try {
      await flush();
      const mismatch = [];
      // The devices give each step's recorded device sample (standing in for engine.input.actions' sampler, behind
      // the UI's gate as for a person); the UI actions of the step reach it as view.act's do (merged into the step);
      // the host's pacing, holds and every mounted graphics primitive are as a person has them.
      g.rt.view.input = () => run.parts[g.rt.state.frame]?.device ?? {};
      const rt = g.rt, step = rt.step.bind(rt);
      rt.step = (input = {}) => {
        const f = rt.state.frame;
        if (rt.state.status === 'playing' && !mismatch.length && hash(rt.state) !== ref.hashes[f]) mismatch.push(f, structuredClone(rt.state));
        return step({ ...input, actions: { ...(input.actions || {}), ...(run.parts[f]?.ui || {}) } });
      };
      if (g.rt.view.paused) { B.key('Enter'); B.keyup('Enter'); }
      for (let i = 0; i < 20 * run.inputs.length && g.rt.state.status === 'playing' && !mismatch.length; i++) B.frame(g.rt.view.paused ? 50 : 100);
      const f = g.rt.state.frame;
      if (!mismatch.length && hash(g.rt.state) !== ref.hashes[f]) mismatch.push(f, structuredClone(g.rt.state));
      if (mismatch.length) {
        const at = mismatch[0];
        assert.fail(`${run.bot}: the browser state differs from the headless state at frame ${at} of ${run.inputs.length}:\n${differences(ref.at(at), mismatch[1]).join('\n')}`);
      }
      assert.equal(f, ref.frames, `the browser run ends where the headless one does (stopped at frame ${f}, paused ${g.rt.view.paused}, modal ${g.rt.view.modal})`);
      assert.equal(g.rt.state.status, 'won', 'and wins');
    } finally { g.dispose(); }
    assert.deepEqual(B.held(), []);
  });
}
