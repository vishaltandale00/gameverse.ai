# Hosted API-key voice qualification

Date: 2026-10-20. Issue #21 H0–H3. Implementation commit: `3d6ec2a31b158745cc6cb36e2e0a6a77a483de6b`, branch `codex/hosted-api-key-voice`. Base voice implementation: `fc82b395ced63b972ed77ac7494b381266c87ef3`. Main was independently read at `6dc3a480c254b9a07ba6979ada68bc9ec992539f` and is an ancestor. This report is a documentation-only follow-up to that tested implementation.

## Outcome and boundary

The ordinary API-key route is implemented and passed private synthetic qualification. The browser game, cloud-owned admission/recovery, account credential broker and actual fixed Daytona-targeted VoiceAgent worker process work together without a developer manager. **Real separate-sandbox/real-provider acceptance remains blocked by backend egress.** Nothing was pushed, deployed or enabled on `gameverse.build` by this task. Default hosted enablement remains off; explicit policy is required. Existing pilot phone admission remains separate from developer permissions.

All application source edits, builds, Node/workerd tests, Chromium execution and assertions ran in one private Daytona implementation sandbox (`2cb2043a-f2ee-44e6-a848-9c21ed8da704`), 2 CPU / 4 GiB RAM / 8 GiB disk, Node 25.9.0, Linux. Its original 60-minute hard TTL was never extended. macOS held the existing Daytona management credential and performed control-plane transport and artifact retention only. No user provider key was uploaded to the implementation sandbox; keys used by fixtures are explicitly public synthetic values. No external model calls occurred.

## Checks

| Check | Result | Measured wall time / context |
| --- | --- | --- |
| Existing manager plus new hosted/core/worker checks | 63/63 passed | 27.958 s; overlapped the separately triggered renderer run, so not comparable with an isolated smaller suite |
| Affected browser/voice/agent/Stop contracts | 70/70 passed | 1.674 s; includes spectator-camera authority and late-action/hidden/expired/failed-game cases |
| Hosting/account/vault/phone regressions | 30/30 passed | 8.437 s; includes API-key concurrent services without rotating-auth lease, rotation/disconnect and restart |
| Browser build | Passed | Clean `dist`, installed dependency cache; pinned worker package included |
| Worker dry-run bundle and `git diff --check` | Passed | No deployment or new routine CI job |

There are **163 distinct focused tests**; reruns of affected cases are not added to that count. No dependencies, game/provider matrix or routine paid evaluation were added. New tests cover account-scoped admission, exact release binding, missing key/operator-fallback rejection, cross-account resource IDs, provider reservations, in-flight key rotation, cloud recovery/cleanup without manager polls, uncertain create/execute/delete responses, failed retention, malformed receipts, private artifact access and the fixed worker's smaller admitted attempt cap.

The first rendered hosted run exposed dispatch starvation: each browser heartbeat reset the recovery alarm to a later time. A targeted real-workerd loop polling every 100 ms failed with zero dispatches before the change and passed after scheduling preserved the earlier alarm. This regression is retained in `hosted-voice-workerd.test.js`; no manual tick is used for its dispatch or final cleanup assertions.

## Rendered ordinary-player proof

`tests/dev-manager/manual/browser-hosted-voice.mjs` ran against the actual Worker/SQLite/private-R2 route with synthetic account login, provider responses and Daytona HTTP transport. The ordinary account was not a developer and had no paired manager. Its API key was entered through the account UI. The actual cloud dispatcher uploaded the fixed package and started the actual worker in a separate Node process. The browser used Chromium with software ANGLE/SwiftShader in the same implementation sandbox.

On implementation source `3d6ec2a31b158745cc6cb36e2e0a6a77a483de6b`, request/task `86fa86c2-9022-4c77-9baf-6b984659c6a3`:

- Actual MediaRecorder output, **4,141 bytes**, was stored/retrieved with matching SHA-256 `6cf62842b31474929cebd7cc2dbe66a4fb9626fe155ec0427807b53cff3b9a5f`. ASR returned a scripted transcript; this does not prove recognition accuracy.
- The actual VoiceAgent planned and received browser acknowledgments for `open_session` and `start_simulated_user` on the exact soccer session.
- The game clock advanced and two actual controller actions were dispatched. The harness's retained action log includes an accepted Decisions-backed action, beyond the built-in match-start action. The provider was scripted, not an external model.
- While another decision was outstanding, browser backend fetches were blocked. Visible Stop revoked the grant and progress writer in **2 ms**. Late work could not increase the action count, and ordinary human keyboard input moved the player afterward.
- Private source/result receipts were downloaded through the account-authenticated, digest-checking artifact route. The dispatcher performed one create and one execution, retained outputs, and confirmed fixture deletion. The real worker process, browser and local fixture backend exited. This is **fixture cleanup**, not a claimed real voice-container deletion.
- Total scenario wall time was **20.746 s**, including account/profile setup, recorded audio, cloud dispatch, scripted services, takeover, Stop, handback and fixture retention/cleanup. Parent/child/provider intervals overlap and are not summed as independent work.

An earlier baseline browser journey on `fc82b39` passed in 15.279 s, and an earlier hosted-development journey passed in 28.048 s. Their paths/source/package identities differ; these are not performance comparisons. The old 1 GiB renderer frame stall did not recur in the bounded 2 CPU/4 GiB soccer proofs. Its earlier cause remains unproven; these fixtures do not qualify production neighborhood navigation, every renderer or unattended/background gameplay. Rendered camera movement was not separately measured; authority isolation is covered by the focused tests.

## Real connectivity gate

A fresh direct probe from the implementation sandbox to `https://gameverse.build/health` reset before HTTP (`ECONNRESET`, approximately 36 ms); GitHub and npm returned 200. This matches the previous voice slice's backend-egress failure. That earlier sandbox allow-list override was rejected by organization policy; exact current organization tier remains unknown. No organization policy, billing tier or network configuration was changed here.

Do not treat the synthetic Daytona transport as a real second container, or zero-model fixtures as real inference. Supported sandbox-to-backend egress is required before the actual separate-sandbox preflight and bounded account-key ASR/planner/gameplay qualification. No additional voice worker was allocated after the failed preflight. A developer-Mac relay is not the fully hosted route and was not introduced as a workaround.

## Turnaround and retention

One matched clean-build pair in the same 2 CPU/4 GiB sandbox, with installed dependency cache and no renderer at build start, measured **41.2 ms before → 75.7 ms after**. The added output is a roughly 28 KiB pinned worker release with three Git-object reads and hashes. A single subsecond pair is noisy and establishes neither an SLA nor an optimization claim. Provider latency/billing, hosted CI queue/job/critical-path time and public throughput remain unavailable; they are not recorded as zero.

The private evidence set includes the exact-source rendered report, screenshot, original recorded audio, filtered source/result receipts, targeted red/green failure, successful/failed run logs and a machine-readable qualification summary. It excludes private keys, cookies, launch capabilities, worker auth files and raw persistent credential stores. A Git bundle preserves the remotely authored commits. The task's final response records confirmed deletion of the implementation sandbox after export. Production per-account compute allowance/charging, supported model entitlement coverage and public rollout remain separate decisions/gates.
