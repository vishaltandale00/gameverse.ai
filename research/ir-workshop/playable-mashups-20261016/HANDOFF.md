# Scope correction and regression handoff

Historical compact prototype artifacts are frozen in [final-manifest.json](final-manifest.json): 43 file pins, 26 builder-manifest pin comparisons, zero mismatches. Current source commit is `85e2139614e26e198b87bb92dadbd22de49da871` with substantial preexisting dirty work preserved. The state notes below retain the round's sequence; this final checkpoint takes precedence.

## Latest user correction — overrides every historical delivery statement below

The user rejects Relay Runner and Echo Tactics as the wrong task. The objective is to combine two or more **original games fully, end to end** (for example Metroid + Pokémon), repairing the mashup architecture instead of inventing games around a few source functions. **Requested whole-game mashups delivered: zero.**

Stop expanding and promoting both prototypes. Preserve their code, private assets, WASM, receipts and immutable manifests solely as regression evidence. Toolchain/compiler and bounded schedule/lifecycle work may remain useful, but neither the prototype playthroughs nor source-vector counts fulfill the product request. Do not delete user artifacts or reinterpret this as permission to build another authored microgame. New whole-game integration planning belongs to `/root/whole_game_mashup_architecture` under root coordination.

The remaining sections record historical work and validation limits; they are not current deliverable acceptance or a request to continue prototype content.

## Historical checkpoint

Relay Runner `relay-runner-wasm-20261016-r3` uses actual 4,043-byte C WASM (SHA256 `d41a5530f00528f5786495fb8c71d6cf4b0ea91df418b3773349bfdc1b30baf3`). Echo Tactics `echo-tactics-wasm-v4` uses actual 70,450-byte C WASM (SHA256 `1a2359c49722e86edf9d8ed269deccf714a5444dd92028daae8c92c508b790ee`). No silent JS fallback remains. Both have ordinary-input headless full wins, losses and restart checks; source checks pass A 4,500+1,018 and B 1,483 cases.

Independent final affected checks pass A hazard recovery and B full 23-turn victory/restart plus selected-queue consequences. Final actual-browser checks cover A movement/combat/first unlock and B fresh strike/locked ability fragment, with longer B earlier-revision progression retained separately. Final browser endings were not independently replayed. Actual model calls zero. Design reviewer accepts meaningful compact source compositions but explicitly does not certify a broad fully featured campaign: A one course/three foes; B five arena encounters. The broader aspiration remains a content limitation, not something to mark fulfilled by this review.

Page remains live at `http://127.0.0.1:4174/playable-mashups` (server session 27749). Do not add features or rebuild again absent a material bug; code and renderer are frozen. Top README, ledger and candidate reports identify controls, exact source/authored boundaries, actual timings, failed attempts and unsupported saves/accepted integration. The installation of the WASI build toolchain was explicitly user-authorized; there were no new CI jobs or npm runtime dependencies.

## Latest user decisions

1. Build actual playable games, not another fragment-only report; full code plus partial testing is useful.
2. JavaScript translations are rejected as final recovered execution. Fix the compiler/toolchain and execute actual recovered generated C through WebAssembly in both games.
3. Small complete tech demos are insufficient. Prioritize a fleshed-out, consequential mashup flagship over shallow feature counts. Do not imply original source-game identity from storage/clamp primitives.

Actual WASM builds are now available using the user-authorized pinned WASI SDK. Initial JS/native differential runs are retained historical baseline evidence. A game's earlier source/runtime hashes and playthroughs do not certify later gameplay revisions.

## Work ownership and state

- Round lead `/root/playable_mashup_lead`: top-level ledger, README, contract and this handoff. No source core edits.
- `/root/assembly_schedule_fix`: optional typed conditional, phase and freshness checks in `assembly.py` and new `assembly_schedule.py`, schema and verifier. Final report says 28 focused checks pass plus existing 28 assembly/18 mapper. `schedule/` contains example actual generated-C execution and before/after timing samples. Independent validator final review pending.
- `/root/gameplay_lifecycle_fix`: `src/playable-mashup-lifecycle.js` and focused tests. Eight checks passed; terminal admission, one-time cleanup/reward, press edges, command dedup/fresh refresh and reentrancy. Reciprocal world review retained. B baseline integration receipt exists; final runtime revision needs matching evidence.
- `/root/terrain_recovery_fix`: `src/playable-mashup-world.js` and focused tests. Eight passed after swept thin hazard and initial overlap fixes; Q8/scene restart semantics authored and peer-reviewed.
- `/root/wasm_toolchain_fix`: pinned project-local SDK plus `scripts/setup-playable-wasm-toolchain.sh` and `scripts/compile-playable-wasm.mjs`. Generic helper records source/artifact identity, exports/imports and stage times. Probe artifacts are distinct from production output paths.
- `/root/playable_candidate_a`: `src/playable-mashup-candidate-a.js`, `candidate-a/`, private `local-data/playable-mashups/relay-runner.wasm`. Actual DB/Sonic/MZM generated C executes as WASM. Baseline 4,500 WASM/native differential vectors and 1,510-tick whole win/death/restart pass. Now expanding flagship: source momentum threshold versus armor; Air Step route; telegraphed charging guardian; meaningful opening/finale. Final revision evidence pending.
- `/root/playable_candidate_b`: `src/playable-mashup-candidate-b.js`, `candidate-b/`, private WASM artifact. Actual Minish/Emerald/FFVI source bridge. Baseline 1,443 vectors and 17-turn win/10-turn loss. Now implementing real four-slot paired queue, targeted Gale exchange, late-swap early-threat consequences, lethal interruption and varied practice/combined encounters. Final revision evidence pending.
- `/root/presentation_runtime_fix`: new page/runtime/renderer, scoped exact server paths/private assets; no accepted navigation redesign. Local page `http://127.0.0.1:4174/playable-mashups`. Exposes read-only `window.playableMashups.observe()`/`metrics()`. Actual extracted source pixels remain ignored private assets; world/UI authored. Final readable camera/intent/queue/ending revision pending.
- `/root/playable_validation`: independent source/actual-browser validation under `validation/`; actual model calls remain zero because no configured provider. Must validate final WASM revisions, not just baseline JS snapshots.
- `/root/mashup_game_design_review`: independently found first microlevels too shallow. Concrete directions sent both builders; must recheck actual final rendered revision and play a fragment, with unplayed remainder explicit.

## Final delivery gate

Use [integration-contract.md](integration-contract.md) complete bounded experience gate. Root explicitly requests truthful generated/tested/untested, playable URLs, controls/objectives/outcomes/restart, provenance and limitations. Do not label accepted host versions, durable saves, original-ROM parity, full source-game reconstruction or automatic-update compatibility as supported. No generic retired game resurrection. No future source extraction prerequisite: a separate disjoint source-family extraction wave is running; pin selected sources and don't wait for it unnecessarily.

Independent reviewers must see final actual rendered code and a meaningful real input fragment. Maintain deterministic whole-code checks separately from actual browser coverage. Retain failed attempts and explicit queue/CI/baseline gaps; comparable schedule verifier single samples are overhead evidence, not a speedup claim.
