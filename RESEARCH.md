# A controller-driven RPG that evolves through feedback

Research reviewed 13 October 2026. Recommendation: begin with a single Godot application and constrained, versioned content/rule changes; add code changes in isolated candidate builds after the complete feedback-to-adoption loop works. Local play does not require local AI inference. All initial designs below are single-player and use original subgames.

The evidence supports the ingredients, not an off-the-shelf implementation of the whole concept. No reviewed source demonstrates all of: a connected RPG spanning genres, contextual controller feedback, agent-built candidates while the accepted version remains playable, player adoption/revert, and durable save migration. This is a bounded research finding, not a claim that no such project exists.

Method and limits: inspected primary documentation, papers, official product pages, repositories, and selected source files. Availability means an official distribution, published run instructions, or an observed web endpoint; it does not mean I installed or personally playtested these games. No code-generation benchmark, controller test, save-migration test, or hardware inference benchmark was run. The workspace initially had no application code or project README; this research report is the produced artifact.

## Precedents: integrated game evolution

### Galactic Arms Race — integrated content improvement loop

Implemented: cgNEAT evolves particle-system weapons from weapon-usage statistics, elaborating on previously preferred weapons. Actual weapon content changes; the engine and general rules remain fixed. Try: a Windows Steam release with single-player modes is listed. Lesson: infer preferences from use, retain alternatives, and evolve a bounded content representation. Limit: use frequency can reflect power or availability rather than enjoyment; no demonstrated controller request → code patch → accept/revert workflow.

