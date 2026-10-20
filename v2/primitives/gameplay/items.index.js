// Primitives registered by the items workstream (KERNEL_API.md §7). Only that workstream edits this file.
// gameplay.inventory (also owned here) is registered directly by primitives/index.js.
import interact from './interact.js';
import rest from './rest.js';
import checkpoint from './checkpoint.js';
import collectible from './collectible.js';
import hazard from './hazard.js';

export default [interact, rest, checkpoint, collectible, hazard];
