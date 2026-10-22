# v2 handoff

Read in this order: `CLAUDE.md`, `v2/ARCHITECTURE.md` (the specification), this file, `v2/KERNEL_API.md`,
`v2/EXTENDING.md` (block contracts). This file states where the code stands and the required work, in order.

## Environment

- Branch `v2-presets`, pushed to `origin/v2-presets`, worktree `.claude/worktrees/great-boyd-e5b8ed`. No PR is open.
- Run: `npm ci --ignore-scripts`, then `V2_GAPS=auto PORT=4181 node scripts/serve.mjs`, open `http://localhost:4181/v2`.
  Port 4181 is the user's server: keep it on the latest merged work, restart after each merge.
- The user's games: `.claude/worktrees/affectionate-hamilton-eb23af/local-data/v2/` (symlinked from this worktree).
- Writers on 4181: spec `gpt-4.1-mini`, escalation `gpt-6-luna`.
- **Test runs: the user does not want full-suite runs** (`node --test tests/v2-*.test.js` takes 15+ min under load).
  Run the focused files for what changed. Kit/sandbox/experiment/improve tests are load-sensitive.
- Subagents write in their own worktree via the EnterWorktree tool (a hook blocks cross-worktree writes otherwise).
  When parallel branches collide, merge them on an integration branch; never leave `v2-presets` red.

## State (2026-10-21, end of session; v2-presets b1dd7afc)

**The template path is the live path.** `v2/planner/templates.js` (one strict pick call → code composition
`v2/planner/compose.js` → one names/text content form per template + `frame_tune`, parallel) → `v2/planner/extend.js`
(extra mechanics the templates don't carry, added through the step path's checked steps, else the gap layer, else the
build fails naming them) → `v2/planner/version-gate.js` (one gate for every publish: preflight, tune ranges,
composition, loop, controls, the publish gate with feature checks, bot/feature regression vs the base version).
Ambiguous concepts ("Sonic …": a game or a character) stop with a question (`needs_answer`,
`POST /api/v2/games/:id/answers`).

- **20 templates** (`v2/templates/*.js`, discovered by `registry.js`, admitted by `contract.js` `checkTemplate` on
  world seeds 1–3): maze-chase, race (kart on a looped track), farm, dungeon, platformer, runner, tactics, board, rts,
  match-board, fighting, ball-sport, shmup, card-battle, launcher, slide-merge, falling-blocks, creature-battle, story.
  Every card-declared loop has a template (`tests/v2-template-coverage.test.js`, PENDING empty).
- **Mashups:** theme, nested (chess × Pokémon: board × creature-battle, species skinned onto pieces) and union
  (Sonic racing: platformer ∪ race, the secondary's loop onto the primary's world) compose from declarations; every
  template pair composes or fails naming why (`tests/v2-template-mashups.test.js`).
- **Verification is what a person gets:** one host document (`v2/web/host-doc.js`) for player, gate and contract;
  bots play only through `v2/verify/controls.js` (real key/axis mapping); feature checks per mixed-in primitive
  (`v2/verify/features.js`: exists, controllable, works); direction matches the view; presentation (renderers draw
  what loops show; HUD shows win/lose quantities); verdicts on step/frame budgets, never wall clock; human-rate replay
  reported (`v2/verify/human.js`, non-blocking). Browser and headless replay frame by frame; the host releases every
  listener, timer and Worker; a new version restarts from its own first state (ARCHITECTURE §4).
- **Live (load ~170, so inflated):** Pac-Man, Mario Kart, farm, Tetris publish in 3 calls / 2 rounds; pick and
  content ≈2 s each. **The gate is the bottleneck:** maze-chase 132 s, falling-blocks 103 s, race 11 s, farm 4 s
  (before step budgets the maze gate was ~4.5 s). First required item below.
- Known failing on v2-presets: launcher template gate `feature_inert` on `ability` under some runs; the step-path
  `chess × pokemon` keep-adapters test (fixed on `cleanup`).

## Branches at handoff (not merged into v2-presets)

Each is a worktree under `.claude/worktrees/<branch>`. Verify with its focused tests, merge into v2-presets, push,
restart 4181, then remove the worktree and branch. Read each branch's last commit messages: WIP commits say what is
incomplete.

