// Pure request boundary shared by the interface and inexpensive offline checks.
export function componentKey(gameId, componentId) { return `${gameId}:${componentId}`; }
export function resolveSelection(catalog, keys) {
  const result = [];
  for (const game of catalog.games) for (const component of game.components) {
    if (keys.has(componentKey(game.id, component.id))) result.push({ game, component });
  }
  return result;
}
export function createAttempt(catalog, keys, intent, adaptations = {}) {
  const selected = resolveSelection(catalog, keys);
  if (selected.length !== keys.size) throw Error('A selected component is absent from this research snapshot. Select it again.');
  if (selected.length > 8) throw Error('The harness accepts up to 8 components per request. Remove a component to continue.');
  if (intent.length > 4000) throw Error('Keep the game description within 4,000 characters.');
  for (const item of selected) {
    const adaptation = adaptations[componentKey(item.game.id, item.component.id)] || '';
    if (adaptation.length > 1500) throw Error('Keep each adaptation within 1,500 characters.');
  }
  if (new Set(selected.map(item => item.game.id)).size < 2) throw Error('Choose components from at least two games.');
  if (!intent.trim()) throw Error('Describe what you want to make.');
  return {
    schema_version: 1,
    candidate_id: 'workshop-ontology-draft',
    title: 'Gameverse workshop experiment',
    intent: intent.trim(),
    components: selected.map(({ game, component }) => ({ game_id: game.id, component_id: component.id, adaptation: adaptations[componentKey(game.id, component.id)]?.trim() || `Explore a simplified adaptation of ${component.label}. Verify constraints and implement this behavior explicitly; the reference grid template does not recover the original rules.` })),
    constraints: { max_width: 12, max_height: 8, max_episode_steps: 80 }
  };
}
export function filterGames(games, query = '', evidenceOnly = false) {
  const needle = query.trim().toLocaleLowerCase();
  return games.filter(game => (!evidenceOnly || game.components.length) && `${game.name} ${game.shortName} ${game.genres.join(' ')}`.toLocaleLowerCase().includes(needle));
}
