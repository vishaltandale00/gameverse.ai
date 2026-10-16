# Native improvement engine handoff

This branch exposes the existing native builder, Decision-AI System 1/System 2 playtester and bounded diagnosis/repair loop through a standalone local API. Vishal owns game navigation, player saves, acceptance and activation. This worker builds isolated candidates and reports observable outcomes; it never activates them.

Run the service with Node 22+ and Python 3; the source uses the standard libraries and needs no npm install:

```sh
node scripts/serve-improvement.mjs
```

Open `http://127.0.0.1:4175/improvement` for the standalone improvement page. The clean-checkout `reference-key-door` button runs the authored grid reference fixture without a ROM, external source installation or model service. Its retained action-log replay completed in 18 actions with zero model calls and zero repairs (0.022489 s); this checks the reference engine path, not native GBA generation. The separately retained API/UI smoke fetched the page, CSS, three modules and capabilities successfully, with eight checks in 0.126 s and no model/native run.

Inspect `http://127.0.0.1:4175/api/improvement/capabilities` and [the API contract](IMPROVEMENT_API.md). A clean checkout reports missing native inputs explicitly. Original cartridges, recovered source evidence, emulator checkpoints, compiled bridges and model credentials are external prerequisites, not distributed payloads.

The original `aria-double-xp` and `aria-soulstride` recipes retain their registered native build behavior. The separate `aria-soulstride-controlled-lunge` improvement recipe is a declared repair fixture: it starts with a supported one-pixel lunge and permits the existing three-pixel mechanic as an exact supported repair. System 2 must ground its selection in retained native birth/velocity observations and choose a registered request identity. This demonstrates the real repair path within a reviewed mechanic; it does not promise arbitrary source edits or qualification of every game.

## Model configuration and bounded continuation

Provider settings come from process environment references. The local SID configuration may be loaded by setting `GAMEVERSE_SID_ENV_FILE` to an authorized external env file containing `SID_LLM_URL` and `SID_LLM_KEY`; secret values must never enter requests, receipts, source or Git. The existing model clients retain their configured System 1 and System 2 identities. The raw System 1 confidence/margin gate stays at `.65/.20`; uncertain decisions go to System 2. No calibrated confidence claim is made.

The reviewed profile is `tools/prefab_pipeline/profiles/aria-soulstride-iteration.json`. Preparation refreshes its declared mechanism and fixture file pins without building or calling a model. A new run records exact input, adapter, environment and loop identities, then uses finite native-frame, model-call, attempt and wall-time limits. Native emulation advances without a real-time throttle. Native speed and provider latency are separate measurements; no multiplier is a latency guarantee. The public `timings.simulation_s` field is the composite experiment stage, including model calls; it is not pure emulator time. Use the retained experiment’s native action and policy/provider timings for that distinction. These nested timings overlap the experiment and total durations and must not be added again.

A bounded chunk can retain an exact candidate checkpoint, scenario state, model context and known resource usage for a subsequent process. Continuation uses the prior report hash and a fresh run identity/output directory. It checks the exact cartridge, adapter and environment before restoring state. A repaired cartridge starts from its own input-only fixture; snapshots are never transferred across changed ROM bytes. Interrupted stages with unknown usage remain blocked. A returned artifact, exhausted chunk or process exit does not establish the native objective; inspect the experiment outcome and source-backed objective witness separately.

Standalone equivalents use the same existing engine:

```sh
python3 -B -m tools.prefab_pipeline run-profile --request tools/prefab_pipeline/requests/aria-soulstride-controlled-lunge.json --template tools/prefab_pipeline/profiles/aria-soulstride-iteration.json --run-id NEW_RUN_ID --output-dir NEW_OUTPUT_DIRECTORY --output RESULT.json
python3 -B -m tools.prefab_pipeline continue-profile --prior-report PRIOR_ITERATION.json --prior-report-sha256 PRIOR_REPORT_SHA256 --template tools/prefab_pipeline/profiles/aria-soulstride-iteration.json --run-id NEW_RUN_ID --output-dir NEW_OUTPUT_DIRECTORY --output RESULT.json
```

