# Whole-game composition DSL and static compiler

`tools.whole_game_composition.core` implements a dependency-free JSON object tree
plus reference graph. It represents the **entire original ROM at its existing
ownership grain**, including opaque code and assets. It does not imply that the
entire game's behavior has been understood, translated to IR, or made portable.
This is a loop-side search/preflight representation, not a replacement for the
base-game environment, native backend, or accepted-version activation contract.

## Pinned document

Schema `gameverse.whole-game-composition/1`:

```json
{
  "schema": "gameverse.whole-game-composition/1",
  "game_id": "example",
  "rom": {"sha256": "64 lowercase hex digits", "size": 512},
  "partition": {"canonical_sha256": "canonical JSON hash", "ref": "existing manifest reference"},
  "memory": {"canonical_sha256": "canonical JSON hash", "ref": "existing memory capture reference"},
  "nodes": [
    {"id": "game", "parent": null, "kind": "game", "contract": {"scope": "whole-game"}},
    {"id": "component:engine", "parent": "game", "kind": "component", "component_ref": "engine", "contract": {"scope": "native-component"}},
    {"id": "table:palette", "parent": "game", "kind": "asset-table", "memory_table_ref": "palette", "contract": {"scope": "typed-data-layout"}}
  ],
  "edges": [{"source": "table:palette", "target": "component:engine", "kind": "stored-in"}]
}
```

This abbreviated example illustrates shape, not a valid complete fixture. Real
examples are produced by the reference runner. `partition` references the
existing `gameverse.rom-roundtrip/1` manifest. Each canonical component occurs
exactly once in the ownership tree. Offsets, bytes, hashes, source/IR providers
and asset payloads remain in that manifest; the new document does not create a
competing byte catalog. Semantic overlays can span several canonical owners,
including backing prefixes. Their `stored-in` edges retain every owner.

Containment organizes objects. Crossedges preserve calls, references, aliases,
required services, initialization, emitted-event links and runtime `before`
constraints. Calls and references may cycle; strict runtime `before` ordering
and containment must be acyclic. A graph dependency is not automatically a
runtime scheduling rule. `subtree_boundary(game, node_id)` enumerates every
crossing edge, owned component and unresolved descendant. A multi-node subtree
replacement remains unknown pending a closed descendant and boundary proof.

`import_game(partition, memory=None, partition_ref=None, memory_ref=None)` reads
already parsed manifests and returns this document. `validate_game(game,
partition)` independently checks pinned identity, full contiguous nonoverlapping
ownership, tree/edge integrity and represented contract contradictions.
`memory_table_node(memory, table_id, memory_ref=None)` imports a standalone donor
contract without inventing a partition for its ROM. No helper reads native ROM
bytes or silently upgrades producer declarations to proved facts.

The importer retains the memory capture's source revision/provenance and the
canonical manifest hash. Source, ELF, IR and consumer witnesses stay available
through their original immutable capture references. A canonical JSON hash is
not a file-byte hash; wrapper file references may carry both.

## Contract fields and conservative classifications

Typed data contracts include `format`, `endian`, `pointer_width`, `stride`,
`count`, `capacity`, `backing_prefix_size`, typed `fields`, captured `bindings`,
`expansion`, and captured `graphics` consumer contracts. Data bytes/rows remain
in the original memory capture. Palette/tile encoding, DMA alignment/count,
VRAM capacity and fixed consumer capacity are separate constraints. The static
compiler rejects known contradictions. The existing memory and graphics
backends must still validate exact data bytes, reference closure and all guarded
writes before an actual edit is admitted.

Native behavior contracts may record `isa`, `abi`, and `effects` with schema
`gameverse.component-effects/1`:

```json
{
  "schema": "gameverse.component-effects/1",
  "status": "unknown",
  "reads": [], "writes": [], "calls": [], "emits": [],
  "requires": [], "provides": [],
  "phase": null, "lifetime": null,
  "state_ownership": null, "save_schema": null,
  "evidence": [], "unknowns": ["Native dependencies unresolved"]
}
```

