# Retained native pipeline learnings

**Scope update:** the current primary task is per-game original reconstruction
and justified like-for-like substitution. Read the
[roundtrip runbook](../roundtrip-20261016/RUNBOOK.md) and [primary handoff](HANDOFF.md).
The mashup/mod recipes and former owner queue below are frozen historical context,
not instructions to restart model campaigns or new mashup features.

This is the curated runbook for the reusable pipeline, Aria Soulstride and the
Emerald/FireRed source composition. Start here, then follow the exact receipts in
[the reproducibility index](reproducibility-index.json). The index is a pinned
reading list, not a second capability registry. Historical receipts stay frozen;
new requests, mechanisms and native observations get new attempt directories.

The [workstream contract](../../../contracts/PARALLEL_DEVELOPMENT.md) keeps game
adapters/discovery with Vishal and creation/improvement algorithms with Shishir.
Later explicit user decisions govern this experiment: a full Pokémon mashup means
**one standalone cartridge** retaining both games' campaign systems. A paired
host, two source builds, or a small game around recovered functions does not meet
that request.

## Later full-engine validation lesson

The public PR subsequently expanded from the basic native API to the full bounded
S1/S2 iteration engine; current scope and pinned handoff are in the primary
HANDOFF/RUNBOOK. The first two-chunk native/model chain observed its objective
but failed independent provenance validation: a shared checkpoint `native_events`
list changed the original configuration. Preserve its 47 calls/12,679 frames as
invalidated evidence. Defensive copies and strict prior/current engine identity
were followed by a fresh corrected 34-call/12,535-frame chain. Never repin an old
receipt after changing the engine merely to make continuation pass. Native
objective observation and immutable input/resume proof are separate requirements.

## Resume in this order

1. Read [HANDOFF](HANDOFF.md), the selected pinned request/config, and its last
   result. Compare hashes before reusing an output or checkpoint. Read actual
   source and qualification scopes, not just module labels or readiness counts.
2. Choose the narrow supported route: selected canonical prefab capsules and
   registered lowerer/backend, or the whole-source importer. The public
   [CLI guide](../../../tools/prefab_pipeline/README.md) contains executable
   examples. Unsupported closure must produce a blocker and bounded repair task.
3. Produce the cartridge and cheap integrity result first. Record its path/hash
   even if later bot play times out or misses the objective. Build success,
   instruction parity, source admission, native behavior, objective completion
   and campaign qualification are separate claims.
4. Exercise the exact cartridge in an isolated native session. Use source-backed
   readiness before DecisionAI traversal, then retain source observations,
   screenshots, decisions, model failures and native action/frame counts.
5. Repair the reusable failing seam through its owner. Add a source contract,
   canonical state/alias declaration, registered lowerer or backend capability
   with narrow evidence. Do not patch a single ROM and leave the next request
   unable to reproduce the fix. New inputs need new pins and a new attempt.

## Working commands and their demonstrated scope

Run from the repository root. Use fresh output directories. These are recipes;
this documentation pass does not execute builds, models or native qualification.
A stale pin is a deliberate failure; have its mechanism owner review and publish
new request/config pins instead of bypassing the guard.

