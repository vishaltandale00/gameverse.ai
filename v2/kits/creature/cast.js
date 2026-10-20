// What the art director needs from creature content (KIT_CONTRACT.md "cast"): the hero as the
// player, the rival as the enemy, the ball item as the pickup, a badge as the goal. Entity kinds
// are the names the renderer looks up in art.frames / art.sprites.
export function cast(content) {
  const ball = (content.items || []).filter(i => i.kind === 'ball').sort((a, b) => a.price - b.price)[0];
  const firstGym = (content.areas || []).find(a => a.kind === 'gym' && a.leader);
  const brief = {
    player: { name: content.player?.name || 'Hero', look: content.player?.look || '' },
    enemy: { name: content.rival?.name || 'Rival', look: content.rival?.look || '' },
    pickup: { name: ball?.name || 'Capture ball', glyph: '🔮' },
    hazard: { name: 'Tall grass', glyph: '🌵' },
    goal: { name: firstGym?.leader?.badge?.name || 'Gym badge', glyph: '🏆' },
  };
  const entities = {
    player: { tags: ['player'] },
    rival: { tags: ['enemy'] },
    ball: { tags: ['collectible'] },
    badge: { tags: ['goal'] },
  };
  return { brief, entities };
}

/** The design-shaped object the art director (fallbackDirection / direct) takes. */
export function artDesign(content) {
  const { brief } = cast(content);
  return { title: content.title, pitch: content.logline || '', view: 'topdown', artStyle: content.artStyle || '', cast: brief, background: content.region?.description || '' };
}
