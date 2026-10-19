# PR #26 review and corrections — 2026-10-19

Reviewed the packages 0–2 change at `2d867780701c7111929494b69ae6eda79d719168` against base `6dc3a480c254b9a07ba6979ada68bc9ec992539f`, live issue #21, the scoped manager protocol/plan and `AGENTS.md`. Separate standards and specification reviews inspected and reproduced behavior in Daytona. All application edits, tests, build verification and browser proof for these corrections also ran in Daytona. The existing macOS control process only transported commands/artifacts and held the Daytona management credential.

## Standards

One actionable recovery finding was fixed: the runner previously persisted `executing` before awaiting the `running` report, so a lost report acknowledgment could leave execution permanently unsubmitted. The runner now records an explicit `announcing` state and acknowledgment, then records the execution intent immediately before dispatch. A crash before announcement safely announces first; a lost acknowledgment resumes without repeating source execution. Successful acknowledgment and dispatch stay within the same poll, avoiding an added polling interval.

The review also noted possible scattered lifecycle transitions as a maintainability heuristic, not a documented-rule violation. The correction uses explicit phase/acknowledgment markers and focused boundary tests rather than introducing a speculative orchestration framework. Follow-up standards review found no remaining actionable blocker. No dependency, CI job, matrix or provider/model stage was added.

## Spec

All four specification findings were fixed:

1. **Shutdown and journal ownership:** SIGINT/SIGTERM now request shutdown; the manager drains its awaited operation before closing discovery and releasing the journal lock. Fresh provisioning/execution checks the current shutdown flag. A real CLI subprocess test holds a report response, sends SIGTERM, proves a replacement cannot acquire the lock yet, then releases the response and verifies clean exit with no new Daytona calls.
2. **Registration replay:** possession-proof nonce validation and registration mutation now occur in one synchronous Durable Object call. Replaying a captured registration after five bad pairing codes returns `signature_replayed` without resetting attempts or extending expiry. This is exercised against the actual workerd route and persisted SQLite state.
3. **Partial retention:** cleanup retains validated source independently of final result metadata. Success still requires both source and validated result plus independent verification. Source-only cancellation now uploads that partial source before deletion; failures and cancellation do not become successful verification.
4. **Management context:** normalization preserves creation time across both transport layers. Inventory and cross-owner confirmation expose recorded owner, resources, age, task, parent and state. The browser proof rejects a confirmation without sending a command, then accepts it and verifies the intended delegated cleanup command. Long identifiers wrap at mobile width.

Follow-up specification review found no remaining actionable blocker. Codex consent, arbitrary coding, remote gameplay, soccer revisions and publication remain explicitly deferred.

## Adjacent corrections confirmed during review

- A lost `preparing` report no longer aborts an otherwise valid fixture. A lost independent-verifier response is reconciled from its marker without executing the verifier again.
- A confirmed nonzero worker exit remains failed even if source/result files exist. Its outputs are retained, it is not retried or promoted to success, and its verifier is not run. A before/after negative control reproduced the old false-success outcome and verifies the correction.
- An acknowledged own-manager stop remains quiescent across polling/restart. The runner only observes whether the stopped sandbox still exists; it does not repeat stop commands. Confirmed later absence releases the held reservation.
- If the owner cancels after a colleague has taken over cleanup, cancellation remains routed to that delegated manager. A stale controller cannot re-enter cleanup through a superseded command; the delegated manager is authorized to acknowledge the cancellation.
- `npm run test:manager` now runs in a clean checkout without a prior frontend build. The API test supplies one tiny synthetic asset directory instead of implicitly requiring `dist/`.

## Verification and timing

| Check | Result and observed duration |
| --- | --- |
| Manager checks, with `dist/` absent | **33/33 pass**; latest process wall time 6,391 ms |
| Affected existing hosting checks | **29/29 pass**; 13,803 ms process wall time |
| Matched clean build, baseline PR head | Pass; 233 ms process wall time |
| Matched clean build, corrected branch | Pass; 275 ms process wall time |
| Corrected Worker dry run | Pass; 1,502 ms process wall time |
| Rendered Chromium | Desktop 1280×1000 and mobile 390×844 pass; manual discovery, saved pairing, read-only external inventory, context wrapping, declined/accepted cross-owner confirmation and visible cleanup acknowledgment |
| Diff/whitespace check | Pass in Daytona before commit |

Build samples used the same Linux x64 image, Node v25.9.0, 1 CPU / 1 GiB / 3 GiB coding sandbox, installed locked dependencies, absent output directory and no build-result cache. The 42 ms difference is a single sample and does not establish a regression or SLA. The corrected focused suite costs about seven seconds in this environment. The original clean-checkout manager command failed because its asset directory was missing (3,040 ms); it is retained as a failed baseline and is not compared as a successful throughput sample.

No CI execution was dispatched, so CI queue/job/critical-path durations are unavailable. No new provider, game or physical fixture campaign ran. The prior two real Daytona jobs remain the separate historical receipts in [the original qualification report](SANDBOX_MANAGER_QUALIFICATION.md). Review regressions used synthetic API faults and fixed public fixture execution inside the coding sandbox; the browser management records were synthetic and did not allocate/delete real peer sandboxes. The only new allocation was this explicitly bounded 60-minute private coding/verification sandbox, with zero model calls and no TTL extension.

The browser still uses an ephemeral synthetic HTTPS gateway and certificate trust override inside Daytona. This does not certify deployed `gameverse.build` behavior or macOS Chrome/Safari permission prompts. The first browser attempt raced server startup and failed with connection refused; readiness was then checked before rerunning. Failed reproductions and superseded reports remain retained alongside passing receipts. Deployment and later-package gates remain unchanged.

Review totals: Standards — 1 actionable finding fixed and 1 nonblocking maintainability heuristic (worst actionable: lost-acknowledgment execution stall); Spec — 4 findings fixed (worst: shutdown journal-lock race). Adjacent regression corrections are listed separately above.