```sh
# Full original Aria cartridge with eleven source-admitted enemy rewards.
python3 -m tools.prefab_pipeline build-mod --request tools/prefab_pipeline/requests/aria-first-soul-hunt.json --output-dir local/prefab-pipeline/first-soul-next --output local/prefab-pipeline/first-soul-next/result.json

# Retained build/traversal recipe; mechanism pins must match its frozen environment.
python3 -B -m tools.prefab_pipeline prepare-iteration --request tools/prefab_pipeline/requests/aria-first-soul-hunt.json --template tools/prefab_pipeline/requests/aria-first-soul-iteration-current.json --run-id aria-first-soul-next --output local/prefab-pipeline/aria-first-soul-next-config.json
python3 -B -m tools.prefab_pipeline iterate --request tools/prefab_pipeline/requests/aria-first-soul-hunt.json --config local/prefab-pipeline/aria-first-soul-next-config.json --output-dir local/prefab-mods/aria-first-soul-iteration-next --output local/prefab-mods/aria-first-soul-iteration-next/result.json

# Connected movement/combat/progression candidate; current qualification is separate.
python3 -m tools.prefab_pipeline build-mod --request tools/prefab_pipeline/requests/aria-soulstride.json --output-dir local/prefab-mods/aria-soulstride-next --output local/prefab-mods/aria-soulstride-next/result.json

# Prepare fresh reviewed-path pins; no build/provider call and no historical overwrite.
python3 -B -m tools.prefab_pipeline prepare-iteration --request tools/prefab_pipeline/requests/aria-soulstride.json --template tools/prefab_pipeline/requests/aria-soulstride-iteration-repaired.json --run-id aria-soulstride-next --output local/prefab-pipeline/aria-soulstride-next-config.json
python3 -B -m tools.prefab_pipeline iterate --request tools/prefab_pipeline/requests/aria-soulstride.json --config local/prefab-pipeline/aria-soulstride-next-config.json --output-dir local/prefab-mods/aria-soulstride-iteration-next --output local/prefab-mods/aria-soulstride-iteration-next/result.json

# Preserve canonical state while extending an existing Minish prefab phase.
python3 -m tools.prefab_pipeline phase-extend --request research/ir-workshop/reusable-pipeline-20261016/phase-lifecycle/minish-request.json --output-dir local/prefab-pipeline/minish-phase-next --output local/prefab-pipeline/minish-phase-next/result.json

# Inventory/plan before source-engine execution; inventory does not prove closure.
python3 -m tools.prefab_pipeline extract --game pokemon-emerald-version --game pokemon-firered-version --cache-dir local/prefab-pipeline/cache --max-files 512 --max-bytes 33554432 --max-requests 16 --output local/prefab-pipeline/extraction.json
```

The eleven-species build and earlier one-species real model traversal are the
retained working demonstrations in HANDOFF. The Soulstride recipe is the public
route under current integration; do not label it golden until its exact request,
projected-player contract and native result agree. The typed host-global and
projected-player contract now has owner review; the repaired configuration is
`aria-soulstride-iteration-repaired.json`. Fresh attempt 002 built the repinned request: the
[cartridge](../../../local/prefab-mods/aria-soulstride-iteration-002/build-1/native/game.gba)
has SHA-256 `6f52161e9826a16f2f063e452d6b63ef554d4efcce867eece0be418b401b86c8`.
The [build receipt](../../../local/prefab-mods/aria-soulstride-iteration-002/build-1/report.json)
records 0.405609 s total, 0.028197 s lowering and 0.351796 s native build,
5,800-byte payload/six hooks, clean payload build and no cache or dependency
setup. Its actual loop is now complete with partial native/model diagnostics below;
source trajectory/resource/progression fixture qualification remains separate. Its first public iteration retained a compile failure
(`local/prefab-mods/aria-soulstride-iteration-001`); an unused-header repair is
implemented, but that alone is not a new cartridge or trajectory witness. The
second attempt retains `preflight-cli-error.json` for a wrong host-path typo;
that preflight made no build or model calls. Subsequent Sonic registry work
changed a shared mechanism, so the repaired iteration configuration is now a
**historical pinned run**, not a fresh current-environment template. Use
`build-mod` for the unchanged Soulstride request or public `prepare-iteration`
above before fresh play. Preparation strictly validates the source/ROM/strategy
request, derives host from its plan, refreshes declared mechanism/profile inputs,
preserves limits and removes prior cache/checkpoint/retry lineage. It creates a
new run ID/config exclusively and makes no build/provider call. Do not overwrite
historical pins or use preparation to waive an invalid request. The actual
prepare-only publication is
`tools/prefab_pipeline/requests/aria-soulstride-iteration-next.json`: 0.058445 s
including Python startup/hash/write, zero builds/models, unchanged limits. This
new config includes current-observation authority and is not yet played. The
original native-mod API is
`tools.prefab_pipeline.native_mod.build_native_mod_request`; the registered
experiment is `tools.playtester.experiment.experiment_native_candidate`.
`reward-strategy/1` and `connected-strategy/1` lower versioned authored rules into
retained source packages. Their existence does not provide arbitrary full-game
portable IR compilation.

