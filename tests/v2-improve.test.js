// Tier-4 promotion jobs (v2/improve): lifecycle, timing records, the job's own verification gate,
// bounded repairs, cancel, admission, apply and the scope gate. Fake runner only: no CLI, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createImprovementService, scopeCheck } from '../v2/improve/promote.js';
import { resolveConfig, LOOP_CONFIG } from '../v2/improve/config.js';
import { createFakeRunner, goodChanges } from '../v2/improve/runners/fake.js';
import { claudeArgs, streamParser } from '../v2/improve/runners/local-claude.js';
import { redact } from '../v2/improve/runners/proc.js';

const tmp = mkdtempSync(join(os.tmpdir(), 'gv-improve-test-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid' } }).trim();
let n = 0;
function repo() {
  const dir = join(tmp, `repo-${++n}`);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  writeFileSync(join(dir, 'README'), 'base\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}
const experiment = { id: 'exp-frost-zone', label: 'Frost zone', request: 'a zone that freezes hunters', code: 'export default { label: "Frost zone", init: () => ({}), step: s => ({ state: s, ops: [] }), draw: () => [] };' };
// Only tests that inspect branches pay for a git repo; the rest run the fake runner without git.
const plain = () => { const dir = join(tmp, `dir-${++n}`); mkdirSync(dir, { recursive: true }); return dir; };
const service = (opts = {}) => {
  const root = opts.root || (opts.git ? repo() : plain());
  const runner = createFakeRunner({ repo: opts.git ? root : null, ...opts.runner });
  return { root, runner, svc: createImprovementService({ root, runner, dataDir: join(root, 'local-data/v2/improve'), config: { limits: { maxRepairAttempts: 2, ...opts.limits }, ...opts.config } }) };
};
const start = (svc, extra = {}) => svc.start({ experiment, kitId: 'maze', gameId: 'game-1', ...extra });
const gate = () => { let open; const p = new Promise(r => { open = r; }); return { p, open }; };
const until = async (fn, ms = 1000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw Error('timed out waiting'); await new Promise(r => setTimeout(r, 2)); } };

test('a job runs queued → preparing → coding → verifying → succeeded and records its timings and context', async () => {
  const { root, svc } = service({ git: true });
  const states = [];
  svc.subscribe(e => { if (e.type === 'improve_state' || e.type === 'improve_done') states.push(e.state); });
  const job = await start(svc, { userId: 'u1', gameVersion: 'v3' });
  assert.equal(job.state === 'queued' || job.state === 'preparing', true);
  assert.equal(job.modId, 'exp-frost-zone');
  const done = await svc.wait(job.id);
  assert.equal(done.state, 'succeeded', done.reason);
  assert.deepEqual(states, ['preparing', 'coding', 'verifying', 'succeeded']);
  const r = done.report;
  for (const k of ['queueMs', 'preparingMs', 'codingMs', 'verifyingMs', 'runMs', 'totalMs']) assert.ok(Number.isFinite(r[k]) && r[k] >= 0, `${k} measured`);
  assert.equal(r.attempts, 1); assert.equal(r.repairs, 0); assert.equal(r.outcome, 'succeeded');
  assert.equal(r.sourceCommit, git(root, 'rev-parse', 'HEAD'));
  assert.equal(r.kitId, 'maze'); assert.match(r.kitVersion, /^\d+\.\d+\.\d+$/); assert.equal(r.gameVersion, 'v3');
  assert.deepEqual(r.loopConfig, { id: LOOP_CONFIG.id, version: LOOP_CONFIG.version });
  assert.equal(r.runner.id, 'fake'); assert.ok(r.machine.platform && r.machine.node); assert.ok(r.toolchain);
  assert.deepEqual(Object.keys(r.unavailable), [], 'everything was measured');
  assert.equal(r.agentTurns, 3); assert.equal(r.reportedCostUsd, 0.01);
  assert.deepEqual(r.filesChanged.sort(), ['tests/v2-mods-exp-frost-zone.test.js', 'v2/kits/mods/exp-frost-zone.js', 'v2/kits/mods/index.js']);
  assert.equal(done.result.branch, `improve/${job.id}`);
  assert.equal(git(root, 'rev-parse', `refs/heads/improve/${job.id}`), done.result.commit, 'the branch is kept on success');
  // The job's own verification ran every configured command plus the scope gate.
  assert.deepEqual(done.attempts[0].verify.checks.map(c => c.id), ['scope', ...LOOP_CONFIG.verification.map(c => c.id)]);
  const dir = join(root, 'local-data/v2/improve', job.id);
  const saved = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
  assert.equal(saved.report.outcome, 'succeeded');
  const events = svc.eventsOf(job.id).map(e => e.type);
  assert.equal(events[0], 'improve_queued'); assert.equal(events.at(-1), 'improve_done');
  assert.ok(existsSync(join(dir, 'logs', 'prompt-0.txt')) && existsSync(join(dir, 'experiment.json')));
});

test('the verification gate: a failing test fails the job, and the failed job is kept', async () => {
  const { root, runner, svc } = service({ git: true, limits: { maxRepairAttempts: 0 }, runner: { verify: ({ argv }) => argv.includes('tests/v2-kits-contract.test.js') ? { code: 1, stdout: 'not ok 3 - maze: contract' } : { code: 0 } } });
  const job = await start(svc);
  const done = await svc.wait(job.id);
  assert.equal(done.state, 'failed');
  assert.match(done.reason, /verification failed after 1 attempt\(s\): kits-contract/);
  assert.deepEqual(runner.calls.finalize, [{ success: false }], 'cleanup ran, nothing committed');
  assert.throws(() => git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/improve/${job.id}`));
  // Retained after a restart: a new service over the same data dir lists it with its report.
  const again = createImprovementService({ root, runner: createFakeRunner({}), dataDir: join(root, 'local-data/v2/improve') });
  const kept = again.status(job.id);
  assert.equal(kept.state, 'failed'); assert.equal(kept.report.outcome, 'failed');
  assert.ok(Number.isFinite(kept.report.verifyingMs));
  assert.match(readFileSync(join(kept.logs.dir, 'verify-0.log'), 'utf8'), /not ok 3 - maze: contract/);
});

test('repairs are bounded by the config, resume the session and carry the job’s own failure output', async () => {
  const failFirst = k => ({ verify: ({ argv, attempt }) => attempt < k && argv.some(a => /v2-mods-.*\.test\.js$/.test(a)) ? { code: 1, stdout: `assertion failed in attempt ${attempt}` } : { code: 0 } });
  const a = service({ limits: { maxRepairAttempts: 2 }, runner: failFirst(2) });
  const ok = await a.svc.wait((await start(a.svc)).id);
  assert.equal(ok.state, 'succeeded', ok.reason);
  assert.equal(ok.report.attempts, 3); assert.equal(ok.report.repairs, 2);
  assert.equal(a.runner.calls.code[1].resumeSession, `session-${ok.id}`, 'a repair continues the session');
  assert.match(a.runner.calls.code[1].prompt, /mod-tests failed[\s\S]*assertion failed in attempt 0/);
  assert.deepEqual(ok.report.perAttempt.map(p => p.ok), [false, false, true]);

  const b = service({ limits: { maxRepairAttempts: 1 }, runner: failFirst(2) });
  const failed = await b.svc.wait((await start(b.svc)).id);
  assert.equal(failed.state, 'failed');
  assert.equal(b.runner.calls.code.length, 2, 'one first attempt plus one repair, then stop');
  assert.match(failed.reason, /after 2 attempt\(s\): mod-tests/);

  // A repair round that changes nothing (the failure is outside what the agent may edit) stops the job early.
  const stuck = service({ limits: { maxRepairAttempts: 2 }, runner: { attempts: [{ changes: job => goodChanges(job.modId) }], verify: ({ argv }) => argv.includes('tests/v2-mods.test.js') ? { code: 1 } : { code: 0 } } });
  const st = await stuck.svc.wait((await start(stuck.svc)).id);
  assert.equal(st.state, 'failed');
  assert.equal(stuck.runner.calls.code.length, 2);
  assert.match(st.reason, /mods \(stopped early: the repair round left the diff unchanged\)/);
});

test('cancel stops a running job and a queued one; both are kept with unmeasured phases marked unavailable', async () => {
  const g = gate();
  const { runner, svc } = service({ runner: { attempts: [{ gate: g.p }] } });
  const running = await start(svc);
  const queued = await start(svc, { gameId: 'game-2' }); // global cap of 1: waits
  await until(() => svc.status(running.id).state === 'coding');
  assert.equal(svc.status(queued.id).state, 'queued');
  assert.equal(svc.status(queued.id).queuePosition, 1);
  assert.equal(svc.cancel(queued.id).state, 'cancelled');
  const q = svc.status(queued.id);
  assert.equal(q.reason, 'cancelled before it started');
  assert.equal(q.report.preparingMs, null); assert.ok(q.report.unavailable.preparingMs && q.report.unavailable.codingMs && q.report.unavailable.runMs);
  svc.cancel(running.id);
  const done = await svc.wait(running.id);
  assert.equal(done.state, 'cancelled');
  assert.ok(Number.isFinite(done.report.codingMs)); assert.equal(done.report.verifyingMs, null);
  assert.match(done.report.unavailable.verifyingMs, /before verifying/);
  assert.deepEqual(runner.calls.finalize, [{ success: false }], 'the workspace was cleaned up');
  assert.equal(svc.list().length, 2);
});

test('one active job per user and per game; others queue in order', async () => {
  const gates = new Map();
  const gateFor = job => { if (!gates.has(job.id)) gates.set(job.id, gate()); return gates.get(job.id).p; };
  const { svc } = service({ limits: { maxActiveJobs: 3 }, runner: { attempts: [{ gate: gateFor }] } });
  const order = [];
  svc.subscribe(e => { if (e.type === 'improve_state' && e.state === 'preparing') order.push(e.jobId); });
  const a = await svc.start({ experiment, kitId: 'maze', gameId: 'g1', userId: 'u1' });
  const b = await svc.start({ experiment, kitId: 'maze', gameId: 'g1', userId: 'u2' }); // same game as a: queues
  const c = await svc.start({ experiment, kitId: 'maze', gameId: 'g2', userId: 'u1' }); // same user as a: queues
  const d = await svc.start({ experiment, kitId: 'maze', gameId: 'g3', userId: 'u3' }); // independent: runs now
  await until(() => gates.size === 2);
  assert.deepEqual(order, [a.id, d.id]);
  assert.equal(svc.status(b.id).state, 'queued'); assert.equal(svc.status(c.id).state, 'queued');
  gates.get(a.id).open(); await svc.wait(a.id);
  await until(() => gates.size === 4); // a's slot frees both b (game g1) and c (user u1)
  assert.deepEqual(order, [a.id, d.id, b.id, c.id]);
  for (const g of gates.values()) g.open();
  const all = await Promise.all([a, b, c, d].map(j => svc.wait(j.id)));
  assert.deepEqual(all.map(j => j.state), ['succeeded', 'succeeded', 'succeeded', 'succeeded']);
  assert.ok(all.every(j => Number.isFinite(j.report.queueMs)));
  assert.ok(all[1].report.queueMs >= all[0].report.queueMs, 'a queued job records its wait');
});

test('apply fast-forwards only succeeded jobs, only when possible, and never pushes', async () => {
  const { root, svc } = service({ git: true, limits: { maxRepairAttempts: 0 }, runner: { verify: ({ job }) => (job.gameId === 'bad' ? { code: 1 } : { code: 0 }) } });
  const bad = await svc.wait((await start(svc, { gameId: 'bad' })).id);
  assert.equal(bad.state, 'failed');
  assert.match((await svc.apply(bad.id)).reason, /only a succeeded job can be applied \(this one is failed\)/);
  assert.match((await svc.apply('nope-0000')).reason, /no such job/);

  const good = await svc.wait((await start(svc, { gameId: 'g-ok' })).id);
  const applied = await svc.apply(good.id);
  assert.equal(applied.ok, true, applied.reason);
  assert.equal(applied.into, 'main');
  assert.equal(git(root, 'rev-parse', 'HEAD'), good.result.commit);
  assert.ok(existsSync(join(root, 'v2/kits/mods/exp-frost-zone.js')));
  assert.match((await svc.apply(good.id)).reason, /already applied/);

  const later = await svc.wait((await start(svc, { gameId: 'g-later' })).id);
  assert.equal(later.state, 'succeeded');
  writeFileSync(join(root, 'README'), 'moved on\n'); git(root, 'commit', '-qam', 'main moves on');
  const head = git(root, 'rev-parse', 'HEAD');
  const refused = await svc.apply(later.id);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /not a fast-forward/);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head, 'the checkout is untouched');
  assert.equal(git(root, 'remote'), '', 'no remotes were involved');
});

test('a result that touches files outside the allowed scope, or edits an existing test, is refused', async () => {
  const outside = job => [...goodChanges(job.modId), { path: 'v2/kits/maze/index.js', status: 'M' }];
  const { runner, svc } = service({ limits: { maxRepairAttempts: 0 }, runner: { attempts: [{ changes: outside }] } });
  const done = await svc.wait((await start(svc)).id);
  assert.equal(done.state, 'failed');
  assert.match(done.reason, /^refused: v2\/kits\/maze\/index\.js: outside the allowed paths/);
  assert.equal(runner.calls.exec.length, 0, 'no verification command runs on a refused result');
  assert.ok(done.result.files.some(f => f.path === 'v2/kits/maze/index.js'), 'the change list is recorded');

  const s = scopeCheck([...goodChanges('m'), { path: 'tests/v2-mods.test.js', status: 'M' }], LOOP_CONFIG.scope, 'm');
  assert.equal(s.ok, false); assert.match(s.problems[0], /tests\/v2-mods\.test\.js: modifies an existing file/);
  assert.match(scopeCheck([], LOOP_CONFIG.scope, 'm').problems.join('\n'), /missing deliverable: new file v2\/kits\/mods\/m\.js/);
  // Explicitly allowed by config: recorded rather than refused.
  const allowed = service({ config: { scope: { allowOutside: true } }, runner: { attempts: [{ changes: job => [...goodChanges(job.modId), { path: 'docs/x.md', status: 'A' }] }] } });
  const ok = await allowed.svc.wait((await start(allowed.svc)).id);
  assert.equal(ok.state, 'succeeded', ok.reason);
  assert.deepEqual(ok.result.outsideScopeAllowed, ['docs/x.md']);
});

test('the loop config is versioned and bounded; the CLI invocation honors it; logs are redacted', () => {
  assert.throws(() => resolveConfig({ limits: { codingTimeoutMs: Infinity } }), /finite positive/);
  assert.throws(() => resolveConfig({ limits: { maxAgentTurns: 0 } }), /finite positive/);
  assert.throws(() => resolveConfig({ limits: { maxRepairAttempts: 1.5 } }), /maxRepairAttempts/);
  const cfg = resolveConfig({ limits: { maxAgentTurns: 7 } });
  const args = claudeArgs(cfg, { resumeSession: 'abc' });
  assert.deepEqual(args.slice(0, 4), ['-p', '--output-format', 'stream-json', '--verbose']);
  assert.equal(args[args.indexOf('--max-turns') + 1], '7');
  assert.equal(args[args.indexOf('--resume') + 1], 'abc');
  assert.deepEqual(args.slice(args.indexOf('--allowedTools') + 1), cfg.agent.allowedTools);
  assert.ok(cfg.agent.allowedTools.every(t => !/^Bash$|^Bash\(\*\)$|git|curl|rm /.test(t)), 'no unrestricted shell');
  const progress = [];
  const p = streamParser({ onProgress: e => progress.push(e) });
  p.line(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'm' }));
  p.line(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'v2/kits/mods/x.js' } }] } }));
  p.line('not json');
  p.line(JSON.stringify({ type: 'result', num_turns: 4, total_cost_usd: 0.2, is_error: false, session_id: 's1', subtype: 'success' }));
  assert.equal(p.out.result.num_turns, 4); assert.equal(p.out.sessionId, 's1');
  assert.deepEqual(progress, [{ kind: 'tool', tool: 'Edit', target: 'v2/kits/mods/x.js' }]);
  assert.equal(redact('key sk-ant-api03-abcdefghijklmnop and Bearer abcdefghijklmnopqrstuvwxyz'), 'key [redacted] and [redacted]');
  assert.equal(redact('"access_token": "abcdefghijkl12345"'), '"access_token": [redacted]');
});

test('the Daytona runner drives create → install → hydrate → agent → verify → diff → delete over its transport', async () => {
  const { createDaytonaRunner } = await import('../v2/improve/runners/daytona.js');
  const { runtimeRoot, authPath } = await import('../infra/cloudflare/claude-runtime.js');
  const root = repo();
  // The patch the "sandbox" will produce: the three deliverables against the repo's HEAD.
  for (const f of goodChanges('exp-frost-zone')) { execFileSync('mkdir', ['-p', join(root, f.path, '..')]); writeFileSync(join(root, f.path), f.content); }
  git(root, 'add', '-A');
  const patch = execFileSync('git', ['diff', '--cached', '--binary', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const names = execFileSync('git', ['diff', '--cached', '--name-status', 'HEAD'], { cwd: root, encoding: 'utf8' });
  git(root, 'reset', '-q', '--hard');
  const secret = 'sk-ant-oat01-SECRETSECRETSECRET';
  const files = new Map(), calls = [];
  let polls = 0, deleted = false;
  const put = (p, s) => files.set(p, new TextEncoder().encode(s));
  const transport = {
    async create(name, o) { calls.push(['create', name, o]); return { id: 'sb1', state: 'creating' }; },
    async get() { return deleted ? null : { id: 'sb1', state: polls++ ? 'started' : 'creating' }; },
    async delete(name) { calls.push(['delete', name]); deleted = true; },
    async upload(sb, path, bytes) { calls.push(['upload', path]); files.set(path, bytes); },
    async download(sb, path) { return files.get(path) ?? null; },
    async execute(sb, cmd, timeout) {
      calls.push(['execute', cmd, timeout]);
      const n = cmd.match(/agent\.mjs (\d+)/)?.[1];
      if (n != null) {
        put(`${runtimeRoot}/agent-${n}.jsonl`, [JSON.stringify({ type: 'system', subtype: 'init', session_id: 'S' }), JSON.stringify({ type: 'result', num_turns: 5, total_cost_usd: 0.4, is_error: false, session_id: 'S', subtype: 'success', result: `done ${secret}` })].join('\n'));
        put(`${runtimeRoot}/agent-status.json`, JSON.stringify({ phase: 'finished', attempt: Number(n), exit_code: 0 }));
      }
      if (cmd.startsWith('tail -c')) files.set(`${runtimeRoot}/agent-tail.jsonl`, files.get(`${runtimeRoot}/agent-${cmd.match(/agent-(\d+)\.jsonl/)[1]}.jsonl`));
      if (cmd.includes('--name-status')) { put(`${runtimeRoot}/changes.txt`, names); put(`${runtimeRoot}/diffstat.txt`, ' 3 files changed, 3 insertions(+)'); put(`${runtimeRoot}/changes.patch`, patch); }
      if (cmd.includes('env -i')) { put(`${runtimeRoot}/verify.out`, 'ok'); put(`${runtimeRoot}/verify.code`, '0\n'); }
      return { exitCode: 0, result: '' };
    },
  };
  const runner = createDaytonaRunner({ root, transport, pollMs: 1, getCredential: async () => ({ method: 'browser', credential: secret }), workBase: join(tmp, 'daytona-work') });
  const svc = createImprovementService({ root, runner, dataDir: join(root, 'local-data/v2/improve') });
  const done = await svc.wait((await start(svc)).id);
  assert.equal(done.state, 'succeeded', done.reason);
  assert.equal(done.report.runner.id, 'daytona');
  assert.equal(done.report.agentTurns, 5);
  assert.equal(git(root, 'show', `${done.result.branch}:v2/kits/mods/exp-frost-zone.js`), "export default { id: 'exp-frost-zone' };");
  const execs = calls.filter(c => c[0] === 'execute');
  assert.ok(execs.every(c => c[2] >= 1 && c[2] <= 30), 'every command fits the adapter’s 30 s limit');
  assert.ok(execs.every(c => !c[1].includes(secret)), 'the credential never appears in a command');
  assert.ok(calls.some(c => c[0] === 'upload' && c[1] === authPath), 'the credential travels as a file');
  assert.ok(execs.filter(c => c[1].includes('env -i')).length === LOOP_CONFIG.verification.length, 'the job ran its own verification in the sandbox');
  assert.ok(calls.some(c => c[0] === 'upload' && c[1].endsWith('/check-mod.mjs')));
  assert.ok(calls.some(c => c[0] === 'delete'), 'the sandbox was deleted');
  assert.ok(!readFileSync(join(done.logs.dir, 'agent-0.jsonl'), 'utf8').includes(secret), 'logs are redacted');
});

test('the local runner: a real worktree, a stand-in CLI on stdin, the job’s own node --test, kill on cancel, cleanup', async () => {
  const { createLocalClaudeRunner } = await import('../v2/improve/runners/local-claude.js');
  const root = repo();
  mkdirSync(join(root, 'v2/kits/mods'), { recursive: true }); mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'v2/kits/mods/index.js'), 'export const MODS = [];\n');
  writeFileSync(join(root, 'tests/README'), 'tests\n');
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'mods');
  // Stand-in for `claude -p`: reads the prompt from stdin, writes the deliverables, prints stream-json.
  const cli = join(tmp, 'fake-claude.mjs');
  writeFileSync(cli, `#!/usr/bin/env node
import { writeFileSync, appendFileSync, readFileSync } from 'node:fs';
const prompt = readFileSync(0, 'utf8');
if (prompt.includes('HANG')) setInterval(() => {}, 1000);
else {
  const id = prompt.match(/native mod '([a-z0-9-]+)'/)[1];
  writeFileSync('v2/kits/mods/' + id + '.js', 'export default {};\\n');
  writeFileSync('tests/v2-mods-' + id + '.test.js', "import test from 'node:test'; test('ok', () => {});\\n");
  appendFileSync('v2/kits/mods/index.js', '// ' + id + '\\n');
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'L1', model: 'stand-in' }));
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'v2/kits/mods/' + id + '.js' } }] } }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, total_cost_usd: 0.05, session_id: 'L1', result: 'wrote ' + id }));
}
`);
  chmodSync(cli, 0o755);
  const workBase = join(tmp, 'local-work');
  const config = { agent: { cli }, verification: [{ id: 'mod-tests', argv: ['node', '--test', '{modTest}'] }] };
  const svc = createImprovementService({ root, runner: createLocalClaudeRunner({ root, workBase }), dataDir: join(root, 'local-data/v2/improve'), config });
  const progress = [];
  svc.subscribe(e => { if (e.type === 'improve_progress') progress.push(e.tool); });
  const done = await svc.wait((await start(svc)).id);
  assert.equal(done.state, 'succeeded', done.reason);
  assert.deepEqual(progress, ['Write']);
  assert.equal(done.attempts[0].coding.turns, 2);
  assert.deepEqual(done.result.files.map(f => `${f.status} ${f.path}`).sort(), ['A tests/v2-mods-exp-frost-zone.test.js', 'A v2/kits/mods/exp-frost-zone.js', 'M v2/kits/mods/index.js']);
  assert.equal(git(root, 'rev-parse', done.result.branch), done.result.commit);
  assert.equal(git(root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'the checkout is untouched');
  assert.ok(!existsSync(join(workBase, done.id)), 'the worktree is removed; only the branch stays');

  const hang = await svc.start({ experiment: { ...experiment, code: '// HANG' }, kitId: 'maze', gameId: 'g-hang' });
  await until(() => svc.status(hang.id).state === 'coding', 3000);
  svc.cancel(hang.id);
  const cancelled = await svc.wait(hang.id);
  assert.equal(cancelled.state, 'cancelled');
  assert.ok(cancelled.report.totalMs < 5000, 'cancel kills the CLI promptly');
  assert.ok(!existsSync(join(workBase, hang.id)));
  assert.throws(() => git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/improve/${hang.id}`), 'a cancelled job keeps no branch');
});
