// Templates (ARCHITECTURE.md §5): verified game documents chosen by the idea and composed for mashups.
// { id, concept, doc, tune }: `concept` is the one line the template pick matches against; `doc` is a complete game
// document; `tune` lists the only params the model may set, as '<primitive id>.<param>' of an instance in `doc`.
// Everything else (interaction, opponent, bot, wiring, content forms) is derived from the cards in `doc`.
// Each is proven in tests/v2-templates.test.js.
import mazeChase from './maze-chase.js';
import race from './race.js';
import farm from './farm.js';

export const TEMPLATES = Object.freeze([mazeChase, race, farm]);
export const templateById = id => TEMPLATES.find(t => t.id === id) ?? null;
