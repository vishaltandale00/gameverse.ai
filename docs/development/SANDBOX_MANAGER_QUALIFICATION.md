# Packages 0–2 qualification — 2026-10-19

This is an implementation receipt for issue #21, not a production release. Base `6dc3a480c254b9a07ba6979ada68bc9ec992539f` remained current `main` at the final remote check. All application source editing, code/build verification, workerd storage tests and rendered Chromium qualification ran in Daytona. The exact remotely authored manager additionally ran as a credential-holding **control plane** on macOS; fixed source execution and independent verification ran in fresh Daytona workers. No game/coding/test runtime moved to the Mac.

## Scope and result

Delivered: manual repo startup, explicit loopback discovery, account-bound persistent/revocable pairing, shared inventory, external read-only controls, confirmed cross-owner stop/delete, typed fixture submission/client, shared parent admission, finite resource/deadline guards, descendant cancellation, recoverable command journal, private cloud result retention and confirmed cleanup. Existing personal Claude/API-key flows are reused unchanged. Codex authentication, arbitrary coding, native chat steering, remote gameplay/A/V, the authored-soccer seam and draft-PR publication remain packages 3–6.

The hosted implementation was qualified using a **private workerd SQLite/R2 emulator inside Daytona**, with synthetic developer identities and no SMS, model or provider credentials. Cloudflare production/staging was not deployed or modified. Production developer accounts cannot use this backend until deployment is authorized. The synthetic fixture's login/inspection routes must never be deployed.

## Verification receipts

| Check | Observed result |
| --- | --- |
| Final manager suite | **23/23 pass**, 5,419 ms Node runner wall time |
| Affected existing hosting suite | **29/29 pass**, 13,171 ms Node runner wall time; 13,256 ms including process startup |
| Frontend build | Pass; final incremental process wall time 206 ms |
| Worker dry run | Pass after the final delegated-retention change; preceding measured process wall time 1,540 ms (latest rerun duration unavailable) |
| Whitespace/diff validation | Pass in Daytona |
| Remote Chromium | Manual discovery only, HTTPS→loopback, pairing/code entry, pairing after reload, read-only external inventory and launch enablement pass; complete account screenshot retained |
| Real fixture 1 | Succeeded, retained source/result retrieved and digest checked, deletion confirmed; 10,283 ms total |
| Real fixture 2, guarded controller | Succeeded after manager restart with the same pairing and no new code; final privacy/network/expiry guard passed, independent verification passed, both artifacts retained/retrieved, deletion confirmed; 11,234 ms total |

The final manager tests cover wrong account/expired code/revocation and re-pairing, signature tampering/replay, real workerd restart persistence, private artifact access, finite typed limits, shared parent/inner admission, outstanding-child cleanup reservations, lost create/execute/report responses and restart without duplicate execution, offline admission, retention outage, cross-owner stop/delete delegation with stale-report fencing, cancellation before execution, cancellation after execution but before collection, and missing remote hard-expiry refusal, and retaining completed output for the original owner during confirmed cross-owner deletion.

Real fixture IDs and observed timings:

| Task / sandbox | Provision interval | Execution API interval | Independent verification API interval | Total observed lifecycle |
| --- | ---: | ---: | ---: | ---: |
| `492d311d-d311-491f-825c-5ce1b4cd153f` / `56cba444-93f4-4481-a7de-e8a2c7f21a5e` | 1,374 ms | 85 ms | 62 ms | 10,283 ms |
| `98efc3bc-a080-4bab-a403-c3e6e38b99fd` / `8a428887-e01a-4e6f-862b-385a8ccdf384` | 1,777 ms | 130 ms | 317 ms | 11,234 ms |

Both were fresh 1 CPU / 1 GiB / 3 GiB sandboxes on snapshot `dad882b3-a047-4715-8713-bddec50bb7ca`, requested as private, with blocked networking, a finite two-minute hard expiry and **zero model calls**. The final run confirmed these settings before hydration. The final runner additionally rejects absent/nonfinite/out-of-policy expiry or unconfirmed privacy/network isolation before hydration. These were two bounded qualification requests against successively reviewed code, not an automatic retry of a failed provider/infrastructure job. Both sandbox IDs were independently absent at `2026-10-19T04:34:10.990Z`.

