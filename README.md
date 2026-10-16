# Gameverse

A single-player browser environment for playing games and developing them through conversation, using a controller.

**Status:** this research branch contains a partial game ontology, ROM evidence tools, shared decision providers, a headless play tester and a basic candidate-generation attempt. Vishal's browser ROM player lives on `main`; these bot tools use isolated test sessions. The complete game creation/improvement product is still in development.

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
| [PRD](PRD.md) | Product scope, acceptance requirements and open decisions |
| [Parallel development contract](contracts/PARALLEL_DEVELOPMENT.md) | Configs, independent harness versions, simulations, candidate submissions and timing handoff |
| [Base game contract](contracts/BASE_GAME.md) | Persistent playable home, profiles, subgame hosting and recovery |
| [Subgame contract](contracts/SUBGAME.md) | Versioned games, runtime interface, progress and qualification |
| [Improvement loop contract](contracts/IMPROVEMENT_LOOP.md) | Voice requests, builds, verification and safe updates/forks |
| [Delivery tasks](TASKS.md) | Separate work packages, dependencies and evidence gates |
| [Base game implementation plan](plans/BASE_GAME.md) | Staged work from the first complete play journey through two-game hosting and recovery |
| [Vishal — issue #1](https://github.com/vishaltandale00/gameverse.ai/issues/1) | Versioned environment harness, swappable base and subgame adapters |
| [Shishir — issue #2](https://github.com/vishaltandale00/gameverse.ai/issues/2) | Versioned build/improvement loop for base games and subgames |
| [Development instructions](AGENTS.md) | Lean CI/builds and comparable timing reports |
| [Engineering handoff](HANDOFF.md) | Existing evidence, technical starting points and prerequisites |
| [Domain language](CONTEXT.md) | Shared meaning of base game, subgame, version, fork and checkpoint |
| [Publication record](PUBLICATION.md) | Published contents, visibility, license and verification receipts |

## Delivery split

1. **Vishal — game environment harness:** start with one simple reused world, configured and replaceable through adapters; own base-game discovery, subgame play/navigation, progress and host-controlled activation. This journey works without an AI worker.
2. **Vishal — complete FireRed baseline integration:** reproduce the pinned baseline, integrate a browser runtime and qualify controls, progress and campaign coverage through the shared host interface.
3. **Shishir ([tandalesc](https://github.com/tandalesc)) — build/improvement harness:** config-defined and independently versioned; operates during initial game creation and later improvement for base games and subgames. Simulate pinned versions with isolated state and submit verified new games, updates or forks. This branch provides the first bounded generation/playtest attempt; host registration and activation remain separate integration work.

The shared handoff pins game/config/artifact references and both harness versions, exposes adapter/session capabilities, and exchanges candidate submissions/results and timing reports. Base-specific discovery/session policy and Shishir's internal algorithm remain separately configurable. See [the parallel contract](contracts/PARALLEL_DEVELOPMENT.md) and [TASKS.md](TASKS.md); exact schemas still need joint review.

The task split changes delivery dependencies, not the full product promise. Fixtures do not replace FireRed; parameter edits alone do not satisfy the mechanic-development requirement. Browser/engine selection and home layout remain open implementation/design decisions.

## Research and examples

[MVP_CONTRACT.md](MVP_CONTRACT.md) records the detailed earlier design. [POKEMON_SOURCE_RESEARCH.md](POKEMON_SOURCE_RESEARCH.md) and [research/pokemon](research/pokemon) contain pinned observations, logs, scenario designs and a source-level forest patch. No game ROMs, third-party source checkouts or accepted game packages are included.

`POC_DESIGN.md`, `BROWSER_DESIGN.md`, `BASE_GAME_CANDIDATES.md`, `ENGINE_COMPARISON.md` and `RESEARCH.md` are historical investigations. `design/processor.example.json` and `design/request_examples.json` are historical examples, not current runtime configuration. `design/game_proposal.example.json` illustrates proposal data; it is not an executable schema or test result.

## License

Original Gameverse material is available under the [MIT license](LICENSE). Third-party research excerpts retain their original rights; see [third-party notices](THIRD_PARTY_NOTICES.md). Publishing this planning repository does not distribute FireRed or grant rights to package third-party games, runtimes or assets.
