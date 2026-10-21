// Templates (ARCHITECTURE.md §5): verified game documents chosen by the idea and composed for mashups.
// { id, concept, doc, tune }: `concept` is the one line the template pick matches against; `doc` is a complete game
// document; `tune` lists the only params the model may set, as '<primitive id>.<param>' of an instance in `doc`.
// Everything else (interaction, opponent, bot, wiring, content forms) is derived from the cards in `doc`.
// Each is proven in tests/v2-templates.test.js.
import mazeChase from './maze-chase.js';
import race from './race.js';
import dungeon from './dungeon.js';
import farm from './farm.js';
import matchBoard from './match-board.js';

// Written and proven except for one static check each, so not yet offered (registering them makes that check fail):
// falling-blocks.js and slide-merge.js: compose-check content_missing 'cells' on engine.space.grid (a board primitive
// whose board param claims the space's cells fills them, but content coverage only counts generators);
// launcher.js: loop-check loop_win_unwired (an ending counting the typed 'destroyed:target' does not fill the declared
// 'destroyed' template) and loop_win_unaffected (gameplay.destructible is driven by the contact/explosion events its
// card.loop.win.reads.by declares, which the player-driven launcher and physics space produce).
export const TEMPLATES = Object.freeze([mazeChase, race, dungeon, farm, matchBoard]);
export const templateById = id => TEMPLATES.find(t => t.id === id) ?? null;