| Order | Branch | Work | State at handoff |
|---|---|---|---|
| 1 | `gate-speed` | gate stages stop as soon as their requirement is proven (deterministic), cheaper lookahead | 2 commits (explorer early stop; options read once per state, direct JSON copies). Before/after gate timings not yet measured. Continue: required item 1. |
| 2 | `cleanup-int` | integration branch: `cleanup` merged (443a5a6a: detail stage and replan.js deleted, no word-list/relevance heuristics in v2/planner, revisions decide from declarations, step path furnishes each space's declared world, step-path time box); `placement` NOT yet merged | Merge `placement` into it (seats resolve on the generated world via spawner `rule.band`; `feature_participant_absent`; `compose_participants_absent` / `compose_player_misplaced`), run the pipeline/keep-adapters/revisions/template-path/extension/mashups/coverage/loop-structure tests, then merge into v2-presets. |
| 3 | `sides-controls` | declared side membership for wins that read opponents; every offered option issuable through a bound control (`option_uncontrolled` an error) | Uncommitted work in its worktree (0 commits at handoff time): commit it, check `git diff`, finish. |
| 4 | `polish` | no ids shown to a person (option `text` everywhere, declared names for sides, teams, stages, counters); 3D models and UI icons from declarations; `scenery` a declared closed-set param chosen through tune (cosmetic, proven by one frame per value); farming stage blocks only above on spaces with an up axis | 3 commits, last WIP. 368 focused tests pass. **Open:** tests/v2-templates.test.js gate fails `feature_inert` for falling-blocks (seeds 1–2) and launcher (1–3): cause unknown, may come from this branch. Also edited `templates.js` (union tune paths). |
| 5 | `tune-rules` | templates declare playable tune ranges proven at bounds; `card.rules` for validate codes; vocabulary codes declared with `logic.*(kind, { codes: [{ code, fields, example }] })`; `effect_invalid` a kernel code; rule examples `{ doc }` (each named top-level section replaces the card's minimal document's); `kernel/sections.js`; sampler conformance; no warnings phase (`DECLARATIONS_ENFORCED` on, not an off switch); themed text forms for every card-declared display field | 99 commits (the largest branch); check its last commit message for what is incomplete. Merge last: it touches forms, cards and every template's `tune:` (keep `polish`'s scenery entries). |

**Uncommitted work left in worktrees when the agents were stopped** (inspect with `git -C .claude/worktrees/<name>
status` / `diff`, finish, commit, then merge as above):
- `sides-controls`: 33 changed files, all of agent SC's work (no commits yet).
- `E-refdefaults` (a sub-branch of `tune-rules`, 55 commits ahead): 28 changed files, a finished fix: no reference
  defaults left on generator/space cards (each block/archetype id required where it matters, scaffolds name their
  ids), templates dungeon/maze-chase and blockport/emberfall migrated, new tests/v2-ref-defaults.test.js. Not yet run:
  pipeline-generators and v2-templates tests. engine.generate.city still picks road blocks by name. Merge into
  `tune-rules`.
- `tune-rules`: 11 changed files (agent E's in-flight work on top of its 99 commits); E's other sub-agent worktrees
  (`E-*` under .claude/worktrees) may hold more: list them with `git worktree list`.
- `cleanup-int`: 12 changed files: the merge of `placement` in progress (resolve, commit, or `git merge --abort`).
- Clean up afterwards: `scratchpad/base-wt` temp worktree (E-refdefaults), untracked `node_modules` symlinks.

## Required work, in order

1. **Gate speed** (`gate-speed`): every template's publish gate well under 10 s on an idle machine, verdicts
   identical under any load; `requestToFirstPlayableMs` under 15 s for template ideas (ARCHITECTURE §1.6). Measure
   before/after back to back at the same load (AGENTS.md).
2. **Merge the branches** in the table's order.
3. **Live confirmation:** every template's example idea (`IDEAS` in tests/v2-template-path.test.js) on 4181, seeds
   1–3, on a quiet machine: report calls, rounds, pickMs, contentMs, gateMs, requestToFirstPlayableMs.
4. Open classes: human-rate replay fails for ball-sport, falling-blocks, runner, slide-merge, match-board, story (bot
   artifacts or genuinely superhuman: decide per template); the 3D object layer still sorts generator objects by
   words (noted in code on `polish`); the playtest explorer's archive cost; whatever the branches above leave open.

## User directives

- Templates + extension (2026-10-21): a template is the base loop; the idea's extra mechanics are added onto it step
  by step (checked); mashups compose templates through adapters (nested, union). The step path runs for the part of
  an idea no template covers.
- The building blocks must span as many combinations as possible: every declared loop has a template; kits are
  harvested; missing loops become primitives + templates. The gap layer writing code is the last resort but vital:
  an optimization, not an avoidance rule.
- Extensible: agents build blocks later and the pipeline uses them (one admission contract per block kind,
  discovery, promotion: `v2/EXTENDING.md`).
- Ambiguous names (a game or a character): ask the person, never guess.
- "I don't want to keep finding rough edges": fix the named item and the related rough edges in the same layer, as
  classes with conformance tests.
- Bot speed for its own sake is parked; gate speed that breaks §1.6 is not.
- No full-suite runs; focused tests only.
- Fix the pipeline, never an individual game; fix defect classes across the catalogue with conformance tests.
- Templates and code decide structure; the model makes few small choices and writes content.
- No fallbacks, defaults standing in for decisions, guessing from words, workarounds, loosened checks or weakened
  tests.
- Don't hand-play games; the bots (through real controls) verify. Live runs only confirm.
- Subagents allowed and expected (Haiku/Sonnet/Opus; Fable for design consults). Rules in `CLAUDE.md`.
- Short messages, evidence for every claim, keep the server up, clean up worktrees and branches, merge back.
