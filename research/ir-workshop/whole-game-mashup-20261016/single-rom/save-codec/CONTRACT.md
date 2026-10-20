# Fixed 75-byte native BoxPokemon codec v1

This prerequisite saves **2,100 bytes for 420 PC slots** with a deterministic
31,500-byte output. It does not implement or qualify the whole-game save layout.

`tools.whole_game.single_rom.save_codec.emit(source, output)` emits
`wg_box_codec.c`, `wg_box_codec.h` and `capsule.json`. Source file hashes must
match pinned Emerald `731ad5bfd6e6f265508d0efcca0ba42f9dcf5881`; unknown source
revisions fail before emitting output. No dependency or full ROM build is added.

## Source and identity proof

Native `include/pokemon.h` defines the 32-byte header and four 12-byte substructs.
Growth contains species/item as two u16s; attacks contains four u16 moves.
Native `src/pokemon.c` supplies `GetSubstruct`'s 24 personality permutations,
`EncryptBoxMon`/`DecryptBoxMon`'s personality XOR OT-ID key, and the checksum's
sum of 24 decrypted u16s modulo 65536. `native_oracle.c` is extracted from those
exact native definitions, rather than reimplementing their behavior. It asserts
80-byte native size, 32-byte secure offset, 28-byte checksum offset, 12-byte
substruct size and source ID bounds at compile time.

Each ID fits nine bits: species <=412, item <=376, moves <=354. Six IDs occupy
54 bits in seven bytes (top two bits must be zero). The other 68 bytes are
unchanged: 32-byte native header and 36 other decrypted core bytes. Packing
therefore uses 68+7=75 bytes. Decoding reconstructs the exact logical core,
reapplies the original personality permutation and XOR key, and preserves the
original checksum. XOR and permutations are bijective; no entropy, empty slots,
unused-bit clearing, checksum repair or canonicalization is assumed.

Flags (including BadEgg), original OT/personality, nickname, language, markings,
unknown header field, growth filler, all core bits and padding are retained.
BadEgg with an invalid checksum is rejected; a checksum-valid BadEgg is preserved
byte for byte. Out-of-domain IDs, even if checksum-valid, are rejected. Expanded
species/items/moves need a separately versioned codec and capacity calculation.

## Save integration obligations

`WgBoxEncodeSlots` and `WgBoxDecodeSlots` accept arrays of up to 420 slots. Source
and destination must be separate, nonoverlapping, correctly sized buffers, kept
stable throughout the call. Return values are documented in the generated header.
Both functions validate **every** slot before changing **any** destination byte.
A corrupt final slot cannot leave an earlier slot partially accepted.

The caller must validate the enclosing save's format/version, declared sizes,
slot count, slot identity and integrity before decode, and must validate all
remaining save sections before flash writes. Codec version is
`WG_BOX_CODEC_VERSION=1`; the 75-byte record has no embedded version or integrity
overhead. Native checksum is a weak 16-bit sum and does not authenticate header
metadata. This codec intentionally makes no flash calls and cannot independently
prove the enclosing transaction's crash safety. A codec error must abort the
save operation and retain the prior accepted snapshot; never drop a slot,
convert BadEgg, repair checksums, or overwrite accepted progress.

## Verification and cost

Run from repository root:

```
python3 research/ir-workshop/whole-game-mashup-20261016/single-rom/save-codec/verify.py
```

The lean qualification compiles only codec and source oracle as a host shared
library, separately compiles codec for freestanding ARM7TDMI Thumb, and checks
all 24 permutations, every in-domain value in each of the six fields, boundary
IDs, 420 seeded random native records, an empty native record, checksum damage,
out-of-domain IDs, packed padding, capacity limits, and unchanged destination
on rejection. It records actual timing, compiler/machine context, source and
harness hashes in `verification.json`. No runtime GBA cycle measurement,
whole-ROM link/save test or before/after turnaround baseline exists yet.
