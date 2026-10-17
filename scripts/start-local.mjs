import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testingServiceConfiguration } from './local-testing-config.mjs';
import { createCodexAgent } from './codex-agent.mjs';
import { resolveMashupRuntime, capturedBaseline } from './import-mashup-runtime.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const name of ['.env.local', '.env']) { try { loadEnvFile(join(root, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
const check = (binary, args = ['--version'], extra = {}) => { const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 3000, ...extra }); return result.status === 0; };
const port = process.env.PORT || '4173';
const checkoutId = createHash('sha256').update(root).digest('hex');
const expectedCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 1000 }).stdout?.trim() || null;
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/local/instance`, { signal: AbortSignal.timeout(800) });
  let current; try { current = await response.json(); } catch {}
  const same = current?.schema === 'gameverse.local-instance/1' && current.checkout_id === checkoutId && current.capabilities?.includes('mashup-creation') && (!expectedCommit || current.source_commit === expectedCommit);
  console.error(same ? `This checkout is already serving http://127.0.0.1:${port}/v1. Open Create a game in the V1 shell.` : `Port ${port} is serving a different or older app without this checkout's verified creation capabilities. Stop that specific server or choose PORT; starting this checkout cannot update an existing process.`);
  process.exit(same ? 0 : 1);
} catch (error) { if (error.name === 'TimeoutError') { console.error(`Port ${port} did not answer the instance check; verify the listener or choose PORT.`); process.exit(1); } }
const gaps = [];
if (Number(process.versions.node.split('.')[0]) < 22) { console.error('Use Node.js 22 or newer.'); process.exit(1); }
for (const name of ['ws', 'three', '@wasm-gaming/mgba-wasm']) { try { import.meta.resolve(name); } catch { gaps.push(`JavaScript dependency ${name}: run npm ci in this checkout.`); } }
if (gaps.length) { console.error(gaps.join('\n')); process.exit(1); }
const runtime = await resolveMashupRuntime();
if (runtime.path) process.env.GAMEVERSE_MASHUP_RUNTIME_ROOT = runtime.path;
else gaps.push('Native runtime: run node scripts/import-mashup-runtime.mjs --source /absolute/authorized-checkout (see docs/LOCAL_CREATION.md).');
const python = process.env.GAMEVERSE_PYTHON || (existsSync('/opt/homebrew/bin/python3') ? '/opt/homebrew/bin/python3' : 'python3');
process.env.GAMEVERSE_PYTHON = python;
if (!check(python, ['-c', 'import sys;sys.exit(sys.version_info < (3,10))'])) gaps.push('Python 3.10+: install Python or set GAMEVERSE_PYTHON to its executable.');
for (const binary of ['git', 'cc', 'arm-none-eabi-ld', 'arm-none-eabi-objcopy', 'arm-none-eabi-nm', 'ffmpeg']) if (!check(binary, binary === 'ffmpeg' ? ['-version'] : ['--version'])) gaps.push(`Missing executable ${binary} on PATH. See docs/LOCAL_CREATION.md.`);
if (!check('cc', ['-target', 'arm-none-eabi', '-mcpu=arm7tdmi', '-mthumb', '-x', 'c', '-fsyntax-only', '-'], { input: 'int gameverse_toolchain_probe(void) { return 0; }\n' })) gaps.push('The cc compiler needs ARM Thumb target support (Clang).');
if (runtime.path) {
  const inputs = [`${capturedBaseline}/composition.lock.json`, 'local/roms/Sonic Advance (USA) (En,Ja).gba', 'local/roms/Metroid - Zero Mission (USA).gba', 'research/ir-workshop/prefab-model-verification-20261016/sonic-profile.json'];
  for (const ref of inputs) { try { await access(join(runtime.path, ref)); } catch { gaps.push(`Missing local runtime input: ${ref}. Reimport from the authorized checkout.`); } }
  const native = join(runtime.path, 'tools/re/session/build/gba-session');
  try {
    await access(native, constants.X_OK);
    // Exit 2 is the bridge's documented argument-count guard, after dynamic loading.
    const result = spawnSync(native, [], { encoding: 'utf8', timeout: 3000 });
    if (result.status !== 2) gaps.push('Native emulator cannot load. Install libmgba for this machine and rebuild with make -C tools/re/session.');
  } catch { gaps.push('Native emulator missing: build tools/re/session with libmgba, then reimport.'); }
}
const testing = await testingServiceConfiguration();
if (!testing.configured) gaps.push(`Native bot configuration: ${testing.reason}`);
console.log(`Native bot service: ${testing.configured ? `configured (${testing.source})` : 'configuration missing or unreadable'}; separate from ChatGPT subscription creation.`);
const agent = createCodexAgent({ cwd: root });
const auth = await agent.status(); agent.close();
console.log(`ChatGPT creation: ${auth.authenticated ? `connected (${auth.planType || 'plan unavailable'})` : auth.available ? 'connect local Codex in the V1 creation panel' : auth.reason}`);
console.log(`Native runtime: ${runtime.path || 'not installed'} (${runtime.source})`);
if (gaps.length) console.log(`Creation prerequisites need attention:\n${gaps.map(gap => `- ${gap}`).join('\n')}\nThe app will show its available features and missing prerequisites.`);
console.log('Readiness checks made no inference or bot requests. Native bot service reachability and accepted model access are verified only by an actual run.');
const url = `http://127.0.0.1:${port}/v1`;
console.log(`Open ${url}`);
const child = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { cwd: root, env: process.env, stdio: 'inherit' });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (!stopping) { stopping = true; child.kill(signal); } });
child.on('error', error => { console.error(`Local server could not start: ${error.message}`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? (stopping ? 0 : 1); });
