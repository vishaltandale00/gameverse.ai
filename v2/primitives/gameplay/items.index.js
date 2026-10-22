// Primitives registered by the items workstream (KERNEL_API.md §7). Only that workstream edits this file.
// gameplay.inventory (also owned here) is registered directly by primitives/index.js.
import interact from './interact.js';
import rest from './rest.js';
import checkpoint from './checkpoint.js';
import collectible from './collectible.js';
import hazard from './hazard.js';
import itemUse from './item-use.js';
import equipment from './equipment.js';
import crafting from './crafting.js';
import container from './container.js';
import loot from './loot.js';
import economy from './economy.js';
import blocksMine from './blocks-mine.js';
import blocksPlace from './blocks-place.js';
import farming from './farming.js';
import buildStructure from './build-structure.js';
import mechanism from './mechanism.js';
import goal from './goal.js';

export default [interact, rest, checkpoint, collectible, hazard, itemUse, equipment, crafting, container, loot, economy, blocksMine, blocksPlace, farming, buildStructure, mechanism, goal];
