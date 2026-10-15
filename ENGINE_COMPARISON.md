# Choosing an engine for Gameverse

Reviewed 13 October 2026. This is a documentation-based comparison and engineering judgment, not a benchmark of engine speed or AI coding success. No engine was installed, prototype built, or hardware/controller test run for this comparison.

## Recommendation and why Godot kept appearing

Godot was a conditional prototype recommendation that I repeated too confidently. I assumed a small team, desktop-first local play, modest 2D/stylized 3D, and frequent agent edits. Those assumptions were not established by the concept. Free licensing, readable project files and automation help that scenario; they do not establish that Godot is the best production engine or that agents perform better in it.

My recommendation now: shortlist Unity and Godot rather than committing to Godot by default. For a substantial, coherent 3D RPG with sports, shooters, creatures, building and racing, Unity is my lead general-purpose production candidate. For a modest, open, desktop prototype prioritizing the improvement loop, Godot is my lead candidate. Unreal leads when high-fidelity 3D is a core requirement. A TypeScript web stack leads when small independently generated activities and rapid browser inspection are the product’s central value. These are conditional judgments, not measured winners.

| Option | Best fit here | Main tradeoff |
|---|---|---|
| Godot | Small team, 2D/stylized 3D, engine ownership, script/content iteration | More specialized systems and console-porting integration may fall to us |
| Unity | Broad mixed 2D/3D production, integrated tooling, established workflows | Commercial licensing and editor/build pipeline; code updates generally need new player builds |
| Unreal | High-fidelity 3D, sophisticated environments and character/vehicle systems | More complex compilation/cooking/asset pipeline for frequent small AI changes |
| TypeScript + Babylon.js / Phaser | Small generated activities, browser-based testing and versioned cartridges | We assemble more of the game/application platform and may weaken world coherence |

Do not choose an engine primarily because its marketing advertises AI tools. The relevant capability is a reliable path from a contextual request to a tested, packaged candidate that preserves the player’s save.

## Godot: why it is attractive, and where it stops

