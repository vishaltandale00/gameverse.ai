# Kernel and host requests from the ui workstream

Each request below has a workaround inside the UI's own files, so nothing is blocked. Items 1–3 concern the browser host, `v2/web/player.js`, and the `view` object it passes. They are listed here because the view contract lives in KERNEL_API.md §6.

## 1. `view.pause(on)`: hold the simulation without losing UI actions

**Need.** Pause, title, journal, inventory and map screens hold the game. Choices made on those screens must still reach the game. For example, equip while the inventory is open, `select_character` on the title flow, or `save_game` from the pause menu.

**Request.** `view.pause(true|false)` in player.js. While paused, the host:
- does not step for gameplay time;
- still applies queued `view.act` actions with a single step each.

**Workaround.** In `graphics/ui-lib.js` `host.hold()`, the browser wraps `rt.step`. While held, a step with no truthy actions returns the state unchanged, and a step that carries UI actions runs normally. The wrap writes no state, and it is used only when `view.pause` is absent.

## 2. `view.restart()` and `view.load(snapshot)`

**Need.** The menu's Restart, Play again, Quit to title and Load commands need a host-level reset.

**Request.** `view.restart()`, which recreates or restores the world from its first state. Optionally also `view.load(snapshot)`.

**Workaround.** The UI host keeps `rt.snapshot()` of the first displayed frame and calls `rt.restore()` with it. Load uses `rt.restore()` with a snapshot saved in localStorage. Both are used only when `engine.save`'s `save_game`/`load_game` actions are missing. This is the only place UI code touches world state, and it is a host operation, not game logic.

## 3. Default UI for every game

**Request.** player.js should mount `withDefaultGraphics(doc, registry)` from `v2/primitives/graphics/ui-defaults.js` instead of its own `DEFAULT_GRAPHICS` table. With that, a document that lists no UI still gets a HUD, menu/pause, dialogue, journal, map, inventory, battle/card screens and audio, chosen from its systems. Documents that list their own UI keep it.

## 4. Presentation clock (no change needed)

UI primitives animate on `host.now()`. That is `view.now()` when a host supplies it (tests do), else `performance.now()`. Simulation never reads it.

## 5. Typed counts are not per-entity (note for engine.zones)

`counts['enter_zone:<zone>']` counts every entity that enters a zone, so the UI cannot use it as "the player discovered this zone". The map, minimap and HUD use these signals instead:
- `discovered:<zone>` counts;
- the `discovered` predicate (engine.zones);
- the player's current zone;
- a UI-local set of zones the player entered.

**Request.** engine.zones should emit `discovered:<zone>` for the player, so discovery survives a restore.

## 6. Renderer camera projection (for graphics.flat / graphics.three)

**Request.** A service `camera` with `project(at) -> [x, y]` in CSS pixels relative to `view.container`, or `null` when off screen. It lets the HUD place floating damage numbers and world-anchored prompts.

**Status.** The HUD calls it only when it is present. Without it, damage numbers are skipped.
