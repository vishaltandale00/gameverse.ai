// Primitives registered by the puzzle workstream (KERNEL_API.md §7). Only that workstream edits this file.
import fallingPieces from './falling-pieces.js';
import match from './match.js';
import slideMerge from './slide-merge.js';
import paddle from './paddle.js';
import launcher from './launcher.js';
import destructible from './destructible.js';
import creatureParty from './creature-party.js';
import creatureBattle from './creature-battle.js';
import creatureCatch from './creature-catch.js';
import encounter from './encounter.js';
import lanesPeriodic from './lanes-periodic.js';

export default [fallingPieces, match, slideMerge, paddle, launcher, destructible,
  creatureParty, creatureBattle, creatureCatch, encounter, lanesPeriodic];
