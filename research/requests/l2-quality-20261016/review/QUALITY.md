# CINDER RUN independent native gameplay review

Status: **PASS for a bounded, readable combat prototype (attempt 04 only)**. No gameplay-quality blocker remains in the reviewed scope. Registration and Play-slot activation remain the coordinator/host owner’s responsibility; this review does not perform either action. This is not a finding that the game is proven enjoyable.

Reviewer scope: bounded native libmgba evidence, source-aware controller input timelines and 240×160 native observations; no browser gameplay, player RAM writes, broad CI or extra dependency. This is a short encounter review, not a claim that an automated script establishes fun.

## Acceptance frozen before promotion

- Entry must show title, goal, arrows/X/Z controls, health and visible locked exit legibly.
- Charger and turret must have distinct visible threats and readable pre-damage warnings. Native elapsed frames and authored update counts must be distinguished; source warnings alone are insufficient.
- Stationary spawn + fire must incur damage/failure or fail to win. Success must require an intentional movement/dodge/reposition decision, with native evidence of the decision and its effect.
- Shielded shots must produce visibly distinct block feedback and unchanged charger energy; recovery shots must cause actual source-backed impact and lethal pose/retirement. Retired threats cannot hurt. The exit requires both deaths.
- Failure and X retry must restore authored encounter position, hearts, enemy energy, projectiles and timers, and allow fresh movement without emulator reset/checkpoint writes.
- Success screenshots and input timeline must demonstrate playable goal completion. A short precomputed route is a correctness witness, not a player enjoyment finding.
- At most three native qualification episodes per iteration, each capped at 4,200 frames/30 seconds. Prefer combined failure/retry to leave room for a counterexample or intentional route.

## Attempt 01: rejected

Artifact SHA-256: `3c4dc290c12e6e4b2531f92a390d3a0c4b30f9816b1cc3a22a32848353f1dd21`.
Evidence: `local/ir/l2-quality-20261016/attempt01/careless/quality-receipt.json`, `playthrough.mp4`, native observations `observation-000001.png`, `observation-000003.png`, `observation-000010.png`.

Observed native evidence: holding GBA B at spawn produced three hurts, failure and no win by frame 582. Before the terminal action, shield_hits rose to five while charger HP remained four; by failure one valid hit reduced it to two, while turret HP stayed four. Charger windup, dash and recovery plus turret aiming/projectile cycles occur in the action facts. This supports a real counterexample to universal stationary spawn firing. It does not establish fair, readable timing until rendering is repaired.

Blocking native visual fault: inspected PNGs show near-black scenery/threats, missing health/objective/control footer, warning text overlapping title, and a black failure rectangle without readable retry instructions. Producer identified incorrect RGB values passed to an indexed-palette renderer and is repairing authored colors. Screenshots are authoritative over the intended render specification.

Retry receipt failed `retry reset incomplete`: the single three-frame A input left the old failure state in observed facts. Producer suspects input/snapshot cadence and will widen the native input window. That explanation remains a hypothesis until a fresh successful reset observation; this reviewer neither labels it a proven game bug nor accepts retry.

Actual episode wall time: 0.271924250 seconds, including nested 0.044067-second video encoding. 591 advanced native frames, 296 recorded frames, audio absent. Encoding time is not added to total. Queue and interactive review time unavailable. These are scope-specific timing observations, not a comparable before/after performance baseline.

## Design risks requiring native resolution

1. Original warning line spanned the floor without direction. Producer will add direction chevrons; inspect their actual rendering.
2. Shield block originally flashed white like a successful impact. Producer will distinguish the block feedback; inspect it against unchanged energy.
3. Central ledge may become a safe hold-fire perch and kill turret before its first meaningful pressure. Success must expose actual threat decisions; don't infer them from `jump_count > 0`.
4. Player has no demonstrated knockback or hurt animation beyond color/grace in the design. Judge whether actual heart change and grace feedback make damage readable.
5. Bot uses source facts and exact phase knowledge. This can qualify mechanics and gross pacing but cannot substitute for a fresh player's comprehension or sustained entertainment.

## Attempt 02: presentation repaired; completion initially unproven

Artifact SHA-256: `aca6ef8887eb1c180d0deb92a4bc5c7aac0a44bb641554777041c4be33f278bd`.

Independently inspected careless native observations 1, 2, 10, 14 and 15. Title, goal, health, controls and failure/retry text are now legible; separate charger direction chevrons and `SHIELD BLOCK` feedback repair the blockers above. Native holding fire causes three hurts/failure at frame 606. Frame 624 after 12 frames of A input shows hearts three, HP four/four, no failure/projectile, reset timers, position x24 and a newly started jump. Frame 648 right input moves x24→29. Held retry also triggers jump immediately; reset position is therefore only transient, but fresh play is usable. Careless episode wall time 0.283165041 seconds.

