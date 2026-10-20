#!/usr/bin/env node
// Freestanding generated C -> browser/Node WebAssembly, with no host imports.
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function command(program, args) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`${program}: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result.stdout.trim();
}

export async function compilePlayableWasm({ source, output, exports = [], receipt = `${output}.build.json`, context = {} }) {
  source = resolve(source);
  output = resolve(output);
  const compiler = process.env.WASM_CC || resolve(root, 'local/toolchains/wasi-sdk-25.0-arm64-macos/bin/clang');
  let compilerVersion;
  try { compilerVersion = command(compiler, ['--version']); }
  catch (error) { throw new Error(`Run sh scripts/setup-playable-wasm-toolchain.sh first, or set WASM_CC to WASI SDK clang. ${error.message}`); }
  const builtins = command(compiler, ['--print-libgcc-file-name']);
  await mkdir(dirname(output), { recursive: true });
  const args = ['--target=wasm32-unknown-wasi', '-O2', '-ffreestanding', '-fno-builtin', '-nostdlib',
    '-Wl,--no-entry', '-Wl,--export-memory', '-Wl,-z,stack-size=65536',
    '-Wl,--initial-memory=131072', '-Wl,--max-memory=16777216',
    ...(exports.length ? exports.map(name => `-Wl,--export=${name}`) : ['-Wl,--export-all']),
    '-I', root, source, '-lc', builtins, '-o', output];
  const startedAt = new Date().toISOString();
  const start = performance.now();
  let outcome = 'failed';
  let error;
  let artifact;
  let moduleExports;
  let compileMs = null;
  let instantiateMs = null;
  try {
    command(compiler, args);
    compileMs = performance.now() - start;
    const runtimeStart = performance.now();
    artifact = await readFile(output);
    const module = await WebAssembly.compile(artifact);
    const imports = WebAssembly.Module.imports(module);
    if (imports.length) throw new Error(`Freestanding module unexpectedly imports ${JSON.stringify(imports)}`);
    await WebAssembly.instantiate(module, {});
    instantiateMs = performance.now() - runtimeStart;
    moduleExports = WebAssembly.Module.exports(module);
    outcome = 'passed';
  } catch (caught) { error = caught.message; }
  const buildAndInstantiateMs = performance.now() - start;
  const record = { schema: 'playable-wasm-build/v1', runId: process.env.PLAYABLE_BUILD_RUN_ID || randomUUID(), startedAt, outcome,
    context: { gameVersion: null, environmentHarnessVersion: null, adapterVersion: null, loopConfig: null, ...context },
    sourceCommit: command('git', ['rev-parse', 'HEAD']), source, sourceSha256: digest(await readFile(source)),
    sourceDigestScope: 'direct translation unit; callers retain generated-source/header provenance separately',
    output, artifactSha256: artifact ? digest(artifact) : null, artifactBytes: artifact?.length ?? null,
    compiler, compilerVersion, command: [compiler, ...args], platform: `${process.platform}/${process.arch}`,
    mode: 'clean single translation unit', cache: 'none', queueMs: null,
    timing: { compileMs, instantiateMs, buildAndInstantiateMs, setupDownloadMs: null, note: 'compile and instantiate are nonoverlapping stages within buildAndInstantiateMs; excludes setup and metadata collection' },
    imports: outcome === 'passed' ? [] : null, exports: moduleExports ?? null, error: error ?? null };
  await mkdir(dirname(resolve(receipt)), { recursive: true });
  await writeFile(receipt, `${JSON.stringify(record, null, 2)}\n`);
  if (error) throw new Error(error);
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, output, ...exports] = process.argv.slice(2);
  if (!source || !output) throw new Error('Usage: node scripts/compile-playable-wasm.mjs source.c output.wasm [exportName ...]');
  const result = await compilePlayableWasm({ source, output, exports });
  console.log(JSON.stringify({ output: result.output, sha256: result.artifactSha256, bytes: result.artifactBytes, timing: result.timing }));
}
