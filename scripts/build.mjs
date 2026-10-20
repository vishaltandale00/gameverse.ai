import {voicePackage} from './dev-manager/voice-package.mjs';
import {execFileSync} from 'node:child_process';
import {releaseContent} from '../src/hosted-voice-protocol.js';
import {hash} from './runtime.mjs';
import { cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { root, runtimeDirectory, runtimeIdentity } from './runtime.mjs';
import { gameCatalog, customArtifacts } from './catalog.mjs';
const start = performance.now();
await rm(new URL('dist/', root), { recursive: true, force: true });
await mkdir(new URL('dist/runtime/', root), { recursive: true });
await mkdir(new URL('dist/games/', root), { recursive: true });
await mkdir(new URL('dist/runtime/three/', root), { recursive: true });
for (const path of ['index.html', 'account.html', 'agent-auth.html', 'style.css', 'account.css', 'src']) await cp(new URL(path, root), new URL(`dist/${path}`, root), { recursive: true });
await mkdir(new URL('dist/games/configs/', root), { recursive: true });
for (const version of ['v0', 'v1']) {
  await cp(new URL(`games/configs/gameverse-${version}.json`, root), new URL(`dist/games/configs/gameverse-${version}.json`, root));
  await mkdir(new URL(`dist/${version}/`, root), { recursive: true });
  await cp(new URL('index.html', root), new URL(`dist/${version}/index.html`, root));
}
for (const path of ['mgba.js', 'mgba.wasm']) await cp(new URL(path, runtimeDirectory), new URL(`dist/runtime/${path}`, root));
for (const path of ['three.module.js', 'three.core.js']) await cp(new URL(`node_modules/three/build/${path}`, root), new URL(`dist/runtime/three/${path}`, root));
await cp(new URL('node_modules/three/LICENSE', root), new URL('dist/runtime/three/LICENSE', root));
await mkdir(new URL('dist/runtime/phone/', root), { recursive: true });
await cp(new URL('node_modules/libphonenumber-js/bundle/libphonenumber-min.js', root), new URL('dist/runtime/phone/libphonenumber-min.js', root));
await cp(new URL('node_modules/libphonenumber-js/LICENSE', root), new URL('dist/runtime/phone/LICENSE', root));
await writeFile(new URL('dist/runtime/identity.json', root), JSON.stringify(await runtimeIdentity(), null, 2));
// Bundle original custom games. GBA cartridges remain local and are never bundled.
const catalog = (await gameCatalog()).map(game => game.kind === 'custom-sports' ? game : ({ ...game, ready: false, reason: 'Use the local development server to load source-built games.' }));
for (const [id, files] of customArtifacts) {
  await mkdir(new URL(`dist/custom/${id}/`, root), { recursive: true });
  for (const [name, bytes] of files) await writeFile(new URL(`dist/custom/${id}/${name}`, root), bytes);
}
await writeFile(new URL('dist/games/catalog.json', root), JSON.stringify(catalog));


const source_commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),voice=await voicePackage(source_commit);
const release={schema:'gameverse.hosted-voice-release/1',source_commit,files:Object.fromEntries(voice.files),games:catalog.filter(g=>g.id==='soccer').map(g=>({gameId:g.id,version:g.version,artifactSha256:g.artifactSha256}))};
release.sha256=hash(releaseContent(release));await writeFile(new URL('dist/runtime/voice-worker.json',root),JSON.stringify(release));

console.log(`Shell and pinned voice package built in ${(performance.now() - start).toFixed(1)} ms. Original sports bundled; GBA cartridges stay local.`);