Independently inspected skilled native observations 2, 3, 5, 8 and 9 and its full action timeline. Player intentionally jumps right toward x113/ledge: turret locks y21 at native frame 96; first projectile is active by frame 168 while player has descended to y51, and it travels above the player. The player lands on ledge y96 by frame 192 and fires two actual impacts, turret energy four→two at frame 288 and two→zero with lethal pose 98 at frame 336. Projectile is retired with the turret. This is a real positional evasion witness and one threat's native combat proof. It is also an easy deterministic lure followed by stationary fire, not evidence of a rich sustained combat loop.

The initial skilled policy then fails its 4,200-frame budget: repeated ground-adjacent jumps at x60–80 avoid further hurt but spend recovery windows airborne, accumulate many shield blocks and never damage the charger. One hurt occurs on leaving the ledge. The retained failure is a routing-policy failure and incomplete encounter evidence; it does not by itself show an unwinnable game. Wall time 1.741259542 seconds including nested 0.159147-second video encoding. A final bounded route episode is requested; no additional broad campaign.

Telegraph pacing observed in that skilled timeline: charger windup visible from frame 6 through frame 90, dash begins by frame 96 (30 authored updates); turret lock visible by frame 96 and firing by frame 168 (25 authored updates). The source-aware sampling brackets transitions, so these are sampled native intervals rather than exact onset frames. Authored updates advance at a variable ratio to native frames; do not report a fixed 60 Hz authored update rate.

Remaining visual polish: the very high jump reaches y25 and overlaps the goal/HUD; the turret's aim line and projectile can pass through that text band. The encounter's intended terrain/control language remains legible most of the time, but this overlap weakens presentation. No audio is captured or assessed.

## Attempt 03: complete readable encounter; tactical gap identified

Artifact SHA-256: `2a8a31a6f89854a3e18fc8b46a42c34aaaba88c89b74798d14b25de739fef6f1`.

