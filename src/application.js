// App/base versions choose presentation and available subgames. They deliberately
// do not enter the profile/cartridge/core progress identity in identity.js.
export function applicationConfigPath(pathname) {
  if (/^\/v0(?:\/(?:index\.html)?)?$/.test(pathname)) return '/games/configs/gameverse-v0.json';
  if (pathname === '/' || pathname === '/index.html' || /^\/v1(?:\/(?:index\.html)?)?$/.test(pathname)) return '/games/configs/gameverse-v1.json';
  throw Error('This Gameverse version is unavailable. Open /v0 or /v1.');
}

export function validateApplicationConfig(value) {
  if (value?.schemaVersion !== 1 || value.id !== 'gameverse' || !['v0', 'v1'].includes(value.version)) throw Error('Unsupported Gameverse configuration.');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 60) throw Error('The Gameverse configuration needs a title.');
  if (!['collection', 'neighborhood'].includes(value.base?.kind) || value.base.entryPath !== `/${value.version}`) throw Error('Unsupported Gameverse base or entry path.');
  if (value.base.location !== undefined && typeof value.base.location !== 'string') throw Error('Invalid neighborhood location.');
  if (!Array.isArray(value.subgames) || !value.subgames.length) throw Error('The Gameverse configuration has no subgames.');
  const seen = new Set();
  for (const binding of value.subgames) {
    if (!/^[a-z][a-z0-9-]*$/.test(binding.id) || binding.catalogId !== binding.id || typeof binding.adapter !== 'string' || !binding.adapter) throw Error('Invalid subgame binding. Preserve the catalog game ID to share existing progress.');
    if (seen.has(binding.id)) throw Error('Duplicate subgame binding.');
    seen.add(binding.id);
  }
  return Object.freeze({ ...value, base: Object.freeze({ ...value.base }), subgames: Object.freeze(value.subgames.map(binding => Object.freeze({ ...binding }))) });
}

export async function loadApplicationConfig(pathname) {
  const path = applicationConfigPath(pathname), response = await fetch(path);
  if (!response.ok) throw Error('The Gameverse configuration could not be loaded. Reload to try again.');
  const config = validateApplicationConfig(await response.json());
  if (!path.endsWith(`-${config.version}.json`)) throw Error('The requested Gameverse version does not match its configuration.');
  return config;
}

export function configuredGames(config, catalog) {
  if (!Array.isArray(catalog)) throw Error('The game catalog is invalid.');
  return config.subgames.map(binding => catalog.find(game => game.id === binding.catalogId) || {
    id: binding.id, name: binding.id === 'firered' ? 'Pokémon FireRed' : binding.id,
    ready: false, reason: 'This configured game is not available in the local catalog.',
  });
}

export function validateGameBinding(config, game, runtime) {
  const binding = config.subgames.find(item => item.id === game.id);
  if (!binding || binding.catalogId !== game.id) throw Error('This game is not available in the active Gameverse configuration.');
  if (binding.adapter !== runtime?.adapter) throw Error('This game requires a different adapter version. Its existing progress is retained.');
}
