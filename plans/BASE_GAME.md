# Base game implementation plan

> 2026-10-16 scope update: Pokémon FireRed is the sole initial game, compiled from editable source. Mario is deferred and does not block slice 1. Finish FireRed play, controls, save/return/resume and recovery before expanding. [Current setup, evidence and remaining gates](../DEVELOPMENT.md).
Date: 2026-10-15 · Owner: Vishal · Status: agreed three-slice plan; slice 1 implementation is in progress; acceptance remains open.

Scope and acceptance: [overall PRD](../PRD.md), [environment PRD](ENVIRONMENT_PRD.md) and [three vertical slices](ENVIRONMENT_SLICES.md). Parent: [#1](https://github.com/vishaltandale00/gameverse.ai/issues/1). Shared integration starts from [PARALLEL_DEVELOPMENT.md](../contracts/PARALLEL_DEVELOPMENT.md).

## Slice 1 Build the character creator and FireRed selector

Start with a name/preset-avatar profile and a FireRed menu entry. FireRed keeps its own trainer creation. Integrate the full GBA game in the browser and expose the smallest useful load/input/pause/checkpoint/restore/dispose interface. Pin source/build/cartridge/emulator identities and keep progress outside disposable runtimes.

First prove real browser play, controller input and snapshot export/store/restart/import. On explicit return, confirm the snapshot durably before disposal. Resume the captured moment, including mid-battle, using the matching game/core. Keep ordinary in-game saves as a separate fallback; preserve confirmed records on failures. Abrupt termination can recover only the last confirmed checkpoint.

Deliver creation → selector → FireRed play → return → close/reopen → exact resume, on both controller families and keyboard. Qualify focus/reconnect, storage/write exclusion, failed load/save and responsive runtime recovery. Retain browser/campaign/save evidence and actual timing baselines. No open world or running loop is required. FireRed is the only game in the current scope. [Issue #3](https://github.com/vishaltandale00/gameverse.ai/issues/3) contains the acceptance checklist. Pause for Vishal's hands-on review before expansion.

## Slice 2 Build the open world and game entrances

Select and qualify a small reused open-world base. Bring the existing Gameverse character into it and add movement, discovery, FireRed entry and valid return placement through the same host interface. Preserve existing FireRed snapshots/in-game saves and profile identity through the transition and restart. The base decides its presentation and session policy, subject to real adapter capabilities.

Prove world → FireRed → world → restart → revisit/resume, including failed-entry recovery and both controllers/keyboard. Measure world overhead separately and compare equivalent FireRed operations with slice 1. [Issue #4](https://github.com/vishaltandale00/gameverse.ai/issues/4) contains the acceptance checklist; no additional initial installed game is required.

## Slice 3 Connect the environment to improvement loops

Agree v0 configs/capabilities/run/submission/result/timing examples with Shishir. Integrate scoped feedback and his transcript/builder workflow, isolated pinned simulation sessions, durable candidate receipts and accepted discovery. The host controls copied-save validation, safe activation, progress integrity and interruption recovery for both base and subgame targets.

Exact execution snapshots remain tied to their matching original game/core. Changed FireRed versions need verified in-game-save compatibility/migration, not assumed snapshot portability. Demonstrate real loop exchange, two durable cycles including a mechanic/quest, base targeting, forks, stale/cancelled rejection and recovery. [Issue #5](https://github.com/vishaltandale00/gameverse.ai/issues/5) tracks integration; [#2](https://github.com/vishaltandale00/gameverse.ai/issues/2) retains Shishir's harness implementation. Overall PRD scenarios remain staged qualification.

## Checks and timing

Follow [AGENTS.md](../AGENTS.md). Explain coverage/cost before adding checks/dependencies and reuse existing timestamps. Establish real build/runtime/snapshot baselines in slice 1; compare affected turnaround using comparable inputs, environments and cache conditions. Keep broad campaigns, browser/version matrices and expensive loop runs separately triggered with configured limits. Plans and recorded requirements are not measured acceptance evidence.
