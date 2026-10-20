# Two source-connected action mashup experiments

Reproduce from repository root:

```sh
python3 research/ir-workshop/mashup-experiments-20261016/action/run.py
```

The script lowers the actual qualified packages, uses the existing assembly validator and Composer, compiles two clean host C translation units with the existing `cc`, and executes bounded scenarios. It writes retained assembly requests, validations, generated C, harnesses, traces and rejections. No dependencies, shared catalog changes, ROM changes, native build or original-game replacements. Eight scenarios in the first run were extended by one held-input scenario in the final run. No broad suite was run.

## 1. Disabled controls, momentum and air reversal

Hypothesis: Dragon Ball Advanced Adventure's actual actor input suppression/history can control Sonic's recovered air movement phases, preserving the distinction between disabled control and stopped motion. Player payoff would be momentum-preserving control lock and midair reversal in a platforming room.

Graph: `db.input.actor_edges_repeat` → authored DB selected bits0/1 → Sonic masks16/32 → `sonic.motion.air_steering` → `sonic.motion.integrate` → `sonic.motion.gravity`. Steering and integration read/write the same canonical `actor_vx`; integration and gravity share `actor_vy`. No copied player actor or frame conversion. Each host invocation explicitly calls this order once; source frame cadence is unproven.

`air-traversal.assembly.json` pins package and behavior hashes. `air-traversal.validation.json` retains admission/lowering evidence. `air-traversal.core.c` is actual generated execution, not a handwritten equivalent. The adapter is authored novel control policy; physical DB button identities are not established. Sonic source Q8 units are retained. Initial speed cap1536/acceleration24 and source eligibility flags258 are the existing steering fixture configuration, not a recovered whole-game controller or a tuning experiment.

| Scenario and expected consequence | Observed host output |
| --- | --- |
| Hold authored right for12 calls: positive speed and displacement | mappedHeld16; xQ8=3744; vxQ8=576; yQ8=2772 |
| Set recovered DB disable flag1024 while requesting left: no control, continue inertia | mappedHeld0; xQ8=4320; vxQ8=576 |
| Clear disable; hold left for28 calls: direction reverses | mappedHeld32; xQ8=960; vxQ8=-768 |

The meaningful break appears at landing. `air-traversal-kirby-contact.attempt.json` attempts to bind world-Q8 `actor_y` to Kirby's shape1 terrain lookup index. The validator rejects it with `arithmetic quantization requires explicit source twos_complement encoding: terrain.field_0`. Adding that annotation would still not justify a binding: world position and flattened tile-local shape index have different frames/quantities. No coordinate alias or dummy terrain correction was supplied.

Missing reusable pieces: bounded map lookup and world→tile/probe transform with evidenced scale/origin; general shape selector/metadata; original contact resolution and actor writeback; actual jump admission, landing and grounded/air state owner. Kirby's published function is only a shape1 displacement query, not that controller. The smallest honest next step is to publish a bounded terrain-probe/world-coordinate contract and source-backed resolver, then connect Sonic actor state through a declared transform. This would unblock Sonic/Kirby traversal experiments and provide a seam for other movers; it does not certify them.

## 2. Equipped action input, accepted hit and reaction

Hypothesis: DB suppression/history plus Minish Cap's real equipped-item-held predicate can admit a novel equipment-specific contact action against Zero Mission's real damage/reaction state. Player payoff would be an equipped tool that damages a target only when its corresponding button is held and contact has been accepted.

Graph: `db.input.actor_edges_repeat` → explicit authored bits0/1→Minish A/B masks → `tmc.input.held_equipped_item` → **authored host conditional gate using external accepted-contact event** → `mzm.combat.impact` → `mzm.combat.reaction_tick` → `mzm.lifecycle.enemy_update_gate`.

All five source components retain unchanged recovered behaviors. `equipped-contact.assembly.json` validates the typed component/adapter bindings and ordered calls. It is an unconditional source-component schedule, not the full conditional interaction. Generated functions split that exact validated schedule into input and contact phases; the harness's explicitly labeled `event` function supplies the gate. The host conditional is a novel bounded admission policy, not recovered attack allocation, collision, invulnerability or a source-faithful action.

| Scenario and expected consequence | Observed host output |
| --- | --- |
| Contact without equipped button: no damage | hp10; query0 |
| Matching button without contact: no damage | hp10; query1 |
| Matching equipped button plus accepted event: damage and reaction | hp7; reaction16; pose0 |
| Same held button at another accepted event: held semantics remain active | hp4; pressedMask0 |
| DB disable flag prevents accepted hit from this input gate | hp4; query0 |
| Change matching equipped slot away: button ceases to authorize hit | hp4; query0 |

The repeat scenario is a design consequence: held is not newly pressed. A second externally accepted event causes another hit without a new press. No cooldown or source protection policy was invented to hide that gap. Reaction values are original packed invocation encoding, not an assumed number of real-time frames. This host fixture immediately invokes the reaction phase after damage; source-equivalent eligibility and later-prepass chronology are not established by that call order.

`equipped-contact-conditional.attempt.json` retains the attempted request-level conditional action graph. The assembly API rejects `unsupported invocation field`: its call list cannot express a condition, even though the lower-level Composer already emits `if` statements. This is an API expressiveness gap, distinct from missing game mechanics. The smallest generic remedy is a bounded assembly control-flow schema with semantic boolean conditions, branch-sensitive ownership/adapter freshness and invocation analysis; it could serve all games and avoid handwritten caller gates. That alone would not recover an attack system.

Actual game closure still needs an attack/action owner, legal action admission, allocation/lifetime/cleanup, target/contact detection and accepted-contact policy, native target scheduling and terminal/death/drop handling. Contact here is an injected scenario event, not an observed player attack. No whole enemy lifecycle is claimed from hp mutation and a gate result.

## Evidence, presentation and timing

Evidence tier is **host execution of recovered mechanisms with explicit authored adapters/caller policy**. Package qualification predates this experiment; no new source-native parity or rendered play evidence was collected. There is no runnable game candidate for model gameplay testing and no activation/submission to the accepted environment. The tests exercise meaningful coherent interactions, but do not satisfy whole traversal or combat roles.

Presentation dependencies remain unconnected: interactive key sampler, invocation scheduler, camera, actor/entity allocation, tilemap/collision data, sprites/animation state, renderer, stage/session/checkpoint and game objective. No source graphics were fabricated or implied by a moving host coordinate. The existing generic runtime is not invoked by these generated host checks.

`report.json` records source commit, machine/toolchain, resource limits, output and compiler hashes, clean/no-cache mode and measured build/execution times. The final two clean host builds took about0.047s and0.052s; corresponding process executions about0.037s and0.050s; total script time about0.222s. These nested stages are included in total, not additional to it. Queue time, native build, simulation/render/model evaluation and before/after turnaround baseline are unavailable. These are new experiments, not a claim of improved build performance. Each compile is limited to30s and each host process to5s. The first exploratory run's total was0.346s before the additional held-event scenario; it is not a comparable performance baseline.
