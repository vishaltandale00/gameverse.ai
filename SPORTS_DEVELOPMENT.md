# Soccer and American football development

The current local `/v1` world adds two original custom subgames:
- **Juniper Pitch** (*Alder Five*), a 5v5 soccer match including goalkeepers.
- **Foundry Field** (*Alder Gridiron*), a 7v7 American football match with two-way athletes.

Each opens on a team select and plays a full rules match against a rated CPU, or lets you watch CPU vs CPU. Each has its own procedural 3D venue and a ten-minute game clock. Enter from the world or its venue menu. FireRed remains at Alder Arcade; `/v0` retains the original FireRed collection.

Run `npm ci --ignore-scripts` and `npm run dev`, then open [local Gameverse](http://127.0.0.1:4173). The sports games do not require a FireRed cartridge or its source-build setup. Accepted requirements and the engineering contract are in [plans/SPORTS_LEAGUE.md](plans/SPORTS_LEAGUE.md).

## League, ratings and specialties

[`src/sports-league.js`](src/sports-league.js) holds four fictional teams per sport. No real teams, athletes, likenesses or branding appear.

| Soccer | Overall | Style | Football | Overall | Style |
| --- | --- | --- | --- | --- | --- |
| Alder FC | 77 | Balanced | Alder Arrows | 79 | Balanced |
| Ember United | 76 | High press | Canyon Coyotes | 78 | Ground & pound |
| Northgate Rovers | 86 | Possession | Ironwood Titans | 86 | Air raid |
| Salt Flats FC | 64 | Direct | Marsh Hollow Mudcats | 66 | Grit |

**Ratings (0–99) drive the simulation:**
- **Soccer:** Pace, Shooting, Passing, Dribbling, Defending, Physical. Keepers also have Diving, Reflexes, Handling, Positioning and Kicking.
- **Football:** Speed, Strength, Agility, Awareness, Throw Power/Accuracy, Catching, Route Running, Carrying, Break Tackle, Blocking, Pass Rush, Coverage, Tackle, Kick Power/Accuracy.

Speeds stay inside the Lean-certified displacement guards.

**Specialties:** each athlete has one or two, each with one stated, tested effect:
- Soccer (12): Finisher, Cannon, Playmaker, Trickster, Speedster, Wall, Interceptor, Ball Winner, Aerial Threat, Engine, Cat Reflexes, Sweeper Keeper.
- Football (14): Gunslinger, Surgeon, Escape Artist, Burner, Sure Hands, Route Artist, Bulldozer, Ankle Breaker, Edge Rusher, Brick Wall, Ballhawk, Enforcer, Lockdown, Big Leg.

**Team select** chooses the mode (play or watch), both teams and the difficulty (Amateur, Pro, World Class). Difficulty changes the CPU's reaction time and its decision and execution noise. The HUD shows team colors and overall ratings, plus the selected athlete's number, name, overall, specialties and key ratings. It also has an event ticker, the football quarter and timeouts, and a full-time summary with a player of the match.

## Playable scope

### Soccer

Carried over from the previous version:
- Analog movement, stamina, ball rolls, double touches, dragbacks, knock-ons and shot fakes.
- Charged assisted shots with optional curl; driven, lofted and through passes.
- Requested runs, shielding and jockeying.
- Committed tackles that must make contact; post and crossbar rebounds.
- Throw-ins, corners and goal kicks.

New in this version:
- **Keepers** dive toward the predicted crossing point, limited by reach and reaction. They catch or parry; parries create rebounds. Sweeper keepers rush out to claim.
- **Headers and volleys** strike balls at head height first time.
- **Ball contests:** hard passes can spill off a poor first touch. Shoulder challenges and 50/50s are decided by Physical. Fatigue builds over the match.
- **Fouls:** late or from-behind tackles give a direct free kick. A free kick has a 1–2 athlete wall, and the taker cannot dribble before kicking. Fouls in the box give a penalty.
- **Cards:** two yellows or a straight red sends the athlete off for the rest of the match. Keepers are never carded, and no team drops below two outfielders.
- **Offside** applies only in the attacking third, only on passes, and is whistled when the flagged athlete next touches the ball.

The built-in CPU scores shot, pass, through-ball, cross, dribble, skill and shield options. It uses ratings, lanes, pressure, the offside line and team tactics (press, width, directness, tempo).

### Football

Carried over from the previous version:
- Receiver-button passing with left-stick lead; QB keepers and physical handoffs.
- Jukes, spins, stiff arms and ball protection; wrap and dive tackles.
- Interceptions, downs, touchdowns and two-point tries.

New in this version:
- **Playbook:** offense has INSIDE RUN, SWEEP, SLANTS, CURLS, VERTICALS, PA CROSSERS and SCREEN, plus PUNT and FIELD GOAL. Defense has COVER 2, COVER 3, MAN, BLITZ and PREVENT.
- **Line play:** offensive-line vs defensive-line engagements and sacks.
- **Catches:** contested catches, drops, pass breakups and interceptions.
- **Contact:** fumbles with live loose balls, and broken tackles.
- **Special teams:**
  - Kickoffs from the 35, with returns and touchbacks to the 25.
  - Punts, and field goals through uprights on the end lines.
  - An extra-point kick or a two-point try after touchdowns.
  - Safeties, followed by a free kick.
- **Game clock:** four 2:30 quarters, with a 2:00 warning in Q2 and Q4 and two timeouts per half.
  - The clock stops on incompletions, out of bounds, scores, turnovers and timeouts.
  - It runs through the huddle after in-bounds plays; a 20 s play clock auto-snaps.

The built-in CPU calls plays from down, distance, field position, score, clock and team tactics, including fourth-down and two-minute decisions. It reads its quarterback progression by Awareness.

These are original soccer and American football games. [Gameplay references](SPORTS_REFERENCES.md) record the FIFA/EA FC, NBA 2K and NBA Jam material inspected, the specific transferable ideas, and whether the evidence was text, selected video frames or stills. Basketball was not added, and reference branding/assets were not copied.

## Controls

The current layout follows classic FIFA and Madden controls, adapted to these small-team games. **There is no right-stick ball aim.** Left stick moves and sets soccer pass/shot direction or football pass lead. Right stick performs skills. Labels use Xbox positions: A/Cross, B/Circle, X/Square, Y/Triangle.

| Action | Soccer | Football |
| --- | --- | --- |
| A | Ground pass; confirm kickoff | Snap; receiver A; hold to kick (meter); stiff arm with the ball; conservative tackle on defense |
| B | Shoot (also headers, volleys, free kicks, penalties); tackle on defense | Receiver B; spin with the ball; switch on defense |
| X | Lob; tackle on defense | Receiver X; dive tackle on defense |
| Y | Through ball | Unassigned |
| LB | Request run on offense; switch on defense | Unassigned |
| RB | Finesse shot / driven pass modifier | Protect ball |
| LT | Shield / jockey | Defensive strafe |
| RT | Sprint | Sprint |
| View / Back | Unassigned | Timeout |
| D-pad | Team select | Team select; play selection |
| Right-stick flick | Directional skill; defensive switch | Directional juke |
| Start / Options | Pause | Pause |

**Soccer passing and shooting:**
- Left-stick direction chooses a teammate in a passing cone and assists shots toward the goal.
- Hold the relevant button for power, then release. Passing, Shooting and pressure scale the error.
- Y leads a teammate into space, X gives the ball height, RB+A drives a pass and RB+B curls a shot.
- Pressing A during a B charge fakes the shot.

**Soccer skills:**
- Right-stick forward, back and lateral flicks perform knock-ons, dragbacks and rolls. An opposite lateral flick chains a double touch.
- Center the stick between flicks.
- Skills consume stamina and expose the ball when mistimed.

**Soccer set pieces:** free-kick and penalty takers use the same buttons.

**Football passing:**
- Football shows **A/B/X receiver icons**. Hold and release the receiver's button to throw: a brief tap lobs, a medium hold gives touch, and a longer hold drives a bullet.
- Left stick adds bounded lead. The ball travels physically and can be dropped, broken up or intercepted.

**Football kicking:** hold A to fill the kick meter, release to kick, and aim with left-stick x. If you stay idle, the CPU kicks after 6 s.

**Football clock:** View/T calls a timeout.

**Keyboard:**
- Both sports: **WASD** moves and directs, **Shift** sprints, **E + arrows** perform skills, **Enter/Space** confirms and **Escape** pauses. Arrows and **Backspace** operate team select and the full-time screen.
- Soccer: **J** pass, **K** shoot, **I** lob, **U** through, **F** modifier, **Q** run/switch, **R** run, **C** shield, **L** tackle.
- Football: **J/U/K** select receivers A/B/X, **Q** switches, **L** tackles, **C** protects, **V** strafes, **T** calls a timeout. Left/right arrows select the pre-snap play.

R3 remains voice feedback. Voice-owned B cancels any associated charge without firing. Controls must return to neutral on entry/resume; pausing cancels an unfinished charge. Menus use D-pad/left stick and A. B resumes where offered, and on the full-time screen B returns to team select. Sports use Start/Options for pause so Y can perform through balls. FireRed retains its own Start menu and host Y pause.

## Progress and runtime scope

Use **Save & return** in the pause menu to create a confirmed checkpoint and return to the world. Re-entering the same game version resumes that checkpoint. Abrupt closure only retains the last confirmed checkpoint. Saves are scoped by profile, game/version, source artifact, adapter and save schema. League models use soccer state version 4 and football schema 6. Earlier model states are rejected rather than migrated. The catalog's source-artifact save identity already keeps checkpoints from earlier sources out of the new game version, so they never resume into it.

The catalog captures immutable, content-hashed module snapshots including the selected sport, shared runtime/input, physics helpers and pinned Three.js dependencies. The served artifact and save identity use those exact bytes. The current custom adapter runs **trusted built-in modules synchronously on the main thread**. It is not a qualified sandbox for arbitrary untrusted generated games, and a blocking module cannot be safely interrupted by this adapter. The broader isolation requirement in the [subgame contract](contracts/SUBGAME.md) remains open.

This work extends Vishal's base-world and playable-subgame infrastructure. Shishir's independently owned improvement loop, algorithms and resource policies are unchanged; no automated generation or improvement pipeline is claimed integrated.

## League qualification — 2026-10-17

The [accepted requirements](plans/SPORTS_LEAGUE.md) are verified at three levels:
- Focused model tests.
- A free built-in CPU-vs-CPU batch.
- Live Decisions-API CPU-vs-CPU matches.

Raw reports stay under the ignored `artifacts/` directory. [Retained metadata](verification/SPORTS_LEAGUE_QUALIFICATION.json) binds every number below to its commit and source hashes.

### Built-in CPU vs CPU (commit `3279845`, clean tree)

`npm run sim:sports -- --specialties --ab 300` ran **13,144 deterministic matches** (Pro difficulty, seed 20261017, 12 worker threads).
- Wall time: **13.6 min** on an Apple M4 Max (14 cores), Node 22.23.2.
- Aggregate match work: 2.7 CPU-hours. This is runner work, not elapsed time; do not add the two.
- Per-match simulation time: soccer 0.99 s and football 0.61 s mean, with 12 parallel workers.
- No match failed to finish.

| Soccer (one 10-min match) | Result | Band | Football (one game) | Result | Band |
| --- | --- | --- | --- | --- | --- |
| Goals | 5.44 | 2–7 | Points | 30.4 | 14–49 |
| Shots | 16.7 | 8–24 | Completion | 69.1% | 55–75% |
| Pass completion | 75.9% | 70–90% | Interceptions per attempt | 3.1% | ≤ 5% |
| Keeper save rate | 61.7% | 55–80% | Yards per carry | 4.29 | 3.5–6 |
| Fouls | 1.57 | 1–8 | Run share | 33.0% | 30–65% |
| Mirror match, home share | 51.1% (46–44–10) | 40–60% | Mirror match, home share | 46.1% (41–48–11) | 40–60% |
| Northgate 86 vs Salt Flats 64 | 99% (99–1–0) | ≥ 75% | Ironwood 86 vs Marsh Hollow 66 | 100% (100–0) | ≥ 85% |

**How specialties are tested:** each one is A/B-tested by giving it to every athlete of one team (or removing it), with paired seeds and 300 matches per arm. All 21 specialties with a match-level statistic move it in the intended direction.

| Soccer specialty | With vs without | Football specialty | With vs without |
| --- | --- | --- | --- |
| Finisher, goals per match | 2.90 vs 2.21 | Gunslinger, completion | 72.0% vs 69.4% |
| Cannon, opposing keeper save rate | 58.3% vs 65.6% | Surgeon, completion | 69.2% vs 63.9% |
| Playmaker, pass completion | 77.8% vs 75.8% | Sure Hands, drops per attempt | 0 vs 3.3% |
| Interceptor, opponent pass completion | 73.5% vs 76.3% | Route Artist, completion | 82.5% vs 69.0% |
| Ball Winner, tackles won | 7.48 vs 5.37 | Burner, yards per play | 9.38 vs 8.67 |
| Wall, tackles conceded | 6.99 vs 9.00 | Ankle Breaker, yards per carry | 4.02 vs 3.59 |
| Cat Reflexes, save rate | 63.6% vs 59.4% | Edge Rusher, sack rate made | 6.2% vs 4.1% |
| | | Brick Wall, sack rate allowed | 1.9% vs 5.4% |
| | | Ballhawk, interceptions per attempt | 5.2% vs 2.9% |
| | | Enforcer, forced fumbles per play | 4.7% vs 2.3% |
| | | Lockdown, completion allowed | 61.2% vs 62.8% |
| | | Big Leg, field goals per game | 0.31 vs 0.27 |
| | | Escape Artist, sack rate allowed | 3.1% vs 3.3% (weak) |
| | | Bulldozer, yards per carry | 4.06 vs 4.02 (weak) |

The other five soccer specialties (Trickster, Speedster, Aerial Threat, Engine, Sweeper Keeper) have no clean match statistic; focused tests cover their stated effects.

**Iterations along the way.** The A/B gate drove real fixes, not just metric choices:
- **Big Leg** promised 10 yards but gave 8.
- **Gunslinger**'s CPU QB double-counted its faster ball by forcing tighter windows, which *raised* breakups.
- **Lockdown**'s shrunken cushion let receivers beat it deep, raising completions allowed.
- **Cannon** shots were capped below normal power.
- **Escape Artist** and **Ankle Breaker** were too weak to notice.

Two metrics changed:
- **Finisher and Cannon** moved from goals per shot because these specialties also change how often the CPU shoots. Finisher is now measured by goals per match. Cannon is measured by the opposing keeper's save rate, since its effect is shots that are harder to stop.
- **Gunslinger** moved from yards per completion to completion rate. Faster bullets beat closing defenders, while the extra range rarely binds on this field.

**Sample size.** At 30 matches per arm, noise flipped real effects in both directions. Treat runs smaller than about 100 per arm as smoke tests.

### Independent reviews

Fable reviewers audited the shared harness code and each game model. Their findings were fixed with regression tests.

**Soccer:**
- The CPU never pressed a stationary carrier.
- Shielding was undispossessable.
- Keepers were a binary wall, with unequal penalty timing for humans and the CPU.
- The ball could hover in mid-air.
- A third yellow card crashed saves.
- Offside was flagged on restarts.
- Saves were credited for non-shots.
- Finesse shots were strictly worse than plain shots.

**Football:**
- A defense could snap the CPU offense, defeating its clock management.
- A touchdown on the last play of a half lost its conversion.
- The two-minute warning could fire late.
- The wrong team kicked off after a conversion turnover.
- Some corrupt saves passed validation.
- Jukes exceeded the speed bound.
- A returner could back into his end zone for a free touchback.

**Shared code:**
- The replay viewer was blocked by the server CSP and its resize looped.
- Sent-off athletes leaked into Decisions observations.
- Retries escaped the call cap.
- Clicks in team select could act on a stale cursor.
- The worker pool could hang if a worker died.

### Live Decisions CPU vs CPU

`npm run decisions:sports -- --live` runs both teams on Decisions (`gpt-6-luna`):
- Each team's selected athlete presses raw controller buttons every 0.25 s through `SportsInput`; the other athletes are the built-in CPU at Pro.
- The two seats' calls run in parallel.
- Simulation time stops while the model thinks.

Six matches ran concurrently per round. In total, 12 live matches made **43,141 HTTP calls and used 118.0M input tokens**, with 15 retries, 13 transient errors (all recovered) and 3 refusals. Queue time, provider execution time and cost are unavailable from the API and recorded as `null`.

| Round, commit, profile | Matchup (overalls) | Final | Calls | Wall |
| --- | --- | --- | --- | --- |
| 1 · `2b62c24` · v2 | Soccer: Alder 77 – Ember 76 | 3–3 | 4,803 | 7.9 min |
| | Soccer: Northgate 86 – Salt Flats 64 | 5–1 | 4,805 | 8.2 min |
| | Soccer: Ember 76 – Northgate 86 | 7–4 | 4,804 | 7.9 min |
| | Football: Alder 79 – Canyon 78 | 25–13 | 2,430 | 4.0 min |
| | Football: Ironwood 86 – Marsh Hollow 66 | 20–0 | 2,294 | 3.7 min |
| | Football: Canyon 78 – Ironwood 86 | 18–14 | 2,536 | 4.2 min |
| 2 · `f7c32bc` · v3 | Soccer: Alder – Ember | 0–0 | 4,804 | 10.8 min |
| | Soccer: Northgate – Salt Flats | 3–0 | 4,805 | 10.9 min |
| | Soccer: Ember – Northgate | 0–1 | 4,804 | 10.7 min |
| | Football: Alder – Canyon | 0–14 | 2,602 | 5.6 min |
| | Football: Ironwood – Marsh Hollow | 6–27 | 3,172 | 7.0 min |
| | Football: Canyon – Ironwood | stopped at 3rd quarter, 0–0 | 1,282 | 2.2 min |

**What these runs establish.** Two Decisions controllers can play complete matches through the real input path and the full rule set:
- Fouls, yellow and red cards, offside, kickoffs, extra points, turnovers and quarter ends all occurred.
- The median request time was 135–159 ms.
- Every report's source hashes match its commit, and every run replays offline to the exact final state, or to its last recorded tick for the stopped run, in 0.5–2.2 s.
- `/sports-replay?report=<name>` re-simulates a report in 3D and checks each tick's state hash.

**What they do not establish is a strong Decisions opponent.** The raw-button policy plays poorly.

Round 1 offered every button:
- Soccer: it tapped B about 1,700 times per match, which in possession is a minimum-power shot, giving 36–47 weak shots per side. Taps of A made about 11% of passes complete.
- Football: it almost never changed plays (always the default pass), never rushed or punted, and completed about 33% of passes.

Round 2 offered only context-appropriate buttons and short tactical guidance:
- Soccer: it switched players about 1,800 times per match and created little (2–14 shots per side).
- Football: it began calling plays and running, but completed 8–39% of passes with up to 9 interceptions. Ironwood lost 6–27 to Marsh Hollow.
- One football run stopped at tick 639. The model refused the action question three times on a live fourth-and-10 pass, and the harness never substitutes a choice.

Zero sacks across both rounds is policy, not mechanics: a Decisions QB that holds the ball is sacked on 408 of 412 plays. The ratings and CPU balance evidence therefore comes from the built-in batch.

**Recommended follow-up:** a stronger Decisions CPU should choose key-moment intents (on-ball option, play call, QB read) executed by the built-in engine, rather than raw buttons every 0.25 s.

### Tests, build and formal audit

| Check | Before (`fb5335a`) | After (`3279845`) |
| --- | --- | --- |
| `npm test`, three runs, median | 261 tests, 1.85 s | 325 tests, 2.00 s |
| Clean `node scripts/build.mjs`, five runs, median (range) | 30.2 ms (28.8–34.5) | 31.3 ms (29.4–42.4) |

Both columns use the same machine, Node and `node_modules`, with no compiler cache. No CI job, CI matrix or dependency was added. The evaluator and live harness are separately triggered npm scripts.

The Lean audit (`node scripts/verify-sports.mjs --lean <pinned 4.35.0>`, run `sports-lean-2026-10-17T19-13-34.750Z`) passed:
- All 15 theorems.
- The generated sports kernel and the reused geometry runtime byte-match their proofs.
- 4.51 s.

The proofs, generated kernel and physics bridge are unchanged. Every athlete displacement, free ball flight, contact rebound and pair impulse in both rewritten models still goes through the certified acceptance checks. Rule logic, ratings, CPU decisions and rendering remain outside the proof.

### Running the evaluations

```sh
npm run sim:sports -- --game soccer                      # bands and balance only (~1–2 min)
npm run sim:sports -- --specialties --ab 300             # full qualification (~14 min on 12 workers)
npm run sim:sports -- --game football --only lockdown --ab 300
npm run decisions:sports -- --game soccer                # offline dry run, no API calls
npm run decisions:sports -- --live --env-file ../../../.env --game football --seed 201 --teams 0,1 --report artifacts/sports-decisions/run.json
npm run decisions:sports -- --replay artifacts/sports-decisions/run.json --report artifacts/sports-decisions/run-replay.json
```

**Live run limits:** `--max-calls` (≤ 20,000 HTTP attempts, retries included), `--max-wall-seconds` (≤ 7,200), `--timeout-ms` and `--retries` (default 2). Retries apply only to transport errors, HTTP 408/429/5xx and refusals, with bounded backoff.

**Report contents:** compact per-tick decisions and state hashes. Observations go to a sibling `.observations.jsonl` file.

**Replay rules:** replay requires the exact recorded source hashes. The browser viewer also accepts `classic-sports-v2` recordings, because v3 changed only which buttons a request offers.

### Known gaps

- **No human acceptance test yet.** No physical controller, and no extended real-time human playtest: the in-app browser pane was hidden, which throttles animation to about one frame per second. Team select, scoreboards, player cards, watch mode and the replay viewer were checked as rendered screens. The reviewers' scripted human-input probes (penalties, shielding, sideline runs, passing windows) are not a fun test.
- **Football rules:** no penalty flags, onside kicks, fair catches or muffs.
- **Soccer:** no separate volley animation, and no halves or substitutions.
- **Weak specialties:** Escape Artist and Bulldozer show small match-level effects.
- **Decisions CPU:** the raw-button policy is weak, as described above.

The sections below record the pre-league models and the earlier one-controller harness (`classic-sports-v1`, report schema 2). They are kept as history.

## Main qualification — 2026-10-16

The sports games are merged through [PR #14](https://github.com/vishaltandale00/gameverse.ai/pull/14), commit `b86969e`. Integration preserved the newer voice character creator: **229 tests passed in 1476.274625 ms** and the clean shell build took **27.1 ms**. The final harness correction has ten focused passing tests in **65.504625 ms**. No dependency or routine CI stage was added.

Lean **4.35.0** was reinstalled from the official Apple Silicon release, with SHA-256 matching the published `c0c6f34f35ba1dcc5c4a5fd106fefab9eb5e8469712624dd2c868d51b63177c2`. Download, checksum, extraction and version check took **19.69 s**, separate from verification. Fresh audit `sports-lean-2026-10-16T19-24-23.799Z` passed **15 theorems** and exact sports/geometry generated-byte checks in **4.266 s**. The numerical proof boundary in [SPORTS.md](verification/SPORTS.md) still applies; this is not whole-game verification.

[Retained qualification metadata](verification/SPORTS_QUALIFICATION.json) includes source hashes, commits, toolchain, per-stage timing, API usage, replay hashes, and all four live runs. Raw request/response logs remain under ignored local `artifacts/sports-decisions/`; they are not shipped with the game.

| Live run, 200 Decisions calls each | Result after 50 simulated seconds | Wall time | Offline replay |
| --- | --- | --- | --- |
| Original soccer policy | Remained on ready screen; no gameplay | 52.029 s | Exact final-state match, 1.693 s |
| Original football policy | 0–24, human–CPU | 49.413 s | Exact final-state match, 2.569 s |
| Soccer after menu-choice correction | 0–0; human team 10 passes, 5 shots, 2 tackles; CPU 13 passes, 3 shots | 56.716 s | Exact final-state match, 1.945 s |
| Football after menu-choice correction | 0–42; six throws to receiver A, all intercepted; no human completion | 50.210 s | Exact final-state match, 2.618 s |

The first soccer run spent its budget choosing ineffective gameplay buttons on the ready screen. The harness now offers confirm/wait and available play-selection buttons during menu phases, while leaving live gameplay choices unrestricted. It does not start a match or choose an outcome on the model's behalf. That correction is source commit `bea737a`; game/input/physics sources did not change. All four runs used the real Decisions endpoint with `gpt-6-luna`, `classic-sports-v1`, and the real input adapter. Each run was capped at 200 calls and 180 wall seconds, for 800 calls total. Concurrent sports runs must not have their wall times summed as critical-path duration.

These are useful failures as well as positive coverage: soccer now exercises passes, shots and defense, while football exposes a weak policy that repeatedly lobs/touches the same covered receiver and fails to defend. No live run selected a right-stick skill. Therefore these runs **do not qualify skill coverage, physical-controller feel, match balance, or a complete match**. Earlier browser journeys demonstrate the skill and receiver-catch paths separately. Every recorded run replayed exactly, with source hashes unchanged and no simulation validation errors.

The following sections retain earlier evidence, including the now-resolved missing-toolchain failure.

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
