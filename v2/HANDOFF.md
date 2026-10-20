# v2 handoff, 2026-10-20 (night)

Read this first, then `v2/KERNEL_API.md` (the frozen contract), `v2/ARCHITECTURE.md` and `v2/PRIMITIVE_CATALOG.md`.

**First goal for the next session:** the user must be able to type an idea into the studio and play the result. Get that one path working end to end before any other work. Restart the server whenever the user asks, and don't run anything else at the same time.

## State

- **Branch:** `claude/handoff-task-distribution-0a6108`. It is pushed to `claude/v2-kernel` and is PR [#31](https://github.com/vishaltandale00/gameverse.ai/pull/31), which supersedes #28–#30 (those are closed).
- **Kernel:** `v2/kernel/` follows `KERNEL_API.md`.
  - Primitives declare their own reference kinds and services.
  - The kernel owns the spatial vocabulary: zone, near, cell, teleport, move_to.
  - Modal input, deferred work, `rt.canRun`/`canTest`/`has`, ambient providers, and one owner per vocabulary kind.
  - Preflight never throws, and validator paths are anchored to the document root.
  - Tests use `kernel/testing.js`: a reference test space plus `spaceConformance`.
- **Primitives:** 180, all registered with no vocabulary collisions. They come from these workstreams:
  - spaces2d, generate2d, runtime, story, move, items, combat, ai, modes, puzzle;
  - graphics: flat, ui and audio, three;
  - verification: `v2/verify`.
- **Tests:** `node --test tests/v2-kernel*.test.js tests/v2-p-*.test.js` takes about 15 s with the navigation cache. The last full run passed 860 of 862.
  - The Hollow Lantern "talk to bosses" check fails because boss characters won't talk.
  - The 3D isometric camera test has had a fix applied but hasn't been rerun.
- **Studio:** `/v2` runs the kernel pipeline in `v2/planner/kernel-pipeline.js`: decompose, select, outline, first playable, detail, revise. Games made with the old kits are refused as legacy, so create new games.
- **Run:** `npm ci --ignore-scripts` (needs `@anthropic-ai/sdk`), then `PORT=4181 node scripts/serve.mjs` and open `http://localhost:4181/v2`. The OpenAI key is loaded automatically from the main checkout's `.env.local`.

## Blocking bugs, in order

1. **Creating a game crashes the server (V8 heap out of memory).**
   - It happens synchronously, right after the model's first outline draft returns, inside `writeOutline` in `v2/planner/outline.js`. The heap is flat at about 23 MB, then reaches 3 GB within seconds while the event loop is blocked.
   - Suspects:
     - `repairDocument` running on the model draft (`v2/planner/repair.js`), for example unbounded list or stub synthesis;
     - `staticPlot` or `verifyDocument` not honouring their budgets.
   - The quickest diagnosis is to log each call after `parseReply` in `writeOutline`.
   - Also run jobs in a `Worker` with `resourceLimits` and a timeout (`v2/server/jobs.js`), so one runaway job never takes the server down.
2. **Model mapping quality.** It sometimes omits a central primitive; for example, the Tetris platformer got `move.grid` instead of `move.platformer`. Tighten the mapping prompt in `select.js` `mapWithCatalogue`, or add a pass that checks the core loop.
3. **Boss characters won't talk** in the Hollow Lantern story test, which checks every character can be talked to.

## Fixed this session, not yet verified end to end

- **Whole-catalogue selection** (`v2/planner/select.js` `mapWithCatalogue`): the model sees every card and maps each mechanic to primitive ids. It replaces word overlap, which wrongly declared that "collect rings" and "falling Tetris pieces" had no primitive. Checked with the real model on the Sonic runner, the Tetris platformer and Pokémon × Street Fighter: correct primitives, no false gaps.

## Unmerged

- **3D spaces and generators:** branch `worktree-agent-af591cfc70052b953` (voxel, mesh3d, terrain/biomes/caves/ores/roads/city/structures/scatter/water). The agent was stopped just before a final hot-load test. Merge it and run `tests/v2-p-worlds3d-*`.
- **Pipeline agent:** its later uncommitted work in `worktree-agent-aa3916f77e7e1aa56` (4 files). Everything committed up to `baedc263` is merged.

## Still to do after the studio works

- Retire `v2/kits` and `v2/engine`, rebuilding the kit games as documents (`v2/research/KIT_DECOMPOSITION.md` maps every kit mechanic to its primitive).
- Regenerate `PRIMITIVE_CATALOG.md` from the cards.
- `player.js` should mount `withDefaultGraphics` and offer the `view.pause`, `restart` and `load` API the UI requested (`v2/kernel/requests/ui.md`).
- Open kernel requests are in `v2/kernel/requests/*.md`.

## User feedback to honor

- Build general primitives, never one-off patches or per-genre engines.
- Get something working and testable first, and allocate time so the user can test.
- When they ask for a server restart, do only that. Keep the server up.
- Don't chase side investigations while they're waiting.
- Ports: only use 4181 for this branch; other agents' servers were on 4187/4188.
