# Gameverse v2 architecture: a game-creation engine

This document is the specification. Code that disagrees with it is wrong, not the document. Read §1 and §7 before
changing anything.

## 0. What this is

A player types any idea and gets **the game they asked for**, real and playable:
- any genre: platformer, kart racer, chess, creature RPG, farming sim, 3D dungeon crawler, tactics, cards, mystery…
- any **mashup** between them: chess × Pokémon, Mario Kart with shopping carts, Pac-Man in a haunted library.

The bar is a real game, not a tech demo:
- **reliable**: every idea either produces a playable game or fails with exactly what is missing; our own
  mismatches (a form allowing what a validator rejects, a stage dropping what an earlier stage chose) never
  reach the user;
- **high quality** to play, through real controls;
- **reproducible**: the same idea, seed and versions give the same game;
- **fast** to generate.

A cohesive engine, not a pile of patches. One architecture spans everything:
- Mechanics exist once, as composable primitives with declared contracts.
- Generation composes them for the idea.
- Types derived from the declarations prove the composition and every model answer before anything runs.
- Playtest agents, playing through the same controls a person uses, prove the game plays before anyone sees it.

## 1. Non-negotiables

1. **The game is the idea.**
   - Never substitute another game: no generic fallback, no "closest genre", no default shape, no dropping or
     isolating a mechanic to make checks pass.
   - When a stage fails, the pipeline works out how to make the game: it diagnoses the exact problem, then
     re-plans the primitive collection, repairs the failing fields, or has the gap layer write the missing
     primitive or adapter, and checks again, within configured limits. When the limits run out the build fails
     and reports every attempt and exactly what is still missing. It never publishes a substitute.
2. **General, never special-cased.**
   - A game is a **collection of primitives**. There is no closed list of modes or genres that ideas are fitted
     into, no genre engine, and no per-game patch.
   - **Templates are the fast path, and they are welcome**: declared, pre-verified compositions of primitives
     (a race, a board game with sides, a maze chase, a creature battle, a farm…) chosen by the idea and composed
     for mashups. What is forbidden is ONE default shape stamped onto every idea: the adventure template (default
     hero, named zones, plot, a detail pass adding characters and pickups) applied to chess was the failure mode.
   - No word lists, regexes or text-overlap scores over the idea deciding structure. Structure comes from card
     declarations; judgement comes from the model, as small checked choices.
3. **Mashups are first-class.**
   - Concepts that don't natively fit are combined through **adapters** (projection, nested encounter, skin) that
     project one concept into another.
   - Incompatibility means "pick or write an adapter", never "swap the world" or "drop the mechanic".
   - Every game concept in an idea brings its own loop; how the idea uses it (nested, union, skin) is decided
     with both loops known.
   - **Theme is not skin.** A theme or setting ("in a haunted library", "with shopping carts") has no content
     section of its own: it needs no adapter and only themes the content forms. A skin maps one game concept's
     content section onto another's contract (Pokémon species as chess pieces).
4. **Typed and validated end to end. Cards are the type system and the only source of truth.**
   - Every primitive declares, as data, everything about it: params, components, content sections, references,
     closed value sets, ranges, required fields, cross-field rules, what it requires and provides, its loop,
     its interactions, its spaces, its extent.
   - **One schema per card section, derived from the declarations, is used for everything**: the model's strict
     forms, field-level repair, preflight validation and the composition check. A form can never allow a value a
     validator rejects, because both come from the same schema. A rule enforced in code but not declared on the
     card is a defect.
   - The kernel owns and declares the base shapes of the document sections (`kernel/sections.js`: archetypes,
     items, zones…); each card declares the parts it reads (`card.data`) in the same dialect as its params.
     There is no other source: no constants in forms, no free-JSON fields in any model form.
   - A primitive's `validate` may only emit problem codes its card declares in `card.rules`.
   - Compositions are checked statically, from declarations alone, before any model call or simulation.
   - Code is strictly type-checked. Everything from outside (model output, stored versions, requests) is untyped
     until validated against the card-derived schemas.
   - A missing declaration is a type hole: it is reported and fails the check. It is never treated as compatible
     and never filled with a default.
