// Primitive catalogue. Each workstream registers its primitives in its own
// <family>/<area>.index.js so parallel work never edits the same file.
import { Registry } from '../kernel/registry.js';
import { Logic } from '../kernel/logic.js';
import { buildLogic } from '../kernel/world.js';
import spaceGraph from './engine/space-graph.js';
import storyboard from './plot/storyboard.js';
import inventory from './gameplay/inventory.js';
import uiStory from './graphics/ui-story.js';
import engineWorlds from './engine/worlds.index.js';
import engineRuntime from './engine/runtime.index.js';
import plotStory from './plot/story.index.js';
import gameplayActor from './gameplay/actor.index.js';
import gameplaySystems from './gameplay/systems.index.js';
import graphicsThree from './graphics/three.index.js';
import graphicsFlat from './graphics/flat.index.js';

export const PRIMITIVES = [spaceGraph, storyboard, inventory, uiStory, ...engineWorlds, ...engineRuntime, ...plotStory, ...gameplayActor, ...gameplaySystems, ...graphicsThree, ...graphicsFlat];
export function catalogue(extra = []) {
  const registry = new Registry([...PRIMITIVES, ...extra]);
  return { registry, logic: buildLogic(registry, Logic) };
}
