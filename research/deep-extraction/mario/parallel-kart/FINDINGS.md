# Mario Kart Super Circuit retained own-ROM evidence

Status: static causal candidates only. Nineteen targets, fifteen retained HighFunction files, four pending targeted HighFunction export. No new native-qualified behavior, component, composition or whole-game completeness claim.

`targets.json` is an append packet matching the Mario discovery-target record shape. `family-map.json` maps all five existing coverage families. `receipt.json` pins actual analysis timing/context. Analysis-only pseudo-C excerpts and the packet builder are isolated under `local/re/resume-kart/`; pseudo-C is never compiler input. The packet pins own-ROM SHA256 `aadc8b9f3c947ff6f610b6c8d7fddaaa9bea98b4bd43576df84f26c457ae1f90` and the retained functions export. No project was opened.

## Concrete causal closures

1. **Vehicle/surface:** `0803c4c0` integrates signed velocity at racer +4e/+50 into X/Y with multiplier 0x100, keeps previous coordinates, calls `0803b98c` checkpoint classification and `0803b550` contact. Its branch on racer flags +48 bit 0x2000 separates input path `08037fd8` from CPU path `0803bc00`/`0803bd24`. `0803c1bc` supplies character/class profiles and required ROM tables. `08038298` is state-dependent packed speed/acceleration policy, including timer expiration; it must not be reduced to a scalar acceleration helper.
2. **Contact/world:** `0803b2b4` reads and writes track surface state through `08032990`/`08032798`, stores surface metadata at racer +85 and invokes adjacent-cell contact policy. `0803b550` consumes its result, packs contact count/flags at +60, damps velocities and gates recovery flags. Surface queries mutate shared scratch/state, so pure independent value copies are unsafe.
3. **CPU/race progression:** `0803bc84` chooses route heading or checkpoint-directed heading; `0803bc00` slews wrapped heading; `0803bd24` chooses speed from character/class/route/resource state. This is direct static evidence for opponent routing and dynamics, not rubber-band proof. `0803b98c` is the essential legality producer for `0803b7b8` lap crossing; testing the latter alone as a Y-threshold would omit checkpoint/track gates. Finish changes flags and invokes ranking/finish dependencies. The later `0804a878` mode-specific race phase/countdown consumer is exported C only, pending HighFunction.
4. **Items/impact:** `0803e92c` is a substantial two-racer impact transaction: status gates, weighted velocities, signed clamps, timers, object effects and direct participant pointers. `0803d4e4` applies cause-dependent saturated loss to racer +178 (coin candidate, identity not yet natively confirmed). Later `08044d4c` is a concrete homing object controller (target at +7c, owner +54, route adjacency, steering, integration, callback cleanup); no specific shell name/color is asserted. Allocation/roulette/use and callback cleanup still need closure. `0803d480` proves overlapping byte/halfword writes in three packed owned slots; standalone copies would lose overlap semantics.
5. **Lifecycle/persistence:** `0803bf34` resets racer state and calls packed-slot cleanup; it is race reset, not proof of save reset. Later `0805d30c` initializes/merges record image RAM and track defaults. Later `08061980` programs descriptor-selected flash sectors with retry/waitstate helpers. The high-level record transaction, checksum/version/failure/commit/reload and cup unlock producers are unclosed. A flash writer is not a recovered save system.

## Own-export boundary and ABI blockers

The retained Ghidra export used no return repair and warns that generated C does not verify boundaries or ABI. Fourteen of fifteen selected HighFunction records have op PCs outside the interval `entry .. entry+declared size`. The packet preserves the original declared-size hash and a separate observed PC envelope hash. Neither is called a validated full function body; the envelope may include literal pools and gaps. For example, `08038298` declares 156 bytes while observed HF ops run through `0803863c`.

The apparent terminal indirect calls include a concrete return idiom: at `0803c848`, ROM bytes ending `f0 bc 01 bc 00 47` mean Thumb `pop {r4-r7}; pop {r0}; bx r0`. `0803b54c` ends with `pop {r1}; bx r1` (`02 bc 08 47`). These are return-repair candidates, not established gameplay dynamic callbacks. Confusing them with CALLIND leaves signatures such as `void` for value-returning route/contact helpers and creates false dependency blockers. All selected HF tails end in BX r0/r1 candidates; actual calling context and reachable predecessor stack balance must be checked before repair. Genuine object callback pointers (e.g. homing cleanup) still require separate handling.

No saved Ghidra project lease has been requested/used. The compiler owner can first repair these verified return idioms and re-export a narrow priority list, preserving instruction bodies and return values. Only then is automatic linked lifting meaningful for the selected closures.

## Shared or bundled engine claims

All target evidence is from this Kart ROM. Character/class tables and race-global pools are internal shared racer infrastructure. Audio routines around `0805ff20`/`08060110`/`08060e80` and flash routines are support-service candidates. Their shapes do not establish shared engine identity with another Mario game or a separately bundled gameplay engine. There is no recovered separate bundled engine claim for Kart in this packet. Do not carry SMA1/2/4 bundled-engine labels into Kart based on branding.

## Ordering, aliases and units to preserve

- Racer pointers in pair contact, active-player global `03003658`, race racer arrays and projectile owner/target references must resolve to canonical objects, not independent snapshots. Track `03002e44` is shared; actual complete accessed extents remain unresolved.
- +6e/+70/+72 packed writes overlap byte/halfword views. Flags at +48 and +58 carry multiple mechanic owners; expiration cannot discard another owner's bits.
- Static integration establishes `position += signed_velocity * 0x100` per update, and track queries convert positions by arithmetic shift 16 with negative rounding adjustment. Physical units/frame rate are not natively calibrated; retain storage equations without naming pixels per frame.
- Profile tables, trigonometric lookup `080e645c`, route metadata and callback descriptors are ROM dependencies. Resource-count identity, button meanings, mode mapping and state names remain hypotheses where stated.
- Audio/presentation calls occur inside updates with mechanical state writes. Do not erase whole routines as optional audio. Service isolation needs read/write and timing evidence.

## Lean continuation

First repair/re-export `0803bc84`, `0803b2b4` and `08038298` with verified return values and complete body coverage; link terrain queries and character/class tables. Use no more than eight native targets, 16,384 vectors each and 30 seconds per native stage. Initial meaningful fixtures: negative/positive velocity integration; wrapped heading around 0/ffff; contact count 7→8 and recovery expiry; legal/illegal crossing plus finish boundary; alias-preserving pair impacts. These fixtures are proposals, not run results.

Next targeted HighFunction exports: `08044d4c` homing object, `0804a878` race phase, `0805d30c` record image, `08061980` flash program. Keep 800-candidate, 45-second export/static and 75-second process caps. Obtain project lease before accessing the saved project. Extend with ranking `0804af3c`, allocator/cleanup callback and record setter/checksum/commit only after the first closure demonstrates the need. No new CI/dependency/build step was added.

Historical discovery was 9.581910583 s (9.068790291 s export process, 0.506298792 s static census; stages nested in whole run). New excerpt materialization was 0.113292208 s; packet build/hashing is recorded separately. Human/model analysis elapsed time and queue time are unavailable. No comparable before/after build or improvement-run measurement exists because those systems were not changed or run.
