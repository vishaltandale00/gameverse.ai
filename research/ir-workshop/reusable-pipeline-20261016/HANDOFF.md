# Primary handoff: reconstruction and the native improvement engine

The active reconstruction wave covers **all 33 games**, not a default return to
MZM. Start with the execution owner's [33-game dispatch](../coverage-wave-next/dispatch.json),
[frozen admitted lane results](../coverage-wave-next/lane-results.json) and
[all-game source inventory](../coverage-wave-next/INVENTORY.md). Dispatch is work
ownership/status; only producer receipts plus independent QC establish completed
output. The frozen producer ledger covers **15 QC packets / 13 installed scoped research
candidates: 2,420 behavior + 2,766 binding bytes**, 11 new source roots and 16
prior roots reinstalled. PMD plus two alternative MMZ domains add **6,174 emitted
behavior bytes outside ROM only**, not installed credit or one cartridge.
The producer ledger SHA-256 is `c200b38f1c205d0bdf3eff565123371f7ab9c82f74f9be0debe7bf4f6acd53fd`.
The separately frozen [central/discovery v2 receipt](../../../local/ir/ir-coverage-publication-20261016/coverage-next-final-review-v2.json)
now records 183 packages / 171 catalog roots and 21 capability records / 19
owners. Production extraction validates 56 capsules across 15 games; the actual
plan remains blocked on backend/closure/dependency gaps. Ready variants/modules
stay 29/20, with zero new interchangeable prefabs. This does not mutate the
frozen producer ledger. The earlier v1 central receipt is retained and superseded
only by added failure history/implementation pins. DBA remains ineligible for general composition;
SMA4 is qualified only for its explicit projected-RAM / low-16-bit-R2 domain.
The [runbook broad-wave section](../roundtrip-20261016/RUNBOOK.md#broad-33-game-reconstruction-wave)
keeps actual commands, source-root accounting, typed-data limits and next owners.
None of the 33 games currently has complete executable-IR/identified-asset closure;
unsupported whole-game semantic denominators remain unknown, not zero.

The current user objective supersedes mashup expansion: **mine each original
ROM/source into a full component, IR/prefab and dependency library; reassemble the
original mostly byte-accurately; then justify like-for-like substitutions**.
Originals remain immutable. Soulstride, Sonic/Metroid and the Pokémon mashup are
frozen at bounded checkpoints. Do not resume their old model/campaign/feature
queues merely because their commands remain in historical docs.

Reviewed generic reconstruction tooling is published in [PR12 source head `aa687860`](https://github.com/vishaltandale00/gameverse.ai/blob/aa68786040deec2f914fccc909bd421db388a5a7/contracts/RECONSTRUCTION_TOOLING.md), with code-only metadata summaries.
Original-derived IR, assets, ROMs and snapshots are not published. This is a
helper subset: the complete public source→IR producer frontend and optional ARM
path are not included; external compatible admission helpers remain prerequisites.
The local discovery-loader compatibility fix independently passes scoped review;
its public frontend is explicitly excluded from this metadata-only follow-up.
The final metadata-only [central summary](https://github.com/vishaltandale00/gameverse.ai/blob/68de7ae8cd9dda74a7a212d2abf0dbd3a8abfaef/verification/central-discovery-wave-20261016.json)
and [tooling guide](https://github.com/vishaltandale00/gameverse.ai/blob/68de7ae8cd9dda74a7a212d2abf0dbd3a8abfaef/contracts/RECONSTRUCTION_TOOLING.md)
are published at `68de7ae8cd9dda74a7a212d2abf0dbd3a8abfaef`; the earlier generic-source
package remains `aa687860`. No public extractor/full producer frontend is implied.

The prior native-engine integration is **[PR 12](https://github.com/vishaltandale00/gameverse.ai/pull/12)**,
head `30167a197481c7537cc36d369dd4e7e2d2f6e42c`, still a draft. It now includes the DecisionAI S1/S2 testing bot, bounded native
iteration, checkpoints/learning-context continuation and reviewed causal repair.
The earlier `8c95e007` build-only handoff excluded that bot; that statement is
historical and no longer describes the PR head.

The source-quest/campaign and RPG-navigation wave is now published at that head.
The publisher reports all fetched review defects source-inspected clear, with
retained review-fix evidence; this does not qualify an unrun quest. See [the reusable playtest architecture](PLAYTEST_ARCHITECTURE.md)
for memory-grid BFS, D1/S2, battery/checkpoint, milestone and mod-quality
boundaries. The proposed new Sonic model prefix did not launch and used zero
provider calls; authorization review blocked it before execution. Model work has
since been explicitly reauthorized. The final original-ROM RPG campaign is
**partial at source stage four**, with four battle observations, **34 successful
calls** (nine D1 / 25 S2), 6,200 play / 7,893 total native frames and 60.162394 s
worker time. Zero-use cancellation before an experiment followed by a new
controller preserves exact checkpoint/learning/source facts without replaying
startup. Pair-battle win/stage five and gym/stage six are unobserved. The current
100-call allowance is exhausted; including the separately authorized v1 prefix,
all RPG work totals 120 calls / 28,897 frames / 237.136083 s including failures
and duplicate work. API and model workers are stopped; no further waves.
The final commit adds only receipt/docs atop executed source `96c5566`.
Older real model receipts below
remain separate evidence.

The [final RPG qualification receipt](https://github.com/vishaltandale00/gameverse.ai/blob/30167a197481c7537cc36d369dd4e7e2d2f6e42c/verification/rpg-final-qualification-20261016.json)
preserves the full ledger, cancellation continuity and remaining coverage.
The earlier D1 HTTP 413 failures were resolved by a lossless context fix and
four targeted HTTP-200 rechecks; the unchanged confidence gate rejected all four
low-confidence answers. Neither those checks nor battle presence prove a win.

Use the immutable [Vishal engine handoff](https://github.com/vishaltandale00/gameverse.ai/blob/30167a197481c7537cc36d369dd4e7e2d2f6e42c/contracts/IMPROVEMENT_HANDOFF.md),
[API contract](https://github.com/vishaltandale00/gameverse.ai/blob/30167a197481c7537cc36d369dd4e7e2d2f6e42c/contracts/IMPROVEMENT_API.md) and
[verified HTTP receipt](https://github.com/vishaltandale00/gameverse.ai/blob/30167a197481c7537cc36d369dd4e7e2d2f6e42c/verification/improvement-full-engine-http-20261016.json).
The authoritative engine code is the published isolated checkout; it has not
been wholesale mirrored into this research workspace. Run its commands from the
PR checkout, not from an assumed identical local tree.

The corrected actual HTTP chain used **34 real calls** (25 S1, eight play S2,
one diagnosis), **12,535 native frames** and **25.117548 s worker execution**.
After a server restart, exact-ROM/state/model-context continuation observed the
controlled one-pixel lunge, made one model-selected registered repair, rebuilt a
new ROM and observed the three-pixel native objective from its fresh fixture.
The prior 47-call chain failed provenance validation despite observing its
objective; its evidence/cost remains retained. Both chains total 81 calls and
25,214 frames. This is a declared finite repair fixture, not a naturally found
defect, arbitrary source repair, full-campaign or model-accuracy qualification.
R3 voice UI end-to-end, player activation and save migration remain untested.

The API retains `native-mod` for the original Double-XP/Soulstride recipes and
adds `native-improve` with the separate `aria-soulstride-controlled-lunge` recipe
and `aria-soulstride-iteration` profile. Original Soulstride is still build-only
when invoked as `native-mod`. IR reconstruction remains a separate research
CLI/provider capability, not a new API operation or promised private PR payload.

The current IR-first follow-up accepts a separate identified asset/data bundle.
Keep regenerated IR, binding, captured assets, retained native code, mixed/unknown
spans and gaps distinct, with source/range/hash/dependency provenance. Existing
whole-ROM parity is mixed-stratum parity; it does not make all game logic IR.
Private artifact replay proves `rebuild_only`; a separate fresh three-module
IR-bundle replay independently passes for the unchanged qualified packet:
322 behavior + 240 binding + six alignment bytes plus 24 fresh veneers, with
8,388,584 mixed host bytes explicitly retained. No whole-game IR claim follows. Existing PR artifacts remain a separate shipment.

Read the [current runbook](../roundtrip-20261016/RUNBOOK.md),
[pinned reproducibility index](reproducibility-index.json) and the [33-game inventory](../roundtrip-20261016/game-inventory.json) /
[next queue](../roundtrip-20261016/QUEUE.md).
The [prior pipeline learnings](LEARNINGS.md) preserve useful hook/state/build
lessons and historical recipes; they are not the current task list.

The completed [source-library publication](../../../local/ir/ir-coverage-publication-20261016/final-review-02.json)
now contains 170 central packages and five capability groups. Actual five-game
production extraction validates 14 capsules and discovers each group once;
composition correctly remains blocked on unresolved closure/dependency/backend
obligations. No new interchangeable prefab is promoted. The [runbook discovery recipe](../roundtrip-20261016/RUNBOOK.md#published-source-library-discovery)
keeps those commands and actual costs separate from native qualification.

## Actual current baseline

- [Current MZM object/source manifest](../../../local/roundtrip/mzm-object-source-v3-20261016/manifest.json):
  exact 8,388,608-byte reconstruction in 734 components: 728 object-captured
  spans/7,900,171 bytes, one fresh source function/104 bytes and five opaque
  spans/488,333 bytes. The 672 ownership groups are scaffolding; semantic closure
  stays unknown throughout. [Total timing](../../../local/roundtrip/mzm-object-source-v3-20261016/timing.json):
  0.729703 s, including warm one-TU source compile/link 0.384908 s. Equivalent
  v2 was 2.654234 s before caching one original digest per extraction.
- [Independent v3 comparison](../../../local/roundtrip/mzm-object-source-v3-20261016/independent-comparison.json)
  passes raw equality with 734 valid parts, zero masks, 0.016669 s;
  the earlier [one-byte mutation](../../../local/roundtrip/mzm-source-20261016/negative-source-component.json)
  fails. Raw header/tail negatives also remain retained. Comparator equivalence
  masks require explicit owner evidence, never erase raw deltas and do not
  certify whole-game semantics.
- `tools/roundtrip/contracts.py` validates identity/dependency evidence. Identity
  replacement admission passes; semantic closure remains unknown. Opaque/raw/
  object capture is not source or IR regeneration, and byte identity is not a
  closed portable prefab.
- [Aria retained-host provider](../../../local/roundtrip/aria-native-parity-001/provider-report.json):
  actual 0.856534 s build/fresh 14,720-vector proof/artifact-only reconstruction.
  Raw original equality is false (8,388,616 differences including append/fill);
  reconstructed compiler-artifact equality is true.
  [Independent certificate comparison](../../../local/roundtrip/aria-native-parity-001/independent-certified-comparison.json)
  admits only the finite native scope; `whole_game_equivalent` stays `null`.
  [Independent admission checks](../../../local/roundtrip/aria-native-parity-001/contract-admission-checks.json)
  admit the bounded substitution and reject six negative controls. Two opaque
  hosts remain open; no portable or whole-game equivalence. Its native component
  is existing hand-recovered C (`self_decompilation`), not automatic Behavior
  IR→C regeneration; IR-regenerated bytes stay zero.
- [Emerald whole-cartridge capture](../../../local/roundtrip/emerald-elf-20261016/manifest.json):
  exact 16 MiB/1,174 components, 12,207,236 object-captured bytes and 4,569,980
  opaque bytes, 883 ownership scaffolds, zero regenerated bytes. Existing exact
  ELF/map reused without compiling; total 1.041934 s, separate QC 0.127126 s.
- [FireRed Rev1 result](../roundtrip-20261016/firered/result.json): exact fleet
  identity `dd594...` / SHA-256 `729041...`, 16 MiB/958 components, object-captured
  8,781,824 bytes and opaque 7,995,392 bytes, 690 ownership scaffolds, zero
  regenerated bytes. Isolated build 41.978179 s includes 40.206269 s compilation;
  subsequent roundtrip 0.773963 s. Rev0 `41cb...` evidence remains separate.
- **Current MZM dependency-linked IR group:** [acquisition + events report](../../../local/roundtrip/mzm-ir-equipment-events-20261016/provider-report.json)
  and [independent QC](../../../local/roundtrip/qc-review-20261016/mzm-ir-equipment-events-qc.json).
  Four fresh 4,096-vector proofs give 16,384 bounded native comparisons;
  14 source call edges share canonical native state. Generated output is
  292 behavior + 148 binding + 4 alignment bytes, with 459 raw differences.
  Provider 1.526591 s / independent QC 0.228581 s. The original EventFunction
  oracle compared low eight bits; a separate [full-R0 supplement](../../../local/roundtrip/mzm-ir-equipment-events-u32-return-20261016/receipt.json)
  now passes 8,192 bounded original/rebuilt comparisons, independently reviewed.
  A [15-module dependency supplement](../../../local/roundtrip/mzm-ir-equipment-events-compiler-deps-20261016/receipt.json)
  statically reproduces exact L1/C and explicitly records its retrospective scope.
- Separate Pokémon IR candidates pass generated-output QC:
  [Emerald](../../../local/roundtrip/qc-review-20261016/emerald-ir-20261016-002-snapshot-fixed-qc.json)
  has 44 behavior + 148 binding bytes (207 raw differences);
  [FireRed Rev1](../../../local/roundtrip/qc-review-20261016/firered-rev1-ir-20261016-002-snapshot-fixed-qc.json)
  has 52 behavior + 96 binding + 4 alignment (166 differences). These and MZM
  are small native-backed IR groups with open host/lifecycle dependencies,
  not three whole games rebuilt from IR. Synthetic native proof is not campaign play.
- Exact whole-ROM captures retain zero IR-regenerated source-span coverage; do not
  mix them with the separate generated candidates. Metadata repairs preserved
  earlier reports/failed QC/native bytes; original provider-script identity was
  unavailable and current verification recipes are snapshotted. The runbook
  gives precise provenance, proof scope and narrow reproduction commands.

## New source-library artifacts

The [runbook's later wave](../roundtrip-20261016/RUNBOOK.md) records exact byte
accounting, commands and QC for the new artifacts:

- [MZM statue consumers](../roundtrip-20261016/mzm-ir/README.md): three installed
  consumer entries, 322 behavior bytes/568-byte payload, 590 raw differences.
  Acquisition/event service entries stay original in this ROM; the earlier
  two-entry cartridge remains separate. 24,576 native comparisons and a separate
  68-case borrowed-sprite fixture pass; actual SpriteUpdate/natural admission are open.
- [Emerald item metadata](../roundtrip-20261016/wave2/emerald-items/result.json):
  two new getters plus reused clamp, 62 behavior bytes and 33,090 captured asset
  bytes in the 33,214-byte payload; 33,237 raw differences. Independent QC passes.
- [Wario asset-backed action60](../roundtrip-20261016/weak-coverage-wave/wario-land-4/README.md):
  96 behavior + 80 binding + 3,061 readonly asset bytes, 3,245 raw differences;
  1,024 original/1,024 installed comparisons pass. Existing function coverage,
  newly installed artifact; no attachment-lifecycle closure.
- [MMZ profile-2 candidate](../roundtrip-20261016/weak-coverage-wave/megaman-zero/installed-result.json):
  initializer/producer installed and finite same-actor proofs pass, but **general
  replacement eligibility is false**. There is no runtime profile guard or
  all-live-caller proof. Do not activate it as the accepted game.

## Working reconstruction recipe

Run from the repository root with new output paths:

```sh
python3 -m tools.roundtrip mzm-source-roundtrip --source 'local/roms/Metroid - Zero Mission (USA).gba' --source-tree local/game-builds/mzm-us-baseline --output local/roundtrip/mzm-object-source-next --game-id metroid-zero-mission
python3 -B -m tools.prefab_pipeline.reconstruction_compare --manifest local/roundtrip/mzm-object-source-v3-20261016/manifest.json --layout local/roundtrip/mzm-object-source-v3-20261016/layout.json --original 'local/roms/Metroid - Zero Mission (USA).gba' --rebuilt local/roundtrip/mzm-object-source-v3-20261016/rebuilt.gba --output local/roundtrip/mzm-source-independent-next.json
```

The [runbook](../roundtrip-20261016/RUNBOOK.md) explains artifact-only reassembly,
strata, contracts, mask admission, timing and owner queue. This handoff does not
instruct a new build, test, emulator run or model campaign during documentation.

## Frozen evidence worth retaining

| Prior track | Latest bounded result; do not resume it as the primary task |
| --- | --- |
| Soulstride | [Final cartridge](../../../local/prefab-mods/aria-soulstride-iteration-002/final.gba), SHA-256 `6f52161e9826a16f2f063e452d6b63ef554d4efcce867eece0be418b401b86c8`; 16.39632 s actual loop/20 model responses/12 actions. [Input-only cast/next-tick motion](../../../local/prefab-mods/soulstride-input-motion-001/report.json) and [nine-case reward fixture](../../../local/prefab-mods/soulstride-reward-fixture-001/report.json) add bounded native/policy evidence, not pickup/campaign completion. |
| Sonic/Metroid | [Delivery](../../../research/deep-extraction/sonic-metroid/delivery.json), exact new ROM `50757987593917bddafe6b32c3355cb9af32d899468850af69115bad59f3d855`; scripted native prefixes and two actual bounded model traversals retained. Iteration 002 detected one source-defined barrier and tried jump actions; no route completion. Historical 720-frame movement demo is separate. |
| Pokémon single ROM | [27-stage merge](../../../local/whole-game-mashup/emerald-firered/single-rom/20261016T173930Z-87585bfe12e4/merge-receipt.json) compiled all TUs but failed linking. [Complete inventory](../../../local/whole-game-mashup/emerald-firered/single-rom/20261016T173930Z-87585bfe12e4/link-undefined-inventory.json): **835 unique missing symbols/4,491 references**. Early capped receipt counts were incomplete. No combined ROM/ELF; current later-stage registry unrun. |
| Pokémon eclectic | [Frozen handoff](../pokemon-eclectic-20261016/handoff.json) pins authored request/lowerer/source evidence; source-ready checks only, no resulting ROM or native/model gameplay. |

Failed attempts, wrong-caller and locked-fixture diagnostics, false-baseline patch
failure and capped linker findings remain immutable historical evidence. New
reconstruction work should reuse their lessons without inheriting their scope.
