# Containerless playtest/build investigation

Date: 2026-10-16. Decision: **measure the existing loop, then prototype headless mGBA in a Durable Object; defer a WASM build toolchain.** This is a feasibility direction, not evidence that the current bot fits Workers or that a 30× invoice reduction is available.

Read-only investigation of the current workspace and `/private/tmp/gameverse-improvement-handoff-20261016`; only this report was added. No cloud deployment, credentials, model calls, dependency installs, campaign, full build, or changes to the ongoing FireRed ↔ MZM work. A bounded local Node inspection compiled the existing 810 KB WASM module only to enumerate imports/exports; Python parsed its memory section. These checks establish binary shape, not Workers compatibility or ROM execution.

## What Claude got right, and what changes the decision

- The browser already runs mGBA WASM, and bounded frame execution plus save/load is a useful starting point. A per-run durable coordinator with immutable artifacts and resumable chunks can preserve the existing external contract.
- Native/Python playtest migration is the substantial work. Moving just the compiler does not eliminate a sandbox that remains started for playtesting/model waits. Conversely, a sandbox stopped between native chunks could already reduce waiting cost; that option needs a comparable measurement.
- The suggested order is sound: baseline → emulator/playtest prototype → compiler feasibility. However, browser execution does **not** establish backend bot/oracle parity, and 128 MB is a combined isolate constraint, not a guaranteed private emulator heap per run.
- DOs have no separate CPU-duration price line, but CPU execution limits still apply. Awaiting a model inside a DO is billed active duration; only returning to an idle, hibernation-eligible state stops duration billing.
- The quoted ~$0.17/30 hours is a smooth rate equivalent. **Current published billing rounds excess duration to whole million GB-second units**, so it is not a standalone invoice estimate. The Daytona comparison also assumes a particular machine size, not its default.

## Actual code and port gaps

The workspace pins `@wasm-gaming/mgba-wasm` **0.1.1** in `package.json`. `src/emulator-worker.js` uses `importScripts`, `self.createMgbaModule`, `postMessage`, `OffscreenCanvas`/`ImageData`, realtime timers and audio messages. It loads the low-level C ABI directly, rather than the package's higher-level UI SDK. The SDK source explicitly describes a core without SDL, main loop or Asyncify; this makes a headless wrapper plausible.

