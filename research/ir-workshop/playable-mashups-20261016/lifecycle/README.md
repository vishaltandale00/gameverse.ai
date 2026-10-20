# Authored gameplay lifecycle services

`src/playable-mashup-lifecycle.js` provides three small candidate-owned services. They orchestrate recovered functions through callbacks; they are **authored runtime policy, not extracted IR or original-game lifecycle recovery**. They do not change source functions, the catalog, compiler or accepted game saves. Candidate owners wire the callbacks to actual generated consumers and remain responsible for motion, collision geometry, progression meaning and win/loss policy.

The policy follows observed integration failures in `../../mashup-experiments-20261016/{action,combat,progression,playtest}/README.md`:

| Observed sequence | Explicit runtime policy |
| --- | --- |
| Held equipped button admits another externally accepted contact | Declare each input action `press`, `hold` or `release`; only press actions require a fresh edge. Each admitted action receives an identity. Movement can intentionally remain held. Disabled physical edges are consumed. |
| One confirmation delivered twice exchanges both lanes back | Deduplicate confirmed command identity, not the exchange primitive. A distinct command intentionally exchanges again. Denied IDs are settled too. |
| HP3→0, reaction17→16, dead recontact resets17 | Read canonical source HP before contact; exclude dead actors; settle death, cleanup and reward once. Reentrant callbacks see the actor terminal. |
| Source protection query does not age its counter | A declared authored protection window excludes N subsequent simulation steps, aged at each step's end. This is invocation-unit policy; no real-time/source-frame equivalence is asserted. |
| Acquisition/revocation changes inventory while cache stays stale | Refresh immediately after mutation and again before each distinct capability consumer, including external canonical writes. |

The combat owner registers `getHp` over canonical source state, avoiding a second HP owner. An admitted hit invokes `applyHit`, which must execute the candidate's actual generated hit function. Source reaction prepasses remain separate source-eligible phases. One action may hit each target once; it can hit different targets. An active action identity is retired only after its collision lifetime ends. The candidate must call `beginStep`/`endStep` once per simulation invocation. `onDeath`, `onCleanup` and `onReward` are synchronous, as are progression callbacks; asynchronous initialization can happen before gameplay.

`reset()` clears service bookkeeping. Candidate reset must independently initialize the source memory, re-register fresh actors and clear world/objective/input state. An empty event drain returns an empty array. Event logs are drained by the candidate rather than persisted by these services. Source callbacks must be synchronous. A per-target guard rejects reentrant damage while a hit is applying. Callback exceptions propagate; the candidate must abandon/reset the failed step rather than assume a rollback of source memory. Terminal attackers are excluded by candidate scheduling. These are isolated in-memory services, with no durable checkpoint/migration claim.

## Focused verification

Run `node --test tests/playable-mashup-lifecycle.test.js`. Eight checks cover held attack versus repeatable movement, suppression/release, exact terminal recontact sequence, declared protection expiry, selective action-target deduplication, acquire/revoke freshness and duplicate confirmations, external terminal HP and fresh reset identities, plus distinct-action reentrant hit exclusion. The source callbacks in these unit tests are diagnostic fixtures; they are not source parity evidence. Actual generated-consumer integration is owned by the two candidate lanes and must be reported separately.

Final focused run: **8/8 pass**, Node reported **33.897667ms**; `/usr/bin/time -p` process wall time **0.05s**, user **0.05s**, sys **0.01s** on Darwin arm64 / Node v24.14.0. Earlier local run was 42.572292ms / 0.07s before explicit cleanup ordering was added; different code means this is not a performance comparison. Prior C diagnostic run times (combat attempt2 0.180517s and progression 0.122095s total) use different workloads/toolchains and are historical context only. No comparable before/after turnaround benchmark exists.

No dependency, CI job, broad native suite, model run or additional build stage was added. Source commit is `85e2139614e26e198b87bb92dadbd22de49da871` in a shared dirty checkout. Queue, CI, build/cache and model measurements are unavailable; simulation here means bounded unit sequences, not rendered game time. `receipt.json` pins the delivered module/tests and records this scope.

## Actual candidate integration

`node research/ir-workshop/playable-mashups-20261016/lifecycle/probe-candidate-b.mjs` imports Echo Tactics and executes its actual translated source callbacks through these services. Held attack, duplicate confirmation, distinct confirmation, first encounter reward/refresh, bounded unguarded loss, terminal attacker exclusion and fresh restart pass. Retained run took **1.565958ms** for initialization, assertions, simulation and disposal combined. This is headless candidate integration, not original-source parity or rendered play. `candidate-b-integration.json` pins the exact code and retains the first incorrect probe hypothesis: Guard correctly prevented the expected loss; the corrected strategy uses unguarded Strike. Candidate A integration and full victory strategies remain separately reviewed by candidate/validation owners.
