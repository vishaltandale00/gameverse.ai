// Hosted runner: the same promotion job in a disposable Daytona sandbox, over the fetch-only adapter
// in infra/cloudflare/daytona.js (pass `transport: new Daytona(env)`; tests pass a fake). Steps:
// create sandbox → install the pinned CLI → upload the source (git archive of the base commit) and
// the host's checker → run the agent in the background and poll its status file → run the job's
// verification commands → fetch the diff → apply it locally on improve/<jobId> → delete the sandbox.
// Credentials travel only as uploaded files (never in command strings) and are never downloaded into
// logs. This driver polls from a Node host; the Worker/Durable Object port must drive the same steps
// from alarms (plans/HOSTING.md) and can reuse the pure request builders exported here.
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { runtimeRoot, authPath, installCommand, cliVersion } from '../../../infra/cloudflare/claude-runtime.js';
import { claudeArgs, streamParser } from './local-claude.js';
import { redact, sh } from './proc.js';
import { headCommit, addWorktree, removeWorktree, deleteBranch, commitAll, parseNameStatus } from './git.js';

const CHECKER_SOURCE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-mod.mjs');
export const RUNNER_VERSION = '0.1.0';
const ROOT = runtimeRoot, WORK = `${ROOT}/work`;
const enc = new TextEncoder(), dec = new TextDecoder();
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

// ---------- pure request builders (shared with a Worker port) ----------
export const sandboxName = jobId => `gv-improve-${jobId}`.slice(0, 63);
export const hydrateCommand = () => `cd ${WORK} && tar -xzf ${ROOT}/source.tgz && git init -q && git add -A && git -c user.name=gameverse -c user.email=improve@gameverse.invalid commit -qm base > /dev/null`;
export const startAgentCommand = n => `node ${ROOT}/agent.mjs ${Number(n)} > ${ROOT}/agent-runner.log 2>&1 < /dev/null &`;
export const killAgentCommand = () => `kill -TERM -$(cat ${ROOT}/agent.pid) 2>/dev/null; sleep 2; kill -KILL -$(cat ${ROOT}/agent.pid) 2>/dev/null; true`;
export const tailLogCommand = (n, bytes) => `tail -c ${Number(bytes)} ${ROOT}/agent-${Number(n)}.jsonl > ${ROOT}/agent-tail.jsonl`;
export const changesCommand = () => `cd ${WORK} && git add -A && git diff --cached --name-status -M HEAD > ${ROOT}/changes.txt && git diff --cached --shortstat HEAD > ${ROOT}/diffstat.txt && git diff --cached --binary HEAD > ${ROOT}/changes.patch`;
// Verification runs with an empty environment apart from PATH and HOME: no credentials reach test code.
export const verifyCommand = argv => `cd ${WORK} && env -i PATH="$PATH" HOME="$HOME" NO_COLOR=1 ${argv.map(q).join(' ')} > ${ROOT}/verify.out 2>&1; echo $? > ${ROOT}/verify.code`;

/** The sandbox-side agent driver: spawns the pinned CLI with the loop config's arguments; prompt from a file. */
export function agentScript(args) {
  return `import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,createWriteStream,existsSync} from 'node:fs';
const root=${JSON.stringify(ROOT)}, n=Number(process.argv[2]);
const args=${JSON.stringify(args)};
const env={PATH:process.env.PATH,HOME:process.env.HOME,CLAUDE_CONFIG_DIR:root+'/auth',TERM:'dumb',NO_COLOR:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'};
if(existsSync(root+'/api-key'))env.ANTHROPIC_API_KEY=readFileSync(root+'/api-key','utf8').trim();
const status=v=>writeFileSync(root+'/agent-status.json',JSON.stringify(v),{mode:0o600});
const log=createWriteStream(root+'/agent-'+n+'.jsonl');
const child=spawn(root+'/tools/node_modules/.bin/claude',args,{cwd:root+'/work',env,stdio:['pipe','pipe','pipe'],detached:true});
writeFileSync(root+'/agent.pid',String(child.pid));
status({phase:'running',attempt:n,started_at:Date.now()});
child.stdin.on('error',()=>{});child.stdin.end(readFileSync(root+'/prompt-'+n+'.txt'));
child.stdout.pipe(log);
let err='';child.stderr.on('data',b=>{err=(err+b).slice(-4000);});
child.on('error',e=>status({phase:'finished',attempt:n,exit_code:null,error:String(e.code||e.message)}));
child.on('close',code=>log.end(()=>status({phase:'finished',attempt:n,exit_code:code,stderr_tail:err,finished_at:Date.now()})));
`;
}

