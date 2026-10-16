# Slice 1 development

Status: in progress, 2026-10-16. **Pokémon FireRed is the sole initial game.** Mario is deferred by the latest user decision and does not block slice 1. FireRed uses editable source compiled into a cartridge artifact; cartridge import alone is not the development model.

The local launcher runs today. FireRed has a matching source build and browser boot/input/checkpoint evidence. The launcher contains only FireRed. The deferred Mario entry is excluded from the catalog and default game-status checks. Issue #3 remains incomplete. The source-edit experiment is a build probe, not an implemented improvement loop or campaign certification.

The latest user-authorized increment opens **Gameverse** at `/` or `/v1`: three original browser-rendered blocks with third-person walking/running and an **Alder Arcade** entrance to FireRed. Approach its marker, press E or controller A, and use FireRed's **Save & return to Gameverse** action to return to the same city spot. The original collection remains at `/v0`. Existing profile and save identities are reused. This prototype does not complete slice 2; see [neighborhood controls, source and checks](CITY_DEVELOPMENT.md).

## Run locally

Requires Node 22+, Git, make, a native C/C++ compiler, ARM binutils and libpng. On the verified Apple Silicon setup, Xcode tools and Homebrew libpng were already available; ARM binutils 2.47 was installed during this work. The macOS build uses Clang preprocessing and reproduces the expected FireRed SHA-1. Other toolchains are unqualified.

```sh
npm ci --ignore-scripts
npm run source:setup -- firered
npm run game:build -- firered
npm run dev
```

Open **http://127.0.0.1:4173**. Create a Gameverse character, then play FireRed. It still has its own trainer creation. Use the same origin/browser for progress; `localhost` and `127.0.0.1` have separate storage.

The server binds only to the loopback interface and serves an explicit file allowlist. Games, third-party checkouts, source-derived data and build logs remain in ignored `vendor/`, `local-data/` and `artifacts/`. No game download or external processing runs in the browser.

`npm run build` packages the shell/runtime only into ignored `dist/`. That output deliberately disables cartridge entries; use `npm run dev` for local source-built games. It is not a deployed or distributable game release.

## Editable game sources

Exact source/tool commits, game codes and expected baseline hashes are in [games/sources.json](games/sources.json).

