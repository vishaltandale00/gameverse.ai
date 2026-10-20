# Hosted voice execution contract

Issue #21 H0–H3, 2026-10-20. The issue's dated decisions govern product scope.

Regular admitted accounts run their game in the browser. The 2026-10-20 product update makes voice application-funded: players do not enter a provider key for voice or simulated-player takeover. Personal coding connections remain separate. Gameverse's cloud control plane dispatches bounded private Daytona voice workers. No developer permission, paired manager, local discovery, repo checkout or personal Daytona account is required. The macOS manager remains the separate developer-work/personal-Codex route; personal Codex qualification is not established here. Existing pilot phone admission remains in force; this is not unrestricted public signup.

## Roles and authority

- The trusted browser host owns live session identity, control grants, actual tool acknowledgment and immediate Stop/neutral handback. `VoiceAgent` runs in the fixed Daytona worker; the existing browser `SimulatedUser` scheduler uses brokered Decisions/reflection calls. Human play never needs a worker.
- `HostedVoiceState` is named only by the authenticated account principal. `DevManagerState` and its shared developer registry are separate. Public users cannot inspect/manage another developer's work or use personal subscription credentials.
- `HostedVoiceCore` admits voice roots only in H3. Construction/child-job adapters and candidate activation remain H4. The same accepted parent-budget semantics must be extended deliberately when children are introduced, rather than giving each child a new allowance.
- Settings/configuration/discovery create no job. A deliberate recorded voice submission with a valid current binding is the first dispatch trigger. Audio requests reserve their finite per-root allowance before R2 I/O, including pending/uncertain uploads. Audio persistence completes before a worker can consume the request; uncommitted uploads cannot dispatch a worker or be claimed. Duplicate uploads reuse the same reservation.

## Identity and protocol

The `gameverse.browser-voice/1` envelope is shared. A hosted binding declares `execution: hosted-api-key` and omits `manager_id`; a developer binding requires its real paired manager. Both carry independent binding UUID/epoch and exact profile, game, version, artifact, live session and source identity. Hosted admission verifies soccer against the release's known version/artifact, not client-supplied source or manager metadata.

The browser build produces `runtime/voice-worker.json`: public fixed worker code read from immutable Git objects, its manifest/digests, and the released soccer artifact identity. No launch token or provider credential belongs in that file. The cloud verifies the release digest and retains the package under its content digest in private R2. A job retains that digest across deployment/restart; a later release cannot change a previously admitted worker's files.

Worker requests use a task/account/session/deadline capability and the exact owner-routed endpoint. The broker fetches the task before authenticating its capability; it initializes no new account state for an invalid worker. The selected funding source and credential generation/revision are rechecked for tools/provider work. Browser commands carry epoch, sequence, expiry and exact target identity. Tool success requires the matching host acknowledgment; a requested start is not evidence of control or gameplay.

Stop, session replacement/closure, hidden/suspended browser, unhealthy game, lost lease and funding/credential revocation fence late commands/results. Stop is synchronous in the browser even when cloud fetches never return. Rebinding never replays old starts/movement. Parent cancellation and selected gameplay Stop remain distinct concepts; H3 has a single voice root per admitted session.

## Credentials and capabilities

The default `HOSTED_VOICE_CREDENTIALS=application` mode uses Gameverse's dedicated `VOICE_OPENAI_API_KEY` server secret for transcription, voice planning, gameplay Decisions and reflection. No personal account key, ChatGPT/Codex subscription or local manager is required. The generic legacy `OPENAI_API_KEY` is not a fallback. TTS and source coding are outside this voice grant.

The operator may explicitly select legacy `HOSTED_VOICE_CREDENTIALS=account` for qualification/backward compatibility. That route continues to retrieve the account's encrypted OpenAI API-key connection (legacy storage ID `codex`) through trusted server RPC. Funding is fixed when admitting a task. Switching payer, rotating/removing the application secret, or rotating/disconnecting an account-funded connection fences that task. Personal account changes do not revoke or charge application-funded voice.

The application key stays in the cloud broker. Its opaque generation is derived using the environment's private encryption key; raw credentials never reach the browser, worker launch files, logs, artifacts or candidate source. Application capabilities admit only voice roots, an unexpired deadline and the fixed transcribe/plan/decisions/reflect services. Existing per-root/account/platform/daily limits apply to application-paid calls. A missing application key fails closed with a service-unavailable message; no account/operator/provider fallback is attempted.

A provider request already transmitted may incur cost. Its response is rejected when the session or funding grant is revoked while it runs. Reservations persist before external inference, including failed/uncertain calls. Duplicate IDs return the known result or unknown outcome without an automatic paid retry. `inference_qualified: false` distinguishes configured credentials from proven live service access. Personal coding connection setup must not be presented as a prerequisite for voice.

## Admission and recovery

`HOSTED_VOICE_ENABLED=1` and a valid explicit `HOSTED_VOICE_POLICY` are required. There are no default production allowances. Policy bounds wall time, total model attempts, account/platform active jobs and rolling daily jobs. The root's finite allowance persists across reconnect/restart/duplicate requests. Reservations count failed/cancelled/unknown work and are released only after confirmed cleanup. Dollar/token usage remains unavailable when the provider does not return it.

Cloudflare alarms drive dispatch and cleanup independently of browsers or developer machines. Polling must preserve the earliest scheduled alarm. Create/execute intent is committed before I/O. A lost create is reconciled by the stable name/exact recorded ID; a lost execution is reconciled from output and never executed again. A creation whose outcome cannot be established remains reserved even after its nominal TTL. A deletion that renames the sandbox is observed by its exact ID until absent.

The fixed voice image is pinned and checked as private 1 CPU / 1 GiB / 3 GiB with a confirmed finite remote TTL. This is the voice-worker allocation, not renderer sizing. Trusted code/package and filtered receipts are retained privately. Malformed worker receipts are rejected, recorded as failures and cannot block safe cleanup indefinitely. Private source retention must succeed before deletion when a worker was hydrated; unavailable retention keeps recovery visible/reserved.

The browser's five-second lease and finite job wall time do not promise background/unattended gameplay. Required sandbox-to-backend egress must be supported by Daytona organization policy; a developer-Mac relay is not the hosted execution route.

## Ownership and evidence

Vishal owns account/host/adapters/control authority/transport/recovery. Shishir owns gameplay/construction algorithms, cadence, scenarios and loop configuration. No second policy loop is introduced.

Use focused existing Node/workerd/vault tests plus a separately triggered bounded Chromium journey. Distinguish synthetic providers/Daytona transport, real worker processes, real separate sandboxes and real inference. Preserve source/config/environment identities and failed/cancelled outcomes. No passing synthetic journey implies deployment, general signup, supported subscription Codex, real ASR quality or checkpoint-based B′/B″ activation.

## Live state and retained history

Hosted account history is not a lifetime admission budget. Once cleanup is confirmed and the job deadline plus a 30-second in-flight-result grace period has passed, requests, tool acknowledgments, model/provider results and task receipts move from live indexes into account-private SQLite history. Revoked or lease-expired bindings without a live task become durable revoked tombstones. Historical status and R2 artifacts remain owner-readable after restart; archived IDs cannot start new work or restore an old epoch. Rolling daily admission counts both live and archived tasks through an indexed timestamp query. Empty abandoned bindings are reclaimed on the next configuration/bind operation. Developer manager job history keeps its separate bounded development registry policy.

Oversized worker receipts are terminally rejected just like malformed JSON. Once rejected, cleanup does not download that receipt again; trusted source retention and confirmed deletion still precede capacity release.
