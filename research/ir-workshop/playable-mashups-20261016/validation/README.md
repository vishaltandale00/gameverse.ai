# Independent validation evidence

Final frozen revisions: **Relay Runner `relay-runner-wasm-20261016-r3`** and **Echo Tactics `echo-tactics-wasm-v4`**. `expanded-runtime.json` records the independent affected check with exact runtime/WASM hashes, zero imports, exports and12.122209ms total isolated simulation/initialization/assertion time. No build occurred here. Actual C→WASM artifacts are4043bytes (A, SHA256 `d41a5530f00528f5786495fb8c71d6cf4b0ea91df418b3773349bfdc1b30baf3`) and70450bytes (B, SHA256 `1a2359c49722e86edf9d8ed269deccf714a5444dd92028daae8c92c508b790ee`). Final owner manifests pin renderer, source bridge and private source artifacts separately.

Final independent direct checks passed: A real-input200tick movement→gap→HP9 recovery; B five-gate23turn7HP victory and fresh restart; early-target Gale cancels the8damage enemy yieldingHP28 while targeting a later enemy yieldsHP21; both invalid-WASM initializations fail visibly. Both source action and battler lanes are used by the final B dispatcher, which rejects inconsistent pairs. Source WASM C animation selects image/flip/delay; authored renderer consumes the result. Candidate-owned source differential and full A gameplay checks are separate evidence, not rerun here.

Final scoped browser check on fresh Ar3: held Right moves/camera tracks; fresh attack presses visibly damage and kill low sentry, unlock AirStep, change objective/chapter; actual Z jump shows airborne courier and AIR STEP READY. Readable momentum bar, world signs, source sentry art and chapterII verified. Screenshot `a-final-r3-air-step.jpg`. The final guardian/conduit and whole Ar3 browser win/loss remain untested by this lane; owner ordinary-input whole-course receipt verifies2224input invocations,8HP win, stationary shield denial, terminal freeze and both restarts. Final Bv4 browser visual/ordinary-control review is coordinated separately with the design reviewer. The complete browser win/loss evidence below remains explicitly the earlier three-gate WASM baseline.

Screenshots contain private recovered source pixels and are retained only in ignored `local/re/playable-mashups-20261016/validation/`; image names below refer to that directory.

Actual browser used: `http://127.0.0.1:4174/playable-mashups` through CUA In-app Browser. No state teleports or diagnostic RAM writes. No model calls: provider environment configuration absent (presence-only check); deterministic scripted checks and human-style browser controls are labeled accordingly. Browser operation time was not separately instrumented and must not be confused with CPU simulation time.

## Baseline actual WASM runtime

`wasm-identity.json` pins both real zero-import WASM binaries, exported recovered mechanisms, bytes and SHA-256. Deliberately invalid WASM rejects initialization for both candidates; there is no silent JS fallback. Runtime source inspection confirms source gameplay consumes `relay_input/relay_motion/relay_damage` and `b_learn/b_refresh/b_exchange/b_damage`. JS source helper exports remain differential baselines only. This is source C compiled to a browser module, **not a native ROM**. Authored world, scheduler, attacks/admission, lifecycle, objectives, art and scene policies remain explicit. Candidate-owned native/WASM differential receipts are separate; this lane did not duplicate those full suites.

`wasm-runtime-final.json` is the last pre-expansion direct check: 8.160208ms including isolated initialization, real control sequences and assertions. Build/evaluation/queue timing unavailable here; no compilation occurred in this check. No comparable before/after performance baseline exists. Source hashes in the receipt bind the code tested. Checks pass: A actual movement through gap→HP12 to9→safe spawn recovery (200 ticks); B duplicate confirmation preserves turn and HP; B full real-control route wins turn17 HP5; terminal command freezes turn; restart clears progress. `wasm-runtime-initial.json` is an earlier same-code8.53375ms check; its runId says baseline-js because files changed to WASM before it executed, but recorded runtime provenance/hashes show actual WASM. It is retained rather than rewritten.

Actual refreshed WASM browser checks:

- **Relay Runner:** held Right moves courier and camera; fresh attack presses damage and kill visible low sentry; objective changes to high relay and HUD says CORES1/2 AIR STEP. `a-wasm-combat.jpg`. Full WASM browser win/loss was not attempted independently; candidate owner has complete deterministic input route receipt.
- **Echo Tactics:** actual on-screen buttons complete entire route: Strike×2, Ember×3, target right, Guard/Gale×6 → Victory HP5/30 Turn17. `b-wasm-victory.jpg`. Restart button returns Gate1/3 HP30/30 Turn0, Ember/Gale disabled (`b-wasm-restart.jpg`). Ten direct Strike button presses lead to Defeated HP0/30 Turn10 and disabled commands (`b-wasm-defeat.jpg`). Full sprites, selected target marker, intent text, focus/ability cost labels and win/lose overlays visually inspected. No browser snapshot/restore, durable save, migration or automatic-update behavior tested.

## Findings and corrections

1. Real pre-WASM A movement-only fall at tick159 x680 y457 HP9 crashed because checkpoint reset received null camera. Reported owner, fixed valid camera; direct post-fix WASM hazard route passes. Earlier browser JS fall recovery also passed (`a-baseline-recovered.jpg`).
2. Actual short pointer clicks were lost before simulation sampled them: two initial B Strike clicks left Turn0. Renderer now latches pending edges. Post-fix WASM B full victory and loss used clicks, proving the fix in actual play.
3. Ripper source sprite packing omitted horizontal source offset; enemy appeared as orange flecks. Reported renderer; regenerated private atlas. Full orange sentries now visible in both refreshed WASM scenes.
4. B damage diagnostic counter never incremented in initial JS runtime. Reported owner; current actual hit callback increments it (31 source damage calls on direct winning route).
5. Schedule producer that both reads and writes freshness dependency could falsely certify postwrite freshness. Reported owner; conservative rejection implemented. See `SOURCE_REVIEW.md`.

Baseline JS browser evidence before WASM conversion: B whole keyboard win17turnHP5, restart and naive loss10turnHP0; A movement/combat AirStep and gap recovery. These do not substitute for current WASM checks above.

## Untested and limits

Final full A guardian browser play and exhaustive final B browser campaign are not established here; final direct five-gate route and scoped browser checks are described above. Whole original source-game closure, native ROM execution, accepted FireRed integration, durable checkpoint/restore, save migration, autonomous model play, broad adversarial input fuzzing and exhaustive collision/ability combinations are not established. Direct CPU simulation and screenshots establish only the explicitly described candidate versions and routes.
