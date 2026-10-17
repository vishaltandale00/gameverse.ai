# Gameverse

A single-player browser environment for playing games and developing them through conversation, using a controller.

**Status:** the local v1 Gameverse overworld has three explorable city blocks, Alder Arcade for FireRed, Juniper Pitch for 5v5 soccer, and Foundry Field for 7v7 American football. The sports games are original full-rules matches with fictional rated teams, specialties and a rated CPU (or CPU vs CPU to watch); see [sports controls, scope and evidence](SPORTS_DEVELOPMENT.md). The original FireRed collection remains available as v0. Both world versions share existing profiles and compatible FireRed checkpoints; FireRed uses a matching editable-source build. Xbox USB connection and world movement were confirmed by the user; physical-controller qualification of the new sports games and full FireRed campaign/mid-battle qualification remain open. The improvement harness is not integrated.

Run `npm ci --ignore-scripts`, `npm run source:setup -- firered`, `npm run game:build -- firered`, then `npm run dev`. Open [local Gameverse](http://127.0.0.1:4173). See [development setup and evidence](DEVELOPMENT.md) for toolchain prerequisites, controls, timings and remaining issue #3 gates.

For sports-only play, `npm ci --ignore-scripts` and `npm run dev` are sufficient; FireRed setup is not required.

- `/` or `/v1`: Gameverse, the 3D overworld. Approach a venue and press E or controller A to enter FireRed, soccer or football.
- `/v0`: the original FireRed collection webpage.

FireRed fills the browser view while preserving its 3:2 aspect ratio. Controller Y opens the Gameverse menu; Start remains FireRed's own menu. Use D-pad/left stick and A to select **Save & return**, or B to resume. See [world controls and browser verification](CITY_DEVELOPMENT.md). Game cartridges and saves remain local and are not included in this repository.

## Start here

| Document | Purpose |
| --- | --- |
| [Development](DEVELOPMENT.md) | Runnable slice 1, editable-source setup, evidence and qualification gaps |
| [Gameverse world development](CITY_DEVELOPMENT.md) | v0/v1 configs, walking prototype, FireRed entrance, controller controls and verification |
| [Sports development](SPORTS_DEVELOPMENT.md) | Soccer/football controls, league ratings and rules, CPU-vs-CPU qualification, save/resume evidence and physics verification boundaries |
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

FireRed was the sole initial game and uses an editable source build. The user subsequently authorized the walking prototype and the current soccer/American football expansion; Mario remains deferred. The three slices replace the earlier eight-slice/fixture-first plan. These additions do not close the remaining slice 1 or slice 2 qualification gates. Exact snapshots apply to matching game/core versions; slice 3 changes require separately verified save compatibility. Full product qualification still requires real mechanic development, not parameter edits alone. The pinned mGBA worker adapter remains in development; the current world uses Three.js with original procedural geometry and textures. The new synchronous custom adapter is limited to trusted built-in sports modules; arbitrary generated-game isolation is not qualified.

## Research and examples

[MVP_CONTRACT.md](MVP_CONTRACT.md) records the detailed earlier design. [POKEMON_SOURCE_RESEARCH.md](POKEMON_SOURCE_RESEARCH.md) and [research/pokemon](research/pokemon) contain pinned observations, logs, scenario designs and a source-level forest patch. Game cartridges, third-party checkouts, extracted assets and local build outputs stay in ignored directories and are not included in version control.

`POC_DESIGN.md`, `BROWSER_DESIGN.md`, `BASE_GAME_CANDIDATES.md`, `ENGINE_COMPARISON.md` and `RESEARCH.md` are historical investigations. `design/processor.example.json` and `design/request_examples.json` are historical examples, not current runtime configuration. `design/game_proposal.example.json` illustrates proposal data; it is not an executable schema or test result.

## License

Original Gameverse material is available under the [MIT license](LICENSE). Third-party research excerpts retain their original rights; see [third-party notices](THIRD_PARTY_NOTICES.md). Publishing this planning repository does not distribute FireRed or grant rights to package third-party games, runtimes or assets.
