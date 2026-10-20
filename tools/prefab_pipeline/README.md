# Reusable prefab pipeline

**Current primary task:** per-game lossless capture, source/IR reconstruction and
evidence-backed like-for-like substitution. Start with the
[roundtrip runbook](../../research/ir-workshop/roundtrip-20261016/RUNBOOK.md) and
[primary handoff](../../research/ir-workshop/reusable-pipeline-20261016/HANDOFF.md).
The native mashup/mod recipes below are frozen historical checkpoints; do not
resume campaigns or add mashup features from this guide. Raw capture is not IR
recovery, and exact bytes do not establish closed interchangeable prefabs.

The separately supported local native improvement seam is documented in
[Native improvement API v1](../../contracts/IMPROVEMENT_API.md), including the
R3 agent client, two-recipe catalog, missing-input discovery and candidate-only
limits. It does not expose arbitrary natural-language game generation.

Run from the repository root with Python 3 and the standard library. The unified
entry point delegates to extraction, contract validation, composition and the
registered backend; it does not infer missing lifecycle or engine closure.

Start with the [durable learning/runbook](../../research/ir-workshop/reusable-pipeline-20261016/LEARNINGS.md)
and its [pinned reproducibility index](../../research/ir-workshop/reusable-pipeline-20261016/reproducibility-index.json)
before a new request. They retain the source hook, canonical state, fixture-readiness
and source-build verification lessons, including failed approaches and exact limits.

## Build a mod and iterate with the decision agent

The connected Soulstride candidate builds through the same public route:

```sh
python3 -m tools.prefab_pipeline build-mod --request tools/prefab_pipeline/requests/aria-soulstride.json --output-dir local/prefab-mods/aria-soulstride-next --output local/prefab-mods/aria-soulstride-next/result.json
```

The retained actual iteration used the command below. Later shared-mechanism
changes make its configuration historical; a fresh iteration needs a reviewed
new configuration with current pins. Preserve the historical configuration.
The public preparation command validates strict request pins, derives its host
from the plan, refreshes declared mechanism/profile inputs, preserves resource
limits and clears old resume/cache lineage. It makes no build or provider call:

```sh
python3 -B -m tools.prefab_pipeline prepare-iteration --request tools/prefab_pipeline/requests/aria-soulstride.json --template tools/prefab_pipeline/requests/aria-soulstride-iteration-repaired.json --run-id aria-soulstride-next --output local/prefab-pipeline/aria-soulstride-next-config.json
```

Pass the new config to `iterate` for a fresh run. The historical actual command is:

```sh
python3 -B -m tools.prefab_pipeline iterate --request tools/prefab_pipeline/requests/aria-soulstride.json --config tools/prefab_pipeline/requests/aria-soulstride-iteration-repaired.json --output-dir local/prefab-mods/aria-soulstride-iteration-next --output local/prefab-mods/aria-soulstride-iteration-next/result.json
```

The retained [candidate cartridge](../../local/prefab-mods/aria-soulstride-iteration-002/build-1/native/game.gba)
has SHA-256 `6f52161e9826a16f2f063e452d6b63ef554d4efcce867eece0be418b401b86c8`.
Its [build receipt](../../local/prefab-mods/aria-soulstride-iteration-002/build-1/report.json)
records 0.405609 s total, six hooks and a 5,800-byte payload. Authored lunge,
moving-defeat refund and soul tiers use the original cartridge lifecycle with
typed campaign MP and guarded canonical-player velocity projection. Native
trajectory fixture qualification remains separate. The actual
[iteration result](../../local/prefab-mods/aria-soulstride-iteration-002/iteration.json)
retains 20 successful model responses (12 S1/four accepted, eight S2), 12 actions
and 6,321 total frames including setup in 16.39632 s. MP 80→1, HP 320, XP 0 and
no new soul are partial diagnostics; the
[verified final cartridge](../../local/prefab-mods/aria-soulstride-iteration-002/final.gba)
is available with the same hash. Full connected-loop and campaign qualification
remain unproven.