| Game | Editable source | Build route | Current evidence |
| --- | --- | --- | --- |
| FireRed | [pret/pokefirered](https://github.com/pret/pokefirered), C/assembly | Pinned agbcc, ARM binutils, `make -j2` | Clean and incremental builds match original SHA-1; browser intro/tutorial, Start/A input and snapshot resume exercised |

For FireRed edits, change tracked source under `vendor/pokefirered` and rerun `npm run game:build -- firered`. A changed source tree produces a digest-addressed cartridge plus a candidate receipt under `local-data/candidates/`; it does **not** replace the selector's baseline. New source files must be tracked in that vendor checkout so the retained diff includes them. Failed builds leave the previous baseline intact. Candidate activation/migration and the actual improvement harness are slice 3 work.

An existing forest patch was applied, built into a distinct candidate and reversed from the source checkout. The launcher still points at the matching original cartridge. The candidate's gameplay has not been exercised.

## Controls and progress

- Keyboard: arrows = D-pad; X/Z = A/B; A/S = L/R; Enter = Start; right Shift = Select; Escape = pause/menu.
- Standard gamepad mapping: bottom/right face = A/B; shoulders = L/R; D-pad or left stick = movement; Start/Select as labeled. Y opens the Gameverse menu; Guide or both triggers also works. In Gameverse menus, D-pad/left stick chooses, A selects, and B resumes or goes back. USB Xbox detection and world movement were confirmed by the user; physical DualSense and full Xbox camera/button behavior remain unverified.
- Shell gamepad navigation uses directional focus and the bottom face button. Character creation includes a controller-accessible letter keyboard. Held buttons must return to neutral after a transition/reconnect.
- **Save & return** pauses execution, captures a snapshot plus paired cartridge-save bytes, and commits them atomically before terminating the worker. The normal save is also retained as a separate record. Snapshots are append-only and keyed to profile, game, cartridge SHA-256, core/loader SHA-256, adapter and snapshot format.
- Resume validates snapshot identity/digest and paired cartridge data, imports both into the same core, and checks the restored frame counter before running. This is for the unchanged cartridge/core only. Old code snapshots are not a migration strategy.
- Failed writes retain the prior head and show recovery. Failed restore offers retry by returning to the selector, or explicit normal-save fallback when available. Force-leave requires a second deliberate click and discloses unconfirmed progress loss.
- Per-profile/game Web Locks exclude simultaneous sessions; an IndexedDB revision check rejects stale writes. Abrupt shutdown recovers the last confirmed checkpoint. Browser data remains subject to browser eviction; clearing site data removes local profiles/progress. Back up normal saves using the pause menu.
- Native execution runs in a terminable worker. Load requests time out after 15 seconds, other requests after 5 seconds, and checkpoint transactions after 10 seconds. These are configurable-in-code development recovery bounds, not measured product SLAs. Real native-hang qualification remains open.

## Checks and observed timings

```sh
npm test
npm run build
npm run game:status
```

Six Node tests cover compatibility fields, cross-profile/game/core rejection, corrupt headers/payloads and standard controller mapping. Browser checks exercised atomic checkpoint commit, stale revision rejection, injected write failure preserving the prior head, duplicate-writer rejection, real FireRed save/return and close/reopen-tab resume. A stalled adapter-request test rejected after 5,001.5 ms; this is a suppressed-response test, not proof of recovery from a native infinite loop.

[research/slice1](research/slice1) retains sanitized build/qualification reports. Full command logs, diffs and candidate artifacts remain local under `local-data/`. Browser operation reports are stored separately in IndexedDB (`timing:<runId>`); the current page also exposes them as `window.__gameverseTimings` for developer inspection.

| Measurement | Actual result | Context |
| --- | --- | --- |
| agbcc bootstrap | 49.02 s elapsed | Separate setup; existing compiler/libpng, ARM binutils newly provisioned |
| Clean FireRed make stage / full request | 55.184 s / 56.869 s | Two jobs; empty game build directory; existing agbcc installation; host tools generated during make |
| Unchanged incremental stage / request | 0.328 s / 0.928 s | Same machine, source, cartridge hash and toolchain; existing generated objects |
| Forest source-edit stage / request | 0.959 s / 1.347 s | Same environment, one tracked encounter-data edit; distinct candidate only |
| Historical Mario readiness failure | 0.184 s request | Retained earlier result; Mario is now deferred |
| New-tab snapshot restore | 60.8 ms adapter stage | Core load/import only; stored and restored frame both 11,596; intro/tutorial checkpoint, not a battle |
| Shell copy | 20.2 ms | Approximately 1 MB pinned runtime plus native ES modules; excludes game builds/setup/tests |

These establish first baselines. Clean versus incremental are different modes, **not** an optimization before/after comparison. No earlier runnable shell exists for a comparable before/after measurement. CI queue/job/critical path, improvement-loop timings, real input-to-photon latency, audible audio quality, recovery from a native hang and campaign timings are unavailable. Browser frame matches do not certify mid-battle resume or full browser-process restart.

Default build limits are two jobs and five minutes per subprocess; override with `GAMEVERSE_BUILD_JOBS` and `GAMEVERSE_BUILD_TIMEOUT_MS`. Source reports retain run IDs, source/diff hashes, stage outcomes/durations, toolchain context and explicit unavailable metrics. Stage durations are nested in total request wall time and must not be added to it. The early reports pin game/core bytes and game source exactly; they were captured before the first implementation commit and do not contain a complete environment source fingerprint. This is a provenance gap, not a reproducible environment release. There is no new CI workflow or expensive campaign matrix.

## Remaining issue #3 gate

FireRed real overworld/battle progression and exact mid-battle restoration; normal in-game save/continue fallback with actual trainer progress; early/mid/late and campaign coverage; full browser-process restart and abrupt-termination recovery; physical controller/reconnect/focus proof; durable-storage/failed-restore and real worker-hang qualification. Vishal's hands-on acceptance still precedes slice 2.

Mario source notes and setup are retained in [the deferred plan](plans/DEFERRED_MARIO.md). They are outside the current delivery gate.

The original FireRed webpage is available at `/v0`; `/` and `/v1` open Gameverse, the 3D world containing FireRed at Alder Arcade. See [CITY_DEVELOPMENT.md](CITY_DEVELOPMENT.md) for separate configurations, controller controls, evidence and remaining qualification.
