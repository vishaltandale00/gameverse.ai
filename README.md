# Gameverse

A single-player browser environment for playing games and developing them through conversation, using a controller.

**Status:** this development branch combines Vishal's source-built FireRed player with a 33-game research catalog, an interactive game-space map, a mashup request workspace, partial ontologies and isolated bot/generation tools. FireRed is the currently integrated playable game; research catalog entries are not additional registered cartridges. Campaign qualification and host integration of generated candidates remain open.

Run `npm ci --ignore-scripts`, `npm run source:setup -- firered`, `npm run game:build -- firered`, then `npm run dev`. Open [local Gameverse](http://127.0.0.1:4173). See [development setup and evidence](DEVELOPMENT.md) for toolchain prerequisites, controls, timings and remaining issue #3 gates.

## Run an initial generation and playtest attempt

```sh
# Python 3.10+; no model key, emulator or extra Python packages required.
python3 -m tools.game_attempt --output-root local/game-attempts
```

This generates a small source-linked reference game, then plays it through the
same bounded tester used for external adapters. It retains the request, selected
ontology components, candidate, transitions, barriers, failures and timings.
The default is a hand-authored mechanic template; opt-in LLM generation is
supported. It does not automatically compile a ROM ontology into a new GBA game.

- [Game generation attempt](tools/game_attempt/README.md): natural-language intent, component selections and constraints.
- [Play tester](tools/playtester/README.md): game profiles, targets/actions, cheap decisions and LLM escalation; based on sidbot's transferable design.
- [Headless GBA sessions](tools/re/session/README.md): real ROM stepping, observation and private checkpoints without browser automation.
- [Decision providers](tools/decisions/README.md): local d1 by default, explicit native OpenAI Decisions support.
- [Ontology and extraction](ontology/README.md), [current research handoff](ontology/RESEARCH_HANDOFF.md): incomplete evidence-backed corpus and next mining work.

## Start here

| Document | Purpose |
| --- | --- |
| [Game Space and Workshop](FRONTEND_WORKSHOP.md) | Catalog, embeddings, mashup requests, interface verification and performance |
| [Development](DEVELOPMENT.md) | Runnable slice 1, editable-source setup, evidence and qualification gaps |
| [PRD](PRD.md) | Product scope, acceptance requirements and open decisions |
| [Parallel development contract](contracts/PARALLEL_DEVELOPMENT.md) | Configs, independent harness versions, simulations, candidate submissions and timing handoff |
| [Base game contract](contracts/BASE_GAME.md) | Persistent playable home, profiles, subgame hosting and recovery |
| [Subgame contract](contracts/SUBGAME.md) | Versioned games, runtime interface, progress and qualification |
| [Improvement loop contract](contracts/IMPROVEMENT_LOOP.md) | Voice requests, builds, verification and safe updates/forks |
| [Delivery tasks](TASKS.md) | Separate work packages, dependencies and evidence gates |
| [Base game implementation plan](plans/BASE_GAME.md) | FireRed launcher, open-world navigation and improvement integration |
| [Environment PRD](plans/ENVIRONMENT_PRD.md) | Issue #1 scope, player journeys, acceptance, shared interface decisions and timing gates |
| [Environment vertical slices](plans/ENVIRONMENT_SLICES.md) | Three agreed slices with GitHub subissues, dependencies and acceptance criteria |
| [Vishal — issue #1](https://github.com/vishaltandale00/gameverse.ai/issues/1) | Versioned environment harness, swappable base and subgame adapters |
| [Shishir — issue #2](https://github.com/vishaltandale00/gameverse.ai/issues/2) | Versioned build/improvement loop for base games and subgames |
| [Development instructions](AGENTS.md) | Lean CI/builds and comparable timing reports |
| [Engineering handoff](HANDOFF.md) | Existing evidence, technical starting points and prerequisites |
| [Domain language](CONTEXT.md) | Shared meaning of base game, subgame, version, fork and checkpoint |
| [Publication record](PUBLICATION.md) | Published contents, visibility, license and verification receipts |

## Delivery split

1. **[Slice 1 — character creator and FireRed selector](https://github.com/vishaltandale00/gameverse.ai/issues/3):** Vishal delivers a persistent name/preset avatar, FireRed menu, complete browser GBA game, controls/recovery and exact-session resume after confirmed return and restart, with normal saves retained as fallback. FireRed keeps its own trainer creation.
2. **[Slice 2 — open-world base](https://github.com/vishaltandale00/gameverse.ai/issues/4):** Vishal adds a reused explorable world, character navigation, game entrances and return while keeping the same FireRed integration/progress.
3. **[Slice 3 — improvement loop integration](https://github.com/vishaltandale00/gameverse.ai/issues/5):** connect the environment to Shishir's independently versioned harness for base/subgame feedback, builds, verification, isolated simulation and safe updates/forks. Vishal owns hosting/activation; Shishir retains loop implementation in [#2](https://github.com/vishaltandale00/gameverse.ai/issues/2).

The shared handoff pins game/config/artifact references and both harness versions, exposes adapter/session capabilities, and exchanges candidate submissions/results and timing reports. Base-specific discovery/session policy and Shishir's internal algorithm remain separately configurable. See [the parallel contract](contracts/PARALLEL_DEVELOPMENT.md) and [TASKS.md](TASKS.md); exact schemas still need joint review.

FireRed is the sole initial game and uses an editable source build. Mario is deferred. The three slices replace the earlier eight-slice/fixture-first plan. Pause for hands-on review of slice 1 before expanding. Exact snapshots apply to matching game/core versions; slice 3 changes require separately verified save compatibility. Full product qualification still requires real mechanic development, not parameter edits alone. The pinned mGBA worker adapter is in development; slice 2 world selection remains open.

## Research and examples

[MVP_CONTRACT.md](MVP_CONTRACT.md) records the detailed earlier design. [POKEMON_SOURCE_RESEARCH.md](POKEMON_SOURCE_RESEARCH.md) and [research/pokemon](research/pokemon) contain pinned observations, logs, scenario designs and a source-level forest patch. Game cartridges, third-party checkouts, extracted assets and local build outputs stay in ignored directories and are not included in version control.

`POC_DESIGN.md`, `BROWSER_DESIGN.md`, `BASE_GAME_CANDIDATES.md`, `ENGINE_COMPARISON.md` and `RESEARCH.md` are historical investigations. `design/processor.example.json` and `design/request_examples.json` are historical examples, not current runtime configuration. `design/game_proposal.example.json` illustrates proposal data; it is not an executable schema or test result.

## License

Original Gameverse material is available under the [MIT license](LICENSE). Third-party research excerpts retain their original rights; see [third-party notices](THIRD_PARTY_NOTICES.md). Publishing this planning repository does not distribute FireRed or grant rights to package third-party games, runtimes or assets.
