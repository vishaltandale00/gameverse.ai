// Creature rules: pure, deterministic battle and creature math (CONTRACT.md §2).
export { createCreature, statsOf, expToLevel, levelForExp, movesAt, summary, healCreature, levelUp, evolutionOf, evolve, moveOf, speciesOf, lookup, STRUGGLE } from './stats.js';
export { effectiveness, stageMult, accMult, calcDamage } from './damage.js';
export { captureOdds, attemptCapture } from './capture.js';
export { bestMove, bestMatchup, moveScore, wildMove, foeAction } from './ai.js';
export { startBattle, chooseAction, resolveTurn, needsInput, battleResult, expFor, expBar } from './battle.js';
