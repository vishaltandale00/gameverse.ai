// Local runner: a disposable git worktree of the checkout's HEAD on branch improve/<jobId>, and the
// Claude Code CLI run headless in it with the user's own login. The CLI's environment is the user's
// (it needs it to find the login); nothing from it is logged, and every log line is redacted.
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { run, minimalEnv, redact, sh } from './proc.js';
import { headCommit, addWorktree, removeWorktree, deleteBranch, stagedChanges, commitAll, gitVersion } from './git.js';

export const RUNNER_VERSION = '0.1.0';

/** The CLI arguments for one attempt, from the loop config. The prompt goes on stdin. */
export function claudeArgs(config, { resumeSession = null } = {}) {
  const { agent, limits } = config;
  return [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--max-turns', String(limits.maxAgentTurns),
    '--max-budget-usd', String(limits.maxBudgetUsd),
    '--permission-mode', agent.permissionMode,
    ...(agent.restricted ? ['--restricted'] : []),
    '--tools', agent.tools.join(','),
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--disable-slash-commands',
    ...(agent.model ? ['--model', agent.model] : []),
    ...(resumeSession ? ['--resume', resumeSession] : []),
    '--allowedTools', ...agent.allowedTools, // variadic: keep last
  ];
}

const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };

/** Read Claude Code stream-json lines into progress events and the final result. */
export function streamParser({ onProgress = () => {} } = {}) {
  const out = { sessionId: null, model: null, result: null };
  const line = text => {
    let e; try { e = JSON.parse(text); } catch { return; }
    if (e.type === 'system' && e.subtype === 'init') { out.sessionId = e.session_id || out.sessionId; out.model = e.model || null; }
    else if (e.type === 'assistant') {
      for (const c of e.message?.content || []) {
        if (c.type === 'tool_use') onProgress({ kind: 'tool', tool: c.name, target: redact(clip(c.input?.file_path || c.input?.command || c.input?.pattern || c.input?.path || '', 160)) });
        else if (c.type === 'text' && c.text?.trim()) onProgress({ kind: 'text', text: redact(clip(c.text.trim(), 240)) });
      }
    } else if (e.type === 'result') out.result = e;
  };
  return { line, out };
}

export function createLocalClaudeRunner({ root, workBase = join(os.tmpdir(), 'gameverse-improve'), cli = 'claude' } = {}) {
  if (!root) throw Error('local-claude runner: root (the git checkout) is required');
  return {
    id: 'local-claude', version: RUNNER_VERSION,
    async describe(config) {
      const bin = config?.agent?.cli || cli;
      let claude = null; try { claude = (await sh(bin, ['--version'], { timeoutMs: 15000 })).trim(); } catch {}
      return { id: 'local-claude', version: RUNNER_VERSION, toolchain: { claude, git: await gitVersion(), node: process.version } };
    },

    async prepare({ job }) {
      const base = await headCommit(root);
      mkdirSync(workBase, { recursive: true });
      const dir = join(workBase, job.id);
      await addWorktree(root, dir, job.branch, base);
      return { dir, base, branch: job.branch };
    },

    async code({ workspace, prompt, config, resumeSession, logFile, onProgress, signal }) {
      const bin = config.agent.cli || cli;
      const parser = streamParser({ onProgress });
      const log = logFile ? createWriteStream(logFile, { flags: 'a' }) : null;
      let logged = 0, truncated = false;
      const env = { ...process.env, NO_COLOR: '1' };
      delete env.CLAUDECODE; // a nested session must not think it runs inside another one
      const res = await run([bin, ...claudeArgs(config, { resumeSession })], {
        cwd: workspace.dir, env, input: prompt, timeoutMs: config.limits.codingTimeoutMs, signal, tailBytes: 16384,
        onLine: (stream, text) => {
          if (stream === 'stdout') parser.line(text);
          if (!log || truncated) return;
          const entry = redact(stream === 'stdout' ? text : JSON.stringify({ type: 'stderr', text })) + '\n';
          if (logged + entry.length > config.limits.maxLogBytes) { truncated = true; log.write('{"type":"log_truncated"}\n'); return; }
          logged += entry.length; log.write(entry);
        },
      });
      if (log) await new Promise(r => log.end(r));
      const r = parser.out.result;
      return {
        exitCode: res.code, timedOut: res.timedOut, aborted: res.aborted, ms: res.ms, spawnError: res.spawnError || null,
        sessionId: r?.session_id || parser.out.sessionId, model: parser.out.model,
        turns: Number.isFinite(r?.num_turns) ? r.num_turns : null,
        costUsd: Number.isFinite(r?.total_cost_usd) ? r.total_cost_usd : null,
        isError: r ? !!r.is_error : null, subtype: r?.subtype || null,
        resultText: r ? redact(clip(r.result, 2000)) : null,
        stderrTail: redact(clip(res.stderr.slice(-2000), 2000)),
        completed: !!r, // the CLI reported a result (even an error result such as max turns)
      };
    },

    exec({ workspace, argv, timeoutMs, signal }) {
      return run(argv, { cwd: workspace.dir, env: minimalEnv(), timeoutMs, signal });
    },

    changes({ workspace }) { return stagedChanges(workspace.dir, workspace.base); },

    async finalize({ workspace, success, message }) {
      if (!workspace) return { branch: null, commit: null };
      try {
        if (success) { const commit = await commitAll(workspace.dir, message); return { branch: workspace.branch, commit }; }
        return { branch: null, commit: null };
      } catch (error) { success = false; throw error; } finally {
        await removeWorktree(root, workspace.dir);
        if (!success) await deleteBranch(root, workspace.branch);
      }
    },
  };
}
