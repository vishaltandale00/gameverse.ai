// Research catalog filtering shared by the interface and offline checks.
export function filterGames(games, query = '', evidenceOnly = false) {
  const needle = query.trim().toLocaleLowerCase();
  return games.filter(game => (!evidenceOnly || game.components.length) && `${game.name} ${game.shortName} ${game.genres.join(' ')}`.toLocaleLowerCase().includes(needle));
}
