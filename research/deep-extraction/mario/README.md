# Mario mechanics coverage and compiler evidence

This lane maps missing mechanic families and their actual own-ROM dependency chains for the automatic L0 → executable L1/L2 compiler. It does not supply hand-recovered C as generation input. The existing manual recovery packets remain independent analysis/oracle evidence.

[The coverage inventory](../../automatic-ir/mario-mechanic-coverage.json) tracks 45 game-specific family obligations across Super Mario Advance, Mario World, Mario 3, Mario & Luigi and Mario Kart. Every game remains incomplete. Families are open to further discovery; a checklist, exported function count or passing integrator does not prove that every mechanic has been found.

| File | Actual scope |
| --- | --- |
| `mechanics-targets.json` | 120 causal gameplay targets, own-ROM instruction/export hashes, callers, dependencies, state roles, acceptance obligations and two bounded indirect dispatch maps |
| `l0-context-evidence.json` | Nine hash-pinned profiles: three existing context/domain profiles plus six static SMA2 dependency pins with no new live observation or typed-port proof |
| `context-observations.json` | Read-only roots from three retained checkpoints (0.0923 s), plus a separate stock Mario 3 actor-view snapshot (0.03095 s); one rendered restore frame each |
| `sma2-fire-ability-lifecycle.json` | Actual form acquisition→legal shot→two-slot allocation→projectile/target/terrain update→impact lifetime→slot cleanup graph; currently static causal evidence |
| `sma2-fire-pool-contracts.json` | Canonical auxiliary/enemy/defeat-particle pool bounds, original callback ABI, shared index save/restore, exact scene aliases and stateful geometry services |
| `sma1-death-entry-fixtures.json` | Eight correlated source-derived expected states, consumed by actual automatic native qualification; includes non-idempotence and unresolved retry consumer |
| `audio-service-boundaries.json` | Audio state/query and conditional argument contracts; distinguishes genuine synthesis services from mixed gameplay clocks |
| `sma4-collision-service-contracts.json` | Local collision-frame domain, conditional scratch outputs and stateful tile-query service requirements |
| `sma4-pair-reaction-semantics.json` | Eight typed pair-contact state fields plus relative-position argument, pinned to original machine dataflow and consumers |
| `sma4-actor-dispatch.json` | Actor collection/handle ownership, walking/hopping AI phase closure and instruction-confirmed pair-reaction ABI; other actor types remain discovery targets |
| `sma1-character-profile-selection.json` | Own-ROM selector-to-parameter constructor and four source configurations, with only two character identities natively witnessed |
| `sma1-unit-calibration.json` | Six retained original-ROM adjacent-frame witnesses, establishing velocity units independently of storage names; no new gameplay run |

## What is already recovered, and what still needs closure

SMA1 has finite manual native evidence for character jump/hover, running/charge and clearance-tested release. The automatic pipeline now additionally qualifies gravity/hover and jump after explicit separate object bindings and bounded selector domains. The connected automatic death update plus Y integrator also passed 16,384 original/generated native pairs and eight explicit expected-state cases (0.288 s). Its completion signal must be consumed by the external scheduler: repeating the expired phase loses another life. The full terrain→interaction→carry→throw-hit→hurt/death→room/persistence chain is still unfinished.

Mario World has manual controller/spin transaction evidence, automatic pixel/subpixel integration with typed ports, and newly automatic gravity parity. The missing parent systems include contact eligibility, other attacks/projectiles, enemy/boss AI, form ownership, life/retry logic, terrain producers and persistent world progression. A few typed integration ports in a new clean-ROM composition are useful building blocks, but do not reproduce the whole controller.

Mario 3 has finite manual jump/wall, accepted stomp and item-pickup effects. Automatic packages currently close only smaller storage behaviors. Its pending pickup command at player+0x50 is distinct from active form at+0x37; the player tick commits it, refreshes animation/palette and publishes per-character ownership. Weapons and flight must consume the active state through their real legality/update phases. Treating pickup alone as an assembled ability would omit those dependencies.

Mario & Luigi and Mario Kart now have concrete static causal target packets as well as independent ROM exports and observed presentation, but no qualified automatic mechanic closure in the current inventory. Their obligations are RPG battle/party/progression and racing controller/items/laps respectively. Unverified gameplay priors are investigation questions rather than recovered rules. The bundled Mario Bros engines in the Advance cartridges are separate unfinished engines; the main games' evidence does not cover them.