Godot is MIT-licensed with engine source available. Scripts, scene/resource text and command-line import/export give agents an inspectable workflow. Its resource packs can carry scripts, scenes and assets; a host can load additional packs at runtime. These are concrete reasons it appeared in the earlier proposal. Sources: [license](https://godotengine.org/license/), [command-line workflow](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html), [packs and mods](https://docs.godotengine.org/en/stable/tutorials/export/exporting_pcks.html).

For our design: use one shell and scene-based activities; keep player identity, control mapping and save schemas outside each activity. Validate data patches cheaply and build isolated candidates for code changes. Load accepted packs in a fresh session with unique resource namespaces rather than promising arbitrary hot replacement of active scenes. The pack documentation warns about path replacement and preloaded resources. Packs execute code; they do not supply a security sandbox or automatic migration.

Godot can make 3D games; the limitation is how much specialized production work we accept. Its VehicleBody3D documentation explicitly cautions about known issues and lack of realistic vehicle-physics intent, so racing may require custom handling or a vetted solution. This is not proof other engines supply a complete racing game. Console exports require platform approval and privately built SDK integrations or third-party providers. Sources: [vehicle limitations](https://docs.godotengine.org/en/stable/classes/class_vehiclebody3d.html), [console support](https://godotengine.org/consoles/).

Choose it when openness and a compact desktop project outweigh dependence on a larger production ecosystem. Reject the claim “Godot is best for AI” until our actual agent and tasks have been compared.

## Unity: the strongest general-purpose production alternative

Unity supports 2D and 3D development, and its Input System supplies normalized supported-gamepad controls, deadzones and haptics. Batch-mode editor tasks and the Test Framework provide automation. These address the controller and testing requirements without requiring a switch to Godot. Sources: [game development platform](https://unity.com/games), [gamepads](https://docs.unity3d.com/Packages/com.unity.inputsystem@1.14/manual/Gamepad.html), [command line](https://docs.unity.com/en-us/engine/6000.3/manual/unity-editor/command-line-arguments/editor), [test CLI](https://docs.unity3d.com/Packages/com.unity.test-framework@1.4/manual/reference-command-line.html).

For our design: C# activities, scenes/prefabs, common action maps and an explicit host/state contract. Let agents use editor APIs for asset wiring and stable IDs instead of blindly rewriting serialized scenes. Broad production tooling is a reason to favor Unity for the eventual mixed-genre 3D game; it is an engineering judgment, not a guarantee every genre works out of the box. Asset/plugin selection still brings maintenance and license obligations.

Critical update constraint: Addressables update asset data, not new compiled C# code. General code/mechanics changes should build a new player and trial it alongside the accepted executable. Bounded mechanics can instead use a stable interpreter over versioned rule data, or a deliberately added scripting layer. That layer has its own debugging, compatibility and isolation costs; it is not an inherent Addressables feature. Source: [Addressables 2.7 update model](https://docs.unity3d.com/Packages/com.unity.addressables@2.7/manual/content-update-builds-overview.html).

Commercial terms: Unity Personal is free within eligibility limits; the current plans page requires Pro above $200K in funding or annual revenue. The Runtime Fee was canceled and should not be used as a current argument against Unity. Avoid budgeting from old pricing screenshots. Sources: [current plans](https://unity.com/products), [pricing changes and fee cancellation](https://unity.com/products/pricing-updates).

Choose it if polished, varied 3D games and production/platform workflows are primary, especially with existing C# or Unity expertise. Budget for candidate builds and commercial terms rather than expecting unrestricted script hot-loading on every target.

## Unreal: choose it for the games’ fidelity, not the update button

Unreal provides modular Game Features, editor automation through Python, and gameplay/content testing infrastructure. Its 3D environment and vehicle tooling make it a serious contender for ambitious 3D experiences. Sources: [modular gameplay](https://dev.epicgames.com/documentation/unreal-engine/game-features-and-modular-gameplay-in-unreal-engine), [editor scripting](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python), [Chaos Vehicles](https://dev.epicgames.com/documentation/en-us/unreal-engine/chaos-vehicles).

For our design: shell/world plus modular activity features, reusable gameplay components and explicit persistent state. Agents write C++ and invoke editor tooling to produce and validate assets; editor Python is not general packaged gameplay scripting. Assets and Blueprint graphs need tooling, not assumptions that a text-code patch covers the whole game. Compilation/cooking and detailed 3D assets are likely a larger iteration burden for small edits; measure this rather than claiming a universal speed ranking.

Live Coding supports the editor, Play In Editor and attached desktop debug builds. It is not available on consoles/mobile and is not a generic update pipeline for a standalone shipped game. Build/cook candidates, then switch versions at a save boundary. Sources: [Live Coding scope](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-live-coding-to-recompile-unreal-engine-applications-at-runtime), [automation system](https://dev.epicgames.com/documentation/en-us/unreal-engine/automation-system-overview).

The standard games model charges 5% on attributable lifetime gross product revenue above $1M, with exclusions and possible qualifying reductions; engine source access is under Epic’s license, not a permissive MIT license. Source: [Epic licensing overview](https://www.unrealengine.com/license).

Choose it if the desired shooters, racing and world presentation justify the 3D pipeline, or the team already knows Unreal. I would not select it merely to validate a small feedback/improvement experiment.

## Web stack: a real alternative, with a different product shape

For a 3D hub, consider TypeScript + Babylon.js, which documents a scene graph, animation, physics integration, GUI and gamepad cameras. Phaser is explicitly a 2D framework; use it for 2D cartridges rather than treating it as the whole 3D engine. Three.js is another rendering option, but entails assembling more gameplay systems. Sources: [Babylon capabilities](https://www.babylonjs.com/specifications/), [Phaser scope](https://phaser.io/why-phaser), [Phaser gamepad input](https://docs.phaser.io/phaser/concepts/input).

For our design: bundle the hub and activities in a local desktop wrapper or locally served app. Agents edit TypeScript/data/assets, make immutable candidate bundles, and exercise them with browser automation. This makes code diffing and rendered inspection convenient; better AI success and shorter end-to-end latency remain hypotheses. A development server’s hot reload is not the adoption mechanism. Open candidates in fresh contexts with copied saves, then choose the accepted bundle.

Two architectures: one Babylon runtime maximizes shared world/objects but shares a failure domain; isolated web cartridges improve containment but need a message protocol and can look and feel like separate games. Keep global rewards/saves in the host. Browser/renderer sandboxing needs correct origins, permissions and a restricted bridge; Electron specifically documents context isolation, sandboxing and careful IPC validation. Source: [Electron security model](https://www.electronjs.org/docs/latest/tutorial/security).

Local web technology does not require cloud rendering: ship assets/code locally. It also does not imply local AI inference. Native feel, controller reconnect/focus, audio transitions, rendering performance and memory must be verified on the target devices. Choose this path if the evolving activity platform is more important than native-engine integration and high-end 3D production.

## Other engines and why they are secondary here

Bevy is a Rust ECS engine with MIT/Apache licensing and a code-centric modular design. Its official introduction still warns about missing features and breaking changes. I would consider it for an experienced Rust team building a deliberately custom platform; otherwise it adds engine/tool integration work to an already demanding AI-development project. Source: [Bevy introduction and stability warning](https://bevy.org/learn/quick-start/introduction/).

Defold is worth a shortlist if the scope becomes chiefly compact 2D games. It uses its own license, which allows commercial games but restricts commercialization of the editor/engine; it is not simply MIT. Given the cross-genre 3D possibilities, it is not my first general-purpose choice. Sources: [product](https://defold.com/product/), [license](https://defold.com/license/).

A custom engine gives control but also makes rendering, tooling, import, input, packaging and maintenance our problem. Roblox and UEFN are creation platforms with host constraints, rather than the natural first choice for our standalone local application. None of these exclusions means they cannot make excellent games.

## What every engine still leaves us to build

The improvement system belongs outside the accepted runtime. Keep candidate worktrees, bounded agent permissions, independent evaluators, immutable build IDs, contextual feedback and explicit proposal/trial/accept/revert states. Full executable candidates are valid: the current version can remain playable while the next builds, even when adopting it requires a restart.

Use three update tiers: data/content, game scripts/code, and engine changes. First is simplest; second needs stronger testing and compatibility; third is exceptional and generally a full rebuild. Do not confuse improving game code with improving the engine or the developer agent itself.

No engine automatically preserves a collected creature whose data was removed or a building after its mechanics change. Own stable content IDs, shell progression and versioned module save schemas; retain exact old bundles and checkpoints. Prefer a safe boundary over live mutation. Controllers alone do not force Godot, and no engine determines whether our model inference is local.

## The selection test

First pin the intended target device, representative art/3D scope and team expertise. For a native 3D product compare Unity and Godot; substitute Unreal when high fidelity is non-negotiable. For a primarily generated-game platform compare the native finalist against Babylon.js. Do not build four complete products or weight features we do not need.

Build the same small vertical slice in two finalists: hub, controller-driven arena, simple race, shared progress and a feedback bookmark. Give the same agent/model equivalent documentation and tools. Request a data balance change, a new gameplay action, an asset/scene change and a save-schema change; repeat edits so one lucky build does not decide it.

Measure developer setup/maintenance time, time from request to passing packaged candidate, agent failures and human repairs, input/frame-time behavior while candidates build, migration failures, adoption/rollback correctness and offline relaunch. Include a deliberately broken candidate and an interrupted save promotion. Use rendered checks and real-controller play alongside headless tests.

Choose the engine that meets required game quality and platform constraints with the lowest sustained cost of tested changes. Treat zero lost authoritative saves and isolation of the accepted build as hard gates. The open decision is the game’s intended fidelity/platform, not whether Godot has a fashionable reputation for AI friendliness.
