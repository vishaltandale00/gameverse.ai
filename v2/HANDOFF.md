# v2 handoff

Read in this order: `CLAUDE.md`, `v2/ARCHITECTURE.md` (the specification), this file, `v2/KERNEL_API.md`.
This file states where the code stands and the required work, in order. It lists requirements, not acceptable
compromises.

## Environment

- Branch `v2-presets`, pushed to `origin/v2-presets`, worktree `.claude/worktrees/great-boyd-e5b8ed`. It is
  stacked on `claude/subagent-architecture-handoff-c2cd3b`, which is stacked on `claude/v2-kernel` (PR #31). No PR
  is open for `v2-presets`.
- Run: `npm ci --ignore-scripts`, then `V2_GAPS=auto PORT=4181 node scripts/serve.mjs`, then open
  `http://localhost:4181/v2`. Port 4181 is the user's server: keep it running on the latest merged work and
  restart it after each merge. The user chose `V2_GAPS=auto` (the gap layer writes missing primitives).
- The user's games live in `.claude/worktrees/affectionate-hamilton-eb23af/local-data/v2/`; this worktree's
  `local-data/v2/games` and `improve` are symlinks to them.
- The app's suggested ideas are in `v2/web/studio-app.js` (`IDEAS`): "Pac-Man in a haunted library", "A cozy
  farming game on a floating island", "Mario Kart with shopping carts", "Zelda-style dungeon inside a giant clock".
- Unmerged side branch: `sports-ai` (2 commits: AI kicks the ball via the target service; compose-check reads a
  `via` mode's params). Don't merge before the work below.

## State

**Generation does not meet the specification.** Ideas take minutes and often fail on our own mismatches. The
app's own suggestion "Mario Kart with shopping carts" failed after 3 attempts: `select.js:442` adds
`plot.storyboard` whenever the model's free `narrative` flag is true, its `validate` demands acts, and no race form
writes them. Games that publish are not always playable by a person: bots call `rt.options` directly, and no UI
primitive gives a person controls for pieces-turns or menu loops (a person could not move pieces in chess ×
Pokémon).

Where the time goes (from the code): decomposition 6+ calls; the step-by-step build (`build.js`, `bundles.js`,
`retrieval.js`, `build-steps.js`) 10–20 sequential calls; one params form per primitive plus content forms,
times repair rounds, times up to 3 re-plans (`replan.js`); then `detail.js` adds 8 tasks after publish. About 30–60
sequential calls per idea. The kits were fast because their structure was literal and the model wrote one content
form.

Why it went wrong: the approved design was declared, composable templates with the model filling content. It was
replaced by a pipeline that asks the model at every step, and each new failure was patched by adding another
model step or by fixing one card or one game. Don't repeat that: templates and code decide structure, failures are
fixed as classes (CLAUDE.md).

## Plan (from a Fable design review; now in ARCHITECTURE §1–§7)

Templates are the fast path. One model call picks templates and relations, code composes them, parallel content
forms fill them, the gate plays through real controls. The step path runs only for concepts no template covers.

Keep as the composer's library: `compose-check.js`, `loop-check.js`, `loop.js`, `content.js`, `engage.js`,
`adapters.js`, `repair.js` (field level), `verify-adapter.js`, and in `presets.js`: `wireLoop`, `applyPacks`,
`configureSkins`, `wireOutcomes`, `configureEncounters`, `placeParticipants`, `repairLoop`.

Delete:
- `detail.js` and the detail stage in `kernel-pipeline.js`;
- `presets.js` `playerArch 'hero'` and `PLACES`/`words` naming from the prompt;
- `decompose.js` `movementFrom` (regex over the idea);
- `select.js` `tokens`/`relevance`/`rankCandidates`/`LEXICAL_ACCEPT`/`KIND_HINTS`, `build.js` ~370, and
  `retrieval.js` `words`/`rel` (text-overlap ranking);
- `select.js:442` narrative → storyboard;
- `outline.js` `ensureAgency`;
- `replan.js` (the template path fails loudly with the diagnosis; the step path retries one step);
- `tests/v2-p-preset-chess-pokemon.test.js` (an instance test; replaced by the template suite).

Demote behind `template: 'none'` (the step path): `build.js`, `bundles.js`, `build-steps.js`, `retrieval.js`
(declaration-only options), decomposition's mechanics and play-spec steps, `outline.js` per-primitive params forms
(templates carry params; the model sets only `tune`).

## Required work, in order

Each increment is done only when its checks pass, it is merged into `v2-presets`, pushed, and the server on 4181
is restarted on it. Measure with the pipeline's stage timings (`kernel-pipeline.js` `timings`:
`decomposeMs`, `outlineModelMs`, `gateMs`, `requestToFirstPlayableMs`) plus a call count and round count.

1. **Templates v0 and the template path for the app's 4 suggested ideas.**
   - `v2/templates/{maze-chase,farm,dungeon,race}.js` in the format of ARCHITECTURE §5; seed them from the minimal
     documents in `tests/v2-p-modes-bots.test.js` and the kits' samples.
   - `v2/planner/templates.js`: the one-call template pick (strict form: title, premise, concepts with kind,
     template enum or 'none', relation) with its code checks; `composeTemplates` (theme, nested, union);
     content forms from the composed document's contracts, in parallel.
   - Wire it in `kernel-pipeline.js create` before `selectPrimitives`; concepts with 'none' go to the step path.
   - Done: `tests/v2-templates.test.js` green (every template preflights, composes, loop-checks, its bot wins,
     replays deterministically); each of the 4 ideas' fixtures composes offline in under 1 s; live, each of the 4
     publishes with at most 6 model calls and `requestToFirstPlayableMs` under 15 s, over 3 seeds.
2. **Remove the adventure remnants** (the detail stage, `hero`, prompt-word place names, narrative → storyboard,
   plot sections and avatars no declaration asks for). Done: a test asserting no section exists without a
   declaring reader, over the template suite and `v2/games/*.json`.
3. **Controls.** UI primitives declaring `card.interactions` and their controls (`graphics.ui.pieces`:
   select unit → legal targets → confirm → end turn, issued via `view.act`; `graphics.ui.menu`); `verify/controls.js`
   headless input driver feeding `rt.step` exactly as `v2/web/player.js` does; bots act only through it.
   Done: `tests/v2-p-modes-bots.test.js` green with the driver only; a catalogue conformance test fails any loop
   card × interaction whose `card.loop.verbs` no control can issue (`controls_missing`).
4. **Nested templates:** `board` (grid, board generator, turns, health) and `creature-battle` (space none,
   creature party and battle), nested on `attack_hit` with species skinned onto pieces. Done: the suite composes
   every declared nested pair and both bots win; chess × Pokémon publishes live in at most 6 calls.
5. **Card-derived schemas** (ARCHITECTURE §1.4): `kernel/sections.js` base section shapes; `card.data` for every
   card that reads a section; `card.rules` for every code a `validate` emits; forms derived from
   params ∪ components ∪ data with every `_json` field removed and the constants in `outline-form.js`
   (`ITEM_KINDS`, `ARCH_KINDS`) deleted. Done: a sampler conformance test over the whole catalogue (any
   form-valid answer passes preflight and validate, except declared `card.rules` codes, and every declared rule
   code is reachable).
6. **Demote the step path** and strip lexical ranking. Done: no `tokens(`/`relevance(` in `v2/planner`; the step
   path runs only for 'none' concepts, time-boxed, and its use is reported.
7. **Harvest the remaining kits** (maze, creature, runner, shmup, fighting, puzzle, physics) into templates, one
   per increment, with the same done criteria as 1.

Known instances of the schema class (item 5), for orientation only; the conformance test finds the rest:
`interact.kind`, `content.items[].creature.kind`, `health.respawn`, damage types in `resist`,
`status.duration`, `engine.generate.dungeon.rooms` `rooms` ≥ keys + 2 (`dungeon_keys_many`, undeclared: so the dungeon
template does not tune `rooms` until the card declares the rule), `engine.generate.grid.maze` `style` (a free string
its validate limits to the declared styles).

## User directives

- Templates + extension (decided 2026-10-21): a template is the base loop; the idea's extra mechanics are added onto it
  step by step (checked); mashups compose templates through adapters (nested, union). The step path runs for the part of
  an idea no template covers, not the whole idea.
- The building blocks (primitives, adapters, templates) must span as many combinations as possible: every loop a card
  declares has a template (tests/v2-template-coverage.test.js, PENDING only shrinks); kits are harvested; missing loops
  become primitives + templates. The gap layer writing code is the last resort but vital for what blocks cannot express:
  an optimization, not an avoidance rule.
- Extensible: agents build blocks later and the pipeline uses them: one admission contract per block kind, discovery
  (no hand lists), promotion of what works (v2/EXTENDING.md).

- Fix the pipeline, never an individual game; generated games are test cases. Fix defect classes across the
  catalogue with conformance tests.
- Templates and code decide structure; the model makes few small choices and writes content.
- No fallbacks, defaults standing in for decisions, guessing from words, workarounds, or weakened tests.
- Don't hand-play games; the playtest bot (through real controls) is the verifier. Don't run the user's ideas as
  the way to find defects; live runs only confirm an increment.
- No side work (features, AI behaviour, art, benchmarks) while the basic pipeline is broken.
- Subagents are allowed and expected (Haiku, Sonnet, Opus; Fable for design consults). Rules in `CLAUDE.md`.
- Ask questions only when a decision is genuinely the user's.
- Short messages, evidence for every claim, no apologies, keep the server up, clean up worktrees and branches,
  merge back.
