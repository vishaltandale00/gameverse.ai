#!/usr/bin/env node
// Run one promotion job from the command line and print its events and final report.
//   node v2/improve/run.mjs --experiment exp.json --kit maze --game <gameId> [--user <id>] [--max-turns N] [--repairs N]
// exp.json: { id, label, request, code } (the stored experiment shape, v2/kits/EXTENDING.md).
// Uses the local Claude Code CLI with your own login. The result is a branch improve/<jobId>; nothing is applied.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createImprovementService } from './promote.js';
import { createLocalClaudeRunner } from './runners/local-claude.js';

const arg = (name, d = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const experiment = JSON.parse(readFileSync(resolve(arg('experiment')), 'utf8'));
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const limits = {};
if (arg('max-turns')) limits.maxAgentTurns = Number(arg('max-turns'));
if (arg('repairs')) limits.maxRepairAttempts = Number(arg('repairs'));
const svc = createImprovementService({ root, runner: createLocalClaudeRunner({ root }), config: { limits } });
const t0 = Date.now();
svc.subscribe(e => {
  const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
  if (e.type === 'improve_progress') console.log(`${s}s  [${e.attempt}] ${e.kind === 'tool' ? `${e.tool} ${e.target || ''}` : e.text.replace(/\s+/g, ' ').slice(0, 120)}`);
  else if (e.type === 'improve_check') console.log(`${s}s  check ${e.id}: ${e.ok ? 'pass' : 'FAIL'}${e.ms != null ? ` (${e.ms} ms)` : ''}${e.problems?.length ? ` ${e.problems.join('; ')}` : ''}`);
  else if (e.type !== 'improve_done') console.log(`${s}s  ${e.type} ${e.state || ''}${e.attempt != null ? ` attempt ${e.attempt}` : ''}`);
});
process.on('SIGINT', () => { for (const j of svc.list()) svc.cancel(j.id); });
const job = await svc.start({ experiment, kitId: arg('kit', 'maze'), gameId: arg('game', 'cli'), userId: arg('user'), gameVersion: arg('game-version') });
console.log(`job ${job.id} → branch improve/${job.id}, mod '${job.modId}', data ${job.logs.report}`);
const done = await svc.wait(job.id);
console.log(JSON.stringify({ state: done.state, reason: done.reason, result: done.result, report: done.report }, null, 2));
process.exitCode = done.state === 'succeeded' ? 0 : 1;
