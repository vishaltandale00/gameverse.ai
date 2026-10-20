# Echo Tactics — candidate B

A complete authored five-gate tactical microcampaign: readable enemy intent, selected targets, four-slot action queue, HP/focus, two earned capabilities, interrupted attacks, victory/defeat and restart. Source mechanics execute compiled C in WebAssembly. This is a new game using recovered systems, not a recreation of Minish, Emerald, FFVI or FireRed.

## Play and campaign

1 Strike deals5; 2 Guard blocks6 across the whole volley, heals2 and restores2 focus; 3 Ember deals4 to every living foe for2 focus; 4 Gale deals7 and exchanges the hero's queued action with the selected enemy's actual slot for2 focus. Left/right select a foe; R restarts. Holding a key does not create repeated turns. Observe the next queue and predicted Gale queue before committing. Earlier enemies still act when you exchange with a late enemy. Guard deliberately supplies recovery opportunities on weak encounters, with no turn-limit punishment.

The Threshold teaches basic damage and awards Ember. Ember Garden provides three chipped wards for area practice. Storm Reliquary alternates windup/crash and awards Gale. Crossed Paths makes early lethal-interruption safer than exchanging with a late weak ward. The Crown combines a windup/crash keeper and two additional threats. Each cleared gate restores8HP and focus. The ending reports the five actual restored gates, action counts and interrupted attacks.

Authoritative runtime: `src/playable-mashup-candidate-b.js`, version `echo-tactics-wasm-v4`. Async `createCandidate()` returns reset/step/observe/dispose. Snapshots include actual phase, gate/objective, HP/focus, source capabilities, selected target, enemy intents, before/after paired queue, planned queue/Gale preview, events, decision counts and source animation frame. Each instance owns a distinct WASM instance/state. Raw booleans use physical input edges; string actions are one-shot automation commands. Explicit commandId retries are deduplicated; denied IDs remain settled. Save/restore and migration are unsupported.

## Actual source execution

`bridge.c` includes unchanged generated C bodies from the previously qualified Minish progression and Emerald paired-order core, plus the FFVI HP core. The browser loads mandatory `/playable-assets/candidate-b.wasm` from the exact private allowlist. Missing/invalid WASM fails visibly; there is no JavaScript mechanics fallback. The old JS subset exports remain only a differential baseline. Generated copyrighted/native build material stays in ignored `local/`.

- Minish source script writes the canonical64-byte packed inventory; source refresh derives twelve skill bits. Assigning source item72/73 to the new Ember/Gale abilities is authored policy, not a claim those spells exist in Minish.
- Emerald source exchange swaps both action and battler lanes at the selected positions. **Both lanes drive execution:** action10 selects the chosen hero command; action21..23 selects an individual enemy action; battler0..3 supplies the associated actor. A broken pair is rejected before execution. This source primitive does not include the new game's authored action scheduler.
- FFVI source resolves accepted hit HP and pendingKO128 with a fresh actor0/VM entry per hit. Qualified fixture: maximumHP≤30, damage≤12, zero status/recovery/exclusion, effect mask1. Shared authored lifecycle realizes defeat exactly once and excludes terminal targets before further damage. This is not general FFVI combat parity.
- A fresh FireRed source presentation capsule is compiled into the same WASM. It owns source clip commands/delays/frame selection/flip. Actual ticks drive `player.presentation`; authored attack presentation selects east-walk for24 simulation ticks then east-idle. Source animation does not assert recovered attack choreography. Source frame-copy resource service and the browser renderer are authored adapters.

The rooms, enemy roles/AI, encounter progression, ability identities, numeric balance, focus/healing, guard priority, queue scheduling, KO realization and ending are authored. Shared lifecycle refreshes canonical capabilities before commands, deduplicates confirmations, excludes terminal contacts, settles death/cleanup once and samples input edges. The source assembly example under `schedule/` demonstrates guard/freshness admission; the complete microcampaign scheduler is explicitly authored.

## Verification and timing

From repository root, after shared WASI toolchain setup:

```
node research/ir-workshop/playable-mashups-20261016/candidate-b/verify.mjs
```

The bounded verifier builds actual WASM and native generated C, then compares1483 cases:1024 packed acquisition/skill cases,16 paired exchange cases,403 HP/KO fixtures and40 FireRed source animation ticks. It also tests a23-turn ordinary-action victory with7HP,13-turn naive-strike defeat, locked ability denial, duplicate confirmation, and exact gate4 consequences: early-target Gale leaves28HP and cancels the8-damage attack; late-target Gale leaves21HP because the earlier8+1 actions still execute. Both arrays and action-directed dispatch are asserted; malformed pairs are rejected. Player defeat cancels its queued action. Independent browser review is in the validation lane.

`result.json`, `wasm-build.json` and `final-manifest.json` pin actual sources, compiler, runtime, private WASM and presentation identities. The final retained representative run measured clean WASM compile159.51ms, native compile78.40ms, differential40.46ms and total383.37ms on local macOS/ARM64. These nested stages are not summed onto total. Queue/CI/baseline are unavailable. The older JS-only and three-gate WASM receipts remain explicitly labeled baselines and perform less work, so no performance improvement claim is made.

`attempts.json` retains initial failures: FFVI zero-damage does not create KO; a boss-first three-gate test loses and required actual target choice. Subsequent five-gate/source-lane refinements are documented as newer revisions. Native intermediates and WASM stay in `local/re/playable-mashups-20261016/candidate-b/`. No new CI jobs, broad exports or original-ROM campaigns were added. Toolchain setup duration is reported separately by its owner. Limits remain20s compilation,3s native execution and60 tactical turns per route.
