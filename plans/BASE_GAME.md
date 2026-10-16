# Base game and subgame hosting implementation plan

Date: 2026-10-15 · Owner: Vishal · Status: planning; implementation has not started.

Contract: [base game](../contracts/BASE_GAME.md) B01–B10 and [subgame interface](../contracts/SUBGAME.md) S01–S07. Product context: [PRD](../PRD.md). Workstream split: [TASKS.md](../TASKS.md).

Tracking issue: [#1 — Base game and subgame hosting: contract and implementation plan](https://github.com/vishaltandale00/gameverse.ai/issues/1).

## Intended result

Launch in a browser → create/select a character → move and interact in a playable home → enter a subgame → play/save → return home → enter another subgame → restart the browser → resume independent progress.

The home and installed subgames work while the improvement worker is absent. Complete FireRed integration is T2; this plan delivers T1 using small playable fixtures. The fixtures exercise hosting behavior and do not replace FireRed or count as generated games.

## Owners and integration

Vishal owns the home, shell, profile/library, subgame runtime integration, controls, progress persistence and host-controlled version activation/recovery. Shishir owns the separate request/proposal/build/verification improvement loop, including its voice/transcript and builder workflow.

The joint interface must exchange pinned artifacts/manifests, game/version/session context, verification evidence and optional migration adapters. The host enforces activation and save protection; the worker cannot mutate accepted saves directly. The detailed interface remains proposed until reviewed by both workstreams. This task does not require Shishir's work to finish before the first playable journey.

## 1. Resolve the minimum experience and runtime choices

- Review one minimal playable-home concept with the owner: character movement, one interactable entrance, a return location and access to the library. World style, dimension, renderer and avatar customization depth remain decisions, not implied requirements.
- Select and record a target browser/OS and the actual DualSense/Xbox connection modes to qualify. Keep keyboard fallback from the start.
- Choose runtime hosting/isolation based on demonstrated load, input, checkpoint and shell recovery behavior. A stalled game must not prevent the shell from responding.
- Define the manifest/session/progress records and the supported host-interface version from the subgame contract. Keep framework-specific details behind the adapter.
- Choose progress storage and export/recovery behavior. State its durability limits and prevent concurrent tabs from writing the same profile/game progress.

**Exit:** a reviewable experience/runtime decision record, declared fixture core loops, a proposed interface shape and runnable setup instructions once scaffolding exists. Selection of a technology is not evidence of passing the later gates.

## 2. Complete one play journey end to end

Implement one thin but real journey before expanding the world:

1. Create/select a persistent profile and character; enter a small playable home.
2. Move to an entrance and launch fixture A from a pinned manifest/artifact.
3. Play its declared loop, reach an observable outcome and persist meaningful progress.
4. Use the shell action to checkpoint and return to the original home location.
5. Refresh/restart and resume the saved game with the same profile and progress.

The fixture needs actual actions, an outcome and saveable state. A navigation-only mock cannot qualify. Input ownership must prevent an entrance/menu press from triggering an unintended game action. The feedback action captures the active target and visibly reports that improvement is unavailable.

**Exit:** a continuous user-tryable browser demonstration, artifact/session identifiers and observed save/return/resume results. Pause for hands-on review of this complete interaction before expanding scope.

## 3. Prove the subgame interface with a second game

- Add fixture B with a different declared loop through registration/adapter data rather than host-specific gameplay branches.
- Show independent IDs, immutable versions and progress for both games.
- Demonstrate A → home → B → home → A and resume A after browser restart without altering B.
- Reject unsupported contract versions, missing artifacts, digest mismatches and incompatible saves before accepting a playable session.
- Release input/audio/session resources on exit; ignore late callbacks from disposed sessions.

**Exit:** B02/B03/B06/B07/B09 and applicable S01–S04/S07 evidence across both games. Preserve registration examples and useful automated interface checks for later adapter authors.

## 4. Qualify controls, persistence and recovery

| Case | Required result |
| --- | --- |
| DualSense, Xbox and keyboard | Each completes routine home/entry/play/return/resume; record tested connections and mappings |
| Overlay/focus change | Each press is delivered once; held inputs are cleared; audio/focus recover |
| Controller disconnect/reconnect | Visible loss/recovery, no stuck movement or duplicate action |
| Failed load or corrupt save | Home stays usable; original progress survives; retry/return is explicit |
| Crashed or stalled game | Bounded shell-owned recovery works without the game cooperating |
| Unsafe checkpoint or failed write | No false saved status; waiting/cancel and forced-exit consequences are clear |
| Second tab | No concurrent writes to the same active progress |
| Browser restart | Profile, library and accepted version/checkpoint pairs recover |
| Worker absent or offline | Play/save/return/resume remain usable; no false durable request receipt |

Measure frame rate, input response, load, checkpoint and recovery times on the declared target. Set concrete playability/recovery budgets from the spike; no invented build-latency SLA or untested browser/controller claim.

**Exit:** B01–B10 and fixture-applicable S01–S07 pass with retained browser evidence and meaningful checks. S06 automatic-update eligibility stays visibly unavailable until its game-specific behavior is implemented and verified.

## 5. Hand off the playable host

Deliver:

- Accurate install/run/test instructions and pinned versions.
- Host-interface definition, two manifest/adapter examples and progress/session semantics.
- Verified lifecycle/input/checkpoint/recovery behavior and known unsupported capabilities.
- The visible complete journey plus failure/recovery evidence from stage 4.
- A target-context and shell-surface integration example for Shishir, with an unavailable worker path.

T2 can use the same interface for complete FireRed; toolchain and adapter feasibility work may proceed alongside T1. T3 can integrate artifact publication, request context and host-mediated activation without replacing the home or implementing a second input/save system.

## Completion and next scope

T1 is complete only when the two-game browser journey, both-controller operation, persistent progress and recovery are demonstrated. Full FireRed, autonomous builds, generated quests, forks/mashups and the complete improvement acceptance loop retain their own gates. No implementation begins as part of publishing this plan.
