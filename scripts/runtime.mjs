import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const root = new URL('../', import.meta.url);
export const runtimeDirectory = new URL('node_modules/@wasm-gaming/mgba-wasm/dist/mgba/', root);
export const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
export async function runtimeIdentity() {
  const js = await readFile(new URL('mgba.js', runtimeDirectory));
  const wasm = await readFile(new URL('mgba.wasm', runtimeDirectory));
  return {
    package: '@wasm-gaming/mgba-wasm', version: '0.1.1',
    loaderSha256: hash(js), wasmSha256: hash(wasm),
    adapter: 'gameverse-gba-worker/0.1.0',
    snapshotFormat: 'mgba-wasm-0.1.1-state-api',
  };
}
