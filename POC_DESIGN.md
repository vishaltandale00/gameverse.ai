# Gameverse local proof-of-concept design

Status: design deliverable, 13 October 2026. No playable application, voice service, subgames or AI worker has been implemented in this workspace. The repository currently contains research/design documents. This document and the configuration/contract examples define the implementation target.

## Product decision

One desktop application: character creation → mission-free city → basketball or creature RPG → city. The player can use a DualSense or Xbox controller, or keyboard/mouse. One reserved button starts/stops microphone recording in any scene and queues contextual requests. The player reviews questions, progress, candidate changes and failures inside the game.

The city is a navigable sandbox and game launcher, not a required story campaign. It has ordinary NPC pedestrians and entrances to the two activities. Future human-controlled entities may share the representation of NPCs; networking, multiplayer synchronization, accounts and servers remain outside this local PoC.

Working assumption: macOS first because this workspace is on a Mac; keep the desktop design portable to Windows. “PS5/Xbox controller” means those controllers connected to the computer, not deployment on a PS5 or Xbox console. One large city district first, with data/layout support for further districts later. Do not promise several completed cities in milestone one.

## Base candidate and modifications

Provisional first base: [Night Drop/GTA-mini](https://github.com/alexbieber/GTA-mini), pinned in the preceding audit at `f8187d327dbe327076ca23f5d8150d81f542c381`. It has a compact Godot city/player/vehicle implementation, MIT code and documented CC0 assets. Its source has mission phases, wanted behavior and physical-key input. It is not already the required mission-free, controller-first product.

Keep city generation, third-person movement/camera, optional drivable vehicles and non-hostile pedestrians. Disable/remove the delivery mission, wanted/chase system, hostile damage and mission HUD. Add identity/character creation, semantic input, saves and the persistent shell. This is integration work, not just flipping one proven upstream option. First run the pinned source with a compatible engine and inspect actual performance; both reviewed candidates target Godot 4.7.

Alternative: [Open Theft Auto](https://github.com/mehulkapadia5/open-theft-auto), audited at `b37e7f3070501dd90353c250e9ad90dffdf4c8b2`, has controller/remapping and JSON-save code already, but more economy/combat/special-vehicle systems and mixed asset notices. Use it if Night Drop’s input/save retrofit costs more than trimming those systems. Previous audits did not establish runtime reliability for either candidate. Godot is selected here by the reusable source, not by an assertion that it universally beats Unity/Unreal.

## Traceability to the seven requirements

| Requirement | Concrete design | Proof required |
|---|---|---|
| 1. Open-world RPG-like sandbox, NPCs, character creation, no missions | One navigable city district, neutral NPCs, persistent avatar and customization; old mission/wanted logic disabled | Create character, roam without objectives/chases, quit/reopen with identity retained |
| 2. Controller or computer controls | Shell-owned semantic input, DualSense/Xbox glyphs, keyboard/mouse path, reconnect handling | Complete creation, city traversal and both subgames on each device |
| 3. Mapped mic button and queue | R3/right-stick click defaults to recording toggle; F8 on keyboard; contextual recording becomes a durable job | Record and submit from city and both games; no terminal interaction |
| 4. Configurable processing algorithm | Versioned processor adapter, routing policy, operation catalog, limits and approval policy | Switch deterministic/LLM/hybrid presets and observe different routing without UI code changes |
| 5. Simple basketball and Pokémon Red-style games | Original arcade 2v2 court and original tile-based creature RPG | Each has a complete short play loop and local save/results |
| 6. Same improvement loop in subgames | Voice/queue/review UI remains in the loaded shell; request carries active game ID | Submit and adopt a change inside each subgame |
| 7. Controller-first setup and operation | In-game setup wizard, device/mic tests, voice naming, settings, job tray and recovery UI | After initial setup, a full session requires no editor, terminal or coding-agent window |

## Character creation and city scope

Character creator: six preset bodies/heads, selectable skin/hair palettes and outfits; voice name entry with transcript confirmation, random-name option and optional controller-operated on-screen keyboard. Save a stable player ID plus appearance parameters, not an entire character scene. The creature RPG uses a matching sprite/palette and basketball uses the same player identity with a sport outfit.

City: several connected streets, one plaza, a court entrance, a creature-game entrance, optional simple driving and approximately 15–30 neutral local NPCs. NPCs wander or idle; no missions or dialogue system is necessary. Use stable entity IDs and `control_source: local_npc` today; a future `remote_player` representation is a possible extension, not implemented networking. No police chase or damage from the original base is active in the initial city.

Character creation, controls, audio and processor settings are always accessible from the pause screen. Local saves cover the player profile, city location, world-definition version and each subgame separately. All content is bundled locally for accepted gameplay.

## Controller and keyboard design

The shell intercepts global actions before a subgame sees input. Default feedback button: right-stick click (R3), reserved everywhere. It does not double as camera reset or aim. Rebinding offers an alternative single button; keyboard defaults to F8. Do not depend on console Home/Guide or controller microphone/mute buttons being available to the application.

| Semantic action | DualSense | Xbox | Keyboard/mouse |
|---|---|---|---|
| Move/menu navigation | Left stick / D-pad | Left stick / D-pad | WASD/arrows |
| Look in city | Right stick | Right stick | Mouse |
| Confirm/interact | Cross | A | Enter/E |
| Back/cancel | Circle | B | Escape |
| Pause/job tray | Options | Menu | Escape/Tab |
| Voice record toggle | R3 | Right-stick click | F8 |
| Sprint in city | L3 | Left-stick click | Shift |
| Quick return | Pause menu → Return to city | Same | Same |

Basketball-specific controls: left stick move; Cross/A shoot; Square/X pass or steal; Triangle/Y switch teammate; R2/RT turbo; Circle/B jump/block during play and back in menus. Creature RPG: left stick/D-pad navigate, Cross/A interact/select, Circle/B back, Triangle/Y party/journal. Global pause/voice always win. Menus and gameplay use separate action contexts; held inputs are released on transition so a confirmation press does not become a shot or attack.

Display correct glyphs when possible, keep focus visible, permit deadzone/sensitivity changes and pause if the active controller disconnects. Keyboard/mouse controls remain an equal fallback. Real USB and Bluetooth pad tests are required; documented engine support is not proof this implementation works.

## Voice request interaction

Tap R3: haptic/visual acknowledgment, pause local gameplay by default, show a small recording panel and begin capturing only the selected microphone. Tap again: stop, save a WAV, enqueue transcription and resume. Maximum recording duration is configurable (default 30 seconds). Cancel with back; hold-to-talk can be selected in settings. The shell continues processing while gameplay is paused.

Capture context at recording start: active game ID, accepted definition/build ID, player location, selected/nearby entity, round/battle state and recent semantic events. Do not record ambient audio outside the explicit recording window. Context is frozen for the request; entering another game afterward must not retarget it.

On transcription completion, show “Queued: make the basketball defenders slower.” Default behavior queues automatically with a short cancel/correct window; there is no compulsory laptop confirmation. Corrections can be re-recorded. If transcription is empty or unclear, show an in-game re-record prompt rather than guessing. A queue item can be inspected, canceled, retried or reprioritized with the controller. Once processing has begun, cancel means stop future work; it does not pretend to undo a change already accepted.

The microphone can be a headset, USB mic or system input. Select it by name and test levels/playback in the wizard. A DualSense input device does not imply its built-in microphone is available on that OS/connection.

## Configurable algorithm and execution paths

The processor is an adapter with a stable interface: `process(request, context, policy, catalog) -> proposal | clarification | unsupported`. Its configuration is persisted and versioned with each job. The controller UI exposes presets and key options; arbitrary custom executable algorithms require developer installation once, then are selectable as registered IDs. Natural language is input, not a shell command.

Modes:

- `deterministic`: supported intents/rules only; useful for reproducible offline tests. It must report unsupported free-form requests.
- `planner`: a configured model endpoint returns a structured proposal; a separate validator checks scope, operation types and limits.
- `hybrid` (recommended): recognized simple operations use deterministic routing; other requests go to the planner. Code generation is enabled only when a developer adapter is configured.

Three change paths:

| Path | Examples | Execution and permanence |
|---|---|---|
| State command | Move the player to the plaza; reset a stuck round | Supported command applied to a state snapshot after in-game confirmation; Undo restores the affected checkpoint |
| Persistent content/rules | Add benches; change court AI speed; adjust creature encounter frequency | Produce a versioned definition patch, validate and preview it; accepted definitions are reused after relaunch |
| Code/mechanics candidate | Add a dash; introduce a new basketball rule | Separate source worktree and build/test job; offer candidate trial only when packaged checks pass; activate at restart/safe boundary |

Only changing current state would not meet the original evolving-game goal. The PoC must demonstrate a repeated durable rule/content change, and the extensible design includes code candidates. A model suggestion is not applied until validated. Agent-written code runs in candidate testing; it cannot edit active bundles or canonical saves.

Operation catalog v1: relocate player to named anchor; set named entity appearance; add/remove a catalog prop within an allowed area; change NPC count within a limit; set city time; adjust basketball timer/turbo/AI-speed; change creature encounter/capture parameters and approved move values. No arbitrary object path or filesystem path is accepted from speech. Target resolution uses stable IDs and may ask “This defender or both?” in-game. The user answers with a controller choice or voice.

Acceptance policy defaults to `trial_then_accept`. State commands can use a fast confirmation/Undo screen; an advanced preset may auto-apply approved reversible state commands. Do not silently equate transient auto-apply with permanent adoption. Persistent rule edits activate between rounds/battles or at city checkpoints. Spawned props validate bounds and traversal; NPC-count changes obey performance caps. Policy itself remains separate from agent-editable game content.

## Queue, candidates and saves

Use a local helper service with SQLite for durable jobs and an authenticated loopback API to the game shell. The helper owns transcription, processing and build jobs; the game owns simulation and presentation. Launch the helper with the desktop app and show its health inside the game. Local loopback is IPC here, not multiplayer. Restrict API methods and use a per-session credential; example configs contain references, never secrets.

Queue: recorded → transcribing → queued → processing → [needs clarification / validating / building] → ready for trial → trialing → accepted/rejected. Also support canceled, failed and needs-help. Persist request/proposal/error/result history. One mutating worker per module for version one; coalesce related pending requests only when their intent and base are compatible. Transcription may overlap play. Expired leases recover jobs after a crash; do not duplicate accepted effects.

Every job references its base build/definition and context snapshot. A stale candidate is retested/rebased or marked stale; it must not overwrite newer accepted work. Fix budgets are configurable (default three attempts and a wall-clock limit). Run builds at low priority and cap concurrency to protect gameplay.

Trials use cloned saves and exact candidate versions. Rewards from trials do not alter authoritative progression. Accept commits a manifest and compatible migrated save transaction; interrupted writes recover to the previous committed manifest. Save schema migrations write a copy and validate before commit. Retain exact old bundles and pre-acceptance saves. Revert initially restores that checkpoint and explicitly states which later progress is lost. Preserve later progress only when compatibility is tested.

A plain JSON overwrite is not a migration or crash-recovery strategy. Separate profile, per-module state, world definition, accepted manifest, queue and accomplishment ledger. Give every granted reward an idempotency key.

## Shared shell and module boundary

Godot root: `AppShell` stays loaded; `GameHost` holds the active city/basketball/creature scene; `Overlay` holds setup, recording, queue and trial UI. Autoload/shared services own ProfileStore, SemanticInput, VoiceCapture, JobClient and VersionManager. Selectively pause the active game, not the UI/network/job client.

Each module implements `enter(context)`, `pause()`, `serialize_state()`, `restore_state(state)`, `get_feedback_context()`, `apply_validated_operations(ops)` and `exit()`. Results/rewards go through the shell’s validated ledger. The shared shell keeps the mic and controller mappings consistent when switching 3D/2D.

A feedback request carries request ID, player ID, module ID, base version, context snapshot ID, audio reference, transcript and processor-config version. A proposal carries target module, summary, path, typed operations or candidate artifact reference, expected base version, checks and save compatibility. Build artifacts come from a trusted build worker; a transcript cannot choose an arbitrary executable location.

Illustrative configuration and request/proposal examples are in `design/processor.example.json` and `design/request_examples.json`. They are parseable design contracts, not a running processor or daemon.

## Basketball module

Original arcade 2v2 basketball: one local human, one AI teammate, two AI opponents; one court; 90-second matches; simple passing, shooting, steals, jump/block, turbo and exaggerated dunks. No leagues, rosters, online matchmaking or simulation-grade rules. Use basic characters matching profile colors, not NBA players/assets.

First scope: movement and possession; then pass/shoot/scoring; AI attack/defend; timer and restart; controller-only menus; shared voice hook. Save best score and completed matches. A complete round awards one trophy badge for the city shelf.

Representative requests: “Make the defenders slower,” “Give me two minutes,” “Make turbo last longer,” and a code-path request such as “Add a shot meter.” Changes apply on restart of the round, not while the ball is mid-flight. Test ball reset, possession ownership, scoring once, reachability and completion under scripted input; evaluate feel with a person.

## Creature module

Original Pokémon Red-style 2D tile-based RPG: a small town and route; six creature types; choose one of two starters; grass encounters; turn-based battle with two moves per creature; capture and party viewing. No large story, gyms, hundreds of creatures or franchise ROM integration. Use original sprites or clearly sourced reusable placeholders.

The same player ID is shown via a sprite/color representation. Save party creature IDs, stats, route position and local collection progress. NPCs here offer simple interactions; no overarching city story is needed. First accomplishment: a collection badge/statue visible in the city, with functional companion import deferred.

Representative requests: “Fewer random encounters,” “Make capture easier,” “Change my starter’s color,” and a code-path request such as “Add a flee option.” Persistent changes activate at the next encounter or safe town checkpoint; they must not invalidate already collected creatures. Any discarded creature/type definition needs an explicit migration, not silent removal.

[GDQuest’s Open RPG](https://github.com/gdquest-demos/godot-open-rpg) is a reference for turn-based combat, not a verified ready-made creature collector. Reuse a subgame repository only after checking its runtime version, code/assets and module fit. Original small modules in the host engine are the fallback; do not import commercial ROMs as the initial integration technique.

## Controller-first setup and failure handling

App wizard: select pad or keyboard → adjust deadzones and test buttons → select microphone and record/play a test → select processor preset → choose local transcription/model assets or configured provider → create character → enter city. Offer defaults and voice entry for ordinary text. Subsequent sessions start at Continue.

After one-time installation, normal operation should require only the controller and game display. First-run OS microphone permission, Bluetooth pairing, downloading model/engine prerequisites and initial provider login/credentials may require desktop interaction. Do not promise the app can dismiss OS security dialogs or manufacture credentials with a controller. These are setup exceptions, not normal development steps.

On failed requests, show plain language in-game: “No audio captured,” “Waiting for provider,” “Candidate failed checks,” or “Needs developer help.” Offer Retry, Re-record, Keep current and Save diagnostics. Escalate after a configurable retry budget, attaching transcript, versions and logs to a local support bundle. Do not strand the player at a terminal or silently change nothing. Keep current gameplay available through service outages. A deterministic supported-command preset remains usable when the planner is unavailable.

Local game execution is required. Local transcription via [whisper.cpp](https://github.com/ggml-org/whisper.cpp) is an available implementation route; actual device latency remains unmeasured. A planner/coding provider may be remote. Fully local generation/judging additionally requires model availability, enough memory and measured target-hardware performance. Offer these as independently configured services; do not call a cloud-backed loop “fully local AI.”

## Implementation milestones and acceptance gates

M0 — boot the pinned base, measure its behavior, disable mission/hostility paths and establish the shell. Pass: mission-free walking/driving and neutral NPCs on the target machine.

M1 — semantic input, character creation, profile/city save and first-run UI. Pass: DualSense, Xbox and keyboard/mouse each complete the same flow; disconnect/reconnect resumes cleanly.

M2 — microphone, transcription, durable queue and deterministic processor. Pass: record “set it to daytime,” review/apply/undo, quit/relaunch, recover queued work. Verify microphone refusal, silence and unavailable-provider states without leaving the game.

M3 — basketball and creature modules, enter/return/save/results and shared voice capture. Pass: complete one round and one encounter/capture using each input device; receive one city trophy exactly once.

M4 — persistent content/rule edits and configurable planner. Pass: change defender speed and encounter rate by voice, trial, accept, relaunch and see both changes persist. Reject a candidate and confirm accepted data is intact. Change processor preset in-game. Demonstrate two consecutive improvement cycles.

M5 — first code candidate and packaged restart trial. Pass: request a small new mechanic, build/test in isolation while current gameplay continues, try it from the controller, accept/revert and verify retained checkpoint recovery. This milestone proves the extensible code-edit path; M4 already proves persistent content/design evolution.

Hard gates: no loss of accepted saves; feedback works in every module; no recurring terminal/editor requirement after setup; failed/stale candidates cannot promote; no gameplay regression from background work beyond the target performance budget established in M0. Physical controller/mic tests cannot be substituted with headless checks.

## Evidence and remaining decisions

Checked prior source audit and inspected Night Drop’s `game.gd`/`city.gd`: mission update and cop/wanted setup are actual source paths to address. No implementation was run here. Checked [Godot controller guidance](https://docs.godotengine.org/en/stable/tutorials/inputs/controllers_gamepads_joysticks.html), [microphone recording guidance](https://docs.godotengine.org/en/stable/tutorials/audio/recording_with_microphone.html), [AudioServer device selection](https://docs.godotengine.org/en/stable/classes/class_audioserver.html) and [macOS export guidance](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_macos.html). These establish available primitives, not a functioning full loop. The mic tutorial flags that it has not yet been updated for 4.7; validate against the selected engine and official mic demo before implementation.

Implementation decisions still requiring measurements: whether the pinned base boots cleanly; USB/Bluetooth controller and microphone behavior; transcription/planner latency; whether trimming Night Drop or the larger alternative is faster. Default assumptions in this design allow implementation to begin without blocking on them.

The next concrete milestone is M0–M2: a character in the mission-free city who can queue one voice request from the controller, apply a supported change, undo it and continue playing.
