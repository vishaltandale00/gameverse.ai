# Extending v2: adding blocks

How anyone adds a block (people, future agents, and the gap layer's prompts): a primitive, an adapter, a bot or a
template. Each kind has one place to go, one set of checks it must pass, and one way to be promoted. `ARCHITECTURE.md`
is the specification and wins over this file on any conflict; `KERNEL_API.md` is the primitive contract.

The rules for every block (ARCHITECTURE.md §1, §7): the card is the only source of truth; no fallbacks, no defaults
standing in for decisions, no word lists over the idea, no per-game cases; nothing loosens a check or weakens a test.

## Primitive

**Where:** `v2/primitives/<family>/<id-with-dashes>.js`, registered in its workstream's `<area>.index.js`
(KERNEL_API.md §7). A promoted primitive lives in `v2/primitives/promoted/` and is registered in
`v2/primitives/promoted/index.js` (default-exports an array).

**Declare on the card** (ARCHITECTURE.md §3), as data: `intent`, `params` (types, ranges, closed sets, refs, required),
`components` / `data` / `content` shapes, `rules` (every code `validate` can emit), `requires` / `provides` /
`conflicts`, and as they apply `engage`, `loop` and `mode` (with `mode.bot` naming a registered bot), `drives`,
`spaces` / `provides.content` / `provides.extent`, `needs.content`, `locomotion` / `medium`, `interactions`, `adapts`.
A rule enforced in code but not declared is a defect; a missing declaration fails the checks, it is never assumed.
Controls: a verb whose action takes a value declares it in `card.actionSpace` (enum, axis, or `choice` with `of`, its provider `from: 'options'` or `selects`, and the events it `emits`); a refusal event goes in `card.denials`; a loop
whose verbs depend on the instance declares `card.loop.verbsOf(config, doc)`; a space declares `card.frame`; a renderer
or camera declares `card.projection` per view and a renderer `card.draws`; a loop with a win or lose declares `card.loop.shows`; a card
owning a component declares what an entity carrying it reads as on screen in `card.presents` (never inferred from names); a UI primitive declares `card.interactions` and `card.controls`.

**Checks it must pass:**
- its own test meeting KERNEL_API.md §8: preflight a document using it; exercise it through `rt.step`, effects and
  events; deterministic replay; preflight rejects a bad config with its declared codes; its instances in
  `v2/games/*.json` preflight with zero param errors;
- the kernel tests (`tests/v2-kernel.test.js`, `tests/v2-kernel-conformance.test.js`); a space also passes
  `spaceConformance` (KERNEL_API.md §3);
- the catalogue conformance in `v2/improve/conformance.js`, run with it in the live catalogue (`liveCatalogue()` in
  `v2/planner/catalog.js`): navigation (walker searches, cells, fright), loop owners, the mode-shape test (a
  `card.mode` is well formed, names a registered bot and has a minimal document in `tests/v2-p-modes-bots.test.js`),
  and the template contract over every template.

**Promotion (target `primitive`):** the gap layer (`v2/experiments/primitive*.js`) writes a card plus a sandboxed module
for a mechanic no primitive covers; it joins a game only after its gate (`checkPrimitiveExperiment`: card checks,
registry admission, preflight, bad-config rejection, 600 frames, replay, snapshot/restore, no plot regression, an
observable effect). `POST /api/v2/games/:id/promote {experimentId}` starts a job: a coding agent ports it to a native
primitive in a worktree, only adding files under `v2/primitives/promoted/` and `tests/` (modifying only the promoted
index). The job, not the agent, verifies: `primitive-tests` (its §8 test), `kernel`, `gate`
(`check-primitive.mjs`: native, no clocks/`Math.random`/timers/network/kits, the original game preflights, plays,
replays and restores with it) and `conformance` (`check-primitive.mjs --conformance`). Success is a branch;
`POST /api/v2/improve/:job/apply` fast-forwards it, then the server restarts.

## Adapter

An adapter is a primitive (`engine.adapt.*`, registered in `v2/primitives/engine/adapt.index.js`) whose card declares
`adapts`: the capabilities, content or services it projects, and from what (projection, nested encounter, skin). The
composition check proposes it only from those declarations. It passes everything a primitive passes, plus the adapter
tests (`tests/v2-p-adapt-*.test.js`, `tests/v2-p-keep-adapters.test.js`: adapters survive every stage to the published
document). The gap layer writes a missing adapter through the same experiment → promotion path as a primitive.

## Bot

**Where:** `v2/verify/strategies/<id>.js`, registered in `v2/verify/strategies/index.js` (a mode bot with
`modeOnly: true`); a loop's card names it in `card.mode.bot`, and the gate plays exactly the bots a document's modes
name.

**It plays only through the controls a person uses** (ARCHITECTURE.md §6.3): `ctx.make` gives controlled worlds
(`v2/verify/controls.js`): every `rt.step(intent)` is turned into the key, axis and UI presses a person makes through
the host document's bindings and sampled exactly as `v2/web/player.js` samples devices; a verb no control issues throws
`controls_missing`, and an option's `apply` macro is never run. It plays every seed it is given (one run per seed). `rt.options` are hints; it reads the world
through space and service APIs and never writes state. It is deterministic for a document and seed.

**Checks:** `tests/v2-p-modes-bots.test.js` (the mode's minimal document: `select` picks it, it wins, it replays) and,
for every template whose loop names it, the template contract's bots stage. There is no promotion path for bots: a bot
is added by hand with its mode's minimal document.

## Template

A template is `{ id, concept, doc, tune }` (ARCHITECTURE.md §5): `id` a lowercase slug (not `none`); `concept` one line
the template pick matches; `doc` a complete `gameverse.v2.game/0.2` document whose `id` is the template id; `tune` the
only params the model may set, as `'<primitive id>.<param>'`. Nothing derivable from the cards is repeated in it.

**Where:** a module `v2/templates/<id>.js` (default export), or a promoted file `v2/templates/promoted/<id>.json`
(`{ schema: 'gameverse.v2.template/0.1', template, provenance }`). `v2/templates/registry.js` discovers both: no list
to edit. Discovery admits a template through the contract's format stage only; a malformed or duplicate one throws.

**Checks:** `checkTemplate(template, { registry, logic })` in `v2/templates/contract.js`, the only place template checks
live (a new check is added there, with its code), run over every discovered template by
`tests/v2-template-contract.test.js` against the live catalogue:

| Stage | Passes when | Codes |
|---|---|---|
| format | id, concept, doc and tune are well formed | `template_shape` `template_id_invalid` `template_id_reserved` `template_concept_invalid` `template_doc_invalid` `template_doc_id_mismatch` `template_tune_invalid` |
| tune | each path names a scalar param a card declares, on exactly one instance | `tune_unknown` `tune_not_scalar` `tune_ambiguous` |
| preflight | the document preflights | `preflight_failed` (cause: the preflight code) |
| composition | the static composition check, judging the host document (`v2/web/host-doc.js`), has no failure: among them every loop verb has a control a person has in its interactions (the controls reading, `v2/verify/controls.js`) and every space's world content is there (`v2/planner/space-content.js`, the reading the gate's world check makes) | `composition_failed` |
| loop | the loop check has no problem | `loop_problem` (cause: the loop code) |
| presentation | the host document's renderers draw everything its loops need a person to see: each loop with a win or lose declares `card.loop.shows` (entities, cells, zones, labels, marks: `v2/primitives/graphics/presentation.js`), and the renderer of each space its play happens in declares them in `card.draws` | `render_missing` `shows_undeclared` |
| gate | `verifyDocument` (on the host document: `v2/web/host-doc.js`) with the playtest budget finds it viable | `gate_not_viable` |
| controls | every loop verb of the host document has a control (a key, an axis, or a mounted UI primitive's `card.controls`); each direction pressed through `v2/verify/controls.js` moves the player the way the mounted renderer's `card.projection` shows the view (`v2/verify/directions.js`); every option the game offers in the gate's play is one a person can take | `controls_missing` `option_uncontrolled` `projection_undeclared` `direction_mismatch` `direction_inert` |
| features | every loop primitive exists, is controllable and works when its controls are pressed from reached states (`v2/verify/features.js`; the table is in the evidence); every participant a loop declares (sides, teams, racers, fighters) is an entity of the world at the start of play (`v2/planner/content.js` `absentParticipants`) | `feature_missing` `feature_content_empty` `feature_participant_absent` `feature_uncontrolled` `feature_inert` (`feature_unreached` is a warning) |
| bots | every bot its loops name is the one the gate plays, wins with status `won` on world seeds 1-3 and replays | `bot_unnamed` `bot_selection_mismatch` `bot_failed` `bot_not_won` `replay_mismatch` |

A failing static stage stops the check before anything simulates.

**Promotion (target `template`):** what the step path builds well becomes a template.
`POST /api/v2/games/:id/promote-template {version?, templateId?}` derives the template from the published version
(`v2/improve/template.js`: concept from `plot.premise`; tune from params the cards declare as number, integer, boolean
or a closed set of strings that the document sets on a primitive it instantiates once; a version carrying experiments
must have them promoted first), runs the whole contract in its own process against the live catalogue
(`v2/improve/check-template.mjs`), and on success writes `v2/templates/promoted/<id>.json` with its provenance (job,
game and version, source document hash, source commit, catalogue hash, contract and loop versions, the evidence). On
failure the job reports every problem with its code. Restart the server to load a promoted template.
