// Primitive catalogue. Each workstream registers its primitives in its own
// <family>/<area>.index.js (KERNEL_API.md §7) so parallel work never edits the same file.
import { Registry } from '../kernel/registry.js';
import { Logic } from '../kernel/logic.js';
import { buildLogic } from '../kernel/world.js';
import spaceGraph from './engine/space-graph.js';
import storyboard from './plot/storyboard.js';
import inventory from './gameplay/inventory.js';
import uiStory from './graphics/ui-story.js';
import spaces2d from './engine/spaces2d.index.js';
import generate2d from './engine/generate2d.index.js';
import worlds3d from './engine/worlds3d.index.js';
import runtime from './engine/runtime.index.js';
import story from './plot/story.index.js';
import move from './gameplay/move.index.js';
import items from './gameplay/items.index.js';
import combat from './gameplay/combat.index.js';
import ai from './gameplay/ai.index.js';
import modes from './gameplay/modes.index.js';
import puzzle from './gameplay/puzzle.index.js';
import flat from './graphics/flat.index.js';
import ui from './graphics/ui.index.js';
import three from './graphics/three.index.js';
import adapt from './engine/adapt.index.js';

export const PRIMITIVES = [spaceGraph, storyboard, inventory, uiStory,
  ...spaces2d, ...generate2d, ...worlds3d, ...runtime, ...story, ...move, ...items, ...combat, ...ai, ...modes, ...puzzle, ...flat, ...ui, ...three, ...adapt];
export function catalogue(extra = []) {
  const registry = new Registry([...PRIMITIVES, ...extra]);
  return { registry, logic: buildLogic(registry, Logic) };
}
