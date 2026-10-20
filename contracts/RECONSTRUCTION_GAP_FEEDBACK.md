# Native reconstruction feedback

The implementation is `tools/playtester/reconstruction_gaps.py`. It compares
retained native trace receipts for one explicitly bounded source-owned scope.
It is a mining/QC feedback seam, not an alternate game runtime or an automatic
substitution admission rule. No model calls, emulator installation, CI job or
new dependencies are added. Six provenance/coverage/immutable-receipt regressions ran in 0.005 s
on the local Python runner; there is no comparable previous implementation.

## Before a model experiment

Choose one cohesive dependency group with its semantic owner. Pin the original
and reconstructed artifacts, generated IR/provider receipt, raw binary diff,
and closure record. Discover actual declared adapter capabilities first. The
published native engine already supplies isolated sessions, actual input,
read-only declared RAM observations, capture/restore and unthrottled stepping.
Its public improvement experiment currently registers Aria and Sonic adapters;
the generic MZM action profile alone does not register a source-aware MZM
improvement scenario. A missing adapter is a pipeline gap, not a game defect.

The owner defines the scheduler boundary, fields and semantics, parent/state
lifetime, source references and declared controls. Scratch scheduler globals
must not silently become persistent entity storage. A checkpoint must be
captured through the actual native session. A source-controlled fixture is
permitted only with an explicit recipe and label; it does not prove natural
reachability. Loading one ROM's native snapshot into changed code does not
establish save compatibility. Prefer separate artifact-specific initialization
from the same pinned source recipe, then a common observation boundary.

Select inputs through the existing confidence/margin gated System1 and System2
path. Retain the original model decisions and replay those exact button/frame
inputs on the candidate for paired comparison. Two independently selected
model trajectories are exploration evidence, not a matched parity comparison.
System2 uncertainty/repair rounds remain bounded by overall call/frame/wall
resources; no arbitrary round-count stop or action-class confidence bypass is
introduced. Source-level controlled fixtures may establish bounded parity
separately from model traversal.

## Receipt and comparison

Each `gameverse.reconstruction-trace/1` receipt supplies:

- Run/game/source commit, loop, adapter and environment versions.
- `artifact`, artifact-specific `checkpoint`, `raw_events`, `raw_diff` and
  `closure` file pins, each with `path` and SHA-256.
- Common `observation_profile` and `action_profile` source contract pins,
  `recipe` and executed `inputs` pins. ROM-specific effective profiles belong
  in the raw run evidence; the common contract is not a claim that ROM-pinned
  effective memory profile files have equal bytes.
- `setup`: `kind` (`natural_checkpoint` or `source_controlled_fixture`),
  `boundary`, pinned `provenance`, and charged `render_integration_frames`.
- Ordered `observations`: actual session-relative `frame` and `facts`.
  Source owner defines sampling and field meanings, and the retained raw run
  must witness these values. The comparator authenticates file pins; it does
  not attest that arbitrary caller-authored JSON came from an emulator.

The scope maps each compared fact name to `components`, `dependency_kinds`
(for example parent/state/dispatch/scheduler/asset) and pinned `source_refs`.
The tool verifies pins, common provenance and identical frame schedules. A
missing field on either side is a coverage gap, including when both are missing.
A differing fact is an observed divergence. Both produce source-linked feedback
with `needs_source_owner_diagnosis`; neither identifies the cause by itself.

```sh
python3 -m tools.playtester.reconstruction_gaps \
  --original original-trace.json --candidate candidate-trace.json \
  --scope observable-scope.json --root /absolute/evidence/root \
  --output new-feedback.json
```

The output retains both traces, original receipt pins, each raw value and exact
frame. Source-owner diagnosis must cite the missing dependency/assumption and
link its fix to the affected IR/prefab closure revision. Unsupported fields or
unvisited paths stay unresolved. A matching bounded trace does not grant
whole-game parity, full campaign, portable prefab or natural-reachability credit.

## Runtime and timing evidence

