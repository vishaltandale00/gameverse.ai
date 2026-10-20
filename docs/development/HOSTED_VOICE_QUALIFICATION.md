# Hosted API-key voice qualification

Date: 2026-10-20. Issue #21 H0–H3. Implementation commit: `e918f82d791304a09560dc0b4d0f6529f223e06a` (initial foundation `3d6ec2a31b158745cc6cb36e2e0a6a77a483de6b`), branch `codex/hosted-api-key-voice`. Base voice implementation: `fc82b395ced63b972ed77ac7494b381266c87ef3`. Main was independently read at `6dc3a480c254b9a07ba6979ada68bc9ec992539f` and is an ancestor. This report is a documentation-only follow-up to that tested implementation.

## Outcome and boundary

The ordinary API-key route is implemented and passed private synthetic qualification. The browser game, cloud-owned admission/recovery, account credential broker and actual fixed Daytona-targeted VoiceAgent worker process work together without a developer manager. **Real separate-sandbox/real-provider acceptance remains blocked by backend egress.** Nothing was pushed, deployed or enabled on `gameverse.build` by this task. Default hosted enablement remains off; explicit policy is required. Existing pilot phone admission remains separate from developer permissions.

All application source edits, builds, Node/workerd tests, Chromium execution and assertions ran in one private Daytona implementation sandbox (`2cb2043a-f2ee-44e6-a848-9c21ed8da704`), 2 CPU / 4 GiB RAM / 8 GiB disk, Node 25.9.0, Linux. Its original 60-minute hard TTL was never extended. macOS held the existing Daytona management credential and performed control-plane transport and artifact retention only. No user provider key was uploaded to the implementation sandbox; keys used by fixtures are explicitly public synthetic values. No external model calls occurred.

## Checks

| Check | Result | Measured wall time / context |
| --- | --- | --- |
| Existing manager plus new hosted/core/worker checks | 64/64 passed | 16.858 s; includes the new hosted integration and audio-reservation cases; different coverage from the initial manager suite |
| Affected browser/voice/agent/Stop contracts | 74/74 passed | 1.676 s; includes spectator-camera authority and late-action/hidden/expired/failed-game cases |
| Hosting/account/vault/phone regressions | 30/30 passed | 8.437 s; includes API-key concurrent services without rotating-auth lease, rotation/disconnect and restart |
| Browser build | Passed | Clean `dist`, installed dependency cache; pinned worker package included |
| Worker dry-run bundle and `git diff --check` | Passed | No deployment or new routine CI job |

There are **168 distinct focused tests**; reruns of affected cases are not added to that count. No dependencies, game/provider matrix or routine paid evaluation were added. New tests cover account-scoped admission, exact release binding, missing key/operator-fallback rejection, cross-account resource IDs, provider reservations, in-flight key rotation, cloud recovery/cleanup without manager polls, uncertain create/execute/delete responses, failed retention, malformed receipts, private artifact access and the fixed worker's smaller admitted attempt cap.

The first rendered hosted run exposed dispatch starvation: each browser heartbeat reset the recovery alarm to a later time. A targeted real-workerd loop polling every 100 ms failed with zero dispatches before the change and passed after scheduling preserved the earlier alarm. The audio hardening additionally reserves pending uploads before R2 I/O and rejects even stored-but-uncommitted audio at the broker. Its real-workerd check failed before the guard and passed afterward. These regressions are retained in `hosted-voice-workerd.test.js`; no manual tick is used for its dispatch or final cleanup assertions.

## Rendered ordinary-player proof

`tests/dev-manager/manual/browser-hosted-voice.mjs` ran against the actual Worker/SQLite/private-R2 route with synthetic account login, provider responses and Daytona HTTP transport. The ordinary account was not a developer and had no paired manager. Its API key was entered through the account UI. The actual cloud dispatcher uploaded the fixed package and started the actual worker in a separate Node process. The browser used Chromium with software ANGLE/SwiftShader in the same implementation sandbox.

On implementation source `e918f82d791304a09560dc0b4d0f6529f223e06a`, request/task `5fff43cb-6580-42d4-ac8a-e6cd50495cf7`:

- Actual MediaRecorder output, **5,787 bytes**, was stored/retrieved with matching SHA-256 `9098010fcf7ab3d2c05e44b76a37ff0694dd059b0eb564ad68e95109d123f711`. ASR returned a scripted transcript; this does not prove recognition accuracy.
- The actual VoiceAgent planned and received browser acknowledgments for `open_session` and `start_simulated_user` on the exact soccer session.
- The game clock advanced from frame 12 to 192 and 2 actual controller actions were dispatched. The harness's retained action log includes an accepted Decisions-backed action, beyond the built-in match-start action. The provider was scripted, not an external model.
- While another decision was outstanding, browser backend fetches were blocked. Visible Stop revoked the grant and progress writer in **2.4 ms**. Late work could not increase the action count, and ordinary human keyboard input moved the player afterward.
- Private source/result receipts were downloaded through the account-authenticated, digest-checking artifact route. The dispatcher performed one create and one execution, retained outputs, and confirmed fixture deletion. The real worker process, browser and local fixture backend exited. This is **fixture cleanup**, not a claimed real voice-container deletion.
- Total scenario wall time was **21.075 s**, including account/profile setup, recorded audio, cloud dispatch, scripted services, takeover, Stop, handback and fixture retention/cleanup. Parent/child/provider intervals overlap and are not summed as independent work.

