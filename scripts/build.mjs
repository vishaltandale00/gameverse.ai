import { cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { root, runtimeDirectory, runtimeIdentity } from './runtime.mjs';
import { gameCatalog } from './catalog.mjs';
const start = performance.now();
await rm(new URL('dist/', root), { recursive: true, force: true });
await mkdir(new URL('dist/runtime/', root), { recursive: true });
await mkdir(new URL('dist/games/', root), { recursive: true });
await mkdir(new URL('dist/runtime/three/', root), { recursive: true });
for (const path of ['index.html', 'style.css', 'src']) await cp(new URL(path, root), new URL(`dist/${path}`, root), { recursive: true });
await mkdir(new URL('dist/games/configs/', root), { recursive: true });
for (const version of ['v0', 'v1']) {
  await cp(new URL(`games/configs/gameverse-${version}.json`, root), new URL(`dist/games/configs/gameverse-${version}.json`, root));
  await mkdir(new URL(`dist/${version}/`, root), { recursive: true });
  await cp(new URL('index.html', root), new URL(`dist/${version}/index.html`, root));
}
for (const path of ['mgba.js', 'mgba.wasm']) await cp(new URL(path, runtimeDirectory), new URL(`dist/runtime/${path}`, root));
for (const path of ['three.module.js', 'three.core.js']) await cp(new URL(`node_modules/three/build/${path}`, root), new URL(`dist/runtime/three/${path}`, root));
await cp(new URL('node_modules/three/LICENSE', root), new URL('dist/runtime/three/LICENSE', root));
await writeFile(new URL('dist/runtime/identity.json', root), JSON.stringify(await runtimeIdentity(), null, 2));
// Build the shell only. Game artifacts stay in ignored local-data and are served by the local host.
const catalog = (await gameCatalog()).map(game => ({ ...game, ready: false, reason: 'Use the local development server to load source-built games.' }));
await writeFile(new URL('dist/games/catalog.json', root), JSON.stringify(catalog));
console.log(`Shell copied in ${(performance.now() - start).toFixed(1)} ms. No game artifacts bundled; npm run dev serves source-built games.`);
