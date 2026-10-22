// Shoot-'em-up (the vertical scrolling shooter family): the player's ship flies an eight-way field between two rock
// outcrops and fires a forward blaster (the shmup kit's shot preset: one lane, two, then three). Waves arrive from the
// top of the screen, each after the last is cleared: a line of drones that drift and fire aimed shots, divers that
// swoop in on a sine, gunships that hover and fire spreads and rings, then the boss, whose patterns change by phase as
// its hull breaks (aimed volleys, then spirals, then flowers). Three lives; clearing every wave, boss included, wins.
// Enemy motion and fire are ported from the shmup kit (gameplay.ai.motion programs, gameplay.ai.attacks emitters).
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
// Kit units: the vertical stage is 300 x 400 (the shmup kit's pixels), speeds in units per second.
const shot = (id, pattern, rate, extra = {}) => ({ id, range: 600, windup: 0.2, active: 0.6, recover: 0.4, cooldown: 1.2, damage: 1, emitter: { pattern, rate, speed: 115, radius: 3.5, life: 5, ...extra } });

export default {
  id: 'shmup',
  concept: 'Shoot-\'em-up: fly a ship through waves of enemies that fire bullet patterns, dodge their shots while shooting them down, and destroy the boss.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'shmup', title: 'Shmup', seed: 3,
    views: { primary: 'td' },
    spaces: [{ id: 'field', use: 'engine.space.arena2d', with: { scenery: 'space', size: [300, 400], edges: { left: 'open', right: 'open', bottom: 'open', top: 'open' }, cull: ['projectile'], solids: [[0, 150, 18, 190], [282, 220, 300, 260]] } }],
    systems: [
      { use: 'gameplay.move.ship', with: { mode: 'eightway', speed: 190, heading: 90, margin: 10 } },
      { use: 'gameplay.combat.health', with: { iframes: 0.2 } },
      { use: 'gameplay.combat.projectile', with: { weapons: [{ id: 'blaster', preset: 'shot' }], playerWeapon: 'blaster' } },
      { use: 'gameplay.ai.motion', with: { down: [0, -1], bounds: { min: [0, 0], max: [300, 400] }, edges: 'exit', speed: 60 } },
      { use: 'gameplay.ai.attacks' },
      { use: 'gameplay.combat.boss', with: { bosses: [{ id: 'dreadnought', archetype: 'dreadnought', name: 'Dreadnought', start: 'spawn', lockArena: false,
        phases: [{ at: 1, pattern: ['volley'] }, { at: 0.66, pattern: ['spiral'] }, { at: 0.33, pattern: ['flower', 'volley'] }] }], retryReset: false } },
      { use: 'gameplay.death', with: { lives: 3, respawn: 'start', respawnSec: 1, invulnSec: 2, gameOver: lost } },
      { use: 'gameplay.waves', with: { mustClear: true, startDelay: 1, stagger: 0.3, telegraph: 0.5,
        lanes: [{ id: 'top', at: [150, 380] }, { id: 'left', at: [70, 390] }, { id: 'right', at: [230, 390] }],
        waves: [
          { id: 'drones', spawn: [{ archetype: 'drone', count: 5, lane: 'top', pattern: 'line', spacing: 40 }] },
          { id: 'divers', delay: 0.5, spawn: [{ archetype: 'diver', count: 3, lane: 'left', pattern: 'line', spacing: 24 }, { archetype: 'diver', count: 3, lane: 'right', pattern: 'line', spacing: 24 }] },
          { id: 'gunships', delay: 0.5, spawn: [{ archetype: 'gunship', count: 2, lane: 'top', pattern: 'line', spacing: 140 }, { archetype: 'drone', count: 3, lane: 'top', pattern: 'v', spacing: 24 }] },
          { id: 'boss', delay: 1, boss: true, spawn: [{ archetype: 'dreadnought', lane: 'top' }] },
        ], onComplete: won } },
    ],
    content: {
      archetypes: [
        { id: 'ship', name: 'Ship', components: { body: { size: [14, 14] }, health: { max: 1 } } },
        { id: 'drone', name: 'Drone', kind: 'enemy', components: { body: { size: [16, 16] }, health: { max: 1 }, touch: { damage: 1 },
          motion: { program: [{ kind: 'straight', speed: 90, sec: 1 }, { kind: 'zigzag', speed: 20, amp: 40, period: 120 }] }, attacks: [shot('aimed_shot', 'aimedOne', 1)] } },
        { id: 'diver', name: 'Diver', kind: 'enemy', components: { body: { size: [16, 16] }, health: { max: 2 }, touch: { damage: 1 },
          motion: { kind: 'dive', speed: 150 }, attacks: [shot('aimed_pair', 'aimed', 1.2)] } },
        { id: 'gunship', name: 'Gunship', kind: 'enemy', components: { body: { size: [28, 22] }, health: { max: 6 }, touch: { damage: 1 },
          motion: { kind: 'hover', speed: 60, hoverAt: 90 }, attacks: [shot('fan', 'spread', 0.8), shot('ring', 'ring', 0.6)] } },
        { id: 'dreadnought', name: 'Dreadnought', kind: 'boss', components: { body: { size: [68, 52] }, health: { max: 50 }, touch: { damage: 1 },
          motion: { kind: 'hover', speed: 50, hoverAt: 80, stay: true }, attacks: [shot('volley', 'aimed', 1.5, { boss: true }), shot('spiral', 'spiral', 4, { boss: true }), shot('flower', 'flower', 0.8, { boss: true })] } },
      ],
    },
    player: { archetype: 'ship', at: [150, 40] },
  },
  tune: ['engine.space.arena2d.scenery', 'gameplay.death.lives', 'gameplay.ai.attacks.difficulty'],
};
