# Independent gameplay and mashup review

Review date: 2026-10-16. Inputs: current candidate implementations, candidate packets, shared renderer/runtime and integration contract. Initial review is source inspection; browser validation receipts are separate. No broad tests, dependencies or CI stages added. Review wall time and browser play time are not instrumented; unavailable, not zero.

## Initial decision

Both implementations have complete microgame loops, including ordinary input, rewards, victory, defeat and restart. Neither initial implementation meets the user's requested fleshed-out game bar. A deterministic victory and executing source WASM establish useful correctness boundaries, not substantial game design or source-game identity.

Relay Runner has the stronger flagship potential. Its actual Sonic Q8 acceleration, air steering, integration and gravity can produce continuous, recognizable momentum decisions. The initial single causeway and two sinusoidal contact enemies underuse those mechanics. Dragon Ball input edges and MZM HP/reaction are meaningful source execution but do not alone reproduce those games' fighting or encounter identity. Its Air Step is authored, not recovered Sonic behavior.

Concrete initial wiring defect: DB input WASM computes pressed/released/repeat, but jump and attack admission use the separate authored input lifecycle; only its held bits are consumed for movement. In this path held bits are merely the raw input copy. Builder was asked to consume recovered pressed bits for admission, preserving authored command IDs for deduplication, or explicitly downgrade the source contribution claim. Executed but redundant output is not composition payoff.

Echo Tactics initially has three short damage exchanges. Minish packed acquisition/skill refresh and FFVI HP/KO are real source behavior but generic engine plumbing from a player's perspective. Emerald paired exchange can become the distinctive composition when it changes individual queued actions; making one spell simply go first underuses it. No Aria behavior is present in this implementation. More source names and counters cannot resolve this gap.

## Bounded direction sent to builders

### Relay Runner: preferred flagship

Use course geometry and authored encounter policy to expose recovered motion, rather than adding arbitrary features:

1. Safe acceleration, braking and jump approach before the first relay.
2. A speed-sensitive combat approach where actual source velocity changes strike effectiveness.
3. An Air Step practice route after acquisition, then a higher route requiring it, with a readable checkpoint and safe recovery.
4. An armored encounter on a platform that makes approach direction, commitment and stopping distance matter.
5. A final telegraphed guardian combining motion, attack timing and aerial positioning, followed by the beacon.

The guardian needs charge preparation, charge and vulnerable recovery, not simply additional HP. These authored states must be labeled as authored. Visible momentum readiness, armor clang, attack direction, Air Step availability/consumption and guardian intent make simulation consequences intelligible. Source damage reaction fields should visibly affect feedback if claimed as part of the player-facing composition.

### Echo Tactics: tactical microcampaign

Use all four qualified paired-order slots: hero plus three individual enemy actions. Gale exchanges the chosen enemy's actual slot with the hero's slot. A late-target exchange must leave earlier enemies able to act. Show named queue positions, actor/action association and the selected swap destination. A killed enemy must lose its queued action.

At most five gates: basic strike/intent lesson; Ember group practice; heavy telegraphed threat introducing initiative; Gale practice with a lethal-interruption decision; combined finale with group pressure, windup/crash and finite focus. Encounter count itself is not acceptance: each encounter must introduce a materially different choice, with readable intent and resource consequence.

Guard stalling against a weak enemy is not automatically a defect; it can be a recovery decision. Avoid adding arbitrary timers merely to forbid it. Check whether a single dominant action/cycle trivializes every encounter.

## Acceptance boundary

For each source contribution record lineage, an in-game observable consequence, and why composing it with another system creates a new decision. Preserve authored/source distinction. Do not describe these candidates as source-original recreations.

Required independent recheck after builder changes: opening-to-ending ordinary controls; actual use of unlocks; repeated differing motion/target/initiative decisions; readable attack/hurt/intent; meaningful defeat and restart; pause/focus input safety. For B specifically retain evidence that killing before a queued action cancels it, an earlier threat still acts after swapping with a late target, and both arrays preserve actor/action association. For A exercise momentum versus armored defense and charge/recovery timing.

