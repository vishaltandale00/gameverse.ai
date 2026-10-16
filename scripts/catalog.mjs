import { readFile } from 'node:fs/promises';
import { root, hash } from './runtime.mjs';

export async function gameCatalog() {
  const sources = JSON.parse(await readFile(new URL('games/sources.json', root)));
  const initialGames = sources.initialGames ?? Object.keys(sources.games);
  return Promise.all(initialGames.map(async id => {
    const source = sources.games[id];
    if (!source) throw Error(`Unknown initial game: ${id}`);
    try {
      const receipt = JSON.parse(await readFile(new URL(`local-data/games/${id}.json`, root)));
      const bytes = await readFile(new URL(`local-data/games/${receipt.sha256}.gba`, root));
      if (receipt.gameId !== id || receipt.sourceCommit !== source.commit || receipt.sha256 !== hash(bytes)) throw Error('Artifact provenance mismatch');
      if (source.buildRecipe && receipt.recipeSha256 !== hash(await readFile(new URL(source.buildRecipe, root)))) throw Error('Composition recipe provenance mismatch');
      return { id, ...source, ready: true, receipt, artifactUrl: `/artifacts/${receipt.sha256}.gba` };
    } catch (error) {
      return { id, ...source, ready: false, reason: error.code === 'ENOENT'
        ? (id === 'sma4' ? 'Waiting for base graphics and sound, then source build.' : 'Waiting for the pinned source build.')
        : 'Build artifact verification failed. Rebuild before playing.' };
    }
  }));
}
