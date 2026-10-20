# Kernel requests: modes workstream

Workarounds for each request live inside the modes files, so nothing here blocks.

## 1. Role names in `rt.resolve` (`target`, `actor`, `owner`)

Mode actions (turn actions, card effects, RTS attacks, round resets) run third-party effects such as `damage{who}` against a participant that is neither the player nor `context.self`.

- **Request.** `rt.resolve(who, context)` should map `'target'`, `'actor'` and `'owner'` to `context.target`, `context.actor` and `context.owner`.
- **Workaround.** `bindRoles()` in `gameplay/modes-lib-util.js` rewrites `who: 'target' | 'actor' | 'owner'` and any `'$role'` string to entity ids before calling `rt.run`.

## 2. System-level pause and time scale

Several modes need to stop the rest of the simulation for a while:
- `gameplay.minigame` while a sub-mode runs;
- `gameplay.rounds` during intro, KO and round-end;
- hitstop and KO slow-motion.

- **Request.** `rt.pause(owner, {spaces?, except?})` / `rt.resume(owner)`, with systems skipped unless they opt in (`rt.system(phase, fn, owner, {whilePaused: true})`). Optionally add `rt.timeScale`.
- **Workarounds.**
  - `minigame` freezes entities outside the minigame space by restoring their JSON every step. Vars and timers owned by other primitives still advance.
  - `minigame` publishes the `pause` service (`paused(space?)`) and flag `paused`.
  - `rounds` publishes var `round.live` and flag `round_live` for combat and AI to gate on.

## 3. A sanctioned way to retune another primitive's config at runtime

`gameplay.stage.sequence` applies per-stage parameter tables to other primitives: maze speed and fright tables, gravity curves, wave caps.

- **Request.** `rt.configure(instanceKey, patch)`, recorded in state so `restore()` and replays reproduce it.
- **Workaround.** Targets `use:<id>[#n].<path>` are written in place into the instance's `with` (owners read config lazily; ws-puzzle confirmed). The original values are kept in `rt.caches`, and the current stage's writes are re-applied in `rt.onRestore` and in `extend()`. `var:` and `flag:` targets need no workaround.

## 4. Shared component conventions to freeze (KERNEL_API §2)

- **`seat {vehicle, seat}`** (owned by `gameplay.vehicle.core`) marks an entity riding a vehicle. Its position follows the vehicle. Movement, physics and AI primitives should skip seated entities.
- **`drive`** (owned by `vehicle.car/boat/aircraft`) holds vehicle kinematics: `heading`, `vf`, `vl`, `vy` and `speed`. AI drivers write `drive.control = {throttle, steer, brake, handbrake, boost}`.
- **`waveEntry {points, i, speed}`** (owned by `gameplay.waves`) means the entity is flying its entry path. AI should not steer it until the component is gone.
- **`ghost {race}` and `echo {of}`** mark replay entities (from `race` and `rewind`). Scoring, combat and collectibles should ignore them.

## 5. Per-entity time scale

`gameplay.rewind` supports per-entity immunity (`components.time.rule = 'immune'`) and an echo. Braid-style slowed local time (`rule: 'slow'`, time rings) needs the movement and physics primitives to read a per-entity dt multiplier.

- **Request.** A kernel convention `components.time.scale`, honoured by every integrating primitive.

## 6. Modal stack

Modes nest: a turn battle runs inside a minigame, and a card-reward prompt follows a battle. The kernel holds a single `state.modal`.

- **Request.** Make `openModal`/`closeModal` a stack, with the open modals' allowed actions merged.
- **Workaround.** `pushModal`/`popModal` in `modes-lib-util.js` merge the outer modal's actions and restore the outer modal on close. If the outer mode closes first, its modal is not restored, and the inner mode's merged actions stay until the inner mode closes.
