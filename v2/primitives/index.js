// Primitive catalogue. Families add files under engine/, plot/, graphics/ and gameplay/.
import { Registry } from '../kernel/registry.js';
import { Logic } from '../kernel/logic.js';
import { buildLogic } from '../kernel/world.js';
import spaceGraph from './engine/space-graph.js';
import storyboard from './plot/storyboard.js';
import inventory from './gameplay/inventory.js';

export const PRIMITIVES = [spaceGraph, storyboard, inventory];
export function catalogue(extra = []) {
  const registry = new Registry([...PRIMITIVES, ...extra]);
  return { registry, logic: buildLogic(registry, Logic) };
}
