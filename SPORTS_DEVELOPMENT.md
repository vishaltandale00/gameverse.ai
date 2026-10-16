# Soccer and American football development

The current local `/v1` world adds two original custom subgames: **Juniper Pitch**, a 5v5 soccer match including goalkeepers, and **Foundry Field**, a 7v7 American football match. Both are quick matches against AI with team control, separate procedural 3D venues, and approximately ten-minute match clocks. Enter from the world or its venue menu. FireRed remains at Alder Arcade; `/v0` retains the original FireRed collection.

Run `npm ci --ignore-scripts` and `npm run dev`, then open [local Gameverse](http://127.0.0.1:4173). The sports games do not require a FireRed cartridge or its source-build setup.

## Playable scope

Soccer includes analog acceleration/braking, stamina, directional ball rolls, double-touch exits, dragbacks, risky knock-ons, shot fakes, charged assisted shots with optional curl, driven and lofted passes, requested teammate runs, shielding and defensive jockeying. Tackles now require a committed lunge to make actual forward contact with the ball; possession is not transferred at the instant the button is pressed. Goalkeepers, swept ball contacts, posts/crossbar rebounds, goals, throw-ins, corners and goal kicks remain. Offside, fouls and cards are outside this arcade ruleset. The live sideline camera follows the ball and selected athlete more closely, while ready/restart views remain wider.

Football includes offensive and defensive play selection, snaps, receiver-button passes with left-stick lead, receiver control, QB keeper runs, physical sweep handoffs, protective carrying, stamina-limited jukes and spins, stiff arms, committed tackles with recovery, interceptions, downs, first downs, touchdowns and two-point attempts. Possession restarts after scores use a fixed starting position. Special teams are omitted. The camera looks downfield behind the offense.

These are original soccer and American football games. [Gameplay references](SPORTS_REFERENCES.md) record the FIFA/EA FC, NBA 2K and NBA Jam material inspected, the specific transferable ideas, and whether the evidence was text, selected video frames or stills. Basketball was not added, and reference branding/assets were not copied.

## Controls

The current layout follows classic FIFA and Madden controls, adapted to these small-team games. **There is no right-stick ball aim.** Left stick moves and sets soccer pass/shot direction or football pass lead. Right stick performs skills. Labels use Xbox positions: A/Cross, B/Circle, X/Square, Y/Triangle.

| Action | Soccer | Football |
| --- | --- | --- |
| A | Ground pass; confirm kickoff | Snap; receiver A; stiff arm with the ball; conservative tackle on defense |
| B | Shoot; tackle on defense | Receiver B; spin with the ball; switch on defense |
| X | Lob; tackle on defense | Receiver X; dive tackle on defense |
| Y | Through ball | Unassigned |
| LB | Request run on offense; switch on defense | Unassigned |
| RB | Finesse shot / driven pass modifier | Protect ball |
| LT | Shield / jockey | Defensive strafe |
| RT | Sprint | Sprint |
| Right-stick flick | Directional skill; defensive switch | Directional juke |
| Start / Options | Pause | Pause |

Soccer uses left-stick direction to choose a teammate in a passing cone and assist shots toward the goal. Hold the relevant button for power, then release. Y leads a teammate into space; X gives the ball height; RB+A drives a pass and RB+B curls a shot. Power, pressure, position and physical interception still affect outcomes. A during a B charge produces a fake shot. Right-stick forward/back/lateral flicks perform knock-ons, dragbacks and rolls; an opposite lateral flick can chain a double touch. Center the stick between flicks. Skills consume stamina and expose the ball when mistimed.

Football shows **A/B/X receiver icons**. Hold and release the receiver's button to throw: a brief tap lobs, a medium hold gives touch, and a longer hold drives a bullet. Left stick adds bounded lead; the receiver target is latched when charging starts. This timing is an original simplified arcade interpretation. The ball travels physically and can miss or be intercepted. Release A after snapping before throwing. Sweep performs a physical handoff after the snap. Carrying actions and defensive actions are contextual; they cannot also launch a pass.

Keyboard: **WASD** moves/directs. Soccer **J** pass, **K** shoot, **I** lob, **U** through, **F** modifier, **Q** run/switch, **R** run, **C** shield, **L** tackle. Football **J/U/K** select receivers A/B/X, **Q** switches, **L** tackles, **C** protects, **V** strafes. Both use **Shift** to sprint, **E + arrows** for skills, **Enter/Space** to confirm, and **Escape** to pause. Football left/right arrows select the pre-snap play.

R3 remains voice feedback. Voice-owned B cancels any associated charge without firing. Controls must return to neutral on entry/resume; pausing cancels an unfinished charge. Menus use D-pad/left stick and A, with B to resume where offered. Sports use Start/Options for pause so Y can perform through balls. FireRed retains its own Start menu and host Y pause.

## Progress and runtime scope

Use **Save & return** in the pause menu to create a confirmed checkpoint and return to the world. Re-entering the same game version resumes that checkpoint. Abrupt closure only retains the last confirmed checkpoint. Saves are scoped by profile, game/version, source artifact, adapter and save schema. The soccer model can migrate its version-2 state to version 3 without changing score, clock, ball position or athlete poses, and football includes its corresponding model-state migration. This does not bypass the catalog's source-artifact save identity or qualify arbitrary cross-artifact saves.

The catalog captures immutable, content-hashed module snapshots including the selected sport, shared runtime/input, physics helpers and pinned Three.js dependencies. The served artifact and save identity use those exact bytes. The current custom adapter runs **trusted built-in modules synchronously on the main thread**. It is not a qualified sandbox for arbitrary untrusted generated games, and a blocking module cannot be safely interrupted by this adapter. The broader isolation requirement in the [subgame contract](contracts/SUBGAME.md) remains open.

This work extends Vishal's base-world and playable-subgame infrastructure. Shishir's independently owned improvement loop, algorithms and resource policies are unchanged; no automated generation or improvement pipeline is claimed integrated.

## Classic-controls verification — 2026-10-16

The current controls above were checked through the real input adapter and in the rendered browser. [Verification metadata](artifacts/classic-controls/verification.json) binds source hashes, toolchain context and limitations; [test output](artifacts/classic-controls/tests.log) retains the full final local suite. **219 tests passed in 1608.074583 ms**, including receiver selection, actual catches, trajectory types, contextual action isolation, neutral gates, voice cancellation and fixed-step input retention. This is local execution time, not CI queue time. No CI job or dependency was added.

The final clean `dist` copy/bundle took **35.9 ms** with installed dependencies and no compiler cache. There is no isolated before/after turnaround baseline for this control revision. Earlier build timings below describe other source revisions.

Rendered emulated-controller journeys verified a standalone soccer RS roll, Y through ball without pausing, and B+RB finesse shot directed by LS while RS pointed the opposite way. Football displayed A/B/X icons, snapped with A, completed a B-receiver bullet with both sticks neutral, then performed an automatic Sweep handoff and standalone RS juke. Start pause and Save & return worked in both. The first post-catch juke attempt occurred as that play ended; a new Sweep play verified the juke. Traces retain both attempts. [Soccer capture](artifacts/classic-controls/soccer.png), [football receiver capture](artifacts/classic-controls/football-receivers.png), [soccer shot trace](artifacts/classic-controls/soccer-shot-browser.json), and [football trace](artifacts/classic-controls/football-browser.json) record the observed states. No browser console errors were captured. The test tab and controller override were removed; the original character was restored, with a separate Controls QA character retained for test checkpoints. This does not qualify physical-controller feel or commercial-game parity.

The Decisions harness now uses `classic-sports-v1` and report schema 2, with movement, skill direction and sport-specific actions. Both eight-decision **offline fixtures** and exact replays passed, including receiver tap/hold actions. Reports are `artifacts/sports-decisions/classic-{dry,replay}-{soccer,football}.json`. These are protocol/replay checks; no new live API calls were made for this revision.

A fresh Lean audit could not run because the previously installed executable at the recorded worktree path is absent (`ENOENT`, retained failed run `sports-lean-2026-10-16T19-10-18.486Z`). All five proof/generator sources, the physics bridge and the generated sports kernel match the prior successful audit `sports-lean-2026-10-16T18-39-07.821Z` byte-for-byte. This preserves evidence for those unchanged numerical guards; it is **not** a fresh proof of the revised control/target-selection code.

## Earlier gameplay pass — 2026-10-16

The measurements and recordings in this section predate the classic-controls revision above; they do not verify the new bindings.

This pass addresses the rejected first prototype's control and counterplay problems. It does not claim FIFA, NBA 2K or NBA Jam production quality. The meaningful changes are directional skill combinations with failure cases, possession decisions that create attacks, contact that must actually occur, a closer live camera, and visible/audible event feedback. Original sport/rule scope and the separate improvement-loop ownership remain unchanged.

### Controller response measurements

These are **derived model-step response times**, measured with comparable isolated inputs at 60 Hz on local Node 22.23.2. They are not controller hardware latency, browser input-to-photon latency, or a subjective feel score. The checkout base is `b58ae3ee1aa5f7c24f67ddcc9c872a03e23fba27`; source hashes for match reports are retained with those reports.

| Measurement | Earlier model | Current gameplay pass | Meaning |
| --- | --- | --- | --- |
| Soccer reaches 80% of regular running speed | 266.7 ms | 200 ms | Acceleration from rest, with other athletes away from the test lane. |
| Soccer reverses from full speed to 80% speed in the opposite direction | 600 ms | 383.3 ms | Momentum remains; braking and turn response are faster. |
| Football reaches 6.75 yd/s | 367 ms | 250 ms | Same isolated movement input and simulation rate. |
| Football reversal crosses zero velocity | 300 ms | 217 ms | This is zero-crossing, not the soccer 80%-opposite-speed endpoint. |
| Football 30-yard ball flight | 1.482 s | 0.957 s | Comparable throw distance; this measures ball travel, not input latency. |

That earlier revision retained fine right-stick input and used a latched precision chord. The classic-controls revision removes that aiming/chord scheme. Soccer sprint speed tapers with fatigue instead of oscillating at an exhaustion threshold. Movement, contact and flight still pass the existing generated numerical guards; faster response does not expand what those proofs establish.

### Playtest outcomes and defects corrected

The full evidence and reproducible commands are in [the bounded match playtest report](artifacts/sports-turn2/PLAYTEST.md). Policies use real `SportsInput` with 60 Hz controller sampling and 10 Hz decisions, without editing match state. They also see exact positions, so they are stronger and more precise than a human looking at the screen. Each result is one deterministic run, not a statistical balance estimate.

| Policy | Earlier result, human–AI | Latest independently checked model report | Interpretation |
| --- | --- | --- | --- |
| Soccer direct dribble/shot | 25–0; AI 0 shots / 419 passes | 21–8; AI 9 shots | AI can now form an attack and punish failed defense. |
| Soccer with aimed passing | 25–0; AI 0 shots / 382 passes | 7–10; AI 15 shots | The same policy can lose; passing is not a guaranteed advantage. |
| Football sweep | 78–8, largely interception returns | 12–18 | The repeated easy return-touchdown pattern was substantially reduced. |
| Football simple target-leading passes | 204–0, largely interception returns | 0–236 | That automated passing policy still chooses bad delivery points. This is a remaining policy/coverage finding, not proof that passing is impossible. |

Soccer's pass cascade came from carrying an idle decision timer into a new possession. Resetting it, requiring useful lanes/progression, and replacing instant tackle ownership transfers with timed physical contact changed the causal behavior. A later goal-kick trace found athletes stacked by the same boundary clamp; deterministic restart placement fixes that exact reproduced case. Final sampled distances are diagnostics, not a general proof of nonpenetration.

For football, an independent manual-input probe corrects the misleading implication of the failed target-leading policy: seven fresh drives used the same right-stick direction, charged for 0.45 seconds, and began charging at delays from 0.8 to 2.0 seconds. All seven completed a pass and earned a first down, gaining 11–14 yards. See [manual-window evidence](artifacts/sports-turn2/football-manual-window.json). It demonstrates usable later windows in that formation; broader offensive balance remains open.

The final model reports ran ten simulated minutes in **604.94 / 567.39 ms for soccer** and **676.56 / 538.04 ms for football**. These are local model execution durations, with no rendering or queue time. The reports identify their own immutable source hashes; the later football camera-only correction is not covered by those earlier model source hashes.

### Browser controller journeys

[Soccer recording](artifacts/sports-turn2/soccer-controller.mp4) shows a ball roll, reverse double touch, knock-on taken by a defender, a clean tackle that regains possession, and a charged shot ending in a goal. [Soccer event evidence](artifacts/sports-turn2/soccer-browser.json) records frames 4032–4335 and seven presentation events, sounds, and emulated haptic requests.

[Football recording](artifacts/sports-turn2/football-controller.mp4) shows an aimed trigger-charge pass, a visible flight, a catch and a **13-yard first down**. [Football event evidence](artifacts/sports-turn2/football-browser.json) records frames 1738–1786 and five presentation events/sounds/emulated haptic requests. These journeys used browser-emulated standard controllers. The actuator was a test double: requests were observed, not vibrations felt on physical hardware.

Both recordings are **canvas-only, without the HTML HUD or audio track**. They cannot by themselves demonstrate score/controls text, sound quality or hardware rumble. The JSON captures report approximately 120 rendering callbacks per second during these short journeys; that is neither a sustained frame-time benchmark nor a physical-controller acceptance test. Load timings in the same records are approximately 59.2 ms for soccer and 55.6 ms for football, with queue time unavailable.

### Current verification status

| Check | Status for this pass |
| --- | --- |
| Focused sports tests | Parent reported 101 passing tests in 1.104 s before final consolidated checks. Soccer's own 41-case suite passed in approximately 159 ms. Do not add these overlapping runs together. |
| Full repository tests and final delta | 183 tests passed in 1241.305 ms. Subsequent restart-buffer and observation fixes passed all 49 affected soccer/Decisions tests in 177.317 ms, including three new cases. These overlapping runs are not additive coverage counts. |
| Fresh final formal audit | `sports-lean-2026-10-16T18-39-07.821Z`: all 15 audited theorems and exact generated-byte matches passed in 4677.440 ms, with final gameplay source hashes. |
| Final build | Passed in 45.9 ms versus 32.8 ms before this gameplay pass on the same local Node/dependencies, clean output and no compiler cache. Final build overlapped validation work; this single-sample +13.1 ms difference is not an isolated performance regression estimate. |
| Decision-API playtester | Real API controller runs and exact offline replay completed; see the bounded evaluation below. |
| Physical-controller and human-fun acceptance | Not performed. Browser input emulation, exact-state policies and model tests do not establish these. |

The formal boundary remains the generated displacement, fixed-grid flight, collision energy/momentum and successful separation acceptance properties described in [verification/SPORTS.md](verification/SPORTS.md). Skill success, AI decisions, match balance, contact-witness selection, animation, rendering and enjoyment remain outside that proof. No new dependency, CI matrix, central loop orchestrator or production publication is introduced by this gameplay pass.

Both venues completed Save & return and re-entry in the browser, displaying “Exact confirmed snapshot restored.” Soccer restored its 0–1 score and restart; football restored the play-selection checkpoint. The running simulation advances immediately after restoration, so later diagnostic frame reads are not exact load-frame measurements. Final browser console inspection showed no application errors. The controller override was removed and the temporary viewport reset; the venue menu is left ready to play.

### Bounded Decisions API evaluation

`scripts/playtest-sports-decisions.mjs` calls the [official Decisions API](https://developers.openai.com/api/docs/guides/decisions) only with explicit `--live`, using `gpt-6-luna`. It converts visible field telemetry into movement, aim and button choices, then drives the same `SportsInput` adapter at 60 Hz. Each decision advances 0.25 seconds; simulation time stops during API thinking. This tests controller decisions and deterministic mechanics, not real-time visual perception or controller latency. The script records source hashes, observations, request IDs, usage, errors and bounded timing, and supports offline exact-state replay without an API call. No dependency or routine CI stage was added.

Initial 60-call runs for each sport completed without request errors and replayed exactly: soccer took 14.908 s wall time and football 13.444 s, with 15 seconds of simulation each. Soccer chose three passes and two tackles but no shot; football made two incomplete throws. Neither policy chose RB skills. These are retained failures/coverage gaps, not passing quality scores. The observations exposed expired status text, corrected by using the actual HUD message. The soccer run also exposed a genuine early restart press being discarded; a fresh press is now buffered through the brief restart delay, while an already-held button cannot trigger an unintended restart/pass.

After those fixes, [football's final live report](artifacts/sports-decisions/final-live-football-120.json) completed 120 decisions / 30 simulated seconds in 23.107 s wall time (median request 149.84 ms, p95 338.63 ms; 343342 input tokens). It chose an RB skill but demonstrated no completed human pass or touchdown, finishing this bounded segment at 0–0. [Soccer's final report](artifacts/sports-decisions/final-live-soccer-120.json) retained an unsuccessful run: 56 API calls, 55 executed decisions / 13.75 simulated seconds, 9.946 s wall time, 146564 input tokens. It executed two knock-ons but no shot or pass, and trailed 0–1. The last HTTP 200 response contained `{type:"refusal",name:"aim"}` without explanatory text; execution stopped without substituting a choice. Median request time was 159.14 ms and p95 341.54 ms.

The [football replay](artifacts/sports-decisions/final-replay-football-120.json) and [soccer executed-prefix replay](artifacts/sports-decisions/final-replay-soccer-120.json) matched their recorded final state hashes exactly in 1083.75 ms and 218.11 ms respectively. The two live jobs ran concurrently; their durations must not be summed as elapsed critical-path time. These model policies remain weak and do not establish human fun, visual understanding or complete skill coverage. The separate browser journeys and targeted mechanics cases supply that missing action coverage, while physical-controller acceptance remains open.

Run with an existing environment key: `node scripts/playtest-sports-decisions.mjs --live --game soccer --max-calls 120 --max-wall-seconds 180 --report artifacts/sports-decisions/my-run.json`. Replay with `node scripts/playtest-sports-decisions.mjs --replay artifacts/sports-decisions/my-run.json --report artifacts/sports-decisions/my-replay.json`. Reports are local qualification artifacts, not a central improvement-loop contract. API wall durations include request waiting; there is no CI queue or improvement-loop timing to report.

## Subsequent world-navigation correction

The mouse-opened world menu reproduced an invisible gamepad selection: focus moved to a sports button, but `:focus-visible` did not match after pointer input, leaving its outline `none`. Dialog buttons/links now show their focused state for controller-driven programmatic focus as well. Keyboard arrows previously did nothing in the menu; the actual host key handler now routes them through directional focus while preserving input-field editing. The regression failed with `Return !== Soccer` before the fix and passed afterward.

World geometry was not the blocker. New tests construct the actual scene collision map and use `NeighborhoodController` with standard gamepad inputs to walk from spawn to both sports markers and press A; an inserted wall is a negative control. The old nearest-venue HUD hid sports discovery at spawn, so a lightweight north-up SVG venue map now shows all three entrances and the player's view direction. It updates only its marker at 10 Hz and hides at an entrance to avoid covering the entry prompt. No dependency or CI job was added.

The 36 affected shell/world/controller/reachability tests passed in 323.259 ms. Build passed in 52.3 ms; there was no isolated matched pre-change build/render benchmark for this navigation correction, so no latency regression estimate is claimed. Browser checks covered D-pad and left-stick up/down, keyboard arrows, visible focus after mouse opening, a 17.7-second controller-only walk from spawn to soccer, a 5.7-second walk across to football, A entry, then Start → D-pad → A Save & return. Soccer entry correctly reported another tab already owning the same profile/game; football entered and restored its checkpoint. No application console error appeared. Browser controller input was emulated; physical hardware was not operated by the test.

Screenshots: [venue map](artifacts/navigation-fix/venue-map.png), [controller menu selection](artifacts/navigation-fix/menu-controller-focus.png). The isolated test tab and its gamepad override were removed; the user's active tab was not reloaded.

## Historical first implementation evidence

The first implementation's reported local test run passed **143 tests in 802.604375 ms**. Coverage includes sports mechanics, input ownership and neutral gating, deterministic snapshots, physics guards, and immutable catalog dependency closure. This is local execution time, not CI queue time or a production performance result.

Browser verification used emulated controller input to throw a football pass, pause with Start, navigate to Save & return with the D-pad, and reload the saved match at the exact recorded **frame 1657**. This demonstrates that journey in the browser harness. That journey did not test physical hardware. Later full-match model tests and browser clips are recorded in the current gameplay pass above; physical-controller feel remains unqualified.

The final football trigger check reached charge `0.454545` while live and unpaused, then released into flight (`elapsed: 0.15`, ball height `2.81017`). The [football gameplay capture](artifacts/sports/football-play.png) records its 1440×900 rendering. Browser timing records are retained in [browser-timings.json](artifacts/sports/browser-timings.json). The synthetic controller override was removed after verification. The console reported a Three.js multiple-instance warning from separate immutable artifacts, with no application error observed during these journeys.

The final soccer browser journey also verified a neutral kickoff with owner 3 and zero charge, an RB ball roll (`skillTime: 0.32`), LT+RT charging (`0.35185`) followed by an aimed shot (`vz: 24.68518`, `vy: 2.34494`), and disconnect-triggered pause clearing the charge. Save/re-entry restored **frame 882 exactly**, with a reported 31.1 ms load. Its session was `6fba6e31-d614-41d5-8185-3c2dadf9a223`, artifact `22e84a0887729f25cc5f7d70b79c93d76c7ff3e05325a83c1b6da54458e30191`. The [1440×900 gameplay capture](artifacts/sports/soccer-play.png) records the rendered result; these controls were browser-emulated, not physical hardware.

[Sports physics verification](verification/SPORTS.md) describes the six Lean-checked acceptance properties and their actual gameplay call sites. The initial positive proof/byte audit took **4.74 s**; a separate intentional generated-byte tamper check failed as expected in **4.37 s**. A fresh final audit, `sports-lean-2026-10-16T16-05-45.891Z`, passed all fifteen audited theorems and generated-byte matches in **4587.861208 ms**. These are distinct runs and outcomes. The proofs cover quantized displacement, discrete free flight, dissipative responses, pair momentum/energy and successful swept noncontact certificates—not the entire game, floating proposal generation, all collision timing, or rendering.

Comparable clean local shell builds measured **19.7 ms on `origin/main`** and **38.6 ms with the sports changes**, using the same Node/dependencies with no compiler cache. The increase was 18.9 ms in these individual observations; repeated-run variance was not measured. Build, test and formal-verification durations are separate stages and should not be added twice. Exact source hashes and detailed proof toolchain context belong to the linked verification report; a later source edit requires fresh relevant validation.