## High-value causal closures handed to the compiler

- **SMA1 carry, damage and death:** grounded interaction → 12-slot plucked-object creation → held attachment → clearance-tested release → collision/hurt → carried-reference release on death → timer → life decrement → retry selector. Original functions identify real state ownership; thrown-hit and retry consumer/persistence remain to be closed.
- **Mario World contact, form and lives:** contact dispatch chooses top/side response → powered downgrade or small-form death → native state table chooses hurt recovery/death → death countdown decrements lives and selects retry/game-over events. Reserve-item drops and carried release are additional dependencies, not optional discarded visual effects.
- **Mario 3 contact and forms:** eligibility → top/side policy → accepted stomp or damage → pending form downgrade → next player-tick commit → actual ability update. Death has its own state dispatch and stage-event consumer. Normal allocation uses 15 slots, while the actual actor scheduler updates 18 records including three reserved slots. Visual rewards have a separate 15-slot pool. Failure and retirement behavior are explicit.

The packet separates notifications from services that affect mechanics. For example, Mario 3's score service changes a world-owned reward accumulator before allocating a visual reward; its persistence/resource meaning remains unqualified, while its death phase waits for audio completion. Neither can be replaced by an ignored renderer callback without preserving those causal effects.

## Context and unit constraints

Observed SMA1 player and parameter objects occupy different RAM/ROM regions. Mario World's broad padded analysis buffers are not safe ownership contracts: a former `engine[0x1200]` range overlaps the following map object, and a former `scene[0x1000]` range includes player storage. The compiler must preserve accessed sparse windows and physical aliases, or reject overlapping relocated objects; arbitrary buffer copies can invent independence.

SMA1 world position uses 1/65,536 pixel per raw unit. Integration adds arithmetic-shift-right-four of velocity plus carrier, so velocity uses 1/1,048,576 pixel per native update per raw unit. A `-96 << 16` velocity therefore moves six pixels per update. “16 fractional bits” alone does not specify the semantic velocity unit. Carrier consumption, wrap, contacts, frame orientation and scheduler invocation remain explicit contracts.

## Evidence limits and continuation

New discovery targets are static causal analysis until automatic lifting, original/emitted native parity and meaningful connected input witnesses qualify them. Saved native contexts support particular observed states, not universal pointer separation or reachability. Source state/ROM hashes and instruction ranges are retained; private ROMs, checkpoints, packages and recordings remain ignored. No browser gameplay, repeated broad suite or paid model campaign was run for this investigation.

Continue the connected closures above, then enumerate actor/species dispatches, ability modes, terrain interactions, bosses, stage flags and persistence services. Keep unresolved dependencies visible. No Mario game or complete mechanic family is currently declared finished.

## Resumed parallel evidence integration

The registry now contains 120 distinct own-ROM instruction-hashed targets: the original 75 records are preserved, with 45 additions from five independent packets. All additions are static evidence. The 45 open families include a newly identified separate bundled Mario Bros engine inside Superstar Saga. Existing finite native qualification results and counts are retained unchanged by this evidence integration.

| Packet | New targets / HighFunction pins | Concrete evidence and remaining limit |
| --- | --- | --- |
| [SMA1](parallel-sma1/FINDINGS.md) | 8 / 0 | Death completion→scene phase→retry/checkpoint or zero-lives consumers; actual live-r4 trampoline `080b6cc4` must remain a behavior dispatch. Eleven instruction/table windows pinned; scene/checkpoint ownership and native closure remain pending. |
| [SMA2](parallel-sma2/FINDINGS.md) | 6 / 6 | Actor descriptor/reset/reinitialization and shared random/relative-side dependencies for projectile impacts. Preserve enemy-slot 7/9 aliases and mechanically required invulnerability expiry. Four HighFunctions still expose artificial return-tail CALLIND; no native qualification added. |
| [SMA4](parallel-sma4/overlap-findings.json) | 2 / 2 | Contact shape and overlap have full 88/118-byte entry-to-return evidence; former 78/112-byte prefixes omitted tail effects/returns. Conditional scratch stores, inclusive touching and success overwriting A-X scratch require one shared owner. Native collision/actor closure remains pending. |
| [Superstar Saga](parallel-superstar/findings.md) | 10 / 8 | Main-game input edges, actor vertical motion/reset and contact cleanup are candidates. Separate `SUPER MARIOD` / `AX4E` header, inputs and high-ROM frame dispatch identify a bundled engine; its two targets lack HighFunction. RPG battle, equipment, story and save semantics remain unknown. |
| [Kart](parallel-kart/FINDINGS.md) | 19 / 15 | Racer/surface dynamics, CPU route/speed policy, lap/checkpoint crossing, contact/item and lifecycle/persistence candidates. Four HighFunctions remain pending. Fourteen of fifteen retained HighFunction PC ranges extend past declared contiguous sizes; separately hashed PC envelopes do not establish true function boundaries. |

