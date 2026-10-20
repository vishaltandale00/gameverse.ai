# Life Relay: bounded authored L2 production

Request `life-relay-20261016` produces a new clean GBA cartridge by consuming seven distinct qualified automatic L1 behaviors in eight component instances. It uses the unchanged `tools/behavior_ir/compose.py` generator. No recovered behavior C, parent-ROM bytes, browser game testing, shared compiler changes or new dependencies were introduced.

The material addition over existing generated recipes is `sma1.death_update_lives`: post-acquisition DOWN schedules its recovered phase-2 countdown with timer 3 and two remaining lives. Three ordered invocations yield timer 2 → 1 → 0, lives 2 → 1 and completion signal 1. The authored scheduler consumes completion immediately and stops invoking the non-idempotent expired phase. The world gate now requires both the Minish-derived skill and this consumed life transaction. The altar trigger, scheduler, relocation, gate, world, projectiles and graphics are authored L2. Original SMA1 scene retry/gameover/persistence and automatic L2 recovery remain open.

`life-relay.composition.json` is the explicit wiring. It retains MZM steering/impact, Sonic gravity/integration and Minish inventory write/skill refresh. Death binds only its evidenced lives, animation phase, completion signal and timer ports; isolated remaining private state stays zero. No unknown position lanes are promoted. Input and ordered invocation are declarative existing Composer operations; generated C is an output and was not edited.

First attempt passed:

- New 65,536-byte ROM SHA256: `dbdf2753fa91b5b2cfe96e9c1b40cf5341dba8dd750a3a8cad3934020e5637e9`.
- Clean build: 0.121224084 seconds; no cache or parent-ROM input.
- Native route, read-only facts, screenshots and actual emulator video: 0.526934333 seconds, including nested encoding 0.071376 seconds. Bounded at 4,200 frames/30 seconds; actual 1,380 frames/457 game updates.
- Identity/ancestry evaluation: 0.021186417 seconds; exact ROM differs from ten retained prior clean-build receipts, including repeated Peach output.
- Initial skill absent/gate closed; acquired skill alone leaves gate closed; recovered countdown/life/completion enables gate; held DOWN for 90 frames leaves exactly three calls and one life; traversal ends with three defeats, skill 1, gate open and exit complete.

No failed attempt occurred. Queue time and interactive authoring duration are unavailable. No comparable prior Life Relay baseline exists, so these are measurements of this workload, not a speedup claim. Existing stage/resource caps remain unchanged. No broad matrix, CI stage or dependency was added.

Private outputs under ignored `local/ir/l2-production-20261016/`:

- `evidence.json`: source commit/environment, exact package/L1/receipt/adapter/original-ROM identities, ancestry, prior recipe identities and scope.
- `attempt01/build/{game.gba,build-receipt.json,generated.c,memory-profile.json}`.
- `attempt01/native/route-receipt.json`, eight actual PNG observations and `playthrough.mp4`.

Reproduce into a fresh directory using the unchanged Composer. `qualify_life_relay.py` is the bounded acceptance harness, currently pinned to `attempt01`; choose a fresh output before rerunning rather than overwrite proof. It sends native controller input and reads emulator facts; it never writes RAM or loads an authored state. The producer stage did not change the shared app registry or player progress. The later registration stage is recorded below.

Current status, updated 2026-10-16 after registration: Life Relay is registered through the existing Add to Play workflow as run `624dc495-5c34-4808-ae17-29be9295fb24`. [Open Life Relay in Play](http://127.0.0.1:4173/v0?view=play&game=ir-workshop). The final [website registration proof](../../ir-workshop/life-relay-20261016/verification.json), SHA256 `77810847c6db3ce82edc431d954a34e51551143e19c667240d9c74df32296d19`, verifies the served cartridge identity and retains the previous registration. The compiler owner also indexed the generation receipt at `local/ir/generated/624dc495-5c34-4808-ae17-29be9295fb24/status.json`.

Chronology clarification: the immutable producer-stage `local/ir/l2-production-20261016/evidence.json` and its imported snapshot were created before that registration. Their limitation “Fresh clean ROM not registered into shared generation request registry or Play UI” describes that earlier stage; it is superseded for current registration status by the final website proof linked above. That evidence wording was not explicitly dated originally. Neither the immutable evidence nor its hashed native/build artifacts was changed to reconcile the later event.

Human controls: acquire the skill, press DOWN to activate Life Relay, then continue right. DOWN is permitted anywhere after acquisition; there is no spatial altar predicate. Holding DOWN cannot consume another life after completion.
