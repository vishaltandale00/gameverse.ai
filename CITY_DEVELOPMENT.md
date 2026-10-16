# Alder District: first walking prototype

2026-10-16. This is the user-authorized neighborhood prototype: three original city blocks and a pocket garden, explored on foot in the browser, with an arcade entrance to the existing real FireRed session. It is not completion of slice 2 or a claim of GTA V fidelity. The existing FireRed qualification work remains open.

Run `npm ci --ignore-scripts`, then `npm run dev`. Root `/` and `/v1` open **Gameverse**, the 3D world with FireRed at Alder Arcade. `/v0` restores the original FireRed collection webpage. `games/configs/gameverse-v0.json` and `gameverse-v1.json` select the base and bind the same FireRed catalog/adapter identity; app versions do not split existing profiles or checkpoints. v0 does not load the 3D modules. Restart an older development server to enable the version/config routes.

## Controls and lifecycle

- WASD or arrows: camera-relative walking. Shift: run.
- Hold the left mouse button and drag: orbit. Mouse wheel: change camera distance.
- **Capture mouse** optionally enables pointer lock; drag-to-look remains available when a browser does not support capture.
- Escape, **Pause**, **Menu**, or controller Start opens the native Gameverse menu. Losing focus, hiding the tab, disconnecting the active controller, or releasing captured mouse input also pauses. Resume requires fresh input; controller buttons and both sticks must return to neutral.
- The v1 menu retains the scene, supports character selection, and links explicitly to the original `/v0` page. Graphics failures offer **Reopen Gameverse**. World position is retained within this page only; reloading starts at the original spawn.
- Find **Alder Arcade** across Alder Street from the spawn. The on-screen distance and amber **Pokémon FireRed** storefront sign identify it. Approach the pavement ring and press **E**, controller **A**, or click **Enter FireRed**. The entrance is at world coordinates `(-43, -19.8)`, outside the solid building facade, with a 2.8 m interaction radius.
- Entering FireRed suspends and hides the existing city instance. Its render loop and input remain paused throughout GBA play. The selected profile and existing cartridge/core-specific progress are reused. Without a profile, the existing character selector opens; choosing/creating a character continues the launch, and cancelling restores the walk.
- In FireRed, use **Pause / menu → Save & return to Gameverse** to commit the normal paired checkpoint and return to the exact city pose. The explicit leave-without-saving recovery path also returns to the city, retaining the prior confirmed save. Collection-origin games continue to return to the collection. A normal-save fallback preserves the original return destination.

Standard Xbox controls: left stick or D-pad moves, right stick looks, LB runs, A enters the arcade, and Start opens the world menu. Native menus use left stick/D-pad and A; FireRed retains its GBA mapping, with Guide or both triggers opening its host menu. Deadzones, analog speed, bounded diagonals, disconnect pause, and neutral rearming protect input transitions. The world owns controller polling during exploration; the shell owns native dialogs and GBA play. Hidden or unfocused shell polling cannot activate controls. Touch movement remains unimplemented.

## Source and scope

The world uses pinned `three@0.186.0` (MIT), served locally. The two required ES modules and license add 2,121,966 bytes before compression to shell packaging. They load only when entering the world. There is no CDN, bundler, physics engine, new CI job, or install script. WebGL2 is this prototype's rendering backend; browser-only execution is preserved. Backend choice does not establish visual quality.

All neighborhood geometry, seeded canvas textures, signs, sky and articulated character geometry are original source in this repository. No GTA installation, binaries, assets, mirrors, gameplay captures, or REA dependency are used. This increment does not claim measured reproduction of GTA camera or movement behavior. The character uses procedural joint animation; a realistic skinned character and production animation set remain future visual work.

| Source | Responsibility |
| --- | --- |
| `src/neighborhood.js` | Renderer, arcade proximity/presentation, pause/suspend/resume, recovery, frame loop and disposal |
| `src/neighborhood-world.js` | Three built blocks, park, architecture, props, procedural PBR textures, lighting and character |
| `src/neighborhood-controller.js` | Keyboard/mouse/gamepad focus, acceleration, movement, animation and camera |
| `src/gamepad.js` | Standard pad sampling, radial deadzones and neutral rearming |
| `src/application.js` | Validated version/config selection and compatible subgame binding |
| `src/neighborhood-math.js` | Editable walk/run speeds, spawn, world limits, collision and camera sweep |
| `src/main.js` | Guarded lazy world entry, profile/game launch and origin-aware return; shell input isolation |

Building, tree, prop and boundary collisions use static axis-aligned proxies and a circular player footprint with movement substeps. The camera boom sweeps against expanded proxies and retracts on obstruction. This is not a general physics implementation: there are no interiors, climbing, jumping, moving obstacles or animation-driven collisions. Individual facade trim and foliage are not collision geometry. Streets, sidewalks and ground are flat apart from automatic curb-height steps. The outer hedge bounds the explorable area; distant architecture is backdrop geometry.

