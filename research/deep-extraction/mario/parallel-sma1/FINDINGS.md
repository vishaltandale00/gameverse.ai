# SMA1 controller/death/retry dispatch dependency evidence

This packet is static own-ROM evidence. It adds eight proposed causal targets and two supplements to existing targets, without declaring an executable component qualified or a Mario game complete. Retained decompiled C was read as analysis evidence only. No recovered C was used as compiler input. All writes are under this directory.

ROM: `local/roms/Super Mario Advance (USA, Europe).gba`, SHA256 `d29dec02caacbf449e2a93c6042258b0669542e102eb0e6fd0eb92a5411e0244`. Retained export: `local/re/experiments/20261016-binary-corpus-round2/super-mario-advance/super-mario-advance/functions.jsonl`, SHA256 `3ed19b8048d4d284ca7df8ca8945fb176c54933d7ff4a5366af70cddf51e24ac`.

## Critical ABI finding

`080b6cc4` is `20 47` (`bx r4`), followed by `c0 46` padding. It is a callback trampoline. Its apparently empty decompilation must not be interpreted as an optional service or no-op. Three retained callers load a ROM-selected target into live r4 immediately before BL to this trampoline:

| Caller / instruction | Selector / table | Relevant target |
| --- | --- | --- |
| `080a7440`, load `080a754e`, BL `080a7550` | player state byte `+27`, table `08367cec` | state0→`080a7570`, state7→`080a9334`, state8→`080a948c` |
| `08047024`, load `080470aa`, BL `080470ac` | global scene phase `03001992`, table `08346bb4` | phase3→`08048fb0`, phase4→`0804ce28` |
| `08048fb0`, load `0804905a`, BL `0804905c` | completion byte player`+55` minus1, table `08346c1c` | signal1→`080490b8`, signal2→`08049134` |

`08047ab0` independently dispatches profile byte`+0` via table`08346c0c` and the same trampoline (load`08047b5e`, BL`08047b60`). That table's four adjacent entries are `08047b74/08047bb8/0804862c/08048678`. These are scene/motion services, not interchangeable with the player-state table. The source windows retain those table bytes, but this packet does not qualify their complete dependencies.

## Connected causal order

`08046d20` calls `080a7440` before the later `08047ab0`, `080ad520`, and death-completion check. `080a7440` suppresses state execution when global`030019ae` or player`+46` is nonzero. In its admitted path, it may change state to8 for a health/form transition, then dispatches the current state. State7 reaches the already finite-qualified death updater`080a9334`; it sets completion1 when decremented lives remains nonzero, completion2 when zero.

Later in the admitted `08046d20` tick, a nonzero completion clears player`+40/+64`, profile`+3b/+3a`, and selects scene phase3. `08049a3c` has another analogous completion branch. These scene routines have substantial admission gates; the check cannot be treated as an unconditional independent consumer. An unbounded search for all consumers was not performed.

Scene dispatcher`08047024` chooses phase3→`08048fb0`. That function disposes/reinitializes context through its real dependencies, reloads the player pointer root, reads completion, invokes the selector callback, then reloads the player root again and clears completion. Disposal and callback cannot be dropped: shared mutable pointer roots and ownership are essential.

- Signal1 callback`080490b8` sets player`+56=1`, calls checkpoint restore`080adf7c`, and selects scene phase0. The restore copies saved level/room/mode and player integer position/velocity/state fields; it sets health15 and clears invulnerability. It does not itself synchronize fixed-point position mirrors. Downstream setup and original checkpoint writers remain unresolved dependencies.
- Signal2 callback`08049134` calls reset helper`0804958c`, sets player`+56=0`, and selects phase4. The phase table points phase4 to`0804ce28`, which resets lives to5 among many initialization, rendering and possible persistence effects. This is a concrete zero-lives/reset path, with a game-over interpretation still requiring native presentation/continuation evidence.
- Completion values3/4/5 share this dispatcher. Their table targets are retained but not inferred equivalent to death retries. Value5 is explicitly written by`080509d8`; its cleanup clears13 actor status/type slots. Normal plucking uses12 candidates, so a generic12-slot cleanup would be wrong.

The source death update is not idempotent on repeated admitted expiry invocations. The scheduler must move phases, preserve the signal until its callback, and avoid calling the expired death updater again. Signal clearing alone does not prove the entire lifecycle.

## Compiler-ready bounded next step

Automatically export/lift `080490b8` with leaf dependency `080adf7c`, and separately `08049134` with`0804958c`, using original ROM/HighFunction input. Preserve symbolic player/profile ownership and global scene state. Both closures avoid unresolved callback dispatch internally and are concrete narrow candidates for the next finite original/emitted qualification.

Use the existing eight correlated death fixtures as predecessor states, then add consumer expectations for completion1/2, signed checkpoint Y, byte/halfword/word preservation, and health thresholds15/16. Do not assert native parity until receipts exist. Subsequently export the parent dispatcher with live r4, bounded selector domains and mutable root references; qualify one expiry→phase3→callback→phase0/4 transaction before composing it into NEW ROMs. Native stages should retain existing30s/16,384-vector caps. No reason to repeat already-passing broad game matrices.

The current packet does not close terrain sampling/contact permissions, carrying/throw-hit, full controller dispatch, scene allocation, room loading, persistence, or later initialization. Existing terrain/carry/death targets remain intact. No shared compiler, registry or catalog changes were needed for this evidence extraction; the compiler must change if it currently treats the r4 trampoline as discardable.

## Packet and verification

`targets.json` matches the existing mechanics registry target shape; IDs are checked distinct from its75 retained records. `target-updates.json` supplements existing death and movement targets. `dispatch-contracts.json` records bounded table bytes, selectors, edges, ABI and limits. `source-windows.json` retains11 exact hashed code/data spans; `dispatch-instructions.asm.txt` retains five bounded objdump windows. `extract_packet.py` reproduces metadata from private local ROM/export paths.

`extraction-receipt.json` records actual extraction/verification wall time and machine/commit context. It covers hashing, table decoding, five objdump calls and JSON/ID/span verification, not total human analysis time. Queue, build, simulation and native qualification timings are unavailable because those systems were not run. There is no before/after turnaround comparison for this evidence-only change.