Retain native binary/runtime hashes, actual linked engine version, source and
loop/config identities, checkpoint setup and resume render frames, actual model
calls with confidence/escalation receipts, executed actions/frames, and raw
observations. Use existing stage timings: model request, native action,
observation/setup, build and total wall time. Nested stages are not additive.
Queue/billing/provider split unavailable values remain null/unavailable. A
resource stop is partial evidence. Report failed/cancelled runs, unresolved
coverage and raw binary differences as well as successful bounded samples.

## Declared native adapter implementation

The authoritative engine checkout now adds
`tools/playtester/declared_native_adapter.py`, consuming
`gameverse.declared-native-observation/1` with `rom_sha256`, nonempty unique
`progress_fields` and `state_fields`, plus verified `source_refs`. It wraps the
existing native bridge, selects only present source facts, and hashes a partial
state projection. Missing facts, stale source pins, unsupported checkpoint
capabilities and a different ROM fail visibly. Source lifecycle meanings and
actual memory addresses remain in the pinned game profile. It never sets
terminal/success or selects inputs. Existing checkpoint/restore and action frame
receipts pass through unchanged. Core/model confidence policy is unchanged.

Four focused profile/provenance checks passed in 0.003 s. Actual MZM original-ROM
smoke restored a valid preexisting bridge snapshot, captured a new checkpoint,
executed RIGHT for 12 frames, restored and repeated the same input. Both post-input
images matched, and restore recovered the saved image. Receipt:
`local/roundtrip/mzm-declared-adapter-smoke-20261016/receipt.json`. It executed
25 frames including one raw-state render frame, zero model calls and took
0.074562 s total; first 12-frame native action took 0.004809 s. This is a warm
local native integration check, not a campaign or adapter speed improvement
comparison. Snapshot ancestry and a reachable Chozo boundary remain unqualified.

A concrete rejected checkpoint is retained in
`research/ir-workshop/roundtrip-20261016/native-feedback/mzm-checkpoint-prerequisite.json`:
the older gameplay capture reports `savestate:false` and its 397,312-byte
state file is entirely zero. Its screenshots/RAM remain separate capture
evidence. This file must not be used to claim native resume or natural gameplay.

A fresh paired input setup subsequently removed unknown snapshot ancestry:
`local/roundtrip/mzm-paired-fresh-input-setup-20261016/receipt.json` pins the
5400-frame historical button recipe, fresh-reset original/candidate native
runs and their newly captured snapshots. Both reached source area 0/room 2
with equal actual image hashes and selected read-only facts. Original setup
was 1.595020 s; candidate setup was 1.652779 s (10,800 total native frames,
zero model calls). This repeats the same scripted setup on two artifacts;
it is not a before/after tooling optimization benchmark. The source owner has
not established this room as a Chozo boundary. The new behavior/wait/timer
candidate and a source-backed route remain prerequisites for the MZM model
campaign. Retained setup runner is `native-feedback/fresh_input_setup.py`
beside the prerequisite receipt.

## Actual source-linked discovery

The subsequent original MZM model discovery and exact candidate input replay
are retained under
`research/ir-workshop/roundtrip-20261016/native-feedback/README.md`. The 36-call,
18-action run found a real LONG_HINT parent/arm context; it did not grant an
item. All 19 replayed sampled frames and 247 scoped fact comparisons matched
on the existing acquisition/events candidate. Source review showed idle pose9
is an empty dispatch; the actual next predecessor is arm admission `08014794`
with parent, position and morph/rolling prerequisites. Equipment activation is
an upstream controller observation, not a direct arm guard. The initial profile
omitted parent/spatial/activation facts, so distinct enriched profiles now read
them through the existing native decoder. The record preserves the observed
state, source interpretation and missing coverage separately.

This completes one actual mining feedback case, not new behavior/wait/timer
entry qualification. A future new-candidate run must pin its own artifact and
fresh matching initialization; the old candidate's matching samples cannot be
transferred as evidence that newly generated code executes.
