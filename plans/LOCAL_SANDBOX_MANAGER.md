> 2026-10-20 scope update: ordinary API-key players use fully hosted cloud dispatch without the local manager. This plan describes developer sandbox work and personal Codex fallback. [Hosted voice contract](../contracts/HOSTED_VOICE.md) and [operation/qualification](../docs/development/HOSTED_VOICE.md) describe issue #21 H0–H3. Manager-online requirements below apply only to the developer route. The dated decisions in #21 supersede older universal-manager or remote-game assumptions.

# Local cloud sandbox manager — issue #21 implementation plan

Status: packages 0–2 were explicitly authorized and implemented in Daytona on 2026-10-19. The next authorized slice is N0–N2: a Daytona voice agent with browser game/takeover authority and local Stop/handback. See [the voice slice](../docs/development/BROWSER_VOICE.md). See `docs/development/SANDBOX_MANAGER.md` and its qualification report. Deployment, real provider-model runs, publication and N3–N5 remain outside this slice. Provider, deployed-browser, remote-gameplay and authored-harness gates remain. The source review below records the original planning baseline.

Primary specification: [issue #21](https://github.com/vishaltandale00/gameverse.ai/issues/21). Related work: #16 hosting, #22 construction/improvement, #23 shared gameplay agent, #24 voice-triggered takeover and #25 merged implementation. Inspected source: `6dc3a480c254b9a07ba6979ada68bc9ec992539f`. Fetch/pin main again before implementation; preserve this source identity for the findings below. The personal worktree has no implementation commits; its existing research note is untracked.

## Agreed behavior

- Vishal and Shishir start a local manager manually from this repo on macOS. Coding, builds and verification execute in private disposable Daytona sandboxes. Product game/rendering and the simulated-user harness stay in the player browser; the voice agent runs in Daytona. Test browsers also run in Daytona to honor the development constraint.
- `gameverse.build` provides the developer UX, Claude/API-key setup and manual **Check for dev app**. Discovery does not run on page load or scan ports. Explicit account-bound pairing survives restarts until revoked/disconnected.
- A shared Daytona account contains separate isolated developer/game/improvement sandboxes. Both developers can manage each other's manager-created development sandboxes with cross-owner confirmation. External/discovered sandboxes start read-only. Personal model connections stay separate.
- The selected developer Codex connection serves outer repository coding and inner game improvement. The simulated player has an isolated Gameverse profile and separate saves/revision history. B is the outer patch/PR; B′/B″ are user-owned game revisions.
- Existing jobs may continue within remote deadlines while the manager is offline; new launches wait. Reconnect reconciles actual outcomes without redispatch. Cancel parent cancels its whole descendant tree and retains recoverable results. In-game Stop still revokes only the targeted gameplay run.
- One shared parent allowance includes every descendant, with finite per-job limits. **Accepted starting policy:** one active parent per developer, one active inner improvement job per parent, outer work may remain running, and no automatic provider/infrastructure-failure retries. Successful transport reconciliation is not a new job/model attempt.
- Saved history, patches and results are available through private Cloudflare persistence when the manager is offline. Automatic branch/draft-PR publication occurs after source-bound required checks pass; no automatic merge/deploy. Sleep prevention and indefinite browser-close continuation are outside this scope.
- Final proof is soccer **B → B′ → B″**, reusing #23/#24/#25 interfaces, with real voice requests, fresh inner sandboxes, independent gameplay verification and remote continuous A/V evidence.

## Verified starting point and missing capabilities

| Existing source | Reuse | Required change |
| --- | --- | --- |
| [Daytona adapter](../infra/cloudflare/daytona.js) | Authenticated files/processes, private provisioning, deletion checks | Inventory, explicit resource/deadline configuration, remote sessions and typed job inputs; current snapshot/short timeouts are probe-specific |
| [Account jobs](../infra/cloudflare/account-jobs.js), [Claude runtime](../infra/cloudflare/claude-runtime.js) | Durable identity/idempotency/cancel/cleanup patterns | They hard-code an addition fixture; add a separate developer-task runner and result handler rather than pretending arbitrary repo work already exists |
| [Admission](../infra/cloudflare/sandbox-admission.js) | Atomic admission and release only after confirmed cleanup | Current global one-sandbox cap cannot run nested siblings; developer admission needs parent/owner/role reservations |
| [Connections](../infra/cloudflare/agent-connections.js), [vault](../infra/cloudflare/credential-vault.js) | Generation/revision fencing, encrypted storage semantics | Whole-job exclusive connection use cannot be copied into parent/child execution; separate model-use authorization from refresh ownership |
| [Voice agent](../src/voice-agent.js) | Request/tool correlation, selected-session authority | Its catalog has takeover/status/stop tools, not source-improvement submission |
| [Host](../src/agent-host.js), [shell](../src/agent-shell.js), [simulated user](../src/simulated-user.js) | Exact-session control, Decisions circuits, reflections, limits, Stop/stale answers | [main](../src/main.js) currently ticks the harness from browser RAF; preserve the browser engine/harness and add a fixed-tool bridge to a managed Daytona voice worker |
| [Provider boundary](../scripts/agent-api.mjs), [voice stream](../scripts/voice-stream.mjs) | Separate configured services, accounting and failure behavior | Their API credentials/capabilities are not established by a Codex subscription login |
| [Improvement contract](../contracts/IMPROVEMENT_API.md), [handoff](../contracts/IMPROVEMENT_HANDOFF.md) | Pinned requests, candidate/evidence identity and cancellation meanings | Registered native/grid recipes are not an arbitrary soccer source-construction loop; agree a narrow authored-game adapter with Shishir |
| [Soccer](../src/soccer.js), [catalog](../scripts/catalog.mjs) | Deterministic mechanics, input/save validation and immutable authored-source bundles | Per-test-profile candidate bundle resolution/activation must preserve identity and progress; do not mutate the checked-out shared source in place |

#25 has offline/build/provider-free browser evidence. Earlier real-provider footage used exact archived source rendered on a Mac; the 300 ms revision retained an inconclusive camera check. None proves a remote game worker/stream or nested Codex improvements. Keep each receipt attached to its actual source/environment. New cloud renderer, input, build and full-loop timings are unavailable.

## Architecture and ownership

```text
gameverse.build developer UI
  | manual loopback discovery + explicit persistent pairing
  | authenticated task/history/control API
Cloudflare identity + private task records/artifacts
  | scoped commands/events; no provider credential payloads
local macOS manager (Daytona/GitHub control, private auth, local journal)
  | provisioning, pinned inputs, deadlines, status/recovery
shared Daytona account
  +-- outer coding workspace → repository patch B → checks → draft PR
  +-- voice worker → ASR/planning via scoped backend broker → browser tool commands
player browser → authoritative engine + host + simulated user + local Stop/handback
  +-- inner improvement worker → candidate B′; then fresh worker → B″
```

No new mandatory central loop orchestrator: Cloudflare retains existing product identity, metadata and artifacts; the local manager admits/dispatches work; Shishir's versioned harness owns algorithms and experiments. A per-parent supervisor enforces the admitted job contract in Daytona. Any separate trusted auth runtime required by the provider route counts against the same parent allocation.

Vishal owns manager/host UX, remote runtime/adapters, access/control/progress authority and activation/recovery. Shishir owns the construction/playtesting algorithms, policy/cadence/repair choices, scenarios and loop configuration, coordinating gameplay work with the #23/#24 owners. Shared envelopes follow [PARALLEL_DEVELOPMENT](../contracts/PARALLEL_DEVELOPMENT.md) and [CONTEXT](../CONTEXT.md); do not rewrite those algorithms into the engine.

### Proposed module seams

Names below are implementation proposals, not existing APIs:

- `scripts/dev-manager.mjs`: manual startup, configuration validation and shutdown. Server implementation modules can live under `scripts/dev-manager/`; keep inventory, journal, auth, execution and publication as separate deep modules with small interfaces.
- Shared Daytona transport extracted behind the existing adapter interface, retaining current hosted-probe behavior. Add developer execution through explicit capabilities, not unsafe arbitrary shell-string interpolation.
- Local protected state under an app-defined directory outside the checkout, e.g. `~/.config/gameverse-manager/`: stable installation identity, pairing proof, connection records and command journal. Owner-only directories/files and atomic replacement; separate credentials from shareable logs/artifacts. A Keychain backend can be evaluated without making a new dependency mandatory for the first slice.
- Existing Cloudflare session identity remains authoritative. Small developer-task records keyed by parent/run IDs hold owner, controller epoch, role, parent relation, exact input/config pins, budget reservation, command sequence, state/reason and artifact references. Private R2 holds immutable digest-checked bundles/results. Provider records remain private references, never task payloads.
- Task submission supports human or authorized autonomous callers through the same typed envelope: `submit`, `inspect`, `steer`, `cancel`, `retain`, `publish`. Preserve user follow-ups and durable task context; native agent-thread resume is used only when the pinned runtime supports it. A replacement sandbox can resume from retained inputs/patch/context with explicit provenance, without promising identical in-memory continuation.
- A chat is a supported steering surface via an authenticated manager client/API tool; the website uses the same command boundary. Establish the actual chat-to-manager connection before claiming chat steering, rather than replacing it with manual SSH. Bind autonomous child submission to a parent grant, target/profile and remaining allowance.

Proposed repo commands are `npm run manager` for manual startup and a small `dev-manager-client.mjs` for typed submit/status/steer/cancel operations from the developer's chat executor. They are to be implemented, not commands available today. Use the same authenticated command IDs/events as the website so human and autonomous callers do not create separate execution systems.

Keep coding-runtime adapters provider-specific: the existing Claude login/storage is reusable, but its fixed runtime must become a bounded arbitrary-task adapter before it can execute repository issues. Codex app-server and Claude CLI each get pinned launch/event/completion handling behind the same task contract. API-key execution has separate billing and requires its own capability/inference qualification; a stored validated key is not evidence that any task adapter works. Show only actually qualified provider/auth/runtime combinations as runnable, with explicit selection and no fallback.

### Discovery, pairing and command flow

Use one documented configurable loopback endpoint; fail visibly on port conflict and never scan. Validate exact Host/Origin and reject opaque/unrelated origins. `Check` returns protocol/version/installation identity and a fresh non-secret challenge, not tokens. Start with Chrome on macOS for qualification; probe Safari compatibility and label unsupported behavior truthfully rather than claiming it works.

Proposed pairing: the manager generates a short-lived code and possession key; signed-in developer enters the code through `gameverse.build`; backend binds that installation public key to the verified developer account; manager proves possession and persists the binding. Expire/consume challenges once, rate-limit attempts, reject account mismatch, and support explicit revocation. Website cookies remain first-party. Treat browser local-network permissions/HTTPS-loopback behavior as an early feasibility check.

After pairing, prefer the existing hosted API as a durable scoped command/event queue with an outbound authenticated manager connection. Discovery is still manual. The manager processes idempotent commands only under its persisted account binding, acknowledges source/request identity before I/O and uploads bounded events/results. Cloudflare records metadata but does not acquire the personal provider credentials or launch personal-connection jobs while the manager is offline. A second authorized online manager may reconcile/cancel a colleague's job after cross-owner confirmation, without using that colleague's provider connection to launch new work.

### Codex connection: explicit support gate

Before enabling browser Codex, confirm OpenAI supports this hosted-UI/personal-local-manager deployment. Hosted SIWC partner approval remains a separate alternative; no OSS callback substitution, managed CLI/device-login shortcut, copied cache or presumed plan entitlement.

For a qualified route, implement fresh PKCE/state/nonce, validated JWT identity, account/workspace/issued-client registration binding, distinct stable host lifecycle IDs and atomic protected credential updates. Use the documented custom Responses provider through app-server with `store:false`, `stream:true`; verify real inference completion. Pin the Codex runtime and inspect its actual RPC contract before integration. [Official app-server route](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).

**Credential-owner decision is a technical gate, not another product interview.** Preferred candidate is one trusted connection owner issuing only short-lived access to coding processes, with no independent refresh writers in siblings. Do not silently claim the owner must be local: the documented full-session VM-transfer procedure specifically assigns subsequent refresh to the VM. Qualify whether minimal-access-token delegation from a local owner is supported. If the documented VM procedure is required, design an isolated per-parent trusted refresh owner with exclusive handoff/fencing and durable protected writeback before ownership returns; reserve its resources under the same parent. Do not put the shared rotating refresh credential in multiple model-editable workspaces. If no supported design is established, keep Codex browser connection disabled and report the blocker while generic manager work remains independently implementable. [VM procedure](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms).

A model catalog is not entitlement proof. Codex plan use does not establish access to the Decisions API, TTS or transcription. Maintain separate capability-tested provider references for gameplay decisions, planner, reflections, requester audio and ASR; fail admission when a required service is unavailable. Never silently charge another provider or claim all model activity comes from the Codex plan. [Plan-use limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

### Browser game and managed voice worker (latest decision)

This section supersedes the earlier remote-game/streaming proposal. The game engine, rendering, host grants and simulated-user scheduler remain in the browser. A fixed trusted VoiceAgent worker in a separate private Daytona sandbox receives bounded recordings and selects supported host tools. Provider credentials stay at the Cloudflare broker; the worker has only a task-scoped, expiring capability. The manager retains its existing signed command, budget, journal and cleanup boundary.

The browser explicitly binds one live soccer session, profile, immutable artifact, source and epoch before recording. A command is executed only against that binding and acknowledged once. The existing harness requests decisions/reflections through the worker and broker. Browser controls remain the final authority: Stop releases input/progress ownership synchronously, then attempts remote cancellation. Hidden/closed pages, expired leases and stale commands revoke local grants. A delayed model response cannot reacquire them.

The next N3–N5 work adds separately admitted candidate workers and host-owned checkpoint activation for B′/B″. It is outside N0–N2. Personal Codex setup, source improvement, streamed remote gameplay and a new engine are not prerequisites for this voice slice.

## Implementation sequence and gates

| Package | Deliverable and dependency | Narrow validation and expected cost |
| --- | --- | --- |
| 0 — qualify interfaces | Freeze typed task/session/connection references and required-check manifest; verify provider route, browser-loopback behavior, remote snapshot/API assumptions and authored-soccer harness seam | Documentation/source review and synthetic protocol validation. No model call; any cloud preflight needs explicit finite resource authorization. Blocks only the capabilities it fails. |
| 1 — complete manager interaction | Repo startup → manual Check → persistent pairing → shared inventory → authorized cross-owner management → retained event/history visible after manager restart | Focused fake-Daytona/auth identity/lifecycle checks; local control-plane pairing smoke, with code/build tests in Daytona. No model usage. Keep external sandboxes read-only. |
| 2 — durable execution | Typed public fixture hydration → private worker → independent verification → cloud retention → confirmed deletion → reconnect/recovery; shared admission and cancellation tree | Synthetic uncertain-create, duplicate-command, stale-controller, offline and tree-cancel checks; one explicitly bounded model-free Daytona fixture. Adds provisioning/file-transfer cost only. |
| 3 — Codex connection | Qualified fresh browser consent → protected retention → bounded real Codex edit → independent check → delete → new sandbox reuse; both callers admitted without refresh race | Focused synthetic auth/writeback cases, then separately authorized finite real tasks. Repeat setup for Shishir's own connection; do not infer his entitlement from Vishal's. No general hosted-player enablement. |
| N0–N2 — browser voice takeover | Browser soccer/host/harness → private Daytona VoiceAgent → acknowledged fixed tools → local Stop/handback | Focused broker/audio/lease/cancellation checks and one bounded separate-worker qualification with a scripted provider. Real-provider speech accuracy is a separate gate. |
| 5 — authored-game improvement seam | Parent-granted source bundle → Shishir-compatible construction worker → immutable candidate envelope → independent verifier → host-controlled isolated-profile activation | Model-free stub worker exercises lineage, safe activation, incompatible saves, stale/cancelled candidates and failed upload; then a small real source change. Generic manager must not claim to deliver Shishir's entire algorithm. |
| 6 — nested soccer delivery | Outer issue I produces B; real requester playing browser B creates B′ then B″ through fresh sibling workers; evidence/check gate → automatic draft PR | One versioned bounded scenario plus focused negative controls. No broad campaign or automatic paid retries. Retain recordings/receipts and failed attempts; publication tested synthetically before an authorized real task. |

Packages 1–2 form the first user-tryable implementation slice. Show the complete visible interaction and recovery before expanding. Auth support research and remote-renderer preflight can progress as gated investigations; successful generic manager delivery does not certify those later capabilities. Do not add all seven packages to routine CI.

### Proposed concrete soccer fixture

Outer issue I: wire a source-bound authored-soccer improvement request into the existing voice-agent tool/acknowledgment path using the already defined host/harness envelope. B must identify the selected game/profile/baseline and submit exactly once. The host endpoint/worker adapter is prepared in package 5; the outer agent edits the app-side integration and required checks in an isolated repo workspace. This makes outer delivery a real Gameverse repository change rather than a hand-authored demonstration.

Suggested B′ voice request: **“After I win a clean tackle, protect me from one immediate counter-tackle until my next kick.”** Suggested B″ follow-up against B′: **“Make that earned protection end when I start sprinting.”** Current soccer already has sprint/stamina, tackle recovery and manually held shielding, so these are proposed new possession-linked transition rules, not merely increased speed/config values. Check for collisions with intervening source changes before freezing the fixture.

Independent fixed-input checks: eligible clean tackle grants the new protection; one eligible counter-tackle consumes it; later eligible contact can regain the ball; kicking/lost possession clears it; B″ sprinting clears it while the otherwise identical B′ scenario remains protected. Exercise the changed behavior in the actual rendered browser engine, not only a new state flag or the agent's narration. Preserve movement/ball validity, explicit Stop/neutral handback and isolation of the original profile. Pin a separate verifier/check manifest outside the editable candidate test tree; allow the coding agent to add useful tests without letting it redefine the acceptance gate.

Copied test state may use a declared fresh-profile policy when a changed save schema is incompatible. Do not silently migrate/reset an accepted player. Candidate registration and safe activation are host-owned and source-bound. Hydrate B′ from B, B″ from the accepted B′ source; game artifacts/patches remain outside B's repository PR payload. Load immutable candidate bundles in fresh/validated runtime instances at a verified boundary rather than hot-editing the active engine. Additional verification workers/runtime overlap consume admitted parent resources even though only one inner improvement runs at a time.

## Resource enforcement, recovery and publication

Use existing runner timestamps and a small durable per-parent ledger. Require an explicit complete run config before dispatch: parent deadline, per-role job deadlines, total/provider-specific model-attempt ceilings, active-parent/inner concurrency, sandbox resource maxima, setup/build/play bounds and retention/cleanup reserve. Absent/nonfinite/unsupported enforceable fields reject admission. Pin config hash and runtime/image identity. Initial numbers belong in the bounded run request after package-0/preflight evidence; they are finite safety ceilings, not latency guarantees. Existing short fixture/harness caps are reference data and must not be copied as an alleged complete-manager baseline.

Admission reserves resources atomically across both local managers. Count outer, game, inner, verifier and any trusted auth runtime under the same parent; do not equate “one inner” with “one sandbox total.” Reserve inner/model allowance before dispatch and reconcile actual consumption. Failed, cancelled and uncertain work remains charged/reserved until reconciled; missing usage is unavailable, never zero. A reconnect/new child does not reset the parent allowance. Different providers expose different units; keep a resource vector rather than invent a dollar conversion for subscription calls.

Persist intent and stable sandbox name before creation, reconcile by identity after uncertain I/O and never retry an uncertain create by minting another name. Use process-group/deadline supervision plus independently enforced sandbox lifecycle bounds. Ordinary auto-stop is not a hard total deadline; Daytona documents a separate wall-clock TTL, including its reset semantics. Verify supported API behavior and retention reserve before running; do not extend deadlines silently. [Daytona lifecycle](https://www.daytona.io/docs/en/sandboxes/).

Cancellation first fences new children/activation/publication, then terminates/reconciles descendants and safely retains available outputs. Unknown termination/deletion keeps reservations and an actionable cleanup state. Try retention before deletion without promising data survives a hard TTL or platform loss; periodically checkpoint bounded useful work remotely. No background inference/job retries after provider/infrastructure failure; polling an existing job and checking whether a prior command succeeded are recovery, not additional model attempts.

Publisher runs under the manager's separately configured scoped GitHub authorization, outside model-editable sandboxes. Retain a source-bound patch/tree and check evidence, validate the exact proposed head, push an idempotently named `codex/` branch and create/update one draft PR. Derive current checks from a pinned task/repo manifest; a failed/unknown/partial/cancelled gate cannot publish. Recheck cancellation/source at publication. Resolve an uncertain GitHub response before retrying. Attach created PRs to the chat using supported app tooling when publishing from Codex. Never merge/deploy automatically. Failed publication preserves work and exposes a recoverable state.

## Verification, timing and dependencies

No dependencies, CI jobs, image packages or qualification runs are added by this plan. Reuse Node >=22, existing `ws`, Node test runner, Cloudflare bindings, Daytona fetch adapter and #25 modules. Browser/encoder tooling belongs in an explicitly reviewed remote image; justify coverage, expected resource/setup cost and reuse before adding packages. Avoid repeated CLI installation per worker when a pinned, qualified image can supply it; measure cold image/setup separately before claiming improvement.

Routine checks target changed protocol/lifecycle/auth/source-boundary modules with fake providers, plus affected existing gameplay/voice tests. Model calls, remote renderer campaigns and the full B′/B″ scenario are separately triggered bounded qualification. Local macOS work is manager startup/auth/browser control-plane interaction; source builds, code verification and game simulation stay in Daytona. Use existing reports to avoid duplicate instrumentation.

Each run records source/config/game/adapter/harness/runtime/image/machine context, parent/child IDs, outcome and queue/setup/hydration/build/play/provider/verification/retention/cleanup times as available. Builds identify clean/incremental and cache state; CI, if changed, records queue/job/outcome and elapsed critical path separately from aggregate work. Parent/child and provider/play stages overlap; retain intervals rather than adding nested durations. Compare representative before/after checks or setup stages only on matched inputs/environment. Report no remote rendering/input/full-loop baseline until one actually runs. Keep unsuccessful/unknown/failed/cancelled qualification evidence unchanged.

## Readiness and next authorized work package

Product alignment is complete. This document chooses an implementation direction while surfacing genuine external/technical gates: provider support and refresh custody, browser-loopback compatibility, remote renderer/control quality, authored-soccer construction seam and finite run configuration. Resolve them through bounded inspection/preflights and report blockers; do not reopen settled behavior or silently substitute a laptop executor/API billing path.

**Packages 0–2 are complete; N0–N2 are the next authorized implementation slice**; its finite model-free cloud fixture has completed. Review the linked implementation and qualification evidence before expanding. Deliver a repo-started, paired, inspectable, recoverable manager interaction before authorizing personal model tasks and remote gameplay qualification. The exact soccer fixture above is proposed test content to freeze in the task manifest, not a new general game requirement or a promise to ship it to accepted player versions. Further provider consent, paid runs, shared-host deployment and source/artifact publication occur only within their actual authorized scope.
