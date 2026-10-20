# Kernel requests from the engine runtime workstream

Each request lists the workaround the runtime primitives (`v2/primitives/engine/runtime.index.js`) use today.

## 1. Synchronous sandbox realm in the browser (engine.script.sandbox)

`engine.script.sandbox` must run scripts synchronously inside the step so that headless and browser runs stay identical. Node has `node:vm`, which is synchronous and has a per-call timeout. Browsers have no synchronous isolated realm except `ShadowRealm`, where it exists, and that has no timeout. A Worker is isolated but asynchronous.

- **Workaround:** `runtime-lib-sandbox.js` uses `node:vm` under Node and `ShadowRealm` when present. With neither, the script is disabled with `script_disabled` (`reason: no_sandbox`). The browser therefore diverges from headless for documents that use scripts.
- **Request:** a host-level decision. Either run the whole browser simulation in a Worker that owns its own `vm`-like realm (a nested iframe/Worker realm per script with `Atomics.wait` lockstep), or have the kernel accept a host-provided `sandbox(code) -> { call(method, json) -> json }` in `createWorld` options, so the browser host can supply one.

## 2. Mid-step restore (engine.save `load_game`)

Loading a save is `rt.restore(snapshot)`. Effects can run it mid-step, from a beat or a menu action. When they do, the systems later in that step run on the loaded state.

- **Workaround:** the `load_game` *action* is deferred to engine.save's `late` system. The `load_game` *effect* restores at once, as documented in its card.
- **Request:** `rt.defer(fn)`, run after the last system of the current step, so state-replacing effects can be safe anywhere.

## 3. Modal input (shared with story request #4)

While a UI panel is open, gameplay should receive no input, and solvers should not see gameplay options.

- **Workaround:** in the browser, engine.input.actions returns empty input while `view.modal` is truthy. It also drops presses made during that time. Headless runs have no equivalent.
- **Request:** `rt.modal(owner)` / `rt.isModal()`. engine.input.actions would then blank `rt.input` for gameplay verbs, and `availableOptions()` would filter by owner.

## 4. Runtime capability lists

Preflight knows each space's capabilities (`checked.capabilities`), but `rt` does not. engine.physics.rigid decides whether to delegate by checking `typeof api.impulse === 'function'`.

- **Workaround:** duck typing on the capability's methods.
- **Request:** `rt.capabilities(spaceId) -> Set`.

## 5. `rt.hasAction(name)`

engine.input.actions registers a no-op player action for every declared verb, so the kernel reports `action` events and solvers see the verb. It must not overwrite another primitive's handler.

- **Workaround:** `rt.actions().includes(verb)` before registering. Primitives installed later replace the no-op, which is the intended behaviour.
- **Request:** none if this is acceptable. Otherwise add an `rt.action(name, fn, { ifAbsent: true })` form.

## 6. Test space `slide` is all-or-nothing per axis

`testSpace.slide` refuses an axis move that would collide, rather than moving to contact. Bodies therefore hover up to one step's distance above the floor.

- **Workaround:** `sweep()` in `runtime-lib.js` retries halved moves on each blocked axis, up to 8 halvings, so characters and rigid bodies close the gap in any space with this behaviour. Spaces that resolve to contact (spaces2d) pay only the retries on blocked axes.
- **Request:** make `testSpace.slide` move to contact, matching the real spaces.

## 7. Dynamic zones and the kernel `zone` predicate

engine.zones' dynamic zones can be opened, moved and closed at runtime. `addZone` cannot remove or move a zone, so their membership is computed by engine.zones itself. Their ids are declared as `zone` kind and as `region` kind. The kernel `zone` predicate dispatches to `space.inZone`, so it does not see them.

- **Workaround:** use the `{region: id}` predicate for dynamic zones. Their `enter_zone:<id>` / `leave_zone` events carry `dynamic: true`, so quest objectives and counts work unchanged.
- **Request:** `removeZone(id, rt)` and `moveZone(id, shape, rt)` on spaces that implement `addZone`. Dynamic zones could then be real space zones.
