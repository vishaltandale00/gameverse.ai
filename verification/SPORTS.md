# Sports physics verification

The soccer and American football simulations call generated acceptance kernels whose integer semantics have been checked by Lean 4.35.0. This verifies specific numerical substeps used during gameplay. It is not a proof of the entire physics engine, football rules, AI, rendering, controller hardware, or overall game quality.

## Checked properties and actual call sites

`verification/Sports.lean` imports the existing `Geometry.lean` and `Kernel.lean`. It uses their integer expression language and proved compiler correspondence. `GenerateSports.lean` prints the executable BigInt checks in `src/sports-certified.generated.js`.

| Theorem | Property on accepted integer inputs | Runtime connection |
| --- | --- | --- |
| `generated_sports_move_sound` | The nonnegative movement limit bounds the squared Euclidean displacement of the quantized endpoints. | `certifySportsMove` checks soccer athletes after movement/contact correction, and football athletes during movement and contact correction. Soccer currently supplies `9.5 * dt`; football supplies `14 * dt`. These are displacement envelopes, not a proof that every stored velocity equals actual displacement. |
| `generated_sports_flight_sound` | Positive tick denominator, nonnegative gravity, unchanged horizontal free-flight velocity, nonincreasing vertical velocity, and semi-implicit position/gravity residuals strictly less than one grid unit after division. | `stepSportsBall` advances unpossessed soccer balls and football passes. It accepts only the fixed `dt === 1 / 60` step. Football maps field coordinates into `x,z` and ball height into `y`. |
| `generated_sports_collision_sound` | Outgoing squared velocity magnitude does not exceed incoming magnitude. | `certifySportsCollision` checks soccer post and crossbar responses. Rejected proposals use a checked stationary response. |
| `generated_sports_floor_sound` | Collision energy does not increase and outgoing vertical velocity is nonnegative. | `stepSportsBall` applies this to floor restitution/friction. Ground-height projection is in the JavaScript bridge; the theorem concerns velocity, not conservation of gravitational potential energy during projection. |
| `generated_sports_pair_sound` | Equal-mass pair total momentum is preserved on all three axes and total squared velocity does not increase. | `certifySportsPairCollision` checks athlete contact impulses in both sports. It permits energy transfer to a previously stationary athlete. The bridge restores center-of-mass velocity before checking; rejected proposals preserve the incoming pair. |
| `generated_sports_swept_separation_sound` | A successful separator certificate keeps the relative center segment outside the open radius sphere at every rational interpolation time, with arbitrary positive common scale. | `certifySportsSeparation` uses the existing generated separator. Football `sweptCatch` calls it to certify definite noncontacts before running its floating quadratic impact proposal. |

The movement checks replace reliance on unchecked floating displacement proposals for these athlete integration paths. They do not cover deliberate formation resets, spawn placement, restarts, ball attachment to a dribbler, or every state mutation. Gameplay acceleration, shielding, ball rolls, jukes, curl and shot impulses remain authored simulation mechanics; their intermediate floating proposals are only covered where they pass through a documented guard.

The swept checker is a **noncontact certificate**. A `false` result means no certificate was found, not that a collision is proved. Football still computes possible impact times with floating arithmetic. Soccer's swept post/keeper intersection selection remains outside the swept-separation theorem; its rebound velocities are checked separately. Curved flight is stepped into segments; the theorem does not certify a continuous curved trajectory between samples.

## Exact model and trusted boundary

- Positions and velocities use a `2^16` grid. The shared `encodeGrid` routine decodes the IEEE-754 bit pattern before rounding, rather than multiplying floats and assuming the result is exact. Its supported input range is ±32768 world units. The bridge, its coordinate mapping, and integer-to-number decoding are audited JavaScript, not Lean-proved.
- Flight uses integer division at 60 Hz. Its residual theorem permits less than one grid unit of quantization error for each update. It proves the quantized discrete model, not equality to an analytic continuous parabola.
- The generated predicates decide acceptance. Floating clamping, direction/normal selection and other proposal generation cannot directly bypass them in these helpers. The JavaScript code must still call the right predicate with the right arguments and apply the returned result; that integration is part of the trusted computing base and is covered by focused tests and source review, not a whole-program proof.
- `Kernel.lean` proves the integer-expression compiler's correspondence to a small modeled BigInt target language. The string printer, actual ECMAScript BigInt implementation, Lean installation/kernel, filesystem, browser module loading and immutable-artifact routing remain trusted. Byte checks bind the checked generated text to the shipped source files; they are not a proof of a JavaScript engine.
- The axiom audit allows only Lean's standard logical axioms `propext`, `Classical.choice`, and `Quot.sound`. It rejects `sorryAx` and any additional axiom used by audited theorems. “No custom axioms or admitted proof” does not mean “no logical axioms whatsoever.”
- Contact energy uses a common mass factor, or equal masses for pairs. It does not prove unequal-mass collision laws, full angular momentum, animation forces, or global conservation across actively driven gameplay.

