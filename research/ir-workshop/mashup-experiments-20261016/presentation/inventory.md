# Presentation evidence inventory

Read-only inventory of the authoritative 33-game ROM catalog.

## Findings

- ROM files: 33/33 present in `local/roms/`; indexed identities come from `local/re/roms.json`.
- Existing baseline capture summaries: 33/33 successful; 4492 keyframe PNGs across the captured attract, frontend and gameplay phases.
- Bounded loaded-asset trace/snapshot pilot: 3/33 games — Crash Bandicoot: The Huge Adventure, Metroid: Zero Mission, Pokémon Emerald. Trace files are under `local/captures-experiments/20261016-loaded-assets/on/`; decoded manifests under `local/re/experiments/20261016-loaded-assets/`.
- GBA asset trace is specifically BIOS LZ77 SWIs 0x11/0x12; it does not cover RLE, Huffman, software decompression, DMA/raw copies or palette-RAM destinations. Snapshot matching proves bytes after HLE at first captured use, not visual meaning.
- Existing capture output contains game-specific screenshots and telemetry for all 33; this inventory does not infer what is depicted from game titles or summarize image appearance.
- Source repositories with graphic/media suffix files: 8/33 have at least some such files. Suffix counts are not validated as game art nor mapped comprehensively to the pinned ROM revision.

## Shared existing tooling

- `tools/re/capture/run_captures.py`: accepts `--ids`, `--jobs`, `--timeout`, `--harness-args`, `--asset-trace-limit` (default 64, max 4096), `--asset-snapshot-max-bytes` (default 0, max 1 MiB), and `--out`; emits phase PNG keyframes, telemetry, audio and coverage evidence. The build/harness instructions and output schema are in `tools/re/capture/README.md`.
- `tools/re/assets/decode_loaded.py`: `--capture-root` and `--out-root` are required; optional `--ids`, `--max-records`, `--max-output-bytes`, `--max-input-bytes`, `--max-total-output-bytes`, `--write-output`. It reads only observed trace entries; detail and caveats are in `tools/re/assets/README.md`.
- `tools/re/session/bridge.py` captures observations as PNG and can expose structured native-sprite fields only with a configured memory profile.
- `tools/gba_playtest/mzm_profile.py` derives an MZM native sprite profile from source/build symbols; `tools/gba_playtest/wild_run.py` uses it for a scoped actor/encounter observation. This is game-specific and does not imply a 33-game sprite catalog.
- `local/composition-assets/mzm-flyer-01/` and `mzm-flyer-02/` hold generated `frames.png`, assets C/H and receipts for MZM composition experiments. These are experiment products, not a recovered complete original-art pack.

## Per-game coverage

Per-game record, including exact ROM, capture directory, phases/keyframe counts, any source media suffix counts, observed LZ77 trace paths, and recovered/missing/unobserved status, is in `inventory.json`.

“Missing” refers to missing evidence in the workspace for a complete, verified visual asset set; it does not claim the ROM lacks assets. “Unobserved” marks semantics the inventory cannot establish.
