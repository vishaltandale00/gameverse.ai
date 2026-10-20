# Kernel requests from the story workstream

Each request has the workaround the plot primitives use today.

## 1. Owners enforce `plot.gates[].locks` through the `gates` service

A gate's `locks` (`exit:<a>><b>`, `portal:<id>`, `zone:<id>`, `interactable:<id>`, `mechanism:<id>`, `beat:<id>`, `quest:<id>`) is enforced by whichever primitive owns the locked thing. The story workstream enforces `beat:` (plot.storyboard) and `quest:` (plot.quest). The service is generic:

```js
const gates = rt.hasService('gates') ? rt.service('gates') : null;
if (gates && !gates.allows(`portal:${id}`, { who: entity.id })) return false; // emits gate_blocked:<gate> with its hint
```

`gates.exit(from, to)` is shorthand for `allows('exit:from>to')`. `gates.locked(target)` checks without emitting.

- **Requests (to owners, not to the kernel):**
  - `engine.space.graph` `canMove`: check `exit:` locks.
  - Continuous spaces / `engine.zones`: check `zone:` and `exit:` locks when an entity would enter a zone.
  - `engine.portal`: check `portal:` locks.
  - `gameplay.interact` and `gameplay.mechanism`: check `interactable:` and `mechanism:` locks.
- **Workaround:** a document can also put `{ "gate": "<id>" }` on the exit's or portal's own `gate` predicate. The `gate` predicate works anywhere. The static analysis (`story-graph.js`) treats locks as enforced either way.

## 2. Two primitives register the same predicate kind

`Logic.predicate()` overwrites silently. The catalog gives `alive` both to `plot.character` (`{alive: character}`) and to `gameplay.combat.health` (`{alive: who}`). Whichever registers last (by sorted id: `plot.character`) wins.

- **Workaround:** `plot.character`'s `alive` accepts both forms. `{alive: "<id>"}` and `{alive: true, who}` resolve through the character record when there is one, otherwise through the entity and its `components.health` (`hp`, `current`, `value` ≤ 0, or `dead`).
- **Request:** have `buildLogic` report a duplicate predicate or effect kind as a registry error, naming both owners, so these collisions surface instead of shadowing each other.

## 3. `validate` can only return errors

Some story findings are warnings, not errors: a conversation with no unconditional exit, unread vars. Preflight has no way to return them from `validate`.

- **Workaround:** these come from `plotGraph(doc, logic)` (`v2/primitives/plot/story-graph.js`) as `problems[]` with a severity. v2/verify merges them.
- **Request:** add `ctx.warn({code, path, message, hint})` in preflight.

## 4. Modal story state

While a dialogue or cutscene is open, `plot.character` and `plot.quest` hide their options and ignore `talk` / `accept_quest`. Other primitives still offer `go`, `attack`, movement and so on, so the solver and playtesters can walk away from a conversation in mid-line.

- **Workaround:** `rt.service('dialogue').active()` and `rt.service('cutscene').playing()` are available for input/movement primitives that want to respect them.
- **Request:** a kernel notion of modal input, for example `rt.modal(owner)` / `rt.isModal()`, that `rt.availableOptions()` and `engine.input.actions` honour.

## 5. Falsy action values are dropped

`rt.step` skips falsy action values (`if (!value) continue`), so `{choose: 0}` never reaches its action.

- **Workaround:** choices are picked with `{choose: {index: 0}}`, a choice id string, or a number ≥ 1. `event_choice` takes `{index}`. Every story option uses non-falsy values.
- **Request:** skip only `undefined`, `null` and `false`. Or document the rule in KERNEL_API §2.

## 6. Contracts the quest objectives read (for other workstreams)

Objective kinds listen to typed events from their owners. Each base event carries `subject`:

| Objective | Event | Fields | Owner |
| --- | --- | --- | --- |
| `defeat` | `defeated` | subject = archetype; `id`, `zone?` | combat.health |
| `use` | `used` | subject = interactable; `tags?` | interact |
| `craft` | `crafted` | subject = recipe | crafting |
| `discover` | `discovered` | subject = zone; `tags?` | engine.zones |
| `build` | `block_placed` | subject = block; `at`, `space?` | blocks.place |
| `build` | `built` | subject = structure | build.structure |
| `drive` | `vehicle_entered` / `vehicle_exited` and `mounted` / `dismounted` | `{who, vehicle \| mount \| id}` | vehicle.core / mount |
| `survive` | `player_died` | | death |

Character deaths are read from `died {id}`. `collect` and `deliver` read counts through the `item` predicate. `gameplay.inventory` has no count API, so the count is found by binary search on `{item, gte}`.

- **Request (to items):** emit `item_gained:<item>`, and provide `rt.service('inventory').count(who, item)`.
