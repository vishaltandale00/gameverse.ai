import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile, realpath } from 'node:fs/promises';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
export const runtimeCodeSha256 = 'e4fa1a913e6486b7594cafbbc4e5bf758f02f1f9e2767e903c5bc2917177bf6f';
const root = fileURLToPath(new URL('../', import.meta.url));
export const capturedBaseline = 'local/composition-builds/sonic-metroid-signal-descent-25';
const folders = ['tools/composition', 'tools/gba_mashup', 'tools/re/session', 'tools/playtester', 'tools/decisions', 'tools/whole_game', 'research/requests'];
const roms = ['local/roms/Sonic Advance (USA) (En,Ja).gba', 'local/roms/Metroid - Zero Mission (USA).gba'];
const profile = 'research/ir-workshop/prefab-model-verification-20261016/sonic-profile.json';
const exists = async path => { try { await access(path); return true; } catch { return false; } };
export async function resolveMashupRuntime({ appRoot = root, env = process.env } = {}) {
  if (env.GAMEVERSE_MASHUP_RUNTIME_ROOT) return { path: resolve(env.GAMEVERSE_MASHUP_RUNTIME_ROOT), source: 'GAMEVERSE_MASHUP_RUNTIME_ROOT' };
  const installed = join(appRoot, 'local-data/mashup-runtime');
  if (await exists(installed)) return { path: installed, source: 'installed local runtime' };
  if (await exists(join(appRoot, capturedBaseline, 'composition.lock.json'))) return { path: appRoot, source: 'current checkout' };
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: appRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    const primary = dirname(common);
    if (await exists(join(primary, capturedBaseline, 'composition.lock.json'))) return { path: primary, source: 'primary checkout' };
  } catch {}
  return { path: null, source: 'unavailable' };
}