Memory effects use `{space,start,size,width?}`: offsets relative to `rom`,
`ewram`, `iwram`, `vram`, `palette`, `oam` or `io`; width is bits. Reads/writes include
aliases only when explicitly captured. Conditions and service identities are
exact tokens; the compiler does not pretend to prove arbitrary predicates.
Missing entries in an open inventory mean unknown, not absence. `closed` with
evidence is still a producer contract assertion, not a machine proof.

Known incompatible ISA/ABI, phase, lifetime, state/save ownership, widths,
layout, format and bounded memory effects prune a branch. Additional effects
outside a **closed** allowance contradict the host; open allowances produce an
unknown. Two overlapping writes with the same lifetime remain unknown unless
both explicitly declare `concurrency: exclusive-concurrent`; frame lifetime
alone does not establish simultaneous execution. Runtime schedule and save
migration are not synthesized.

`effects.py` derives bounded access summaries from already captured L1 and
matching validation-adapter bindings. `contract.access_summary` carries these;
`contract.access_requirements` carries explicit object constraints. Known
width/stride/address-space mismatches prune immediately; unbound/dynamic reads,
unknown aliases and retained native calls stay unknown. Pattern proposals carry
evidence/confidence and never promote readiness.

`plan_substitution(host, candidate, context=None)` returns one of:

| Label | Meaning within the reported contract scope |
| --- | --- |
| `incompatible` | A known contradiction was found; prune this branch. |
| `unknown` | Required effects, services, interfaces, evidence or lowering are missing. |
| `adaptable` | A bounded typed-data adapter plan exists; its guards and writes still need backend execution. |
| `interchangeable` | Represented contracts agree without a modeled adapter; this is structural agreement only. |

Every result sets `executable`, `semantic_equivalence_verified` and
`native_play_verified` to false. In particular, an interchangeable asset contract
is not a whole-game compatibility result. Unknowns outrank adapter proposals.
The core planner does not synthesize arbitrary behavioral adapters, discover
pointers, decode compression, or migrate saves. The separate bounded behavior
request/backend path below requires explicit captured IR and host bindings.

## Requests, execution boundary and resource bounds

`compile_request(game, partition, request)` accepts:

```json
{
  "schema": "gameverse.composition-request/1",
  "game_sha256": "canonical hash of the complete DSL document",
  "max_candidates": 16,
  "substitutions": [{"target": "table:palette", "candidate": {"id": "donor", "contract": {}, "provenance": {}}}],
  "context": {"provides": [], "services": []}
}
```

Candidates are resolved node records. A request contains 1..128 unique targets,
with an optional smaller bound. Documents allow at most 20,000 nodes and 100,000
edges. Joint memory aliases and subtree boundary obligations are reported after
individual checks. The result is a plan, not a mutation. Actual guarded edits
remain the responsibility of `tools.roundtrip.memory_ontology:compile_edit` or
the appropriate existing backend. Opaque retained services cannot be smuggled
through a shape match.

The prefab pipeline exposes import/query/plan commands; consult
`tools/prefab_pipeline/README.md` and `python3 -B -m tools.prefab_pipeline --help`
for their exact options. Its dependency registry joins existing extraction,
package and interface records without claiming those packages are closed.

## Bounded behavior-system requests

`tools.whole_game_composition.behavior` adds source-pinned semantic overlays
using `kind: behavior-system`, `contract.scope: behavior-system`, and
`contract.behavior.schema: gameverse.behavior-system/1`. The behavior declaration
contains a semantic identity and evidenced records for `lifecycle`, `inputs`,
`state`, `side_effects`, `phase`, `preconditions`, `postconditions`,
`asset_notifications`, `services`, and `dependencies`, plus explicit `unknowns`.
Each record has an `id` and evidence pins `{path, sha256, start_line?, end_line?}`;
provenance retains source and ROM identity. A source hash validates the witness
file, not the producer's semantic interpretation or full effect closure.

`inspect_behavior(node, root)` reports missing contracts and source-pinned
records. `normalize_behavior` can normalize producer syntax; a dependency name
without evidence stays unknown. `place_behavior_overlay(game, partition, node)`
adds `stored-in` edges through matching source hashes or captured native entry
addresses. Canonical components remain the only byte owners. Placement of an
entry does not establish closure of its reachable behavior or native services.

