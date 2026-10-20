// Git operations shared by the runners: disposable worktrees, the change list the scope gate reads,
// and the job's own commit on improve/<jobId>.
import { rmSync, existsSync } from 'node:fs';
import { sh } from './proc.js';

const git = (cwd, args, opts) => sh('git', args, { cwd, ...opts });

export const headCommit = async root => (await git(root, ['rev-parse', 'HEAD'])).trim();
export const currentBranch = async root => (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
export const branchCommit = async (root, branch) => { try { return (await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).trim(); } catch { return null; } };
export const gitVersion = async () => { try { return (await sh('git', ['--version'])).trim(); } catch { return null; } };

export async function addWorktree(root, dir, branch, base) {
  await git(root, ['worktree', 'add', '--quiet', '-b', branch, dir, base]);
}

/** Remove a worktree (and its directory) even when it has changes; prune if git lost track of it. */
export async function removeWorktree(root, dir) {
  try { await git(root, ['worktree', 'remove', '--force', '--force', dir]); } catch {}
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  try { await git(root, ['worktree', 'prune']); } catch {}
}

export async function deleteBranch(root, branch) { try { await git(root, ['branch', '-D', branch]); } catch {} }

/** Parse `git diff --name-status` into [{ path, status }]; a rename counts as a delete plus an add. */
export function parseNameStatus(text) {
  const files = [];
  for (const line of text.split('\n').filter(Boolean)) {
    const [status, a, b] = line.split('\t');
    if (status.startsWith('R') || status.startsWith('C')) { if (status.startsWith('R')) files.push({ path: a, status: 'D' }); files.push({ path: b, status: 'A' }); }
    else files.push({ path: a, status: status[0] });
  }
  return files;
}

/** Stage everything in the worktree and describe it against base: { files, diffstat, patch }. */
export async function stagedChanges(dir, base, { maxPatchBytes = 1024 * 1024 } = {}) {
  await git(dir, ['add', '-A']);
  const files = parseNameStatus(await git(dir, ['diff', '--cached', '--name-status', '-M', base]));
  const diffstat = (await git(dir, ['diff', '--cached', '--shortstat', base])).trim() || 'no changes';
  let patch = await git(dir, ['diff', '--cached', '--binary', base]);
  if (patch.length > maxPatchBytes) patch = patch.slice(0, maxPatchBytes) + '\n[patch truncated]\n';
  return { files, diffstat, patch };
}

export async function commitAll(dir, message) {
  let identity = [];
  try { await git(dir, ['config', 'user.email']); } catch { identity = ['-c', 'user.name=Gameverse improve', '-c', 'user.email=improve@gameverse.invalid']; }
  await git(dir, ['add', '-A']);
  await git(dir, [...identity, 'commit', '--quiet', '-m', message]);
  return (await git(dir, ['rev-parse', 'HEAD'])).trim();
}

/** Fast-forward the checkout's current branch to `branch`. Never pushes. */
export async function fastForward(root, branch) {
  const into = await currentBranch(root);
  if (into === 'HEAD') return { ok: false, reason: 'the checkout is on a detached HEAD; check out a branch first' };
  const tip = await branchCommit(root, branch);
  if (!tip) return { ok: false, reason: `branch ${branch} no longer exists` };
  try { await git(root, ['merge-base', '--is-ancestor', 'HEAD', tip]); }
  catch { return { ok: false, reason: `not a fast-forward: ${into} has commits that ${branch} does not; rebase ${branch} onto ${into} (or re-run the job) and verify again` }; }
  try { await git(root, ['merge', '--ff-only', '--quiet', tip]); }
  catch (error) { return { ok: false, reason: `git refused the fast-forward (uncommitted changes in the checkout?): ${error.message}` }; }
  return { ok: true, into, commit: tip };
}