Independently read both receipts/full successful input timeline and inspected skilled native observations 2, 3, 4, 6, 7, 8, 9 and 12. Smaller authored jump leaves HUD clear (native trajectory reaches y85, not the producer's pre-run estimate of y64). Blue recovery was lengthened to 60 authored updates. Entry objective/control text, shield block cue, yellow/red/blue charger states, visible energy bars, clean threat retirement and unlocked exit are readable.

Successful controller route: one intentional jump onto ledge; turret locks height 79, fires by frame 180, misses the landed player and retires with energy four→two at frame 168, two→zero at 204. Player moves left off ledge during blue recovery, lands, faces/fires left: charger energy four→two at frame 342, two→zero at 369; source lethal pose 98 on both. Both defeated enemies disappear; exit stays locked before both deaths and opens at frame 369. Natural right movement reaches exit at native frame 549, won=1, hearts three, four hits, two kills, one shield block, six shots. This shows intentional positioning and a valid recovery punish, not merely a win flag. The native recording covers approximately 9.19 game seconds, not a sustained gameplay evaluation.

Fresh-human readability assessment: `SHIELD BLOCK`, an unchanged energy bar and subsequent `BLUE SHIELD OPEN` provide an understandable cause/effect rule. This is stronger than a hidden timed vulnerability. A new player has time to see the charger warning before the first dash. However, the player's successful policy knows exact source phases/positions; no fresh human has demonstrated learning the rule from the screen alone. The overly high jump/HUD blocker is resolved in this artifact. The basic rectangle silhouettes remain plain; this is a prototype presentation.

Careless/retry again passes on this exact ROM: stationary fire fails at frame 510; A reset restores three hearts/four energy on both/no active threat, then right input moves x24→29 by frame 552. Actual wall times: careless 0.252904250 seconds (nested encode 0.043098); success 0.264314292 seconds (nested encode 0.041309). No comparable latency benchmark or queue measurement.

Tactical blocker identified from authored geometry, not yet a native counterexample: charger endpoints 16/196 with 15-unit contact distance leave exit-side x230 outside its reach. After defeating the turret from the ledge, camping at the far right and holding left-facing fire could kill the charger automatically during recovery. Safe ledge alone cannot shoot the floor charger because projectile height is wrong, but the far-right refuge could remove the second encounter decision. Producer agrees and is making one bounded revision; direction-to-player plus clamp is insufficient unless actual dash range also reaches the target. Do not call the attempt-03 route proof of timing depth. Preserve it as successful playable prototype evidence while final tactical review remains open.

## Final attempt 04 verdict: bounded prototype pass

Accepted review identity: ROM SHA-256 `4b6538c12ee89644c13b1513c2ca98451ebb1db20ee36f9a2d0714324aa0d755`. Evidence is artifact matched across `local/ir/l2-quality-20261016/attempt04/{build,careless,skilled,camp}/`. Older attempts are retained and are not promoted by this verdict.

Final authored charger now chooses direction toward player at windup, travels long enough to reach either wall, and clamps x10..230. Independently inspected final careless native PNGs 1/2/9/10/13; skilled 2/4/7/8/9/12; camp 8/9/10/13, plus receipts and controller input timelines. No screenshot was substituted from an older ROM. These are actual native recorded observations; full videos are retained, but the review is selected-frame/timeline inspection rather than a fresh human playing the complete video in real time.

| Criterion | Native result and scope |
| --- | --- |
| Readable entry/controls | PASS: CINDER RUN, clear guards/reach exit, hearts, arrows/X/Z, locked exit. Title/HUD no longer overlap the smaller jump. |
| Distinct threat warnings | PASS: yellow charger direction chevron, red dash, blue recovery and text; separate red turret aim line before visible projectile. Telegraphs appear before the first hurt. Native timeline brackets about 90 frames of initial charger warning and about 72–84 frames between first sampled aim and firing; these are sampled intervals, not exact onset timestamps. |
| Real movement/shooting choice | PASS for a tiny encounter: intentional ledge jump changes shot height relative to turret aim; then leftward reposition and ground fire during blue recovery kill the charger. The successful route uses one jump, six shots, one blocked shot and four valid impacts. |
| Spawn blind fire | PASS counterexample: stationary B fire incurs three hurts and failure at frame 534, no win. |
| Shield and native impact | PASS: shield block increments without energy loss; final success shows turret 4→2→0 (frames 168/204), charger 4→2→0 (336/357), both source lethal poses 98, two kills. Native images show bar loss/flash and removal, distinct from SHIELD BLOCK. |
| Retirement/exit | PASS for observed route: turret projectile becomes inactive on retirement; dead guards are absent; exit opens only after second death at frame 357. Player crosses x224 and reaches clear result at frame 537, hearts three. |
| Failure/retry | PASS: three-heart failure screen readable; A at frame 552 resets hearts/energy/projectile/timers/encounter; subsequent right moves x24→29. Held retry also starts a new jump; this is visible and usable. No RAM writes or supplied states. |
| Exit camp counterexample | PASS: after same ledge/turret setup, player reaches x230, taps left at frame 351 and holds B. Shield blocks increase, proving shots face the incoming charger rather than firing harmlessly out of the arena. Charger reaches x230, hearts fall at frames 639/927/1023, and camping loses with charger energy four. The identified safe-wall strategy is closed in this ROM. |
| Pacing/feedback | PASS at prototype scope: clear ~9-second deliberate route, distinguishable phases, short failure→retry loop. Color/health feedback communicates damage; no knockback or audio was assessed. This is one short solved encounter, not a full game. |

The surviving limits matter: the turret can be predictably lured high and then killed by holding fire on the ledge; the charger can be killed during its first long recovery after approaching its endpoint. That affords a simple learnable two-step plan, but little replay variety. No fresh human comprehension test, controller hardware test, blind policy play, broad strategy search, audio review or longer-session engagement assessment was performed. Neither native `won == 1` nor this scoped pass is evidence that the player will find it fun. The evidence does support a substantially clearer playable prototype than the rejected mechanics-only presentation: readable objective, movement-dependent combat route, two threats, actual punishment of careless strategies, visible feedback and retry.

### Final measured cost and provenance

- Run/request: `l2-quality-20261016`, attempt04. Source commit `85e2139614e26e198b87bb92dadbd22de49da871` with dirty authored request assets pinned by build receipt hashes. Environment macOS 27.0.1 arm64, behavior-ir adapter 0.2, Apple clang 21.0.0; native libmgba 0.10.5, fixed RTC, HLE BIOS, 16,777,216 Hz / 280,896 cycles per frame.
- Clean/no-cache build: **0.120259333 seconds**, pass. No parent ROM input. Build stage/actual source-package digests are retained in `build/build-receipt.json`; no CI run was added.
- Careless+retry: **0.260976292 seconds**, 576 native frames, pass; nested video encode 0.043340 seconds.
- Deliberate success: **0.264385500 seconds**, 537 native frames (~8.99 seconds emulated play), pass; nested encode 0.040909 seconds.
- Camp counterexample: **0.416306000 seconds**, 1023 native frames, pass; nested encode 0.057033 seconds.
- Three final native episodes total **0.941667792 seconds** sequential wall time. Build plus those episodes is **1.061927125 seconds** of measured build/episode work; it excludes human/agent authoring and review. Encoding is already nested, not added. Each stays within 4,200 frames/30 seconds; no new CI, dependency, matrix or extra final episode.
- Queue time, interactive review/design time and a comparable baseline for turnaround improvement are unavailable. No throughput or latency improvement claim is made. Earlier failed attempts are preserved and remain part of this request's history; these final measurements are not total request latency.

Camp-input confidence note: the LEFT tap lasted only three native frames and no `facing` RAM field is exposed. Direct facing telemetry is therefore unavailable. Existing native evidence nevertheless establishes leftward shots: camp observation 8 at frame 447 visibly places a player bullet near x70 while the player is at x230; `shield_hits` rises from one at frame 351 to two at 495 with the charger at x10, then reaches six by frame 639. Shots directed out of the right edge cannot produce those left-side blocks, and the old ledge projectile is long gone. This is sufficient for this specific left-firing camp counterexample; no fourth episode or new build was needed. It does not certify every camping/shot-timing policy.
