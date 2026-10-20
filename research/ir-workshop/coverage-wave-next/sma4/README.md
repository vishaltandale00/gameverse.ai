# SMA4 source caller with five installed IR helpers

The [frozen result](result.json) records an actual 4 MiB USA revision-0 host reconstruction, with five automatically recovered original helpers installed beneath the unchanged native caller `08051144`.

The source caller supplies eligibility checks, descending canonical actor-pool traversal, partner pixel-mirror synchronization, shape construction, overlap, full-X proximity, and reaction with the actual live `r2`. The helper order and aliases come from retained exact-ROM HighFunction/EX011 evidence. No synthetic contact-query wrapper was installed at an original helper entry.

**This adds five first whole-image installations and zero newly discovered or newly qualified original source functions.** Mirror and reaction had individual historical qualification; the two shape builders and overlap were already qualified within the contact-query sequence. The parent itself remains native: its automatic IR lift reproducibly fails on a cyclic SSA loop without an exact terminating induction proof.

The actual output has **360 behavior bytes, 512 mechanical binding bytes, 768 embedded table bytes and 4 alignment bytes**, appended as a 1,644-byte payload. Five 8-byte veneers occupy 40 original bytes. There are **512 unique source table bytes**: a 64×4-byte shape geometry table used by both shape builders and a 256-byte reaction phase-remapping table. The shape table is emitted twice, so its source and emitted counts differ. Original table bytes are preserved, typed by their actual machine consumers, and remain raw-captured rather than data-regenerated. Tables are data, not executable IR.

One approved native proof passed **256 canonical-world fixtures**, comparing all 262,144 EWRAM bytes and 32,000 IWRAM bytes per case. The explicit 768-byte RAM range `03007b00..03007e00` is omitted. Minimum SP was not recorded, so those bytes are not proved exclusively transient/dead stack; see [scope supplement](qualification-scope-supplement.json). Callee-saved registers and SP balance are checked. Both images execute the original parent; original/rebuilt source-helper counts agree: shapeB 224, shapeA 192, overlap 192, mirror 192, reaction 96. Every reaction invocation checks the actual caller's signed-16 `r2` domain `[-128,127]` and distinct preceding actor aliases in the same canonical world pool.

Fixtures cover source eligibility suppression, near/far full-X guards, 64 same-shape selectors, distributed camera/wrap/subpixel/width states, and actor types including the special reaction-table consumer. They are synthetic and not exhaustive type/slot/shape-pair coverage. Full actor lifecycle, original scheduler, interrupts/concurrency and non-AAPCS/interior entrances remain open. No helper consumes incoming r3 data. A compile diagnostic concerned only the printed unsigned-long reaction count; its value is corroborated by 96 reaction hits per image, while memory/ABI comparisons determine proof success. The exact tested harness is retained.

The output SHA-256 is `1408bb768aadc78cb41286ba8b8f8d1fd42443d8e81322392d63d850e3243a8d`, **4,195,948 bytes**. **4,193,752 original bytes remain opaque-preserved** across 11 spans. The 470 bytes of original helper envelopes are provenance, not semantic regenerated-byte coverage. Eight closure records are enumerated; total semantic closure count is unknown.

Retained private packets:

- `local/roundtrip/coverage-next-sma4-inputs-001`: stable 86-file compiler snapshot, fresh helper IR/C, typed table contracts and parent blocker.
- `local/roundtrip/coverage-next-sma4-baseline-001`: exact original captured baseline with typed original tables.
- `local/roundtrip/coverage-next-sma4-ir-001`: failed build preparation before any compile, preserved as an empty attempt directory.
- `local/roundtrip/coverage-next-sma4-ir-002`: actual build, installed output, native parent proof and source artifacts.
- `local/roundtrip/coverage-next-sma4-bundle-001`: existing private bundle export.
- `local/roundtrip/coverage-next-sma4-bundle-replay-001.gba`: artifact-only replay with matching hash; `rebuild_only`, not fresh IR regeneration.

Actual emitted build/link/layout took **0.275157333 s**; parent oracle compile took **0.059976875 s** and native comparison **0.530855416 s**. Artifact-only replay took **0.008293 s**. Queue/full-task time and a comparable before/after wall measurement are unavailable. Stages are nested as recorded in `result.json`; no broad performance improvement is claimed. Two export attempts failed while required comparison/producer receipts were absent; they performed no native work, and successful replay followed completion of those receipts.

`build.py`, `parent_oracle.c`, `qualify_parent.py` and `finalize.py` preserve the performed implementation. They intentionally reject existing producer output paths; do not rerun into the frozen directories. No JVM, campaign, UI, model, shared compiler/provider/registry modification or public upload occurred.
