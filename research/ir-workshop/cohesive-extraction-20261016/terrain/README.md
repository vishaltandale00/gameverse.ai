# Kirby terrain/contact capsule, 2026-10-16

The source responsibility is `actor scratch → terrain point → signed displacement → actor contact correction → actor writeback`, rooted at Kirby Nightmare in Dream Land parent transactions `0801bde0`/`0801baa4`. [capsule.json](capsule.json) records parent/phase/dependency links, shared state, service and asset needs, typed domains, source pins, and partial status. One nonpublishing point sampler is now portable for a one-cell map; the publishing samplers, actor contact and writeback remain unqualified.

## New executable point query

`08021ab4` now lifts the original point-to-cell and dynamic shape-row lookup with all 256 source selectors and all 14 distinct ROM occupancy rows. [make_point_fixtures.py](make_point_fixtures.py) derives expected signed occupancy directly from the pinned source ROM. The existing native qualifier passed **7,456 original-versus-emitted pairs**, including all 256 local positions for each distinct row's representative selector, 16 positions for every alias selector, source-ROM expected returns, and unchanged width/height/cell shape. Its full 256-byte map object comparison also checks neighboring backing bytes after the call. The actual native receipt and generated IR/C are under `local/ir/cohesive-extraction-20261016/terrain/08021ab4-point/`.

This admitted domain is signed16 width=height=1, one four-byte terrain cell, `x/y=0..15`, and every `u8` shape selector. The source function returns a signed8 row sample sign-extended to a `u32` bit pattern and does **not** publish shared probe scratch. [bounded-provider.json](bounded-provider.json) states the exact generated callable `behavior_0(state,y,x)`, source cell layout, read-only effects, coordinate frame, and domain. The original Thumb call passes `x` in r0 and `y` in r1; the emitted C orders its scalar parameters by its recovered ABI as `y,x`. Qualification took 0.373 s inside a 0.381 s script run. The 30-second per-stage and 16 KiB object caps were unchanged; all stages passed.

## New executable support

From retained original HighFunctions `080219b0`, `080219d0`, and `080219f0`, [run.py](run.py) automatically lifted selector 2 and selector 3 for vertical, left, and right signed displacement. The six generated L1 programs passed original Thumb versus generated Thumb comparison for all 256 tile-local sample indices each: **1,536 new pairs**. The existing selector-1 proofs (768 pairs) are linked into the same phase, giving three usable shape selectors across three axes. No selector dispatch is asserted to be recovered. Each selector specialization is an input contract, not a new original function.

Artifacts and exact L0/L1/adapter/generated C/qualification hashes are in `local/ir/cohesive-extraction-20261016/terrain/run-report.json` and the capsule. The new run was six targets × 256 vectors, under the existing 30-second stage cap. Total sequential wall time was 1.345 s; native qualification was 1.315 s within that total. Queue, CI, full-game build, and before/after turnaround baselines are unavailable. Prior shape-1 times are retained in the earlier extraction manifest and not added here.

## Remaining point-to-contact blockers

[repro_blockers.py](repro_blockers.py) retains the **pre-repair** compiler boundaries using cached L0 only. Run it against the pinned prior compiler to reproduce the original failures:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 research/ir-workshop/cohesive-extraction-20261016/terrain/repro_blockers.py
```

The retained result is `local/ir/cohesive-extraction-20261016/terrain/blocker-repro.json`. Before the shared bounded pointer-row repair, dynamic shape selection `0..255` reached a nested ROM pointer-table row and failed `not constant v10`. `08021ab4`'s cell at operation 20 (`08021af0`) used signed map width and tile coordinates to address byte +3 of a four-byte cell; without map bounds it failed `unbounded or unaligned state collection`. A one-cell width/height and coordinates `0..15` profile then reached the nested pointer (`not constant v1`). The repaired lifter proved that narrow profile and native parity passed. General map dimensions and the publishing sampler roots `08021634`/`080216d8` remain open.

The source occupancy table at `087328f0` holds 256 four-byte pointers to 256-byte signed sample rows (14 distinct rows). The shape-row pointer is source data, not a game-specific authored lookup. Map width/height are signed16 at `03005620`/`0300561c`; `03005660` owns four-byte cells. The source samplers `08021634`, `080216d8`, `08021ab4` end in stack-return sequences that Ghidra emitted as `CALLIND` and `RETURN` without the consumed r0 value. The ROM bytes and caller evidence are retained in `research/deep-extraction/resume/kirby-nightmare-in-dream-land/packet.json`; `0801e178` calls these samplers and branches on occupancy. The return repair must be proved from the original Thumb and native ABI, not inferred from the pseudo-C signature.

Current unresolved graph: larger terrain map domain and source current/below samplers → shared scratch alias and signed displacement → metadata-backed `0801e178` contact correction → same-actor load/writeback and source scheduler. The contact root also uses metadata tables `08732cf0`, `08732df0`, `08732ef0`, `087336f0`, `087338f0`, `087339f0`, `08735018`. Until those obligations close, this is a qualified point-query/support bundle, not a landed terrain prefab or a playable system.

The scripts add no CI job, dependency, ROM export, generated game, or runtime source. They use the existing lift/lower/native qualifier, six narrow displacement contracts, and one one-cell point profile. The new native work totals 8,992 finite pairs; it does not establish scene reachability or cadence. No comparable before/after turnaround baseline is available.