## Reuse the right mechanism

| Existing mechanism | Reuse rule |
| --- | --- |
| `extraction.py`, [EXTRACTION](EXTRACTION.md) | Read the authoritative allowlist, immutable deliveries, package contracts and native receipts; group phase variants by canonical module ownership. Cache identity includes reader, bounds and input pins; rehash even missing-to-present files. Descriptor inventory does not certify a complete source engine. |
| `contract.py`, `composition.py`, `backends.py` | Resolve exact typed capabilities, owner/lifetime/state aliases, schedule, assets and save policy before selecting a backend. No inline adapter, matching label or prose gap closure substitutes for pinned executable evidence. |
| Public `phase-extend`, retained Minish request | Extend the existing module through its lifecycle API and persist graph/module/receipt. Keep inventory bank/cache state through phase selection. Selection/configuration must never initialize, acquire, refresh or invoke gameplay; only the source phase is its writer. |
| `native_package.py`, native mod builder | Existing Aria packages include manual reconstruction/self-decompilation. Preserve that provenance and stale historical plan-pin mismatch; do not relabel them automatic L0→L1 recovery or silently swap in fresh proof. |
| `stage_closure.py`, whole-source stage ledgers | Preserve exact typed providers, source authority, evidence and open dependencies. Source-capable, host-checked, native-installable and portable are separate qualifications. |

L1 leaf equivalence or a passing L2 binding does not recover a full controller,
scene scheduler, encounter lifecycle, renderer or save transaction. Keep original
call-return timing and shared backing; do not wire convenient independent leaf
functions into invented game semantics. See the retained dependency packets and
package receipts before requesting new extraction.

## Aria: facts that must not be rediscovered

| Learning | Required consequence / evidence |
| --- | --- |
| `0x08034624` is the alternate-character cast dispatcher, despite earlier valid instruction/ABI comparisons. | Ordinary Soma dispatch is `0x0801b0d8`, cast is `0x08019478`, allocation call is `0x08019566`, Skeleton bone initialization is `0x08026008`. The actual native-input trace is `local/prefab-mods/soma-cast-pc-witness-003/report.json`. ABI parity alone did not establish the gameplay caller. |
| The successful Skeleton birth is a reachable success seam. | Require native MP admission/debit, slot/partner allocation, parent publication and initialization state `0→1` before an authored lunge. Scope is the starter Winged Skeleton red descriptor 1, cost 12; this is not every ability's cast hook. |
| Player and projectile pointers are different authorities. | Bone parent must equal the actual native player pointer with source-backed aligned RAM bounds and Soma guard. Declare this alias/projection authority in `campaign.projected_regions.player_motion` and package state bindings. The generated `gv_access_ability_player_motion(bone)` helper enforces the runtime guard; similar field names or matching pointer widths do not authorize writes. |
| The native controller still owns movement/contact. | Project velocity at actor `+0x48/+0x4c`; the next native Soma tick integrates and resolves collision. Do not write position, invent a grounded predicate or claim general controller portability. See `movement-contact/source-evidence.json` and `soulstride_movement.py`. |
| MP is campaign-global state, not an actor member. | Typed `player_magic` host-global has signed 16-bit current MP and unsigned 16-bit max MP with source-proved bounds. Keep campaign ownership, refund saturation and projected actor ownership explicit; arbitrary absolute RAM writes are not a reusable contract. |
| A fixture at frame 5800 can still have an input-locking corridor banner. | The old 112-frame probe produced a false absence. Actual casts appeared at relative 225/273/321. Readiness must observe opposite-direction velocity/facing response, not X drift or a guessed delay. The bounded readiness diagnostic used 228 frames, 0.078 s, zero model calls, max 360 frames. |
| The source enemy table has **113 actual rows**, indices 0–112. | Rows 113/114 were sentinel/non-descriptor data. Only species 0–10 are admitted by the current finite source certificate; nine have active soul providers. Keep other enemies on original policy. |
| Rarity or a nonzero descriptor cannot certify an ordinary enemy. | Zero/sentinel/boss/scripted exclusions are explicit. Species 33 Creaking Skull has progression guards despite nonzero rarity. Source admission is separate from observed native defeat/pickup/collection for every species. |
| Reward, collection, learned inventory and later ability use are different lifecycle boundaries. | Requesting a native pickup does not grant ownership; allocation, homing, missed/expired pickups, collection and save remain original services. Soul tiers must read the canonical native owned bank. |

