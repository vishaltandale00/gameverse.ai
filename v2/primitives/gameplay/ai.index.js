// Primitives registered by the ai workstream (KERNEL_API.md §7). Only that workstream edits this file.
import brain from './ai-brain.js';
import attacks from './ai-attacks.js';
import level from './progression-level.js';
import abilities from './progression-abilities.js';
import tree from './progression-tree.js';
import wanted from './wanted.js';
import motion from './ai-motion.js';
import formation from './ai-formation.js';
import schedule from './ai-schedule.js';
import versus from './ai-versus.js';

export default [brain, attacks, schedule, motion, formation, versus, level, abilities, tree, wanted];
