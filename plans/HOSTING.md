# Gameverse hosting plan

Date: 2026-10-18 · Status: Cloudflare + Daytona, the shared agent-connection flow and two hosted-product delivery slices agreed with Vishal. The staging foundation is deployed; Slice 1 implementation is authorized and starting. Agent connection, job execution and game improvement remain unqualified.

Discussion: [issue #16](https://github.com/vishaltandale00/gameverse.ai/issues/16), requesting Shishir's review of the hosting boundary, runtime/state requirements and cost assumptions.

Host the playable product on shared infrastructure. Save each user's versioned source, game artifacts, progress and improvement history in durable storage. Start an isolated sandbox only when an improvement request needs execution, then delete it after retaining the results. Users connect their own Codex or Claude account through browser sign-in, with API keys as an advanced option; Gameverse runs the selected agent and improvement harness. No permanent development container or sandbox disk is required per user.

Use **Cloudflare for the hosted product and durable data, and Daytona Cloud for disposable coding and verification jobs**. Cloudflare Workers call Daytona's hosted sandbox API. One SQLite-backed Durable Object per project owns accepted-version references and the external job lifecycle; R2 retains the files. Gameplay runs in the browser and remains available when coding jobs are idle or unavailable. This supersedes the earlier AWS hosting selection. AWS, Railway, Cloudflare sandbox containers and Daytona BYOC remain alternatives, not required services.

This extends the local-first environment with a hosted option. Follow the [parallel development contract](../contracts/PARALLEL_DEVELOPMENT.md), [base game contract](../contracts/BASE_GAME.md) and [improvement loop contract](../contracts/IMPROVEMENT_LOOP.md). Vishal owns the environment, hosting and activation; Shishir owns the independently versioned improvement harness, its algorithms and resource policies. Exact schemas and transport still need joint agreement.

## Shared Connect your agent flow

These are the agreed V1 product behaviors for players, Vishal and Shishir. They are design requirements, not claims that provider login, credential refresh or multi-user job admission is implemented.

| Decision | Agreed behavior |
| --- | --- |
| Identity | Sign into Gameverse first, then connect an agent separately. Projects and saves belong to the Gameverse account and survive switching or reconnecting agents. |
| When connection is required | Play without an agent connection. Require one when creating or improving a game; settings also provides a direct connection path for testing. |
| Providers and default | Codex and Claude can both remain connected. Choose one default agent so routine requests do not require repeated provider selection. |
| Authentication method | Browser sign-in is the primary path. Offer “Use an API key” as an advanced option for API billing and compatible custom-harness use. |
| Pending request after login | Retain the exact request, selected game and baseline while connecting. Successful login continues that request without resubmission. Connecting from settings alone starts no job. |
| Expired login | Pause the request and show “Reconnect.” Retain available durable work; resume only where supported, otherwise retry from retained inputs. Do not automatically use the other provider. |
| Disconnect | Block new jobs using the connection and request cancellation of active jobs that use it. Retain already-saved work and show cancellation/cleanup status until confirmed. |
| Developer access | Provide testing mode in the same browser app, initially for invited developers such as Vishal and Shishir. It uses their own personal connections and permits submitting jobs and inspecting results without playing first. |
| Harness revisions | Developer tests may select an unreleased harness branch or commit. Resolve a branch to the exact commit and retain it with the run. Player requests use the published default harness. |

### Three uses of the same infrastructure

| Person | Entry point and execution |
| --- | --- |
| Player | Play → request creation/improvement → connect if needed → published harness → inspect candidate/result → host-controlled application in slice 2. |
| Vishal | Connect from settings or a pending request → invited developer testing mode → submit a bounded job directly → inspect source/results/evidence. |
| Shishir | Sign into his own Gameverse account → connect his own Codex/Claude account or API key → developer testing mode → test a pinned harness revision → inspect retained results. No shared operator token or other person's provider credential is required by this design. |

Keep one shared connection UI with Connect, Connected, Reconnect, Set default and Disconnect actions. A provider browser/device-code flow may require completing a code step; preserve the pending request through successful, failed or cancelled login. Failed/cancelled login does not start a job. After reconnect, recheck request cancellation, authorization and the pinned baseline before dispatch; a changed default or navigation cannot silently retarget an already submitted request.

### Connection ownership and persistence

Connections belong to the authenticated Gameverse account. Keep provider/auth-method/default/status metadata and authorized credential references on the host. Retain the credential or refreshable agent-auth state encrypted outside disposable sandbox source, images, artifacts and logs. The browser initiates connection and displays its status; persistent secrets stay server-side. A sandbox gets only the requesting account's selected connection for that run. The staging-wide admin token is bootstrap infrastructure access, not the future player/developer identity mechanism.

Both connections can stay saved while jobs bind to a selected connection reference and pinned harness revision. Preserve updated authentication state when a provider refreshes it, with appropriate concurrency control. Disconnect/revocation must prevent new admission and cover retained credentials as well as sandbox cleanup. Reconnection cannot guarantee restoration of an arbitrary in-memory agent session after deletion; checkpoint/resume or a fresh attempt must follow the harness's supported durable-state contract.

The shared UI fronts provider-specific authentication adapters. Browser sign-in authorizes the corresponding supported CLI/SDK runtime; its auth state is not assumed to be an interchangeable API key for every custom model client. Qualify the chosen client and connection method together. Public docs describe Codex headless device login and Claude Code's browser/code flow; Anthropic also documents subscription use with its Agent SDK/third-party apps. These establish candidate integration paths, not proof of the Gameverse connection implementation. [Codex authentication](https://learn.chatgpt.com/docs/auth#login-on-headless-devices), [Claude Code authentication](https://code.claude.com/docs/en/authentication), [Claude Agent SDK subscription usage](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

The first technical qualification inside slice 1 is: complete each provider login → retain connection securely → authenticate a bounded task in a sandbox → delete it → authenticate in a fresh sandbox using retained state, including refresh/reconnect behavior. UI completion alone and the model-free Python fixture do not establish usable agent authentication.

## Initial stack

| Component | Initial choice | Responsibility |
| --- | --- | --- |
| Playable frontend | Existing browser app through Workers Static Assets | World, controls, runtime and accepted version loading; keep the existing frontend. User-specific playable artifacts remain in R2. |
| Backend and ingress | Cloudflare Worker over HTTPS | Login/session integration, authorization, agent-connection settings, request receipts, artifact access and routing to the owning project object. Adapt the local Node HTTP/filesystem server to Workers APIs and bindings. |
| Project state | One SQLite-backed Durable Object per project | Accepted source/build/config references, save heads, durable requests and attempts, cancellation, candidate receipts and host-controlled activation. No permanent Linux workspace per user. |
| Shared account records | D1 where needed | Users, memberships and project listings. Treat listing/index updates as recoverable projections; accepted versions and run transitions are authoritative in the project object. Login provider and exact account schema remain implementation choices. |
| Run dispatch and recovery | Durable Object storage, short handlers and alarms | Persist launch intent, start/reconcile external jobs, handle authenticated callbacks and enforce resource admission. No always-running dispatcher or separate queue service initially. |
| Durable files | Private Cloudflare R2 Standard bucket | Pinned source, configs, playable builds, saves, logs and verification evidence, referenced by immutable object keys and digests. |
| Coding and verification jobs | On-demand Daytona Cloud Linux sandbox | Run Shishir's harness/agent, edit copied source, compile, launch the supported runtime, verify and return work. One active improvement per user is the proposed initial limit. |
| Reusable toolchain | Shared, versioned Daytona image | Pinned compiler, ARM tools, runtime dependencies and test tools. Hydrate each job's source after allocation. |
| Agent connections | Personal Codex/Claude browser sign-in; optional API keys | Shared connection UI, server-side encrypted retention and per-run authorization. Provider account/subscription/API usage is separate from hosting and sandbox usage. |

Use authorized R2 downloads for source and saves. Give each Daytona job narrowly scoped, expiring input downloads and output upload locations through signed S3-compatible URLs or authenticated Worker endpoints. A sandbox cannot use a Worker's R2 binding directly. Serve immutable accepted artifacts through an authorized delivery path; qualify CORS, CSP, byte limits and runtime loading before claiming browser compatibility. R2 internet egress is free, while storage and operations are metered. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

Daytona packages workspace provisioning, command execution, files and logs for coding and verification. Measure full request-to-ready time, including hydration and dependency setup. The Worker must use an API client compatible with its runtime; qualify Daytona SDK compatibility or call the HTTPS API. Compilers, native processes and Shishir's existing Node/Python harness execute in Daytona.

### Durable Object coordination boundary

A project object holds transactional metadata, not game binaries or a continuously running agent. SQLite persists across object eviction; in-memory state does not. New projects create independent objects, and inactive objects can sleep. SQLite-backed objects on the paid plan have a 10 GB per-object limit; large source/build/save/evidence files belong in R2. [Object model](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/), [limits](https://developers.cloudflare.com/durable-objects/platform/limits/)

Persist a request and launch intent before an external call. Persist the attempt identity, provider ID, deadline and next reconciliation event so recovery does not depend on a live HTTP connection. Use authenticated callbacks and bounded alarm-driven reconciliation; let handlers return while Daytona performs long work. Avoid timers, open provider streams or frequent polling that keep an object active for the entire job. Use WebSocket hibernation if live status is exposed. [Duration billing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

Alarms are at-least-once and their built-in retries are finite. Each object has one alarm, so persist pending deadlines and schedule the next due event. Deduplicate launch, cancellation, submission and cleanup; persist the next retry before exhausting a handler's retry budget and expose terminal recovery failures. Cross-object calls, D1 indexes and R2 writes are not one atomic transaction: upload immutable outputs first, then commit their validated references in the owning object, and reconcile orphaned uploads/index updates. [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

Enforce per-user limits across that user's projects and a global admission limit through durable hosting-owned admission accounting; independent project objects alone cannot enforce these limits. Its exact placement and crash/release protocol must be agreed before admitting concurrent jobs. This coordination manages the external lifecycle without prescribing Shishir's search, repair or evaluation algorithm.

## Durable project state

Each user has a persistent project, reconstructed into a disposable sandbox when needed:

- Pin the accepted game's config, source revision, build definition, dependencies and playable artifact. A source snapshot or an exact baseline plus retained patches must be sufficient to reconstruct it without an old sandbox.
- Retain requested changes, conversation/proposal revisions, attempts, returned candidates and verification evidence separately from accepted versions. A partial experiment cannot overwrite accepted source.
- Keep player saves and matching-version execution snapshots outside the sandbox. Simulation receives copied or fresh state, never write access to accepted player progress.
- Store credentials separately from source, builds, logs and sandbox images. Keep authorized references to the configured credentials rather than embedding keys in run manifests.

Build caches are optional and disposable. Start with the shared toolchain image; add source/build caches only if representative measurements justify their storage and invalidation costs. Accepted artifacts and required parent versions remain retained for resume, lineage and recovery. Source/evidence retention needs an explicit policy; the cost estimate assumes 5 GB per customer, not unlimited history.

## Sandbox handoff

The following records describe required meanings, not final field names or wire formats. Reuse the version/config/submission meanings from the parallel contract.

| Handoff | Contents |
| --- | --- |
| Request to run | User/project authorization; request and revision IDs; base/subgame target and expected accepted version; immutable source/config references and digests; context and isolated checkpoint reference when available. |
| Execution configuration | Environment-harness and adapter versions; loop version/config; toolchain image identity; required capabilities; authorized connection/auth-method references; configured run/resource limits. |
| Returned candidate | Stable submission and originating attempt IDs; new/update/fork classification; pinned parents; immutable source/config/build/artifact references; verification evidence; save compatibility or explicit fresh progress. |
| Observable result | Durable status and reason, evidence locations, timing/usage report and submission receipt. Candidate registration and activation remain separate outcomes. |

1. **Receive the request.** Authenticate the Gameverse user, capture the exact game target and baseline, and durably retain the request/revision. If an agent connection is needed, retain the pending request through connection/reconnection, then admit it once authorized and ready. Capture the selected connection and published or developer-selected exact harness revision; acknowledge queuing only after its durable receipt. Retries reuse the request identity. Navigation does not retarget submitted work.
2. **Claim and provision.** Claim a job with a recoverable lease, record an attempt ID, and provision a sandbox within hosting capacity. Persist its provider ID so an object restart can reconcile the existing attempt instead of blindly launching another. Provisioning must carry a correlation identity that allows reconciliation after an uncertain create response.
3. **Hydrate the source.** Start from the prepared Daytona image, fetch pinned source/configs from R2, verify digests and start with copied or fresh simulation state. Give the run access only to its own input objects, output upload locations and authorized model credentials.
4. **Execute the coding and verification job.** Shishir's harness interprets, edits code, builds, launches the supported game/runtime, simulates and evaluates within its configured limits. Persist status, logs and useful intermediate source/proposal state externally. Failed and cancelled attempts remain inspectable. Player gameplay continues independently.
5. **Return a candidate.** Upload changed source, playable artifact, verification evidence and usage/timing reports to immutable R2 locations and submit their references through the Worker to the owning project object. Only report a durable candidate after its objects and submission receipt are retained. Submission retries cannot create duplicate playable versions.
6. **Validate and activate.** The host checks ownership, evidence, cancellation, request revision, expected baseline and adapter/save compatibility. Updates apply through the existing safe-boundary and recovery contract; forks retain separate identity and progress. A stale or incompatible result cannot silently replace the current version.
7. **Clean up.** Delete the sandbox after retaining its durable results. A cleanup/reconciliation path also handles crashes, provider interruption, cancellation and failed uploads. Unconfirmed work is retried from the last durable state; do not claim an arbitrary in-memory agent session can resume after deletion.

An expired lease or lost connection does not prove the sandbox stopped. Reconcile or terminate the old attempt before starting a replacement, and reject late results from superseded attempts. If cancellation arrives during upload or validation, recheck it before registration/activation. A cleanup failure remains visible and subject to a bounded termination retry so abandoned compute does not run indefinitely.

## Credentials and user isolation

The Worker and owning project object authorize the selected connection against the requesting Gameverse account. Provider identity and Gameverse identity remain separate. Inviting Shishir to developer mode grants the relevant testing capabilities; his model/agent access comes from his own saved connections. Developer access does not expose another user's credentials or grant general cloud-account control.

For API-key clients using compatible HTTPS-header authentication, Daytona's protected secrets with provider-host allowlists remain an initial preference: the sandbox receives an opaque token and Daytona substitutes the credential in outbound headers. Qualify the selected client; body/query authentication and CLI OAuth/refresh-state handling require their own adapter. The encrypted connection store and exact refresh/injection mechanism remain implementation choices to qualify in slice 1. [Daytona secrets documentation](https://www.daytona.io/docs/en/secrets/)

Keep Cloudflare account credentials, R2 signing credentials and the Daytona management API key outside agent sandboxes. Store deployment secrets as Worker secret bindings. Runtime user connections are separate from these platform secrets. Persist/redact operational logs without recording tokens, auth files or API keys; keep credentials out of source/config bundles and verification evidence.

Store only authorized credential references and non-secret connection settings in ordinary account/project metadata. Rotation, disconnect/revocation and account deletion cover external credential storage. Scope artifact access and callbacks by the admitted run; a user ID supplied by agent code is not authorization. Sandbox code receives no general bucket, project database or platform-management access.

## Cost model per customer

Prices checked on 2026-10-17, in USD, using Cloudflare paid-plan public allowances and Daytona Cloud public rates. These are calculated infrastructure component subtotals, not measured bills, capacity guarantees or subscription prices. Connected provider account/subscription/API usage is separate from these hosting costs. Browser sign-in does not establish an unlimited model allowance or an extra API charge for every job; actual provider billing/limits follow the selected account, runtime and authentication method.

### Reference workload and Cloudflare hosting baseline

Model 100 customers retaining 5 GB each, or 500 GB total R2 Standard storage, and event-driven project coordination. The $5 Workers Paid subscription and included allowances are shared across the account, not granted separately to every customer or object. Assume this project has the allowances available; other applications in the account consume them too. There is no reserved app server, load balancer, IPv4 allocation or RDS instance in this stack.

| Shared component | Monthly calculation or baseline assumption | Cost |
| --- | --- | ---: |
| Workers Paid | Account subscription; includes metered product allowances | $5.00 |
| R2 retained project files | (500 GB-month − 10 included) × $0.015/GB-month | $7.35 |
| Workers API execution | Within 10 million requests and 30 million CPU-ms/month | $0 incremental |
| Durable Object execution | Within 1 million requests and 400,000 GB-s/month | $0 incremental |
| Object SQLite metadata | Within 5 GB-month, 25 billion rows read and 50 million rows written/month | $0 incremental |
| D1 account/listing metadata, if used | Within its separate 5 GB, 25 billion rows read and 50 million rows written/month | $0 incremental |
| R2 operations | Within 1 million Class A and 10 million Class B requests/month | $0 incremental |
| **Hosting and retained files baseline** | Assumes the usage above stays within included allowances | **$12.35/month** |

Static Asset requests are free under the documented static-asset routing; invoking Worker code can introduce metered requests/CPU. This model serves gameplay in the browser rather than streaming per-frame state through a project object. No hosted traffic, metadata-size, object-active-time or job-latency baseline exists yet.

Overages must be added: Workers $0.30/million requests and $0.02/million CPU-ms; Durable Objects $0.15/million requests and $12.50/million GB-s above included allocations; object SQLite $0.20/GB-month, $0.001/million rows read and $1/million rows written. D1 storage over its allowance is $0.75/GB-month; read/write rates match the listed SQL operation rates. R2 Standard operations are $4.50/million Class A and $0.36/million Class B above their allowances. Apply provider billing-unit rounding, not just continuous arithmetic. Object duration is wall-clock active/non-hibernatable time, not just JavaScript CPU time.

For scale of the duration risk, holding one project object awake for all 3,000 monthly Daytona job-hours would consume approximately 1.38 million GB-s using Cloudflare's 0.128 GB billing convention. After 400,000 included GB-s and rounding up the billable remainder to a million, this adds $12.50/month for object duration alone. This is a sensitivity example, not measured behavior; callbacks and sparse reconciliation avoid tying object lifetime to the full job.

Sources: [Workers and D1 pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [R2 pricing and rounding](https://developers.cloudflare.com/r2/pricing/). R2 has no internet egress charge; this does not make storage, requests or every other provider's network usage free.

### Daytona coding and verification jobs

| Job resource | Allocation and rate | Cost per billable hour |
| --- | --- | ---: |
| CPU | 2 vCPUs × $0.0504/vCPU-hour | $0.1008 |
| Memory | 4 GiB × $0.0162/GiB-hour | $0.0648 |
| Temporary disk | 20 GiB × $0.000108/GiB-hour; conservatively ignore free allowances | $0.00216 |
| **Complete sandbox** | Allocated only for the job lifecycle | **$0.16776/hour** |

Daytona charges reserved resources during running and billable lifecycle states, including waits for model responses. Count provisioning, source/image transfer, coding, builds, verification, repairs, uploads, failed/cancelled attempts and cleanup. Sum resource-hours across extra parallel simulation sandboxes. A hypothetical 20-minute job costs $0.05592, approximately 5.6 cents; that duration is not a measured loop latency. [Daytona pricing](https://www.daytona.io/pricing), [Daytona billing](https://www.daytona.io/docs/en/billing/)

Delete the sandbox after retaining its outputs in R2. Stopping alone retains disk billing; this plan retains no per-user Daytona disk or snapshot. Shared image storage, future warm pools and retained caches need separate accounting if introduced.

### Combined per customer estimate

For `N` customers, each retaining 5 GB-month, `H` billable Daytona hours per customer/month, and `U` dollars of additional Cloudflare usage for the account:

```text
Monthly cost/customer = ($5 + max(5 × N − 10, 0) × $0.015 + U) / N
                        + $0.16776 × H

At 100 customers, with U = $0:
Monthly cost/customer = $0.1235 + $0.16776 × H
```

Apply R2 billing-unit rounding to fractional stored GB-months; the examples use whole units. U includes API/CPU, object duration/requests, SQL and R2 operation overages. The baseline assumes current allowance availability, not unlimited capacity or free coordination at every scale.

| Daytona job time per customer/month | Job resources | Allocated Cloudflare baseline | Baseline total/customer |
| --- | ---: | ---: | ---: |
| None; playing only | $0.00 | $0.12 | **$0.12** |
| 10 hours | $1.68 | $0.12 | **$1.80** |
| 30 hours | $5.03 | $0.12 | **$5.16** |
| 100 hours | $16.78 | $0.12 | **$16.90** |

Totals use unrounded inputs. At 100 customers × 30 hours, the baseline is $12.35 Cloudflare plus $503.28 Daytona = **$515.63/month**. The prior AWS + Daytona component model was $579.13, so this reduces the baseline by $63.50/month, approximately $0.64/customer. The operational simplification also removes app-server, ALB and PostgreSQL configuration from the selected deployment.

At 10 customers, 50 GB total retained storage gives a $5.60 Cloudflare baseline and **$5.59/customer** at 30 job-hours. At 1,000 customers, 5,000 GB storage gives a $79.85 Cloudflare baseline and **$5.11/customer** at 30 job-hours, before usage overages and excluded costs. Neither example establishes supported traffic or concurrency.

Excluded from these totals: U overages, provider agent/model subscription or API usage, transcription, Daytona network/shared-image/cache charges where applicable, additional observability and backup/export storage, secure connection-storage/refresh services with separate charges if introduced, Gameverse auth-provider charges, domains, taxes, payment fees and operational/support labor. R2 egress is explicitly free; do not add an AWS-style R2 internet bandwidth fee. No promotional credits, startup grants or negotiated discounts are assumed. These are not all-in cost caps.

## Managed service responsibilities

Cloudflare operates the Worker runtime, object placement/storage and R2/D1 infrastructure. We own bindings, schema/storage migrations, indexes, access control, rollout/recovery, retention/export/restore validation, monitoring and application correctness. Each project is an object rather than an always-on server or PostgreSQL instance. Cloudflare-specific APIs and partitioned state create portability work if the hosting provider changes. No measured maintenance-hours estimate exists.

Daytona operates its hosted sandbox infrastructure and workspace/process/file APIs. We still own durable requests/results, scoped access, cancellation/cleanup, verification criteria and safe activation. Qualify cross-provider calls, callback authentication and output transfer against representative native workloads. [Daytona process execution](https://www.daytona.io/docs/en/process-code-execution/)

The [provider comparison](../research/HOSTING_PROVIDER_COMPARISON.md) retains AWS/Railway alternatives, and the [AWS reference](../research/HOSTING_AWS_COMPARISON.md) is historical comparison evidence. Cloudflare sandbox containers are a possible future executor but are not part of this selected stack. Revisit execution providers only with an equivalent complete-job comparison.

## Infrastructure prerequisites and Cloudflare setup

1. **Cloudflare account and billing:** identify the account and staging/production environments. Enable Workers Paid for the modeled deployment and enable R2 with its required billing setup. SQLite-backed Durable Objects can be developed on Free; that is a different limit/cost model. Cloudflare account login is independent of AWS CLI login.
2. **Wrangler authentication:** Node 22 and npm are already available in this checkout's environment. Use the Wrangler CLI through npx to authenticate and identify the account; these commands do not deploy the application:

   ```sh
   npx wrangler@latest login
   npx wrangler@latest whoami
   ```

   Wrangler opens a browser for OAuth approval. During implementation, install it as a local dev dependency with `npm install --save-dev wrangler@latest` and retain the lockfile so project commands use a pinned version. Do not initialize an unrelated scaffold over this repository. CI should use a scoped Cloudflare API token/account ID through its secret store, with permissions for the chosen Workers/Objects, R2 and optional D1 resources.
3. **Hosting configuration:** add a reviewed Wrangler configuration, Worker entrypoint, SQLite object binding/migration and private R2 binding; add D1 binding/migrations if the shared-account flow requires it. These definitions and the runtime adapter remain implementation work. Use a workers.dev staging endpoint before a custom hostname if appropriate; domain/DNS control is needed for the branded endpoint, not local development.
4. **Daytona access and secrets:** confirm the billing-enabled organization, region, resource/concurrency quotas and protected-secret compatibility. Keep the management API key in the ignored root `.env` for local development. Wrangler can load `.env` beside its configuration, provided no `.dev.vars` overrides it. Before an authorized remote deployment, put `DAYTONA_API_KEY` into the target Worker's secret bindings. `wrangler secret put` deploys a Worker version immediately, so it belongs to the deployment step rather than login setup. Keep personal agent connections, including refreshable CLI/SDK auth state and optional model API keys, separate from this management key; their V1 flow is defined above.
5. **Pilot limits and harness:** agree monthly spending, per-user/global admission and finite job deadlines/resources. Reuse the existing [improvement API](../contracts/IMPROVEMENT_API.md) and [native handoff](../contracts/IMPROVEMENT_HANDOFF.md), agree the Daytona entrypoint/retained state with Shishir, and qualify Linux portability. The public reference fixture can qualify dispatch/results without a model credential or native provider inputs. Native runs need their external authorized game/source/save inputs; model-backed qualification needs a test credential through the secret mechanism.

Sources: [Wrangler installation](https://developers.cloudflare.com/workers/wrangler/install-and-update/), [login and whoami](https://developers.cloudflare.com/workers/wrangler/commands/general/), [local secrets](https://developers.cloudflare.com/workers/local-development/environment-variables/), [deployed secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

Current setup progress (2026-10-17): Wrangler 4.151.1 is pinned, a protected staging Worker and SQLite project class are deployed, five local checks and the deployment dry run passed. The private `gameverse-artifacts-staging` R2 bucket has r2.dev access disabled. Following the Workers Paid upgrade, version `a58ac505-1140-48a0-b1a2-87664cc1843a` passed four live checks across 15 requests in 1,506.76 ms, covering auth, durable/idempotent project creation and private digest-checked R2 access. Both deployed credentials are `secret_text` bindings. No Daytona job or model call has run. See the [staging setup and bootstrap API](../infra/cloudflare/README.md) and [sanitized evidence](../verification/cloudflare-staging-20261017.json). User login, accepted-game hosting and full improvement integration remain later work; runtime-restart persistence was tested locally, not by forced remote eviction.

## Scaling and resource controls

Scale sandbox capacity with active improvements, while storage grows with retained projects and history. For example, 1,000 customers each using 30 sandbox hours/month produce 30,000 sandbox-hours, or about 42 simultaneously running sandboxes averaged across a 720-hour month. Peak demand can be much higher. This workload models $5,032.80 in Daytona job resources plus $79.85 in baseline Cloudflare hosting/R2 storage, before usage overages and excluded costs. Object and account quotas, hot-project throughput and actual active duration still need qualification; distributed objects do not imply unlimited throughput inside one project.

Start with one active improvement per user, a global concurrency cap and durable queuing. Retain configurable run deadlines, CPU/RAM/disk ceilings and cost/repair limits; Shishir's loop config continues to own its algorithm and resource policy. Cancellation must terminate external compute as well as update application status. Confirm provider concurrency, API and storage quotas against peak demand before increasing admission limits.

The sandbox image is reusable across users and contains no user credentials or project state. A different sandbox provider should require changes to provisioning, execution, upload and cleanup adapters, rather than changes to game discovery or the candidate contract. Evaluate provider cost using the same pinned build and complete improvement workload, including startup and restore overhead.

## Two hosted-product delivery slices

These two slices are the agreed delivery framing for this hosting and agent-connected product. They replace the earlier five-step hosting delivery list. The existing [environment slice plan](ENVIRONMENT_SLICES.md) records game/navigation acceptance work; this document does not renumber its issues or treat its gameplay/controller/save gates as complete. Integrate the applicable evidence into the hosted journeys below.

| Slice | End-to-end outcome | Ownership |
| --- | --- | --- |
| 1 — Connect an agent and execute a job | Gameverse sign-in → play or developer mode → request work → connect if needed → disposable Daytona task → retained result/status → cleanup | Vishal owns shared product, identity/connections, hosting and job lifecycle; Shishir supplies/reviews the harness entrypoint and pinned test revision. |
| 2 — Improve the game and play the result | Play → request change → construction/build/verification → candidate submission → host validation/safe application → play changed version → improve again | Shishir owns construction/improvement algorithms, simulation/evaluation and loop resource policies; Vishal owns adapters, player progress, registration/activation and recovery. |

### Slice 1 — Connect an agent and execute a job

**Outcome:** one shared, usable platform path for players, Vishal and Shishir. Use a small, clearly labeled reference task to qualify execution before claiming game improvement.

**Scope:**

- Gameverse accounts, private projects and the existing browser play entry point; agent connection is required only for game creation/improvement. Preserve the account/project/save ownership boundary.
- The complete agreed Codex/Claude connection flow: browser sign-in, advanced API-key option, both connections saved, one default, pending-request continuation, reconnect and disconnect/cancellation.
- Invite-only developer mode in the same app: direct job submission, retained results/evidence and selection of an exact unreleased harness commit. Standard player requests use the published harness.
- Durable request/attempt/status records, scoped source hydration and artifact access, configured admission/resource/deadline limits, cancellation, result retention in R2 and confirmed sandbox cleanup.
- Start with the public authored reference fixture for lifecycle integration. Add a bounded task executed by the actual connected agent to prove its credentials work. A model-free Python run cannot certify agent authentication.

**Acceptance gate:**

- [ ] A normal account can play without connecting an agent; a request requiring one enters the shared connection flow and continues once after successful authentication, retaining its exact intent, target and baseline. Settings-only connection launches no job.
- [ ] Codex and Claude browser connections, defaults and advanced API-key paths are qualified against their supported runtime/client. Expiry prompts reconnect, and disconnect blocks new work and requests cancellation without silently switching provider.
- [ ] Vishal and Shishir independently sign into their own accounts, connect their own agents and submit/inspect bounded reference work through developer mode. An uninvited account cannot use developer-only operations or select an unreleased harness.
- [ ] The selected pinned harness and source run in a disposable Daytona sandbox with admitted connection access. Results/status and useful evidence survive page reload or host restart, retries do not duplicate execution, and failed/cancelled attempts remain inspectable.
- [ ] Delete the sandbox, then run another bounded task in a fresh sandbox from retained source and connection state. Confirm cleanup and credential refresh/reconnect behavior; do not require login every time while credentials remain usable.
- [ ] Demonstrate isolation of accounts/projects/credentials, bounded cancellation/cleanup after interruptions, and usable UI recovery for failed login, launch, execution, upload or retention.
- [ ] Retain source/config/harness identities, environment/toolchain context, actual queue/total/stage times and available resource/billing evidence for successful, failed and cancelled runs. Identify unavailable measurements and overlapping stages explicitly.

**Boundary:** slice 1 proves the shared platform and agent execution. A reference result is not a changed game, verified gameplay improvement or accepted game version. Invited users try the full browser and developer journeys before claiming this slice complete.

### Slice 2 — Improve the game and play the result

**Outcome:** a real requested gameplay change passes through Shishir's harness and the host into a playable new version, then supports another improvement from its accepted source.

**Scope:**

- Supply exact game context, source/config/artifact and adapter versions, environment/harness versions, the player's request/proposal and copied or fresh simulation state.
- Run Shishir's actual construction/improvement process: source changes, compilation/build, supported play/simulation checks and the applicable verification plan/evidence. Keep algorithms and resource policies in his versioned loop configuration.
- Return immutable candidate source/build/config/artifacts and evidence through the shared submission contract. Candidate registration, availability and player activation remain distinct outcomes.
- The host validates ownership, expected baseline, request revision/cancellation, capabilities and evidence. Apply updates at a supported safe boundary with verified save compatibility or an explicit migration/fresh-progress/fork path; retain recoverable prior versions and progress.
- Developer mode exercises unreleased pinned harness revisions using the same infrastructure and personal connections before selecting a published version for player requests.

**Acceptance gate:**

- [ ] Play the target game, submit a real requested mechanics/source change and receive a distinct built candidate with evidence of the requested behavior from actual supported game execution. A settings-only change, unchanged artifact or successful process exit is insufficient.
- [ ] Demonstrate isolated simulations without modifying accepted player progress. Retain the applicable behavior/quality checks and their supported scope; reference-fixture replay does not certify native gameplay or save migration.
- [ ] Submit/register once, validate the result, apply an eligible update through the player host, then play and observe the changed behavior. Preserve saves under the declared compatibility contract and recover honestly from failed application.
- [ ] Reject or recover from stale baselines, unsupported adapters, failed verification, duplicate/cancelled/late submissions, sandbox loss and failed uploads/cleanup. Preserve the last accepted game and confirmed progress.
- [ ] Delete the sandbox and complete a second improvement cycle using the newly accepted source and retained version lineage. Demonstrate separate fork identity/progress when that path is used.
- [ ] Vishal and Shishir can reproduce and inspect developer runs with exact harness/source pins, while normal player requests select the published default. Retain timings, attempt/repair counts, outcomes and resource evidence for both cycles.

**Gate and ownership:** agree the v0 request/config/candidate/status meanings with Shishir using the [parallel development contract](../contracts/PARALLEL_DEVELOPMENT.md). Reuse the existing [improvement API](../contracts/IMPROVEMENT_API.md) and [native handoff](../contracts/IMPROVEMENT_HANDOFF.md); do not recreate or prescribe his internal loop. Host activation and progress integrity remain Vishal's responsibility. The [local development setup](../DEVELOPMENT.md), existing distribution exclusions, Linux toolchain portability and game-specific acceptance gates remain applicable.

### Qualification order, limits and current evidence

Inside slice 1, first qualify the provider login → encrypted retention/refresh → fresh-sandbox authentication path, then the complete browser/developer reference-task journey. Slice 2's harness work may proceed in parallel, but integrated acceptance follows the slice 1 platform gate. Exact Gameverse login provider, encrypted credential-store implementation, provider client/refresh compatibility, private source access and numeric job/customer limits remain implementation decisions; proposed resource limits are not measured capacity guarantees.

Current staging evidence covers the admin-token Worker, SQLite metadata, private R2 and focused local/live checks only, as recorded above. It does not establish Gameverse user login, personal agent connection, Daytona job dispatch or either slice's acceptance. Implementation remains paused; this update records agreed design and delivery scope.

Use narrow checks and bounded authenticated-agent tasks for slice 1; add the actual change/build/play/activation checks for slice 2. No new CI job, dependency, game matrix or billable run is added by this documentation update. Estimate coverage/resource cost before adding qualification stages, establish comparable baselines, and retain failed/cancelled outcomes. Broad campaigns and expensive model evaluations remain separately triggered with explicit limits, following [AGENTS.md](../AGENTS.md). Existing HTTP smoke timings are not improvement-loop latency or a before/after baseline. Commercial allowances require representative full-job measurements.
