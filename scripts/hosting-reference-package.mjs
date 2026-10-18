import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
export const paths = ['tools/prefab_pipeline/reference_fixture.py','tools/prefab_pipeline/__init__.py','tools/playtester/__init__.py','tools/playtester/adapters.py','tools/playtester/core.py','tools/playtester/examples/key-door.json'];
export const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function referencePackage() {
  const files = await Promise.all(paths.map(async path => { const bytes = await readFile(new URL(path,root)); return { path, sha256:sha256(bytes), content_base64:bytes.toString('base64') }; }));
  const manifest = { schema:'gameverse.hosted-reference-manifest/1', fixture_id:'reference-key-door', request:{schema:'gameverse.reference-fixture-request/1',fixture_id:'reference-key-door',operation:'engine-demonstration',limits:{max_actions:32,max_wall_s:5,max_repairs:0}}, files:files.map(({path,sha256})=>({path,sha256})) };
  return { manifest, manifest_sha256:sha256(canonical(manifest)), bundle:Buffer.from(JSON.stringify({schema:'gameverse.hosted-reference-source/1',files})) };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {manifest,manifest_sha256,bundle}=await referencePackage();
  if(process.argv.includes('--write-manifest')) await writeFile(new URL('infra/cloudflare/reference-manifest.json',root),JSON.stringify({ ...manifest,manifest_sha256 },null,2)+'\n');
  console.log(JSON.stringify({manifest_sha256,source_sha256:sha256(bundle),bytes:bundle.length,files:manifest.files.length}));
}