The installed binary is **809,645 bytes**, with one unshared linear memory: **64 MiB initial / 512 MiB maximum**. This agrees with the [upstream build recipe](https://raw.githubusercontent.com/wasm-gaming/mGBA-wasm/main/scripts/build-mgba.sh), which disables threading and debuggers and enables Emscripten filesystem support. Upstream main is contextual evidence, not a substitute for the installed binary's identity.

| Capability | Browser/pinned WASM today | Native bot / investigation consequence |
| --- | --- | --- |
| ROM, keys, deterministic frame step | C exports exist; shell paces frames for human play | Build a headless bounded step API; do not retain realtime pacing as simulation policy |
| Observation | RGBA buffer, rendered through canvas | Return bytes or encode PNG without DOM; native currently writes PNG and screen/source facts; ffmpeg video is an additional optional port |
| Audio | PCM exports and browser messages | Drain/discard in headless mode; no browser audio context required |
| Normal save and snapshot | SRAM and state-size/save/load exports exist | Verify same-core restore and provenance. Native `.ss` and WASM raw states are **not assumed interchangeable** |
| Game RAM | WASM heap view exposes implementation memory, not an emulated-address API | Add pinned read-only bus/RAM exports. Do not index GBA addresses directly into `HEAPU8` |
| Action early termination | Worker currently steps fixed realtime frames | Native `tools/re/session/session.c` samples up to 32 masked RAM watches after every frame and stops on changes; reproduce that boundary guarantee |
| RPG navigation | No bot policy in browser wrapper | Handoff `rpg_adapter.py` uses source/RAM collision, elevation, objects, warps and deterministic tile-route actions; port the reader/policy rather than substituting screenshots for equivalent observations |
| S1/S2 controller | No browser equivalent | Preserve confidence/escalation rules, graph visits, failed probes, historical hypotheses, scenario/navigation state and resource counters across chunks |
| Native function oracle | No public register/single-instruction API in pinned shim | `tools/behavior_ir/native_abi.py` accesses ARM GPRs/CPSR, PC/SP/LR, instruction stepping and bus state for function entry/live-outs. This requires a distinct low-level shim/validation effort, beyond normal playtest frames |
| Build | Native subprocesses and filesystem | A compiler WASM alone does not replace build recipes, asset tools, assembler, linker, object-copy, preprocessor or dependency tracking |

Native evidence: handoff `tools/re/session/README.md`, `tools/playtester/README.md`, `rpg_adapter.py`, `rpg_experiment.py`, `session.c`; current `tools/behavior_ir/native_abi.py`. The native bot currently isolates cartridge saves and restricts ordinary observation reads to IWRAM/EWRAM. Preserve these restrictions and exact ROM/provider identities.

The ordinary playtest and the behavior reconstruction oracle have different goals. A successful headless WASM playtest must not be presented as qualification of the FR ↔ MZM function oracle. Original ROM and modified candidate need separate pinned artifact identities and save compatibility checks; passing an original-ROM campaign does not certify a modified ROM.

## Workers constraints and chunk semantics

Workers accept precompiled WASM module imports and instantiation with imports. Runtime `WebAssembly.compile`, streaming compilation and instantiate-from-buffer are unavailable; adapt the Emscripten `instantiateWasm` hook to the bundled module. Fetching a ROM from R2 is data loading, so that restriction does not prevent loading new GBA candidates. [WASM docs](https://developers.cloudflare.com/workers/runtime-apis/webassembly/), [web standards](https://developers.cloudflare.com/workers/runtime-apis/web-standards/).

No Web Worker threading API is available. The browser's canvas/audio/message wrapper needs replacement; the core's already single-threaded build helps. Emscripten MEMFS can provide in-memory C filesystem calls, but it is volatile; WASI support is experimental and neither supplies native subprocesses nor a persistent POSIX build environment. [Workers WASM](https://developers.cloudflare.com/workers/runtime-apis/webassembly/), [Emscripten filesystem](https://emscripten.org/docs/porting/files/file_systems_overview.html).

The **128 MB includes JS and WASM allocations and is per isolate**. Multiple objects can share an isolate. Budget ROM input buffers/copies, 64 MiB initial heap, heap growth, snapshot scratch, RGBA/PNG, source maps, model prompts/results and JS policy data together; 512 MiB configured maximum is not usable capacity. Measure realistic and multi-object peaks, not just successful module construction. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [DO pricing memory allocation](https://developers.cloudflare.com/durable-objects/platform/pricing/).

DO CPU defaults to **30 seconds per invocation**, configurable to **5 minutes**; alarm wall limit is **15 minutes**. Network waiting does not consume CPU allowance. Avoid treating these maxima as a latency budget: first measure frames per CPU-second, then choose a configurable bounded chunk with margin and yield so cancellation/status events can execute. Six simultaneous outbound connections per request also constrain parallel fetches. [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

An object can schedule one alarm; alarm delivery is at least once, with exponential retries starting at two seconds, up to six retries. Only one alarm handler executes at a time per object. This is not exactly-once execution or unlimited recovery. [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).

Pending model fetches/outbound connections keep the object active and billed; pending operations prevent eviction for up to 15 minutes each. Use explicit abort/deadline handling below the relevant invocation limit. For long asynchronous provider jobs, persist the provider job ID and return, then poll by alarm if the provider supports it. Alarms do not magically suspend an outstanding HTTP model request. Hibernation discards in-memory emulator/policy state. [Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).

Suggested state boundary: immutable content-addressed ROM/core/config plus snapshot, observation and learning/navigation/scenario blobs in R2; a compact DO record atomically points to the committed generation and cumulative budgets. Write and verify blobs before publishing the pointer; orphan blobs can be collected later. R2 and DO metadata are not one cross-service transaction. Treat replayed alarms, duplicate requests and ambiguous model responses as expected: generation IDs, action/decision IDs, result deduplication and provider idempotency when available. Exactly-once provider billing cannot be guaranteed without provider support. Before each chunk/model request and before accepting a result, check cancellation/revision; preserve a cancelled checkpoint without promoting a candidate. Persist progress receipts and explicit retry exhaustion. Rehydrate S1/S2 state without replaying startup or resetting counts. Keep accepted player saves outside experiment state.

These are proposed implementation requirements for a prototype, not a new mandatory central scheduler. They follow existing `contracts/PARALLEL_DEVELOPMENT.md` and `IMPROVEMENT_LOOP.md` ownership, pinned-input and cancellation meanings.

## Costs: illustrative arithmetic, not project measurements

Current [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) lists $12.50/million GB-s and $0.15/million requests after included paid allocations (400,000 GB-s and one million requests/month), plus a $5 paid-plan minimum. The page explicitly says: “For example, 500,000 GB-s of billable compute duration is rounded up to 1,000,000 GB-s and billed accordingly.” Its Example 4 charges $12.50 for 152,960 excess GB-s. Free-plan daily duration is 13,000 GB-s, with failures when quota is exceeded. Using the documentation's decimal 0.128 GB billing allocation:

`usage = 0.128 × active_object_seconds`

`paid_duration = $12.50 × ceil(max(0, monthly_usage − 400000) / 1000000)`

Add request units, storage, calling Worker costs, R2 and model costs. Allocations are shared account usage, not separately granted to each run. The smooth $0.00576/hour is useful for scale comparisons, but actual bill changes occur at bucket boundaries.

| Illustrative continuously active workload | Smooth compute equivalent | Invoice qualification |
| --- | --- | --- |
| DO, 30 hours | $0.173 | 13,824 GB-s; zero duration overage if paid allocation remains; crossing into first excess bucket adds $12.50 |
| Daytona default 1 vCPU / 1 GiB, 30 hours | $1.998 plus billable disk | Roughly 11.6× DO smooth equivalent; performance/memory are not equivalent |
| Daytona 2 vCPU / 4 GiB, 30 hours | $4.968 plus billable disk | $0.1656/hour, close to quoted $0.168; roughly 28.8× smooth equivalent |

[Daytona prices](https://www.daytona.io/pricing) are $0.0504/vCPU-hour, $0.0162/GiB-hour and $0.000108/GiB-hour disk after the first 5 free, billed per second. [Default sandbox](https://www.daytona.io/docs/sandboxes) is 1 vCPU, 1 GiB RAM and 3 GiB disk. Actual project cloud profile is unmeasured/unverified here. [Billing lifecycle](https://www.daytona.io/docs/billing): a started sandbox bills reserved compute even while Python waits for a model; stopped containers bill disk only, archived containers do not bill; VM pause bills disk, not preserved memory. Container pause is not the VM memory-preservation feature. Include transitions, startup and restore costs in a stop-between-chunks comparison.

[R2 Standard](https://developers.cloudflare.com/r2/pricing/) adds storage and operation charges after free allocations, with unit rounding; internet egress is free. Model token/image/provider charges remain separate from either platform's compute and could dominate. No current project token-cost baseline or actual cloud invoice savings was measured.

## Existing baseline and smallest useful experiment

Reuse `verification/rpg-final-qualification-20261016.json` in the handoff checkout: run `3589625d-4431-4318-87df-00e95970907f`, source `96c5566a018896bf91ebbc5d6ad2d84f9adbf7cb`. It records 34 calls (9 decision, 25 S2), 7,893 native frames (1,692 startup + 1 resume integration + 6,200 play), 60.162394459 seconds worker wall and 46.333991126 seconds model request wall, approximately 77% of worker wall. This supports investigating waiting cost; it **does not measure CPU-active time**. Outcome remained partial, budget exhausted, stages 0–4 observed; whole quest and modified-game behavior unqualified. Nested model/action/observation timings must not be added to worker totals. Queue, build, inference-only time and monetary cost are unavailable.

1. **Baseline first, no new infrastructure.** At the next already-authorized bounded native run, retain existing wall/stage reports and add lightweight process CPU user/system deltas for Python/controller **and child emulator/build processes**. Main-process CPU alone misses native work. Record machine, exact inputs/toolchains, run IDs, cache mode, overlap and failures. No comparable before/after cloud result exists yet.
2. **Capability gate, no model campaign initially.** A local Workers-compatible headless module with a pinned ROM/save; advance a bounded action trace; compare frames/source RAM/watch stops and within-core checkpoint replay; restore in a fresh object. Start with one ROM and existing tools; opt-in scope, no CI matrix/dependencies. Record CPU, wall, heap growth and full isolate memory. Fail visibly on missing APIs. Native/WASM cross-core state conversion is not required for this gate.
3. **Durability gate.** Replay the existing controller decision fixture through two chunks with a fresh instance, duplicated alarm/request, failure after blob upload and before metadata commit, cancellation and exhausted retry. Require preserved learning/navigation/scenario state, cumulative limits, pinned identities and no accepted-player writes. Concurrency must not rely on a private 128 MB per object. Then one explicitly budgeted real-provider comparison can assess whole-loop cost/latency; it is separate authorization/work.
4. **Build gate last.** Current `scripts/sources.mjs` invokes pinned `agbcc`, host preprocessing and ARM GNU binutils through make, and records clean/incremental mode and stages. [FireRed upstream installation](https://raw.githubusercontent.com/pret/pokefirered/master/INSTALL.md) confirms a multi-tool native build. Prototype the entire representative FireRed asset/compile/assembly/link/object-copy path with a real source change, cache persistence and provenance under the actual total memory/CPU limits. A tiny C compile proves too little. Keep compiler and emulator separate in memory where possible. Do not commission the full port until playtest savings and memory headroom justify it.

No numeric performance budget is established by this investigation. Keep configured frame, call, wall, repair, concurrency and spend limits. This work does not replace qualification of current native behavior swaps or alter the workstream split.