An earlier baseline browser journey on `fc82b39` passed in 15.279 s, and an earlier hosted-development journey passed in 28.048 s. Their paths/source/package identities differ; these are not performance comparisons. The old 1 GiB renderer frame stall did not recur in the bounded 2 CPU/4 GiB soccer proofs. Its earlier cause remains unproven; these fixtures do not qualify production neighborhood navigation, every renderer or unattended/background gameplay. Rendered camera movement was not separately measured; authority isolation is covered by the focused tests.

## Real connectivity gate

A fresh direct probe from the implementation sandbox to `https://gameverse.build/health` reset before HTTP (`ECONNRESET`, approximately 36 ms); GitHub and npm returned 200. This matches the previous voice slice's backend-egress failure. That earlier sandbox allow-list override was rejected by organization policy; exact current organization tier remains unknown. No organization policy, billing tier or network configuration was changed here.

Do not treat the synthetic Daytona transport as a real second container, or zero-model fixtures as real inference. Supported sandbox-to-backend egress is required before the actual separate-sandbox preflight and bounded account-key ASR/planner/gameplay qualification. No additional voice worker was allocated after the failed preflight. A developer-Mac relay is not the fully hosted route and was not introduced as a workaround.

## Turnaround and retention

One matched clean-build pair in the same 2 CPU/4 GiB sandbox, with installed dependency cache and no renderer at build start, measured **41.2 ms before → 56.4 ms after**. The added output is a roughly 28 KiB pinned worker release with three Git-object reads and hashes. A single subsecond pair is noisy and establishes neither an SLA nor an optimization claim. Provider latency/billing, hosted CI queue/job/critical-path time and public throughput remain unavailable; they are not recorded as zero.

The private evidence set includes the exact-source rendered report, screenshot, original recorded audio, filtered source/result receipts, targeted red/green failure, successful/failed run logs and a machine-readable qualification summary. It excludes private keys, cookies, launch capabilities, worker auth files and raw persistent credential stores. A Git bundle preserves the remotely authored commits. The task's final response records confirmed deletion of the implementation sandbox after export. Production per-account compute allowance/charging, supported model entitlement coverage and public rollout remain separate decisions/gates.

## PR #27 review follow-up, 2026-10-20

Reviewed head `779890976cb66628f566799ca7bfbe8b9b984e62` against its pinned #26 base `697c6c89049683016c050f6ffd0540643ac3accf`. Fixed implementation: `5994ccd60251f377da47d4790d5417cb2c9deedb`; the following report-only commit changes no application source.

The Standards axis identified one P2 maintainability/correctness finding: permanent hosted account history exhausted the live session/request/call limits. No independent hard documented-standard breach was established. The Spec axis identified two P2 findings: the same lifetime lockout, and oversized worker output preventing retained cleanup. Both findings reproduced before the fix. Oversized receipts now remain rejected without repeated downloads. Hosted terminal history moves into per-record private SQLite rows after confirmed cleanup and the deadline plus a 30-second receipt grace period. Revoked/abandoned empty bindings become durable tombstones. Historical request status/artifacts, ID fencing and indexed rolling-daily quota accounting survive restart.

All application edits and verification ran in a new private Daytona sandbox `7b7fb02b-eab6-4fea-98d3-1eb40547a2cd`, 2 CPU / 4 GiB / 8 GiB, Node 25.9.0, with a 60-minute hard TTL. No external model calls, network-policy changes, new dependencies or CI jobs. The four new regression cases cover oversized results during execution/cancellation, over 500 stopped/abandoned bindings, and 260 completed roots with 1,040 audio requests and 2,080 model calls. They verify no permanent lockout, preservation of historical results across restart, duplicate/epoch fences and daily admission that cannot reset through archival. Actual workerd additionally verifies private SQLite archival/restart, owner-only historical status/artifacts, old binding rejection and unchanged daily quota.

| Check | Outcome | Wall time |
| --- | --- | --- |
| Manager/hosted/core/worker | 68/68 passed | 16.533 s |
| Hosting/account/vault | 30/30 passed | 8.105 s |
| Browser/voice/agent/Stop | 74/74 passed | 1.645 s |
| Browser build | Passed, clean dist with installed dependencies | 50.5 ms |
| Worker dry-run and diff check | Passed | No deployment; timing unavailable |
| Rendered hosted fixture | Passed | 18.100 s |

There are 172 distinct focused tests; repeated runs are not added. The rendered fixture uses the same synthetic boundary as the original proof: actual Chromium/Worker/SQLite/R2 and a separate VoiceAgent Node process in the implementation sandbox, with scripted provider responses and synthetic Daytona HTTP transport. Task `9ed7b16e-60a6-41b6-aad0-25c93d065cbd` stored 5,455 bytes of real recorded audio, advanced the game from frame 12 to 244, and dispatched two controller actions including a Decisions-backed action. Stop completed in 1.3 ms with backend fetches blocked and a decision pending; late work did not add actions, and ordinary human input moved the player afterward. Source/result artifacts were owner-readable and fixture deletion was confirmed. This is not a real second voice container or external ASR/model qualification.

The live backend-egress gate above remains unresolved and was not retried through a paid worker allocation. The single new build/scenario sample is not a comparable performance baseline or an SLA; previous samples used different commits/runs. Hosted CI queue/critical-path timing and provider costs remain unavailable. Private export retains exact-source reports, synthetic recorded audio, screenshots, filtered receipts, failed/passing regression logs and a Git bundle; it excludes launch capabilities, TLS keys, cookies and raw credential stores. Confirm deletion of the implementation sandbox by its original ID after export; the final review response records that observation.