Sources: [official Steam page](https://store.steampowered.com/app/249610/Galactic_Arms_Race/), [authors’ AIIDE demonstration paper](https://ojs.aaai.org/index.php/AIIDE/article/view/12345).

### Darwin’s Demons — integrated adaptive content loop

Implemented: enemy genomes encode morphology, attacks and behavior; enemies that survive or attack effectively reproduce. Try: free Steam release; single-player arcade and experiment modes are documented. Lesson: local bounded evolution can change real content without an LLM. Limit: adversarial adaptation is not evidence of improved enjoyment or explicit player preference, and does not rewrite source code. Under this concept’s definition it is a partial content-evolution precedent, not the entire improvement system.

Source: [developer Steam description](https://store.steampowered.com/app/572020/Darwins_Demons/).

## Precedents: platforms and connected experiences

### Dreams — platform evolving separate experiences through human creation

Implemented: console/controller creation, remixing and playing diverse experiences. Try: published PS4 product; official support notice says play/create/share continue after live feature support ended in September 2023. Lesson: controller-first discovery and creation can coexist. Limit: it is not an AI feedback-driven development loop; a platform identity does not establish portable inventory or save compatibility across arbitrary games.

Sources: [PlayStation product](https://www.playstation.com/en-us/games/dreams/), [Media Molecule support notice](https://docs.indreams.me/en/whats-happening/news/dreams-support-update).

### Nintendo Land — fixed game collection and overworld reference

Implemented: a virtual theme park with twelve attractions; control instructions differ by attraction. Try: existing Wii U software/hardware, subject to access to a copy; do not assume a current digital purchase. Lesson: physical destinations make a genre collection feel like a place. Limit: some attractions require other players, and its GamePad-specific inputs should not be copied into a standard-controller design. It has no AI improvement loop.

Sources: [Nintendo product](https://www.nintendo.com/en-gb/Games/Wii-U-games/Nintendo-Land-524069.html), [official controller manual](https://www.nintendo.com/eu/media/downloads/games_8/emanuals/wii_u_6/nintendo_land_1/ElectronicManual_WiiU_NintendoLand_EN.pdf).

### Nintendo Switch Sports — fixed collection and identity reference

Implemented: sports share a facility and customizable Sportsmate identity. Try: released Switch software using supported Joy-Con interactions. Lesson: carry appearance across activities while allowing sport-specific controls. Limit: documented cosmetic earning relies on online play; an offline progression economy must be designed separately. This is a genre/UX reference, not autonomous evolution.

Source: [Nintendo official site](https://nintendoswitchsports.nintendo.com/).

### Roblox / Wish Master / Cube — platform plus AI object-creation tool

Implemented: Roblox’s February 2026 release describes beta 4D object generation and Wish Master integration; Car-5 and Body-1 schemas attach functionality to generated geometry. Try: the linked Roblox experience and enabled beta capabilities, subject to access; not an offline host. Lesson: typed object schemas bound AI freedom. Limit: arbitrary scenes/behaviors and real-time dreaming are broader ambitions, not demonstrated persistent game-code acceptance/rollback.

Source: [Roblox announcement and linked gameplay demonstration](https://about.roblox.com/newsroom/2026/02/accelerating-creation-powered-roblox-cube-foundation-model).

## Precedents: executable generation and development tools

### AutoGameStudio — platform evolving separate game variants

Implemented per repository: player signals guide agent changes in new Git branches, with branch-tree selection using Elo; worktrees keep variants separate. Try: public evaluation site responded, game repository and CLI setup are published; provider access is required. Lesson: immutable candidates and preference comparisons are practical precedents. Limit: the reviewed material does not establish continuous RPG progression, controller feedback, automatic save migration, or quality gains validated independently.

Sources: [repository](https://github.com/Centipede5/autogamestudio), [evaluation site](https://autogamestudio.ai/games), [generated-game repository](https://github.com/Centipede5/autogamestudio-games).

### OMNI-EPIC — environment-generation platform with a partial integrated loop

Implemented: generates executable physics environments and archives tasks. Inspected backend includes next/previous/reset, mark-success/failure, action recording and retrying a failed task during generation. Try: repository run instructions; project page explicitly says its game is not hosted right now. Lesson: expose task intent and instrument success, not just screenshots. Limit: task generation/iteration does not establish a persistent RPG, preference-driven patches, candidate promotion or migration. Generating learnable tasks for agents is a separate objective from player enjoyment.

Sources: [project and availability](https://omni-epic.vercel.app/), [repository](https://github.com/maxencefaldor/omni-epic), [inspected backend](https://github.com/maxencefaldor/omni-epic/blob/main/game/backend/app.py).

### DreamGarden — AI game-development research tool

Implemented in the paper: hierarchical planning, Unreal C++/asset generation, compilation and visual iteration; users can prune plans, give feedback and edit intermediate artifacts. Try: paper and demonstrations; a supported downloadable product or runnable official repository was not verified. Lesson: expose a short proposal and allow intervention before expensive work. Limit: early game/simulation prototyping is not proof of reliable long-term game maintenance or integrated player adoption.

Source: [authors’ paper, including system and study](https://arxiv.org/html/2410.01791v2).

### OpenGame — AI game-development tool; developer-system improvement investigated separately

Implemented/reported: released CLI framework, downloadable browser-game demo sources, template/debug skills and evaluation using browser execution plus visual-language judging. Try: source installation and demo archives; generation requires configured model/providers. Lesson: engine templates and execution-grounded checks are useful. Limit: demo generation is not persistent-world improvement; model weights and benchmark reproducibility were not independently verified here. Its claimed evolving template/debug capability concerns the development system, separately from changing one installed game.

Sources: [official repository and run instructions](https://github.com/leigest519/OpenGame), [paper](https://arxiv.org/abs/2604.18394), [demo gallery](https://yelonhu.github.io/OpenGame-landing-page/).

## Precedents: world models and agents that play

### Project Genie / Genie 3 — generated-world model

Implemented: interactive worlds generated from text/images. Try: official help currently specifies eligible Google AI Ultra subscribers, age 18+, where Ultra is available. It documents 60-second exploration, latency and control problems; revisiting regenerates a world and can change results. Lesson: rapid visual ideation. Limit: no demonstrated exportable engine code, durable RPG inventory or deterministic save migration. Use for inspiration, not the authoritative world runtime.

Source: [current Google help and limitations](https://support.google.com/labs/answer/16875695?hl=en).

### Voyager — agent improving its play in a fixed game

Implemented: a Minecraft agent grows executable behavioral skills using curriculum, execution feedback and verification. Try: public repository with Minecraft/Mineflayer setup and GPT-4 access requirements. Lesson: reuse verified skills for playtest automation. Limit: skills change the agent’s actions, not Minecraft’s engine or mechanics; better agent performance is not evidence that the game improved. Its code library grows without requiring weight fine-tuning.

Sources: [official repository](https://github.com/MineDojo/Voyager), [paper](https://arxiv.org/abs/2305.16291).

## Player experience: one identity across genres

These are proposed design rules inferred from the precedents, not claims that an existing system implements them together.

Give each activity an in-world destination: sports court, combat arena, creature sanctuary, workshop and race gate. Enter with the same interact action, show a brief objective/control card, then transition at a save boundary. Return to the same doorway and preserve avatar, journal, currency and unlocks. Keep the hub alive conceptually through its inhabitants, signage, rewards and shared art palette; it need not simulate concurrently while an activity runs.

Use a semantic controller contract rather than identical button meanings for all mechanics: left stick moves/steers; right stick aims/camera when relevant; primary face button confirms/interacts; secondary cancels/backs out; pause, hub-return and feedback remain shell-owned. Genres may use triggers for fire/accelerate and shoulders for tools. Display mappings before entry; retain remapping, deadzones, sensitivity and accessibility settings across candidates. Decide the target pad before allocating the dedicated feedback button: a standard pad may have no spare physical button once a genre is mapped. Reserve a supported button globally, with a remappable fallback; do not hijack the operating-system Home button.

Example prototype: one original short twin-stick encounter and one original time-trial race share an avatar banner, rewards and hub. Creature collecting, sports and building join later using the same contract; they are not required in the first complete loop. Commercial titles inform genres and UX; use original code, assets, characters, maps and mechanics combinations.

Implementation precedent: [Godot InputMap](https://docs.godotengine.org/en/stable/classes/class_inputmap.html) supports named actions and bindings; [Libretro input abstraction](https://docs.libretro.com/development/input-api/) separates a physical controller from a virtual controller. Neither automatically solves consistent genre semantics.

## Player experience: feedback, trial and adoption

Tap feedback to bookmark the last 15–30 seconds of local context without pausing: timestamp, version, game ID, objective, entity IDs, relevant events, input history and optional screenshot. Show a brief acknowledgment. Hold to pause and open a small radial choice: confusing / unfair / bug / change this / liked this. Permit optional speech or text at a safe stop; controller-only choices must work without speech. Do not open an unsolicited conversation mid-combat. Record the scope explicitly: this weapon, this activity, or the overworld.

Translate a signal into one short proposal: observed evidence, interpretation and uncertainty, intended change, parts affected, expected benefit, cost and migration risk. For example: “Three misses after braking: try earlier corner cues?” A player may want more challenge, not easier handling. Repeated deaths, session length and button presses are evidence of events, not direct measurements of preference. Group duplicates, prioritize explicit requests, and ask a bounded clarification when two interpretations lead to different changes.

Deliver ready proposals at the hub workshop or after a round. Offer Try / Keep current / Later; trial uses a cloned save and the same scenario seed. After trial show what changed and offer Accept / Reject. Failed builds never appear as playable improvements. Explain waiting without promising an exact finish time; building can continue while the player uses the accepted version.

Acceptance changes the selected build only at a safe boundary. Revert must say whether it restores the pre-update save or preserves compatible later progress. Trials award no authoritative currency until an explicit, validated promotion policy permits it. Do not silently discard newly acquired creatures or buildings when returning to older code.

## Architecture: a playable runtime beside a build system

All three designs use two planes: a local game runtime reading immutable accepted bundles, and an asynchronous development service making candidates in separate worktrees. The runtime never launches unrestricted AI code edits into its active scene. The development service may be local or hosted; network failures leave accepted local gameplay available.

Capture → propose → branch → implement → validate → trial → accept/reject → observe. Keep each stage’s evidence and outcome. Store feedback with a base-build hash and stable semantic IDs. Give the agent source, engine/API documentation, asset manifest, world/style constraints, module contract, save schema, failing trace and a test harness. Allow builds, scripted input, screenshots, logs and save inspection inside a disposable environment. Restrict edits by task scope: a subgame request gets that subgame and its fixtures; a hub request gets a candidate shell build with broader regression checks.

Use a fixed proposal budget and one coherent change per candidate. Compile/import checks are the first gate. Then run module contract checks, enter/play/exit scenarios, seeded gameplay simulations, crash/time budgets, rendered checks for camera/HUD/controller prompts, and representative old-save migrations. Headless runs cannot verify visual readability or real pad feel; scripted success cannot establish fun. Finish with the player’s same-scenario comparison. Evaluation tools are separately maintained so generated patches cannot merely remove failing checks.

Throttle generation and tests to protect frame time. Candidate output is an immutable bundle keyed by source commit, asset digests, engine version, module API version, save-schema version and evaluator version. A manifest selects exact module builds. Promote the manifest plus compatible save transaction atomically; do not patch live executable files. If the accepted base changed while a candidate was building, rebase/retest or expire it. Cache successful artifacts and cancel stale proposals.

Engine capabilities: [Godot PCK/ZIP loading](https://docs.godotengine.org/en/stable/tutorials/export/exporting_pcks.html) supports scripts/scenes/assets and path replacement; packs are not security sandboxes. [Godot command-line tools](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html) support headless runs and exports. These capabilities enable our proposed architecture but do not supply candidate management or adoption semantics.

## Architecture: saves, rollback and isolation

The shell owns stable player identity, currency ledger, quests, unlocks and world topology. Subgames own namespaced state such as race records or creature encounters. Use UUID-like stable content IDs, not scene paths or display names. Modules emit validated, idempotent reward transactions through a narrow host API; they cannot directly rewrite the global economy. Keep a compatible return point even if a destination is rebuilt or removed.

Persist explicit data schemas rather than dumping scene objects. Record the complete build manifest with each save. Migration takes a copy of schema N, writes N+1, validates invariants and only then commits. Retain original saves and exact old bundles. Test real fixtures: collected creatures, placed buildings, mid-quest flags, unlocks, module removal and interrupted writes. A successful code rollback alone does not guarantee the newer save can be read.

Begin with snapshot restoration: trial/revert returns to the checkpoint, with a clear statement that later branch progress will be lost. If preserving progress is required, accept only changes with forward/backward-compatible data or separately tested migration/reconciliation. A stable reward ledger can preserve some shell progress, but cannot reconstruct removed mechanics. Pin a module when its save is incompatible rather than claiming seamless rollback.

Package namespaces prevent accidental collisions; an engine process is still a shared failure domain. Godot script packs execute with the runtime’s authority. For code-generating candidates, sandbox build/test processes with only candidate files, temporary saves and bounded compute; test processes get no real credentials or canonical saves. Multi-engine candidates need renderer/process isolation and a validated message protocol. A subprocess without OS restrictions is crash isolation, not a complete security sandbox.

[Godot saving documentation](https://docs.godotengine.org/en/stable/tutorials/io/saving_games.html) describes serialization and customization requirements. [Libretro API](https://www.libretro.com/index.php/api/) demonstrates a common host/core interface. Its savestate serialization is not a universal cross-version migration mechanism, and native cores do not inherently isolate failures.

## Three designs: A — one engine with constrained evolution

Recommended first prototype. Player experience: a cohesive Godot hub with diegetic portals; candidates appear as workshop “renovations” with a same-seed trial. One avatar and shared rewards persist across games.

Architecture: one engine and shell; modules are scenes plus a narrow lifecycle API: enter(context), pause, export_state, import_state, finish(result), exit. AI initially changes validated rule/content data: enemy patterns, track layout, hint placement, creature attributes, quest text and bounded parameters. The engine interprets these schemas. Version overworld content as another module. Code changes remain possible but rebuild an isolated full candidate application; they are adopted at restart/safe entry rather than promised as arbitrary hot reload.

Tradeoff: best visual/controller coherence and quickest path to trustworthy saves, but a fixed schema limits new mechanics. It still meets the definition when feedback changes actual persistent content/design across iterations. It must not be advertised as unrestricted code evolution. Shared-process scripts need broader testing.

Smallest complete prototype: desktop controller play; a tiny hub, twin-stick arena and time-trial race; one feedback capture; one agent-built rule/content patch and one hub cue change; candidate validation while the old version plays; cloned-save trial; accept, quit/relaunch and revert. Prove two consecutive feedback cycles. Exercise a failed candidate and incompatible save rejection. AI may use a remote endpoint; all accepted gameplay works offline. No multiplayer.

## Three designs: B — one engine with versioned code modules

Choose if new mechanics from requests are the core promise. Player experience: the same cohesive hub, with a short loading boundary when entering a changed activity and a restart boundary for shell changes. A workshop shows functional changes such as a new dash or altered race handling.

Architecture: Godot modules in unique content/version namespaces, packaged as separately versioned PCKs with a pinned engine and module API. Agent can edit module scripts, scenes, assets and migrations in a worktree. Build/test an assembled candidate application before trying it; start a fresh runtime for trials or adoption to avoid stale preloaded resources. An accepted manifest pins modules; changes to shell/API require rebuilding the compatible application set.

Tradeoff: meaningful mechanics evolution and shared graphics/input, but more expensive integration/migration tests; packs share runtime authority and resource loading behavior. A module API reduces coupling without proving isolation. Arbitrary script changes cannot be safely inferred to hot reload.

Smallest complete prototype: same hub and two games; feedback asks for a dash in the arena; agent changes actual GDScript and adds a contract test; build candidate, fail one regression deliberately, then trial the passing build. Demonstrate migration of an old arena save, unchanged race save, acceptance after restart, rollback to saved checkpoint, and a separate hub improvement. Prove a second code-edit cycle. Benchmark local frame time while compilation runs.

## Three designs: C — a local hub hosting isolated game cartridges

Choose if genre/engine breadth outweighs seamless presentation. Player experience: one local desktop application with an RPG hub and portals into embedded activities; persistent identity comes through an avatar banner, shared journal and rewards. Portal transitions may be more noticeable than in the one-engine options.

Architecture: a desktop shell owns the hub, controller adapter, saves and economy. Initially use isolated web renderer instances for original Phaser/Canvas and Three.js games; normalize inputs and exchange versioned lifecycle/state/results messages. Use separate origins/storage partitions and restrictive bridge permissions. The development service builds each cartridge in a worktree; candidate renderers receive copied saves. Native games later require a separately implemented process/video/input integration path; arbitrary engines cannot simply be loaded as web modules.

Tradeoff: faster small browser-game generation, independent updates and stronger failure containment; extra input latency, focus/resize/audio complexity, inconsistent art/camera behavior and weaker cross-game object portability. Renderer isolation must be configured; a wrapper alone is insufficient. Overworld code updates replace the shell on restart.

Smallest complete prototype: desktop wrapper, small hub, original Canvas arena and Three.js race; one normalized controller; agent changes cartridge code and a hub navigation cue in separate candidates. Test enter/exit, input focus, cartridge crash recovery, schema compatibility, immutable build selection, cloned-save trial, accept/revert and offline relaunch. Keep a crashing candidate from touching the hub’s save. No native engine embedding in version one.

## Development-system improvement and local inference

Keep two independent version axes: game manifest and developer/evaluator manifest. Changing a game, a reusable agent skill, and model weights are different experiments. OpenGame’s template/debug capability is relevant to reusable developer skills; Voyager suggests retaining verified behaviors for test agents. Neither justifies letting the developer rewrite its own acceptance rules unobserved.

Proposed approach: store verified engine recipes, failure signatures and fixes, then evaluate a changed planner/toolset on held-out feedback tasks from all prototype games. Measure valid builds, intent fulfillment, regression rate, human preference, latency and cost. Freeze the baseline evaluator and reserve unseen tasks; improvements must generalize beyond the training incidents. Promote/revert the developer independently. Start with skill memory and tool improvements; model training is optional later work, not needed for the first game loop.

Local gameplay means rendering, input, simulation and saves remain on the player’s machine; building may still call a cloud LLM, speech model or asset service. Fully local inference additionally requires locally available model weights and every generation/judging modality to run on that machine. A configurable API endpoint does not prove that requirement. Offline templates and rules work without inference; queue natural-language requests if the service is unavailable.

Before promising fully local AI, benchmark the exact target machine, model and quantization across ten representative edits, including a code bug, control change, content edit and migration. Measure peak memory, time to a passing candidate, quality and frame-time interference. Separate build CPU/GPU demand from inference demand. The 27B model named by OpenGame is not evidence that it will fit or perform acceptably on the player’s hardware. Initial prototype should record cloud usage explicitly and avoid promising console-like instant generation.

## The deciding experiment

The most important unresolved decision: how much freedom must the AI have for players to experience meaningful improvement—bounded content/rule changes, or arbitrary code/mechanics changes? This choice determines the architecture, isolation burden, waiting time, save guarantees and size of the promise.

Run a controller-only, within-player pilot with 8–12 participants in the same two-game hub. Each gives three contextual requests, including one hub request. Counterbalance two conditions: A permits schema-bounded edits; B permits module code edits. Keep proposal UI, base scenarios, inference budget and art identical. Use actual asynchronous builds and record real waiting; do not disguise hand-authored changes as agent output.

Measure request intent fulfilled, candidate preference against the same-seed baseline, acceptance/revert rate, lost play time, time to a valid candidate, build/migration failures and next-session retention of progress. Ask whether the changed experience still feels like the same world. Record unsupported requests rather than coercing them into parameter edits. Do not treat more time played as the sole success metric.

Pre-register a practical decision rule: stay with A if it satisfies at least 70% of requests and preferred accepted changes appear in at least two-thirds of completed comparisons; move toward B only if it adds at least 20 percentage points of intent fulfillment or fulfills a consistently essential class of requests A cannot. Require zero lost authoritative saves in both conditions; migration failure blocks adoption. These are proposed product thresholds, not established research constants or statistically powered conclusions. Repeat with a larger sample after learning the failure modes.

Start by proving the loop, not the genre count: two original subgames, one small overworld, two real improvement cycles, durable saves, one failed candidate and one successful rollback. That complete experiment answers more than a large collection of generated demos.
