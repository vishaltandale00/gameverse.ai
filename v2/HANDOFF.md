# v2 handoff, 2026-10-21

Read this first, then `v2/ARCHITECTURE.md`, `v2/KERNEL_API.md` and the approved generation design below.

## The state, honestly

**Generated games are still broken.** The user generated a farming game, Pokémon chess, Mario Kart, Pac-Man and a 3D Zelda dungeon; every one came out unplayable or not the game asked for. The unit and integration suites are green, but they do not prove generation works. Nobody ran the user's ideas through the live pipeline and confirmed the results were playable. Do that before claiming anything works.

Branch: `claude/subagent-architecture-handoff-c2cd3b` (worktree `affectionate-hamilton-eb23af`). Not pushed. It is stacked on `claude/v2-kernel` (PR #31); the user wanted a new stacked PR for this work.

Run: `npm ci --ignore-scripts`, then `PORT=4181 node scripts/serve.mjs`, then open `http://localhost:4181/v2`. Port 4181 is the user's; restart only when asked. Never play-test in the user's browser; never let a test page make sound.

## Approved design (Fable consult): modes as declared, composable presets

1. **The idea becomes a play spec.** The decomposition gets `core: { mode, interaction, opponent, win, lose, theme }`. For mashups: a primary mode plus secondaries, each with a relation (nested, union or skin).
2. **Modes live on cards.** `card.mode = { loop, interaction, opponent, space, needs, win, lose, bot }`. **DONE** on 14 loop primitives, with a bot per mode that wins its own test (`tests/v2-p-modes-bots.test.js`).
3. **Deterministic presets build the structure.** Space, world, systems, participants, win wiring and input come from presets, and an avatar exists only for avatar interaction. **NOT DONE.** `outline.js proceduralOutline` is still the adventure skeleton (hero, side-by-side zones, reach-zone beats), and it is still what the model is handed.
4. **The model fills content only,** in small strict forms, in parallel, and repair fixes fields, not documents. **PARTIAL.** The strict form (`outline-form.js`) and content contracts (`content.js`) are merged; the speed work is on the unmerged branch.
5. **Each mode's bot proves its game.** Bots exist, but the publish gate does not use them.
6. **Static composition check.** `compose-check.js` is merged, and strict TypeScript over kernel, planner and server passes (`npm run typecheck`). **Adapters are only specified**: `card.adapts` and the "needs adapter" verdict exist, but no adapter has been written and nothing builds one. For a mashup engine, mismatches must be resolved by adapters (or by choosing fitting primitives), never by swapping the idea's world.

## Known defects, in order

1. **The adventure skeleton is still the base of every outline.** Replace it with presets (step 3).
2. **Unplayable games are published.** The gate (`verify-adapter.js viability` plus `core-loop.js`) blocks only crashes, missing core primitives and an unwired win. A game the playtest agent cannot move in (the farming game explored 2 states) still ships. The user wants broken games blocked; they only rejected "must finish within 20 seconds".
3. **Degraded fallbacks ship.** When the model's drafts fail, `writeOutline` isolates primitives or falls back to the skeleton, and the result publishes.
4. **gpt-4.1-mini fails on the big form** (bad references, effect ids, spawn effects, quests). The user chose speed: keep mini, but make the forms small and repair at field level (step 4). gpt-6-luna succeeded on chess, but took 264 s.
5. **The last commit `66952732` is WIP and unverified.** It re-picks a different world when the composition check fails, which is anti-mashup. Rework it into adapter resolution, or revert it.
6. **Movement selection.** Grid movement was chosen for a voxel farm. Movement must follow the idea and the world (cards declare `locomotion` and `medium`).

## Unmerged work

- `v2-generation-quality`: 6 commits past HEAD, unreviewed and untested here.
  - preset-first generation;
  - small parallel forms;
  - content packs;
  - field-level repair;
  - escalation;
  - strict section shapes;
  - the mode primitive treated as core;
  - no story slot without narrative.

  Review it against the defects above before merging.
- `v2-game-gate`: a strict "is it a game" gate (world substance, core-loop coverage). It was held because the user wanted crash-only at the time; reconsider it for defect 2.

## Merged this session (main pieces)

- **Crash fixes:**
  - the OOM in `falling.pieces place`;
  - the action-value fuzz conformance test;
  - jobs run in supervised child processes, and failure records are kept.
- **Graphics and studio:**
  - default renderers per space;
  - host polish: input defaults, focus, pause and time scale;
  - games unload completely (`view.onDispose`);
  - the studio redesign;
  - quality report slice 1 (non-blocking).
- **World generation:**
  - declared generator targets and content;
  - every space kind gets a world;
  - extents fit their space;
  - `scaleWorld`.
- **Engine validation:** all 26 engine primitives pass.
- **Content and form:**
  - content contracts and the strict outline form;
  - the form asks for every selected primitive.
- **Modes and checks:**
  - card modes and bots;
  - the composition checker;
  - strict TypeScript.
- **Revisions:** guards report and never refuse (`reviewChange`), and edits never leave holes in lists.

## User rules

- Build general primitives and declarations, never per-game patches, never genre engines. Mashups are the point.
- Verify with the project's playtest agent and with real runs of the user's ideas before saying something works.
- Don't invent policies the user didn't ask for.
- No benchmarks or side work while the app is broken.
- Keep messages short and keep the server up.