Final verification took 0.5986 s on macOS arm64 / Python 3.9.6, checking 120 instruction spans, 119 available source-export pins and entry membership, 38 retained target HighFunction pins, 15 separate Kart PC envelopes, 19 analysis excerpts, nine context profiles, distinct IDs, family references and preservation of all original target records. The intentional exception is `sma2.cape_form_transform_finish`: its own-ROM bytes are valid, while source-export/HighFunction remain absent. Detailed identities, packet hashes and actual timings are retained in `evidence-integrity.json`.

The new bounded SMA2 six-entry export took 3.228 s after a retained failed 0.151 s launch; the SMA4 single-entry overlap export took 2.9657 s. These are separate workloads, not before/after performance measurements. No build, native parity or gameplay scenario was run by the evidence integrator; those timings are unavailable, and static additions do not promote executable readiness.

## Subsequent executable L1 / source-backed L2 mining

A later isolated mining round produced twelve local automatic L1 root subsets with selected finite native receipts totaling 36,864 original/emitted comparisons. Earlier and focused reruns are retained separately and are not additional unique mechanics or unique gameplay states. All five source-backed subsystem contracts remain `executable: false`; lifecycle assembly, shared owner bindings and outer caller closure still need proof. This round generated no games, demo ROMs or compositions and made no global catalog/count publication through the evidence lane.

| Source-backed contract | Actual finite-qualified local L1 members | Open parent closure |
| --- | --- | --- |
| [SMA1 grounded controller](parallel-sma1/next-extraction/l2-contract.json) | Horizontal deceleration `080a7e80`, 1,024 pairs plus 16 source expected cases | Ground `080a7774` reaches animation-table bounds; genuine input `080012fc` needs MMIO semantics; a speed-cap dependency exposes retained load-width disagreement. Animation `080a7c7c` is not the controller. |
| [SMA2 contact](parallel-sma2/next-extraction/l2-contract.json) | Player box, actor box, overlap and relative side, 4,096 pairs per root, plus separately retained focused cases | Shared scene/pool aliases and rejected-path writes are explicit. Actual contact roots remain blocked by inherited actor ABI, a missing dependency, pointer phi and mechanically relevant audio dependency. This is not the full contact/reward lifecycle. |
| [SMA4 contact eligibility](parallel-sma4/next-extraction/l2-contract.json) | Actor pixel-mirror synchronization `08047c40`, 4,096 pairs | Six caller dependencies exported; genuine dynamic callback `080e7638` and canonical pool iteration block accepted-response closure. Existing geometry was not repeated. |
| [Superstar motion lifecycle](parallel-superstar/next-extraction/l2-contract.json) | Initialize, update including linked reset, and reset, 1,024 selected pairs per root | One canonical actor binding and assembled initialization/update transaction remain unqualified; units, outer scheduling and RPG gameplay identity remain explicit unknowns. |
| [Kart racer subsystem](parallel-kart/next-extraction/l2-contract.json) | Steering recovery, track coordinate bounds and turn recovery, 4,096 selected pairs per root | Source steering/contact/race order is retained, while full profile-pointer/caller/terrain closure remains pending. Steering also has separately retained threshold cases and an earlier run. |

`evidence-integrity.json` → `fleet_next_mining_aggregation` records stable contract hashes and selected receipt identities. Artifact/receipt verification took 0.00226 s, 0.00109 s and 0.00297 s for the three arrival groups; these are metadata checks, separate from each worker's actual lift/build/native timings. Failed attempts and exporter receipts remain under each isolated `next-extraction` packet and private `local/ir/fleet-next` root. The system ontology ingests source-backed contracts separately from executable component publication.