## Goal-defined campaigns

The bounded repair fixture above is a smoke check. Longer traversal uses the same playtester through `native-campaign`: a registered source-fact milestone graph defines the actual goal, and a versioned loop configuration supplies cumulative finite frame, model-call, repair, chunk and wall-time limits. Reaching a chunk limit retains a partial checkpoint and automatically starts the next chunk. Cancellation uses a cooperative sentinel; a new process can resume known completed work with the same pinned inputs. Unknown interrupted consumption remains blocked. Provider, adapter and invalid-response failures stop the campaign rather than being retried until its cap.

`tools/prefab_pipeline/campaign.py` also runs standalone with `--request`, `--template`, `--config`, `--output` and optional `--resume`. An explicitly pinned `initial_report_ref` can adopt a measured preliminary chunk into a newly budgeted campaign, retaining its exact native/model state and counting its consumption. Budget changes are recorded inputs, not evidence of improved performance or goal completion.

The existing Sonic/MZM cartridge provides one traversal case: start at the coast with no upgrades, acquire coastal gear and open locks, traverse both coastal acts, and reach Factory with the required gear. The ordered graph uses observed native stage, upgrade, gate and relic fields; it does not count actions as success. The boss/capsule interpretation is labeled as an inference from native progression unless direct callback evidence is present. This is qualification of an existing cartridge, not new mashup implementation.

Native options advance until source-state changes or bounded motion checks require another decision. They retain the normal System 1 confidence gate and System 2 escalation. Native action throughput, setup, observations, provider latency and complete workflow speed must be reported separately; the earlier repair fixture's action-only multiplier is not end-to-end traversal speed.

## Recovered RPG navigation and per-mod quality

The `sid-rpg-weekend-original` recipe is a pinned **original baseline traversal**, not a generated mod. Its `sid-rpg-weekend-iteration` profile selects the recovered SID memory decoder, live source POIs and original `Bot.plan`/`Bot.passable` pathfinding. The modern controller selects semantic destinations, menu answers and battle actions through System 1, then uses the existing confidence-triggered System 2 path. Walking the selected source-backed route and continuing noninteractive input do not require a model request for each tile. Actual zero-call navigation remains explicitly accounted as zero; it cannot stand in for a semantic model decision.

The source-owned weekend scenario starts from the supplied post-Champion save and tracks story stages 0 through 6: arrival, greeting, beach, pair battle, and gym gauntlet. It is not an authentic new-game gym start. Source flags determine milestones; missing milestones stay partial. Battery startup and exact native snapshots are separate operations. No new ROM, save, source tree or credential is distributed.

The checked-in request contains the author's exact private installation fingerprints. Another installation must create its own descriptor and versioned request/profile/registry pins; the author's provider hash is not portable. Generate the local descriptor with the existing adapter command:

```sh
python3 -B -m tools.playtester.rpg_adapter --install-root /path/to/authorized/sid-source --rom /path/to/game.gba --elf /path/to/game.elf --save /path/to/copied-save.sav --output local-data/rpg/provider.json
```

Keep the ROM/ELF/save copies and provider JSON under ignored local data, update their exact relative references in a new `native-artifact-traversal-request/1`, and register that request/profile in the data-only catalog. Regenerate/check the provider readset before requesting capabilities. The adapter validates the external source/tool installation at admission; it does not import an arbitrary client-selected module. This is a deliberate per-install setup step, not an automatic game installer.

For the already reviewed local installation, the same engine command is:

```sh
python3 -B -m tools.prefab_pipeline run-profile --request tools/prefab_pipeline/requests/sid-rpg-weekend-original.json --template tools/prefab_pipeline/profiles/sid-rpg-weekend-iteration.json --run-id NEW_RUN_ID --output-dir NEW_OUTPUT_DIRECTORY --output RESULT.json
```

