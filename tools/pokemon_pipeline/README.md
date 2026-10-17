# Local Pokémon source adapter

This adapter targets English LeafGreen revision 1 (`BPGE`, original SHA1
`7862c67bdecbe21d1d69ce082ce34327e1c6ed5e`) and Emerald source assets. It preserves
LeafGreen's game, map scripts, encounters, battles, trainers and progression.
It does not substitute FireRed, another game graph, or a generated game.

Each job captures clean, pinned local source trees and the existing compiler,
proves an unmodified exact LeafGreen baseline, applies an explicit overworld
recipe, and makes an incremental native cartridge. The dependency transfer
includes graphics, frame tables, animation tables, palette bindings and their
consumers. `sprite-coverage.json` records actual supported mappings, adaptations,
and retained identities. Source availability does not certify compatibility.

Player donor palettes are separate from retained native player poses. NPC colors
may be deliberately adapted to existing LeafGreen shared palettes; this is
reported as an adaptation, not exact Emerald color fidelity. Unmatched Kanto
identities retain native sprites. Battle art, tilesets and mechanics changes are
outside this operation.

`runtime.py` stages are `prepare`, `inventory`, `baseline`, `apply` and `build`.
Builds use two jobs with a 180-second per-build bound. Setup, clean baseline and
incremental build timings are separate. Failure/cancellation evidence stays in
the isolated workspace. Baseline and candidate ELF/map files remain available
for native consumer checks. No native or model success is inferred from a clean
build; the application separately requires the native graphics verifier before
Play can pass.

The local decompilations, cartridges, generated assets and resulting cartridges
are prerequisites or private job outputs. They are not committed with this
adapter. No new compiler, dependency or CI stage is installed.