The first-soul request connects enemy defeat to the original native soul pickup,
homing collection and persistent ability inventory. Its versioned reward
strategy is lowered into the recovered native component, then built into a full
original Aria cartridge. Build the candidate directly:

```sh
python3 -m tools.prefab_pipeline build-mod --request tools/prefab_pipeline/requests/aria-first-soul-hunt.json --output-dir local/prefab-pipeline/first-soul-next --output local/prefab-pipeline/first-soul-next/result.json
```

Or run the short cycle: build the candidate, let the decision agent exercise it
in the actual emulator, diagnose the observed result, and attempt a bounded
repair. The iteration configuration pins the environment, adapter,
mechanism and base ROM and limits attempts, model calls, native frames, wall time
and cost. The fixed stage registry supplies supported build/experiment bindings.
The current provider does not expose billable dollar usage, so actual-provider
configuration uses `cost_usd: null` and relies on explicit model-call/frame/time
limits. A finite dollar cap fails before calling that provider. Billing usage is
unavailable, never recorded as zero. `mechanism_sha256` must match the current
`iteration.py`; moving paths alone cannot identify a loop version.

```sh
python3 -B -m tools.prefab_pipeline prepare-iteration --request tools/prefab_pipeline/requests/aria-first-soul-hunt.json --template tools/prefab_pipeline/requests/aria-first-soul-iteration-current.json --run-id aria-first-soul-next --output local/prefab-pipeline/aria-first-soul-next-config.json
python3 -B -m tools.prefab_pipeline iterate --request tools/prefab_pipeline/requests/aria-first-soul-hunt.json --config local/prefab-pipeline/aria-first-soul-next-config.json --output-dir local/prefab-mods/aria-first-soul-iteration-next --output local/prefab-mods/aria-first-soul-iteration-next/result.json
```

`--resume` reads that attempt directory's checkpoint. Terminal results are
idempotent; an interrupted stage with unknown usage blocks safe replay instead
of silently charging another model call. A missing registered experiment or
unsupported modification produces an inspectable blocker. The full cartridge is
available as soon as cheap input/edit/integrity checks pass; its exact path and
hash are written to the attempt directory's `iteration.json` before model play.
Partial bot observations, timeouts and repair diagnostics do not hide that
artifact. The result distinguishes artifact availability from objective and
campaign qualification. The iteration's bounded experiment reports what the
agent actually observed; further qualification is separate work.

The newest retained eleven-species cartridge is
[`game.gba`](../../local/prefab-mods/aria-first-soul-hunt-eleven-001/native/game.gba),
SHA-256 `d33d50e69ad27a2e6a9f55c0173ba5f773707f1b7c8f7c1d3c2e0c8b41acf68d`.
Its [`build report`](../../local/prefab-mods/aria-first-soul-hunt-eleven-001/report.json)
records six hooks and a 4,936-byte payload: 0.348052 s total, including 0.034765 s
strategy lowering and 0.313138 s native build. The current iteration template
above supplies the eleven-species request and reviewed mechanism paths for
`prepare-iteration` to refresh. The fresh generated configuration has not been
executed; the retained model observations below belong to the earlier immutable
one-species cartridge.

The first retained iteration produced
[`final.gba`](../../local/prefab-mods/aria-first-soul-iteration-001/final.gba),
SHA-256 `16315529148c2eb448f4302e70a98e523cd1e108b076d7a7b59b7c0629fb9b80`.
Its [`iteration.json`](../../local/prefab-mods/aria-first-soul-iteration-001/iteration.json)
records `artifact-built-with-diagnostics`: the candidate was available after a
0.334989 s build. The complete recorded attempt took 2.142564 s, including the
native fixture and two attempted provider requests. Both requests failed in
transport, with zero completed model inferences; this run therefore supplies
diagnostics and an available cartridge, not evidence that DecisionAI played it.
The report retains 5,801 native frames and unavailable dollar billing. This exact
artifact snapshot targets the first Zombie soul (species 1); later strategy
edits do not change the retained cartridge or extend its coverage.

