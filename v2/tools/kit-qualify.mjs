// Qualification run (separately triggered, never routine CI): real ideas through the real kit
// pipeline with the real content model, reporting pass rate, attempts and time per kit. Kit tests
// only see hand-written samples; this catches what real model output breaks.
//   node v2/tools/kit-qualify.mjs [--kit maze,puzzle] [--n 3] [--concurrency 4]
import { availableKits } from '../kits/registry.js';
import { runKitPipeline } from '../planner/kit-pipeline.js';
import { createOpenAIClient, loadOpenAIKey } from '../planner/openai.js';

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const IDEAS = {
  maze: ['pac-man in a haunted library', 'bomberman-style maze in a candy factory', 'pac-man with a huge open world map'],
  shmup: ['space invaders with rubber ducks', 'geometry wars in a neon ocean', 'asteroids with space whales'],
  fighting: ['street fighter with chefs', 'mortal kombat with mythical animals', 'smash bros with robots'],
  puzzle: ['tetris but the pieces are cats', 'candy crush in a gem mine', '2048 with planets'],
  physics: ['angry birds but you launch cats at castles', 'breakout in a volcano', 'peggle in an underwater reef'],
  runner: ['temple run through a jungle', 'flappy bird in space', 'doodle jump on clouds', 'crossy road with ducks'],
  creature: ['pokemon with dragons', 'creature collector in a desert kingdom', 'pokemon but with bugs'],
};
const key = loadOpenAIKey(process.env, process.cwd());
if (!key) { console.error('needs OPENAI_API_KEY (.env.local)'); process.exit(1); }
const client = createOpenAIClient({ apiKey: key });
const model = process.env.V2_OPENAI_DESIGN_MODEL || 'gpt-4.1-mini';
const want = arg('kit', '').split(',').filter(Boolean), n = Number(arg('n', 3)), concurrency = Number(arg('concurrency', 4));
const kits = (await availableKits()).filter(k => !want.length || want.includes(k.id));
const ctx = { stage() {}, draft() {}, publish: async x => x, store: { updateMeta: async () => {}, saveAsset: async () => '' } };
const jobs = kits.flatMap(({ id }) => (IDEAS[id] || [`a ${id} game`]).slice(0, n).map(prompt => ({ id, prompt })));
const results = [];
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < jobs.length) {
    const job = jobs[next++], started = performance.now();
    try {
      const r = await runKitPipeline({ gameId: 'qualify', prompt: job.prompt, seed: 1 }, ctx, { client, model, kitId: job.id, previous: null, art: null });
      results.push({ ...job, ok: true, attempts: r.report.contentAttempts, ms: performance.now() - started, gaps: r.report.gaps.length });
    } catch (e) { results.push({ ...job, ok: false, error: String(e.message).slice(0, 140), ms: performance.now() - started }); }
  }
}));
for (const { id } of kits) {
  const rs = results.filter(r => r.id === id); if (!rs.length) continue;
  const ok = rs.filter(r => r.ok);
  console.log(`${id.padEnd(9)} ${ok.length}/${rs.length} published | avg attempts ${(ok.reduce((a, r) => a + r.attempts, 0) / (ok.length || 1)).toFixed(1)} | avg ${(rs.reduce((a, r) => a + r.ms, 0) / rs.length / 1000).toFixed(1)} s`);
  for (const r of rs.filter(r => !r.ok)) console.log(`   ✗ "${r.prompt}": ${r.error}`);
}
