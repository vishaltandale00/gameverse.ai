# Browser voice slice qualification

Date: 2026-10-19. Implementation source: `cbcf5856124463e73bbb53191914eab46643ccf1`. Branch: `codex/daytona-voice-takeover`. Base: `697c6c89049683016c050f6ffd0540643ac3accf` (draft #26). No push, deployment or real provider inference was performed.

## Result

The N0–N2 implementation is present and opt-in; **full browser/separate-sandbox acceptance is not passed**. The default hosted flag remains off. Two gates remain: the organization's outbound-network restriction and a reproducible rendered-engine frame stall in the qualification environment. Do not treat structural worker completion, one successful process test, or the passing unit/API suite as a release gate.

## Passing checks

- 74 affected browser/voice/agent tests, including exact-session tools, duplicate acknowledgments, cancelled sequences, late starts, immediate Stop, hidden/expired leases, failed-game revocation, recording bounds and failure feedback.
- 52 manager tests, including signed workerd/R2 voice admission, scoped worker tokens, account/origin isolation, actual stored-audio digest validation, provider reservations, lost dispatch/verifier responses, cancellation/retention/cleanup, failed worker outcomes, and unavailable-source rejection before allocation.
- 29 existing hosting tests. No new dependency, CI job or broad game matrix.
- Browser build, Cloudflare dry-run bundle and `git diff --check` passed. All code, builds, tests, browser execution and assertions ran in Daytona. macOS held the existing private credentials and ran only the product manager/byte-transport control plane.

The existing test suite was rerun only when source changes or failures justified it. Latest measured affected checks were approximately 1.5 seconds for browser tests and 8.1 seconds for manager tests; the existing hosting run was 11.3 seconds. These cover different cases from the original 40-test manager baseline, so they are not a performance delta.

## Browser evidence and unresolved failure

A process-only test on source `ffc63bd276d719bc4d90882fbaf19dc7202ee02a` passed in 21.485 seconds. It used actual MediaRecorder bytes, SQLite/R2, a signed synthetic manager, the actual VoiceAgent in a separate Node process, and the real soccer engine in Chromium, all in one Daytona sandbox. The provider was explicitly scripted: **zero external model calls**. It acknowledged `open_session` and `start_simulated_user`, advanced real game frames 17 → 71, and dispatched a built-in controller confirm. A gameplay decision was requested through the worker; this does not prove a model decision was accepted for play.

While that decision was pending, the test blocked browser backend fetches, clicked ordinary Stop and observed local release in 1 ms, no later action increase, no progress writer, and real keyboard movement afterward (human KeyD input moved x from -5 to about -4.415). The worker process exited and its fixed-source/result artifacts were retained. This is functional process evidence, **not separate-sandbox E2E or speech recognition accuracy**.

Repeated later browser runs, including fresh/warm profiles and explicit headless foreground flags, did not reproduce a reliable handback pass. A trace showed frame 16 unchanged for over three seconds while `document.hasFocus()` stayed true, visibility stayed normal and the runtime reported unpaused. The existing health watchdog then marked the app game failed before the remote grant. The 1 CPU/1 GiB coding environment also reached its memory ceiling with Chromium/workerd. The exact cause of the animation-frame stall remains unresolved; neither GPU cache nor resource contention alone is proven. A failed app game now explicitly revokes its voice binding, preventing a delayed worker from reviving it. The passing process run predates that final guard; the guard is covered by targeted tests.

The reproducible, separately triggered harness is `tests/dev-manager/manual/browser-voice.mjs`. It uses a soccer-only test collection, a synthetic microphone/provider/account, an ephemeral trusted test certificate, and a synthetic manager; it does not qualify production neighborhood navigation. Run it in an isolated, adequately provisioned Daytona renderer environment and retain failures. It is excluded from routine CI.

## Separate cloud worker attempts

Three real private voice sandboxes were created through the product macOS manager, using 1 CPU/1 GiB/3 GiB each, a 120-second task bound and confirmed three-minute hard TTL. Each reached the fixed worker process but failed before ASR: the worker could not connect to its broker. Their source/result artifacts and original manager records are retained in the private evidence archive. The initial manager incorrectly labeled structural verification as success even though the worker result said failed; this reporting bug was fixed and tested. The old records were preserved, not rewritten as successes.

| Task | Sandbox | Outcome |
| --- | --- | --- |
| `21cba452-6967-44dc-b8ce-4f8bb058be99` | `4bd36a20-7a24-40c2-8996-bf601868328e` | Broker transport failed; output retained; deletion confirmed |
| `e55ad5b9-c461-4dda-8b32-57e2dbd23c65` | `79f27dbe-377d-423c-94f9-4a97962b22c5` | Broker transport failed; output retained; deletion confirmed |
| `2e5a24c4-6217-4cb3-80ca-80cccf87e7d2` | `a3941acf-75c5-4fbe-92dc-1d0fe7456b8b` | Broker transport failed; output retained; deletion confirmed |

Independent control-plane observations on 2026-10-19 confirmed all three sandbox IDs absent; assertions over those observations ran in Daytona. No further cloud worker was allocated after the network restriction was identified.

## Network gate

From Daytona, GitHub and npm returned HTTP 200. `gameverse.build` and the private broker reset connections before HTTP (`ECONNRESET`) despite `networkBlockAll:false`. An exact-domain allow-list update on this task's own coding sandbox returned HTTP 400:

> Network access is restricted and cannot be overridden at the sandbox level.

The API key could not read organization tier metadata (HTTP 403), so no exact tier is claimed. No billing or organization policy was changed. An administrator must provide supported broker egress, or the design must explicitly change to a manager relay. See [Daytona network limits](https://www.daytona.io/docs/en/network-limits/). A different destination hostname is not assumed to bypass this policy.

## Timing and retention

One matched clean-build pair in the same Daytona sandbox measured **207 ms before → 188 ms after**. Both reused the installed dependency cache and rebuilt clean `dist`; neither had a competing renderer. A single subsecond pair is noisy and is not an optimization or SLA claim. CI queue time, external provider latency, production browser latency and full B → B′ → B″ timings are unavailable. Nested provider/game/worker intervals must not be added as independent work.

The coding sandbox had an original, unextended 60-minute hard TTL. Successful, failed, cancelled and inconclusive attempts are retained. Only reports, screenshots, fixed source/result artifacts and diagnostic source are exported; device keys, browser cookies, launch capabilities and TLS private keys are excluded. The final task response records confirmed deletion of the temporary coding sandbox after source/evidence transport.