The successful provider retry's
[`iteration.json`](../../local/prefab-mods/aria-first-soul-iteration-002/iteration.json)
and [`experiment.json`](../../local/prefab-mods/aria-first-soul-iteration-002/experiment-1/experiment.json)
reuse that exact one-species cartridge and checkpoint without rebuilding. In
3.210669 s, it completed 12 System 1 responses (11 accepted) and one System 2
response, then executed 12 native actions: 288 frames plus one render frame.
Dollar billing remains unavailable. The agent traversed the game; HP fell from
320 to 313, XP remained 0 and no new soul was acquired. These are useful partial
diagnostics. The cartridge remains available with `artifact-built-with-diagnostics`;
objective completion was never an artifact-delivery gate. The earlier transport
failure remains retained in run 001. Historical run configurations are preserved;
use the `-current.json` template with `prepare-iteration` for a fresh run against
current mechanisms.

## Extend a prefab phase from an agent request

The Minish caller verifies the actual base graph, target graph, descriptor and
lifecycle-adapter file hashes, extends the existing graph through the shared
lifecycle API, validates the resulting assembly, and persists the graph, module
and receipt. Use a new attempt directory:

```sh
python3 -m tools.prefab_pipeline phase-extend --request research/ir-workshop/reusable-pipeline-20261016/phase-lifecycle/minish-request.json --output-dir local/prefab-pipeline/minish-phase-next --output local/prefab-pipeline/minish-phase-next/result.json
```

The actual public caller's
[`agent-result.json`](../../research/ir-workshop/reusable-pipeline-20261016/phase-lifecycle/agent-result.json)
pins the persisted
[`extended graph`](../../research/ir-workshop/reusable-pipeline-20261016/phase-lifecycle/agent-attempt-01/extended-graph.json).
The separate
[`host result`](../../research/ir-workshop/reusable-pipeline-20261016/phase-lifecycle/agent-host-result.json)
executes the resulting source behavior with retained nonzero bank/cache state.
This is an explicit state fixture and L1 host proof; native ROM parity and player
save migration are outside its demonstrated scope.

## Modify a full original ROM

The supported vertical slice uses the existing qualified Aria enemy-defeat prefab
and changes its XP multiplier through the native IR hook. The backend owns input
pin checks, bounded compilation and proof of the modified ROM. Use a fresh output
directory for each attempt:

```sh
python3 -m tools.prefab_pipeline mod-rom --request tools/prefab_pipeline/requests/aria-double-xp.json --output-dir local/prefab-pipeline/aria-double-xp-001 --output local/prefab-pipeline/aria-double-xp-001/result.json
```

The result file records the backend's exact artifact/evidence references. This is
a scoped modification of the original game, not recovery of the full game into
L2 IR. Unsupported requests fail visibly.

The actual successful public CLI run is retained at
[`final.gba`](../../local/prefab-mods/aria-double-xp-20261016-01/final.gba),
with [`report.json`](../../local/prefab-mods/aria-double-xp-20261016-01/report.json)
and the CLI [`result`](../../local/prefab-mods/aria-double-xp-20261016-01-result.json).
It took 6.525905 s total on the recorded macOS ARM64 machine: parity payload
build 0.182968 s, modified payload build 0.166117 s, native original/parity/modified
play 1.995227/1.880237/1.894900 s. Those stages are nested in the total. Both builds
were clean with no build cache. A fresh 14,720-vector instruction comparison
passed; native gameplay observed original/parity/modified XP of 1/1/2. The bounded
6,400-frame corridor does not establish full-campaign qualification.

The Aria input is an existing manually reconstructed/self-decompiled
`component_package`, not automatically recovered L0→L1. Historical qualification
plan-pin mismatches remain explicitly recorded; current instruction and gameplay
witnesses were executed afresh.