The guarded fixture control-source archive SHA-256 was `b559778a5f95801b3379cec160795d654ec1d1061e09fd7ae630b6aedbe8c427`. It is the exact remote-authored CLI, adapter, runner and fixed verifier used for the second real fixture. Fixed source SHA-256 was `4a381860447226426a116b024081641b32f9b6c4f7c2c5d3cb86987e85c8ae33`; final result SHA-256 was `8b45d639b95929d4dc13d9b49ecd7786e7885d83e67c60b81c9dc3d1ae661554`. The request's source commit identifies the base; the archive digest identifies the new control implementation. The subsequent delegated-retention fix broadens cleanup output harvesting and grants artifact retention only to the explicitly confirmed cleanup manager; its focused real-workerd/runner regression suite passed 23/23. It did not trigger another cloud allocation. Review the retained final Git bundle/commit and patch for that complete change, docs and tests.

## Comparable build sample and cost

A clean-output baseline checkout and candidate used the same installed dependencies, Node v25.9.0, Linux x64, the same 1 CPU / 1 GiB / 3 GiB coding sandbox and warmed filesystem. No build-result cache was used. Baseline build process: **225 ms**; candidate: **190 ms**. This single sample does not establish a speed improvement or SLA. Later final incremental build was 206 ms and is not compared as another clean build. The original initial-output build was 210 ms; keep that separately rather than averaging mixed modes.

The new targeted suite adds about 5–6 seconds when explicitly run on this image. No dependencies, CI jobs or broad campaigns were added. CI queue/job/critical-path measurements are unavailable because no CI run was dispatched. Build measurements exclude queueing and dependency setup. The initial unmodified hosting baseline had a workerd proxy `Network connection lost` failure (25 pass / 4 fail, 12,746 ms); its affected five-test file passed on a bounded recheck. That failed receipt is retained. The changed branch's complete affected 29-test run passed.

Real total lifecycle time includes polling, provisioning, fixed-file transfer, execution, verification, retention and cleanup; it excludes time waiting for command pickup before the local journal entry. The API execution intervals include network overhead and contain the worker's own timestamps. These intervals overlap and must not be summed with total time. Dedicated queue/hydration/retention/cleanup breakdowns are **unavailable**, not zero. No game build/simulation/evaluation, provider latency, cost or full improvement-loop timing has been measured by this slice.

## Evidence boundaries and follow-up

The remote browser used Chromium, viewport 1280×1000, an ephemeral self-signed HTTPS gateway at `https://gameverse.build:7443`, and a certificate trust override. It proves the implemented interaction and HTTPS-to-loopback behavior in that environment. It does not prove real macOS Chrome/Safari local-network permission prompts or the deployed public origin. That hands-on browser gate remains after deployment approval; Safari is not certified.

One final browser attempt failed because the matched clean build had replaced the asset directory under the already-running Wrangler server, which then returned HTTP 500 for static assets. Restarting only that private fixture server preserved its task/pairing/R2 state, and the browser qualification passed. Earlier failed/superseded checks remain in the retained evidence rather than being overwritten as successes.

The coding sandbox was separately capped at 60 minutes; Daytona reported `autoDestroyAt: 2026-10-19T05:00:26.094Z`. Source and evidence are exported before explicit cleanup; neither its TTL nor a job TTL is extended. [Daytona lifecycle semantics](https://www.daytona.io/docs/en/sandboxes/) and [port-scoped preview semantics](https://www.daytona.io/docs/en/preview/) were checked against current primary documentation. No sandbox-wide preview credential, Daytona management credential or personal auth cache is included in source, Worker state, browser responses or worker inputs.

Next gates are review/deployment approval and hands-on macOS browser qualification, then package 3's supported personal Codex route and refresh custody. Do not claim Codex, a remote game session, the soccer B→B′→B″ scenario or automatic PR publication from these receipts.
