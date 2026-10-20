// Manual model comparison for experiment generation (not part of CI; it calls the OpenAI API).
//   node v2/experiments/eval.mjs [model ...] [--repeat=N] [--repairs=N] [--out=file.json]
// Runs five representative requests per model and prints check pass rates and latency.
import { writeFileSync } from 'node:fs';
import { loadKit } from '../kits/registry.js';
import { SAMPLES } from '../kits/runner/samples.js';
import { loadOpenAIKey, createOpenAIClient } from '../planner/openai.js';
import { generateExperiment, experimentEffort } from './generate.js';

const args = process.argv.slice(2);
const flag = (name, d) => Number(args.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? d);
const out = args.find(a => a.startsWith('--out='))?.split('=')[1];
const models = args.filter(a => !a.startsWith('--'));
if (!models.length) models.push('gpt-6-luna', 'gpt-5.4-mini', 'gpt-4.1');
const repeat = flag('repeat', 1), repairs = flag('repairs', 2);

const key = loadOpenAIKey();
if (!key) { console.error('OPENAI_API_KEY is not set (.env.local)'); process.exit(1); }
const client = createOpenAIClient({ apiKey: key, timeoutMs: 180000 });

async function game(kitId, content, title) {
  const kit = await loadKit(kitId);
  const checked = kit.validate(content);
  if (!checked.ok) throw Error(`${kitId} sample failed validation`);
  return { kit, record: { doc: { schema: 'gameverse.v2.kit-game/0.1', kit: kitId, kitVersion: kit.version, id: `eval-${kitId}`, title, logline: checked.content.logline || '', seed: 1, content: checked.content, mods: {} } } };
}
const physics = await loadKit('physics');
const breakout = { ...physics.content.sample, levels: physics.content.sample.levels.filter(l => l.mode === 'breakout') };
const CASES = [
  { name: 'breakout+tetris', ...(await game('physics', breakout, 'Brick Parade')), request: 'add a Tetris mechanic' },
  { name: 'maze+boss', ...(await game('maze', (await loadKit('maze')).content.sample, 'Maze Chase')), request: 'add a boss' },
  { name: 'runner+gravity', ...(await game('runner', SAMPLES.side, SAMPLES.side.title)), request: 'gravity flip' },
  { name: 'shmup+split', ...(await game('shmup', (await loadKit('shmup')).content.sample, 'Star Swarm')), request: 'enemies split in two when hit' },
  { name: 'fighting+combo', ...(await game('fighting', (await loadKit('fighting')).content.sample, 'Arena')), request: 'a combo meter' },
];

const rows = [];
await Promise.all(models.map(async model => {
  for (let r = 0; r < repeat; r++) for (const c of CASES) {
    const t = performance.now();
    try {
      const { experiment, report } = await generateExperiment({ client, model, effort: experimentEffort(model), kit: c.kit, record: c.record, request: c.request, repairs });
      const row = { model, case: c.name, ok: report.ok, firstOk: report.attempts[0]?.ok ?? false, attempts: report.attempts.length, modelMs: report.attempts.map(a => a.modelMs), totalMs: Math.round(performance.now() - t),
        ops: experiment.check.report.ops, draws: experiment.check.report.draws?.total, stepAvgMs: experiment.check.report.timings?.stepAvgMs, problems: report.attempts.map(a => a.problems), label: experiment.label, code: experiment.code };
      rows.push(row);
      console.log(`${model.padEnd(16)} ${c.name.padEnd(16)} ${row.ok ? 'PASS' : 'FAIL'} first=${row.firstOk ? 'y' : 'n'} attempts=${row.attempts} model=${row.modelMs.join('+')}ms total=${row.totalMs}ms ${row.ok ? '' : JSON.stringify(row.problems.at(-1)).slice(0, 200)}`);
    } catch (error) {
      rows.push({ model, case: c.name, ok: false, error: error.message, totalMs: Math.round(performance.now() - t) });
      console.log(`${model.padEnd(16)} ${c.name.padEnd(16)} ERROR ${error.message.slice(0, 160)}`);
    }
  }
}));

console.log('\nmodel            pass  first  mean attempts  median total  mean first-call');
for (const model of models) {
  const mine = rows.filter(r => r.model === model), n = mine.length;
  const totals = mine.map(r => r.totalMs).sort((a, b) => a - b), firsts = mine.filter(r => r.modelMs).map(r => r.modelMs[0]);
  console.log(`${model.padEnd(16)} ${mine.filter(r => r.ok).length}/${n}   ${mine.filter(r => r.firstOk).length}/${n}    ${(mine.reduce((s, r) => s + (r.attempts || 0), 0) / n).toFixed(1)}            ${(totals[Math.floor(n / 2)] / 1000).toFixed(1)} s        ${(firsts.reduce((s, v) => s + v, 0) / Math.max(1, firsts.length) / 1000).toFixed(1)} s`);
}
if (out) writeFileSync(out, JSON.stringify(rows, null, 1));
