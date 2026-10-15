# Gameverse

A single-player browser environment for playing games and developing them through conversation, using a controller.

**Status:** product contracts and research. There is no runnable Gameverse app, integrated FireRed runtime or improvement worker yet. There is no app installation or development command to run from this repository today.

## Start here

| Document | Purpose |
| --- | --- |
| [PRD](PRD.md) | Product scope, acceptance requirements and open decisions |
| [Base game contract](contracts/BASE_GAME.md) | Persistent playable home, profiles, subgame hosting and recovery |
| [Subgame contract](contracts/SUBGAME.md) | Versioned games, runtime interface, progress and qualification |
| [Improvement loop contract](contracts/IMPROVEMENT_LOOP.md) | Voice requests, builds, verification and safe updates/forks |
| [Delivery tasks](TASKS.md) | Separate work packages, dependencies and evidence gates |
| [Engineering handoff](HANDOFF.md) | Existing evidence, technical starting points and prerequisites |
| [Domain language](CONTEXT.md) | Shared meaning of base game, subgame, version, fork and checkpoint |
| [Publication preparation](PUBLICATION.md) | Repository contents, remaining publication decisions and checks |

## Delivery split

1. **Base game and subgame hosting:** create/select a character, play in the home, enter independently installed games, save, return and resume. This journey works without an AI worker.
2. **Complete FireRed subgame:** reproduce the pinned baseline, integrate a browser runtime and qualify controls, progress and campaign coverage through the shared host interface.
3. **Game creation and improvement loop:** speak/correct requests, continue playing during builds, verify real behavior, apply compatible updates and create separate forks/mashups.

The task split changes delivery dependencies, not the full product promise. Fixtures do not replace FireRed; parameter edits alone do not satisfy the mechanic-development requirement. Browser/engine selection and home layout remain open implementation/design decisions.

## Research and examples

[MVP_CONTRACT.md](MVP_CONTRACT.md) records the detailed earlier design. [POKEMON_SOURCE_RESEARCH.md](POKEMON_SOURCE_RESEARCH.md) and [research/pokemon](research/pokemon) contain pinned observations, logs, scenario designs and a source-level forest patch. No game ROMs, third-party source checkouts or accepted game packages are included.

`POC_DESIGN.md`, `BROWSER_DESIGN.md`, `BASE_GAME_CANDIDATES.md`, `ENGINE_COMPARISON.md` and `RESEARCH.md` are historical investigations. `design/processor.example.json` and `design/request_examples.json` are historical examples, not current runtime configuration. `design/game_proposal.example.json` illustrates proposal data; it is not an executable schema or test result.

Publication of this planning repository is separate from distributing game artifacts. A repository license has not been selected. Third-party runtime, code and asset permissions must be evaluated separately before packaging them.
