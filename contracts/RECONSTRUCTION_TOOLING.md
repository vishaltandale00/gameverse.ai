# Scoped reconstruction tooling

This public source package supports qualified partial-IR replay, exact readonly-callee bindings and typed captured-asset separation. It contains no ROM, game-derived IR, assets, private source profile, native binary or sealed compiler payload. The [publication receipt](../verification/reconstruction-tooling-wave-20261016.json) pins the exact generic source and separates publisher checks from owner-reported private qualification.

The [frozen 33-game wave snapshot](../verification/reconstruction-coverage-33-games-20261016.json) records zero demonstrated whole-game reconstructions. Its per-game statuses and subtotals are frozen for this wave; unresolved semantic and lifecycle gaps remain explicit. Code, asset and semantic-closure denominators are unavailable, so no coverage percentage is inferred. Capturing or exactly reassembling original bytes does not establish executable IR regeneration.

The frozen producer ledger contains 15 QC packets and 13 games with scoped installed research IR: 2,420 executable behavior bytes and 2,766 mechanical binding bytes, with 11 new distinct roots and 16 prior-root reinstalls. Two additional MMZ source-profile domains remain scoped. The 6,174 emitted behavior bytes outside installed cartridges are recorded separately, including alternative variants; they are not added to installed coverage. Central-library admission and composition eligibility are separate from these producer counts.

## Qualified IR bundle v2

The executable frontend is `tools.roundtrip.ir_bundle`. Version 2 accepts an explicit bounded list of qualified target identities and preserves legacy MZM v1 loading. It freshly lowers the supplied qualified L1 modules, applies the pinned mechanical binding and reconstructs the admitted artifact while retaining native/mixed regions explicitly.

Admission consumes an already qualified private producer packet and an already exported private container:

```sh
python3 -B -m tools.roundtrip.private_bundle export --input /path/to/private-packet --output /path/to/new-private-bundle
python3 -B -m tools.roundtrip.ir_bundle admit --packet /path/to/qualified-producer-packet --bundle /path/to/new-private-bundle
python3 -B -m tools.roundtrip.ir_bundle rebuild --bundle /path/to/private-bundle --output /path/to/new-attempt
```

A separately admitted `asset-overlay.json` partition from the existing `bundle_assets` API can be supplied with `--asset-partition /path/to/private-overlay`. Batch icon output below uses a different typed-capture format; the two inputs are not silently interchangeable.

The required generic lowering, contract, domain, mechanical binding and assembly sources are included. Rebuild uses the admitted sealed snapshots rather than reading the original game checkout or old emitted C. The public `ir_provider` module intentionally exposes five mechanical/integrity helpers only. It does not provide the full producer CLI, source lifting frontend or creation of new native qualification receipts. New game admission still requires compatible qualified inputs from that separate producer workflow.

Retained private v2 replay passed exact artifact identity for Minish Cap and Fusion across three targets. Minish accounts for 54 behavior, 112 binding and two alignment bytes. Fusion accounts for 124 behavior, 88 binding and 10,720 embedded readonly mixed bytes; that mixed block is not claimed as independently identified or regenerated assets. Parent replay times were 0.185838 s and 0.135530 s respectively. No new native qualification was performed for this publication, and these are scoped replays rather than whole-game builds.

## Readonly callees and entry ABI

The frozen compiler import closure includes the exact readonly-callee helper and lift hook. It permits constant own-ROM scalar fields through a bound callee with matching width, type, domain and immutable storage. Writes, collections, dynamic offsets, reference effects, native effects and ambiguous declarations fail closed. Retained MMZ profile-0/1 native proofs each cover 256 cases, including 16 semantic cases. That qualification does not extend to an unspecialized actor/asset profile or arbitrary caller/lifecycle closure.

The mechanical entry helper rejects incoming `r3` scalar/entity bases and unsupported custom/non-AAPCS contexts before generating the existing entry binding. The current transfer is unchanged; no fourth-argument-preserving or new ARM-entry capability is included. This guard is a prerequisite check, not a proof of every function or caller ABI.

The transitive 27-module compiler snapshot is included so the exported helper does not depend on unpublished local imports. Its inclusion records dependency identity and prior baseline mechanisms; it is not blanket fresh qualification of every compiler path. Pending Driv3r, KH and other general compiler fixes are excluded.

## Typed captured icon batches

The new batch tool reads an explicit pinned private source/ELF/map profile and an admitted exact-reassembly packet:

```sh
python3 -B -m tools.roundtrip.asset_batch --profile /path/to/private-profile.json --packet /path/to/private-packet --output /path/to/new-private-directory
```

Its supported category is `indexed-4bpp-icon-sprite/1`, with source-table → selector → sprite-image → OBJ-copy evidence. Filenames, comments or object sections alone cannot establish that category. It writes separate captured files and an exact replay artifact; the input profile and output payloads remain local.

Retained private batches separated 410 FireRed icons (419,840 bytes) and 413 Emerald icons (422,912 bytes), then consumed those separate files to match each original 16 MiB identity. FireRed source binary/ELF equality was checked. Emerald establishes PNG source/declaration/dimensions and captured ELF 4bpp bytes, without a fresh converter or pixel-equivalence proof. Neither batch reexecuted the semantic consumer, regenerated data or earned new IR credit. All remaining bytes remain mixed/unknown. Fresh batch times were 0.437367 s and 0.542964 s; no equivalent prior baseline is available.

## Focused checks and timing

No CI job, package dependency, native run or model evaluation was added. Publisher checks in the isolated export were:

```sh
python3 -B -m unittest tools.roundtrip.test_ir_bundle tools.roundtrip.test_asset_batch -v
python3 -B tools/behavior_ir/verify_readonly_callee.py
```

The 13 synthetic tests passed in 0.039 s and 14 readonly checks in 0.001503 s. An independent reviewer also copied the exact helper, existing public reassembly module and eight input tests into a minimal package; all eight passed in 0.035851 s. That result was reused without a duplicate run. Replay/batch times above come from retained owner evidence and independent QC, not new publisher native execution. Queue time, remote CI time, general ABI-guard overhead and whole-game build/latency baselines remain unavailable.
