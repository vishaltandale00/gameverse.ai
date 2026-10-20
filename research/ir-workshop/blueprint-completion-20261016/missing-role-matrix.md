# Existing blueprint closure frontier

All nine retain their essential required roles. A registered phase is a contribution; it does not close a role or a whole blueprint.

| Blueprint | Required roles | Source responsibility absent | Source-only closure | Partial executable contribution |
| --- | ---: | ---: | ---: | ---: |
| Character control & traversal | 4 | 0 | 2 | 2 |
| Combat & enemies | 4 | 0 | 1 | 3 |
| Exploration & progression | 4 | 1 | 1 | 2 |
| Melee action & duels | 5 | 0 | 1 | 4 |
| Turn-based party battle | 5 | 0 | 2 | 3 |
| Racing & lap progression | 5 | 1 | 3 | 1 |
| Dialogue & interactive scenes | 5 | 0 | 3 | 2 |
| Hazards, protection & recovery | 5 | 0 | 3 | 2 |
| World actors & proximity encounters | 5 | 1 | 3 | 1 |

The columns describe available contributions, not complete roles. Every blueprint still has source and runtime dependencies to close.

| Blueprint | Essential source/runtime frontier |
| --- | --- |
| Character control & traversal | Complete legal controller + terrain/map/contact writeback, shared camera, actor spawn/checkpoint and world re-entry. |
| Combat & enemies | Real attack admission/allocation/lifetime, accepted contact policy, species death/drop/retirement, source enemy/projectile scheduling. |
| Exploration & progression | Actual once-only world/trainer claim, same-source benefit/action consumer and claim/inventory/capability save transaction. |
| Melee action & duels | Controllable fighter and action/animation owner, attack/contact policy, target reaction, terminal reward and actor/effect cleanup. |
| Turn-based party battle | Legal command/target roster, full priority/speed/RNG order, real action resolver and VM status/KO consumer, party/outcome persistence. |
| Racing & lap progression | Full profile-driven input/motion and track domains, legal checkpoint/lap/finish policy, incidents/opponents and race start/results/session. |
| Dialogue & interactive scenes | Real trigger/focus/context, presented text and navigation, confirmed/cancel result consumer, branch effect and window/child teardown/world resume. |
| Hazards, protection & recovery | Real terrain admission/resource owner, source protection aging, history capacity/restore policy and failure/checkpoint/respawn consumer. |
| World actors & proximity encounters | Valid allocation/pool owner, proximity/profile activation, actual scheduled actor behavior/contact consumer and shared camera/presentation/session. |

Chosen completion target: **Exploration & progression, using one Minish Cap source lineage**, conditional on recovering real discovery/reward and commit/save consumers. Ownership write → refresh is already executable; discovery, effect delivery and durability are not inferred from it.

Detailed per-role candidates, precise gaps, canonical state owners, ordering contracts and source references are retained in `missing-role-matrix.json`.

Snapshot: 20 registered prefab entries, 33 accepted deliveries. Source commit 85e2139614e26e198b87bb92dadbd22de49da871. Snapshot execution 0.036243 s. No build/native run; queue unavailable.
