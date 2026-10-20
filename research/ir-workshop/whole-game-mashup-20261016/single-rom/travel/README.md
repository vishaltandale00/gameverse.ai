# Native regional travel and recovery

`tools/whole_game/single_rom/travel.py::stage_travel(base, donor, output, report_dir=None)` runs after campaign and before region_map. It modifies only an isolated staged source tree.

The source JSON contains **20** FireRed heal locations. They are appended after the **22** original Emerald records, becoming IDs **23–42**. Original Emerald IDs remain stable. The exported `constants/whole_game_fr_heal_locations.h` provides numeric `FR_HEAL_LOCATION_*` constants and appears before the donor script constants. The normal native GetHealLocation/SetLastHealLocationWarp/SetWarpDestinationToHealLocation/continue-warp APIs now resolve the complete combined table. The Fly UI owner imports the actual Kanto/Sevii source UI/table and consumes these IDs.

Blackout uses the original FireRed mapping from exterior checkpoint to mother/nurse interior, original NPC local ID, and original coordinates. This includes Pallet 8,5; Indigo 13,12; One Island 5,4; other Centers 7,4; and the Trainer Tower 4,11 branch. Numeric NPC IDs come from original map object order using the same i+1 convention as mapjson, rather than authored substitutes. The world_services stage now supplies `FR_TrainerTowerSpokeToOwner` from four actual saved records and the selected challenge ID, with invalid-ID bounds protection. The value is not inferred from the scene flag.

The native Kanto blackout branch runs the original imported Elite Four reset script, computes and removes the source badge/level-based capped money loss exactly once, heals the shared party, resets donor transient state, sets the source respawn, and loads that map. A source-derived native whiteout task prints the original recovery text, waits for actual weather/map-preview completion, then runs the original mother or nurse healing script. Its script dependencies remain independently gated. Hoenn keeps its original money policy, callback and destination. Teleport still uses the original exterior last-heal warp, rather than the blackout interior.

The state owner supplies durable `wholeGameKanto.lastHeal[2]` and `healSchema`. Native guide transitions cache the actual current region's native last-heal warp and restore the destination region's prior warp. On the first crossing, Kanto receives the original Pallet home checkpoint from the source table; Hoenn receives its actual current checkpoint. This avoids losing either region's previous nurse/home location. The shared bag, party, trainer and PC are not replaced.

Dig/Escape Rope entrance capture preserves FireRed's player-facing-dependent Y delta and Viridian Forest exclusion. The native escape/dynamic/continue structures already hold the appended map groups without narrowing. Fly/Teleport/Dig/Rope/blackout reset the exact donor transient flags and scene vars. The shared engine's corresponding transient active effects are also cleared because it owns execution of those effects; no native story vars or badge flags are changed by the adapter.

Verification:

- **11** focused travel/campaign checks passed in **0.481s**.
- The expanded emitted-C fixture passed all **20** source respawns, Trainer Tower branch, and **900** badge/level/money-cap cases in **0.230s**. Egg exclusion and unchanged money during calculation are checked. This is an ABI fixture using controlled native services, not gameplay qualification.
- Both emitted travel C and patched full overworld C passed ARM syntax in **0.0556s**. Actual Emerald headers and source-generated FR map IDs were used; existing generated baseline headers and IDE graphics placeholders supply build-only inputs. Original game string escapes produce two expected IDE-mode warnings. Donor U+2025 ellipsis and native U+2026 both encode B0; the verified spelling alias preserves that byte, and the imported FR_FONT_NORMAL draws the original donor glyph. No linker, ROM, renderer or emulator ran here.
- Failed fixture/header/helper attempts are preserved in `checks.json`. No before/after build comparison exists for this new stage.

Reproduce from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tools.whole_game.single_rom.test_travel tools.whole_game.single_rom.test_campaign
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. python3 research/ir-workshop/whole-game-mashup-20261016/single-rom/travel/check_native_syntax.py
```

The Trainer Tower and map-preview source providers are implemented by their owning stages. Hard obligations remain complete original healing-script/UI services, shared map-preview/Quest Log callback completion, and cartridge tests across all recovery/field-move/save/reload paths. The stage retains `buildEligible: false`; source coverage is not a complete-campaign claim.
