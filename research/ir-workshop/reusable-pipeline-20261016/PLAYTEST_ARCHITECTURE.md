# Reusable native playtest architecture

This documents the reusable playtest design and its evidence boundary. The
published full-engine checkpoint remains PR 12 commit
`30167a197481c7537cc36d369dd4e7e2d2f6e42c` until the publisher confirms a newer
remote head. That checkpoint's real controlled Aria repair/resume proof remains
valid and separate from newer quest/navigation work. Do not describe staged code
or a planned long quest as a published or completed experiment.

## Separate route execution from semantic decisions

The new RPG adapter reuses the existing SID provider's `Game` RAM decoder and
`Bot.plan` / `Bot.passable` BFS unchanged. This is recovery/reuse of an existing
bot implementation, not automatically mined game Behavior IR. The provider owns
map layout, passability, symbols, source objectives and battle knowledge. Its
versioned local manifest pins ROM, ELF, source files/tree, constants/toolchain
and optional save identity. The demonstrated ABI is SID Emerald; it is not an
unqualified FireRed or arbitrary-GBA RAM decoder. Provider source and game data
remain external local prerequisites.

The hierarchy is:

1. **Memory-grid BFS/native options:** after a semantic destination is chosen,
   deterministic routing advances the native game within a finite frame budget.
   It reobserves source position and replans one tile at a time. Map transition,
   script/battle entry, target arrival, divergence, blocked edge or option budget
   returns control. Same-map targets and live source points of interest belong
   to game/provider configuration; unknown cross-map routes are not fabricated.
2. **D1 semantic/battle decisions:** the existing D1 provider acts as System 1
   over current source-backed options: destination, dialogue/menu choice, move
   slot or battle action. Memory decoding exposes actual moves/PP/cursors and
   source knowledge. The adapter executes selected cursor movement and buttons;
   it does not silently choose a battle strategy when the UI is unknown.
3. **Confidence-gated modern System 2:** the existing `.65` confidence / `.20`
   margin policy governs escalation. Navigation, menus and battles do not bypass
   it based on action category. These are uncalibrated provider scores, not
   measured accuracy. Current source observations remain authoritative; retained
   model plans are historical context.

`rpg_adapter.py` supplies the pinned provider boundary; `rpg_experiment.py`
connects it to the existing DecisionPolicy, ScenarioAdapter, retained model
context and bounded engine. This hierarchy reduces repeated low-level model
navigation work without introducing a second unbounded controller.

## Battery saves and exact checkpoints are different startpoints

A battery save seeds an isolated native boot using a private copy, never the
player's source file. Source-defined boot/setup is reported separately from model
play. Native checkpoints additionally bind the exact ROM, provider/profile,
adapter/runtime/model identities, current observation, scenario history,
navigation state and model learning context. A checkpoint cannot move silently
between changed ROMs. A repaired candidate needs its own admitted start fixture
or explicitly proven compatible save boundary.

The retained zero-model battery smoke loads a 131,072-byte private save copy,
boots 600 frames and checks exact checkpoint replay after two six-frame inputs:
612 native frames in 0.123976 s, with source ROM/save unchanged. This proves
battery-copy boot and native replay, not an RPG route, battle or quest.

A separate restore-counter smoke (0.033309 s, zero model calls) restores saved
logical frame 1 while the underlying native counter had reached 25; replaying
24 frames ends at logical 25 with matching image/progress. Keep native/emulator
counter bookkeeping and resource accounting correct after restore rather than
double-counting prior frames. Both smokes are narrower than model-backed native
campaign qualification.

## Goals, milestones and partial progress

Source quest objectives are versioned predicates over actual observations,
including dependencies between milestones. The scenario graph retains which
predecessors and goal predicates were observed. A visited map, animation,
traversal budget or process exit alone does not establish a completed quest.
Missing predecessor/reachability evidence remains an explicit partial frontier.
The retained MZM example is concrete: original-ROM model/input replay reached a LONG_HINT
parent but failed the source arm-admission position/morph prerequisites, so no
grant occurred. [The source gap](../roundtrip-20261016/native-feedback/mzm-statue-source-gap.json)
feeds the next extraction/controller frontier. Passing a direct consumer fixture
does not establish the natural quest predecessor.

