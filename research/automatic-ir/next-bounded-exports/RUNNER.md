# Exact-target fleet export support

The small `export_one.py` helper reuses the existing exporter and installed tools. It adds no dependency, CI step, analysis stage or automatic qualification. Its first real use exported seven connected SMA2 sound30 dependencies in 3.322999 seconds; this is actual run timing, not an estimate of all games. A general before/after performance baseline is unavailable.

Before running, search retained exact same-game HighFunctions, then obtain a coordinator JVM permit and exclusive saved-project lease. At most four JVM processes may run globally. A worker's existing exploration/lift may continue while it waits; a permit is required only for the actual copied-project export. Release permit and lease immediately when that process/check completes or fails.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 research/automatic-ir/next-bounded-exports/export_one.py \
  EXACT_GAME_ID ENTRY_HEX ENTRY_HEX \
  --out local/ir/fleet-next/OWNED_GAME/UNIQUE_RUN \
  --permit COORDINATOR_GRANTED_ID
```

The output directory must be new. The helper reads queue metadata and privately copies the saved project and current exporter; creates a private Java home; runs one game sequentially with exact priority selection, readOnly/noanalysis; retains logs, hashes, manifests, actual timings and failures; checks entry/format/block/varnode structure; and emits `report.json` plus a compiler-owner `append-packet.json`. It does not apply the packet or modify the queue/catalog/compiler/original project. Compiler depth loading already accepts the packet's `artifacts/l0` layout.

Bounds remain 45 seconds per exporter script, 75 seconds per process, 128 MiB output and no more than two ROMs per invocation/900 seconds total. The helper uses one ROM, at most 64 exact dependencies, and no broad analysis. Static/native stages are separate. Nested exporter time must not be added to process time. Queue time is unavailable.

For a different completed retained project, pass `--project EXACT_SAVED_PROJECT_DIRECTORY`; the lease must cover that exact source. For an instruction-proven native callee ABI, pass `--overrides PATH_TO_JSON_MAP`; the map has the existing exporter's form:

```json
{"080479c0":{"arguments":["u32"],"return":"void","evidence":["PINNED_OWN_ROM_PROOF_REFERENCE"]}}
```

Do not infer a native return or pointer argument from pseudo-C or a symbolic handle type. The nearby SMA4 ABI packet is a verified example: the wrapper keeps native actor r0 and the leaf has a proven void contract. Optional overrides are applied only in copied ephemeral metadata.

Known constraints: the current shared exporter attempts to create missing priority entries in Thumb mode. An absent ARM target needs instruction/mode proof and explicit exporter support before launch. An entry inside conflicting existing instructions can fail eager setup before any selected export is emitted (FFVI EX015 retained by its worker). Retry known existing functions separately; do not force context or invent a continuation boundary. Changes to the shared exporter require compiler-owner agreement. Actual service stubs such as BIOS sqrt `CALLOTHER` remain service gaps even after successful serialization.

The optional `--pre-script EXACT_SCRIPT.java` copies a compiler-agreed exact-target setup script into private outputs and pins its hash. It is not permission to invent a boundary or force modes. The Driv3r ARM packet is the only such initial agreed case: all 30 existing instructions and two exact ROM spans are checked; already correct ARM context is preserved; unrelated function overlap/incompatible instructions are rejected; no instructions are cleared. Its first redundant context-write failure and successful retry are both retained. See `driv3r-arm/README.md`. Do not reuse that script for other targets: addresses and hashes are intentionally fixed to its evidence.

Current compiler return proofs already handle evidenced terminal pop/bx returns. Re-exporting an existing function solely to remove a historical false `CALLIND` wastes a process. Real bx-r1/r2/r3 gameplay trampolines must remain callbacks. Missing call arguments or return values require exact ROM/caller ABI evidence before annotations.

Initial support outcome: SMA2 sound30 targets `0809d77c`, `0809b514`, `0809b564`, `0809d864`, `0809d9d4`, `0809d9ac`, `0809d790` succeeded under coordinator permit EX-001. Receipts and hashes: `local/re/next-bounded-exports/projectile-audio/sma2-sound30-20261016T105330Z/`. Original source project manifest remained unchanged. Projectile owner received the artifacts for actual closure work. All seven exports are unqualified until its compiler/native checks run.
