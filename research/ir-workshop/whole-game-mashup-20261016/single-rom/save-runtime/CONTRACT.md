# Native streaming save runtime v1

`tools.whole_game.single_rom.save_runtime.apply(stage, codec_source=clean_pinned_emerald)`
runs after state, world and QuestLog transforms. It refuses canonical source root
names, emits the proven codec and streaming runtime, and adapts native save entry
points. No dependency or CI job is added.

## Capacity and identity

Main slots occupy sectors0–12 and13–25. Each sector has4084 payload bytes and a
12-byte footer (magic, generation, physical-sector-bound CRC32). Fixed physical
positions identify all13 distinct sectors. The schema stream comprises32 bytes
of header, native SaveBlock2, native SaveBlock1, storage prefix,420 exact75-byte
BoxPokemon records, and **all** remaining PokemonStorage bytes through sizeof.
The header identifies schema0x00010001 (layout1, unified namespace/state
semantics1), native sizes and box boundaries, and a CRC32 over the complete image
excluding the CRC field itself. Bump the schema for same-size semantic changes,
including flag/trainer namespaces, ID remapping or state interpretation.

Actual native compilation enforces:

```
32 + sizeof(SaveBlock2) + sizeof(SaveBlock1) + sizeof(PokemonStorage) - 2100 <= 53092
```

The latest representative model uses a1492-byte unified storage extension,
including state/world/Daycare fields communicated by owners. It produces52804
bytes with288 bytes spare. This is a model input, **not a final linked sizeof or
EWRAM measurement**. Compilation of the combined source remains authoritative.
Auxiliary sectors28–29 Hall of Fame,30 Trainer Hill and31 Recorded Battle retain
the original native ABI. No save.h layout change affects those users.

## Transaction and recovery

Before any write, validate every native boxed record and inspect both existing
main slots. I/O errors abort before writes; they never mean empty. Fresh initial
writes require verified all-FF main sectors. An incompatible/corrupt nonempty
save needs the native explicit different-file overwrite path; native Emerald
saves are not migrated. Normal saves write the opposite slot and commit only
when all13 sector CRCs, generation, complete-image CRC, schema and boxed records
validate. The previously accepted slot survives any interrupted sector write.
Unsigned generation differences below2^31 define newer snapshots, including
ffffffff→0. Stable flash and source bytes during each synchronous operation are
required.

LinkFullSave preserves its delayed cross-peer commit boundary. Prepare writes
the final sector with its magic low byteFF and its intended committed CRC.
The final-signature callback, after the native peer handshake, revalidates the
prepared snapshot, programs only byte4084, and validates again. Target and
generation live in twelve bytes of COMMON state; the shared sector buffer may
be overwritten between callbacks. Ordinary SAVE_LINK/EREADER and the existing
fast partial-save APIs use full snapshots until an optimized transaction is
separately qualified.

Loading validates whole selected snapshots before game-state copying and falls
back to the complete prior snapshot when a newer snapshot is torn or corrupt.
No valid slot means no decode writes. A read failure during the subsequent copy
pass is reported as failure; the native adapter clears partial RAM, latches
further saves, and skips CopyPartyAndObjectsFromSave. In-game ReloadSave returns
to title on failure. Only real NewGame initialization or explicit different-file
overwrite resets the failed-load save latch. The QuestLog owner also guards its
final-scene reload before field entry.

The native failure UI retries complete transactions without WipeSectors. Codec
and read errors use a separate attempt status; no fabricated physical sector
bit can erase an accepted snapshot. Hall-of-Fame failure cleanup recognizes
nonphysical failures as well.

## QuestLog policy

Sectors26–27 contain one independent, **nonredundant** history image, protected by
its own sector CRCs, complete-history CRC32, schema, length and matching main generation. Its concrete
provider API is `FR_QuestLog_GetHistoryBuffer/Size`, with6560 bytes of actual donor
scene state. The adapter enables persistence only when the real provider header
exists; the receipt explicitly reports a missing provider as unresolved.

History is written only after a successful main commit. An interrupted history
write can lose history, while main campaign progress remains accepted. Invalid,
stale-generation or damaged history is cleared by the native adapter and does
not reject the campaign save. The two history sectors never touch main0–25 or
auxiliary28–31. There is no claim of the original main-slot history redundancy.

## Verification and outstanding gates

Run `verify.py` in this directory. It compiles the exact source-derived native
BoxPokemon oracle and codec, then injects failures at every main sector write
(before erase, after erase, half program, full program but error), all prewrite
read positions, every load read, deferred final-byte commit, every newer-sector
corruption, locally repaired CRC with damaged image, generation wrap, invalid
boxed source, foreign schema admission, both history-sector write steps, damaged
history and both-invalid snapshots. It verifies byte-exact source state and no
active/auxiliary sector changes. Latest run:178 cases in0.677 seconds, with
actual compiler/machine/harness hashes in verification.json.

The runtime compiles freestanding ARM7TDMI Thumb. The transformed actual native
save.c passes ARM syntax checking against source headers (only libc declarations
and unused generated map IDs are stubbed for this narrow check). This is not a
full ROM link. Combined sizeof/EWRAM, native program-byte timing, emulator/cart
save/reload, link negotiation and QuestLog gameplay remain qualification gates.
No before/after turnaround baseline exists for this new schema.