| Backend | Actual result | Remaining boundary |
| --- | --- | --- |
| Native prefab mod builder | Eleven-species soul-hunt cartridge available; real agent traversal retained for earlier one-species cartridge | No new soul observed in the partial model traversal; eleven-species model experiment not run |
| `native-rom-patch` | Aria XP 1→2 in a full original cartridge | Only the declared defeat-reward request and bounded corridor qualified |
| `source-engine-import` | Emerald/FireRed source preparation receipt, 101 blockers | No qualified merged ROM; namespaced IDs, data ABI, native service graph, persistent save capacity and lifecycle qualification remain |
| `portable-ir` | Recovered descriptor/capsule inventory | No general full-ROM backend or inferred lifecycle closure |

## Extract, plan and execute

```sh
python3 -m tools.prefab_pipeline extract --game pokemon-emerald-version --game pokemon-firered-version --game kirby-nightmare-in-dream-land --cache-dir local/prefab-pipeline/cache --max-files 512 --max-bytes 33554432 --max-requests 16 --output local/prefab-pipeline/extraction.json
python3 -m tools.prefab_pipeline plan --request request.json --extraction local/prefab-pipeline/extraction.json --output local/prefab-pipeline/plan.json
python3 -m tools.prefab_pipeline execute --plan local/prefab-pipeline/plan.json --output-dir local/prefab-pipeline/attempt-001 --allow-execute --output local/prefab-pipeline/attempt-001/result.json
```

`extract --source-receipt PATH` can be repeated to include pinned existing
`whole-source-build/1` receipts. Descriptor inventory alone is not a supported
complete source-engine input. `plan --extraction` selects all candidates in the
report; omit it and supply an explicit `request.prefabs` array for selected
capsules. A request declares `target: "gba"`, `mode: "prepare"` or
`"qualified-build"`, `limits: {"jobs": 2, "timeout_s": 300}`, and explicit
`save_policy: {"mode": "fresh"}`. Backend source contracts determine support.

Planning records all blockers and returns exit status 2 for blocked work.
Preparation may produce inspectable evidence but cannot qualify a runnable ROM.
`execute` requires `--allow-execute` because it launches the registered bounded
backend. Missing/stale pins and unsupported heterogeneous backends fail closed;
Aria's specific original-ROM modification route does not imply a general portable
IR ROM compiler.

The recorded planning demonstration lives in
`research/ir-workshop/reusable-pipeline-20261016/demo/`. Its cold/reuse timings
cover extraction and planning only. No manual-labor speedup or ROM-build speedup
is inferred. Focused CLI verification takes milliseconds:

```sh
python3 -m unittest tools.prefab_pipeline.test_cli -v
```

### Private memory asset families and property recipes

`extract --memory-manifest PATH` consumes a repository-relative
`gameverse.gba-memory-ontology/1` manifest under the existing file/byte limits.
Repeat the argument for multiple games. The manifest is pinned in the extraction
cache; no private capture is added to the central catalog. Existing module/package
ownership is joined only through explicit IDs. Unmatched editable tables produce
source-only L0 asset-family capsules with their actual allocation identities,
fields, captured values, bindings and expansion blockers. These capsules do not
claim behavioral IR, a native lifecycle or gameplay qualification. Exact game
variants remain separate (FireRed Rev1 is not silently aliased to Rev0).

```sh
python3 -B -m tools.prefab_pipeline extract --game GAME_ID --memory-manifest PRIVATE_MANIFEST.json --cache-dir local/memory-cache --output local/memory-extraction.json
python3 -B -m tools.prefab_pipeline memory-query --extraction local/memory-extraction.json --uncategorized --output local/memory-unknown.json
python3 -B -m tools.prefab_pipeline memory-query --extraction local/memory-extraction.json --node TABLE_OR_ALLOCATION_ID --output local/memory-dependents.json
python3 -B -m tools.prefab_pipeline property-plan --extraction local/memory-extraction.json --game GAME_ID --table TABLE_ID --rom EXACT_BASELINE.gba --operations OPERATIONS.json --output local/property-plan.json
```

