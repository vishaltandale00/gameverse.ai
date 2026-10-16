# Native GBA composition

The output is an actual `.gba` cartridge. The first reviewed recipe retains the
whole Zero Mission source campaign and integrates native Pokémon encounters using
code, data and pixels extracted from a pinned Emerald source checkout. It is a
separate game identity, with independent player progress in the existing GBA
browser adapter. The generation loop does not replace the player's accepted ROM.

The lookup command exposes the ontology's source instructions and state contracts:

```sh
python3 tools/gba_mashup/component_lookup.py --query 'jump ability gate'
python3 tools/gba_mashup/component_lookup.py --game metroid-zero-mission --component ground_locomotion --include-source
```

Results include exact checkout revisions, file and definition hashes, line
references, reads, writes, invariants and relations. A reference that cannot be
resolved stays unresolved. Source occurrence is distinguished from a proven
function definition. Literal search is deliberately separate from the existing
embedding similarity view; semantic proximity does not establish linkability.

## Source extraction and assembly

Run `extract_emerald.py` with the existing workspace Python (Pillow is bundled),
then follow [BUILD_MZM.md](BUILD_MZM.md). No dependency installation or paid model
call is needed for extraction, building or native qualification. Generated source
extracts and raw game assets are local ignored outputs. Every extraction pins the
source revision, rejects tracked modifications, hashes spans and outputs, and
preserves the function bodies. The native sprites use the original 64x64 indexed
first frames and canonical palettes, converted to GBA RGB555.

The [reviewed recipe](recipes/mzm-emerald-encounters-v1.json) records up to eight
user-facing choices, each potentially bundling several ontology components, plus
explicit dependency resolutions. It records the user's later side-view decision.
The original request's toy grid limits do not truncate the campaign.

`emerald_bridge.c` links the extracted `CalculateBaseDamage`, `TypeCalc`,
`ModulateDmgByType2`, random damage scaling, type chart, move data and species
stats. Bridge state/menus/turn order and simplified damage-scoring AI are new glue.
They do not implement Emerald's full trainer AI script interpreter, held items,
catching, evolution, or persistent party. The original MZM campaign engine and
systems are retained; the embedded NES unlockable is reused unchanged from the
exact matched baserom and is identified separately in the build receipt.

The native integration uses the existing pause resource backup and world reload
path. SELECT enters an encounter; damage after cooldown also enters, including
hazards. This first bridge does not remove a specific world enemy after victory.
These limits are part of the recipe, not implicit promises of compatibility.

## Lean verification

```sh
python3 -m unittest tools.gba_mashup.test_native_bridge -v
```

The host check compiles only the bridge with address/undefined-behavior sanitizers.
It checks exact integer clear/rain/sun damage (26/14/36 for the configured case),
invalid-action rejection, fainted replacement, seeded replay, HP bounds and sixteen
bounded encounters. It ran in 0.381 seconds on this Apple Silicon development
machine. This is math/state qualification, not GBA display or campaign evidence.

Three source-lookup checks separately guard against confusing conditional call
sites with function definitions and cover pointer-return declarations. A focused
review also added source-prefix coverage and qualification-media hash checks.

The separate real-ROM harness in `tools/gba_playtest/` provides bounded native
emulator actions, source-linked RAM observations, screenshots and actual-frame
MP4 recording. It accepts explicit model/action/frame/time limits and records
failures. ROM-qualified RAM profiles must match the exact artifact; image novelty
alone cannot establish control or progress. Full campaign qualification remains
unavailable until a scoped campaign is actually run.
