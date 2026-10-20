// Genre kits by id (see KIT_CONTRACT.md). Loaded lazily in the browser and in Node;
// a kit whose module isn't present simply isn't available.
const LOADERS = {
  maze: () => import('./maze/index.js'),
  puzzle: () => import('./puzzle/index.js'),
};
export const KIT_IDS = Object.keys(LOADERS);
const cache = new Map();

export async function loadKit(id) {
  if (!LOADERS[id]) throw Error(`unknown kit '${id}'`);
  if (!cache.has(id)) cache.set(id, LOADERS[id]().then(m => m.default));
  return cache.get(id);
}

/** Every kit that loads, as { id, kit }. */
export async function availableKits() {
  const out = [];
  for (const id of KIT_IDS) { try { out.push({ id, kit: await loadKit(id) }); } catch { cache.delete(id); } }
  return out;
}