## Reproduce the check

With Lean 4.35.0 installed at the documented local path:

```sh
npm run verify:sports
node --test tests/sports-physics.test.js tests/custom-catalog.test.js
```

For another machine, supply the corresponding Lean **4.35.0** executable, or set `LEAN_BIN`. The default local location is `local-data/lean-verification/lean-4.35.0-darwin_aarch64/bin/lean`. This workflow installs no toolchain or dependency.

The script builds fresh `Geometry`, `Kernel`, and `Sports` proof outputs, audits required theorem names and their axioms, regenerates both sports and reused geometry JavaScript, and requires exact byte matches. It records the source commit, dirty working-tree state, source hashes, toolchain, individual stage durations, outcome and generated hashes in `local-data/lean-verification/sports-latest.json`, plus a run-specific report. `--write` is available for intentional regeneration after reviewing changed Lean definitions. It does not bypass proof checking.

Each Lean command has a 60-second default timeout. `SPORTS_VERIFY_TIMEOUT_MS` can explicitly select 1–300000 ms. No new CI job, matrix, dependency or long simulation campaign was added. Proof stages run serially; their durations are components of total execution time and must not be added to total a second time. Queue time is unavailable for this local invocation. A comparable pre-change formal-sports baseline does not exist.

## Recorded evidence

These are separate runs, not a before/after performance comparison. Later gameplay edits require current integration tests and fresh source hashes; an older report does not certify changed call sites.

| Run | Outcome | Observed wall time | What it establishes |
| --- | --- | --- | --- |
| `sports-lean-2026-10-16T19-24-23.799Z` | Passed | 4266.440375 ms (4.27 s) | Fresh audit after merging classic controls to main at `b86969e`: fifteen audited theorems and exact sports/geometry generated-byte matches. Official Lean archive checksum verified before installation. Full source, axiom and stage metadata retained in [qualification record](SPORTS_QUALIFICATION.json). |
| `sports-lean-2026-10-16T15-55-19.625Z` | Passed | 4740.6415 ms (4.74 s) | Fifteen audited theorems including six sports theorems; sports and reused geometry generated-byte matches. Node v22.23.2, arm64 macOS, Lean 4.35.0, base commit `b58ae3ee1aa5f7c24f67ddcc9c872a03e23fba27` with working-tree changes recorded in the report. |
| `sports-lean-2026-10-16T15-56-08.655Z` | Expected failure | 4372.2467 ms (4.37 s) | An altered temporary generated-JavaScript copy was rejected for byte mismatch. The real generated file was not modified. Recorded separately in `sports-tamper-check.json`; this is a successful negative check, not a passing proof run. |
| `sports-lean-2026-10-16T16-05-45.891Z` | Passed | 4587.861208 ms (4.59 s) | Fresh final audit passed all fifteen required theorems and exact generated-byte matches. Source hashes and stage timings are retained in its run report. |
| `sports-lean-2026-10-16T18-39-07.821Z` | Passed | 4677.4395 ms (4.68 s) | Final controller/skills pass, including restart buffering: fifteen audited theorems and exact generated-byte matches. Report includes current game, input, runtime, feedback and physics source hashes. This binds the audited scope to the source, without proving every change in those files. |
| Focused physics helper tests | Passed | 40.59 ms | Seven checks exercise teleport/diagonal rejection, discrete flight residuals, floor response, reflection energy, pair transfer, crossing/tangent sweeps, invalid input and metadata preservation. |
| Combined sport and helper integration tests | Passed | 737.23 ms | Fifty-three checks on the source at that run, including both sports' actual guarded mechanics and deterministic snapshot continuation. These tests do not replace the proofs or hardware play testing. |

## Immutable delivery boundary

Each custom artifact includes its selected sport, shared sports runtime/input/gamepad, the physics bridge, both generated predicate modules, the shared exact grid bridge, and the pinned Three.js module/core bytes. The catalog hashes framed filenames, byte lengths, and module bytes; its entry URL includes that digest. A shared runtime has two dynamic dispatch branches, but only the branch selected by that catalog game's fixed ID belongs to its artifact closure.

`tests/custom-catalog.test.js` checks exact byte hashing, the selected dependency closure, and preservation of captured maps/byte references across an unchanged catalog refresh. Those tests do not claim to prove arbitrary module-loader behavior or indefinite persistence of historical artifacts across a server restart.
