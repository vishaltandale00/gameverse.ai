// Install an exact local provider read set; provider payloads stay out of Git.
import { createHash } from 'node:crypto';
import { readFile, realpath, mkdir, copyFile, lstat } from 'node:fs/promises';
import { resolve, dirname, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, path) => path.startsWith(root + sep);
export async function prepareProvider({ manifest, source, target, install = false }) {
  source = await realpath(source); target = await realpath(target);
  if (manifest.schema !== 'gameverse.improvement-provider-pack/1' || !Array.isArray(manifest.files) || !manifest.files.length) throw Error('Unsupported or empty provider manifest');
  const rows = [], seen = new Set();
  for (const row of manifest.files) {
    if (typeof row.path !== 'string' || isAbsolute(row.path) || row.path.split('/').some(p => !p || p.startsWith('.')) || !/^[a-f0-9]{64}$/.test(row.sha256) || seen.has(row.path)) throw Error('Invalid or duplicate provider path/pin');
    seen.add(row.path);
    const from = await realpath(resolve(source, row.path)), to = resolve(target, row.path);
    if (!inside(source, from) || !inside(target, to)) throw Error('Provider path escapes root');
    const bytes = await readFile(from);
    if (hash(bytes) !== row.sha256 || (row.bytes !== undefined && bytes.length !== row.bytes)) throw Error('Provider input pin mismatch: ' + row.path);
    let parent = dirname(to);
    while (true) {
      try { if (!inside(target, await realpath(parent)) && await realpath(parent) !== target) throw Error('Provider target parent escapes root'); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; parent = dirname(parent); }
    }
    try {
      const info = await lstat(to);
      if (!info.isFile() || info.isSymbolicLink() || hash(await readFile(to)) !== row.sha256) throw Error('Existing provider target differs: ' + row.path);
      rows.push({ row, from, to, present: true });
    } catch (error) { if (error.code !== 'ENOENT') throw error; rows.push({ row, from, to, present: false }); }
  }
  if (install) for (const item of rows.filter(item => !item.present)) {
    await mkdir(dirname(item.to), { recursive: true });
    const parent = await realpath(dirname(item.to));
    if (parent !== target && !inside(target, parent)) throw Error('Provider target parent changed');
    await copyFile(item.from, item.to, 1); // COPYFILE_EXCL: retain any concurrently created target.
    if (hash(await readFile(item.to)) !== item.row.sha256) throw Error('Provider changed during install: ' + item.row.path);
  }
  return { schema: 'gameverse.improvement-provider-install/1', status: install ? 'installed' : 'validated', files: rows.length, copied: install ? rows.filter(item => !item.present).length : 0, payload_publication: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), get = key => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1]; };
    if (!get('--source') || !get('--manifest') || args.some((v, i) => v.startsWith('--') && !['--source', '--manifest', '--target', '--install', '--check'].includes(v))) throw Error('Usage: node scripts/improvement-provider.mjs --manifest FILE --source AUTHORIZED_CHECKOUT [--target CHECKOUT] [--check|--install]');
    const manifest = JSON.parse(await readFile(resolve(get('--manifest')), 'utf8'));
    console.log(JSON.stringify(await prepareProvider({ manifest, source: get('--source'), target: get('--target') || process.cwd(), install: args.includes('--install') })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
