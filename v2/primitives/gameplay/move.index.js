// Primitives registered by the move workstream (KERNEL_API.md §7). Only that workstream edits this file.
//
// Movement for any entity, on any space, through capability methods only.
// Shared conventions (move-lib-core.js has the details):
// - components.move marks an NPC as driven by gameplay.move.* and holds per-mode state.
//   NPC intent, in priority: components.input (the player's input shape), components.steer
//   {dir, speed?, run?, jump?, face?}, components.moveTo (kernel move_to; path-followed,
//   then cleared with `arrived`/`arrived:<zone>` or `move_failed`).
// - components.body: vel [x,y,z], grounded, facing (frozen: +1/-1 in 2D, unit vector in 3D),
//   dir (unit vector), look [yaw,pitch] (yaw from +z toward +x), state, lift (virtual hop height), iframes,
//   controller = 'move' (engine.physics.character then skips the entity).
// - Modes: base controllers (walk, platformer, grid, ship, lanes, fly toggle=always) claim
//   priority 0. Overlays take over while active: glide 20, fly 25, swim 30, climb 40,
//   grapple 45, dodge 50, mount ride 60.
// - Abilities: components.move.abilities, flag `ability.<name>`, or
//   gameplay.progression.abilities ids/grants (through the `ability` predicate when registered).
// - Stamina, fuel and breath use gameplay.resource vars res.<pool> (spend effect) when present,
//   else internal pools.
// - Envelopes for the spatial verifier: card.envelope(config, abilities:Set, ctx). See
//   move-lib-envelope.js, which exports movementEnvelope(doc, registry, abilities).
// - Macro options: "travel to <zone>" ({travel: zone} for `steps` frames, or apply(rt)), plus
//   per-controller options (jump, dash, lane switch, grid steps, mount).
import walk from './move-walk.js';
import platformer from './move-platformer.js';
import climb from './move-climb.js';
import swim from './move-swim.js';
import fly from './move-fly.js';
import glide from './move-glide.js';
import dodge from './move-dodge.js';
import grapple from './move-grapple.js';
import grid from './move-grid.js';
import ship from './move-ship.js';
import lanes from './move-lanes.js';
import mount from './mount.js';

export { movementEnvelope, mergeEnvelopes } from './move-lib-envelope.js';
export default [walk, platformer, climb, swim, fly, glide, dodge, grapple, grid, ship, lanes, mount];