The original-cartridge confirmation is
`local/prefab-mods/soma-cast-original-pc-witness-001/report.json`; the frozen
`research/deep-extraction/castlevania/soma-cast/evidence.json` certificate is copied
into generated output. The function name is `SkillWingedSkeletonUse` at
`0x08026008`; use native function/caller evidence instead of misleading old labels.

The [eligibility certificate](../../../research/deep-extraction/castlevania/soul-eligibility/certificate.json)
and [movement audit](../../../research/deep-extraction/castlevania/movement-contact/README.md)
pin the exact source claims. Soulstride's velocity, moving-defeat refund and tier
policy are **authored gameplay**. The native controller, MP transaction, pickup,
owned inventory and services are **recovered mechanics**. Preserve this distinction
in package provenance and UI claims.

## DecisionAI belongs inside the cheap loop

Use the already authorized model service through its external credential
reference; never copy credentials into requests, reports or docs. The retained
policy accepts System 1 only at confidence `.65`, margin `.20` and consistency;
otherwise it uses System 2. Scores are uncalibrated provider scores. Calibration,
accuracy targets, broad benchmarks and long campaigns are not prerequisites for
delivering a candidate or running a bounded traversal.

The actual [Soulstride002 loop](../../../local/prefab-mods/aria-soulstride-iteration-002/iteration.json)
completed in 16.39632 s with `artifact-built-with-diagnostics` and a verified
[`final.gba`](../../../local/prefab-mods/aria-soulstride-iteration-002/final.gba) copy.
Its build stage was 0.41131 s (inner build report 0.405609 s), fixture 1.835416 s
and playtest 13.99123 s; policy 13.807887 s and action 0.128357 s are nested
within playtest, not additional stages. It completed 20 responses: 12 S1
(four accepted) and eight S2 escalations, then 12 native actions. Total frames
were 6,321: 5,800 boot + 232 source-ready setup + one render + 288 action frames.
MP moved 80→1 with red descriptor 1 equipped and final vertical velocity
−98,304; HP stayed 320, XP 0, no newly owned soul. This is real partial
exploration; full connected-loop outcome and campaign completion are unproven.
Billing and queue stay unavailable.

The real earlier one-species experiment completed 12 S1 responses (11 accepted),
one S2 response, and 12 native actions/288 frames plus one render. The enclosing
loop took 3.210669 s; HP 320→313, XP 0, no new soul. Keep that diagnostic exactly
scoped to its immutable ROM. Earlier transport failures remain evidence. Source
readiness and bounded play provide useful cheap feedback even without objective
completion. Checkpoints bind exact ROM, native state, observation/profile,
adapter/emulator identity and learned context; do not resume against another ROM
or silently reuse a paired-host checkpoint for a single cartridge.

The Soulstride forensic review found S2 repeatedly reasoning from an old MP=80
plan while current source observations fell to zero. The existing caller supplied
current observations with distinct hashes; exact outbound provider bodies were
not retained, so provider caching versus model anchoring is unproven. The generic
`current-observation-authority/1` repair now labels current facts/progress as
authoritative and retained plans as historical, includes run/step/frame/time, and
records observation identity in S2 receipts. The captured-payload regression uses
current MP=1 versus historical 80; no post-repair live validation is claimed. See
`prefab-model-verification-20261016/current-state-diagnosis.json` and preserve
these limits rather than claiming the harness replaced current MP.

## Whole Pokémon source composition: retained failure lessons

