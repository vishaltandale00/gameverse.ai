# Composition IR v0.1

Research contract and bounded static analysis for composing recovered native game
components. See [pipeline, gaps and migration](../../research/composition/PIPELINE.md).
The static checker does not generate a ROM. The native backend now consumes pinned
plans/packages and emits whole cartridges; see [build instructions and limits](../gba_mashup/BUILD_COMPONENTS.md). Unverified pseudo-C still cannot become a reusable package merely through a label.

```sh
python3 tools/composition/resolve.py tools/composition/examples/sonic-mzm-unadapted.json
python3 tools/composition/resolve.py tools/composition/examples/sonic-mzm-hybrid-proposal.json
python3 -m unittest tools.composition.test_resolve -v
```

The first plan is rejected (exit2); the hybrid is unresolved (exit3). Exit0 means
only consistency of declared checks. Reports always mark lowering as not ready.
`ir.schema.json` separately defines plans and packages. The checker supports only
the documented plan subset, not full JSON Schema, source closure or behavioral
proof. Optional native/prefab/policy/narrative details require future validators.

No network, paid calls, ROM build, CI stage or new dependency is required.
Examples preserve provenance and missing evidence rather than implying complete
decompilation. Own ROM recovery is authoritative for the Sonic request; previous
community-source motion descriptions remain comparative hypotheses.

Native graph entry point: `python3 -m tools.gba_mashup.build --help`.
Focused native contract checks: `python3 -m unittest tools.composition.test_native_build`.

Immutable cross-cartridge sprite packages can declare `native_implementation.kind=
extracted_asset_data` and `recovery.data_recovery`. The contract pins the local
source ROM, every original data range, and extraction receipt. The builder
verifies those independently of executable behavior witnesses and rejects hooks
or host services qualified only by an asset witness. The Sonic campaign's
reextracted MZM flyer demonstrates this path; private asset bytes stay local.
The focused qualification retains a deliberately corrupted range rejection.
No CI job/dependency was added; its clean native build remains under one second
on the recorded macOS arm64/Clang21 machine (exact receipts carry timings).
