# Improvement loop contract

Version: 0.1 · Date: 2026-10-15 · Status: proposed delivery contract

Implements PRD R04–R14 and improvement-related R15 behavior, using the [base-game](BASE_GAME.md) and [subgame](SUBGAME.md) interfaces. This task changes games; base-game play and manually installed subgames must work independently.

## Ownership and integration

The loop owns voice capture/review, durable requests, builder conversation, interpretation, update/fork classification, versioned proposals, isolated builds and retained verification evidence. The host owns gameplay focus and recovery. The version coordinator owns accepted-version activation; the worker submits candidates through it.

A request may target the base game or a subgame. Capture the target game ID, baseline version/artifact, profile/session, checkpoint/progress revision and available context when recording begins; show it during review and freeze it with submitted text. Navigation never retargets work. Changing the target requires an explicit revision. Raw audio/media retention and external processing remain configured choices.

## Required journey

1. Invoke the shared feedback action; show live provisional/final text and target context.
2. Correct, append, rerecord or cancel with controller/voice; review-first remains the proposed default.
3. Submit with request/revision ID. Show safely queued only after durable receipt; retries/reconnects do not duplicate work.
4. Continue playing while the worker interprets, records a proposal, builds and verifies. Inspect/reply/pause/resume/cancel/retry through the builder channel.
5. For an update, wait for a verified safe boundary and apply through the host coordinator. For a new game, register a verified library entry and let the player choose entry.
6. Play the result, preserve context for follow-up feedback and perform another improvement cycle.

The agent can proceed from reasonable intent without a mandatory planning interview. Classification is delegated; requirement changes still need explicit proposal revisions. A cancelled or superseded revision cannot promote later. Configured resource limits produce a visible failed/needs-input state rather than indefinite work.

## Candidate and verification contract

Pin target baseline, request revision, proposal revision, source diff, artifact digest, runtime/build dependencies and fixture versions for each attempt. Freeze observable acceptance assertions before building. Repairs may change implementation; they cannot silently weaken assertions or relabel a failed update as a passing fork.

Verification covers build/boot, real input, repeatable core loop, requested behavior, unchanged baseline invariants, compatible copied saves and shell recovery/feedback. Retain actual discovered test counts and runtime evidence. Generated scenario descriptions and a successful compiler exit are insufficient.

Updates retain game identity and recognized progress. Forks have new identities, independent saves and pinned parent lineage. Mashups name each parent's contribution and implement an actual composed mechanic. Optional progress imports preview copied/mapped/dropped fields and validate the copied target without mutating the parent.

## Safe activation

Recheck candidate evidence, cancellation, expected active baseline and runtime state immediately before activation. Unknown runtime state blocks activation. A per-game mutation transaction prevents overlapping promotion, save/import and rollback writes.

At a verified boundary: capture the actual current checkpoint → preserve original artifact/checkpoint → copy and validate/migrate progress → load candidate → verify resume and shell controls → atomically commit accepted version. Validate current progress even if the build started from an earlier fixture. A changed accepted baseline requires rebase/reverification or a stale state, not blind promotion.

Failure or interruption restores the compatible original pair. Preserve newer saves independently. A manual revert that loses subsequent progress displays the consequence and requires a controller choice; carrying progress backward requires a verified reverse adapter. Crash recovery must work between each transaction step.

## Completion gate

| ID | Required evidence |
| --- | --- |
| I01 | Correct deliberate transcription errors and submit without routine keyboard/editor use; reconnect preserves receipt, conversation and target. |
| I02 | Two successive requested changes become durable playable versions, including a new quest or mechanic; follow-up targets the newly accepted version. |
| I03 | Failed checks, cancellation, stale baseline and duplicate receipts cannot promote a candidate; current play remains usable. |
| I04 | Safe-boundary detection, application-time progress validation, crash recovery and rollback preserve the correct artifact/save pairing. |
| I05 | PRD E01–E03 run against actual FireRed integration, including pre-Misty reachability and meaningful infiltration behavior. |
| I06 | Blank/fork/mashup workshop journeys satisfy E04–E05, create independent playable entries and preserve parent progress. |
| I07 | The base game can be an explicit improvement target through the same contract; a failed base candidate retains a usable home/library. |

Build latency has no user-approved SLA. Measure it and configure cost/repair limits; keep gameplay responsive throughout. Passing a fixture-only improvement test proves the interface but does not satisfy I05 or overall MVP acceptance.
