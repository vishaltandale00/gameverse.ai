// Test-only runner module for isolated jobs (loaded inside the job child process; see
// v2/server/isolate.js). The job's prompt picks the behaviour, so one service can
// run several kinds of job:
//   "loop ..."       checkpoints, then spins forever (the timeout must stop it);
//   "alloc ..." / "bigalloc ..."  allocate without bound, in small or 40 MB pieces (the heap limit must stop it);
//   "publish-loop"   publishes a version, then spins (that version must stay playable);
//   "throw ..."      a plain pipeline error;
//   anything else    the real kernel pipeline with the scripted spec writer for "collect coins in a maze" (no live models).
import { mazeWriter } from './v2-p-pipeline-fixtures.js';

const spin = () => { for (;;) {} };

export async function createJobRunner({ env, repoRoot, config }) {
  let real = null;
  const services = async () => {
    if (!real) { const { buildServices } = await import('../v2/server/job-runner.mjs'); real = buildServices({ env, repoRoot, config, writers: { spec: mazeWriter(), code: null }, decisions: null, experiments: null, log: false }).ready; }
    return real;
  };
  return {
    async run(job, ctx) {
      const prompt = String(job.prompt || '');
      if (/^(loop|alloc|bigalloc|publish-loop)/.test(prompt)) {
        ctx.checkpoint('decomposition', { premise: prompt, mechanics: [{ id: 'm', description: 'a runaway mechanic' }] });
        ctx.checkpoint('selection', { systems: ['gameplay.runaway'] });
        ctx.stage('outlining', { model: 'fake' });
      }
      if (prompt.startsWith('loop')) spin();
      if (prompt.startsWith('alloc')) { const hoard = []; for (;;) hoard.push({ cells: new Array(256).fill(hoard.length), at: String(hoard.length) }); }
      // Large single allocations: the case worker_threads resourceLimits cannot contain (a process-wide V8 fatal error).
      if (prompt.startsWith('bigalloc')) { const hoard = []; for (;;) hoard.push(new Array(5e6).fill(1.5)); }
      if (prompt.startsWith('publish-loop')) {
        await ctx.publish({ doc: { schema: 'gameverse.v2.game/0.2', id: 'p', title: 'Published before the runaway' }, stage: 'first_playable', report: { kind: 'kernel', timings: {} }, provenance: { pipeline: 'fixture' } });
        await new Promise(resolve => setTimeout(resolve, 20));
        spin();
      }
      if (prompt.startsWith('throw')) throw Object.assign(Error('fixture failure'), { status: 422, code: 'fixture_code' });
      const { runJob } = await import('../v2/server/job-runner.mjs');
      return runJob(services(), job, ctx);
    },
  };
}
