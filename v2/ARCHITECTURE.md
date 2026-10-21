# Gameverse v2 architecture: a game-creation engine

## 0. What this is

A player types any idea and gets **the game they asked for**, real and playable:
- any genre: platformer, kart racer, chess, creature RPG, farming sim, 3D dungeon crawler, tactics, cards, mystery…
- any **mashup** between them: chess × Pokémon, Mario Kart with shopping carts, Pac-Man in a haunted library.

The bar is a real game, not a tech demo:
- **fast** to generate;
- **high quality** to play;
- **reproducible**: the same idea, seed and versions give the same game;
- **reliable**: what publishes works.

A cohesive engine, not a pile of patches. One architecture spans everything:
- Mechanics exist once, as composable primitives with declared contracts.
- Generation composes them for the idea.
- Typing and validation prove the composition before anything runs.
- Playtesting agents prove the game plays before anyone sees it.

The genre kits (`v2/kits`) were shallow and couldn't be mixed, but every kit game worked: real controls, a real world, a real win. The engine must keep that reliability while removing the ceiling.

## 1. Non-negotiables

1. **The game is the idea.**
   - Never substitute another game: no generic fallback, no "closest genre", no dropping a core mechanic to make checks pass.
   - If the idea can't be built yet, the build fails and says exactly what is missing.
2. **General, never special-cased.**
   - No genre engines, and no one-off patches for a game.
   - No single default shape stamped onto every idea. One adventure template applied to chess was the failure mode.
   - Presets and templates are welcome when they are general, declared, and chosen by the idea.
3. **Mashups are first-class.**
   - Concepts that don't natively fit are combined through **adapters** that project one concept into another: a side-scroller on a plane in a 3D city, a race course on a tile overworld, a battle as a sub-mode of a board game.
   - Incompatibility means "write or pick an adapter", never "swap the world" or "drop the mechanic".
4. **Typed and validated end to end.**
   - **Cards are the type system.** Every primitive declares what it requires and provides: capabilities, services, content, interaction, mode, which spaces it targets, its extent.
   - Compositions are checked statically, from declarations alone, before any model call or simulation.
   - Code is strictly type-checked. Everything from outside (model output, stored versions, requests) is untyped until validated against schemas derived from the cards.
   - A missing declaration is a type hole and is reported; it is never treated as compatible.
5. **Nothing broken publishes.**
   - A version publishes only when the playtest agent shows the game runs and is **viable**: the player can act, the core loop happens, and progress toward the win is possible.
   - It doesn't have to be finished in N seconds, and intros and cutscenes are fine.
   - A crash, a world you can't move in, a missing opponent or an empty board blocks publishing, with the reason.
6. **Fast.**
   - Deterministic code builds structure instantly.
   - The model writes only what needs judgement: theme, names, content, tuning.
   - Model calls are small, parallel and repairable field by field. A cheap fast model is the default.
7. **Clean runtime.**
   - Selecting, switching or deleting a game fully unloads it: canvas, game code, audio, listeners, workers.
   - Nothing plays sound or runs behind the game on screen.

## 2. Kernel and spaces

The kernel is space-agnostic. It knows about:
- entities and components (plain JSON);
- events;
- a phase-ordered scheduler and time;
- vars and flags;
- predicates and effects;
- RNG and snapshots.

It never knows what space looks like. Spaces are primitives: voxel, mesh3d, tilemap, physics2d, arena2d, track, graph, grid, none. Each provides a declared set of capability interfaces: position, distance, overlap, raycast, pathfind, reachable, editCells, gravity, navigate, surface, occupancy, los.

Determinism:
- State is JSON, and RNG lives in state.
- The same document, seed and inputs give the same snapshot.
- The same simulation runs headless for verification and in the browser for play.

See `KERNEL_API.md` for the frozen contract.

## 3. Primitives and their declarations

A primitive has an `id`, a `card` (its declarations), `validate`, and runtime hooks (`install`, `generate`, `render`).

Its card declares, as data:

| Declaration | Meaning |
|---|---|
| `params` | typed parameters with ranges and defaults |
| `requires` / `provides` / `conflicts` | capabilities, services, primitives, events, vars, actions |
| `reads`, `content` | document sections it plays with, and the minimum content it needs to be meaningful (enemies placed in zones, species, racers, pieces…) |
| `engage` | how the player and AI participants take part (seated in a vehicle, on a side, holding a deck) |
| `drives` | for AI primitives: that it acts for AI-controlled entities (`control: 'ai'`), which ones (entities carrying its `components`, the participants of the `loops` it names, with `targets` those of every loop declaring a target service, else its own loop's), and what they do (`actions`, `effects`, `events`, `movement`), checked against the loops' losses |
| `mode` | for loop-owning primitives: loop, interaction (avatar-realtime, avatar-grid, pieces-turns, cursor-board, menu), opponent, content needs, win/lose wiring, the bot that proves it, and `targets`: the service telling each AI participant where to go next (a race's next checkpoint, the ball) |
| `spaces`, `provides.content`, `provides.extent` | for generators: which spaces they build, what world content they produce, what area they fill |
| `needs.content` | for spaces: the world content they must have to be playable |
| `locomotion`, `medium` | for movement: base or modifier, ground/air/water/track |
| `interactions` | for input primitives: the interaction models they serve |
| `adapts` | for adapters: the capabilities, content or services they project, and from what |

These declarations are the single source for:
- the static composition check;
- the model's strict forms;
- repair hints;
- the playtest agent's choice of bot.

## 4. The game document

One JSON document (`gameverse.v2.game/0.2`) references primitives by id and parameterizes them:
- spaces, with generators and zones;
- systems;
- graphics;
- content: archetypes, items, species, cards…;
- plot: characters, story, quests, dialogue, endings — only when the idea has narrative;
- player — only when the interaction has an avatar.

The document's shape follows the idea's mode, not a template. A board game has a board, pieces, sides and turns, and no walking avatar.

Games are **versioned**. Each change produces a new immutable version that is checked like a new game. Streaming content into a running game is not required.

## 5. Generation

```
idea
 → play spec (model, small strict schema):
     core mode, interaction, opponent, win/lose, theme;
     for mashups, primary + secondary modes with relation nested | union | skin
 → selection (deterministic from declarations): the mode's primitives, the movement that fits the
     world and the idea, the generators the space needs, adapters for every mismatch; then the loop steps
     (planner/build-steps.js): the win, the lose, the drivers of AI opponents and what changes the win's reads,
     each a small enum question over candidates the composition and loop checks passed (none fits: a gap)
 → static composition check (types): must be compatible, or compatible via adapter; a missing adapter
     is a gap the gap layer writes (model-written primitive, gated by tests and playtest)
 → preset (deterministic, instant): space, world, systems, sides/participants, win wiring, input;
     it wires only what selection chose and never picks a primitive (a win, an owner, a driver) itself
 → content (model, small strict forms in parallel): themed cast, species, pieces, places, story,
     filled into the mode's content contracts; content packs give mechanically valid defaults
 → repair (field-level): only the failing fields go back to the model, never the whole document
 → playtest gate (§6) → publish a version
```

What writes what:
- **The model writes only:** the play spec, themed content, tuning, and revision ops.
- **Code writes:** structure, wiring, worlds, participants, endings, input.
- **Escalation:** a small form the default model fails twice goes to a stronger model, for that form only.

## 6. Verification

1. **Static, before generation spends anything:** the composition check over card declarations (capabilities, content, engagement, mode, interaction, adapters), and preflight of the document against the card-derived schemas.
2. **Playtest agents, before publishing:** each mode's bot plays the game headless through its real controls. The gate requires:
   - no crash, NaN state, runaway entities or event storms;
   - the player can act from the start of play;
   - the core loop actually happens (the mode's events fire);
   - progress toward a winning ending is reachable: a win, or play moving the quantity the core loop's win reads (`win.reads`) toward it beyond what idling does;
   - deterministic replay.
3. **Quality signals, after publishing (non-blocking):** responsiveness, mechanics used, pacing, dead time, variety, fairness. These score versions and drive improvement.

Testing is done by the playtest agents and by running real ideas through the real pipeline, not by hand-poking games in the user's browser.

## 7. Delivery rules for anyone building this

- Every user request is tracked until it is visibly done in the running app. Nothing is silently dropped, deferred into a long todo list, or replaced with self-assigned work.
- Work lands in small, verified increments. Each increment ends with real ideas run through the live pipeline, the playtest agent confirming the games play, and the server restarted. Only then is it "done".
- No long unsupervised agents holding the user's asks. Delegate small, checked pieces, and integrate and verify each one before starting the next.
- Integration is part of the task. A component isn't done until it is called from the live path and proven there.
- Don't invent policies, caps or gates the user didn't ask for. Ask once if unsure.
- No benchmarks or side projects while the app is broken.

## 8. Code layout

| Path | Contents |
|---|---|
| `v2/kernel/` | ECS, events, scheduler, predicates, effects, capabilities, registry, preflight; no space code |
| `v2/primitives/{engine,plot,graphics,gameplay}/` | One file per primitive, with its card |
| `v2/planner/` | Generation: play spec, selection, composition check, presets, content forms, repair, pipeline |
| `v2/verify/` | Plot solver, spatial checks, playtest, mode bots, invariants, quality |
| `v2/server/` | Studio API, isolated jobs |
| `v2/web/` | Studio and player |
