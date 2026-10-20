// Scripted runner for tests: no CLI, no network. Each attempt declares the changes it "makes";
// verification commands answer from a script. With `repo`, a succeeded job gets a real branch
// improve/<jobId> in that git repo (built with plumbing, no worktree), so apply() can be tested.
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { sh } from './proc.js';
import { modPaths } from '../prompt.js';

/** The three deliverables of a well-formed promotion. */
export const goodChanges = modId => {
  const p = modPaths(modId);
  return [{ path: p.mod, status: 'A', content: `export default { id: '${modId}' };\n` }, { path: p.test, status: 'A', content: '// test\n' }, { path: p.index, status: 'M', content: '// index\n' }];
};

const wait = (ms, signal) => new Promise(resolve => {
  if (signal?.aborted) return resolve(false);
  const t = setTimeout(() => resolve(true), ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(false); }, { once: true });
});

export function createFakeRunner({ attempts = [{}], verify = () => ({ code: 0 }), repo = null, prepareMs = 0, describe = null } = {}) {
  const calls = { prepare: 0, code: [], exec: [], finalize: [] };
  return {
    id: 'fake', version: '0.1.0', calls,
    async describe() { return describe ?? { id: 'fake', version: '0.1.0', toolchain: { fake: true, node: process.version } }; },
    async prepare({ job, signal }) {
      calls.prepare++;
      if (prepareMs) await wait(prepareMs, signal);
      const base = repo ? (await sh('git', ['rev-parse', 'HEAD'], { cwd: repo })).trim() : '0'.repeat(40);
      return { dir: null, base, branch: job.branch, job, files: new Map() };
    },
    async code({ workspace, prompt, attempt, resumeSession, signal, onProgress }) {
      const step = attempts[Math.min(attempt, attempts.length - 1)] || {};
      calls.code.push({ jobId: workspace.job.id, attempt, prompt, resumeSession });
      workspace.attempt = attempt;
      onProgress?.({ kind: 'tool', tool: 'Write', target: 'fake' });
      const g = typeof step.gate === 'function' ? step.gate(workspace.job) : step.gate;
      if (g) await Promise.race([g, new Promise(r => signal?.addEventListener('abort', r, { once: true }))]);
      if (step.delayMs && !(await wait(step.delayMs, signal))) return { aborted: true, completed: false, exitCode: null };
      if (signal?.aborted) return { aborted: true, completed: false, exitCode: null };
      const changes = typeof step.changes === 'function' ? step.changes(workspace.job) : step.changes ?? goodChanges(workspace.job.modId);
      for (const c of changes) workspace.files.set(c.path, c);
      return { completed: step.completed ?? true, exitCode: step.exitCode ?? 0, turns: step.turns ?? 3, costUsd: step.costUsd ?? 0.01, sessionId: `session-${workspace.job.id}`, isError: false, subtype: 'success', resultText: 'done', stderrTail: step.stderr ?? '' };
    },
    async exec({ workspace, argv, signal }) {
      calls.exec.push(argv);
      const r = verify({ argv, attempt: workspace.attempt, job: workspace.job }) || {};
      if (r.delayMs && !(await wait(r.delayMs, signal))) return { code: null, aborted: true, stdout: '', stderr: '', ms: 0 };
      return { code: r.code ?? 0, timedOut: !!r.timedOut, stdout: r.stdout ?? 'ok', stderr: r.stderr ?? '', ms: r.ms ?? 1 };
    },
    async changes({ workspace }) {
      const files = [...workspace.files.values()].map(({ path, status }) => ({ path, status }));
      return { files, diffstat: `${files.length} files changed`, patch: files.map(f => `--- ${f.path}`).join('\n') };
    },
    async finalize({ workspace, success, message }) {
      calls.finalize.push({ success });
      if (!success) return { branch: null, commit: null };
      if (!repo) return { branch: workspace.branch, commit: 'f'.repeat(40) };
      const tmp = mkdtempSync(join(os.tmpdir(), 'gv-fake-'));
      try {
        const env = { ...process.env, GIT_INDEX_FILE: join(tmp, 'index'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid' };
        const g = args => sh('git', args, { cwd: repo, env }).then(s => s.trim());
        await g(['read-tree', workspace.base]);
        for (const f of workspace.files.values()) {
          const file = join(tmp, 'blob'); writeFileSync(file, f.content ?? '');
          await g(['update-index', '--add', '--cacheinfo', `100644,${await g(['hash-object', '-w', file])},${f.path}`]);
        }
        const commit = await g(['commit-tree', await g(['write-tree']), '-p', workspace.base, '-m', message]);
        await g(['branch', workspace.branch, commit]);
        return { branch: workspace.branch, commit };
      } finally { rmSync(tmp, { recursive: true, force: true }); }
    },
  };
}