const archive = (root, commit) => new Promise((resolve, reject) => execFile('git', ['archive', '--format=tar.gz', commit], { cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (e, out) => (e ? reject(e) : resolve(out))));
const sleep = (ms, signal) => new Promise(resolve => { const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); });

/**
 * createDaytonaRunner({ root, transport, getCredential?, onCredential?, pollMs?, ttlMinutes? })
 * - transport: { create(name,{network,ttlMinutes}), get(name), delete(name), execute(sandbox,cmd,timeoutS≤30), upload(sandbox,path,bytes), download(sandbox,path,limit) }
 * - getCredential(job) -> { method: 'browser' | 'api-key', credential } (the host's connection store; uploaded as a file)
 * - onCredential(job, bytes): the refreshed browser credential after a run, for the host to re-encrypt (optional)
 */
export function createDaytonaRunner({ root, transport, getCredential = null, onCredential = null, pollMs = 3000, ttlMinutes = 15, workBase = join(os.tmpdir(), 'gameverse-improve') } = {}) {
  if (!root || !transport) throw Error('daytona runner: root and transport are required');
  const exec = (sb, cmd, s = 30) => transport.execute(sb, cmd, Math.max(1, Math.min(30, Math.ceil(s))));
  const must = async (sb, cmd, what, s) => { const r = await exec(sb, cmd, s); if (r?.exitCode !== 0) throw Error(`daytona: ${what} failed (exit ${r?.exitCode})`); return r; };
  const text = async (sb, path, limit = 262144) => { const b = await transport.download(sb, path, limit); return b ? dec.decode(b) : null; };
  return {
    id: 'daytona', version: RUNNER_VERSION,
    async describe() { return { id: 'daytona', version: RUNNER_VERSION, toolchain: { claude: cliVersion, sandbox: 'daytona', node: null, note: 'sandbox node/git versions are not probed yet' } }; },

    async prepare({ job, signal }) {
      const base = await headCommit(root);
      const name = sandboxName(job.id);
      const ws = { name, base, branch: job.branch, sandbox: null, dir: WORK, checker: `${ROOT}/check-mod.mjs` };
      ws.sandbox = await transport.create(name, { network: true, ttlMinutes });
      while (!signal?.aborted) {
        const sb = await transport.get(name);
        if (sb?.state === 'started') { ws.sandbox = sb; break; }
        if (sb && ['error', 'destroyed', 'build_failed'].includes(sb.state)) throw Error(`daytona: sandbox ${sb.state}`);
        await sleep(pollMs, signal);
      }
      if (signal?.aborted) return ws;
      await must(ws.sandbox, installCommand, 'CLI install', 30);
      await transport.upload(ws.sandbox, `${ROOT}/source.tgz`, await archive(root, base));
      await must(ws.sandbox, hydrateCommand(), 'source hydration', 30);
      await transport.upload(ws.sandbox, ws.checker, readFileSync(CHECKER_SOURCE_PATH));
      if (getCredential) {
        const c = await getCredential(job);
        await transport.upload(ws.sandbox, c.method === 'browser' ? authPath : `${ROOT}/api-key`, enc.encode(c.credential));
        ws.authMethod = c.method;
      }
      return ws;
    },

    async code({ workspace: ws, prompt, attempt, config, resumeSession, logFile, onProgress, signal }) {
      const started = Date.now();
      await transport.upload(ws.sandbox, `${ROOT}/prompt-${attempt}.txt`, enc.encode(prompt));
      await transport.upload(ws.sandbox, `${ROOT}/agent.mjs`, enc.encode(agentScript(claudeArgs(config, { resumeSession }))));
      await must(ws.sandbox, startAgentCommand(attempt), 'agent start', 10);
      let status = null, timedOut = false, aborted = false;
      for (;;) {
        await sleep(pollMs, signal);
        if (signal?.aborted) { aborted = true; break; }
        if (Date.now() - started > config.limits.codingTimeoutMs) { timedOut = true; break; }
        const raw = await text(ws.sandbox, `${ROOT}/agent-status.json`, 16384);
        status = raw ? JSON.parse(raw) : null;
        if (status?.phase === 'finished' && status.attempt === attempt) break;
      }
      if (aborted || timedOut) await exec(ws.sandbox, killAgentCommand(), 10).catch(() => {});
      await exec(ws.sandbox, tailLogCommand(attempt, config.limits.maxLogBytes), 10).catch(() => {});
      const log = (await text(ws.sandbox, `${ROOT}/agent-tail.jsonl`, config.limits.maxLogBytes + 1024).catch(() => null)) || '';
      const parser = streamParser({ onProgress });
      for (const line of log.split('\n')) if (line) parser.line(line);
      if (logFile) appendFileSync(logFile, redact(log));
      const r = parser.out.result;
      return {
        exitCode: status?.exit_code ?? null, timedOut, aborted, ms: Date.now() - started, spawnError: status?.error || null,
        sessionId: r?.session_id || parser.out.sessionId, model: parser.out.model,
        turns: Number.isFinite(r?.num_turns) ? r.num_turns : null, costUsd: Number.isFinite(r?.total_cost_usd) ? r.total_cost_usd : null,
        isError: r ? !!r.is_error : null, subtype: r?.subtype || null, resultText: r ? redact(String(r.result ?? '').slice(0, 2000)) : null,
        stderrTail: redact(String(status?.stderr_tail || '')), completed: !!r,
      };
    },

    async exec({ workspace: ws, argv, timeoutMs }) {
      const started = Date.now();
      const r = await exec(ws.sandbox, verifyCommand(argv), timeoutMs / 1000);
      const out = (await text(ws.sandbox, `${ROOT}/verify.out`, 262144).catch(() => null)) ?? '';
      const code = Number((await text(ws.sandbox, `${ROOT}/verify.code`, 64).catch(() => null))?.trim());
      const timedOut = r?.exitCode !== 0 && !Number.isFinite(code);
      return { code: Number.isFinite(code) ? code : null, timedOut, stdout: redact(out), stderr: '', ms: Date.now() - started };
    },

    async changes({ workspace: ws }) {
      await must(ws.sandbox, changesCommand(), 'diff', 30);
      const files = parseNameStatus((await text(ws.sandbox, `${ROOT}/changes.txt`)) || '');
      const diffstat = ((await text(ws.sandbox, `${ROOT}/diffstat.txt`)) || '').trim() || 'no changes';
      const patch = (await text(ws.sandbox, `${ROOT}/changes.patch`, 1024 * 1024)) || '';
      ws.patch = patch;
      return { files, diffstat, patch };
    },

    async finalize({ workspace: ws, success, message }) {
      if (!ws) return { branch: null, commit: null };
      let local = null;
      try {
        if (ws.sandbox && onCredential && ws.authMethod === 'browser') {
          const bytes = await transport.download(ws.sandbox, authPath, 65536).catch(() => null);
          if (bytes) await onCredential(ws, bytes);
        }
        if (!success) return { branch: null, commit: null };
        // The sandbox diff becomes the job's branch locally: a worktree at the base, the patch, the job's commit.
        mkdirSync(workBase, { recursive: true });
        local = mkdtempSync(join(workBase, 'apply-'));
        const dir = join(local, 'wt');
        await addWorktree(root, dir, ws.branch, ws.base);
        writeFileSync(join(local, 'changes.patch'), ws.patch || '');
        try { await sh('git', ['apply', '--index', '--whitespace=nowarn', join(local, 'changes.patch')], { cwd: dir }); const commit = await commitAll(dir, message); return { branch: ws.branch, commit }; }
        catch (error) { await deleteBranch(root, ws.branch); throw error; }
        finally { await removeWorktree(root, dir); }
      } finally {
        if (local) rmSync(local, { recursive: true, force: true });
        await transport.delete(ws.name).catch(() => {});
        const left = await transport.get(ws.name).catch(() => null);
        ws.cleanupConfirmed = !left || left.state === 'destroyed';
      }
    },
  };
}
