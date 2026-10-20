# Bounded mashup experiments — 2026-10-16

**Eight combined subsystems executed, three offline graphics probes rendered, zero playable games and zero model gameplay calls.** This round produced useful interacting behavior and concrete failures. It did not produce the substantial playable mashup the user ultimately wants. No generic Soul Loom/Cinder template was reused. No source IR, catalog, frontend or accepted game was changed.

The starting evidence snapshot contains 129 qualified package records, 20 registered prefab entries and 33 source-game delivery maps; the retained nine-blueprint closure packet still reports 0 complete blueprints. These are different readiness measures. [index.json](index.json) pins the catalog/tooling and dirty-checkout context; [summary.json](summary.json) indexes the frozen results. Eight host interactions exercise parts from 12 source games; Kirby contributes a rejected terrain connection, and FireRed contributes additional graphics evidence.

## Demonstrated interactions

| Experiment | Observed useful combined behavior | Actual boundary |
| --- | --- | --- |
| [DB input → Sonic air movement](action/README.md) | Disabling controls removes steering but preserves inertia; reenabled opposite input reverses motion | No jump/landing controller; Kirby shape lookup cannot accept world position as tile index |
| [DB input → Minish equipment → MZM hit](action/README.md) | Wrong equipment or disabled input vetoes damage; matching held input admits caller-supplied contact | Contact is injected; held input accepts another hit without a new press |
| [Aria acquisition → Emerald order](progression/README.md) | Acquired availability authorizes a novel tactical action that swaps both action/battler lanes together | Novel permission is authored; source cast and battle scheduler absent |
| [Minish learning/refresh → Emerald order](progression/README.md) | Learning then refresh enables that tactical action; revocation then refresh denies it | Stale cache and duplicate confirmed delivery require explicit runtime policies |
| [Tekken contact → Wario protection → FFVI HP](combat/README.md) | Protected bodies separate while HP stays intact; unprotected contact damages and lethal contact queues KO | Physical collision repurposed as authored hazard; pending KO is not settled defeat |
| [Tekken contact → Wario protection → MZM reaction](combat/README.md) | Accepted hit leaves reaction17 until eligible prepass →16; live behavior is suppressed | Terminal target still accepts recontact; species death/drop/retirement absent |
| [SMA1 checkpoint → SMA4 camera](world/README.md) | Restored checkpoint moves camera while stale actor produces screen(-80,-44); explicit authored rebuild centers it | Demonstrates incoherent source-only recovery, not recovered scene reentry |
| [SMA2/SMA4 patrol → camera/relative side](world/README.md) | Player passing actor yields screen4,2,0,-2 and side1,1,0,0 from the same bounded world | Numeric bridges are authored host code; connected graph refuses unproved encoding/width conversion |

These are generated recovered source functions plus explicitly authored adapters, association and scheduling. Some graphs admit a linear component inventory; that does not admit the conditional host policy. World's independently admitted components do not form an admitted connected numeric graph. None has a rendered control/objective/restart/session loop. We tested routes toward playable combinations, encountered the blockers below, and stopped at the demonstrated subsystem tier.

## Failures that determine the next work

1. **Runtime policy can be wrong while bindings pass.** Actual bad schedules swap battle order without valid availability: Aria enable before acquire; Minish cached skill after revocation. Correct action-boundary checks pass. Consumer-first component ordering still structurally admits. [Retained counterexamples](progression/README.md).
2. **Terminal and event identity are missing.** Independent persistent combat probe admits a new collision against HP0 and resets reaction16→17. Minish refresh itself works, but the same confirmed exchange delivered twice swaps both lanes twice back to original order. This needs a declared retry/edge policy, not a changed source swap. The suspected stale Tekken contact bit was disproved: source clears it when disabled. [Independent probes](playtest/README.md).
3. **Terrain and recovery services remain actual source/runtime gaps.** A world Q8 coordinate is not a Kirby tile-local shape index. Checkpoint integer restore leaves fixed-point actor backing stale. Source scene initialization, terrain lookup/resolve/writeback, action lifetime and death settlement cannot be supplied by a binding annotation.
4. **Numeric interoperability needs explicit proofs.** Signed-encoding and storage-width rejections are retained. Positive-domain floor/multiply bridges are exact under their declared guards, but currently live outside accepted graph adapters. They do not establish negative-world behavior or source actor equivalence.

The first reusable tooling deliverable should be a **bounded graph conditional/phase contract with runtime invariant hooks**, using the existing Composer branch codegen. It should state which canonical state is refreshed before an action, which event authorizes it, and which invariants must hold before/after each phase. This removes uninspectable caller gates and exposes wrong schedules. It does **not** implement terminal exclusion, idempotency, source protection ageing, death/KO settlement, terrain or scene reconstruction; those remain explicit domain handlers. Guarded numeric adapters are the next independent seam, preserving source/target quantities, frame, signed encoding, range and rounding.

## Graphics transfer actually tried

Three [offline presentation probes](presentation/REPORT.md) use real private assets with an authored renderer/trajectory:

- MZM recovered tiles, palette, OAM pieces and animation timing reconstruct five sprite frames and mirror them around the asset pivot; all five exact RGBA byte checks pass.
- Emerald and FireRed source walking sheets reuse the parsed 32-tick south gait and the same explicitly authored crop-bottom anchor. This supports pose-to-asset rebinding; movement/collision/gamefeel remain untested.
- Complete primary tile/metatile/palette closures reconstruct coherent source features. Replacing Emerald's raw tile slots with FireRed pixels corrupts them: 14,618 changed pixels across the first64 metatiles. Transfer needs semantic metatile/palette/attribute mapping, not same-index substitution.

![Source closures and failed raw tile-slot transfer](/Users/shishirtandale/Projects/gameverse.ai/local/re/experiments/20261016-presentation-probes-verified/03-metatile-closure.png)

The [33-game inventory](presentation/inventory.md) found existing successful capture summaries for all33 and 4,492 retained keyframes. Captures include attract/frontend/gameplay phases and are evidence samples, **not full-game style coverage**. Loaded-asset tracing/decoding currently covers only three games and observed BIOS LZ77 paths; it does not cover every compression, DMA/raw copy or palette upload. Source-media suffix counts in eight repositories are not verified complete art packs. No universal recovered renderer or complete style transplant is claimed. [Independent visual/provenance review](presentation-independent-review.json) verifies33 source/output pins and inspected the three outputs.

## Cost, limits and verification

Latest measured local script walls: action0.222s; initial progression pair0.306s plus separate deliberate bad-schedule probes0.116s/0.105s; combat0.414s; world0.224s. Independent combat/progression probes took0.181s/0.122s. Verified offline graphics run took0.061s; its first0.085s run is retained after strengthening an alpha-only image assertion to exact bytes. These are separate operation durations, not round elapsed time or a performance improvement. Nested build/execution times are recorded in receipts and must not be added to their totals. Shared runner/queue/CI time and a comparable before/after baseline are unavailable.

Each small host build/execute has finite per-process timeouts and bounded scenarios/ticks. Native/source qualification receipts were reused; zero new native campaigns, ROM builds, dependencies, CI jobs or model calls. Failed attempts and repairs remain retained. Source/host/game tiers, authored glue and missing services are explicit in each lane. Read-only semantic reviews cover [action](combat/action-review.json), [combat](action/combat-semantic-review.md), [progression](world/progression-independent-review.json), [world](progression/world-semantic-review.json), plus the independent temporal probes and graphics review. No unchanged broad suite was repeated.