`OPERATIONS.json` contains an `operations` list using the shared compiler request
contract in [GBA_MEMORY_ONTOLOGY.md](../../contracts/GBA_MEMORY_ONTOLOGY.md).
Dependent changes to other tables in the same pinned manifest are accepted.
`property-plan` writes `local/property-plan.request.json` and a complete
`compiler_argv` in the plan, pointing at that request, the exact manifest, selected
ROM and a fresh `local/property-plan.artifacts` directory. Execute that argv with
normal subprocess arguments to invoke the shared compiler. Planning does not read
or modify ROM bytes; compiler admission checks the exact baseline and bounds.
To continue, extract the generated `manifest.json` and plan against its
`candidate.gba`. No source tree is needed for that continuation.

Query edges preserve declared dependency direction: source depends on target;
reverse traversal returns known consumers, not proof of complete impact closure.
Typed table references and compiler bindings are labeled with their declared
confidence. ROM gaps are uncategorized evidence gaps, never allocator free space.
The original partition/component identities, source pins, hardware spaces and
native/semantic unknowns remain available in the game-level memory graph.

The retained two-game local consumer proof is
`local/memory-ontology-20261016/prefab-integration-002/consumer-validation.json`
(with the executed command argv and durations in sibling `receipt.json`). It
actually discovers `firered.icon-palette-family`: 16 RGB555 color fields per
palette, 440 icon pointer rows and 440 species palette indices. Its generated
manifest rediscovery exposes six palette rows instead of three. Species-table
expansion remains blocked by the global enum/save/consumer audit. The MZM family
`metroid-zero-mission.memory.sAnimatedTilesGfx:entry18` exposes 32 captured u32
words per 128-byte frame, with generated manifest rediscovery exposing five
frames instead of four. These are L0 source asset families; their membership
does not establish an interchangeable native gameplay prefab.

The actual source-independent continuation can be inspected or repeated into
fresh outputs from the repository root (the existing proof directories must
remain unchanged):

```sh
python3 -B -m tools.prefab_pipeline extract --game pokemon-firered-version-rev1 --game metroid-zero-mission --memory-manifest local/memory-ontology-20261016/prefab-integration-002/firered-plan.artifacts/manifest.json --memory-manifest local/memory-ontology-20261016/prefab-integration-002/mzm-plan.artifacts/manifest.json --cache-dir local/memory-continuation-new/cache --output local/memory-continuation-new/extraction.json
python3 -B -m tools.prefab_pipeline memory-query --extraction local/memory-continuation-new/extraction.json --output local/memory-continuation-new/families.json
python3 -B -m tools.prefab_pipeline memory-query --extraction local/memory-continuation-new/extraction.json --node gMonIconPalettes --output local/memory-continuation-new/dependents.json
python3 -B -m tools.prefab_pipeline memory-query --extraction local/memory-continuation-new/extraction.json --uncategorized --output local/memory-continuation-new/unknown.json
python3 -B -m tools.prefab_pipeline property-plan --extraction local/memory-continuation-new/extraction.json --game pokemon-firered-version-rev1 --table gMonIconPalettes --rom local/memory-ontology-20261016/prefab-integration-002/firered-plan.artifacts/candidate.gba --operations local/memory-ontology-20261016/prefab-integration-002/firered-followup-operations.json --output local/memory-continuation-new/firered-plan.json
python3 -B -m tools.roundtrip.memory_ontology --manifest local/memory-ontology-20261016/prefab-integration-002/firered-plan.artifacts/manifest.json --rom local/memory-ontology-20261016/prefab-integration-002/firered-plan.artifacts/candidate.gba --request local/memory-continuation-new/firered-plan.request.json --output local/memory-continuation-new/firered-plan.artifacts
python3 -B -m tools.prefab_pipeline extract --game pokemon-firered-version-rev1 --memory-manifest local/memory-continuation-new/firered-plan.artifacts/manifest.json --cache-dir local/memory-continuation-new/rediscovery-cache --output local/memory-continuation-new/rediscovery.json
```

