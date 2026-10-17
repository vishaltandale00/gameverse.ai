# Sports league: ratings, real rules, CPU and CPU-vs-CPU verification

Accepted requirements (Vishal, 2026-10-16/17) for **Alder Five** (5v5 soccer) and **Alder Gridiron** (7v7 American football). These are original games: fictional teams and athletes only, no real names, likenesses or branding. Ownership: Vishal's subgame and play infrastructure. Shishir's improvement loop is unchanged.

## Requirements

1. **Ratings (0–99)** stored in `src/sports-league.js`.
   - Soccer: Pace, Shooting, Passing, Dribbling, Defending, Physical; keepers also Diving, Reflexes, Handling, Positioning, Kicking.
   - Football athletes play both ways (QB/S, RB/LB, WR/CB, OL/DL): Speed, Strength, Agility, Awareness, Throw Power/Accuracy, Catching, Route Running, Carrying, Break Tackle, Blocking, Pass Rush, Coverage, Tackle, Kick Power/Accuracy.
   - Every rating drives a concrete mechanic. Speeds stay inside the Lean-certified displacement bounds (soccer ≤ 9.3 m/s against the 9.5 guard, football ≤ 13.5 yd/s against the 14 guard).
2. **Specialties**: one or two per athlete, each with one measurable effect (`SPECIALTIES` in `sports-league.js`).
3. **Rosters**: four fictional teams per sport with distinct styles. Top-to-bottom overall gap ≥ 20. A controller-driven team select (mode, both teams, difficulty). The HUD shows the selected athlete's name, number, overall and specialties. Post-match stats and a player of the match.
4. **Mechanics**:
   - Soccer: rating-driven pass/shot error, first touch, shoulder challenges and 50/50s, keeper dives with reach/reaction plus parries and rebounds, headers/volleys from lofted balls, match fatigue.
   - Football: rating-driven throw accuracy/velocity, contested catches, drops and breakups, OL-vs-DL blocking, sacks, fumbles, broken tackles, a larger playbook with CPU play-calling and QB progression reads.
5. **Rules**:
   - Soccer: fouls → direct free kicks and penalties; yellow/red cards (two yellows or a straight red sends the athlete off for the match); offside in the attacking third only.
   - Football: kickoffs (opening, halftime, after scores), punts, field goals, extra-point kick or two-point try. Four 2:30 quarters, a real 2:00 warning in Q2 and Q4, 2 timeouts per half (View / T). The clock stops on incompletions, out of bounds, scores, turnovers, timeouts, the warning and quarter ends.
6. **CPU**:
   - Built-in rated CPU: whole teams, difficulty levels, team tactics. It is the browser opponent and the teammates of any controller-driven athlete. WATCH CPU VS CPU mode in the browser.
   - Decisions CPU: the Decisions API presses raw controller buttons every 0.25 s for each team's selected athlete, through `SportsInput`, in simulation sessions only. Both teams' calls are made in parallel per tick.
7. **Verification**:
   - Free built-in batch with gameplay-evaluation bands and rating/specialty sensitivity.
   - Live Decisions vs Decisions: 3 full matches per sport per round, full payload (≈30–40k calls, ≈85–115M input tokens accepted). Explicit configurable caps; recorded, exactly replayable, watchable in 3D.
   - Separately triggered npm scripts. No routine CI change.

Not included: real teams/licensing, online play, season modes, improvement-loop changes.

### Proposed gameplay-evaluation bands (one 10-minute match, built-in CPU vs CPU)

| Soccer | Band | Football | Band |
| --- | --- | --- | --- |
| Total goals | 2–7 | Total points | 14–49 |
| Total shots | 8–24 | Completion % | 55–75 |
| Pass completion % | 70–90 | INT % of attempts | ≤ 5 |
| Keeper save % (on target) | 55–80 | Yards per carry | 3.5–6 |
| Fouls | 1–8 | Run share of plays | 30–65% |

Sensitivity: in a mirror match (the same roster on both sides), the home side wins 40–60% of decided matches. A +20 overall team wins ≥ 75% (soccer) or ≥ 85% (football) of decided matches, alternating home and away. Every specialty moves its target statistic in the intended direction against a control roster.

## Engineering contract

Shared by `src/soccer.js` and `src/football.js`. Both import `src/sports-league.js`, which ships in each sport's immutable artifact (see `scripts/catalog.mjs`).

### State creation

`createState(options = {})`:

| Option | Meaning |
| --- | --- |
| `teams: [home, away]` | League indices; default `[0, 1]` |
| `difficulty` | `0` Amateur, `1` Pro (default), `2` World Class |
| `mode` | `'play'` (default) or `'watch'` |
| `seed` | uint32 |
| `setup` | Default `true`. `false` skips team select and starts at the sport's first in-match phase. Used by simulations and harnesses. |

