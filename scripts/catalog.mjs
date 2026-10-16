import { readFile } from 'node:fs/promises';
import { root, hash } from './runtime.mjs';

// Immutable module snapshots: browser imports and progress identity name the same bytes.
export const customArtifacts = new Map();

export async function gameCatalog() {
  const sources = JSON.parse(await readFile(new URL('games/sources.json', root)));
  const initialGames = sources.initialGames ?? Object.keys(sources.games);
  const cartridges = await Promise.all(initialGames.map(async id => {
    const source = sources.games[id];
    if (!source) throw Error(`Unknown initial game: ${id}`);
    try {
      const receipt = JSON.parse(await readFile(new URL(`local-data/games/${id}.json`, root)));
      const bytes = await readFile(new URL(`local-data/games/${receipt.sha256}.gba`, root));
      if (receipt.gameId !== id || receipt.sourceCommit !== source.commit || receipt.sha256 !== hash(bytes)) throw Error('Artifact provenance mismatch');
      return { id, ...source, ready: true, receipt, artifactUrl: `/artifacts/${receipt.sha256}.gba` };
    } catch (error) {
      return { id, ...source, ready: false, reason: error.code === 'ENOENT'
        ? (id === 'sma4' ? 'Waiting for base graphics and sound, then source build.' : 'Waiting for the pinned source build.')
        : 'Build artifact verification failed. Rebuild before playing.' };
    }
  }));
  const shared = new Map(await Promise.all(['sports-runtime', 'sports-input', 'sports-feedback', 'gamepad', 'sports-physics', 'sports-certified.generated', 'neighborhood-safety', 'neighborhood-certified.generated'].map(async name => [`${name}.js`, await readFile(new URL(`src/${name}.js`, root))])));
  for (const name of ['three.module.js', 'three.core.js']) shared.set(name, await readFile(new URL(`node_modules/three/build/${name}`, root)));
  const custom = await Promise.all([
    { id: 'soccer', name: 'Alder Five', subtitle: '5v5 soccer · Juniper Pitch', venue: 'Juniper Pitch' },
    { id: 'football', name: 'Alder Gridiron', subtitle: '7v7 American football · Foundry Field', venue: 'Foundry Field' },
  ].map(async game => {
    const source = await readFile(new URL(`src/${game.id}.js`, root));
    const files = new Map([...shared, [`${game.id}.js`, source]]);
    const artifactSha256 = hash(Buffer.concat([...files].flatMap(([name, bytes]) => [Buffer.from(name + '\0' + bytes.length + '\0'), bytes])));
    if (!customArtifacts.has(artifactSha256)) customArtifacts.set(artifactSha256, files);
    return { ...game, kind: 'custom-sports', version: '1.0.0', adapter: 'gameverse-custom-sports/1.0.0', snapshotFormat: 'sports-json/1',
      artifactSha256, entryUrl: `/custom/${artifactSha256}/sports-runtime.js`, ready: true };
  }));
  return [...cartridges, ...custom];
}
