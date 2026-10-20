# Bounded independent suitability probes

Two real generated-C subsystem sequences ran. **Zero new games, zero rendered playtests and zero actual model calls.** Neither candidate exposes a playable world, controls, objective, renderer/assets or checkpoint/session lifecycle. Host observations below cannot certify game playability or autonomous control.

The probes use the workers' real generated source mechanisms and add only authored diagnostic sequencing. They do not write source ROMs/L0 or accepted progress. No dependencies, CI, native qualification, game templates or broad campaigns were added. This lane consumed two distinct candidate probes; the first combat diagnostic was corrected after its hypothesis failed.

| Candidate / command | Observed evidence | Missing runtime behavior |
| --- | --- | --- |
| `python3 -B research/ir-workshop/mashup-experiments-20261016/playtest/run_probes.py` | First unprotected physical contact HP10→7. Disabling separation on the next step clears contact bit3 and retains HP7. Lethal contact HP3→0, pose98; explicit reaction prepass17→16. A subsequent contact with the same HP0 actor is still admitted and resets reaction16→17. | Terminal actor exclusion and death/drop dispatch. The current authored bump rule has no HP/lifecycle admission test. Repeated contact consequences on a terminal actor are observable even though HP stays0. |
| `python3 -B research/ir-workshop/mashup-experiments-20261016/playtest/run_probes.py --progression` | Minish grant updates inventory while skills cache stays0. Confirmed use refreshes skills1 and exchanges both Emerald action/battler lanes. A duplicate confirmed delivery exchanges them back. Revocation leaves stale skills1 until action boundary refresh, which correctly yields0 and blocks exchange. | The primitive is correctly an exchange, not an idempotent command. A runtime must define whether each confirmation is a new action; retry/deduplication or pressed-edge semantics are absent. Save/restore and durable permission lifecycle remain unproved. |

Combat attempt1 retained in `combat-temporal-attempt1.json` records an investigator assertion failure: it predicted stale bit3 would survive disabled separation. Actual evidence disproved that hypothesis. Attempt2 corrected the diagnostic expectation and exposed the terminal-target continuation above. This is a caller/scheduler integration gap, not an alleged recovered-source parity defect. The failed attempt's old diagnostic source fingerprint is retained in its report; its source bytes were subsequently edited in place.

Both successful JSON receipts contain source commit, exact dirty generated-source/driver/graph hashes, toolchain, environment, output, timeout caps and separate build/simulation timing. These are diagnostic process times including process startup. They are neither emulated game duration nor a latency before/after benchmark. Evaluation/report assembly is nested in total; no separate evaluation-stage clock was collected.

| Run | Fresh host build | Simulation process | Total |
| --- | ---: | ---: | ---: |
| Combat attempt1, assertion failed | 0.087217 s | 0.066206 s | 0.162665 s |
| Combat attempt2, characterization passed | 0.118066 s | 0.053364 s | 0.180517 s |
| Progression, characterization passed | 0.063063 s | 0.049428 s | 0.122095 s |

Queue, compiler-cache hit/miss and model execution/billing are unavailable. The build is a new host binary, not a ROM or browser build. Each build is capped at15s and each diagnostic executable at5s. Output binaries are deleted after execution. No comparable earlier workload baseline exists.

## Concrete minimal path to a real playtest

1. Choose one actual runtime host and pin its artifact. The generated C needs real actor state ownership, input producers, collision/terrain and scheduler services. Combat needs terminal exclusion/death continuation; progression needs action command boundaries. A successful standalone process exit does not supply these.
2. Supply a truthful private adapter with an actual entry/checkpoint and objective. Reuse `tools.playtester` JSONL v1: `hello` declares `schema_version:1`, `isolated:true`, exact `game_id`, immutable `game_version`, `adapter_version`, session ID, `observe`/`act` and supported limits. `observe` supplies actual frame/state key, facts/progress, phase, finite legal options and terminal/success. `act` accepts only current options and returns actual elapsed frames. `close` disposes the isolated state. Snapshot restore cannot be assumed merely because a C struct exists.
3. For a compiled GBA candidate, use the existing native worker with exact ROM hash, same-build ELF-derived memory profile and a hash-pinned private native state. `tools/gba_playtest/scenario.py` already supports finite semantic actions/assertions and retained native captures. It has no model policy selection; it is scripted acceptance. Browser/native states are not presumed interchangeable.
4. Only after such a candidate exists run a small actual controller probe: explicit `--policy d1 --system2 chat --max-steps 8 --max-decisions 4 --max-escalations 1 --max-frames 192 --max-action-frames 24 --max-seconds 60 --model-timeout 10 --adapter-timeout 5`, with candidate-specific legal options and observation profile. Provider choice and availability must be explicit. Existing clients disclose billing/queue as unavailable; a dollar cap cannot be inferred from token limits. No credentials or provider calls were inspected here. Retain events/decision reports and count actual calls; model configuration alone proves none occurred.

The tools already supply bounded stepping, actual-call reports and isolated native execution. The immediate blockers are game/runtime service closure and truthful adapter observations/checkpoints, not another playtester framework.