The finite campaign controller can automatically chain admissible checkpointed
chunks until a native goal witness, cancellation or cumulative caps. A chunk cap
is a partial result, not an objective. Per-chunk and aggregate model/frame/time
usage remains recorded; unknown interrupted usage blocks replay. Automatic
continuation does not allow client-selected arbitrary budgets or hidden work.
Game-specific discovery/cross-map policy remains with the provider/game config;
the loop owns its algorithm and resource policy.

Native options also reduce observation overhead. The retained zero-model
Factory2 diagnostic uses the same pinned state and held RIGHT for 240 frames:
24-frame observation chunks take 11 observations, while a watched option with
120-frame position samples takes two. Final source progress and image match.
Native action/IPC, image encoding, setup and total timings are reported
separately in `native-option-throughput-20261016.json`; this is an input-replay
microbenchmark, not a model/campaign speedup or latency guarantee.

## Compare a changed mod at a proven boundary

`mod_quality.py` evaluates a versioned `gameverse.mod-quality/1` contract over
retained original/candidate observations. Both sides pin game/artifact version,
source revision, adapter, startpoint kind/reference and an observed start
boundary. Inputs can be same, mapped with a pinned mapping, or explicitly
different; comparison conclusions are limited accordingly.

The contract requires objective, invariant, reachability and changed-mechanic
checks. A changed-mechanic comparison requires two different game versions and
distinct source expectations. An unchanged ROM is a baseline traversal, not mod
quality evidence. Missing runs or witnesses remain `unknown`; an exhausted
budget cannot prove content unreachable. The evaluator adds no simulator,
universal score or new model policy. A paired dispatch and actual retained run
receipts are required before claiming an observed quality improvement.

## Discovery is metadata, not inferred readiness

The published profile registry is
`contracts/improvement-profile-registry.json`; the provider-pack manifest remains
`contracts/improvement-provider-pack.json`. Per-recipe runtime read-set projection
allows unrelated provider data to be appended without invalidating another
unchanged recipe. Actual engine/profile/provider changes still need a new
admissible identity. A discovery entry does not establish installed inputs,
qualified mechanics, a whole reconstructed game or a successful quest.

The research source library also exposes capability-group discovery under
`ontology/ir-capability-groups/`. It must retain original package/IR/assets,
known open dependencies, invocation domains and qualification evidence. Use its
owner-published index and commands; do not create a parallel readiness catalog or
promote finite-profile MMZ into general replacement eligibility.

## Reproduction capability boundaries

The retained [public Grid proof](../roundtrip-20261016/reproducibility/reference-fixture-proof.json)
is an existing-engine demonstration: nine observed engine actions plus nine
independent action-log replay actions, zero models/repairs, no GBA material.
The runbook records its minimal clean-copy command. It establishes neither
native reconstruction nor S1/S2 operation.

