import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, access, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { root, hash } from './runtime.mjs';

const workspace = fileURLToPath(root);
const manifest = JSON.parse(await readFile(new URL('games/sources.json', root)));
const [operation, gameId, ...flags] = process.argv.slice(2);
const jobs = Number(process.env.GAMEVERSE_BUILD_JOBS || 2);
const deadline = Number(process.env.GAMEVERSE_BUILD_TIMEOUT_MS || 300000);
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 16 || !Number.isFinite(deadline) || deadline <= 0) throw Error('Invalid configured build limits');
const runId = randomUUID();
const stages = [];
const report = {
  runId, operation, gameId, startedAt: new Date().toISOString(),
  environment: { platform: process.platform, architecture: process.arch, node: process.version },
  config: 'games/sources.json@1', environmentHarness: 'gameverse-environment/0.1.0',
  loop: null, queueMs: null, simulationMs: null, evaluationMs: null,
  stages, limits: { jobs, perCommandTimeoutMs: deadline }, outcome: 'running',
};
await mkdir(new URL('local-data/builds/', root), { recursive: true });
const logPath = new URL(`local-data/builds/${runId}.log`, root);
const log = createWriteStream(logPath, { flags: 'a' });
const totalStart = performance.now();
async function run(label, command, args, cwd = workspace) {
  const start = performance.now();
  const stage = { label, command: [command, ...args], startedAt: new Date().toISOString(), outcome: 'running' };
  stages.push(stage);
  try {
    const output = await new Promise((resolveRun, reject) => {
      const child = spawn(command, args, {
        cwd, detached: true,
        env: { ...process.env, CPATH: process.env.CPATH || '/opt/homebrew/include', LIBRARY_PATH: process.env.LIBRARY_PATH || '/opt/homebrew/lib' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, deadline);
      const cancel = () => { report.cancelled = true; try { process.kill(-child.pid, 'SIGTERM'); } catch {} };
      process.once('SIGINT', cancel);
      for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
        log.write(bytes);
        output = label === 'source diff' ? output + bytes.toString() : (output + bytes.toString()).slice(-100000);
      });
      child.on('error', error => { clearTimeout(timer); process.removeListener('SIGINT', cancel); reject(error); });
      child.on('close', (code, signal) => {
        clearTimeout(timer); process.removeListener('SIGINT', cancel);
        if (code === 0) resolveRun(label === 'source diff' ? output : output.trim());
        else reject(Error(`${label}: ${timedOut ? 'deadline exceeded' : signal || `exit ${code}`}\n${output.slice(-1800)}`));
      });
    });
    stage.outcome = 'passed'; return output;
  } catch (error) { stage.outcome = report.cancelled ? 'cancelled' : 'failed'; stage.error = error.message; throw error; }
  finally { stage.wallMs = Math.round(performance.now() - start); }
}
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function setup(source) {
  const directory = join(workspace, source.directory);
  if (!await exists(directory)) {
    await run('clone', 'git', ['clone', source.repository, directory]);
    await run('pin', 'git', ['checkout', '--detach', source.commit], directory);
  }
  const commit = await run('source revision', 'git', ['rev-parse', 'HEAD'], directory);
  if (commit !== source.commit) throw Error(`Expected ${source.commit} in ${source.directory}; existing checkout preserved.`);
  return directory;
}
try {
  report.sourceCommit = await run('environment source', 'git', ['rev-parse', 'HEAD']);
  if (operation === 'status') {
    for (const id of manifest.initialGames ?? Object.keys(manifest.games)) {
      const game = manifest.games[id];
      let status = 'not built';
      try { status = JSON.stringify(JSON.parse(await readFile(new URL(`local-data/games/${id}.json`, root)))); } catch {}
      console.log(`${id}: ${game.sourceKind}; ${status}`);
    }
  } else {
    const source = manifest.games[gameId];
    if (!source || !['setup', 'build'].includes(operation)) throw Error('Usage: npm run source:setup -- firered|sma4; npm run game:build -- firered|sma4 [--clean] [--base /path/to/sma4.gba]');
    report.gameSource = source;
    const directory = await setup(source);
    if (operation === 'setup') {
      const tool = gameId === 'firered' ? manifest.tools.agbcc : manifest.tools.armips;
      await setup(tool);
      console.log(`Pinned ${source.name} source. Build with npm run game:build -- ${gameId}`);
    } else {
      const diff = await run('source diff', 'git', ['diff', '--binary', 'HEAD'], directory);
      const untracked = await run('untracked source', 'git', ['ls-files', '--others', '--exclude-standard'], directory);
      // SMA4 upstream has no gitignore; generated data and the output are expected.
      const unexpected = untracked.split('\n').filter(p => p && !(gameId === 'sma4' && (p.startsWith('data/') || p === source.artifact)));
      if (unexpected.length) throw Error(`Track new source files before building so provenance includes them: ${unexpected.join(', ')}`);
      report.sourceDiffSha256 = hash(diff);
      await writeFile(new URL(`local-data/builds/${runId}.diff`, root), diff);
      if (gameId === 'firered') {
        report.assembler = await run('assembler version', 'arm-none-eabi-as', ['--version']);
        report.hostCompiler = await run('host compiler', 'cc', ['--version']);
        const compiler = await setup(manifest.tools.agbcc);
        if (!await exists(join(compiler, 'agbcc'))) await run('compiler setup', 'sh', ['./build.sh'], compiler);
        if (!await exists(join(directory, 'tools/agbcc/bin/agbcc'))) await run('compiler install', 'sh', ['./install.sh', directory], compiler);
        report.buildMode = flags.includes('--clean') ? 'clean' : 'incremental';
        report.cacheState = await exists(join(directory, 'build')) ? 'existing build directory; individual hits unavailable' : 'no build directory';
        const options = process.platform === 'darwin' ? ['CPP=clang -E -Wno-invalid-pp-token'] : [];
        if (flags.includes('--clean')) await run('clean', 'make', ['clean', ...options], directory);
        await run('game build', 'make', [`-j${jobs}`, ...options], directory);
      } else {
        const baseIndex = flags.indexOf('--base');
        if (baseIndex >= 0) {
          if (!flags[baseIndex + 1]) throw Error('--base requires a filesystem path');
          const basePath = resolve(flags[baseIndex + 1]);
          const base = await readFile(basePath);
          if (hash(base) !== source.baseDataSha256) throw Error('Mario base data must match USA revision 1 SHA-256 from the pinned source README.');
          report.baseDataSha256 = hash(base);
          await run('extract base data', 'python3', ['-c', 'import sys; from pathlib import Path; sys.path.insert(0, "script"); from exportbin import exportbin; exportbin(Path(sys.argv[1]), "data", "binptrs.txt")', basePath], directory);
        }
        if (!await exists(join(directory, 'data'))) throw Error('Mario build blocked: original USA revision 1 graphics/sound are absent. Supply local base data with --base /path/to/sma4.gba; this does not replace the editable assembly source.');
        const assembler = await setup(manifest.tools.armips);
        await run('armips dependencies', 'git', ['submodule', 'update', '--init', '--recursive'], assembler);
        const buildDir = join(assembler, 'build');
        await run('armips configure', 'cmake', ['-S', assembler, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release', '-DARMIPS_BUILD_TESTS=OFF']);
        await run('armips build', 'cmake', ['--build', buildDir, '--parallel', String(jobs)]);
        report.buildMode = 'full assembly'; report.cacheState = 'not applicable to game assembly';
        await run('game build', join(buildDir, 'armips'), ['sma4.asm'], directory);
      }
      const bytes = await readFile(join(directory, source.artifact));
      report.artifactSha1 = hash(bytes, 'sha1');
      report.baselineMatches = report.artifactSha1 === source.baselineSha1;
      if (!diff && !report.baselineMatches) throw Error('Unmodified source did not reproduce the expected baseline hash. Artifact not registered.');
      const receipt = { gameId, sourceCommit: source.commit, sourceDiffSha256: report.sourceDiffSha256, sha256: hash(bytes), baselineMatches: report.baselineMatches, runId, builtAt: new Date().toISOString(), qualification: 'source-built; browser/campaign/controller qualification pending' };
      await mkdir(new URL('local-data/games/', root), { recursive: true });
      await copyFile(join(directory, source.artifact), new URL(`local-data/games/${receipt.sha256}.gba`, root));
      if (diff) {
        // Source edits produce a candidate. They never silently replace the development baseline.
        await mkdir(new URL('local-data/candidates/', root), { recursive: true });
        await writeFile(new URL(`local-data/candidates/${runId}.json`, root), JSON.stringify(receipt, null, 2));
        report.registration = 'candidate only; selector unchanged';
      } else {
        const temporary = new URL(`local-data/games/${runId}.tmp`, root);
        await writeFile(temporary, JSON.stringify(receipt, null, 2));
        const { rename } = await import('node:fs/promises');
        await rename(temporary, new URL(`local-data/games/${gameId}.json`, root));
        report.registration = 'development baseline; campaign qualification pending';
      }
      console.log(`${source.name}: ${receipt.sha256}; baseline match=${report.baselineMatches}`);
    }
  }
  report.outcome = 'passed';
} catch (error) {
  report.outcome = report.cancelled ? 'cancelled' : 'failed'; report.error = error.message; console.error(error.message); process.exitCode = 1;
} finally {
  report.totalMs = Math.round(performance.now() - totalStart);
  report.finishedAt = new Date().toISOString();
  report.buildMs = stages.find(s => s.label === 'game build')?.wallMs ?? null;
  await writeFile(new URL(`local-data/builds/${runId}.json`, root), JSON.stringify(report, null, 2));
  await new Promise(resolveLog => log.end(resolveLog));
  console.log(`Run ${runId}: ${report.outcome}, ${report.totalMs} ms; report in local-data/builds/`);
}