5. **Nothing broken publishes.**
   - A version publishes only when the playtest agent, playing **through the real controls**, shows the game runs
     and is viable: the player can act, the core loop happens, and progress toward the win is possible.
   - It doesn't have to be finished in N seconds, and intros and cutscenes are fine.
   - A crash, a world you can't move in, pieces you can't move, a missing opponent or an empty board blocks
     publishing, with the reason.
6. **Fast. A mashup of known concepts generates in seconds, faster than prompting a large model directly.**
   - Templates give the structure instantly; adapters compose templates for mashups; the model writes only
     judgement: which templates and relations fit the idea (a few small choices), theme, names, content, tuning.
   - Step-by-step selection is only for the part of an idea no template covers.
   - Model calls are small, parallel where independent, and repaired field by field.
   - A retry redoes only what changed: answers for unchanged primitives and fields are kept.
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

See `KERNEL_API.md` for the contract.

## 3. Primitives and their declarations

A primitive has an `id`, a `card` (its declarations), and runtime hooks (`install`, `generate`, `render`).
Validation of its config and data is derived from the card. A primitive's own `validate` exists only for rules
that cannot be expressed as data, and every such rule is still declared on the card (its fields, its message,
the values it allows) so the forms and repair can show it.

Its card declares, as data:

| Declaration | Meaning |
|---|---|
| `params` | typed parameters with ranges, closed value sets, references and defaults (defaults are tuning values for params the idea doesn't need to decide, never stand-ins for structure) |
| `components`, `data`, `content` | the shapes of the components and document sections it reads and writes (over the kernel's base section shapes), with the same types, closed sets and references; the minimum content it needs to be meaningful |
| `rules` | every problem code its `validate` can emit, with the fields and allowed values, for rules that cannot be plain data (cross-field rules) |
| `requires` / `provides` / `conflicts` | capabilities, services, primitives, events, vars, actions |
| `engage` | how the player and AI participants take part (seated in a vehicle, on a side, holding a deck) |
| `loop` (and `mode`) | for primitives that can carry play: the interactions it serves (a set), player verbs, progress events, `win`/`lose` with what they `read` and what changes it, participants, encounter `outcome`, target services, the bot that plays it |
| `drives` | for AI primitives: which AI-controlled participants it acts for and what they do |
| `spaces`, `provides.content`, `provides.extent` | for generators: which spaces they build, what world content they produce, what area they fill |
| `needs.content` | for spaces: the world content they must have to be playable |
| `locomotion`, `medium` | for movement: base or modifier, ground/air/water/track |
| `interactions` | for input primitives: the interaction models they serve and the controls they give a person |
| `adapts` | for adapters: the capabilities, content or services they project, and from what |

These declarations are the single source for:
- the static composition check;
- the card-derived schemas (forms, repair, preflight);
- the controls a person gets;
- the playtest agent's choice of bot.

## 4. The game document

One JSON document (`gameverse.v2.game/0.2`) references primitives by id and parameterizes them:
- spaces, with generators and zones;
- systems;
- graphics;
- content: archetypes, items, species, cards…;
- plot: characters, story, quests, dialogue, endings — only when the idea has narrative or a chosen primitive declares it needs that section;
- player — only when the interaction has an avatar.

The document's shape follows the templates and primitives chosen for the idea, never one default shape. A board
game has a board, pieces, sides and turns, and no walking avatar.

Games are **versioned**. Each change produces a new immutable version that is checked like a new game: every
version (create, a revision's tweak or ops, an experiment, a gap filled) passes one version gate
(`v2/planner/version-gate.js`) on the document a person plays, and a version made from another is also held to it: no
feature that worked stops working, and every bot its loops name that won the base still wins. A template game's
revision stays within the ranges its template tunes. A running session that receives a new version restarts on it from
its start (the state of another version is never carried into it).

## 5. Generation

Structure comes from templates and code; the model makes a few small choices and writes content. Every step's
output is checked before the next starts.

**A template** (`v2/templates/<id>.js`) is a verified document, not a plan:
`{ id, concept, doc, tune }`. `concept` is the one line the model matches against; `doc` is a complete game
document (spaces with generators, systems, input bindings, player when it has an avatar, content samples,
endings); `tune` lists the only params the model may set. Everything else is derived from the cards already in
`doc` and is never repeated in the template: interaction, opponent and bot from `card.mode`/`card.loop`, win and
lose wiring, participants, content forms from the content contracts, nesting triggers from `card.loop.involves`,
encounter outcomes from `card.loop.outcome`, skin maps. Each template is verified once in the suite
(`tests/v2-templates.test.js`): preflight, the composition check, the loop check, its bot wins through the real
controls, deterministic replay; and so is every declared nested pair. The kits (`v2/kits/*`) are harvested into
templates: their samples become template content and their bots already live in `v2/verify/strategies`.

```
idea
 → template pick (1 model call, strict form whose shape makes structural mistakes inexpressible): title,
     premise, ONE primary (kind game | genre, template: enum of template ids or 'none'), other games
     (kind game | genre, template, relation nested | union) and themes (kind theme | setting | character, no
     template), readings (a concept the idea can also mean another way: its other kind or relation; code turns each
     into one question to the player and builds the reading chosen, never a guess) and mechanics (what the player can
     do that the chosen templates' verbs do not give: a phrase, its declared verb, core | extra). A named game and its
     genre are one concept. The templates are offered grouped by the loops
     their cards declare. Code checks what needs the registry: nested only onto a primary whose loop
     declares an entry event (card.loop.involves). A game or genre with 'none' goes to the step path. The
     chosen templates' declarations ARE the play spec; nothing is asked twice.
 → composition (code, instant): the primary template's document; theme: no adapter, the theme goes to the
     content forms; nested: the inner template appended (prefixed ids) with engine.adapt.nested wired from
     declarations, plus engine.adapt.skin when the inner concept's content maps onto an outer contract; union:
     both on one space only if the composition check passes, else the build fails with the adapter needed.
 → extension (the step path's checked machinery, v2/planner/extend.js): each mechanic no composed primitive gives
     the player is added onto the composed document, one small choice among options proven valid by declarations
     with the checks after every pick, or written by the gap layer; otherwise the build fails naming it
 → content (model, parallel strict forms, one per content contract section, derived from card schemas):
     themed cast, pieces, species, places, tuning of the `tune` params; story only when a chosen primitive
     declares it
 → repair (field-level, parallel): only the failing fields go back, with the allowed values; a form the default
     model fails twice goes to a stronger model for that form only
 → playtest gate (§6) → publish a version
```

Target for an idea whose concepts all have templates: at most 6 model calls in 2 sequential rounds (pick, then
content), structure in milliseconds, first playable in seconds. Measured per build with the pipeline's stage
timings plus call and round counts.

**The step path** is only for a game or genre concept no template covers. It runs time-boxed and its use is
reported: iterative selection (`build.js`), the space first, then one mechanic at a time, offering only options
code has proven valid by declarations (never by text overlap), with the composition and loop checks after every
pick; "none fits" goes to the gap layer, which writes the missing primitive or adapter (model-written code, gated
by its tests and the playtest; `V2_GAPS=auto`). What the step path builds well becomes a new template.

What writes what:
- **The model writes only:** its choices among checked options (templates, relations), themed content, tuning
  of declared `tune` params, revision ops, and gap-layer code.
- **Code writes:** structure, wiring, worlds, participants, endings, input, every id and binding.
- **A retry** redoes only the failing form's fields or the failing step, keeping everything else.
- **No post-publish passes** add content the declarations didn't ask for.

## 6. Verification

1. **Static, before generation spends anything:** the composition check over card declarations; every model
   answer validated against the card-derived schemas; preflight of the document against the same schemas; the
   loop check (participants, a player action that can change what the win reads, win and lose wired, AI
   opponents driven).
2. **Catalogue conformance, in the test suite:** for every card and every form the pipeline can emit, any
   answer the form allows passes validation; every rule a validator enforces is declared; every option a build
   step offers survives the later stages; every interaction's controls can perform its loops' player actions.
   These are properties over the whole catalogue, so a defect class is found once, everywhere.
3. **Playtest agents, before publishing:** each loop's bot plays the game headless **through its real controls**
   (a headless input driver feeding the input primitive and the host's input mapping exactly as `v2/web/player.js`
   does, the same path a person uses). `rt.options` are only hints for the bot; every option's actions must be
   issuable through the controls, and a loop whose player verbs no control can issue fails (`controls_missing`).
   Controls per interaction come from declarations: input primitives and UI primitives (`graphics.ui.*`) declare
   the `interactions` they serve and the controls they give (pieces: select a unit, see legal targets, confirm,
   end turn; menu: choose an option). The gate requires:
   - no crash, NaN state, runaway entities or event storms;
   - the player can act from the start of play;
   - the core loop actually happens (its declared events fire from play);
   - progress toward a winning ending: a win, or play moving the quantity the core loop's win reads toward it
     beyond what idling does;
   - deterministic replay.
4. **Quality signals, after publishing (non-blocking):** responsiveness, mechanics used, pacing, dead time,
   variety, fairness.

Verification is done by these checks and the playtest agents. It is not done by people or agents hand-playing
games, and running a few ideas through the live pipeline is a confirmation, never the way defects are found.

## 7. Delivery rules for anyone building this

What is required:
- **Fix the class, never the instance.** A failure in one game is a defect in a stage, a schema or a
  declaration. Find every site of that class across the catalogue and pipeline, fix them at the root, and add a
  catalogue-wide conformance check that fails if the class returns. Never fix one card, one game or one idea.
- **Implement this document.** Before building anything, check it against §1 and §5. If the code disagrees with
  this document, change the code.
- **Integration is part of the task.** A component isn't done until it is called from the live path, proven
  there by the checks above, merged, and the server restarted on it.
- **Done means proven.** Report what the checks and the playtest agent show, with the evidence. Never say
  something works, is ready or is fixed without that evidence. State failures plainly.
- **The basic pipeline comes first.** No features, AI behaviour, art, benchmarks or side projects while ideas
  don't reliably become playable games.
- **Small, checked increments**, each integrated and verified before the next. No long unsupervised agents
  holding the user's asks; no parallel work on overlapping files.
- **Don't invent policies, caps, gates or defaults** the user didn't ask for. Ask once if unsure.

Not acceptable, ever:
- fallbacks or defaults standing in for a decision the idea or the declarations must make; one default
  template stamped onto every idea;
- dropping, isolating or swapping a primitive, a mechanic or the world to get past a check;
- guessing from words in the idea; ranking by text overlap to cut options;
- a validator rule not declared on the card; a form not derived from the card's schema; a free-JSON field in a
  model form;
- many sequential model calls where a template or code decides; asking the model the same thing twice;
- bots or checks that bypass the controls a person uses;
- a later stage silently undoing what an earlier stage chose;
- loosening a check, weakening a test or deleting a test to make something pass;
- workarounds in one layer for a defect in another: fix the layer that is wrong, including the kernel.

## 8. Code layout

| Path | Contents |
|---|---|
| `v2/kernel/` | ECS, events, scheduler, predicates, effects, capabilities, registry, preflight; no space code |
| `v2/primitives/{engine,plot,graphics,gameplay}/` | One file per primitive, with its card |
| `v2/planner/` | Generation: decomposition, play spec, iterative selection and build steps, composition check, presets, content forms, repair, replan, pipeline |
| `v2/verify/` | Plot solver, spatial checks, playtest, loop bots, invariants, quality |
| `v2/server/` | Studio API, isolated jobs |
| `v2/web/` | Studio and player |

`v2/engine`, `v2/modules` and `v2/kits` are the earlier generations: reference material to port depth from,
never called from the live path.