The private-bundle artifact replay currently has capability
`rebuild_only`: copied captured artifacts can reassemble their pinned result.
Optional retained-C recompilation does not establish IR-first regeneration.
The separate `ir_bundle.py` route now has an actual producer pass for fresh
retained MZM L1→C→binding→payload with original ROM/source/old C denied:
[receipt](../../../local/roundtrip/private-bundle-mzm-ir-first-20261016-001/receipt.json).
It freshly emits 322 behavior + 240 binding + six alignment bytes and 24 veneer
bytes, retaining 8,388,584 bytes of mixed host. The independent scoped review
passes 20 pins in 0.006285 s with no execution rerun; see the runbook for command,
timing, audit scope and inherited finite proof. A separate versioned overlay now identifies 2,067 private bytes (96 palette,
1,971 audio) and proves consumed-file artifact replay; remaining host regions
stay mixed/unknown. Combined fresh IR+asset replay now has its own independently reviewed pass:
322/240/6/24/2,067/8,386,517-byte typed partition (behavior/binding/alignment/
veneers/assets/mixed host), exact same output. The runbook preserves guard-only
comparable timing and the remaining audit/closure limits.
The required receipt distinguishes regenerated behavior/binding from copied
opaque host, assets and gaps; it must not label all rebuilt ROM bytes as IR.
The user accepts a separate asset/data bundle. Identify each region's known type,
source provenance, byte range/hash, dependency/owner and actual consumer. Unlifted
game code, code/data mixtures and unknown spans are not assets. Keep asset bytes
in the private provider pack unless separately authorized for publication; no
blanket public asset upload follows from accepting a separate bundle.
Current whole-game parity combines these strata. The goal is dependency-linked
native IR closure, not hiding retained bytes behind an asset label.
Public API/UI and Grid publication may proceed independently of that proof.
The newer API intentionally does not expose private-bundle execution. Owner
reports 17 API checks (1.964 s, including the actual 18-action Grid subprocess)
and eight UI checks (0.126 s) plus loopback GET smoke. Those API/UI results are
now summarized in `verification/improvement-public-api-ui-20261016.json`
(SHA-256 `9c08c301d08290dfbf7eddcaa56447cb116029f609cc3b27c7951670d30961f4`).
It explicitly preserves owner tool-result provenance plus publisher source hashes
and commands; no checks were repeated for that receipt. Do not turn its HTTP/UI
smoke scope into a voice-to-native end-to-end qualification. The public
Grid proof `verification/reference-fixture-clean-checkout-20261016.json` has
SHA-256 `cc1d085b312b5564d355afc973765943728672677aca3c035b35e5488c4e07ab`.
This wave and reviewed worker/pause/tool fixes are published at `30167a197481c7537cc36d369dd4e7e2d2f6e42c`.
The [review-fix receipt](https://github.com/vishaltandale00/gameverse.ai/blob/30167a197481c7537cc36d369dd4e7e2d2f6e42c/verification/pr12-review-fixes-20261016.json)
preserves the targeted coverage and owner review scope.

## Current live-qualification boundary

The proposed new Sonic model prefix **did not start and consumed zero provider
calls**. Launch approval was rejected before execution because direct
screenshot/RAM/model-service authorization was not recognized in the child
context; the root chat requested user confirmation. The user subsequently
explicitly reauthorized the model work. The admitted [RPG prefix receipt](https://github.com/vishaltandale00/gameverse.ai/blob/30167a197481c7537cc36d369dd4e7e2d2f6e42c/verification/rpg-weekend-prefix-20261016.json)
now records 20 successful calls (one S1, 19 S2), 36 actions, 439 play / 2,131 total
native frames and stage zero only. Eighteen S2 calls saw stationary singleton
wait/text choices. This is a useful adapter/policy gap, not quest completion.
Worker wall is 51.563291 s, nested experiment 51.098177 s; models dominate.
No build, repair, battle, new-process resume or paired mod-quality proof occurred.
The prefix's pinned source identity stays distinct from follow-up fixes.
No new run receipt or native quest result follows from the earlier rejected
Sonic launch. Its timing/native-frame usage
is unavailable, rather than a completed zero-duration experiment.

The [published v2 source-event regression](https://github.com/vishaltandale00/gameverse.ai/blob/30167a197481c7537cc36d369dd4e7e2d2f6e42c/verification/rpg-source-event-local-20261016.json)
replays the retained first semantic destination from the same original ordinary
save, then uses source readiness to batch no-choice printer/script events. It
reaches stage one in 1,093 play frames / 34 actions / 1.817541 s with **zero new
model calls**. Seven A edges occur only at source-ready acknowledgments. The
work differs from v1's stage-zero prefix, so it is not an end-to-end model
speedup benchmark. The [actual fresh v2 model prefix](../../../local/reproducibility/rpg-weekend-v2-prefix-20261016.json)
now reaches stages zero→one→two under the new identity: 14 provider attempts
(five D1: one success and **four HTTP 413 failures**; nine successful S2),
99 actions / 90 deterministic decisions, 3,798 play / 5,490 total native frames,
39.615280 s experiment and 40.118160 s worker. It stops because the next
600-frame option cannot fit the remaining 510-frame budget. No battles, repair,
new-process resume, paired mod quality or full quest occurred. Its 1.585×
simulated-play-seconds/worker-second ratio includes model time; this is a
same-ROM/save/fixture/ceilings descriptive comparison to v1, with different
runtime/model action paths, not a controlled provider benchmark.
At that checkpoint the larger campaign was held pending those transport failures.
The sanitized publisher receipt is copied byte-for-byte to the linked durable
local path; it is now also published in the final head, while its tested
`a88e321` source identity remains unchanged. Old v1 checkpoints are not rebound to v2.

## Final bounded RPG qualification and closure

The [terminal sanitized receipt](https://github.com/vishaltandale00/gameverse.ai/blob/30167a197481c7537cc36d369dd4e7e2d2f6e42c/verification/rpg-final-qualification-20261016.json)
binds executed source `96c5566a018896bf91ebbc5d6ad2d84f9adbf7cb`; final head
`30167a197481c7537cc36d369dd4e7e2d2f6e42c` changes receipt/docs only. Lossless context
compaction resolved the four HTTP 413 cases; four retained-observation D1 rechecks
returned HTTP 200 with zero retries in 1.862158 s, all rejected by the unchanged
confidence gate. That is a transport check, not gameplay or accuracy qualification.

The final campaign uses 34 successful provider calls (nine D1 / 25 S2), 164
actions and 7,893 native frames: 1,692 startup + one resume render/integration +
6,200 play. It reaches source stages zero through four and observes battle four
times, with no pair-battle win/stage five or gym completion/stage six. It stops
at the model-call budget. Worker time is 60.162394 s; 103.804779 simulated play
seconds / worker wall gives 1.725410×, including models/controller/startup in the
denominator. Descriptive comparisons share ROM/ELF/save/fixture but differ in
source fixes, model choices and resource scope; there is no fixed speed promise.
Nested model, chunk, active and total timings must not be added.

Actual cancellation occurs before a second experiment: zero calls / zero frames.
A new controller owner resumes the first meaningful checkpoint, rather than the
zero-use cancelled child. Native state, model learning, observation/scenario/
navigation/runtime references match, as do measured map/X/Y/elevation/facing/
battle/story facts. Startup is not replayed. One integration frame advances,
so screenshot/full-observation identity is not claimed. The earlier failed
48-call campaign and duplicate restart remain retained, not repinned.

The complete current allowance is **100 calls = 14 v2 prefix + four targeted
checks + 48 failed/cancelled campaign + 34 final campaign**, zero remaining.
Prior v1 adds 20 separately authorized calls: **120 total RPG attempts, 28,897
native frames and 237.136083 s aggregate worker/targeted request wall**, including
failures/duplicate work. Four HTTP 413 attempts count; 116 other requests succeed.
No new ROM build/mod, paired quality comparison or full quest is claimed.
`WaitForMovementFinish` / `ScriptMovement_MoveObjects` remains a source whitelist
gap; unusual battle UI remains uncertain. API is cleanly stopped, model lease
released and no further waves authorized in this slice. Resume future work only
with a new explicit scope; preserve every prior identity and cost.

Older real Sonic/Aria model receipts remain separate historical evidence. New
long Sonic/RPG quests, complete dungeon/boss campaigns and broad mod-quality
improvement remain pending unless an owner later supplies an actual admitted
receipt. No credential values belong in documentation, manifests or receipts.

This handoff adds no model calls, native runs, builds or tests. Published source
links are pinned to the remotely verified commit. Publisher source review reports the fetched worker-restart, success-before-pause,
standalone continuation, unchanged-policy and missing-tool defects cleared in
this head. The receipt preserves 19 API checks / 2.795 s, 41 iteration/campaign
checks / 0.218 s, 22 tool checks / 0.036 s and 42 RPG checks / 0.324 s. These
checks are not additional model campaigns. Hermetic fixtures, Sonic frame counting
and client defaults also remain published fixes. Clean capabilities
remain conservatively setup-required until private prerequisites are installed.