Registered mods can select an adapter/scenario through their pinned iteration profile and optionally supply `experiment.mod_quality_ref` plus pinned original-run evidence in `experiment.mod_quality_runs`. The existing stages dispatch that contract against the actual current candidate report/events; report hashes bind the exact event log. Objective, invariant, reachability and changed-mechanic predicates reuse the same source milestone evaluator. Missing original coverage is unknown, identical baseline/candidate artifacts cannot earn a mod-comparison pass, and missing support is reported explicitly. An original-only RPG run is labeled not evaluated for paired mod quality. A profile may explicitly require its declared quality contract to pass before reporting the candidate as qualified; no universal benchmark is invented.

The [actual RPG prefix receipt](../verification/rpg-weekend-prefix-20261016.json) records a partial original-baseline run: 20 provider calls (one System 1 and 19 System 2), 36 actions, and 2,131 native frames comprising 1,692 setup frames and 439 gameplay frames. Experiment wall time was 51.098177 s; worker wall time was 51.563291 s. Only stage 0/start was observed, and the checkpoint was retained. Repeated stationary wait/text decisions escalated while a native script remained active; this exposes a source-readiness/observation gap, not substantive quest coverage. The 439 gameplay frames represent about 7.35 s at nominal speed, so this run does not demonstrate end-to-end acceleration. No quest completion, battle success or paired mod-quality pass is claimed. A later adapter correction must use a new runtime authority and preserve this receipt unchanged.

## Private bundle export and rebuild

The source-only helper closure includes `tools.roundtrip.private_bundle` and its contracts, reassembly and native-provider helpers. It can export an admitted packet into a private bundle and rebuild that bundle:

```sh
python3 -B -m tools.roundtrip.private_bundle export --input PACKET --output NEWBUNDLE
python3 -B -m tools.roundtrip.private_bundle rebuild --input BUNDLE --output NEWROM
```

This capability is `rebuild_only`. Original-derived bytes and output bundles remain private; there is no API/upload route or fresh IR-compilation claim. Six synthetic checks ran in 0.022 s. The separate existing admitted IR-bundle replay uses `rebuild --bundle BUNDLE --output NEWDIR`; fresh admission still requires authoring helpers outside this public subset and is setup-required. These helpers do not establish a complete fresh game-recovery pipeline.

## Install exact local provider inputs

An authorized existing working checkout can act as the provider source. The checked-in manifest lists each required path, size, hash and recipe membership; it contains no payload. Verify all source inputs first, then explicitly install missing matching files into this checkout:

```sh
node scripts/improvement-provider.mjs --manifest contracts/improvement-provider-pack.json --source /path/to/authorized/working-checkout --check
node scripts/improvement-provider.mjs --manifest contracts/improvement-provider-pack.json --source /path/to/authorized/working-checkout --install
```

The importer refuses traversal, symlink escapes, stale source pins and conflicting existing target files. It preserves matching existing files. The importer currently checks the full declared pack across registered recipes; it has no per-recipe selector. The source must contain every exact matching authorized input declared for Aria, Sonic and the local RPG installation, including required private checkpoint/provider metadata. Different ROM revisions or arbitrary downloads are insufficient. RPG descriptors with external installation roots must be generated and versioned locally as described above. Local provider material must remain local. Recheck capabilities after installation and keep backend admission errors visible.

Native compilation uses `cc` with Clang's ARMv4T target support plus `arm-none-eabi-ld`, `arm-none-eabi-objcopy` and `arm-none-eabi-nm` on PATH. Double-XP qualification also requires mGBA development headers/library, ffmpeg and the built session bridge (`make -C tools/re/session`, with `MGBA_PREFIX` configured for your machine). The existing Double-XP oracle currently assumes the Homebrew `/opt/homebrew` mGBA prefix; using another installation needs a reviewed portability change. Soulstride candidate construction does not run that qualification stage. Model-backed improvement requires the built session bridge and its mGBA library as well as an available configured provider.