The exact development command is:

```sh
python3 tools/whole_game/single_rom/build.py build-development --jobs 2 --timeout 300
```

This command diagnoses real transformed source and does not waive semantic
coverage. The 22-stage real compile at `20261016T172450Z-3701ecceb96f` applied
5,408 files but failed with 137 diagnostics (103.0 s total, 76.5 s make). The
26-stage prepare at `20261016T173227Z-a5cad3d5225f` took 22.45 s and retained a
mid-edit QuestLog syntax failure; no compile followed. Neither produced a ROM.
The newer 26-stage real compile at `20261016T173505Z-7a6efda30ecc` applied
5,449 files with actual tree matching expected
`80479e2c7293cf2c3390c1f0c8f26546637f89eb`. It retained 454 declared linked
witnesses, 106.218 s total/77.728 s source build, and 14 compiler diagnostics
(QuestLog lifecycle insertion and case-insensitive map macro collisions). It
produced no ROM or ELF, so the declared linked witnesses are not yet linked
proof. Preserve both real compile failures; their different stage counts and
source content do not constitute a comparable build-latency improvement claim.

The coordinator currently records implicit pinned base/donor revisions and its
`coordinatorSha256`, `frozenModules`, output patch/tree in receipts; a standalone
request/config file for this source-build recipe is not yet supplied. The
whole-source owner owns making that recipe explicit and agent-discoverable.

The authoritative implementation is under `tools/whole_game/single_rom/` and the
single-cartridge consumer is `tools/whole_game/single_pipeline.py`. Source staging
and validation are not a runnable cartridge. Do not promote the early paired
Emerald/FireRed builds or a baseline Emerald cartridge as the combined game.

An earlier patch application ran under an inherited repository root and silently
left the disposable build source unchanged. A successful baseline build then
looked like merged-source evidence. The repaired route verifies actual patched
source hashes/tree delta before compiling, then checks a matching ROM/ELF pair,
source lineage and linked symbols/assets. Compilation success alone cannot prove
that the donor campaign was included. Preserve the false-baseline and subsequent
real compile failures; do not rewrite old receipts to match the repair.

The per-system `research/ir-workshop/whole-game-mashup-20261016/single-rom/` ledgers
are the durable source capability/gap records. Track save representation/capacity
and EWRAM, map geometry/ABI, script/native command closure, graphics/renderer and
region services there. Host fault checks, targeted compiler checks, full linking,
native save/reload, region traversal and campaign qualification are distinct.
The first lexical source-definition scanner provisionally reported 221 roots
and 51 unreferenced slots, but skipped parameterized macro defaults in 118 Fame
Checker calls. Actual GNU assembler/CPP evidence found 223 roots/1,063 calls
and zero unknown operands. Static unreferenced slots are externally indexed ABI;
no deletion was admitted. Function-definition counts do not prove ownership or
final linked closure.
A shared-service binding must prove Emerald ownership/signature/state/ID
dependencies; registry removal needs static root proof. Stage count never
certifies source coverage. The later 27-stage compile completed every translation unit but failed linking:
its complete log has **835 unique undefined symbols/4,491 references**. The
initial capped error list undercounted this frontier; use the frozen
`173930Z-87585bfe12e4/link-undefined-inventory.json` receipt. No ROM/ELF exists.
Later registry changes are unrun; the mashup fleet is now frozen.

Projected capacity is not final combined `sizeof` or flash proof. A source-capable
or host-only package is not automatically native-installable or portable.

## New authored game requests

The Sonic + Metroid recovery request now has a new actual candidate, distinct
from the historical 720-frame movement demonstration. Its
`research/deep-extraction/sonic-metroid/request.json` pins `strategy.json` and
`tools/prefab_pipeline/sonic_metroid_strategy.py`; `baseline.request.json` retains
the comparison source environment. Reproduce through the registered public route:

```sh
python3 -m tools.prefab_pipeline build-mod --request research/deep-extraction/sonic-metroid/request.json --output-dir local/prefab-mods/sonic-metroid-next --output local/prefab-mods/sonic-metroid-next/result.json
```

