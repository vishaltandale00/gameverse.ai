# v2 handoff

Read `CLAUDE.md` and `v2/ARCHITECTURE.md` first. This file states where the code stands against the
architecture and what is required next. It lists requirements, not acceptable compromises.

## State

**Generation is not reliable.** Ideas often fail with errors caused by our own mismatches (a form allowing a
value a validator rejects), and games that publish are not always playable by a person. The suites are green,
but they don't yet check the properties in ARCHITECTURE §6.2, so green proves little.

- Branch: `v2-presets` (pushed to `origin/v2-presets`), worktree `.claude/worktrees/great-boyd-e5b8ed`. It is
  stacked on `claude/subagent-architecture-handoff-c2cd3b`, which is stacked on `claude/v2-kernel` (PR #31).
- Run: `npm ci --ignore-scripts`, then `V2_GAPS=auto PORT=4181 node scripts/serve.mjs`, then open
  `http://localhost:4181/v2`. Port 4181 is the user's; keep it running on the latest merged work. The user chose
  `V2_GAPS=auto` (the gap layer writes missing primitives during builds).
- Unmerged: `sports-ai` (2 commits: AI kicks the ball through the target service; compose-check reads a `via`
  mode's params). Side work; merge only after the required work below.

## Built so far (on `v2-presets`)

- **Decomposition, step by step:** concepts (every game concept declares its loop), mechanics per concept, play
  spec with sentence win/lose and mashup relations across concepts, the rest. Failing fields are re-asked alone.
- **Iterative selection** (`planner/build.js`, `bundles.js`, `retrieval.js`, `build-steps.js`): space first,
  one mechanic at a time, options proven by the composition check and preflight, bundles with companions and
  adapters, coverage by declarations, explicit win/lose/driver/coverage/mashup-adapter steps, loop check after
  every step.
- **Adapters:** `engine.adapt.projection`, `engine.adapt.nested` (with declared encounter outcomes) and
  `engine.adapt.skin`; mashup adapters survive every later stage, checked before publish.
- **Declarations:** `card.loop` (interactions as a set, verbs, progress, win/lose `reads`, outcome),
  `card.drives`, `gameplay.ai.seek`, `reserved` param values.
- **Loop check** (`planner/loop-check.js`) and a gate (`planner/verify-adapter.js`) that requires a win or
  progress on the quantity the win reads.
- **No preset decisions:** the preset wires only what selection chose.

## Required next, in order

0. **Templates, the fast path (ARCHITECTURE §1.2, §1.6, §5).** Today every idea goes through step-by-step
   selection: many sequential model calls and re-plans, minutes per game, and failures on the app's own
   suggestions ("Mario Kart with shopping carts" failed after 3 attempts on an empty storyboard). Build the
   declared template library and the template path: concepts → one template pick per concept → composition
   through adapters → content forms → gate. Every template is verified in the suite (builds, preflights, its
   bot wins through its controls). The app's suggested ideas (`v2/web/studio-app.js` IDEAS) must build through
   templates in seconds, and the suite checks that their template composition is valid.

1. **Card-derived schemas (ARCHITECTURE §1.4, §3, §6.1).** One schema per card section, derived from the
   declarations, used by the model's forms, field repair, preflight and the composition check. Move every rule
   the validators enforce (closed value sets, ranges, required fields, references, cross-field rules) into card
   declarations, from the same constants. Add the conformance test: for every card and every form the pipeline
   can emit, any form-valid answer passes validation. Known instances of this class so far:
   `interact.kind`, `content.items[].creature.kind`, `health.respawn`, damage types in `resist`,
   `status.duration`. There are more; the test finds them.
2. **Controls and bots (§1.5, §6.3).** Every interaction gives a person controls derived from the loop and input
   declarations (pieces-turns: select a piece, see legal targets, confirm, end turn). Bots and the playtest act
   only through those controls (a headless input driver feeding the input primitive and host mapping). A loop
   whose player actions have no control fails the check. Today bots call runtime options directly, and a person
   could not move pieces in a published chess × Pokémon game.
3. **Remove the adventure remnants (§1.2, §4):** the post-publish detail pass that adds characters and pickups
   to every zone, the default `hero` archetype, plot sections in non-narrative games, avatars in non-avatar
   games, adventure zone naming. Add a check that fails if any section exists that no declaration asked for.
4. **World decided by the idea (§5):** the generator and the space size are build steps over valid options;
   no card default size or "build the least" choice stands in for them.
5. **Incremental retries (§1.6, §5):** a retry redoes only the step that was wrong and what depends on it.
6. **Build-step conformance (§6.2):** every option a build step offers survives the preset, preflight and the
   loop check, across all interactions, loop cards and space kinds.

Each item is done only when its conformance check passes across the whole catalogue, it is merged, and the
server is restarted on it.