There is no traffic, driving, persistent world position, background simulation or improvement-harness integration in this increment. Existing FireRed/profile/checkpoint record formats, the checkpoint transaction and cartridge identity are unchanged. Walking and city suspend/resume do not write world state to IndexedDB; selecting/creating a profile and saving FireRed use their existing storage paths. Future world persistence must use a separate versioned record and must not replace existing player progress.

Missing/unready cartridges are reported at the arcade without moving the player. Failures before a game session is created resume the city and release any acquired game lock. Failures after session creation retain the session origin for the existing retry/fallback/leave recovery paths. Repeated activation is guarded; movement requires a fresh key press after focus/scene transitions. A hidden or suspended world does not intercept Escape from FireRed. City position is retained only while this page remains open; full browser restart still recovers FireRed's last confirmed checkpoint through the collection.

Browser recovery testing exposed a pre-existing lock-release race when fallback immediately reacquired the same game lock. `storage.acquireSessionLock` now returns a release function whose promise completes when the underlying Web Locks request has finished, not merely when its callback is told to finish. Game teardown holds the busy guard and awaits that completion before exposing return or retry; profile creation also awaits its lock release before closing the selector. There are no sleeps or retry delays. A targeted regression test deliberately delays the lock manager handoff and verifies that awaited release permits immediate reacquisition. The failed browser attempt remains part of the browser qualification record.

## Verification and observed timings

Source baseline: `d63a776ebe8e6acb31839a6f854745a1f9c39034`, with the local prototype changes. Node 22.23.2 / npm 10.9.8, Apple Silicon development host. Run context: `neighborhood-first-walk-2026-10-16`. There is no improvement loop or CI execution in this run; their durations are unavailable.

The existing six Node tests plus five new focused checks pass. The new checks exercise diagonal-speed bounds, camera-relative input, thin-wall tunnelling, wall sliding, invalid-pose recovery, world bounds and camera obstruction versus low props. Syntax checks cover all new modules and the edited launcher. `git diff --check` passes.

[The browser review](research/slice2/browser-checks.json) records actual rendering, walking/sprinting, movement across the intersection, building collision, camera retraction, pause, collection return/reentry, and recovery from an injected graphics-context loss. Profile/selected-profile/FireRed progress-head metadata matched before and after; no FireRed play session was started. Native mouse capture was unavailable in the in-app browser; drag-to-look and keyboard movement remained usable. Physical controllers, real OS focus/visibility transitions, touch, persistence across reload and full slice 2 remain unqualified.

[The FireRed entrance review](research/slice2/firered-doorway-checks.json) subsequently verifies walking to the arcade, profile cancel/create, real FireRed boot and keyboard input, frozen city execution during play, save/return to the latched city pose, exact snapshot frame 3,189 on re-entry, force-return and collection-origin navigation. Cartridge-fetch failure preserved the checkpoint. Its initial fallback retry exposed the lock handoff race; after the fix the same retry loaded successfully without resuming the city between attempts. The record retains both outcomes. Testing used a separate `localhost` origin; existing `127.0.0.1` profiles and FireRed progress-head metadata matched before and after. The complete 12-test suite passed after the lock fix (1,330.5 ms runner; separate command wall time unavailable). Campaign, mid-battle, real trainer normal-save continuation and persistent city position across restart remain unqualified.

| Stage | Observed time | Context |
| --- | --- | --- |
| Baseline shell packaging | 22.7 ms inner / 0.13 s command | Before edits; clean output, installed dependencies, warm local filesystem |
| First packaging with neighborhood | 34.8 ms inner / 0.15 s command | Same host/command; adds two local graphics modules and source |
| Final source packaging | 20.6 ms inner / 0.13 s command | After controller/lifecycle review fixes; same clean-output mode, warm dependencies |
| Final browser-review packaging | 28.5 ms inner / command wall time unavailable | After recovery-copy, supported shadow-map selection and shell-focus visibility cleanup; same clean-output mode |
| Test suite | 1,014.1 ms runner / 1.13 s command | 11 tests, all passed; no campaign or simulation |
| Dependency installation | npm reported 984 ms | Pinned Three.js only; scripts, audit and funding calls disabled; excludes approval/tool dispatch latency |
| Arcade entry/return extension packaging | 29.7 ms inner / 0.13 s command | Same host, clean-output mode and dependencies; no new build stages |
| Arcade extension regression checks | 1,154.1 ms runner / 1.29 s command | Existing 11 tests pass; syntax/diff checks also pass; actual GBA transition verified separately in browser |
| Lock-release regression after browser failure | 40.0 ms runner / 0.06 s command | One targeted test; handoff completion and immediate reacquisition pass; launcher/storage syntax and diff checks pass |
| Packaging after lock-release fix | 26.2 ms inner / 0.16 s command | Same clean-output mode; packaged transition, storage and neighborhood modules byte-match working source |

The copy step is nested inside the command time; do not add them. These individual warm-machine samples establish observed overhead, not a performance improvement or stable SLA. Frame rate, GPU cost and load-to-first-render require browser evidence and depend on viewport/hardware. The development host is not an established minimum target.