`resolve_behavior(host, donor, mappings, root, request_id, adapter_recipe=None)`
emits `gameverse.behavior-adapter-request/1`. Mappings reference exact host/donor
facet record IDs and carry source evidence. They can declare input, enum, unit,
storage, event, persistence, transition, reset, callback, return-code and
notification mappings. The request preserves node canonical hashes, missing
contracts, resolved evidence and adapter requirements. A recipe reference pins
both its file bytes and canonical JSON identity. Known contradictions are
`incompatible`; source-complete declarations still return `unknown`, with native
typed mapping/lowering validation required. Caller flags cannot discharge these
obligations, and the result remains non-executable.

`tools.roundtrip.behavior_adapter` consumes this request through `capture-request`.
Its `gameverse.behavior-adapter-recipe/1` describes captured dispatcher IR and
validation adapter, explicit state bindings, typed native service signatures and
byte/source pins, callback guards, resource tokens, installation preimages and
payload limits. `state_lifecycle` records ownership, lifetime, reset, reentry,
restore and save effects; phase/scheduler policy is explicit. The current backend
accepts one source-captured no-argument dispatcher with mapped state and declared
service boundaries. Unsupported collections, references, ABI conversions or
resource mappings fail admission; shape agreement alone cannot generate them.
The emitter generates the callback and guarded native installation from these
records rather than applying an untracked hand-written C patch.

Capture checks exact request/recipe/node identities and retains the generator,
compiler and referenced inputs in a bundle. Build can then deny reads from the
original source root, retaining stage durations, toolchain context and failures.
This proves only the reported capture/build property. Native effects remain open,
and build success does not establish gameplay, save/reload, lifecycle equivalence,
whole-game portability or accepted-version activation. `attach_native_feedback`
joins a pinned backend receipt back to the exact host/donor nodes and request;
it retains scoped backend claims without promoting global/native readiness.
Actual native consumer qualification and update eligibility remain separate gates.

The metadata-only CLI is:

```sh
python3 -B -m tools.whole_game_composition.behavior --host HOST_NODE.json --donor DONOR_NODE.json --mappings MAPPINGS.json --recipe RECIPE.json --request-id RUN_ID --output local/behavior-preflight-new
python3 -B -m tools.roundtrip.behavior_adapter capture-request local/behavior-preflight-new/request.json . local/behavior-capture-new
python3 -B local/behavior-capture-new/behavior_adapter.py build local/behavior-capture-new local/behavior-build-new --deny-source-reads
```

Use fresh output directories. The first command retains unknown/rejected static
requests and a receipt with local parsing/resolution durations and unavailable
queue/build/simulation/CI values. The latter commands invoke a separate native
backend and require its supported IR, recipe and toolchain; these commands are
workflow examples, not a claim that a specific candidate has passed them.

## Reproduction and cost

```sh
python3 -B -m unittest tools.whole_game_composition.test_core
python3 -B -m unittest tools.whole_game_composition.test_effects
python3 -B -m unittest tools.whole_game_composition.test_behavior
python3 -B -m tools.whole_game_composition.reference_examples --output local/whole-game-composition-reference-new
```

The focused checks cover ownership gaps/overlap, stale pins, graph cycles,
unknown-vs-contradiction semantics, growth admission, graphics and DMA rejection,
alias uncertainty and effect-shape pruning. They add no dependencies, CI job,
build, emulator run or expensive qualification campaign. The reference runner
uses private local captures for FireRed (958 canonical owners, 16 MiB) and MZM
(734 owners, 8 MiB), derives candidates from actual captured edits, and retains
both positive and negative plans with input/code pins.

It compares reading/parsing/auditing the same manifests with the new
import/validation/planning stages on the same process and machine. Receipts
record repeated samples, source commit, tool hashes, run ID and environment;
import includes validation, so nested stages must not be summed. Build,
simulation, queue and remote CI measurements are unavailable. These timings are
local static-analysis measurements, not a build-latency SLA or native proof.
