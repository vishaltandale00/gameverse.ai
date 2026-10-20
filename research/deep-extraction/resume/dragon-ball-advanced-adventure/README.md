# Dragon Ball: Advanced Adventure — resume dependency packet

Status: **partial, blocked before automatic lift**. Mario remains the active depth priority. This packet changes no compiler, queue, catalog, game or UI files.

The concrete mechanic candidate is capability-gated hold charge → release action initializer → animation-gated emission → controller recovery, restricted initially to profile indices 0/1. Names describe inferred state behavior; gameplay actor identity and the emitted object's nature remain unverified.

The existing own-ROM exports establish this chain:

1. `0x0810d2f8` selects hardware/record/replay input; `0x08014a6c` calls `0x080149dc` on the fixed actor-like record `0x020205a0` before controller dispatch.
2. `0x08017244` accumulates signed 16-bit charge at actor `+0xac` while held mask `0x100` and capability mask `0x20` permit it. Resource `+0xaa`, profile `+0xca`, mode gates and earlier transitions matter. Release clears charging flag mask `0x1`, requests effect cleanup and dispatches a profile callback when charge exceeds 255.
3. ROM table `0x08a41624` indices 0/1 contain Thumb pointer `0x08023e09`. The dispatcher at `0x08116a20` is literally `08 47` (`bx r1`), so actor `r0`, callback identity and Thumb tag must survive.
4. `0x08023e08` snapshots charge tier, resets charge to its floor, installs `0x08024235`, and selects phase/timer values. `0x08024234` waits on actor flag mask `0x2`, advances phase and calls **missing export `0x080289c8`** before timer-based recovery through `0x08017068`.
5. `0x08003314` sets/clears that same flag mask `0x2` from `0x0810fd70`'s animation result. Animation completion is therefore mechanically necessary. Stubbing rendering wholesale would lose the causal clock.

`packet.json` contains 17 exact target addresses, each available function's ROM bounding-interval hash and decompiler-text hash, 11 cached HighFunction file hashes, source/ROM hashes, the complete 30-word callback table, symbolic fields, alias constraints, service requirements, order, lift priorities and classified blockers. Bounding intervals can include gaps/literals and are explicitly not independent function-boundary certification.

The actor globals and pointer-relative fields must share backing storage. For example `0x0202064c` is actor `+0xac`, and the animation record `0x02020614` is actor `+0x74`. Effects retain an actor reference; task allocator payloads use tagged IWRAM/EWRAM offset encoding. Detached state copies are incorrect.

Current blockers are missing emission/charge-begin exports (`0x080289c8`, `0x08028df0`), missing cached HighFunction for dispatcher/sampler/animation core, saved-LR returns mislabeled as indirect calls, callback ABI recovery, canonical aliases and effect/task lifetime, plus unresolved resource/capability/input-aux producers and real scheduler cadence. The lane is not composable or mechanics-closure-ready.

The historical receipt passed 98,496 isolated original Thumb input calls against manually recovered C in 0.265588 s (0.056987 s host compile; 0.207999 s execution). This only qualifies that finite input operator comparison. It establishes no automatic/emitted equivalence, charge mechanic, gameplay reachability, actor identity or frame clock. Manual C remains an analysis/differential oracle only, never compiler input.

Current checks verified the ROM and full corpus export against queue SHA256 pins, table profile-0 target, dispatcher bytes and presence/hashes of cached HighFunction inputs. Source reads, hashing, table decode and assertions took **0.075677 s**; that timing excludes earlier analysis/tool dispatch. The prior queue discovery was 11.158134166 s. No headless export, compiler/build/native run or dependency installation occurred; no CI/build before/after comparison exists. Overall analysis and queue time were unavailable, recorded as null.

Historical next action at the original snapshot was to obtain missing exports. The authoritative current availability update below replaces that export recommendation; the earlier absent-state descriptions above are retained historical evidence.

## Current availability update — authoritative for export presence

Batch `target-export-batch2-20261016T104552Z` now supplies both previously missing L0 exports, with hashes checked against `research/automatic-ir/next-bounded-exports/append-index-packet.json` and `batch2-report.json`:

- `0x080289c8`: `local/re/next-bounded-exports/target-export-batch2-20261016T104552Z/dragon-ball-advanced-adventure/l0/080289c8.json`; SHA256 `6e88773b37b136acb2bfad5a58e602273c1a2764cb99b68371238a414d20e221`.
- `0x08028df0`: `local/re/next-bounded-exports/target-export-batch2-20261016T104552Z/dragon-ball-advanced-adventure/l0/08028df0.json`; SHA256 `366a4ab4521ed502cf62ce36e588ec589c459b344a622c750a56048882bd2ab0`.

These are structurally valid, static-unqualified exports. This metadata update performs no new semantic analysis. The packet's `current_availability` is authoritative for these two current file-presence claims; the original absent-state fields and receipts remain unchanged as history. Serialization adds no native qualification, typed ports or mechanic closure.

Current next action: consume those existing exports and address the retained ABI/callback/boundary, alias, services, animation-clock and task/effect lifecycle blockers. Remaining cached-HighFunction export targets from this packet are `0x0810fd70`, `0x08116a20`, `0x0810d2f8` and `0x0810d758`; no availability beyond the cited batch is asserted. Keep the game partial. Manual C remains oracle only.

The source report records Dragon Ball's prior export item at 3.305645584 s, including a 3.291819125 s export process, nested within the 6.228515708 s two-game batch. These are historical report timings, not new runs. The metadata read/hash/consistency check timing is recorded in `current_availability`; no compiler, native, inventory or global queue changes were made.

Availability-list correction: the original packet already recorded `0x0810d758` with `highfunction_present: false`. Its omission from the previous current remaining list was accidental, not an existing-cache finding or a deliberate exclusion. The list above restores that historical gap using existing packet fields only; no new inventory or semantic analysis ran.
