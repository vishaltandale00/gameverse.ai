# Pokémon Rally Mastery

This optional recipe is an additive source stage for the one Emerald + FireRed cartridge. Both original regional campaigns remain obligations of the core importer. No combined cartridge has been delivered by this track.

Ride admitted straight bicycle tiles to accelerate and refill a shared 64-point Rally reserve. Turning uses explicit negative source acceleration (or the native Kanto turn reset); geometry, collision, stairs, slopes and ledges remain native. At speed index 2, each accepted tile refills one point. The first gym badge in either region unlocks RALLY STRIKE: full-health player attacks spend up to eight charge for extra resolved damage. The fourth badge unlocks desperation GUARD: at one eighth maximum HP or less, incoming ordinary attacks spend up to sixteen of the same reserve to absorb damage. Offense therefore competes with saving charge for defense; cycling routes replenish it and native badge progress unlocks the choices.

The first bike-use message explains the rules. Holding L while using the bike reopens a native resource readout. Battle spending prints short native messages and plays native sounds. RALLY STRIKE is an authored bonus to ordinary attacks, not a transplanted sword or beam action/animation.

## Recovered behavior and authored composition

Six exact qualified L1 packages are pinned in `tools/prefab_pipeline/requests/pokemon-eclectic.json`. Their algorithms are emitted by the existing behavior IR lowerer with symbol namespacing; native-compatible constant spellings and C89 declaration hoisting preserve values and operations.

| Source | Actual reused behavior | Authored host binding |
|---|---|---|
| Mario Kart Super Circuit | Steering accumulation, speed-dependent steering damping/acceleration, packed fractional speed integration and axis calculation | Cardinal native input becomes source demand; straight bands +128 and corner bands -512; signed speed is clamped to 0..3 Q16 and projected to native speed index 0..2. Source continuous axis outputs do not replace Pokémon grid movement. |
| The Minish Cap | Exact packed two-bit learned inventory derivation and full-HP/low-HP eligibility predicate | Saved native badge 1 sets item76; badge4 sets item79 in a temporary bank. Source ownership is exactly value1. Pokémon HP projects to maximum64 with full health requiring actual equality, preventing 713/714 from rounding to full. |
| Final Fantasy VI Advance | Source resolved HP/recovery/exclusion/lethal transaction | A fresh scratch actor applies damage/recovery to the Rally reserve. Pokémon remains the sole writer of actual battler HP, bars, damage records, status and faint lifecycle. |

These bounded foreign algorithms are not full foreign games or native controller transplants. Rally, badge mapping, capacity, spend rules, scheduling and units are authored composition policy. Every source package retains its original finite qualification scope; no native Pokémon gameplay is inferred from those receipts.

## State and ordering

The actual ARM object has 16 bytes of new ephemeral state: racer12, Rally2, previous direction1, help flag1. There are zero new serialized bytes. Badges are read from the core's original saved flags for both regions. Charge lasts the running cartridge session and is deliberately not saved; native bike stop/clear resets motion while preserving charge. Final integrated EWRAM/link fit remains required.

The attack hook executes once in the ordinary native health-bar command after no-effect/substitute admission, before the bar and subsequent HP-data command consume the same resolved damage. It excludes fixed damage, healing, passive HP changes, self/allied damage, OHKO, Endure/Focus Band outcomes, initial tutorials, link, Safari, facilities, recorded battles and Trainer Hill. Each native multi-hit damage command can spend again, bounded by the shared reserve. Native damage calculation/type/accuracy and target ownership precede the authored adjustment.

## Reproduction and evidence

The public coordinator accepts the optional `--eclectic-request tools/prefab_pipeline/requests/pokemon-eclectic.json` route; absent configuration leaves the original combined-source recipe untouched. The coordinator now registers the option and retains the source mechanisms/request pins and all 79 package/backend files, checking identities before and after stage execution. The stage requires explicit configuration, exact package identities and its own source hash. The stage API is `stage_eclectic(base, donor, output, report_dir, request_path=..., repo_root=...)`.

- Source lowerer: `tools/prefab_pipeline/eclectic_strategy.py`.
- Native source integration: `tools/whole_game/single_rom/eclectic.py`.
- Nine source/packing/compiler-compatibility tests: `tools/prefab_pipeline/test_eclectic_strategy.py`; retained original FFVI expected subsets include 50 independently annotated semantic fixtures.
- Two authored policy checks: `tools/whole_game/single_rom/test_eclectic.py`; the compiled host fixture executes acceleration, signed corner braking, badge admission, reserve competition, full-health rounding, one-eighth health boundary, link/passive/Endure/fixed damage exclusions, source recovery cap, and motion-only reset. Native rendering/services are doubles in this host fixture, not gameplay evidence.
- Five actual clean agbcc + ARM assembler units pass: `local/prefab-pipeline/pokemon-eclectic-stage-005/compile.json`, total1.075343541s. Includes generated map-group constants from all merged maps; no map placeholders. Source stage receipts and generated consumers remain in that attempt directory.
- Actual recovered-mechanics ARM text14,868 bytes; undefined dependencies `__ashldi3`, `__lshrdi3`, `memset` require the native link's standard libraries.

No prior comparable stage existed, so a before/after build baseline is unavailable. These are narrow source and translation-unit timings, not ROM-build or improvement-loop timings. Queue/link/gameplay/model timings are unavailable. Earlier failed attempts001–004 are retained; failures exposed a nested-brace insertion bug, missing generated map headers, duplicate native integer aliases, and legacy compiler macro/literal warnings. None is overwritten by the passing attempt.

## Remaining delivery

The combined core must link, then the optional registered pipeline must build the exact recipe and publish its ROM/ELF before native traversal, charge/spend UI, campaign behavior, and save/reload can be qualified. Native DecisionAI uses the existing System1 confidence gate and System2 fallback; no model call or accuracy campaign has run against this source-only recipe. The bot owner has the exact state symbols and is waiting for the linked artifact. No hidden manual source fork or paired-ROM host is an accepted completion path.
