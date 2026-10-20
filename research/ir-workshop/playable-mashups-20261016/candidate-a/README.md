# Relay Runner — playable action/traversal mashup

Frozen game revision: `relay-runner-wasm-20261016-r3`. Open `/playable-mashups` and choose **Relay Runner**. This is a complete compact course with an opening, earned movement upgrade, three distinct encounters, a final combined obstacle, ending, death/checkpoint recovery and replay. It is not a broad campaign or original-ROM recreation.

Controls: A/D or arrows move; Space/Z jumps; press jump again after unlocking Air Step for a second midair impulse; J/X strikes; Enter restarts after victory or defeat. Hold-to-repeat attacks are intentionally disallowed by recovered DB input edges. Reach the low sentry, recover its core to gain Air Step, climb the relay terraces, defeat the armored sentry for core2, cross the hot conduit, shatter the sentinel with running strikes, then deliver both cores to the beacon. Moving fast makes ordinary strikes stronger and is required to penetrate the sentinel shield. The sentinel telegraphs before charging and has a safe recovery interval.

## Actual source behavior executing during play

`src/playable-mashup-candidate-a.js` loads **actual generated C compiled to WebAssembly**, with zero imports, from private `local-data/playable-mashups/relay-runner.wasm` via the exact allowlisted `/private-playable/relay-runner.wasm` route. No JavaScript fallback exists in the playable factory. Exported JavaScript translations remain only as differential baselines. The new local WASI SDK compiler fixes the original system-clang limitation; toolchain setup cost is recorded separately by its owner.

- Dragon Ball Advanced Adventure `db.input.actor_edges_repeat`: current input, history and recovered press/release/repeat processing. Actual source pressed bits4/8 admit jump and strike. Authored lifecycle assigns unique attack IDs and handles terminal restart. Selected physical bits are an explicit authored mapping.
- Sonic Advance `sonic.motion.air_steering`, `integrate`, `gravity`: actual Q8 lateral acceleration/inertia/cap, position integration and gravity. Its real velocity determines strike strength and sentinel shield penetration, so momentum affects combat and traversal. Flags258, pose0, stage flags0, cap1152 and acceleration24 are pinned adapter inputs. Authored jump admission, Air Step and ground release braking complement the source movement.
- Metroid Zero Mission `mzm.combat.impact`: canonical HP subtraction and nonlethal/lethal consequences. `mzm.combat.reaction_tick` plus `mzm.lifecycle.enemy_update_gate` now execute in the next eligible alive-enemy prepass. Their actual result suppresses enemy motion/charge-clock progression after a hit. Reaction17→16 produces suppression; once it falls below the source threshold the enemy resumes. Newly applied damage is not immediately aged in the contact phase. Palette selector writes remain source state; presentation does not claim original animation fidelity.

The immutable generated inputs are the retained `action/air-traversal.core.c` and `action/equipped-contact.core.c` from the prior source assembly experiments, with original package hashes in their assembly requests. `prepare-wasm.mjs` copies unchanged generated function text and adds only an explicitly authored fixed integer ABI. `source-wasm.c`, build args, source/artifact hashes and exported symbol names are retained. No handwritten replacement is represented as extracted source.

## Authored game and scheduling

One authored tick runs at 60Hz; original-frame cadence equivalence is unproven. Ordering: input/terminal handling → combat begin → source DB input → source-edge action admission/lifetime → source Sonic motion → authored release braking and swept terrain → hazard/checkpoint → eligible source MZM reaction/gate prepass → authored enemy AI → live attack/body contacts invoking actual source damage → immediate death/reward settlement → progression/gate/victory → protection aging → observation.

World geometry, foot-center Q8 transform, Air Step, patrol and telegraphed sentinel AI, contact association, attack lifetime, 38-tick protection, checkpoint routing, rewards and objective are authored. The source gate controls when that authored enemy AI may advance; this does not recover original Ripper AI. The sentinel starts its own local clock with a full warning on activation; it can be hit in any phase if the courier has enough momentum, and only charging body contact hurts. Each action hits each actor at most once. Dead players stop attacking immediately; dead enemies grant their reward once. Death/win freeze ticks until Enter resets every authoritative state.

Renderer consumes actual observation state. It receives chapter/objective, momentum readiness, Air Step availability, locked attack direction/lifetime, guardian phase/countdown, hit/clang events, checkpoints and earned ending text. Scene/hero/scenery are intentionally authored; recovered enemy pixels remain private under the existing asset policy.

## Reproduce and verify

From repository root:

```
node research/ir-workshop/playable-mashups-20261016/candidate-a/build-wasm.mjs
node research/ir-workshop/playable-mashups-20261016/candidate-a/qualify.mjs
node research/ir-workshop/playable-mashups-20261016/candidate-a/qualify-reaction.mjs
node research/ir-workshop/playable-mashups-20261016/candidate-a/playthrough.mjs
```

No new dependencies or CI jobs were added. The final clean O2 freestanding C→WASM build produced 4,043 bytes in about72ms, excluding SDK setup. The narrow original subsystem differential checks 4,500 vectors against native generated C and retained JS baselines; another 1,018 vectors check the actual C reaction/gate WASM against native C. Bounds and source branches are scoped in the JSON receipts. The full ordinary-input playthrough wins after 2,224 input invocations with8HP, verifies stationary strikes cannot damage the shield, restarts, loses through repeated causeway falls, confirms terminal freeze/no rewards, and restarts again. It uses observations and normal inputs only, with no state mutation. Latest measured headless whole-game verification was about128ms; this is not browser evaluation time.

`frozen-manifest.json` pins final runtime, renderer, generated source, private WASM, driver and receipts. Browser validation and visual review are separate lane evidence. Queue, CI and comparable latency baseline are unavailable; nested build/simulation times must not be added to total. Before the depth revision, the actual-WASM two-sentry course passed its 1,510-input route in about57ms; its smaller workload is not a comparable performance baseline.

Retained repairs: invalid null camera in initial fall recovery; terminal attacker continuation; incorrect test-facing and noncontact loss fixture; global sentinel clock changed to activation-local warning; source DB edges made authoritative; source reaction/gate integrated as actual enemy-update suppression. See `attempts.json`. The original 450-frame sentinel test budget was extended to900 after activation-local scheduling changed the encounter phase; the final ordinary-input run passes.

Unsupported: durable save/resume, accepted-game registration, original-ROM full native parity, migration/automatic-update compatibility and broad multi-level content. This research game does not alter accepted FireRed artifacts or saves.
