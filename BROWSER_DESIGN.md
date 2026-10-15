# Browser version of the Gameverse proof of concept

Yes: the mission-free city, character creation, NPCs, basketball and creature RPG can all be played in a desktop browser. The same controller button can record improvement requests in every game. A browser is a delivery platform; it does not require a different concept or a narrative connecting the games.

This is a researched design amendment to `POC_DESIGN.md`, not a running browser prototype. The prior desktop design remains available for comparison. No engine export, performance benchmark, microphone recording or controller hardware test was performed for this amendment.

## Recommended first architecture

Start with **Godot web export plus a custom HTML/TypeScript shell and a local companion worker**, targeting Chrome/Edge on the user's computer first. Keep one Godot runtime and switch between the city and two subgame scenes. The persistent shell presents recording, job status and trial/accept/revert UI throughout.

| Component | Responsibility |
| --- | --- |
| Browser | Render/simulate the games, controller/keyboard input, setup overlay, microphone recording, request submission and change review |
| Local companion | Serve the browser app and API from one localhost origin; transcribe audio, persist jobs, run the configured processor, build candidate exports and retain save/version checkpoints |
| Processor adapter | Select rules-only, planner or hybrid routing; produce the same validated operations described in the existing design |

The page communicates with the Godot runtime through [JavaScriptBridge](https://docs.godotengine.org/en/stable/tutorials/platform/web/javascript_bridge.html). The game shell forwards the reserved feedback action to JavaScript; ordinary movement stays in the game. Give overlays explicit input ownership so a menu press never also shoots or moves the character. Use one reserved-button handler, not independent handlers that both start recording.

The companion must be installed and started outside the browser once; a launcher can start it and open the page. A normal web page cannot independently start the local build toolchain. After this bootstrap, routine play and change review stay on the game display. Serve from a stable localhost port/origin, rather than opening an HTML file directly.

If the eventual requirement becomes “open a URL on any computer with no installation,” move the worker to a hosted service. That is a different deployment choice with server costs and remote processing. A browser-only static page can support bounded rule edits, but is not the full local coding/build improvement loop proposed here.

## Changes needed to the candidate base

Godot supports browser exports using WebAssembly/WebGL 2 and the Compatibility renderer. Forward+ does not run on the web. Start with single-threaded export to reduce hosting requirements. [Godot web export documentation](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html).

The previously inspected Night Drop/GTA-mini checkout uses Forward+. Port its renderer/materials and measure the trimmed city before committing to it as the browser base. Its existing mission/wanted behavior still needs removal; controller support, character creation and saves remain new work. Browser export does not supply these features automatically. See `BASE_GAME_CANDIDATES.md` for the pinned source audit.

Keep the first scene modest: one connected district, low-poly buildings, bounded NPC counts and no requirement for GTA-scale graphics. If this base cannot meet the browser performance gate after reasonable trimming, assess a browser-native engine such as Babylon.js as a fallback. That would require porting/rebuilding the game systems; it is not an automatic conversion of the Godot project.

## Controller and voice flow

1. Initial setup: connect the controller, press a button to detect it, test mappings, allow the microphone and enable game audio. Browser permission/fullscreen controls may require a mouse or keyboard action. Do not promise completely controller-only permission setup.
2. During any game, tap the mapped feedback button, provisionally R3; show recording state and pause gameplay. Tap again to stop; Back cancels. Keyboard fallback remains F8.
3. Record with `getUserMedia` and `MediaRecorder`, show the transcript, then queue the request with the active module ID, world revision and a unique request ID. Select a supported recording MIME type and let the worker decode/resample it; do not assume browser recordings are WAV.
4. The companion processes the request. The browser shows queued/working/ready/needs-help states. Known rule changes can be previewed immediately; code changes produce a separately built browser export.
5. Trial against a copied save. Accept or revert with the controller. A code candidate can require a checkpoint and page reload; preserve the shell/profile through versioned state rather than promising seamless arbitrary code replacement.

Browser controller support is provided through the [Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API); verify DualSense and Xbox USB/Bluetooth mappings on the target browser/OS. Controller microphone availability is separate: use a recognized computer/headset microphone. [Microphone permission requires a secure context; localhost qualifies](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia). [MediaRecorder supports capability checks for recording formats](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder).

## Persistence and background work

Keep authoritative job records, accepted versions and backup saves in the companion. Use IndexedDB for browser cache and pending uploads, acknowledging a request only after durable worker receipt; replay by request ID to avoid duplicates. A closed or throttled tab must not strand a build job. The browser reconnects and reads job status when reopened.

Browser storage can be cleared or evicted; request persistent storage where appropriate and provide save export/import. [MDN storage guidance](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria). Serve each candidate from a versioned URL/asset manifest, checkpoint before switching, and avoid stale caches loading mixed game versions. Keep model/provider credentials in the worker and restrict its API to the intended origin/session.

## First implementation gate

Before implementing both subgames, prove one complete browser slice: load a trimmed city, walk with either controller, record “make it daytime,” receive and apply a validated operation, undo it, refresh and recover the accepted save/job state. Measure frame rate and input/recording latency on the actual computer. Then add basketball and the creature RPG using the same shell and feedback path. The final build gate must separately prove a durable content change and a code candidate that can be tried, accepted and reverted.

Evidence checked for this amendment: official Godot web-export/JavaScriptBridge docs, MDN controller/microphone/recording/storage docs, the existing workspace candidate audit and design, and absence of a Godot executable on PATH. The architecture is feasible by these documented primitives; the selected base's browser performance and real hardware behavior remain unverified.
