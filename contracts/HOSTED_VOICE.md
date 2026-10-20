# Hosted voice execution contract

Issue #21 H0–H3, 2026-10-20. The issue's dated decisions govern product scope.

Regular admitted API-key accounts run their game in the browser. Gameverse's cloud control plane dispatches bounded private Daytona voice workers. No developer permission, paired manager, local discovery, repo checkout or personal Daytona account is required. The macOS manager remains the separate developer-work/personal-Codex route; personal Codex qualification is not established here. Existing pilot phone admission remains in force; this is not unrestricted public signup.

## Roles and authority

- The trusted browser host owns live session identity, control grants, actual tool acknowledgment and immediate Stop/neutral handback. `VoiceAgent` runs in the fixed Daytona worker; the existing browser `SimulatedUser` scheduler uses brokered Decisions/reflection calls. Human play never needs a worker.
- `HostedVoiceState` is named only by the authenticated account principal. `DevManagerState` and its shared developer registry are separate. Public users cannot inspect/manage another developer's work or use personal subscription credentials.
- `HostedVoiceCore` admits voice roots only in H3. Construction/child-job adapters and candidate activation remain H4. The same accepted parent-budget semantics must be extended deliberately when children are introduced, rather than giving each child a new allowance.
- Settings/configuration/discovery create no job. A deliberate recorded voice submission with a valid current binding is the first dispatch trigger. Audio requests reserve their finite per-root allowance before R2 I/O, including pending/uncertain uploads. Audio persistence completes before a worker can consume the request; uncommitted uploads cannot dispatch a worker or be claimed. Duplicate uploads reuse the same reservation.

## Identity and protocol

The `gameverse.browser-voice/1` envelope is shared. A hosted binding declares `execution: hosted-api-key` and omits `manager_id`; a developer binding requires its real paired manager. Both carry independent binding UUID/epoch and exact profile, game, version, artifact, live session and source identity. Hosted admission verifies soccer against the release's known version/artifact, not client-supplied source or manager metadata.

The browser build produces `runtime/voice-worker.json`: public fixed worker code read from immutable Git objects, its manifest/digests, and the released soccer artifact identity. No launch token or provider credential belongs in that file. The cloud verifies the release digest and retains the package under its content digest in private R2. A job retains that digest across deployment/restart; a later release cannot change a previously admitted worker's files.

Worker requests use a task/account/session/deadline capability and the exact owner-routed endpoint. The broker fetches the task before authenticating its capability; it initializes no new account state for an invalid worker. The account's current connection generation/revision is rechecked for tools/provider work. Browser commands carry epoch, sequence, expiry and exact target identity. Tool success requires the matching host acknowledgment; a requested start is not evidence of control or gameplay.

Stop, session replacement/closure, hidden/suspended browser, unhealthy game, lost lease and account-key revocation fence late commands/results. Stop is synchronous in the browser even when cloud fetches never return. Rebinding never replays old starts/movement. Parent cancellation and selected gameplay Stop remain distinct concepts; H3 has a single voice root per admitted session.

## Credentials and capabilities

The initial hosted service adapter uses the account's OpenAI API-key connection (legacy storage provider ID `codex`) for transcription, planning, gameplay Decisions and reflection. It does not use a ChatGPT/Codex subscription login. Claude-only setup does not imply ASR/Decisions access. TTS and hosted source coding are not enabled by this slice.

API-key storage reuses account-bound authenticated encryption. The key is retrieved only through trusted server RPC for the task's provider, generation, revision, root ID, service and finite expiry. It never reaches worker launch files, game/browser bundles, logs, artifacts or candidate source. API-key inference can share a configured credential across explicitly bounded concurrent services; it does not acquire or duplicate the exclusive lease for rotating browser-auth credentials.

Connection rotation/disconnect fences further calls/tools. A provider request already transmitted may incur cost; its response is rejected if the account/session was revoked while it ran. Reservations persist before external inference, including failed/uncertain calls. A repeated ID returns its known result or an unknown outcome; it never makes an automatic paid retry. No operator key/provider fallback exists for hosted requests.

Saving a key checks authentication through the provider models endpoint, not inference entitlement. Availability means a supported key is configured; `inference_qualified: false` makes that distinction explicit. First actual service use may fail visibly. The UI must not claim coding or speech support from a connected label.

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
