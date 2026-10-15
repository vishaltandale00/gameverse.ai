# A complete FireRed subgame for Gameverse

Research date: 2026-10-14. Requirement: a complete FireRed experience inside the browser overworld, with controller feedback that can change mechanics, add quests and create forks. The three submitted requests are evaluation scenarios; there is no need to pick a single one before researching the base.

**Recommendation: use `pret/pokefirered` as the game source and evaluate a browser GBA emulator adapter.** Several editable browser Red projects exist, but they do not establish completeness or fidelity to FireRed. A full-game source candidate exists, so a from-scratch recreation is not the starting recommendation. This is a researched selection, not an installed or fully tested subgame.

## What I found and inspected

| Candidate | What it provides | Evidence observed | Fit |
| --- | --- | --- | --- |
| [pret/pokefirered](https://github.com/pret/pokefirered) | FireRed/LeafGreen C/assembly decompilation; project describes matching original ROM builds | Cloned source, inspected encounters, Misty party/scripts, Rocket scripts, flags, saves and build instructions | Best fit for the complete FireRed requirement; needs the build toolchain and a GBA browser adapter |
| [BrandeisPatrick/pokemon-red-web](https://github.com/BrandeisPatrick/pokemon-red-web) | Browser-native JavaScript Red recreation; README claims full Kanto | Source and assets present; README's advertised tests and extractor tools absent in this checkout; its advertised test command discovers zero tests | Candidate for a Red prototype, not evidence for complete FireRed or its claimed test coverage |
| [levy-street/pokemon-claude-red](https://github.com/levy-street/pokemon-claude-red) | Browser Red recreation, procedural visuals, source gamepad polling and headless tools | A 10-battle fuzz sample had zero stuck battles/errors; six-map interaction sweep reported 47 interactions, zero hangs/errors; rendered Viridian Forest through its Node shim | Most promising inspected browser-native alternative, but Red rather than FireRed; not a complete campaign or real-browser certification |
| [peach231/pokemon-kanto](https://github.com/peach231/pokemon-kanto) | JavaScript Kanto/Gen-1 recreation; external asset URLs | Validator ran; reported 138 reachable maps and other successful structural checks, then failed on a stale cache token, with a difficulty warning | Useful tooling example; candidate needs repair and still does not meet exact FireRed scope |

All four are public source repositories. No root LICENSE/COPYING file was found in the four inspected checkouts. Their source availability and their Pokémon content should not be described as an explicit permissive open-source license. This is a repository observation, not a legal assessment of the private PoC. The emulator is a separate component with its own license.

Pinned checkouts:

- pokefirered: `037335f4c725d7c9aecdac87066f2002b4bd7e14`
- pokemon-red-web: `ee2a8ccb007192a90ea88a173199f4ccd85dca60`
- pokemon-claude-red: `5aedbfe00b1b204fc604ad963509c74b65f704b0`
- pokemon-kanto: `9a37d4fc32e72c5e582edbb98edf89beb6ad8510`

The audit checkouts are in `/tmp/gameverse-pokemon-audit-SSOOcf`. They were not installed into the Gameverse application. Source observations and executed checks are saved in `research/pokemon/audit-results.json` and its adjacent logs.

## Browser execution and editing are two separate components

The FireRed project builds a GBA cartridge image, not a browser-native game. A browser emulator executes the cartridge; the local worker edits and rebuilds the game source. The agent's edits must reach the source/game data, rather than merely changing an emulator setting or live RAM value.

[EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) is an existing web frontend with a documented ROM URL, GBA cores and save callbacks. Its repository identifies GPL-3.0. [Its documented options](https://emulatorjs.org/docs/options/) provide useful integration primitives; they do not promise an atomic game-version swap. Prefer a pinned self-hosted release/core and avoid depending on undocumented internals.

[wasm-gaming/mGBA-wasm](https://github.com/wasm-gaming/mGBA-wasm) is another browser SDK candidate, documenting GBA load, frame execution, gamepad polling and save/state operations. I reviewed its documentation, not its compiled runtime. I have not selected or verified a final emulator adapter.

The outer browser shell remains responsible for identity, game library, the reserved recording button, job status and version controls. The city can still be a Godot web scene. FireRed is loaded through a separate cartridge adapter; it does not have to be rewritten as a Godot scene. This amends the earlier proposal to keep every subgame inside one Godot runtime. Activate only the relevant gameplay input handler while the shell retains its feedback action.

Conceptual flow:

```
controller request + current game/version/context
  -> local queue and configurable processor
  -> isolated source edit + candidate cartridge build
  -> static checks + emulator regression scenarios
  -> versioned artifact offered in the browser
  -> copied-save trial / in-place version switch
  -> same feedback button -> next request
```

The user may continue playing the current version while the candidate is built. Updates preserve game identity and retain old/new artifacts; forks create a separate game entry with parent game/version lineage. A failed build never replaces the active version.

## The three requests against the source

### 1. Stronger Pokémon in Viridian Forest

The source's [wild encounter JSON](https://github.com/pret/pokefirered/blob/037335f4c725d7c9aecdac87066f2002b4bd7e14/src/data/wild_encounters.json) has a separate FireRed forest table with 12 slots and levels 3–6. I generated a provisional patch increasing these wild levels by three, to 6–9. This interprets “stronger” as tougher wild encounters; it leaves trainers alone and can be revised by feedback.

Executed checks: exactly 24 level fields changed; species, encounter rate, LeafGreen and every other encounter entry remained unchanged; resulting JSON parsed; `git apply --check` accepted the patch against the pinned checkout. Patch: `research/pokemon/forest-candidate.patch`.

**Limit:** this is a source/data probe, not an in-game success. The cartridge has not been built or played. Required next verification: sampled forest encounters, adjacent-route regression checks, old-save load/save/reload and controller feedback after the swap.

### 2. A quest for a stronger electric type to beat Misty

Inspected [Misty's party](https://github.com/pret/pokefirered/blob/037335f4c725d7c9aecdac87066f2002b4bd7e14/src/data/trainer_parties.h): Staryu is level 18; Starmie level 21, with Swift, Recover, Rapid Spin and Water Pulse. The [gym script](https://github.com/pret/pokefirered/blob/037335f4c725d7c9aecdac87066f2002b4bd7e14/data/maps/CeruleanCity_Gym/scripts.inc) contains the battle and badge/TM progression. Cerulean city has editable NPC/event data and scripts.

A first generated candidate could add an optional local quest and a non-Pikachu electric reward with a useful electric move. Its exact story, reward and strength can be chosen by the processor and refined after play. The generated quest must be reachable from the actual pre-Misty save: sending the player to a location requiring a later HM/badge would fail this request.

Acceptance requirements: reachable start and completion; a useful intended battle strategy against unchanged Starmie; reward given once, including party-full behavior; persistent quest state; original Misty badge/TM sequence intact. Do not promise every battle input wins. **Observed status: integration points inspected; quest not implemented or tested.**

### 3. Infiltrate Team Rocket

The source contains Rocket Hideout maps and scripts, including [B4F](https://github.com/pret/pokefirered/blob/037335f4c725d7c9aecdac87066f2002b4bd7e14/data/maps/RocketHideout_B4F/scripts.inc), plus persistent [flags](https://github.com/pret/pokefirered/blob/037335f4c725d7c9aecdac87066f2002b4bd7e14/include/constants/flags.h) and variables. Existing Rocket battles are a foundation; the request can justify a new cover identity, access behavior and undercover objective.

A proposed first candidate is a bounded infiltration mission that rejoins the original story. It must have a start appropriate to the current save, an escape/retry on detection, persistent objective/cover state and no collision with existing progression flags. Confirm that the mechanic changes access or interaction rather than only inserting dialogue. **Observed status: source primitives inspected; mission not implemented or tested.**

Detailed scenario specifications and required runtime checks are in `research/pokemon/scenarios.json`. These are candidate interpretations and acceptance designs, not predetermined limits on future requests.

## Verification and version swapping

The shared pipeline should verify both updates and forks: build succeeds; candidate loads; required controller bindings work; its requested scenario succeeds; key campaign progression still works; save compatibility is checked. Human feedback judges whether the result is desirable.

For GBA candidates, distinguish the in-game save from an emulator save-state snapshot. A snapshot includes live execution state; do not assume it transfers across changed cartridge code. A conservative first swap is an in-game checkpoint, export/copy of its save, candidate load and resume. Keeping the player at exactly the same frame during arbitrary code replacement is still unproven.

Store cartridge hash, source commit, emulator/core version and save-schema identifier with each version. Trials use copied saves. On rollback restore the original cartridge and its compatible checkpoint; do not silently feed newer save data into old code. Preserve quest completion and rewards with allocated persistent flags/variables, and explicitly test migrations when layouts change. No migration or swap implementation was built in this research turn.

## Executed evidence and limitations

- `make -j2` in the clean FireRed checkout could not build: host tools and `agbcc` were not bootstrapped, and ARM assembler/preprocessor executables were absent. This is an environment/prerequisite limitation, not evidence the repository cannot build. No matching-ROM hash was produced. Follow [the repository's installation instructions](https://github.com/pret/pokefirered/blob/037335f4c725d7c9aecdac87066f2002b4bd7e14/INSTALL.md) to provision a reproducible worker toolchain.
- Claude Red's battle sample and interaction sweep passed their reported headless checks. The sweep used advanced progression flags and an overpowered party, so it does not prove early-game reachability. Fuzz tools report outcomes; exit status alone is insufficient. A ten-frame forest render was inspected as additional headless visual evidence.
- Kanto's validator exited 1 on a stale cache token (`614e5c53`, expected `188126dc`), with a level-80 difficulty warning. Its passing subchecks are not an overall pass.
- Red-web's advertised test command exited 0 but discovered **zero tests**. That is not its advertised coverage.
- Chrome DevTools could not connect to `127.0.0.1:9222`. No actual browser gameplay, physical controller, microphone or full-campaign test was performed. Headless checks do not replace these.

The research supports reusing full FireRed source and building the shell/emulator/editing adapter around it. It does not certify any browser clone as a complete FireRed replacement, nor claim the Gameverse subgame or automatic quest-generation pipeline is already running.
