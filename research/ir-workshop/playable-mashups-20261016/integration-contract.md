# Playable mashup round integration contract

Round `playable-mashups-20261016`; source commit `85e2139614e26e198b87bb92dadbd22de49da871` in a shared dirty checkout. This is a research candidate runtime contract, not a replacement for Vishal's accepted-game registration or navigation interface.

## Scope and truth boundary

Build two distinct compact complete games with input, visible graphics, an action loop, progression, success/failure and restart. **Latest explicit user requirement: actual recovered generated C must execute through WebAssembly in both browser games.** Translated JavaScript/native differential runs are retained baseline evidence and cannot substitute for final WASM delivery. Recovered source semantics stay immutable. Authored world, bridge, scheduler, renderer and lifecycle rules are labeled explicitly. Incomplete whole-ROM extraction does not prevent a coherent authored runtime using meaningful recovered systems. Existing source/native receipts may be reused only for unchanged code and matching inputs; the new WASM boundary requires affected checks.

Candidates remain isolated research artifacts. Do not change accepted FireRed versions or saves, claim complete source-game recreation, resurrect retired mashups, or redesign Mashup. Durable resume, migration and automatic-update eligibility are unsupported until separately implemented and tested.

## Early runtime seam

The agreed host seam is `async createCandidate()` returning `reset()`, `step(rawActions)`, `observe()` and optional `dispose()`. Each candidate owns its generated C→WASM internal exports and a JS adapter; renderer code does not depend on numeric C slot indices. The minimum semantic meanings are:

- `create/reset`: deterministic fresh state and unique candidate/version identity.
- `step(input, ticks)`: bounded fixed-tick advancement; input has held actions and explicit pressed/released edges. Each confirmed command receives an identity; retries must not count twice.
- `observe`: actual phase (`playing`, `won`, `lost`), current objective/progress, controls, legal actions, player/actors/world, events and bounded tick count. Observations describe actual state.
- `render`: graphics consume simulation state without becoming authoritative collision or progression state.
- `dispose`: clear input/event ownership and stop scheduling. Pause/focus behavior must be explicit.

Rendering may use authored graphics; extracted pixels stay in ignored private artifacts under existing policy. Keep simulation and graphics identities separate. Canvas draw calls alone are not evidence that meaningful source mechanics execute.

## Required ordering and lifecycle meaning

For each candidate expose its actual ordered phase list. Typical authored policy is input edges → canonical capability refresh → eligible commands → motion/terrain → live contacts → damage/reaction/death settlement → progression/outcome → presentation. Source-specific requirements override this example; no hidden universal scheduler is mandated.

Reject terminal contacts before damage; settle death once; do not let held input or duplicate delivery silently create new confirmed actions. Age protection/reaction at declared ticks. Keep world-space fixed-point backing and visible integer mirrors coherent on restart/recovery. Tile-local terrain indices require explicit mapping and bounds, not world-coordinate aliasing.

## Evidence and lean resource limits

Each lane records source and output hashes, actual timings, source/toolchain context, attempt count and failures. Build/simulation/evaluation are separate and nested stage time must not be added twice. Queue, CI and unavailable baseline measurements are null with explanation. New tests cover changed behavior narrowly; no new dependencies or CI jobs are planned.

Build games first; run bounded deterministic smoke tests and actual rendered/manual or model controls when available. Partial validation is useful and must name untested paths. Model testing only follows a runnable candidate, with explicit small decision/frame/wall budgets and retained actual-call logs. A script exit or L1 admission is not game playability evidence.

## Complete bounded experience gate

The first two microlevels are baseline artifacts, not sufficient evidence of the user's requested game quality. Final independent design review must inspect the actual rendered revision and play an actual flow fragment. Its scope and unplayed remainder stay explicit. A compact experience may be bounded; it still needs:

- A readable opening with controls, objective and a safe way to learn the central interaction.
- Consequential decisions driven by interacting recovered systems, with variety in timing, positioning, ordering or resource use. Extra HP, rooms or source-function counts alone do not establish depth.
- A progression arc that teaches an unlock, requires its use and combines prior skills in the finale.
- Visible feedback for current objective, threat/intent, legal actions, denied actions, damage, momentum/armor or paired queue consequences where relevant.
- A coherent success ending reflecting actual earned progress and an intelligible failure/replay path.
- Readable scene scale/camera and simulation-consistent actors. Decorative party members cannot imply systems or allies that the simulation lacks.

Relay Runner is the flagship candidate under this gate. Echo Tactics is a tactical microcampaign experiment unless its actual paired queue, role variation and interruption consequences establish comparable depth. Whole-game code generation and limited checks are separate claims; report architecture/content limits candidly rather than relabeling a shallow baseline complete.

## File ownership

The round lead owns only top-level `README.md`, `ledger.json`, `integration-contract.md`, and `HANDOFF.md` here. Lane folders and implementation files belong to their named workers; shared edits need explicit owner agreement. Candidate, renderer, terrain and lifecycle workers exchange concrete import/export contracts early instead of waiting for global source closure.
