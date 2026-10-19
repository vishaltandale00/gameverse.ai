# Developer sandbox manager: first usable slice

Issue #21, packages 0–2. This slice implements a repo-started macOS control process, explicit developer pairing, shared Daytona inventory, confirmed cross-owner management, and a durable **model-free reference fixture**. Codex connection, repository coding, steering, game execution/streaming, candidate activation and PR publication remain gated packages 3–6. A connected personal agent is not required for this fixture. No provider fallback is implemented.

## Run the manager

Use this branch with Node **22+** (the runner uses Node's `parseEnv`) and the repository's existing dependencies. Nothing is installed as a system service. Start it manually:

```sh
npm run manager -- --env-file /absolute/path/to/private-manager.env
```

The private file contains `DAYTONA_API_KEY` for the shared pilot Daytona account. Keep it outside the repo, owner-readable only; do not put model keys or Codex caches in it. Existing process environment wins over file values. The key stays in the local process and is never sent to Cloudflare or hydrated into a job sandbox. The manager does not install software, run user-supplied commands, prevent sleep or auto-start.

Open the **developer** account at `gameverse.build`, click **Check for dev app**, then enter the terminal's short pairing code and click **Connect**. The browser contacts exactly `http://127.0.0.1:4177/health` only after the click; permit browser local-network access if requested. The endpoint accepts the configured site's exact Origin/Host and returns public identity/capability metadata only. No page-load or background port probing occurs. Cloud history refreshes independently.

Pairing uses a P-256 possession key, a 5-minute terminal code and at most five failed code attempts. The hosted service stores the public key and code hash, never the private key or code. Account-bound signed requests include time, nonce, path and body digest, with replay protection. Pairing survives restarts in `~/.config/gameverse-manager/`; directory/file permissions are 0700/0600 and journal writes are atomic. Only one process may hold that state directory. Do not share it between developers.

**Disconnect** revokes admission. To reconnect a revoked installation, restart with `--reconnect`, then pair its new code from the same developer account. Losing the state directory creates a new installation; revoke the old one explicitly. Ordinary restarts do not require a fresh code. Expired unpaired codes require a manual restart. No authentication cache is imported.

The hosted Worker must contain the `DEV_MANAGERS` binding/migration in `wrangler.staging.jsonc`, existing phone/developer identity and private `ARTIFACTS` R2 binding. This change does **not** deploy them. Until that branch is deployed with approval, production reports that the manager backend is not configured. The existing Claude/API-key panels retain their existing behavior; this slice does not qualify a Codex connection.

## Inspect and run the fixture

After pairing and a manual availability check, **Run lifecycle check** queues an explicitly typed parent request. It hydrates fixed public addition source and an independent four-case verifier into a fresh private Daytona sandbox, checks source/request identity, retains digest-checked source and result in private R2, deletes the sandbox and confirms absence before releasing admission. Downloads remain available from cloud history while the manager is stopped. A fixed fixture is intentionally the only executable capability; arbitrary source, shell commands, credentials, provider use and publication are rejected.

Inventory uses the shared account. An entry is managed only when its sandbox ID and name match a recorded manager task; labels alone cannot promote an unrelated sandbox. External sandboxes are read-only. A developer may stop/delete a colleague's managed sandbox only after confirming the displayed owner and current resource revision. This delegates cleanup and fences stale reports; it never grants access to the colleague's personal model connection. Stop leaves resources reserved; explicitly delete to confirm cleanup and release them. Stale inventory is labelled with its last-seen time; missing/failed inventory is not a claim of deletion.

Admission is coordinated by a single Durable Object for this shared pilot account. One active parent per developer includes descendants awaiting cleanup; one active inner fixture per parent. The parent caps total jobs, overlapping sandboxes and wall-clock lifetime; children cannot extend them. There are no provider attempts. The UI's fixture request uses a 5-minute parent, 60-second job, 3 total jobs, 2 overlapping sandboxes, zero model calls. These are configurable finite safety limits, **not a measured performance SLA**. The qualified image is pinned to `dad882b3-a047-4715-8713-bddec50bb7ca`, 1 CPU / 1 GiB / 3 GiB; mismatched resources fail closed. The runner confirms private visibility, blocked networking and a finite remote expiry before hydrating files. A hard Daytona TTL adds one minute beyond the job's rounded minute ceiling for retention/cleanup. It is never extended automatically.

Cancel fences the complete selected descendant tree before cleanup. Known outputs are retained before deletion, including cancelled work. An unconfirmed create, execute, retention or delete keeps its journal/reservation until the same outcome is reconciled; it never creates a replacement ID or repeats uncertain execution. Polling/retrieving an existing result is not a new model/job attempt. Jobs already running can finish within remote limits while the manager is unavailable; no new work launches without an authenticated poll. Retention cannot outlive a hard platform TTL if both the host and storage stay unavailable; unavailable results remain a visible failure rather than invented success.

The small authenticated client is suitable for an authorized chat executor on the same Mac:

```sh
npm run manager:client -- status
npm run manager:client -- submit /absolute/path/to/fixture-request.json
npm run manager:client -- cancel TASK_UUID
```

See [the protocol contract](../../contracts/DEV_MANAGER.md). Requests and status use the same hosted boundary as the website. This is not a registered Codex tool or native chat steering integration. `steer` and `publish` are unsupported until their later packages.

Optional configuration: `GAMEVERSE_MANAGER_DIR` isolates installation state; `GAMEVERSE_MANAGER_SOURCE_COMMIT` pins a validated 40-character source commit; `GAMEVERSE_MANAGER_SNAPSHOT` selects an explicitly qualified snapshot. Production server is fixed to `https://gameverse.build`. Loopback HTTP server overrides require `GAMEVERSE_MANAGER_ALLOW_HTTP=1` and are for isolated qualification only. The browser uses port 4177; changing `GAMEVERSE_MANAGER_PORT` requires a matching browser endpoint change, with no automatic discovery/scan. Day-to-day use should keep the default.

## Verification and known gaps

`npm run test:manager` runs targeted protocol, protected state, lifecycle, uncertainty and actual workerd SQLite/R2 checks without provider calls or a real Daytona allocation. It reuses Node and Wrangler; no dependency, CI job or broad matrix was added. It costs a few seconds on the measured image. `tests/dev-manager/manual/browser.mjs` is a separately triggered Chromium fixture, expects the private synthetic backend on port 8787 and reuses the image's browser. Never deploy its test login/inspection entrypoint or expose its backend as a production service.

Implementation source edits, builds, Node/workerd tests, Chromium proof and independent fixture verification were executed in Daytona. A Mac control-plane smoke held the Daytona credential and ran the exact cloud-authored manager; the fixture sandbox received only public fixed files. That control process is not a laptop game/coding executor. Qualification used a private workerd/R2 emulator on Daytona, not deployed Cloudflare. See [the retained report](SANDBOX_MANAGER_QUALIFICATION.md).

The remote Chromium check covers manual discovery, HTTPS-page-to-loopback access, code entry, pairing after reload, read-only external inventory and launch enablement. It uses an ephemeral self-signed fixture gateway with a certificate trust override. Real macOS Chrome/Safari permission prompts and the deployed production origin still need hands-on qualification after deployment approval. No claim of Safari compatibility, hosted Codex eligibility, real inference, remote gameplay or the B → B′ → B″ scenario follows from this slice.
