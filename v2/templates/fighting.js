// Fighting (the Street Fighter family): a one-on-one side-view duel on a walled stage, best of three timed rounds.
// Both fighters are fighting presets (combat-lib-moves.js, ported from the fighting kit): the shared normals (jab,
// high kick, low jab, sweep, air punch, flying kick, throw), motion-input specials (engine.input.motions: quarter
// circles, dragon punch, charge), a meter super, and gameplay.combat.versus rules (guard high/low by holding back,
// chip, counter hits, juggles, combo scaling, knockdown and wakeup). The CPU rival is gameplay.ai.versus, playing
// through the same controls (components.input). Each round revives and heals both fighters at their spawns; a KO or
// the most health at time over takes the round. Winning the match wins.
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }], drawn = [{ do: 'end_game', outcome: 'neutral' }];
const fighter = (build, stats, specials, sup) => ({ build, stats: { health: 1000, ...stats }, specials, super: sup });
const body = facing => ({ facing, size: [0.38, 1] });

export default {
  id: 'fighting',
  concept: 'Fighting game: a one-on-one duel in best-of-three timed rounds with punches, kicks, throws, blocking and motion-input special moves against a CPU rival.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'fighting', title: 'Fighting', seed: 1,
    views: { primary: 'side' },
    // A two-screen stage on a floor slab (the kit's 920-unit standard width at 0.01 world units per fighting unit).
    spaces: [{ id: 'stage', use: 'engine.space.arena2d', with: { size: [9.2, 6.5], solids: [[0, 0, 9.2, 0.5]] } }],
    systems: [
      { use: 'engine.input.motions', with: { buttons: ['attack', 'heavy'] } },
      { use: 'gameplay.combat.health', with: { iframes: 0, corpse: true, playerDeath: 'none' } },
      { use: 'gameplay.combat.melee', with: { fighterScale: 0.01 } },
      { use: 'gameplay.combat.projectile' },
      { use: 'gameplay.combat.versus', with: { walls: [0, 9.2], maxSep: 3.6, floor: 0.5 } },
      { use: 'gameplay.ai.versus', with: { level: 2, fightWhen: { var: 'round.live', gte: 1 } } },
      { use: 'gameplay.rounds', with: { fighters: ['player', 'rival'], bestOf: 3, roundSec: 60, spawns: [[3, 1], [6.2, 1]],
        onRoundStart: [{ do: 'revive', who: 'actor' }, { do: 'heal', who: 'actor' }], onWin: won, onLose: lost, onDraw: drawn } },
      { use: 'engine.spawner', with: { intervalSec: 0, rules: [{ id: 'rival', archetype: 'rival', at: [6.2, 1], unique: true, activation: 'always', respawnSec: 0 }] } },
    ],
    content: {
      archetypes: [
        { id: 'hero', name: 'Hero', components: { health: { max: 1000 }, versus: {}, body: body(1),
          melee: { fighter: fighter('average', { walkSpeed: 5, jump: 5, weight: 5 }, [
            { name: 'Gale Orb', archetype: 'fireball', motion: 'qcf', power: 5, speed: 5 },
            { name: 'Rising Talon', archetype: 'uppercut', motion: 'dp', power: 7, speed: 7 },
            { name: 'Cyclone Heel', archetype: 'spin_kick', motion: 'qcb', power: 5, speed: 5 },
          ], { name: 'Tempest Cannon', archetype: 'beam' }) } } },
        { id: 'rival', name: 'Rival', kind: 'enemy', components: { health: { max: 900 }, versus: {}, body: body(-1), cpu: { style: 'rushdown' },
          melee: { fighter: fighter('lean', { health: 900, walkSpeed: 8, jump: 7, weight: 3 }, [
            { name: 'Comet Rush', archetype: 'charge_dash', motion: 'charge-bf', power: 5, speed: 8 },
            { name: 'Sky Splitter', archetype: 'axe_kick', motion: 'charge-du', power: 6, speed: 6 },
            { name: 'Hummingbird', archetype: 'flurry', motion: 'tap-dd', power: 4, speed: 8 },
          ], { name: 'Starfall Barrage', archetype: 'rush' }) } } },
      ],
    },
    player: { archetype: 'hero', at: [3, 1] },
  },
  tune: ['gameplay.combat.versus.juggleMax', 'gameplay.combat.versus.counterHit', 'gameplay.combat.versus.chip'],
};