The state stores `s.setup` (`createSetup`), `s.teams` (two `teamProfile` copies, including athlete profiles), `s.difficulty`, `s.mode` and `s.seed`. `validateState` checks all of them (`validateProfile`, `validateSetup`, `validSeed`).

Phase `'setup'` uses `stepSetup` / `setupHud`. Confirm starts the match.

- **Rematch** from `'finished'`: confirm/rematch keeps the teams.
- **Back to team select:** a separate B / `back` press returns to `'setup'`.

All randomness uses `random(s)`. No `Math.random`, wall clock or iteration-order dependence. JSON save → load → continue must be exact.

### Controller input

`step(s, dt, input)` accepts:

- **`undefined` or one controller input** (the existing `SportsInput.sample` shape): controls team 0's selected athlete and all menus. Team 1 is the built-in CPU.
- **`{ teams: [inputOrNull, inputOrNull] }`**: each non-null controller drives that team's selected athlete with the same semantics as the human controls. `null` means the built-in CPU drives that team, including its selected athlete. Menus (setup, restarts, play calls) accept the controller of the team whose decision it is; team 0's controller confirms shared screens.
- **`s.mode === 'watch'`**: both teams are CPU regardless of input. Input only operates confirm/rematch/back.

Both controllers share one screen frame:

- Soccer: screen +x is world +x; team 0 attacks +x.
- Football: "offense attacks up the screen", as today.

Harnesses mirror observations and actions per team. Models never mirror.

Each controller keeps its own selected athlete and charge/ready/receiver state. Selection, charging, ready gates and voice cancellation for team 0 behave exactly as before.

### HUD additions

`hud(s, team = 0)` renders from that controller's perspective:
- That controller's `power`, `charging`, stamina, skill state, hints and athlete card.
- Football also gets that team's `plays`/`selectedPlay`, `passType`/`selectedReceiver` and `receiverIcons`.

`selected`, `teams` and the score always stay in home/away order. It returns:

| Key | Contents |
| --- | --- |
| `teams` | `[{name, short, primary, secondary, ovr}, …]`. `teamNames` is derived from it. |
| `selected` | `[id \| null, id \| null]` |
| `athlete` | `athleteCard(sport, profile)` of the requesting controller's selected athlete, or `null` |
| `setup` | `setupHud(...)` in phase `'setup'`, else `null` |
| `summary` | `{ rows: [[label, home, away], …], star: { name, team, line } }` when finished, else `null` |
| `ticker` | Up to 4 `{ text, team }` major events, newest first |
| `period` | Football `'Q1'`…`'Q4'` or `'HALF'`; soccer `null` |
| `timeouts` | Football `[n, n]`; soccer `null` |
| `mode` | `'play'` or `'watch'` |

### Statistics

`s.stats` uses `[home, away]` arrays.

**Soccer:**
- `shots`, `onTarget`, `passes`, `completed` (pass received by a teammate), `tackles`, `saves`
- `fouls`, `yellows`, `reds`, `offsides`, `penalties`, `freeKicks`, `corners`
- `possession` (seconds)

**Football:**
- `plays`, `passAtt`, `passComp`, `passYds`, `rushAtt`, `rushYds`
- `ints`, `sacks`, `fumbles`, `fumblesLost`, `drops`, `breakups`
- `fgAtt`, `fgMade`, `punts`, `tds`, `firstDowns`

Each array entry counts what that team did:
- Soccer `fouls`, `offsides`: committed by that team. `yellows`, `reds`: received. `penalties`, `freeKicks`, `corners`: awarded. `saves`: by that team's keeper. `onTarget` includes goals.
- Football defense: `sacks`, `ints`, `breakups` are made by that team's defense.
- Football offense: `drops`, `fumbles`, `fumblesLost` are by that team's ball carriers and receivers.
- Sacks are neither rush attempts nor rushing yards.

Each athlete has `p.stats` for the player of the match. Specialties are read live from `s.teams[t].players[i].specialties`. The simulator A/B-tests a specialty by editing it right after `createState({ setup: false })`.

`s.events` is a ring of the last 40 major events: `{ frame, clock, kind, team, text }`.

### Feedback kinds

The existing kinds plus `whistle` (fouls, offside, quarter end, warning) and `card`.

### Invariants

- Every athlete displacement, free ball flight, ball contact and pair impulse still goes through `src/sports-physics.js` acceptance. Do not edit the physics bridge or the generated kernel.
- A 10-minute built-in CPU-vs-CPU match simulates in ≤ 2.5 s locally.
- `npm test` stays green and fast. Behavior that intentionally changes updates its tests; each new rule, mechanic, rating effect and specialty gets a focused test.