## Public source and private evidence boundary

The public subset consists of project API/transport, validation, compilation, authored strategy-lowering and exact-host adapter generator source; synthetic tests use invented bytes and fixture plans. It contains no ROMs, game art/audio, save files, native binaries, model keys, generated game output or wholesale decompiled source trees. Hashes, native addresses and recipe metadata identify dependencies; they do not distribute those dependencies or certify permission to redistribute a provider pack.

Recovered game policy/source and assembly evidence stay in the external local provider read set. The generator and manifest retain their file identity and classification rather than relabeling them as redistributable assets. The host adapter generators use explicit versioned native addresses/offsets and fail when reviewed evidence pins differ. Neither recipe establishes full-game IR recovery, full-campaign equivalence or safe save migration. The original Soulstride recipe is build-only; its separate controlled-lunge profile exercises native model-backed repair. Double-XP retains its separately requested bounded qualification.

## Verified full-engine HTTP check

[The sanitized receipt](../verification/improvement-full-engine-http-20261016.json) records a real two-process HTTP run on macOS arm64 with libmGBA 0.10.5. The first chunk observed four native one-pixel Skeleton birth impulses and retained its exact cartridge/state/model context. After stopping and restarting the server, the second chunk restored that context, made an actual System 2 diagnosis selecting the reviewed repair, rebuilt the candidate, and observed a three-pixel birth impulse from a fresh repaired-ROM fixture. HTTP result, iteration and ROM downloads passed digest checks. Stale loop/profile/report pins and a continuation from changed engine code were rejected.

The corrected campaign used 34 actual provider requests (25 System 1, eight play System 2, one diagnosis), 12,535 native frames including setup/render, and one source repair. Worker execution totaled 25.118 s, excluding the human restart interval. Weak and repaired source builds took 0.335447 s and 0.349566 s; exact cached-build validation on continuation took 0.006390 s. Audited model-selected action integration achieved 802.432 frames/s (13.435 times nominal) on this machine, excluding fixture boot, observation and provider work. This is a scoped measurement, not a speed guarantee. There is no comparable earlier full-engine baseline; queue time, billing and remote CI timing are unavailable.

The first campaign’s native objective passed but independent validation found mutable checkpoint data had changed the recorded input configuration. Its original evidence remains retained. After a defensive-copy fix and strict continuation engine-version admission, the complete two-chunk campaign ran again from fresh inputs. Both campaigns consumed 81 actual provider requests and 25,214 native frames in total. Full-campaign gameplay, save migration and player activation remain untested.

## Focused validation and timing

```sh
node --test tests/improvement-api.test.js tests/improvement-provider.test.js
python3 -B -m unittest tools.composition.test_native_build tools.prefab_pipeline.test_contract tools.prefab_pipeline.test_mod_rom tools.prefab_pipeline.test_native_mod.RegisteredStrategyTests
```

Historical build-only handoff baseline: in the clean isolated checkout on 2026-10-16, nine Node checks passed with no skips (latest post-fix runner duration recorded in the portability receipt), and 35 Python synthetic contract checks passed (63 ms runner duration). These check source/admission/receipt integrity without ROMs, compilers, emulators or model calls. No CI job, dependency or test matrix was added. There is no prior API baseline or remote CI queue/job timing; those measurements are unavailable. Actual backend build timing remains separate from transport execution and nested stages must not be summed twice.

The isolated provider bootstrap was also exercised against the existing authorized working checkout: 60 declared files validated, missing inputs installed, and the narrow Soulstride CLI produced the same candidate SHA-256 as the original checkout. [The portability receipt](../verification/improvement-handoff-20261016.json) records 0.347796 s total backend time with 0.291864 s nested native build time on macOS arm64. This was one candidate construction check using the already installed toolchain; no independent gameplay qualification was added. Provider inventory generation only hashes/reads existing files; it does not run native or model checks.