## Published-package Mashup admission coverage

All five Mario games now have actual published-package Composer graph receipts, reusing existing native proofs. Twelve graphs were checked: ten returned `binding_valid_obligations_unproven`, and two preserved explicit rejections. These receipts cover package hashes, public semantic binding, state ownership, ordered calls and lowering. No new native run, JVM export, game ROM or complete L2 qualification was performed.

| Game packet | Actual admission and remaining obligation |
| --- | --- |
| [SMA1](parallel-sma1/mashup-coverage/coverage.json) | Two admitted graphs. Jump output feeds next-gravity vertical velocity and hover counter through exact shared source fields; intervening terrain, integration, frame and scheduler remain unproved. Current friction/integration semantic gaps are not bypassed. |
| [SMA2](parallel-sma2/mashup-coverage/receipt.json) | Four-component source contact prefix admits 23 public bindings over 13 slots; prepared rectangles feed overlap and source coordinates feed relative-side support. Private modes/shape use defaults; return semantics and full contact/reward lifecycle are absent. |
| [SMA4](parallel-sma4/mashup-coverage/coverage.json) | Shared-camera dual mirrors and the existing internally linked pair query admit. Direct mirror→query is rejected for unresolved width/frame projection. No split scratch, pool alias, guarded response or live-r2 closure is claimed. |
| [Kart](parallel-kart/mashup-coverage/result.json) | Three singletons and connected public steering→turn phase admit. A private-secondary alias attempt is rejected. Full canonical racer ownership, original schedule and bounds result semantics remain open. |
| [Superstar](parallel-superstar/mashup-coverage/summary.json) | Three ordered calls admit shared public flags/counter. Physical motion fields remain separate private copies, so this is not an assembled one-actor lifecycle. |

`evidence-integrity.json` → `mashup_admission_aggregation` pins every graph/receipt and keeps validation errors, warnings and actual per-graph timings. The aggregate's metadata hash check took 0.00216 s, separate from workers' Composer validation. Browser association and independent coverage audit consume these stable packets.

## Product-filtered prefab reconstruction

Five game-specific reconstruction deliveries now map 48 source core-loop phases: **two useful callable prefab phases, 35 source-only phases and 11 missing responsibilities**. The two ready phases are [SMA4 actor advance→camera projection](parallel-sma4/prefab-reconstruction/delivery.json) and [Kart steering recovery](parallel-kart/prefab-reconstruction/delivery.json). Both use exact published source packages, real Composer wiring, meaningful inputs/defaults and observable outputs. Their schedules/services are explicit, and `runtimeQualified` remains false.

Internal helper transactions are not counted as game-building prefabs. [SMA2](parallel-sma2/prefab-reconstruction/delivery.json) retains actor descriptor initialization inside a source-only spawn/contact module; missing public predicate-return and shape contracts block a useful captured contact sensor. [Superstar Saga](parallel-superstar/prefab-reconstruction/delivery.json) keeps flag/counter reset internal, with no primary prefab. Its RPG map distinguishes paired overworld motion from command, turn, defense, encounter, party and story responsibilities. [SMA1](parallel-sma1/prefab-reconstruction/delivery.json) keeps death/countdown support inside a source-only checkpoint recovery module, not a counter card or history-rewind ability.

Two narrow source closures advanced beyond inventory: SMA1 retry→checkpoint restoration passed 1,024 original/emitted comparisons including eight full expected checkpoint cases (0.271644 s; two-entry export 3.852506 s); fixed-point/world rehydration remains downstream. Superstar initialization→update now preserves one actor across 15 fields and passed 1,024 original two-call sequence comparisons (0.246995 s). It is an automatically linked sequence, not a newly recovered original root, and physical ports/caller context still prevent a useful primary movement prefab. Existing proof reuse supports the other phase graphs; no game ROM was generated.

`evidence-integrity.json` → `prefab_reconstruction_aggregation` pins the five final deliveries, ready graphs and validation receipts. Final metadata verification took 0.00097 s; this is separate from actual source export, lifting, native qualification and Composer timings. Central experience/API/site owners integrate the exact allowlists; these files do not claim that all source game loops are reconstructed.
