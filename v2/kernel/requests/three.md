# Kernel requests and shared contracts: graphics `three` workstream

Primitives: `graphics.render.voxel`, `graphics.render.mesh3d`, `graphics.terrain.procedural`,
`graphics.foliage.scatter`, `graphics.material.palette`, `graphics.sky`, `graphics.camera.first-person`,
`graphics.camera.third-person`, `graphics.camera.isometric`, `graphics.model.voxel`, `graphics.model.lowpoly`,
`graphics.rig.humanoid`, `graphics.rig.quadruped`, `graphics.anim.clips`, `graphics.anim.locomotion`,
`graphics.anim.ik`, `graphics.anim.secondary`, `graphics.anim.ragdoll`. All of them join one shared stage
(`rt.caches.three`, `three-stage.js`).

## Contracts agreed with other workstreams (implemented on this side)

| With | Contract |
| --- | --- |
| worlds3d | `api.anchor` + `bodyBox()` for entity positions (voxel/mesh3d: `'center'`). Voxel fast path `api.chunkCells(cx,cy,cz) -> {origin, size, cells: Uint16Array (x + sx*(z + sz*y)), palette (palette[0] = null)}`, fallback `cellsIn`, then `getCell`. `cell_changed {at, from, to}` patches the cached chunk in place and re-meshes it and the neighbours sharing its faces/AO corners. mesh3d: `groundAt`, `bounds()`, `objects()` (eager) and `objects(region)` (lazy, per 128 m cell), structure shapes with `role` + `group` (+ a `shape:'none'` marker carrying `style`), `rot` = three.js `rotation.y`, box objects anchored at bottom centre. Services `roadgraph(space)` and `biomeAt.def(id).color`. |
| move | 3D yaw is measured from +z toward +x (forward = `[sin yaw, 0, cos yaw]`). Sim keeps `body.look = [yaw, pitch]`; when absent, cameras integrate `axes.look` and publish `axes.camera = [yaw, pitch]` in every step's input (by wrapping `view.input`). Renderers read `body.vel`, `body.grounded`, `body.facing` (vector in 3D) and `body.state` (`air`, `swim`, `climb`, `glide`, `ride`, `crouch`...). |
| runtime | `axes.look` is radians per step; `engine.input.actions` owns pointer lock; `swap_camera` cycles cameras. Cameras only add their own pointer-lock mouse when the document has no input primitive. |
| flat | flat owns and registers `graphics.particles`, `graphics.post`, `graphics.fx.feedback`. For 3D spaces they call `rt.caches.three.adapters[id](rt, config, instance)`; `three-effects.js` implements those adapters (world-space particles bound to the same `bind` list, HDR bloom/tone map/outline/depth-crease AO/vignette/grain/quantize/scanlines/flash, hit-stop and slow-mo on the presentation clock). Camera shake and zoom punch read `rt.caches.flat.feedback`. No `particles3d`/`post3d` ids exist. |
| ui | `rt.service('camera')` = `{ kind, project([x,y,z]) -> [px, py] | null, projectEntity(id), unit() }`, provided by whichever renderer installs; each delegates to the earlier provider while the player is in the other kind of space. |
| everyone | Presentation-only animation events (`step`, `hit`, `release`, `land`, `thud`, `takeoff`) are dispatched as `CustomEvent('gv:anim', {detail: {event, who, at, ...}})` on `view.container` (and `stage.animListeners`). They never reach `rt.emit`. |

Gameplay events that trigger clips (fields read): `attack|swing|melee_swing {who}`, `hit {target}` (hurt),
`hurt {who}`, `damaged {target}`, `defeated {target|who}`, `died {who}`, `jump|jumped {who}`,
`land|landed {who}`, `block_mined|block_placed {by|who}`, `shoot|fired|projectile_fired {who}`,
`talked {character}`, `dialogue_start {speaker}`, `dodge|dodged`, `parried`, `blocked`, `crafted`,
`item_used`, `mounted`, `dismounted`, `interacted|used`, `cast`, `reach_goal` (all `{who}`).
`health.dead` also starts a death. `graphics.anim.clips.triggers` adds more.

## Requests

1. **Presentation observer hook.** Pose interpolation needs the entity positions at the end of each step.
   Today the stage registers `rt.system('late', record)` that only reads state. A kernel
   `rt.observe(fn)` (called after every step, never part of systems, solver keys or snapshots) would keep
   presentation out of the simulation scheduler. *Workaround:* the read-only late system; a test
   asserts snapshots are identical with and without graphics.
2. **`engine.space.test` writes state on first read.** Its `st()` initialises `state.spaces[id].cells`
   and `.log` lazily, so a renderer that only calls `getCell`/`cellsIn` changes the snapshot (`log: []`
   appears). Please initialise in `install`. *Workaround:* the determinism test reads once headless.
3. **Host view additions (§6).** Optional `view.now()` (presentation clock; tests and recorders) and
   `view.createRenderer(THREE)` (headless GL, Node tests with a stub renderer). Both are used here when
   present; please document them in KERNEL_API §6 so hosts can rely on them.
4. **Presentation-only services.** Renderers list `provides.services: ['camera']`, but the service only
   exists in the browser. Preflight cannot tell; a primitive that `requires.services: ['camera']`
   would pass preflight and fail headless. Proposal: `provides.presentationServices` (or a
   `presentation: true` flag) so preflight only lets graphics/UI primitives require them.
5. **Event field names.** Please make the combat/move/blocks primitives use the fields listed above
   (`who` = actor, `target` = receiver, `by` for cell edits); the clip triggers depend on them.

## Gaps (honest)

- **Voxel block light.** `lightModel: full` is drawn as emissive glow plus bloom and sky exposure
  (faces under overhangs and in caves darken by depth below the column top); light does not
  flood-fill from lamps onto neighbouring blocks.
- **Cascaded shadows.** `cascade` is one stabilised sun shadow map fitted around the player, wider and at
  4096², not a multi-split CSM.
- **Meshing workers** (`workers`, default 2) run in browsers with module workers; cell gathering
  (`chunkCells`/`cellsIn`) stays on the main thread under `meshBudgetMs`. Node and hosts without
  `Worker` mesh on the main thread.
- **Lakes above sea level** are not drawn: the water plane uses `water.level` only (`waterLevelAt` is not
  read yet).
- **Ragdoll** is a particle-and-stick verlet body with ground collision only (no collision with walls
  or other bodies, no joint angle limits).
- **Real spaces untested in the browser.** `engine.space.voxel` and `engine.space.mesh3d` had not landed on
  this branch. The renderers were checked against `engine.space.test` (voxel) and a test heightfield space
  shaped like the agreed mesh3d API.
