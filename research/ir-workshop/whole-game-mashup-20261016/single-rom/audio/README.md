# Original FireRed audio import

`tools/whole_game/single_rom/audio.py` stages the complete original FireRed song
and instrument closure into a copied Emerald tree. `import_audio(donor, stage,
output_dir=None)` returns a strict ledger; `stage` is the merged source tree,
never either canonical decomposition. A failed readiness ledger blocks the ROM
build. `analyze_audio(donor, base)` performs the read-only inventory.

The import preserves all 610 Emerald table entries and appends all 347 FireRed
entries, including their player and auxiliary fields. Every donor song has its
original MIDI and exact converter options. Song constants are `FR_MUS_*` and
`FR_SE_*`, song/data symbols use `FR_`, and converter bank symbols use
`voicegroupFR_###`. `MUS_NONE` remains the sentinel. No track is replaced by a
generic equivalent. All 488 sample sources (3,741,588 source bytes), original
key-split offsets, programmable waveforms, bank structures and cry tables are
retained in `sound/fr/`. Cry conversion keeps the original compressed/no-pad
recipe. The donor MPlayDef is retained because its `v069` value differs from
Emerald's.

The generated runtime uses `WholeGame_IsKanto()` from `whole_game_state.h`.
M4A start, stop and continue entry points translate the host's same-name song
constants and explicit `*_RG_*` aliases to original donor IDs while in Kanto.
The native battle selector uses the donor's original class switch with
`FR_TRAINER_CLASS_*`; trainer victory preserves FireRed's leader/champion choice.
All fourteen donor fanfare IDs and wait durations join the host fanfare table,
so explicit imported fanfares cannot silently fall back to level-up music.
The original host selection remains active outside Kanto. Encounter-specific
explicit battle tracks and script/map references must still be rewritten by
their respective importers. Trainer constants come from the encounters stage.

The source gate checks instrument/sample/include references, complete song
sources, ID bounds, all four player configurations, voice macros, the M4A data
ABI and converter semantics. The known converter change from integer bank
numbers to labels is handled explicitly; other converter changes fail closed.
The generated `audio-ledger.json` records source hashes and runtime dependencies.

Four focused source checks pass: exhaustive inventory, preserved song/sample/MIDI
bytes and idempotency, service-drift rejection and canonical-tree rejection.
See `verification.json` and `test-output.txt`. The focused run took 0.618 seconds
including interpreter startup. No full build or audible playback ran here;
those timings remain unavailable. There is no prior single-ROM import baseline
and no turnaround improvement claim. The necessary build cost is 347 additional
MIDI compilation units and 488 donor sample sources, using the existing tools
and narrowly scoped generation rules without additional dependencies.

## Audio text operands

The importer also emits all 347 `FR_MUS_*` / `FR_SE_*` charmap aliases using
`610 + donor_song_id` as a little-endian u16. Existing generated aliases are
replaced before writing; rerunning cannot retain duplicate old IDs. Every alias
was passed through the actual Emerald `preproc` and ARM assembler, then compared
byte-for-byte against its expected `PLAY_BGM` / `PLAY_SE` control sequence:
347 controls, 1,735 bytes, all matching. Preprocessing took 0.00356 seconds and
assembly 0.00347 seconds. See `charmap-verification.json`. The updated four-check
source suite also passed; no full ROM build ran for this fix.