If only one candidate can receive coherent content and presentation, prioritize Relay Runner and retain Echo Tactics as an honestly named experiment. No claim that either initial baseline was fully featured is accepted. Final recheck remains pending candidate revisions and rendered evidence.

## Revision recheck

Source inspected: A `relay-runner-wasm-20261016-r3`, SHA256 `9a5933316801202dcd3a5dac86320727177747c4151fdbe03d7b70b5f16897af`; B `echo-tactics-wasm-v4`, SHA256 `70a3b1e9e705fa40c7b13987fcdd92cc0811de9328c4e70f0e34ab91f8e78315`. Shared renderer SHA256 `229d6bbb1ead096cfdb96524f41b8af83f786f98648c3200720b9c897057d50e`; host SHA256 `aa0a710bdb04947773e04639b46dc6f6660b878dbc63b7bc2db090eac9861755`.

The DB redundant-output defect is fixed: recovered pressed bit4 gates jump and bit8 gates attack; authored lifecycle retains action IDs. Recovered Sonic velocity drives motion, attack strength and whether the final shield accepts a hit. New recovered MZM reaction/update-gate output freezes enemy movement and guardian charge age while suppressed. MZM HP drives actual death, reward and objective progression. Guardian now starts a local telegraph clock on activation; the prior global-clock first-entry risk is fixed. Authoring still supplies terrain, Air Step, attack shape, damage magnitudes, protection, enemy AI, guardian states and world progression. This is substantive continuous-motion/combat composition, not a recovered whole Metroid or Dragon Ball combat engine.

B's initial action-array sidecar defect was independently caught: exchanging and observing both arrays did not make the action lane causal when dispatch used only battlers. V4 dispatch now selects behavior from recovered action ID and binds/validates the recovered battler ID, rejecting broken pairs. Both source lanes therefore matter. Minish canonical learned bits gate ability eligibility; FFVI HP affects living actors and terminal outcomes. Pending-KO status is retained while authored lifecycle realizes death; general FFVI statuses/ATB/AI are not present. The source order exchange now has a meaningful targeting payoff: choosing an early lethal foe prevents its action, whereas swapping with a later foe leaves preceding attacks intact.

Personal rendered interaction, ordinary controls only: played B from Gate1 through Gate4, striking to earn Ember, using two group attacks against three wards, alternating strike/guard against the storm, then earning Gale and selecting the default early striker. The visible NEXT and GALE SWAP queues matched that selected exchange. Gale dealt7, defeated the8-damage Dawn striker before its action, and the remaining two foes dealt2 total (HP30→28, turn9→10). One actual hero is displayed; the misleading second decorative party member is removed. Gate/HP/focus, selected target, enemy intent, group damage and learned ability availability were readable. This fragment used a page loaded before the final action-dispatch-only correction; final refreshed browser evidence belongs to validation. It is not a claimed complete browser campaign victory.

Final refreshed fragment: after both builders declared the above hashes frozen, reloaded the local page, selected Echo Tactics and pressed the actual Strike button. HP30→27 and turn0→1, with visible enemy/player damage and the persistent instruction “Defeat the sentinel to earn Ember.” Locked Ember/Gale remained disabled. Screenshot retained privately at ignored `local/re/playable-mashups-20261016/design-review/b-frozen-v4-strike.jpg`; it contains recovered pixels and is excluded from public research artifacts. This verifies the frozen presentation/action fragment; the complete B campaign and early/late-swap comparison remain separately scoped deterministic evidence. Also inspected validation's final A r3 Air Step screenshot: earned core, chapterII, visible AIR STEP READY, route sign, intact HUD and current high-relay objective are readable. I did not personally complete A in the browser.

### Scope verdict

Accept meaningful recovered-system compositions and coherent bounded game loops. A now has a traversal unlock and speed-sensitive guardian payoff; B has a five-gate tactical learning curve with group damage, storm timing and targeted initiative. Reject the claim that executing helper code alone established a mashup, and reject any unqualified claim of a large or fully recreated source game. A remains one1760px course with three enemies; B remains five short battles in one arena. They are improved compact games, with a narrow but real composition identity. Full end-to-end headless receipts, source differential receipts and final browser checks must retain their separate scopes. The user's broader fully-featured aspiration should not be marked fulfilled solely from this review.
