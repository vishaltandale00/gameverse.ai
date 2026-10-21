# Kernel API v1 (frozen for the primitive build-out)

This is the contract every primitive is written against. `ARCHITECTURE.md` gives the design and `PRIMITIVE_CATALOG.md` the primitive specs. A primitive's **card is the source of truth** for its params: where a card extends the catalog, the card wins and the catalog is regenerated from cards.

**There are no genre engines.** A game is a document of primitives. A mechanic exists once, as a primitive that any document can combine with any other. When something is missing, add or extend a primitive; never add a special case for one game.

## 1. Primitive shape

```js
export default {
  id: 'gameplay.combat.melee',              // family.domain[.name]; file named after it, e.g. gameplay/combat-melee.js
  card: {
    intent: 'one or two sentences the planner model reads',
    views: ['3p', 'side', 'td'],            // or ['any']
    params: { name: { type, default, min, max, unit, options, of, fields, open, required, effect } },
    provides: { capabilities?, events: ['hit', 'defeated:*'], vars: ['hp'], services: ['roadgraph'], actions: ['attack'] },
    requires: { capabilities: ['overlap'], primitives: ['gameplay.combat.health'], services: [] },
    conflicts: [],
    reads: ['content.items'],               // document sections it consumes (preflight warns on unread data)
    defines: [{ kind: 'gate', at: 'plot.gates' }, { kind: 'portal', in: 'portals' }],  // new reference kinds
  },
  logic(logic) {},                          // register predicates/effects (once per catalogue)
  validate(config, doc, ctx) { return [] }, // extra preflight: [{code, path, message, hint}]
  install(rt, config, instance) {},         // runtime hooks; instance = { key, use, with, space?, id? }
  extend(rt, config, added, instance) {},   // only if it caches derived data and must see hot-loaded content
  capabilities(config) { return [...] },    // spaces only, when capabilities depend on params
};
```

Param types: `number integer boolean string ref list object predicate effects json`. `ref` takes `to: <kind>`. A `string` that selects entities (an entity id, an archetype id or a tag) declares `selects: ENTITY_KINDS` (`kernel/params.js`): a value that is an id of those kinds refers to that entry, so composition renames it with the entry; other values stay free. `object` takes `fields`, `open` and `values` (the shape of every value under a key `fields` does not name: a map with free keys). `list` takes `of`, `min` and `max`. An `object` may declare `variants: { by, of: { <value>: fields } }`: fields that depend on a discriminating field (a quest objective's `kind`). A `string` naming a typed target declares `targets: { <prefix>: kind | { of: [kinds], sep } }` (a gate lock `exit:<zone>><zone>`). A space card declares the fields of its zones in `card.zoneFields` (the graph's exits: `to` a zone, `gate` a predicate). Composition renames the references all of these hold (`planner/compose.js`). Defaults are applied by preflight, so `install` receives a complete config.

**Reference kinds** come from `card.defines`:
- `{kind, at}` indexes a document path: a list of `{id}` or an id-keyed object.
- `{kind, in}` indexes a list of `{id}` inside each instance's `with`.

Base kinds (`character item zone quest model archetype space beat ending recipe block dialogue`) are built in. Never edit `REF_KINDS`.

## 2. Runtime (`rt`)