No source code, ELF or map is read by that continuation. Original source/ELF
provenance remains recorded as baseline evidence. The local baseline query
reports three uncategorized ROM spans per game: 16,774,868 bytes for FireRed Rev1
and 8,366,928 for MZM. These are outside the selected captured allocations, not
claims about the rest of either cartridge. Known FireRed reverse impact includes
seven declared palette pointer consumers plus the species-index table. Existing
native gameplay IR candidates are preserved without attaching these assets to
unrelated text or Samus mechanics. The standalone property compiler proof only
establishes typed byte consistency; any native consumer qualification is separate.

### Whole-game composition DSL and bounded static planning

The additive agent CLI imports the existing canonical roundtrip partition and
pinned extraction into `gameverse.whole-game-composition/1`. Partition components
remain the sole ROM address owners. Table overlays, explicit source consumer
edges, and IR/prefab dependency registry references add meaning without assigning
ROM gaps as free space or promoting asset families to native gameplay prefabs.
Unknown behavior and opaque components remain present in the complete tree.

A producer index/receipt can expose current memory families without copying their
payloads into another catalog. `extract --memory-index PATH` accepts an object
with `memory_manifest_refs: [{"path": "repository/manifest.json", "sha256": "FILE_SHA256"}]`.
Repeat it for multiple producer receipts. Indexes and manifests share extraction's
file/byte limits and containment checks. Stale manifest pins are visible gaps and
are excluded. Explicit `--memory-manifest` remains available for local captures.

```sh
python3 -B -m tools.prefab_pipeline extract --game GAME_ID --memory-index PRODUCER_RESULT.json --cache-dir local/composition/cache --output local/composition/extraction.json
python3 -B -m tools.prefab_pipeline composition-import --extraction local/composition/extraction.json --partition CANONICAL_PARTITION.json --game GAME_ID --output local/composition/game.json
python3 -B -m tools.prefab_pipeline composition-query --game-dsl local/composition/game.json --search palette --output local/composition/query.json
python3 -B -m tools.prefab_pipeline composition-query --game-dsl local/composition/game.json --node TABLE_NODE_ID --candidates local/composition/donor.json --max-candidates 32 --output local/composition/search.json
python3 -B -m tools.prefab_pipeline composition-plan --game-dsl local/composition/game.json --partition CANONICAL_PARTITION.json --request SUBSTITUTION_REQUEST.json --output local/composition/plan.json
```

If an extraction has multiple memory manifests for the game, select the exact
canonical manifest hash with `composition-import --memory-sha256 HASH`.
`composition-query --kind KIND` filters node kinds; compatibility search requires
one target node and compares up to 128 same-kind donor nodes, returning each
static classification, blockers and declared adapter requirements from the core.
It never invents adapter implementations. The imported dependency registry carries
existing package interfaces, source/library evidence references and explicit
memory joins. Unmatched memory asset families retain their L0 maturity.

The request schema is `gameverse.composition-request/1`, with `game_sha256` from
the import receipt, `substitutions: [{"target": "NODE_ID", "candidate": NODE_OBJECT}]`,
and bounded `max_candidates` (at most 128). Planning consumes this request through
the core static validator before any build/simulation. It records static wall time;
build and simulation measurements are unavailable because those stages do not run.
An accepted static structure is a planning result, not a runnable artifact or
whole-game qualification. Existing `plan`/`execute` backend admission remains a
separate seam.

For an already emitted property-compiler manifest, direct candidate discovery and
request generation avoid writing a bespoke candidate JSON object:

```sh
python3 -B -m tools.prefab_pipeline composition-query --game-dsl local/composition/game.json --node table:TABLE_ID --candidate-memory GENERATED_MANIFEST.json --candidate-table TABLE_ID --output local/composition/candidate-search.json
python3 -B -m tools.prefab_pipeline composition-plan --game-dsl local/composition/game.json --partition CANONICAL_PARTITION.json --candidate-memory GENERATED_MANIFEST.json --target table:TABLE_ID --output local/composition/adapt-plan.json
```

This route pins the candidate file, retains its ROM and parent-manifest identity,
and returns the generated request in the plan. An evolved same-game candidate
must name the host memory manifest as its parent; cross-game donors remain
conditional static proposals. The exact candidate baseline is checked by the
property compiler before a write. `incompatible` and `unknown` plans return exit
status 2 with the complete plan, before invoking any build or simulation.
Producer index references may have `role: baseline/current/identity/append/repeat`;
all referenced files are pinned, while only baseline/current enter discovery by
default. Explicit `--memory-manifest` selects a continuation capture directly.

The current five-game producer wave is discoverable directly through the bounded
ledger (its producer receipt hashes are checked before their manifest references):

```sh
python3 -B -m tools.prefab_pipeline extract --game pokemon-emerald-version --game wario-land-4 --game legend-of-zelda-the-the-minish-cap --game mario-and-luigi-superstar-saga --game metroid-fusion --memory-index research/ir-workshop/ontology-wave/results.json --cache-dir local/ontology-wave-next/cache --output local/ontology-wave-next/extraction.json
```

`composition-import` also exposes pinned L1 package summaries as unplaced behavior
overlays. Relative state and access patterns retain unknown physical addresses
when no matching validation adapter is supplied. The canonical partition remains
the address authority. Another extracted game namespace is admitted as behavioral
evidence only when its pinned qualification receipt names the exact same ROM hash;
this supports the existing generic FireRed catalog namespace and the Rev1 baseline
without a spelling-based version alias. Source identity alone does not supply
native placement, lifecycle closure or gameplay equivalence.


### Bounded behavior-system adapter requests

Source-pinned `behavior-system` nodes add lifecycle, input, state, side-effect,
phase, condition, notification and native-service declarations to the ownership
DSL. Source/entry placement edges preserve canonical byte ownership. These
semantic overlays retain unknown native effects; they do not make an L1 package
or a matching state layout portable.

The separate behavior preflight resolves exact host/donor record references and
pins explicit semantic mappings plus an adapter recipe. It emits missing
contracts, resolved source evidence and native adapter obligations. Complete
source declarations remain `unknown` until backend/consumer qualification;
flags and a successful static process cannot override those obligations.

```sh
python3 -B -m tools.whole_game_composition.behavior --host HOST_NODE.json --donor DONOR_NODE.json --mappings MAPPINGS.json --recipe RECIPE.json --request-id RUN_ID --output local/behavior-preflight-new
python3 -B -m tools.roundtrip.behavior_adapter capture-request local/behavior-preflight-new/request.json . local/behavior-capture-new
python3 -B local/behavior-capture-new/behavior_adapter.py build local/behavior-capture-new local/behavior-build-new --deny-source-reads
```

These commands use fresh directories and a recipe supported by the bounded
backend. `capture-request` verifies request, node and recipe identities and
captures the referenced IR, adapter, compiler, generator, opaque host and evidence.
The backend requires explicit typed state/service mappings, scheduler/callback
guards, ownership/reset/reentry/restore/save policy and guarded installation
preimages/resource limits. It generates the native adapter from captured records;
unsupported mappings or resource references fail visibly. Source-independent
replay and native consumer gameplay proof are separate results. Build success
keeps native play, open service effects and whole-game closure unproved; pinned
feedback can be attached to the exact behavior nodes without changing those
claims. See [the composition contract](../../contracts/WHOLE_GAME_COMPOSITION.md#bounded-behavior-system-requests)
for schemas, scope and timing receipts.
