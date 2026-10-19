# Manager deletion-race correction — 2026-10-19

The private lifecycle E2E on PR #26 exposed a successful task displaying `sandbox_identity_mismatch` despite retained results and confirmed cleanup. The correction is implemented and qualified at `0f3dc9b3a331b5fe199448526744a97bcec47c72`. This receipt is a subsequent documentation-only change.

## Cause and correction

Daytona may rename a sandbox to `DESTROYED_<original-name>_<timestamp>` while its immutable ID still returns a `destroying` or `destroyed` record. The runner rechecked the original name on each cleanup poll, caught that expected lifecycle rename as an identity failure, and carried the error into its final successful report. The focused probe reproduced this with the same ID and unchanged owner/task/scope labels; both local and hosted reasons were initially empty. It also showed that the error could overwrite the reason for a real worker failure.

The runner now validates the active sandbox as before and persists its immutable deletion target before requesting deletion. During subsequent cleanup, that same target in `destroying`/`destroyed` state is only observed until its ID is absent. It is not downloaded from, executed in or deleted again. The target survives a manager restart, including delegated cleanup where the hosted task already knows the sandbox ID. A present `destroyed` metadata record no longer counts as confirmed absence.

This does not suppress or clear arbitrary errors. Unexpected active names/owners, unsolicited renamed resources without a recorded deletion intent, and a different returned resource ID still fail closed and keep admission reserved. A real worker failure retains its original reason through cleanup.

## Deterministic verification in Daytona

`node --test --test-name-pattern='asynchronous deletion' tests/dev-manager/runner.test.js` first reproduced the exact false terminal reason on the old source. The original minimal case failed twice, with a 271 ms test-process sample; the same case passed after correction in 206 ms. These measure a tight feedback loop, not production job throughput.

Seven new regression cases exercise delayed `destroying` and `destroyed` metadata through restart, no premature admission release, exactly one deletion/worker/verifier, preservation of real worker failure, and rejected name/owner/unsolicited-tombstone/different-ID cases. The full affected manager suite passed **40/40**, including real workerd SQLite/R2 and CLI shutdown checks, in **6,089 ms** process wall time. A clean frontend build for the browser E2E passed in **202 ms**. No dependency, CI job, polling interval or model stage was added; unrelated hosting/game campaigns were not repeated.

## Real private E2E on the corrected source

The strengthened scenario explicitly requires an empty terminal reason, in addition to its previous lifecycle assertions:

| Scenario | Task | Real private Daytona worker | Result |
| --- | --- | --- | --- |
| Crash after remote execution, then restart | `2e4a65e6-b02e-4ec4-a120-752b74bfc235` | `6404db7e-7ef9-40d5-9014-38c82908aeff` | succeeded; same installation/task/sandbox; one worker and one verifier; no false reason |
| Owner cancellation after output | `6ffa7e64-1cc7-4081-9722-e513f3e5e6d9` | `8a33094c-72ad-4469-9783-406ece791634` | cancelled; source/result retained; no verifier; no false reason |
| Declined then accepted colleague deletion | `3f231a61-bc12-4494-a8cf-2ba6bcb34456` | `1920d355-7648-4eac-80c7-28e9cd7184a8` | decline sent no management request; accept delegated actual cleanup; stale original manager fenced; no false reason |

All six source/result files were downloaded and SHA-256 checked with both managers stopped. After application cleanup, separate Daytona API reads returned all three worker IDs absent; those observations were returned to and asserted in Daytona at 15:47:36 UTC. The final rendered account screenshot shows success/cleanup without the prior error.

The prior three-job E2E took **61,076 ms**; this run took **68,709 ms** using the same fixture, pinned image/resources, synthetic identities, Chromium, private workerd backend and fault-hold plan. Each is one sample, including startup and deliberate transport holds; the difference is not an SLA or a measured throughput regression. Correctness now requires actual ID absence and can take additional existing cleanup polls. A controlled production deletion-latency baseline is unavailable.

Available nested runner timings were: recovery total 12,858 ms, provisioning 1,581 ms and verification 156 ms; owner cancellation total 7,403 ms, provisioning 1,348 ms and gated execute response 288 ms; delegated cleanup 8,085 ms for cleanup only, not the entire B job. Recovery execution duration is unavailable because its response was deliberately lost, not zero. These stages overlap the E2E and are not added to its wall time. Queue/dependency setup and CI timings were not separately measured. Exact source/config, timestamps, toolchain and digests remain in retained `proof.json`, `checks.json`, `host-events.json`, logs and source manifest.

## Execution and remaining boundaries

All source edits, regression tests, code assertions, fixture execution, independent verifier execution and browser automation ran in the private Daytona coding sandbox `e21de53b-06f7-4150-ba6b-db29bae033ca`. macOS ran only the intended credential-holding manager controls and transport. Daytona management keys and manager private installation keys were not hydrated into the sandbox.

The coding/backend sandbox used the pinned snapshot `dad882b3-a047-4715-8713-bddec50bb7ca`, 1 CPU / 1 GiB / 3 GiB, private visibility and a fixed 60-minute TTL. Its three worker sandboxes used the same resources, blocked networking and approximately two-minute hard TTLs; they were explicitly deleted without TTL extensions. The two synthetic Mac managers exited, and their test-only installation state is removed after qualification. The coding/backend sandbox is deleted after retaining this source and evidence.

The backend was private workerd SQLite and an R2 emulator, not a deployed Cloudflare service. Chromium used synthetic `https://gameverse.build:7443` with an ephemeral certificate trust override and a relay to the real Mac manager health endpoint. This does not qualify real macOS browser permissions or production deployment. Codex authentication/coding, soccer gameplay and B → B′ → B″ remain later-package gates. No provider/model calls, merge or deployment occurred.
