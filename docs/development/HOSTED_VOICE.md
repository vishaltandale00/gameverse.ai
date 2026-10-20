# Hosted voice slice

Issue #21 H0–H3. See [the contract](../../contracts/HOSTED_VOICE.md) for authority, identity, credentials and recovery. Existing developer-manager operation remains in [SANDBOX_MANAGER.md](SANDBOX_MANAGER.md).

## Player flow

Sign into an admitted Gameverse account. Voice and simulated-player takeover are provided by Gameverse; no player API key or local manager is needed. Personal agent connections in Account are for separate coding work. This 2026-10-20 decision supersedes the earlier player-funded voice setup.

Open soccer, deliberately record a request, and let the cloud VoiceAgent request a takeover of that exact browser match. The browser acknowledges and runs the simulated-user controls. Watch the match; Stop immediately releases its controls even if the backend is offline. Normal keyboard/controller play resumes. Construction/checkpoint updates are the next slice, not enabled here.

## Operator configuration

Build the exact committed source with `npm run build` in Daytona. The build packages pinned voice code and the matching soccer artifact. Deploying the Worker/bindings/assets and enabling the feature are separate approval/qualification steps; this implementation does not deploy them.

The new `HOSTED_VOICE` SQLite Durable Object binding/migration supplements the existing account credential vault, private `ARTIFACTS` R2 and Daytona platform credential. Configure `HOSTED_VOICE_CREDENTIALS=application` (the default) and the dedicated `VOICE_OPENAI_API_KEY` server secret. The key must support configured transcription/Decisions/reflection services. Keep it out of Daytona sandboxes and client assets. A generic `OPENAI_API_KEY` or personal key is never a fallback. Legacy account-funded qualification requires explicit `HOSTED_VOICE_CREDENTIALS=account`; those personal keys stay encrypted in account storage. The existing developer voice pilot can still use its explicit operator-key configuration while the hosted flag is off.

Set `HOSTED_VOICE_ENABLED=1` only after supported backend egress and qualification. A missing/invalid policy fails closed. Example **synthetic qualification policy**, not a production allowance or SLA:

```json
{"wall_ms":120000,"model_calls":30,"account_active":1,"platform_active":2,"daily_jobs":3}
```

Store that JSON in `HOSTED_VOICE_POLICY`. Production compute charging/allowance and first provider/model entitlement coverage remain product decisions. Calls, finite wall time, active capacity and daily admission are enforced independently. Defaults for existing planner/Decisions/reflection configuration are reused; this slice adds no provider/model migration or silent fallback.

The broker origin defaults to `https://gameverse.build`. Production workers cannot be redirected to arbitrary origins; only isolated `APP_ENV=test` fixtures permit loopback broker/Daytona endpoints. `HOSTED_VOICE_SYNTHETIC=1` is confined to synthetic test configuration; never use test entrypoints or synthetic login/provider injection in deployments.

A fixed 1 CPU/1 GiB private voice worker is distinct from the larger browser qualification machine. An online browser polls its own cloud state and acknowledges commands; cloud alarms advance dispatch/recovery without that polling or a developer manager. Release packages and source/result receipts remain private and content-addressed after cleanup. Uncertain creation remains reserved until its identity/outcome is reconciled; elapsed time alone is not cleanup evidence.

## Checks and cost

No new dependencies, CI jobs or provider/game matrices. `npm run test:manager` includes focused policy/core/dispatch tests and actual workerd account/voice checks. `npm run test:hosting` includes the existing encrypted-vault lifecycle with API-key concurrency/rotation checks. Use the existing browser/voice test files for the shared control boundary. Unit checks are subsecond and the new isolated workerd scenario takes seconds; real provisioning/provider costs require separate measurements.

After a build, the separately triggered rendered check is:

```sh
GAMEVERSE_VOICE_EVIDENCE_DIR=/private/evidence/path node --expose-gc tests/dev-manager/manual/browser-hosted-voice.mjs
```

Run it in Daytona with existing Chromium. It uses a private synthetic TLS/account/provider/Daytona API fixture, the actual cloud dispatcher, and an actual fixed voice worker in another Node process. It drives ordinary API-key setup, recording, transcription/tool acknowledgment, an accepted Decisions-backed control action, pending-decision Stop with blocked backend requests, late-result rejection, human movement and confirmed fixture cleanup. It is not a separate-sandbox/real-provider test. Synthetic fixture entrypoints are never deployed.

Private evidence retains original audio metadata, worker/host lineage, control/model usage, frame progress, Stop timing, browser view, failures and cleanup receipts. Queue/provisioning/build/simulation/model/cleanup intervals remain separate; unavailable provider billing and hosted CI metrics are not zero.
