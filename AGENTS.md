# Development instructions

## Keep CI, builds and improvement runs lean

- Treat development turnaround time as a project requirement. Track CI, build and improvement-loop duration as implementation is added; do not claim these measurements exist before the corresponding systems run.
- Before adding a CI job, build step, dependency, test matrix or improvement stage, explain the necessary coverage and its expected cost. Prefer existing tools, shared setup and narrowly scoped checks over duplicate work.
- For changes affecting turnaround time, report a representative before/after measurement using comparable inputs and environments. If measurement is unavailable, state the gap instead of inventing numbers.
- Keep routine CI focused on useful checks for the affected work. Full campaigns, broad game/version matrices, long simulations and expensive LLM evaluations belong in separately triggered qualification workflows with explicit scope and resource limits.
- Run checks appropriate to the change. Repeat or broaden them when failures, new changes or unresolved concerns justify doing so; do not repeatedly run an unchanged broad suite after it has passed.
- Reuse existing runner/tool timestamps and reports before adding instrumentation infrastructure. Timing collection must itself remain low overhead.

## Record timing with enough context to compare runs

- CI: queue time, execution wall time, per-job duration and outcome. Distinguish elapsed critical-path time from aggregate runner work.
- Builds: clean/incremental mode, cache hit/miss state, duration and outcome. Keep build time separate from queue, dependency setup and verification time.
- Improvement runs: total and queue time; build, simulation and evaluation durations; attempt/repair counts; outcome. Retain failed and cancelled runs as well as successes.
- Associate measurements with a run/request ID, source commit, relevant game/base versions, environment-harness/adapter version, loop version/config reference and machine/toolchain context where applicable.
- Identify overlapping/nested stages so they are not double-counted. Mark unsupported or unavailable measurements explicitly rather than recording zero.
- Establish representative baselines before choosing numeric budgets. Preserve configurable resource limits; the absence of a build-latency SLA does not authorize unlimited work.

## Preserve the workstream split

- Vishal owns the base game and subgame navigation/play infrastructure. Shishir owns the game creation/improvement loop targeting base games and subgames.
- Shared contracts cover the adapter capabilities, versioned inputs/submissions and observable run results. Game-specific discovery and play-session policies belong to the game configuration/implementation; loop algorithms and their resource policies belong to the loop configuration.
- Keep performance reporting compatible across the two workstreams without prescribing Shishir's internal algorithm or adding a mandatory central orchestration system.
- Start parallel integration from `contracts/PARALLEL_DEVELOPMENT.md`; consult the other `contracts/`, `TASKS.md` and `plans/BASE_GAME.md` for planning context. Follow later explicit user decisions when older drafts disagree. Do not turn unresolved design questions into implemented requirements.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `vishaltandale00/gameverse.ai`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

## v2 game engine

Work under `v2/` follows `v2/ARCHITECTURE.md` as the specification and the rules in `CLAUDE.md`: fix defect classes at their root across the whole catalogue, never individual games; cards are the single source of truth for forms, repair and validation; no fallbacks, defaults standing in for decisions, templates or workarounds; verification is the static and conformance checks plus the playtest bot playing through real controls.
