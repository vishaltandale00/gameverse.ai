# Gameverse hosting plan

Date: 2026-10-16 · Status: AWS managed hosting plus Daytona Cloud coding and verification jobs selected by Vishal; reference sizing and joint harness integration remain to be qualified.

Discussion: [issue #16](https://github.com/vishaltandale00/gameverse.ai/issues/16), requesting Shishir's review of the hosting boundary, runtime/state requirements and cost assumptions.

Host the playable product on shared infrastructure. Save each user's versioned source, game artifacts, progress and improvement history in durable storage. Start an isolated sandbox only when an improvement request needs execution, then delete it after retaining the results. Users bring model API credentials; Gameverse runs the agent and improvement harness. No permanent development container or sandbox disk is required per user.

Use **AWS for the hosted product and durable data, and Daytona Cloud for disposable coding and verification jobs**. The AWS backend calls Daytona's hosted sandbox API; this plan does not assume Daytona BYOC or vendor software deployed inside our AWS account. Gameplay runs in the browser and remains available when coding jobs are idle or unavailable. Railway and direct Fargate improvement jobs are outside the selected initial stack.

This extends the local-first environment with a hosted option. Follow the [parallel development contract](../contracts/PARALLEL_DEVELOPMENT.md), [base game contract](../contracts/BASE_GAME.md) and [improvement loop contract](../contracts/IMPROVEMENT_LOOP.md). Vishal owns the environment, hosting and activation; Shishir owns the independently versioned improvement harness, its algorithms and resource policies. Exact schemas and transport still need joint agreement.

## Initial stack

| Component | Initial choice | Responsibility |
| --- | --- | --- |
| Playable frontend | Existing browser app, served by the AWS web service | Gameverse world, controls, game runtime and accepted version loading. Keep the existing frontend rather than introducing a new framework for hosting. |
| Backend | Node 22+ container on Amazon ECS Fargate | Login and authorization, credential settings, request receipts, run status, artifact access, candidate registration and host-controlled activation. |
| Database | Amazon RDS for PostgreSQL | Users, profiles, game/config/version references, save heads, durable requests, run attempts and submission receipts. |
| Ingress and application image | HTTPS Application Load Balancer and Amazon ECR | TLS/routing to the web service and versioned application container images; keep image delivery separate from game artifacts. |
| Run dispatch | PostgreSQL jobs table and a small backend dispatcher | Claim requests durably, start sandboxes, reconcile existing runs after restart and enforce hosting concurrency limits. Start without a separate queue service. |
| Durable files | Private Amazon S3 bucket | Pinned source bundles, configs, playable builds, saves, logs and verification evidence. Database records point to immutable objects and digests. |
| Coding and verification jobs | On-demand Daytona Cloud Linux sandbox | Run Shishir's harness and agent, edit copied source, compile, launch the supported game/runtime, verify and return the work. One active improvement run per user is the proposed initial hosting limit. |
| Reusable toolchain | Shared, versioned Daytona sandbox image | Pinned compiler, ARM tools, runtime dependencies and required test tools. Prepare once; hydrate each user's source when a run starts. |
| Model access | User-supplied API credentials | Provider bills model usage to the user; Gameverse accounts for sandbox and hosting usage separately. |

Use authorized S3 downloads for source and saves; serve immutable playable artifacts through short-lived signed URLs or the backend. Give each Daytona job scoped input downloads and output upload locations. Browser CSP, CORS and artifact loading must be qualified for the chosen path. A CDN can be added when measured delivery requirements justify it.

Daytona is selected to package workspace provisioning, command execution, file operations and logs for coding and verification. The goal is to prepare an environment quickly, perform the work, submit its results and terminate it; interactive use is optional. Measure actual request-to-ready time, including source hydration and dependency setup, rather than treating advertised sandbox startup as end-to-end readiness.

The dispatcher schedules the external run lifecycle. It does not prescribe Shishir's search, repair or evaluation algorithm, or introduce a mandatory orchestration system inside his loop.

## Durable project state

Each user has a persistent project, reconstructed into a disposable sandbox when needed:

- Pin the accepted game's config, source revision, build definition, dependencies and playable artifact. A source snapshot or an exact baseline plus retained patches must be sufficient to reconstruct it without an old sandbox.
- Retain requested changes, conversation/proposal revisions, attempts, returned candidates and verification evidence separately from accepted versions. A partial experiment cannot overwrite accepted source.
- Keep player saves and matching-version execution snapshots outside the sandbox. Simulation receives copied or fresh state, never write access to accepted player progress.
- Store credentials separately from source, builds, logs and sandbox images. Keep database references to the configured credentials rather than embedding keys in run manifests.

Build caches are optional and disposable. Start with the shared toolchain image; add source/build caches only if representative measurements justify their storage and invalidation costs. Accepted artifacts and required parent versions remain retained for resume, lineage and recovery. Source/evidence retention needs an explicit policy; the cost estimate assumes 5 GB per customer, not unlimited history.

## Sandbox handoff

The following records describe required meanings, not final field names or wire formats. Reuse the version/config/submission meanings from the parallel contract.

| Handoff | Contents |
| --- | --- |
| Request to run | User/project authorization; request and revision IDs; base/subgame target and expected accepted version; immutable source/config references and digests; context and isolated checkpoint reference when available. |
| Execution configuration | Environment-harness and adapter versions; loop version/config; toolchain image identity; required capabilities; credential references; configured run/resource limits. |
| Returned candidate | Stable submission and originating attempt IDs; new/update/fork classification; pinned parents; immutable source/config/build/artifact references; verification evidence; save compatibility or explicit fresh progress. |
| Observable result | Durable status and reason, evidence locations, timing/usage report and submission receipt. Candidate registration and activation remain separate outcomes. |

1. **Receive the request.** Authenticate the user, capture the exact game target and baseline, and commit the request/revision before acknowledging that it is queued. Retries reuse the request identity. Navigation does not retarget submitted work.
2. **Claim and provision.** Claim a job with a recoverable lease, record an attempt ID, and provision a sandbox within hosting capacity. Persist its provider ID so a backend restart can reconcile the existing attempt instead of blindly launching another. Provisioning must carry a correlation identity that allows reconciliation after an uncertain create response.
3. **Hydrate the source.** Start from the prepared Daytona image, fetch pinned source/configs from S3, verify digests and start with copied or fresh simulation state. Give the run access only to its own input objects, output upload locations and authorized model credentials.
4. **Execute the coding and verification job.** Shishir's harness interprets, edits code, builds, launches the supported game/runtime, simulates and evaluates within its configured limits. Persist status, logs and useful intermediate source/proposal state externally. Failed and cancelled attempts remain inspectable. Player gameplay continues independently.
5. **Return a candidate.** Upload changed source, playable artifact, verification evidence and usage/timing reports to immutable S3 locations and submit their references to the AWS backend. Only report a durable candidate after its objects and submission receipt are retained. Submission retries cannot create duplicate playable versions.
6. **Validate and activate.** The host checks ownership, evidence, cancellation, request revision, expected baseline and adapter/save compatibility. Updates apply through the existing safe-boundary and recovery contract; forks retain separate identity and progress. A stale or incompatible result cannot silently replace the current version.
7. **Clean up.** Delete the sandbox after retaining its durable results. A cleanup/reconciliation path also handles crashes, provider interruption, cancellation and failed uploads. Unconfirmed work is retried from the last durable state; do not claim an arbitrary in-memory agent session can resume after deletion.

An expired lease or lost connection does not prove the sandbox stopped. Reconcile or terminate the old attempt before starting a replacement, and reject late results from superseded attempts. If cancellation arrives during upload or validation, recheck it before registration/activation. A cleanup failure remains visible and subject to a bounded termination retry so abandoned compute does not run indefinitely.

## Credentials and user isolation

The backend authorizes each credential reference against the requesting user. The initial preference is Daytona's protected secrets with provider-host allowlists: the sandbox receives an opaque token and Daytona substitutes the credential in outbound HTTPS headers. Qualify the selected model client against that mechanism; body/query authentication is not supported by it. Keep hosting, database and sandbox-management credentials outside the sandbox. [Daytona secrets documentation](https://www.daytona.io/docs/en/secrets/)

Store only the credential reference and settings in PostgreSQL when using that secret store. Rotation/revocation and account deletion must cover the external secret as well. Object access and run callbacks need scoped authorization, not a user ID supplied by the agent. Sandbox code must not receive general bucket or database access. Persist and redact operational logs without recording credentials.

## Cost model per customer

Prices checked on 2026-10-16, in USD, using AWS US East on-demand rates and Daytona Cloud public rates. These are calculated infrastructure component subtotals, not measured bills, capacity guarantees or subscription prices. User credentials pay for model API usage separately.

### Reference configuration and shared AWS hosting

Model 100 customers retaining 5 GB each, or 500 GB total S3 Standard storage. Use a 720-hour month, one always-on Linux/x86 app task at 0.5 vCPU/1 GiB, one Single-AZ RDS PostgreSQL db.t4g.micro at 1 GiB with 20 GiB gp3, and an HTTPS Application Load Balancer. The example is a small pilot without app/database redundancy. Neither this sizing nor request-to-ready/build/verification latency has been qualified.

| Shared AWS component | Monthly calculation | Cost |
| --- | --- | ---: |
| Web app on Fargate | (0.5 × $0.04048/vCPU-hour + 1 × $0.004445/GiB-hour) × 720 | $17.77 |
| RDS PostgreSQL compute | $0.016/hour × 720 | $11.52 |
| RDS database disk | 20 GiB × $0.115/GiB-month | $2.30 |
| Durable project files in S3 | 500 GB × $0.023/GB-month | $11.50 |
| Application public IPv4 | 1 × $0.005/hour × 720 | $3.60 |
| ALB fixed charge | $0.0225/hour × 720 | $16.20 |
| ALB public IPv4 addresses | 2 × $0.005/hour × 720 | $7.20 |
| ALB capacity usage | 1 illustrative average LCU × $0.008/hour × 720 | $5.76 |
| **Shared hosting and retained files** | Sum using unrounded inputs | **$75.85/month** |

One average ALB capacity unit is an assumption, not a mandatory minimum or measured traffic. Two ALB public addresses are the minimum modeled footprint; more can add cost. Use a public subnet for the app task with inbound access restricted to the ALB, and keep RDS private. The app can call Daytona/model APIs without a NAT gateway in this design. Private-subnet NAT, additional replicas, larger database or different ingress/delivery choices change the bill. RDS burst CPU above its baseline can also add charges.

The shared application/database/ingress subtotal excluding S3 is $64.3532/month. The 500 GB S3 input adds $11.50, producing $75.8532/month, or $0.758532/customer at 100 customers. This replaces the earlier arbitrary $50 shared budget and self-managed Lightsail comparison.

Sources: [Fargate pricing](https://aws.amazon.com/fargate/pricing/), [RDS PostgreSQL regional price catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/us-east-1/index.json), [S3 regional price catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json), [ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) and [IPv4 pricing](https://aws.amazon.com/vpc/pricing/). [Detailed AWS reference and catalog identities](../research/HOSTING_AWS_COMPARISON.md) retain the extraction context and qualification gaps; its direct-Fargate improvement-job calculation is an alternative, not this plan's executor.

### Daytona coding and verification jobs

| Job resource | Allocation and rate | Cost per billable hour |
| --- | --- | ---: |
| CPU | 2 vCPUs × $0.0504/vCPU-hour | $0.1008 |
| Memory | 4 GiB × $0.0162/GiB-hour | $0.0648 |
| Temporary disk | 20 GiB × $0.000108/GiB-hour; conservatively ignore free allowances | $0.00216 |
| **Complete sandbox** | Allocated only for the job lifecycle | **$0.16776/hour** |

Daytona charges reserved resources during running and billable lifecycle states, including waits for model responses. Count provisioning, source/image transfer, coding, builds, verification, repairs, uploads, failed/cancelled attempts and cleanup. Sum resource-hours across extra parallel simulation sandboxes. A hypothetical 20-minute job costs $0.05592, approximately 5.6 cents; that duration is not a measured loop latency. [Daytona pricing](https://www.daytona.io/pricing), [Daytona billing](https://www.daytona.io/docs/en/billing/)

Delete the sandbox after retaining its outputs in S3. Stopping alone retains disk billing; this plan retains no per-user Daytona disk or snapshot. Shared image storage, future warm pools and retained caches need separate accounting if introduced.

### Combined per customer estimate

For `N` customers, each retaining 5 GB, and `H` billable Daytona hours per customer per month:

```text
Monthly cost/customer = $64.3532 / N + 5 × $0.023 + $0.16776 × H

At 100 customers:
Monthly cost/customer = $0.758532 + $0.16776 × H
```

The fixed shared-service sizing is an illustrative allocation model, not a promise that its capacity remains sufficient as N grows.

| Daytona job time per customer per month | Job resources | Allocated AWS hosting and files | Total per customer |
| --- | ---: | ---: | ---: |
| None; playing only | $0.00 | $0.76 | **$0.76** |
| 10 hours | $1.68 | $0.76 | **$2.44** |
| 30 hours | $5.03 | $0.76 | **$5.79** |
| 100 hours | $16.78 | $0.76 | **$17.53** |

Totals use unrounded inputs. At 100 customers each using 30 job hours, the model is $75.8532 AWS shared hosting/files plus $503.28 Daytona, or **$579.13/month** before excluded items. At 10 customers, the same fixed hosting model and 5 GB/customer allocation would put the 30-hour example at $11.58/customer; this is allocation sensitivity, not a separate measured configuration.

Excluded: model API usage, transcription, S3 requests, data transfer/CDN, image registry and shared-image storage, logs/metrics, secrets/KMS, extra backup/snapshot storage, domain/DNS, taxes, payment fees and operational/support labor. ALB capacity usage is explicitly modeled; other variable traffic is not. In particular, downloading source from AWS into Daytona is cross-provider traffic, and 5 GB retained files is not a transfer allowance. No trial credits, startup grants, Spot or negotiated discounts are assumed. These estimates must not be presented as an all-in cost cap.

## Managed service responsibilities

AWS operates Fargate's underlying infrastructure; RDS handles database infrastructure, patching and backup mechanisms. We configure networking/IAM, images and rollouts, backup retention, maintenance settings, monitoring and restore validation, and own schema/migrations/queries and application recovery. Daytona operates its hosted sandbox infrastructure and provides workspace/process/file APIs; we still own durable requests/results, scoped access, cancellation/cleanup, verification criteria and safe activation. There is no measured basis for a fixed maintenance-hours claim. [Fargate responsibilities](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-shared-model.html), [RDS features](https://aws.amazon.com/rds/features/), [Daytona process execution](https://www.daytona.io/docs/en/process-code-execution/)

Railway, a self-managed Lightsail database, direct Fargate coding jobs and Daytona BYOC are comparison alternatives, not additional services required by this plan. The [provider comparison](../research/HOSTING_PROVIDER_COMPARISON.md) retains their tradeoffs. Revisit only if measured cost, capacity or missing runtime capabilities justify a change.

## Infrastructure prerequisites

- **AWS deployment access:** identify the target account, environment and region; use a locally authenticated CLI profile, preferably SSO, with a scoped deployment role. Provisioning needs the selected ECS/ECR, RDS, S3, ALB, VPC, certificate/log/secret resources and the associated IAM roles/pass-role permissions. Prepare and review the actual policy with the infrastructure code; do not put credentials in the repository or chat.
- **Daytona access:** a billing-enabled organization and securely configured API key with sandbox/image/secret permissions needed by the selected flow. Confirm its region, resource and concurrency quotas before admitting jobs.
- **Pilot limits:** choose an AWS/Daytona spending budget, maximum simultaneous jobs and finite per-job limits. Supply a test model credential through the configured secret mechanism for model-backed qualification; the public reference fixture can start without one.
- **Harness and native inputs:** start from the existing [improvement API](../contracts/IMPROVEMENT_API.md) and [native engine handoff](../contracts/IMPROVEMENT_HANDOFF.md), agree the Daytona entrypoint and retained state with Shishir, and qualify Linux portability. Authorized game/provider inputs and copied saves are external prerequisites for native runs; keep their distribution/storage scope explicit. The public reference fixture can qualify dispatch/results before those inputs are available.
- **Public endpoint:** identify the intended hostname and DNS/certificate control before a branded HTTPS deployment. Private infrastructure definitions and the sandbox reference job can be prepared while the hostname and user-login flow are settled.

Infrastructure code, container definitions and the handoff adapter can be prepared before cloud provisioning access is available. Creating billable resources and running model-backed jobs require the selected account access, limits and execution authorization; this documentation commit does not provision them.

## Scaling and resource controls

Scale sandbox capacity with active improvements, while storage grows with retained projects and history. For example, 1,000 customers each using 30 sandbox hours/month produce 30,000 sandbox-hours, or about 42 simultaneously running sandboxes averaged across a 720-hour month. Peak demand can be much higher. This workload models $5,032.80 in Daytona job resources plus $115 in S3 retained files, before appropriately sized shared application/database/ingress services and excluded costs. Do not extrapolate the pilot shared-service capacity to this user count without measurement.

Start with one active improvement per user, a global concurrency cap and durable queuing. Retain configurable run deadlines, CPU/RAM/disk ceilings and cost/repair limits; Shishir's loop config continues to own its algorithm and resource policy. Cancellation must terminate external compute as well as update application status. Confirm provider concurrency, API and storage quotas against peak demand before increasing admission limits.

The sandbox image is reusable across users and contains no user credentials or project state. A different sandbox provider should require changes to provisioning, execution, upload and cleanup adapters, rather than changes to game discovery or the candidate contract. Evaluate provider cost using the same pinned build and complete improvement workload, including startup and restore overhead.

## Delivery and qualification

Keep this hosting work aligned with the [three environment slices](ENVIRONMENT_SLICES.md); it does not certify or replace their player-facing gates. The [development setup](../DEVELOPMENT.md) uses a loopback-only local server and browser-local progress; its production bundle excludes cartridges and its recorded FireRed build toolchain is macOS. The standalone [improvement API and native handoff](../contracts/IMPROVEMENT_HANDOFF.md) are now available on main, but that is not AWS/Daytona deployment or accepted integration with the player host. Adapt the existing interface instead of recreating the loop.

1. **Qualify a disposable Daytona coding and verification job.** Prepare the smallest suitable shared Linux toolchain image. From a pinned source bundle, build FireRed, make a real source change, produce a distinct candidate and boot/play it through the supported adapter. Record sandbox allocation-to-ready, source hydration, dependency setup and the full request-to-ready interval, followed by coding/build/verification/upload/cleanup. Distinguish cold setup from warm-image runs. Reuse existing reports; do not infer hosted duration from the local compiler result.
2. **Host the accepted game path on AWS.** Configure ECS Fargate, ALB/TLS, RDS and S3 with scoped IAM, plus app image delivery. Add production network binding, login/authorization, immutable artifact loading, cloud save storage and honest save/sync failure recovery. Preserve the current save-to-version pairing and define concurrent-device write behavior before claiming hosted resume. Verify the intended game/source/asset distribution scope against the existing publication exclusions before exposing those artifacts.
3. **Connect one real improvement end to end.** Exchange v0 records with Shishir, retain a durable request in RDS, run his harness in Daytona, retain changed source/build/evidence in S3, return a candidate to the AWS backend, validate/activate through the host and delete the sandbox. Demonstrate a later request reconstructing the newly accepted source without any prior sandbox.
4. **Exercise interruption and isolation.** Cover duplicate requests/submissions, backend restart, sandbox loss, cancellation, failed uploads, stale baselines, failed verification and cleanup failures. Confirm another user's source/credentials and accepted player saves remain inaccessible to the experiment.
5. **Measure before setting commercial allowances.** Record request/run/attempt IDs, source/config/artifact identities, environment/adapter and loop versions, toolchain/image/provider resources, queue/total/build/simulation/evaluation/repair times, attempt counts, outcome and billed resource usage. Preserve failed/cancelled runs, distinguish overlapping stages and mark unavailable fields explicitly. Compare turnaround only on equivalent inputs/cache conditions; no hosted baseline or before/after measurement exists yet.

Use narrow checks for this integration. Broader game campaigns, expensive model evaluations and concurrency qualification run separately with explicit scope and limits, following [AGENTS.md](../AGENTS.md). Provider account setup, deployment and publication remain separate execution steps from this plan.
