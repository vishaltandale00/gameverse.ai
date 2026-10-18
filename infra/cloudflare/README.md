# Cloudflare hosted pilot

Gameverse uses Cloudflare Workers + Static Assets, SQLite Durable Objects and private R2 for persistent hosting; Daytona supplies disposable coding sandboxes. See the [hosting plan](../../plans/HOSTING.md) for the two slices and cost model.

## Current status — 2026-10-18

[gameverse.build](https://gameverse.build) and its [account page](https://gameverse.build/account) serve the invite-only pilot. The custom domain and the existing [workers.dev endpoint](https://gameverse-host-staging.gameverse-environment.workers.dev/account) point to **the same staging Worker and data**, not isolated environments. Host-only session cookies are separate on each hostname, so use gameverse.build consistently. A separate production deployment will require independent namespaces, bucket and secrets.

Version `8c26510b-f8f1-44f0-b460-4927e8643dfa` deploys:

- The authored browser frontend, phone verification through Twilio Verify, and opaque HttpOnly/Secure session cookies. Numbers default to the network country, then browser region, with a visible editable country selector. Local formats are converted to international format before submission; the server independently enforces the pilot allowlist.
- Account-scoped connections, AES-GCM encrypted credential retention, default selection, API-key validation and invited-developer Claude browser authorization. Codex browser connection is disabled pending a registered Sign in with ChatGPT client.
- Durable pending requests, a fixed Python addition coding check, disposable Daytona execution, private retained source/results, cancellation and confirmed cleanup. The coordinator persists launch intent before external calls and reconciles uncertain responses by deterministic sandbox name.
- A global single-sandbox admission cap, ten operations/account/day, bounded runtime deadlines and ephemeral sandbox safeguards. These are pilot limits, not measured capacity guarantees.

**Real Claude qualification:** phone verification and personal Claude browser authorization completed. The pending request resumed once, edited the public Python fixture and passed all four cases. A second run reused the encrypted saved connection in a fresh sandbox. Both results remain readable; independent Daytona lookups confirmed that the authorization sandbox and both coding sandboxes are absent. [Exact sanitized results/timing](../../verification/hosted-connected-agent-runs-20261018.json). These two runs used deployment `580ef758-2424-49ad-bcd3-e74e0866b40a`; the subsequent UI changes did not run another model task.

**Remaining scope:** this pilot does not yet implement game improvement/activation, private player-project membership, unreleased harness selection or the complete expiry/reconnect adapter. Codex browser registration and Shishir's own-account journey are still open. A passed Python fixture is not either slice's full acceptance.

### Connection experience

The account page uses a compact heading, provider rows and a short activity list. Developer controls, technical run details and raw result JSON are collapsed. Connection operations stay in their provider card rather than appearing as coding tasks.

A real **Connect** click opens a same-origin preparation tab immediately, before network work. That tab starts/reuses the same idempotent authorization request and continues to Claude as soon as its URL is ready. This replaces agent-created background tabs; exact tab ordering remains browser-controlled. If a popup is blocked, the original card exposes **Open Claude** as a normal user-click link. The helper has a 90-second preparation deadline and polls every 2.5 seconds (at most about 36 additional GETs), while the account page retains its existing five-second visible-page polling. Returning to the page triggers immediate refresh.

The provider card shows **Opening Claude → Finish in Claude → Verifying connection → Connected**. Code submission removes the secret from the form and immediately replaces the form with progress. The host persists verification before external transfer, deduplicates concurrent submissions and suppresses stale authorization URLs while verification is pending. Refreshing the page preserves that state. Cancellation and failure/retry have separate visible states. The new progress states were exercised in a synthetic browser fixture; the working real connection was preserved, not disconnected for another demonstration.

## Resources and secrets

`wrangler.staging.jsonc` binds `PROJECTS`, `AGENT_CONNECTIONS`, `IDENTITY`, `ACCOUNT_JOBS` and `SANDBOX_ADMISSION`. Migrations v1–v3 create their SQLite classes. `ARTIFACTS` uses `gameverse-artifacts-staging`; public R2 access remains disabled. The custom app domain does not expose the bucket.

Required Worker secret bindings:

| Secret | Purpose |
| --- | --- |
| `STAGING_API_TOKEN` | Operator-only bootstrap API; never give it to players or sandboxes |
| `DAYTONA_API_KEY` | Hosting control-plane access; never put it in a coding sandbox |
| `ACCOUNT_ID_KEY` | Stable HMAC key deriving account identity from verified phone numbers |
| `AGENT_CREDENTIAL_KEY` | Independent AES-GCM key for personal provider auth state |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | Server-side Verify service access |
| `GAMEVERSE_PILOT_PHONES`, `GAMEVERSE_DEVELOPER_PHONES` | Comma-separated E.164 pilot/developer allowlists |

Keep the Daytona/Twilio settings and phone allowlists in ignored `.env`. `npm run infra:secrets` prepares only these settings, generates the operator/account/encryption keys once, and retains them in ignored `local-data/hosting/staging-secrets.json` with mode 0600. It prints names/path only. Back up the keys through your secret manager: changing `ACCOUNT_ID_KEY` changes account identities; replacing `AGENT_CREDENTIAL_KEY` without migration makes existing credentials unreadable. Key rotation/re-encryption and restore qualification are still rollout work.

No actual phone numbers or provider credentials belong in source, frontend assets, logs or R2. No user-facing credential-read endpoint exists. The trusted coordinator injects only the selected account's agent state into a disposable sandbox via file transfer; the fixed probe is not yet a general untrusted-code credential boundary.

## Setup and deployment

Workers Paid and R2 must be enabled; OAuth login alone is insufficient. This account already has both enabled. `gameverse.build` is an active Cloudflare zone and its custom-domain route is managed by Wrangler. Existing domain records must be inspected before connecting another hostname.

```sh
npm ci --ignore-scripts
npx wrangler login
npm run infra:secrets
npm run test:hosting
npm run build
npm run infra:check
```

After deployment authorization:

```sh
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx wrangler deploy --config wrangler.staging.jsonc --secrets-file local-data/hosting/staging-secrets.json
npm run infra:smoke -- https://gameverse.build
```

The secrets file prevents bulk-uploading unrelated dotenv values. Do not enable unsanitized debug logging. `infra:check` is a Worker dry run, separate from the frontend build; build assets first. The build copies authored games and excludes GBA cartridges. Local `/account` navigation redirects to the hosted account page.

For local emulation, `npm run infra:dev` uses local SQLite/R2 (`remote:false`). Tests disable dotenv loading, use temporary state and synthetic provider responses, and make no SMS/Daytona/model call. No new CI job or broad game matrix was added.

## Browser qualification

1. Open [the account page](https://gameverse.build/account), select/change the suggested country if needed, enter a normal phone number and complete SMS verification.
2. Expand **Developer tools** and click **Run coding check** before connecting. Confirm the request is retained while waiting for a connection.
3. Click **Connect** in the Claude row. Complete authorization in the newly opened tab, then return and paste the code into Gameverse. A settings-only connection allocates an authorization sandbox but starts no coding task.
4. Confirm the pending coding check continues once, implements the Python addition fixture, retains its result and confirms sandbox deletion.
5. Run another check in a fresh sandbox using the retained personal connection. Inspect cancellation and selected-provider reconnect behavior before claiming Slice 1 complete.

Claude uses pinned CLI `2.1.252` in a Daytona snapshot with inherited 1 CPU / 1 GiB / 3 GiB disk. The official npm installer links its native binary; the runtime uses an isolated auth directory. Provider state is retained encrypted after authorization and refreshed state uses revision checks. Connection use is serialized; disconnect invalidates credentials and late writebacks, requests cancellation and retains the lock until external runtime termination is confirmed. Lease expiry is not proof that a process stopped.

OpenAI's hosted/commercial flow requires a registered [Sign in with ChatGPT client](https://developers.openai.com/siwc); the [app-server managed-auth restriction](https://learn.chatgpt.com/docs/app-server#auth-endpoints) means the local Codex CLI login is not a hosted shortcut. Codex API keys can be validated/stored, but its job runtime is not enabled. Claude's documented [browser/code authentication](https://code.claude.com/docs/en/authentication) and [third-party subscription usage](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) are being qualified with the actual browser journey, not inferred from a local login cache.

## Evidence and turnaround

- Focused local suite: **29/29**, **4,201.88 ms** total runner wall time on Node 22.23.2/macOS arm64 with Wrangler 4.151.1. Fixtures cover identity, encrypted state, request isolation/idempotency, uncertain launch/deletion recovery, cancellation, fresh-run credential reuse and phone formats. Group timings overlap and are not additive. The expected conflicting-request test logs a bounded error while asserting rejection. After adding stale-provider-URL coverage, the two affected test files passed another 5 checks in 1,670.59 ms; the unchanged broad suite was not repeated. The earlier 28-check run took 1,530.50 ms with different coverage/load, so that is not a comparable latency regression measurement.
- Clean frontend copy: **35.7 ms before / 45.0 ms after** this compact-UX change on this checkout/toolchain with warm dependencies/filesystem; one representative pair, not a latency guarantee. The country-only increment previously took 36.8 ms. The pinned phone parser remains **178,716 bytes raw / 42,996 gzip**, loaded by the account page. No new dependency, framework, bundler or CI job was added for the UX change.
- Worker dry run: **63.77 KiB / 16.10 KiB gzip**. Latest layout deployment asset upload **0.92 s**, Worker upload **4.61 s**, trigger update **1.15 s**, provider-reported startup **3 ms**; these are distinct stages, not coding-run latency.
- Custom-domain HTTP/SQLite/R2 smoke: **4 groups / 15 requests / 1,870.01 ms**, with no SMS, Daytona or model call. Its first invocation was rejected locally by the old workers.dev-only destination guard before any request; the guard now allows only the two approved pilot origins.
- The earlier 14-check storage-only increment is preserved in [its local receipt](../../verification/hosted-connections-local-20261018.json). Initial Cloudflare setup is preserved in [the 2026-10-17 receipt](../../verification/cloudflare-staging-20261017.json). The phone-pilot source is recorded in [its historical receipt](../../verification/hosted-phone-agent-pilot-20261018.json); final UX source and evidence are in [the UX receipt](../../verification/hosted-agent-ux-20261018.json).

No CI queue/native build/full improvement measurement exists for this increment. Real runtime-only probes took 721 ms total (file roundtrip) and 7,015 ms total (Claude login URL, including 4,841 ms installation), excluding human authorization; all sandboxes were confirmed deleted. Earlier rejected create configurations and the failed launcher attempt remain in ignored probe receipts. Those runtime-only probes remain distinct from the two subsequent authenticated coding successes recorded above.

## API boundaries and next integration

Public `/health` reports liveness only; `/api/auth/config` exposes capabilities/country suggestion, not credentials. Phone start/check/logout enforce same-origin mutation and bounded attempts/rate limits. `/api/me`, `/api/agent-connections/*` and `/api/jobs/*` derive ownership from a verified server-side session; developer operations recheck the invitation.

All `/api/admin/*` endpoints remain operator-token protected. The bootstrap API supports idempotent empty project creation, metadata reads and private digest-checked immutable R2 upload/download; accepted version starts null. The 1 MiB object and 100 ms Worker CPU caps are bootstrap bounds, not native game upload allowances. Do not expose this all-project operator API to players.

Complete actual connected-agent qualification before integrating Shishir's pinned harness through the existing [improvement API](../../contracts/IMPROVEMENT_API.md) and [parallel development contract](../../contracts/PARALLEL_DEVELOPMENT.md). Accepted-game activation and save integrity remain separate host-owned gates in Slice 2.