The [actual new cartridge](../../../local/prefab-mods/sonic-metroid-native-ir-progress-002/native/game.gba)
has SHA-256 `50757987593917bddafe6b32c3355cb9af32d899468850af69115bad59f3d855`.
Its [receipt](../../../local/prefab-mods/sonic-metroid-native-ir-progress-002/report.json)
records 1.039475 s total, 0.029064 s lowering, 0.049216 s merge and 0.930130 s
native build; 20 reused components/27,920-byte payload. The same-environment
baseline took 0.856329 s total/0.830387 s native with 27,280 bytes; requested
behavior and payload differ, so this is build context rather than a speedup claim.
The first failed compile is retained; scoped unused-label wrappers preserve
emitted function bodies. The source-owned allocations are 1,600 bytes plus a
36-byte sidecar, with fresh-save policy only. Progression host/ABI receipts pin
the generated MZM acquire/event helpers. The exact candidate
[native prefix receipt](../../../local/prefab-mods/sonic-metroid-native-ir-progress-002/native-prefix/report.json)
retains cold boot → coast/ice platform/high-speed upgrades → native first boss
and capsule → Factory (9.405903 s). The separate
[Factory fixture](../../../local/prefab-mods/sonic-metroid-native-ir-progress-002/factory-setup/report.json)
retains native Varia/heat behavior (4.850263 s, upgrades 127/max energy 149).
These are bounded native fixture observations, not DecisionAI or campaign
completion. Further Factory handles and model play remain pending. Do not restore the prior rejected Sonic
website version as a substitute for the requested game.

The Pokémon eclectic gameplay request belongs to its authored-policy owner and
uses the ongoing one-cartridge source composition as its engine dependency.
Current source helpers are `tools/whole_game/single_rom/eclectic.py` and
`research/ir-workshop/pokemon-eclectic-20261016/mechanics/`
(`eclectic-mechanics.c`, header and `source-admission.json`); their source
boundary comparisons are not gameplay traces or a linked cartridge. These files
are actively regenerated; the index lists discovery paths without admitting a
reproducibility hash until their owner freezes a receipt.
Keep authored gameplay policy and its resource limits separate from recovered
engine contracts and the whole-source owner's save/map/script/graphics closure.
Until owners publish pinned executable recipes and actual artifacts, these are
active requests, not completed demonstrations.

## Evidence, timing and owner handoff

Retain run/request ID, exact source commit, base ROM/game versions, adapter and
loop/config hashes, machine/toolchain, resource limits, outcomes and failed or
cancelled attempts. Reuse existing stage timestamps. Label cold/incremental and
cache state; unavailable queue/billing measurements stay unavailable. Stage times
nested in total wall time must not be added twice. Extraction cache reuse avoids
retaining duplicate outputs, not integrity rehashes. No comparable before/after
build-latency or manual-labor speedup is established by these docs.

| Next owner | Resume responsibility |
| --- | --- |
| Pipeline architecture / contract owner | Keep registered route/capability and bounded repair metadata in existing pipeline schemas; preserve the reviewed typed host-global and canonical projected-player contract when repinning Soulstride. |
| Substantial-mod / native owner | Publish exact Soulstride build request/result and native success/failure/next-tick movement receipts; retain earlier wrong-hook/locked-fixture failures. |
| Bot / iteration owner | Pin source-ready fixture, profile, memory and mechanisms; execute bounded traversal only against the admitted cartridge and publish partial diagnostics as well as successes. |
| Whole-source owner | Publish current merge/build receipt and per-stage ledgers, prove actual transformed bytes and linked donor assets, then qualify one cartridge. |
| Next agent | Inspect the index and receipts first. Reuse source helpers and requests. If a desired recipe has no registered tool, return the exact missing capability to its owner with a bounded repro; do not describe pending code as implemented. |

This learning pass adds no dependency, CI stage, model call or native run. Its
validation is cheap local reference/hash inspection only. Refresh this runbook
and the documentary index when owners publish a new milestone; frozen evidence
remains unchanged.
