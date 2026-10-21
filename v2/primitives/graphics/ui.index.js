// Primitives registered by the ui workstream (KERNEL_API.md §7). Only that workstream edits this file.
// graphics.ui.story is registered directly by primitives/index.js (pre-dating this index).
import hud from './ui-hud.js';
import dialogue from './ui-dialogue.js';
import journal from './ui-journal.js';
import inventory from './ui-inventory.js';
import menu from './ui-menu.js';
import audioSynth from './audio-synth.js';
import minimap from './ui-minimap.js';
import map from './ui-map.js';
import battle from './ui-battle.js';
import cards from './ui-cards.js';
import feedback from './ui-feedback.js';
import choices from './ui-choices.js';

export default [hud, dialogue, journal, inventory, menu, minimap, map, battle, cards, audioSynth, feedback, choices];