For read-only browser diagnostics, `window.__gameverseNeighborhood.read()` reports position, camera distance, held input, lifecycle, rendered frames, first-render duration, recent frame rate and draw counts; `.colliders()` returns copies of collision bounds. These are local developer observations, not a simulation/control contract. No mutation helpers are exposed.

GTA V remains the visual reference. Current procedural architecture, foliage and character animation are visibly prototype quality; the next visual decision should follow hands-on review of this actual scene. No AAA parity, full-city scale, or quantitative performance budget is established.

## Version and controller acceptance

[Version/controller browser evidence](research/slice2/version-controller-checks.json) verifies v0 restoration with zero 3D resource loads; direct v1 world entry; simulated standard-pad movement, camera, sprint, arcade A activation, Start/resume, disconnect, character cancellation, GBA host-menu navigation, and Save & return to the same world pose. Both versions restored the identical existing FireRed snapshot at frame 3,613. The localhost test origin was isolated from user data; the existing 127.0.0.1 profile/selection/progress-head metadata remained unchanged.

macOS enumerated the Microsoft USB gamepad, and the in-app browser subsequently exposed a real standard controller. The user explicitly confirmed **“Controller connects and moves.”** Physical camera/buttons and long-session behavior remain unqualified; their current evidence is automated/simulated. Earlier browser reports above describe their own historical input scope.

The initial actual-controller-seam movement regression failed before implementation (38.38 ms runner), then passed (38.83 ms runner for the comparable single test). Eight controller checks passed in 43.01 ms. Final combined verification passed **26/26** tests in 1,224.1 ms runner / 1.36 s command. Clean-output packaging took **35.8 ms inner / 0.17 s command**, with installed dependencies and a warm filesystem, concurrently with tests on the same Apple Silicon host/Node 22.23.2/npm 10.9.8. This is not a controlled before/after latency comparison; the earlier 26.2 ms packaging sample ran under different concurrent load. No dependencies, CI jobs or build stages were added for the version/controller extension. CI, queue and improvement-loop measurements remain unavailable. Packaged app/config bytes and both route documents matched source; diff checks passed.

The evidence retains a CDP command timeout during the longer simulated walk (the page continued and later confirmed arrival) and automatic approval review's rejection of discarding unsaved test progress; Save & return completed that journey instead. Source baseline and current file fingerprints are recorded in the report.

## Full viewport subgame and controller menu

FireRed opens into a black full-viewport stage automatically in both versions. Its 3:2 pixels scale to the largest image that fits without stretching; browser/app chrome is outside this stage. The compact Gameverse menu button remains available, and the initial controls hint fades after eight seconds.

During FireRed, **Y** opens the Gameverse pause menu. **Start** and **View / Back** remain FireRed's Start/Select buttons; A/B and LB/RB remain game controls. Guide or both triggers also opens the host menu. In Gameverse dialogs, D-pad/left stick chooses, A selects, and B goes back/resumes. In the world menu, Start also resumes. To save and exit FireRed using only the controller: Y, Down to **Save & return to Gameverse**, then A. Saving commits the existing checkpoint and returns to the arcade; no separate mouse action is needed. Controller inputs must return to neutral after switching contexts.

[Full viewport/controller acceptance](research/slice2/fullviewport-controller-checks.json) verifies a 1,280×720 viewport with a 1,080×720 game image, and an 813×853 viewport with an 813×542 image; both retain the exact 3:2 aspect without scrolling. Browser testing used a simulated standard pad to enter FireRed from the city, open Y, resume with B, navigate and save with D-pad/A, and return to the identical city pose. A held A cannot reopen the cartridge; releasing rearms the world. Reentry restored the newly saved frame 7,049 exactly. The current user profile form was left intact; no active user session was reloaded.

The first rapid D-pad→A attempt failed because the existing 180 ms navigation throttle swallowed the A edge. A focused regression reproduced that failure (8 passed/1 failed, 46.47 ms runner); after restricting the throttle to direction repeats, all nine shell-input checks passed (46.48 ms). The browser then saved successfully with only 17 ms between releasing Down and pressing A. Final combined verification passed **32/32** tests in **1,008.3 ms runner / 1.14 s command**. Packaging took **31.2 ms inner / 0.16 s command**, clean-output mode, warm installed dependencies, concurrently with those tests on the same host/toolchain. The previous sample was 35.8 ms / 0.17 s with 26 tests; differing test load prevents treating this as an optimization measurement. No dependency or CI/build-stage additions. Packaged edited app files matched source.

[The audio exit diagnosis](research/slice2/audio-exit-checks.json) found a separate older browser tab still running FireRed. Pausing left zero scheduled voices; Save & return disposed its adapter, terminated its worker and closed its AudioContext. That tab was then moved to `/v0`, preserving its saved checkpoint. The other tab’s open profile form was left intact. The in-app documents could both report focused/visible, so tab switching alone is not proven to pause every page. Cross-tab foreground ownership remains unimplemented. A read-only adapter probe also found a separate bounded resume/pause audio race; no sustained audio after disposal was reproduced, and this diagnosis did not change the adapter.