export async function importMashupRuntime({ source, destination = join(root, 'local-data/mashup-runtime'), python = process.env.GAMEVERSE_PYTHON || 'python3' } = {}) {
  if (!source) throw Error('Pass --source /absolute/authorized-checkout. Only import local files you are authorized to use.');
  source = await realpath(source); destination = resolve(destination);
  if (await exists(destination)) throw Error(`Runtime destination already exists: ${destination}. Set GAMEVERSE_MASHUP_RUNTIME_ROOT to reuse it, or move it aside before importing.`);
  const staging = `${destination}.import-${randomUUID()}`;
  const files = new Map();
  const sourceFile = async ref => {
    if (typeof ref !== 'string' || ref.includes('..') || ref.startsWith('/') || /(^|\/)\.(env|git|codex)(\/|$)/.test(ref)) return;
    if (ref.endsWith('.gba') && !roms.includes(ref)) return;
    const absolute = resolve(source, ref);
    if (!absolute.startsWith(source + sep) || !(await exists(absolute))) return;
    const actual = await realpath(absolute);
    if (!actual.startsWith(source + sep)) throw Error(`External symlink rejected: ${ref}`);
    if (!files.has(ref)) { files.set(ref, actual); await mkdir(dirname(join(staging, ref)), { recursive: true }); await cp(actual, join(staging, ref), { recursive: true, filter: path => !path.includes('/tools/gba_mashup/native/generated') && !/(^|\/)(__pycache__|\.git|\.codex)(\/|$)|\.pyc$|(^|\/)\.env(?:\.|$)|\.(?:pem|key)$/.test(path) }); }
  };
  const seen = new Set();
  async function refs(value) {
    if (Array.isArray(value)) { for (const child of value) await refs(child); }
    else if (value && typeof value === 'object') {
      const ref = value.ref || value.path;
      if (typeof ref === 'string' && !seen.has(ref)) {
        seen.add(ref); await sourceFile(ref);
        if (files.has(ref) && ref.endsWith('.json')) { try { await refs(JSON.parse(await readFile(files.get(ref), 'utf8'))); } catch (error) { if (error instanceof SyntaxError) {} else throw error; } }
      }
      for (const child of Object.values(value)) await refs(child);
    }
  }
  try {
    await mkdir(staging, { recursive: true, mode: 0o700 });
    for (const folder of folders) { if (!(await exists(join(source, folder)))) throw Error(`Missing runtime source folder: ${folder}`); await sourceFile(folder); }
    for (const folder of ['sources', 'packages']) await sourceFile(`${capturedBaseline}/${folder}`);
    for (const name of ['host.json', 'plan.json', 'composition.lock.json']) await sourceFile(`${capturedBaseline}/${name}`);
    await refs(JSON.parse(await readFile(join(source, capturedBaseline, 'plan.json'), 'utf8')));
    for (const name of await readdir(join(source, capturedBaseline, 'packages'))) if (name.endsWith('.json')) await refs(JSON.parse(await readFile(join(source, capturedBaseline, 'packages', name), 'utf8')));
    for (const ref of [...roms, profile]) { if (!(await exists(join(source, ref)))) throw Error(`Missing required authorized local input: ${ref}`); await sourceFile(ref); }
    const verify = `${staging}.verify`;
    try {
      const result = spawnSync(python, [join(root, 'scripts/mashup-runtime.py'), 'prepare', '--runtime', staging, '--workspace', verify], { encoding: 'utf8', timeout: 30000 });
      if (result.status !== 0) throw Error(`Runtime capture validation failed. Check the candidate25 source/package pins and Python installation. ${result.stdout?.slice(-1000) || result.error?.message || ''}`);
    } finally { await rm(verify, { recursive: true, force: true }); }
    const lock = await readFile(join(staging, capturedBaseline, 'composition.lock.json'));
    const inventory = [], counts = { code_file_count: 0, code_bytes: 0, private_asset_file_count: 0, private_asset_bytes: 0 };
    async function inventoryFiles(folder) {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const absolute = join(folder, entry.name);
        if (entry.isDirectory()) { await inventoryFiles(absolute); continue; }
        if (!entry.isFile()) throw Error('Unexpected imported symlink or special file.');
        const path = relative(staging, absolute).split(sep).join('/'), bytes = await readFile(absolute);
        const kind = path.startsWith('local/roms/') || path.startsWith('local/composition-assets/') ? 'private_asset' : 'code';
        counts[`${kind}_file_count`]++; counts[`${kind}_bytes`] += bytes.length;
        inventory.push({ path, kind, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
    await inventoryFiles(staging); inventory.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const sourceCode = inventory.filter(row => row.kind === 'code' && !row.path.includes('/build/'));
    const code_sha256 = createHash('sha256').update(JSON.stringify(sourceCode.map(({path,sha256}) => ({path,sha256})))).digest('hex');
    if (code_sha256 !== runtimeCodeSha256) throw Error(`Runtime code version mismatch: expected ${runtimeCodeSha256}, received ${code_sha256}. Import the reviewed runtime closure; a matching Git commit alone is insufficient when source files are uncommitted.`);
    // Validate the research closure above, then capture reviewed application policy separately.
    const reviewed_overlay=[];
    async function overlay(ref){
      const from=join(root,ref),info=await readFile(from);await mkdir(dirname(join(staging,ref)),{recursive:true});await writeFile(join(staging,ref),info);
      reviewed_overlay.push({path:ref,kind:'code',bytes:info.length,sha256:createHash('sha256').update(info).digest('hex')});
    }
    async function overlayTree(ref){for(const item of await readdir(join(root,ref),{withFileTypes:true})){if(item.name==='__pycache__'||item.name.endsWith('.pyc'))continue;const next=ref+'/'+item.name;if(item.isDirectory())await overlayTree(next);else if(item.isFile())await overlay(next);else throw Error('Reviewed policy symlink rejected.');}}
    await overlayTree('prompts');await overlayTree('tools/prompts');
    for(const ref of ['tools/playtester/models.py','tools/playtester/core.py','tools/playtester/experiment.py','tools/playtester/rpg_experiment.py'])await overlay(ref);
    const finalInventory=new Map(inventory.map(row=>[row.path,row]));for(const row of reviewed_overlay)finalInventory.set(row.path,row);
    const installedFiles=[...finalInventory.values()].sort((a,b)=>a.path.localeCompare(b.path));
    const installedCounts={code_file_count:0,code_bytes:0,private_asset_file_count:0,private_asset_bytes:0};for(const row of installedFiles){installedCounts[row.kind+'_file_count']++;installedCounts[row.kind+'_bytes']+=row.bytes;}
    let source_commit = null;
    try { source_commit = execFileSync('git', ['rev-parse','HEAD'], { cwd: source, encoding:'utf8', stdio:['ignore','pipe','ignore'], timeout:3000 }).trim(); } catch {}
    await writeFile(join(staging, 'installation.json'), JSON.stringify({ schema: 'gameverse-local-runtime/1', installed_at: new Date().toISOString(), source_commit, baseline_sha256: 'f1faa36558ae5d7ccacfc94292201b63c7a870803464a2f4d2699c6654bf6bf1', baseline_lock_sha256: createHash('sha256').update(lock).digest('hex'), code_sha256, reviewed_overlay, reviewed_overlay_sha256:createHash('sha256').update(JSON.stringify(reviewed_overlay)).digest('hex'), ...installedCounts, files: installedFiles, research_source_files:inventory, source, copied_roots: [...files.keys()], note: 'Code includes compiler, configuration, evidence and native executable; private_asset covers ROMs and local composition assets. code_sha256 pins the research closure before the separately hashed reviewed prompt/model overlay. Installation files reflect both; machine build outputs are excluded from code digest. Private local inputs; never commit this directory. Native toolchain, libmgba and ffmpeg remain machine prerequisites.' }, null, 2), { mode: 0o600 });
    await rename(staging, destination);
    return destination;
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--source');
  if (args.length !== 2 || at !== 0) { console.error('Usage: node scripts/import-mashup-runtime.mjs --source /absolute/authorized-checkout'); process.exitCode = 1; }
  else try { console.log(`Installed private runtime: ${await importMashupRuntime({ source: args[1] })}`); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
