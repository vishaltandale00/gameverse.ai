import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/verify-sports.mjs [--lean /path/to/lean] [--runtime /path/to/generated.js] [--report /path/to/report.json] [--write]');
  process.exit(0);
}
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw Error(`${name} needs a value`);
  return args[index + 1];
};
const started = performance.now(), runId = `sports-lean-${new Date().toISOString().replaceAll(':', '-')}`;
const output = join(root, 'local-data/lean-verification/checks', runId);
const reportPath = resolve(root, option('--report', 'local-data/lean-verification/sports-latest.json'));
const runtimePath = resolve(root, option('--runtime', 'src/sports-certified.generated.js'));
const localLean = join(root, 'local-data/lean-verification/lean-4.35.0-darwin_aarch64/bin/lean');
const timeoutMs = Number(process.env.SPORTS_VERIFY_TIMEOUT_MS || 60000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300000) throw Error('SPORTS_VERIFY_TIMEOUT_MS must be 1..300000');
let lean = option('--lean', process.env.LEAN_BIN || localLean);
if (!isAbsolute(lean) && lean.includes('/')) lean = resolve(root, lean);
const report = { runId, sourceCommit: null, outcome: 'running', node: process.version, architecture: process.arch,
  mode: 'Fresh proof output; installed pinned toolchain. No proof compilation cache reuse.', timeoutMs, stages: [], axioms: {}, sources: {},
  scope: 'Lean sports displacement, quantized semi-implicit flight, dissipative contact and equal-mass momentum proofs; reused relative swept sphere separation. Exact generated-runtime byte binding. JS bridge, input mapping, collision-time proposals and rendering remain TCB or outside proof.' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const command = (stage, argv, cwd = join(root, 'verification')) => {
  const start = performance.now();
  const result = spawnSync(lean, argv, { cwd, env: { ...process.env, LEAN_PATH: output }, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  report.stages.push({ stage, durationMs: performance.now() - start, outcome: result.status === 0 && !result.error ? 'passed' : 'failed', exitCode: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error?.message || null });
  if (result.error || result.status !== 0) throw Error(`${stage}: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`);
  if (/\bwarning\b/i.test((result.stdout || '') + (result.stderr || ''))) throw Error(`${stage}: Lean warnings are rejected`);
  return result.stdout;
};
try {
  await mkdir(output, { recursive: true });
  await access(lean).catch(() => { if (lean === localLean) throw Error('Pinned Lean missing. See verification/README.md, or pass --lean /path/to/lean 4.35.0.'); });
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  report.sourceCommit = git.status === 0 ? git.stdout.trim() : null;
  report.workingTree = spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  report.leanVersion = command('toolchain', ['--version'], root).trim();
  if (!/Lean \(version 4\.35\.0,/.test(report.leanVersion)) throw Error('This verification is pinned to Lean 4.35.0');
  const modules = ['Geometry', 'Kernel', 'Sports'];
  const expectedAxiomReports = [];
  for (const module of modules) {
    const source = await readFile(join(root, 'verification', `${module}.lean`));
    report.sources[`verification/${module}.lean`] = hash(source);
    for (const match of source.toString().matchAll(/#print axioms ([A-Za-z_][\w.]*)/g)) expectedAxiomReports.push(match[1].includes('.') ? match[1] : `Gameverse.${match[1]}`);
    const stdout = command(`proof:${module}`, ['-o', join(output, `${module}.olean`), `${module}.lean`]);
    for (const match of stdout.matchAll(/'([^']+)' (?:depends on axioms: \[([^\]]*)\]|does not depend on any axioms)/g)) {
      const axioms = match[2] ? match[2].split(',').map(s => s.trim()).filter(Boolean) : [];
      report.axioms[match[1]] = axioms;
      const rejected = axioms.filter(a => !['propext', 'Classical.choice', 'Quot.sound'].includes(a));
      if (rejected.length) throw Error(`${match[1]} uses unapproved axioms: ${rejected.join(', ')}`);
    }
  }
  for (const theorem of expectedAxiomReports) if (!(theorem in report.axioms)) throw Error(`Missing axiom report: ${theorem}`);
  for (const theorem of ['Gameverse.compileI_correct', 'Gameverse.compileB_correct', 'Gameverse.generated_separator_sound', 'Gameverse.generated_sports_move_sound', 'Gameverse.generated_sports_flight_sound', 'Gameverse.generated_sports_collision_sound', 'Gameverse.generated_sports_floor_sound', 'Gameverse.generated_sports_pair_sound', 'Gameverse.generated_sports_swept_separation_sound']) if (!(theorem in report.axioms)) throw Error(`Required theorem not audited: ${theorem}`);
  report.sources['verification/GenerateSports.lean'] = hash(await readFile(join(root, 'verification/GenerateSports.lean')));
  const generated = command('generate', ['--run', 'GenerateSports.lean']);
  await writeFile(join(output, 'sports-certified.generated.js'), generated);
  if (args.includes('--write')) await writeFile(runtimePath, generated);
  const runtime = await readFile(runtimePath);
  report.runtime = { path: runtimePath, sha256: hash(runtime), generatedSha256: hash(generated), byteMatch: runtime.equals(Buffer.from(generated)), bytes: runtime.length };
  if (!report.runtime.byteMatch) throw Error('Generated runtime differs from checked Lean definitions; do not claim verification. Regenerate with --write after reviewing the change.');
  report.sources['verification/Generate.lean'] = hash(await readFile(join(root, 'verification/Generate.lean')));
  const geometryGenerated = command('generate:geometry-dependency', ['--run', 'Generate.lean']);
  const geometryRuntime = await readFile(join(root, 'src/neighborhood-certified.generated.js'));
  report.geometryRuntime = { sha256: hash(geometryRuntime), generatedSha256: hash(geometryGenerated), byteMatch: geometryRuntime.equals(Buffer.from(geometryGenerated)) };
  if (!report.geometryRuntime.byteMatch) throw Error('The reused sphere-separation runtime differs from its checked Lean source.');
  for (const file of ['src/sports-physics.js', 'src/sports-input.js', 'src/sports-runtime.js', 'src/sports-feedback.js', 'src/soccer.js', 'src/football.js', 'src/neighborhood-safety.js', 'src/neighborhood-certified.generated.js', 'scripts/verify-sports.mjs']) {
    try { report.sources[file] = hash(await readFile(join(root, file))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed'; report.error = error.message; process.exitCode = 1;
} finally {
  report.totalMs = performance.now() - started;
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n').catch(() => {});
  console.log(JSON.stringify({ outcome: report.outcome, runId, totalMs: report.totalMs, theoremCount: Object.keys(report.axioms).length, runtimeByteMatch: report.runtime?.byteMatch ?? null, report: reportPath, error: report.error || null }));
}
