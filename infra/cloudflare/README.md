# Cloudflare staging foundation

This increment provides a staging administration API backed by a SQLite Durable Object per project and a private R2 bucket. It does not expose the game frontend, implement player login, dispatch Daytona jobs, accept candidates or activate game versions. It leaves the existing local development server intact. Architecture and pricing: [hosting plan](../../plans/HOSTING.md).

## Setup status (2026-10-17)

The staging R2 bucket has been created and its public r2.dev URL is confirmed disabled. Five local workerd checks passed (1,122.59 ms total runner time), including persistence after a runtime restart. The Worker dry run passed with a 6.62 KiB upload / 2.56 KiB gzip bundle. There is no earlier comparable baseline, native build/improvement timing or CI timing for this increment.

Staging is deployed at [the Worker health endpoint](https://gameverse-host-staging.gameverse-environment.workers.dev/health), version `a58ac505-1140-48a0-b1a2-87664cc1843a`. Four live checks passed across 15 HTTP requests in 1,506.76 ms: authentication, secret-binding presence/disabled dispatch, durable idempotent project creation, and private digest-addressed R2 round trips with project isolation. Both credential bindings were independently listed as `secret_text`. The first rejected Free-plan upload is retained as history; deployment succeeded after the user enabled Workers Paid.

[Sanitized deployment evidence](../../verification/cloudflare-staging-20261017.json) records source digests, version, checks, timing and evidence limits. Remote object eviction was not forced; restart persistence was tested locally. No Daytona job, model call, player login, game frontend, candidate activation or native gameplay is claimed.

## Resources and access

- Worker: `gameverse-host-staging`, configured in [wrangler.staging.jsonc](../../wrangler.staging.jsonc).
- Object class/binding: `ProjectState` / `PROJECTS`, with the `v1` SQLite migration.
- R2: `gameverse-artifacts-staging`, Standard storage with an Eastern North America location hint. Public bucket access stays disabled; no custom domain is attached.
- Secrets: `STAGING_API_TOKEN` and `DAYTONA_API_KEY`. No model credential, AWS credential or local provider data is uploaded.
- Staging administration uses one operator token. It is not multi-user authorization: possession of this token grants access to every staging project. Do not give it to players or sandbox code. End-user membership/login checks must be implemented before opening project APIs to players.

The Worker receives requests over its staging workers.dev hostname. Only `/health` is public. It reports liveness, not storage/provider readiness. All `/api/admin/*` routes require `Authorization: Bearer <STAGING_API_TOKEN>`; supplied browser origins must match. Unrecognized routes do not serve files from the checkout.

## Commands

```sh
npm ci --ignore-scripts
npx wrangler login
npx wrangler whoami
npm run test:hosting
npm run infra:check
```

`test:hosting` uses the pinned Wrangler/workerd runtime and local SQLite/R2 with fixture credentials and temporary storage; it does not call Daytona or model APIs. It also stops/restarts the local runtime to check persistence. It is separate from the routine test glob, and no CI job was added. `infra:check` bundles only the Worker and performs a deployment dry run. It does not build the browser app or native games.

For local manual development, keep `DAYTONA_API_KEY` in the ignored root `.env` and add a random, at least 32-character `STAGING_API_TOKEN` there, then run `npm run infra:dev`. Local emulation uses `.wrangler/` storage and never the remote bucket (`remote:false`). The test command suppresses dotenv loading so actual credentials are not part of its fixtures.

## Account provisioning and deployment

The modeled deployment requires Workers Paid and R2 enabled. Cloudflare OAuth login alone does not enable either service. Workers Free rejects the custom CPU limit with code `100328`; R2 returns `10042` until enabled. Account billing choices belong in the Cloudflare dashboard. Local tests and dry-run bundling work before the account is ready.

Inspect existing resources before creating the bucket:

```sh
npx wrangler r2 bucket list
npx wrangler r2 bucket create gameverse-artifacts-staging --location enam
npx wrangler r2 bucket dev-url get gameverse-artifacts-staging
```

Prepare only the two required deployment secrets, then deploy after authorization:

```sh
npm run infra:secrets
npx wrangler deploy --config wrangler.staging.jsonc --secrets-file local-data/hosting/staging-secrets.json
npm run infra:smoke -- https://gameverse-host-staging.YOUR-SUBDOMAIN.workers.dev
```

`infra:secrets` reads only the needed Daytona key from `.env`, generates an operator token once, and retains it in the ignored `local-data/hosting/staging-secrets.json` with mode 0600. Re-running preserves the operator token and refreshes the Daytona key from `.env`. It prints names/path, never values. The explicit secrets file prevents bulk-uploading unrelated `.env` credentials. Wrangler logs and generated bundles are ignored; do not enable unsanitized debug logging around deployment secrets.

`infra:smoke` reads that operator token without displaying it and performs real authenticated HTTP/SQLite/R2 checks using a small public text fixture. It retains two fixture projects and one 64-byte object, plus an ignored receipt at `local-data/hosting/staging-smoke.json`. It makes no Daytona/model call. The receipt records exact source-file digests, the checkout commit, request count, observed wall time and evidence limits; a dirty checkout's commit alone is not an exact implementation identity.

Secrets are account/environment-specific. Restore the ignored operator token from your secret manager when deploying from another machine, or deliberately rotate it; never use `DAYTONA_API_KEY` as the operator token. Later production configuration must have separate names, buckets, object namespace and secrets. This repository currently defines staging only.

## Bootstrap API

| Method and path | Behavior |
| --- | --- |
| GET `/health` | Public Worker liveness |
| GET `/api/admin/status` | Binding types, presence of Daytona key, and honest disabled dispatch/player-auth state; no credential values |
| PUT `/api/admin/projects/{uuid}` | Empty-body, idempotent create; accepted version starts null |
| GET `/api/admin/projects/{uuid}` | Persisted project record or 404 |
| PUT `/api/admin/projects/{uuid}/objects/{sha256}` | Digest-checked immutable upload, at most 1 MiB, for an existing project |
| GET or HEAD `/api/admin/projects/{uuid}/objects/{sha256}` | Private attachment download/head within that project |

The UUID and digest syntax is strict. Retries return the existing project/object; no arbitrary metadata, source execution, accepted-version mutation or public object listing is supported. The 1 MiB object cap and 100 ms configured Worker CPU cap bound this staging bootstrap, not a measured production throughput or game-upload allowance. Native source/artifact transfer, per-user quotas, job deadlines and global admission still need their own implementation.

## Next integration

Connect a durable request and prepared Daytona job to the existing public reference fixture, authenticated callbacks, immutable result uploads and candidate receipts. Reuse the existing [improvement API](../../contracts/IMPROVEMENT_API.md) and Shishir's harness. Keep external attempt/provider identities and recovery deadlines in durable state before side effects. Qualify cancellation, uncertain launch recovery, cleanup and two reconstructed runs before enabling job admission. Accepted-game activation remains a separate host-owned gate.
