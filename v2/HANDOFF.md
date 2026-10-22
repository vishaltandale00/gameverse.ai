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

## State (2026-10-22; v2-presets: gate-speed and cleanup-int merged)

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
- **Gate speed (measured, not live):** `gateVersion` on every template's document, seeds 1–3, idle machine (load
  ~2.5, 18 cores), back to back with 6ed609d4: total 137.7 s → 70.2 s, slowest 13.4 s → 5.4 s (maze-chase 9.6–13.4 →
  4.0–5.4 s, falling-blocks 8.1–9.2 → 3.6–4.2 s, launcher 2.0–2.4 → 1.0–1.1 s, every other template ≤ 3.7 s). Gate
  reports (problems, feature table, explorer, solver) byte-identical before and after. What did it: the explorer
  stops once the gate's reading is shown (b8a1932b; it plays for a win when a reader needs one: a8c5abc9);
  `rt.derived` (kernel: data built once per read) with `engine.space.grid` indexing entity obstacles per read and the
  danger-field bot planning inside `rt.read`; feature checks play each idle comparison once; snapshots copied whole
  (slice, spread) then members replaced (a member-by-member copy made every later physics step slower). The last
  live numbers (maze-chase 132 s, falling-blocks 103 s) were at load ~170 and predate this; 4181 has not been
  restarted on it (superseded by the live run below). Remaining gate cost is spread over per-step entity scans in game systems (collectible,
  obstaclesIn, hazard) and the plot solver (tactics ~2 s); the falling-blocks bot never wins and always plays its
  10000-step budget.
- Known failing on v2-presets: none in the focused set (596/596 on cleanup-int at merge). Launcher `feature_inert`
  did not reproduce in these runs.

## Branches at handoff (not merged into v2-presets)

Each is a worktree under `.claude/worktrees/<branch>`. Verify with its focused tests, merge into v2-presets, push,
restart 4181, then remove the worktree and branch. Read each branch's last commit messages: WIP commits say what is
incomplete.

| Order | Branch | Work | State at handoff |
|---|---|---|---|
| done | `gate-speed`, `cleanup` + `placement` (`cleanup-int`) | merged into v2-presets; worktrees and branches removed | |
| done | `sides-controls` | declared side membership for wins that read opponents; every offered option issuable through a bound control (`option_uncontrolled` an error); travel options only where a card declares travel; `input_axis_key` | merged (b989eb16); 822/822 focused tests |
| done | `polish` | no ids shown to a person; 3D models and UI icons from declarations; declared `scenery`; farming stage blocks only above on spaces with an up axis | merged (6fc48693); 1061/1061 focused tests (its open `feature_inert` and platformer ∪ race failures pass on the merged code); template gate reports identical. Still open from it: the 3D world-object layer classifies generator objects by words (generators do not declare what they place) |
| 5 | `tune-rules` | templates declare playable tune ranges proven at bounds; `card.rules` for validate codes; vocabulary codes declared with `logic.*(kind, { codes: [{ code, fields, example }] })`; `effect_invalid` a kernel code; rule examples `{ doc }` (each named top-level section replaces the card's minimal document's); `kernel/sections.js`; sampler conformance; no warnings phase (`DECLARATIONS_ENFORCED` on, not an off switch); themed text forms for every card-declared display field | 99 commits (the largest branch); check its last commit message for what is incomplete. Merge last: it touches forms, cards and every template's `tune:` (keep `polish`'s scenery entries). |

**Work the stopped agents left uncommitted is now committed** (as found, unverified, on its own branch):
- `E-refdefaults` (a sub-branch of `tune-rules`), 5d150c08: a finished fix: no reference
  defaults left on generator/space cards (each block/archetype id required where it matters, scaffolds name their
  ids), templates dungeon/maze-chase and blockport/emberfall migrated, new tests/v2-ref-defaults.test.js. Not yet run:
  pipeline-generators and v2-templates tests. engine.generate.city still picks road blocks by name. Merge into
  `tune-rules`.
- `tune-rules`, 9c33ab93 (WIP): declaration checks always errors (`DECLARATIONS_ENFORCED` removed); the sampler
  reads errors only. No other `E-*` worktrees remain.
- Clean up afterwards: `scratchpad/base-wt` temp worktree (E-refdefaults), untracked `node_modules` symlinks.

## Required work, in order

1. **Gate speed**: done for the gate on its own (above: slowest 5.4 s idle, verdicts identical). Live
   `requestToFirstPlayableMs` (under 15 s for template ideas, ARCHITECTURE §1.6) not yet measured: item 3.
2. **Merge the branches**: `tune-rules` remains (merge `E-refdefaults` into it first).
3. **Live confirmation, done 2026-10-22** (4181 on 0847ed4d, every template's `IDEAS` idea, seeds 1–3, one job at a
   time, load 2.0–3.2): 53/57 published. requestToFirstPlayableMs max 10.9 s, median 3.4 s; 3 calls / 2 rounds except
   platformer seed 1 (6/4) and creature-battle seed 2 (5/3); pick 1.2–3.1 s, content 0.9–3.3 s. Gate: maze-chase
   3.8–5.3 s (first playable 7.4–9.2 s), platformer 2.6–3.9 s, board 2.7–3.3 s, tactics 1.9–2.8 s, dungeon 1.0–2.7 s,
   falling-blocks 2.2–2.4 s, every other template ≤ 1.3 s. The 4 failures are two open classes, not gate speed:
   - **The pick reads a theme as a mechanic the extension cannot build** (the build fails naming it, as designed):
     tactics 1 "swim" / "manage oxygen supply" (sunken city), launcher 1 "slide on ice" (penguins), falling-blocks 3
     "arrange books"; the gap layer failed each (`plot_regressed`, `bad_ops`, `card_invalid`).
   - **An extension pick that cannot work in the world reaches the gate**: fighting 1 added `gameplay.combat.target`
     for "use kitchen utensils as weapons"; with one opponent `cycle` does nothing, and the gate fails
     `feature_inert`. The extension step does not run the feature check on what it adds, so the bad pick fails the
     build instead of being dropped and re-asked.
   Script: run each idea through `POST /api/v2/games {prompt, seed}` and read `latest.report.timings`.
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
