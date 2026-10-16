import { readFile } from 'node:fs/promises';
import { root, hash } from './runtime.mjs';

export async function gameCatalog() {
  const sources = JSON.parse(await readFile(new URL('games/sources.json', root)));
  const initialGames = sources.initialGames ?? Object.keys(sources.games);
  const games = await Promise.all(initialGames.map(async id => {
    const source = sources.games[id];
    if (!source) throw Error(`Unknown initial game: ${id}`);
    try {
      const receipt = JSON.parse(await readFile(new URL(`local-data/games/${id}.json`, root)));
      const bytes = await readFile(new URL(`local-data/games/${receipt.sha256}.gba`, root));
      if (receipt.gameId !== id || receipt.sourceCommit !== source.commit || receipt.sha256 !== hash(bytes)) throw Error('Artifact provenance mismatch');
      if (source.buildRecipe && receipt.recipeSha256 !== hash(await readFile(new URL(source.buildRecipe, root)))) throw Error('Composition recipe provenance mismatch');
      if (source.compositionPlan && receipt.compositionPlanSha256 !== hash(await readFile(new URL(source.compositionPlan, root)))) throw Error('Composition plan provenance mismatch');
      return { id, ...source, ready: true, receipt, artifactUrl: `/artifacts/${receipt.sha256}.gba` };
    } catch (error) {
      return { id, ...source, ready: false, reason: error.code === 'ENOENT'
        ? (id === 'sma4' ? 'Waiting for base graphics and sound, then source build.' : 'Waiting for the pinned source build.')
        : 'Build artifact verification failed. Rebuild before playing.' };
    }
  }));
  games.push(await irWorkshopGame());
  return games;
}

// Explicitly accepted local IR artifacts enter the existing adapter/config seam.
// Older generated ROMs and their identity-bound browser progress remain intact.
async function irWorkshopGame() {
  const descriptor = { id: 'ir-workshop', name: 'Your IR mashup', subtitle: 'Recovered rules, assembled into a new GBA cartridge.',
    gameCode: 'GVIR', adapter: 'gameverse-gba-worker/0.1.0', compositionPlan: true,
    playNotes: 'Arrows: move · X / A: jump · Z / B: beam. Native QA covers the declared connected route; this is a bounded generated game slice.' };
  try {
    const receipt = JSON.parse(await readFile(new URL('local-data/games/ir-workshop.json', root)));
    if (receipt.schema !== 'gameverse.ir.play-registration/0.1' || receipt.gameId !== descriptor.id
      || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(receipt.runId) || !/^[a-f0-9]{64}$/.test(receipt.sha256)) throw Error('Invalid IR registration');
    const status = JSON.parse(await readFile(new URL(`local-data/ir-runs/${receipt.runId}/output/status.json`, root)));
    const bytes = await readFile(new URL(`local-data/games/${receipt.sha256}.gba`, root));
    if (status.state !== 'completed' || status.outcome !== 'pass' || status.qualification?.outcome !== 'pass'
      || status.artifacts?.rom_sha256 !== receipt.sha256 || hash(bytes) !== receipt.sha256
      || status.request_sha256 !== receipt.requestSha256) throw Error('IR qualification or cartridge identity changed');
    return { ...descriptor, name: receipt.title, ready: true, receipt, qualificationScope: 'Native connected-route QA passed; broader game coverage remains incomplete.', artifactUrl: `/artifacts/${receipt.sha256}.gba` };
  } catch (error) {
    return { ...descriptor, ready: false, reason: error.code === 'ENOENT' ? 'Build and qualify a component mix in Mashup, then add it to Play.' : 'The generated artifact or qualification receipt could not be verified.' };
  }
}