| Member | Use |
| --- | --- |
| `rt.state` | The JSON game state: `frame time status ending rng vars flags counts events entities spaces prim`. Everything that must survive a snapshot lives here. |
| `rt.store(key)` | Per-primitive JSON state at `state.prim[key]`. Fetch it inside each call; never hold it across calls, because `restore()` replaces it. Key it by primitive id, or by `instance.key` when several instances are allowed. |
| `rt.caches` | Non-JSON derived data (indexes, meshes). Rebuild it in `rt.onRestore(fn)` and when `rt.doc` changes. |
| `rt.system(phase, fn, owner)` | Per-step system. Phases run in this order: `input ai movement physics interaction rules plot late`. |
| `rt.on(name, fn)` | Event handler. `'*'` receives every event. |
| `rt.emit(name, data)` | Emit an event and increment `counts[name]`. |
| `rt.emitTyped(name, subject, data)` | Emits both `name` (with `subject`) and `name:<subject>`. Use it for every typed event (`defeated:goblin`, `item_gained:key`). |
| `rt.action(name, fn(value, rt))` | Player verb. Input reaches it through `step({actions})`. |
| `rt.hold(by, owners)` / `rt.release(by)` | Skip the systems registered by `owners` (their `rt.system` owner) until released. A nested loop holds the outer loop while it runs (`engine.adapt.nested`). Kept in `state.held` only while something is held. |
| `rt.options(fn(rt) → [{label, text, actions, steps?, apply?(rt)}])` | Meaningful player choices, as hints for solvers and playtest bots. `label` is the solvers' key (unique, ids allowed); `text` is what a person reads when a UI lists the option (graphics.ui.story, graphics.ui.choices, graphics.ui.battle), written with the document's names (`Talk to Old Maren`, a dialogue choice's line), never ids (`tests/v2-option-text.test.js`). Bots act only through the real controls (input driver); every option's `actions` must be issuable through a declared control. Continuous spaces offer macro options such as "travel to zone X" via `apply`, which the bot realizes as input. |
| `rt.provide(name, api)` / `rt.service(name)` | Shared services (`roadgraph`, `surface`, `biomeAt`...). Declare them in `card.provides.services` / `requires.services`. |
| `rt.defineSpace(id, api)` / `rt.space(id)` / `rt.spaces()` | Spaces (§3). |
| `rt.spawn(archetype, {space, at, components, id})` / `rt.despawn(id)` | Entities. Characters spawn with `id = character id`. |
| `rt.entity(id)`, `rt.player()`, `rt.query(...components)`, `rt.resolve(who, context)` | Lookups. `resolve` maps `'player'` or undefined to the player, `'self'` to `context.self`, and anything else to an entity id. |
| `rt.moveToSpace(entity, spaceId, at?, zone?)` | Cross-space travel (portals, interiors, battle screens). |
| `rt.test(pred, context)` / `rt.run(effects, context)` | Evaluate predicates and run effects. `context.self` is the acting entity. `context.defaultWho` (e.g. `'self'` for AI rules) is the subject when a predicate or effect omits `who`. |
| `rt.random()` | The only randomness allowed. It is seeded and stored in state. Never use `Math.random`, `Date` or `performance` in simulation. |
| `rt.input` | This step's input: `{actions:{verb:value}, axes:{move:[x,y], look:[x,y]}, held:{verb:true}}`. |
| `rt.headless` / `rt.view` | `view` exists only in the browser (§6). Simulation must never depend on it. |
| `rt.step(input)`, `rt.snapshot()`, `rt.restore(s)`, `rt.extend(doc, added)` | Driven by hosts, solvers and the planner. |

**Entities** are plain JSON: `{id, archetype, space, at, zone?, components:{...}}`. Components are keyed by the owning primitive (catalog §0): `health melee ranged ai attacks schedule vehicle mount interact shop container equipment loot level resources status model body`. Continuous spaces keep kinematics in `components.body` = `{size, vel, grounded, facing, layer}`. A primitive owns only its own component and reads others' through their documented fields.

**Shared component fields (frozen).** Primitives that own these components must use these field names; others may read them:

| Component | Fields |
| --- | --- |
| `body` | `size` (box extents), `vel`, `facing` (+1 or -1 in 2D, a vector in 3D), `grounded`, `layer`, `solid` (true: other bodies' `slide` treats this entity as an obstacle, e.g. closed doors, crates, trains), `oneWay` (solid from above only) |
| `health` | `hp`, `max`, `invulnerable` (seconds left, 0 when vulnerable), `dead` |
| `status` | `{statusId: secondsLeft}`, with `Infinity` not allowed: use a large number |
| stats `stat.fright` / `stat.edible` | touching the entity defeats it instead of hurting the toucher (maze fright). Set by a status's `mods` (`content.statuses[].mods`) or `components.stats`; read only through `touchDefeats(rt, e)` (`gameplay/combat-lib.js`) by contact, AI and bots. A status's name has no behaviour of its own. |
| `collectible` | `counter`, `value` |
| `interact` | `id` (an interactable id), `kind`, `prompt`, `range?` |
| `ai` | owned by `gameplay.ai.brain` (catalog §6.4) |

The player's scalars are mirrored to vars: `hp`, `hp.max`, `res.<pool>`, `score`, `lives`.

**Shared effect contracts (frozen).** These effects have a single owner but many callers:
- `add_score {amount, reason?, who?}` is owned by `gameplay.score`. The `score` var mirrors the total.
- `damage {who, amount, type?, from?}` is owned by `gameplay.combat.health`. Deaths emit `died {id, archetype}` plus `defeated` / `defeated:<archetype>`.
- Physics contact events are `contact`, `impact` and `contact_end`, with the fields documented on `engine.space.physics2d`. A primitive that moves its own bodies in another space may emit the same events.

**Solver conventions.**
- Option `label`s must be unique within one state's `availableOptions()`.
- `state.rng` is a uint32 that solvers may reseed to sample chance.
- A primitive declares how each verb's value is given in `card.actionSpace: {verb: {type: 'number'|'vector'|'enum'|'choice', min?, max?, options?, of?}}` (or `{kind: 'continuous'|'impulse', params}`), so playtesters can sweep it and the host gives a person a control for it (ARCHITECTURE §6.3, `v2/web/input-defaults.js` `verbControl`): no entry (or an impulse, or an enum of `[true]`) is a press, a key sending `true`; an enum gets one key per value; a vector or continuous input axis (`move`, `look`, `aim`...) is held; `choice` (with `of`: what the value names) is a value chosen among those the primitive's options list, and a number or vector that is no input axis is one too: a UI primitive whose `card.controls` declares the verb issues it. Every loop verb whose value is chosen declares its provider (`from: 'options'`: the options the primitive offers for it now; or `selects: '<field>'`: the values of that field in the options of the verbs whose choice `pick`s it) and `emits`, the events (its own or a required primitive's) one of which a provided value fires; `choiceDeclarationProblems` in `runtime-lib-controls.js` checks them, `tests/v2-choice-providers.test.js` proves every one offers a value in a minimal document and fires through the controls and graphics.ui.choices. A verb with nothing to offer in an instance is left out by `card.loop.verbsOf` (travel without zones, minion attacks outside duels).
- **Refusals.** A primitive that refuses a player's verb emits an event with a `reason` and declares it in `card.denials` (one of its `provides.events`); a UI primitive whose `card.feedback.denials` is true (graphics.ui.hud, graphics.ui.choices) shows it, and every document a person plays mounts one. Every event a primitive's file emits by name is declared on its card (`tests/v2-events-declared.test.js`).
- A primitive may shape its part of the solver's state key with an optional `solverKey(rt, config, instance)`, and report progress with `progress(rt)`.
- Spaces expose `size` (or `bounds()` with the `bounds` capability) and, when they are cell-based, `cellOf(at) → key`. `reachable` returns a Set of those keys (or zone ids in graph spaces).

**Determinism rule:** the same document, seed and inputs must give the same `snapshot()`. Tests must assert this.

## 3. Space API

A space's `install()` calls `rt.defineSpace(instance.id, api)`. Its card's `provides.capabilities` (or `capabilities(config)`) lists exactly the capability interfaces it implements, as defined in catalog §1:

| Capability | Methods |
| --- | --- |
| `position` | `place remove setPos pos entitiesAt inZone zoneAt teleport nearest` |
| `distance` | `distance` |
| `overlap` | `overlap contacts` |
| `raycast` | `raycast` |
| `pathfind` | `path` |
| `reachable` | `reachable canReach` |
| `editCells` | `getCell setCell fill cellsIn editLog` |
| `gravity` | `gravityAt slide grounded` |
| `navigate` | `neighbors canMove move` |
| `surface` | `groundAt slopeAt waterDepthAt` |
| `occupancy` | `occupant cellsInRange moveCost coverAt` |
| `los` | `los visibleFrom` |

- **Frame.** Every space card declares `card.frame` (`{up, handed}`: the up axis or null for a plane seen from above, and the handedness; null without geometry), read through `primitives/engine/runtime-lib-frame.js` (`spaceFrame`, `turnSign`). Turning right is clockwise seen from above in every frame; verbs acting on a cell without naming one act on the faced cell from above and below the feet only from the side (`items-lib.js actionCellAt`).
- **Anchors.** `api.anchor` says what `e.at` means:
  - `'center'`: the centre of the body box, y up (continuous spaces: tilemap, arena2d, physics2d, track, voxel, mesh3d);
  - `'cell'`: the grid space: integer positions are cell centres, so the body box is centred on `e.at` as for `'center'` (a cell spans `[at - 0.5, at + 0.5)`);
  - `'slot'`: the graph and none spaces;
  - `'min'`: the test space only.

  Never assume one. Use `bodyBox(entity, api)` from `kernel/testing.js` (safe to import at runtime) or read `api.anchor`.
- **Signatures.**
  - Reachability: `reachable(from, rt, opts)` and `canReach(a, b, rt, opts)`, with `opts = {abilities, envelope, who}`.
  - Cells: `getCell(at, layer?)`.
  - Validators: `validate(config, doc, ctx, {path, id, use, space})`.
- **Capability lists.** `bounds`, `wrap` and `dynamics` are kernel capabilities alongside those above. Space-specific ones (`joints`, `boxes`, `ledges`, `scroll`, `settle`, `cellRules`...) are documented in `card.provides.capabilityMethods`; conformance checks them.
- **Topology and passability.** `navigate.neighbors(at)` is the space's topology only (adjacent cells, a graph's exits); whether a given walker may enter one is `canMove(entity, to, rt)`, which applies blocks, class rules (a door only hunters pass), gates and one-way cells. Every search over a walker's moves (AI, movement, bots) steps through `stepsFrom(api, entity, at, rt)` from `kernel/testing.js`, never `neighbors` alone.
- **Cells of positions.** A position's cell is `api.cellOf({ at })` on spaces that expose it (it honours the anchor: the grid rounds to cell centres); code never floors coordinates itself where the space defines cells.
- **Kernel-owned spatial vocabulary.** The predicates `zone`, `near` and `cell` and the effects `teleport` and `move_to` are registered by the kernel and dispatch through the subject's space. Spaces must not register them. `move_to` only records intent in `components.moveTo`; movement and AI primitives carry it out.
- **Zone events.** Spaces emit `enter_zone` / `leave_zone` (typed: `enter_zone:<zone>`) as entities move, and keep `entity.zone` current.
- **State.** Space state lives in `rt.state.spaces[id]`; cell spaces store generator params plus an edit log.
- **Adding capabilities.** New capability interfaces (`wrap`, `bounds`, `settle`, `joints`...) may be added. Document their methods in the space's card under `provides.capabilityMethods: {cap: [methods]}` and add a conformance test. Shared names must mean the same thing in every space.
- **Conformance.** Every space must pass `spaceConformance` from `kernel/testing.js`.

## 4. Generators

`engine.generate.*` instances sit in `spaces[].generators[]` and install after their space, in document order. They write through the space API (`setCell`, `rt.spawn`, zones) or into `rt.state.spaces[id]`, deterministically from `rt.random()` / the doc seed. When a generator guarantees something ("traversable with abilities X", "no dead ends", "every pellet reachable"), it must prove it at generation time and emit a problem list. A traversal guarantee is declared as `card.traversal: { mover: 'player', problems: [codes] }` and proven for the movers the document actually has: the player's declared body box and the movement envelope of the document's locomotion cards for the abilities it holds (`moverOptions` in `gameplay/move-lib-envelope.js`, the same options the verifier's `navOptions` pass to `reachable`), on the space's own navigation (tile spaces: `spaces2d-tilenav.js`, whole tiles the controller makes). The generator publishes what it proved (`from`, `targets: [{id, cells}]`, `passes: [{from, to}]` for doors and warps); a seed it cannot satisfy reports those codes, and it re-draws sub-seeds only where its card already declares retries. Services it computes (`roadgraph`, `lotAt`...) go through `rt.provide`.

## 5. Logic vocabulary

- **Predicates** are objects whose first registered key names the kind. Comparators `gte lte gt lt eq ne` apply to numbers.
- **Effects** are `{do: kind, ...}`.
- **Kernel built-ins:** `all any not var count flag time zone near cell` and `set_flag clear_flag set_var add_var emit end_game teleport move_to`. Everything else is registered by its owning primitive in `logic()`, as listed in catalog §7.
- **Scalar state uses vars** (`hp`, `res.stamina`, `money.gold`, `score`...); don't add a predicate for a number.
- **One owner per kind.** Registering a predicate or effect kind that another primitive already registered throws when the catalogue is built. Agree on one owner; others read the owner's state (for example `alive` is owned by `plot.character`, and checks `components.health.dead` when present).
- **Owners must be present.** Preflight rejects document data using a kind whose owner the document doesn't use (`vocabulary_owner_missing`). At runtime, call another primitive's vocabulary only when `rt.canRun(kind)` / `rt.canTest(kind)` is true. Never test `rt.logic.effects.has`, which ignores whether the owner is installed. `rt.has(primitiveId)` says whether a primitive is installed. A card with `ambient: true` (pure vocabulary providers, test stand-ins) is exempt.
- **Warnings.** Validators can report non-fatal findings with `ctx.warn({code, path, message, hint})`.
- **Action values.** Only `undefined`, `null` and `false` mean "no action"; `0` and `''` are delivered.
- **New vocabulary.** If your primitive needs a kind that's missing, register it in your own `logic()`, add `refs()` for reference checking, and add `check()` for field validation.

## 6. Graphics and hosts

Graphics primitives install only when `!rt.headless`. The browser host (`v2/web/player.js`) passes `view = {container, THREE, act(actions), onFrame(fn(alpha)), input()}`. A renderer:
- draws entities of the space it is bound to (`instance.space`, default first space), and only while the player is in that space;
- interpolates with `alpha`;
- never writes `rt.state`.

UI primitives layer DOM in `.gv-overlay` and send choices through `view.act`; each declares `card.interactions` (the interactions it gives a person controls for) and `card.controls` (`verbs` it sends; `choice: true` for graphics.ui.choices, which issues every choice verb no other mounted UI names; `options: true` for a UI that sends a listed option's actions). Renderers and cameras declare `card.projection` per view (`{kind: 'plane', right, up}` or `{kind: 'chase', forward, right}` over the space's axes). The host mounts `v2/web/host-doc.js` `hostDocument(doc)`: the document plus its default input and UI; the gate, the first-playable boot and the composition check judge the same document (the loop check reads the document itself, whose loop report the host's additions never change: `tests/v2-host-document-checks.test.js`). `engine.input.actions` owns the device → verb mapping and sets `view.input`. Renderers read model specs from `content.models` (catalog §5.2) and draw everything procedurally, with no external assets; reuse `v2/art/*`.

What a person sees is declared, never inferred from names or words (`v2/primitives/graphics/presentation.js`, `flat-art.js`, `allegiance.js`):
- a loop with a win or lose declares `card.loop.shows` (`entities cells zones labels marks`) and each renderer `card.draws`; the template contract and the gate fail a document whose renderer does not draw what its loops show (`render_missing`, `shows_undeclared`). Zones drawn are the ones the loops' params name (`ref` to a zone); labels are `content.blocks[].label`; marks come from the service a card names in `card.marks` (`marks(spaceId) → [{at, kind, stage, stages, ready}]`);
- a card owning a component declares what an entity carrying it reads as: `card.presents: { <component | ref-to-archetype param>: {role, prop?, vector?, when?} | [...] }`; with the archetype's `kind` the highest-precedence role wins. A block's look is its `tile` and `color`;
- a primitive that puts entities on sides declares `card.sides: {param, control?, component?, field?, members?}`; the player's side is drawn as allies, the other as enemies;
- a loop end declares how a person watches it when that is not its `reads`: `shown` (`{var, max?, label?, applies?, each?} | {count} | {bar: 'boss'}` or a list, data only) or `once` (it happens at the first occurrence); the HUD shows these goals (`ui-defaults.js hudGoals`) unless a mounted UI's `card.displays` covers them.

## 7. Workstreams and file ownership

Each workstream owns:
- one registration index, `v2/primitives/<family>/<area>.index.js` (only it edits that file);
- files named after the primitives it owns, plus helpers prefixed with its area (`gameplay/combat-lib-*.js`);
- tests named `tests/v2-p-<area>-*.test.js`.

**Shared files.**
- **Kernel changes are contract changes.** When a defect or a missing capability is in the kernel, fix it in the kernel: update this document and the kernel types, and add a kernel test. Never work around a kernel defect inside primitive or planner code.
- **Example documents.** `v2/games/*.json` may be edited only within the instances (`with`) and data sections your primitives own.
- **Catalog.** Don't edit `PRIMITIVE_CATALOG.md`. Your cards are regenerated into it.

**Porting kits.** `v2/kits/*` hold mechanics to port, not to call: move their depth (constants, frame data, bots, generators) into primitives. Never import from `v2/kits` or `v2/engine`.

## 8. Testing contract

`kernel/testing.js` provides:
- `compile(doc, {primitives})` → `{rt, registry, logic, checked}`;
- `run(rt, n, input)`;
- `testSpace` (`engine.space.test`), a reference space implementing every capability, so non-space primitives can be tested before real spaces land;
- `spaceConformance(test, assert, opts)`.

Every primitive needs a test that does all of the following:
1. preflights a document using it;
2. exercises its behavior through `rt.step` / effects / events (not internal functions only);
3. checks deterministic replay;
4. checks that preflight rejects a bad config with the stable codes it documents;
5. preflights each of its instances in `v2/games/*.json` with zero param errors.

Keep tests fast (milliseconds; no wall-clock assertions).
