# Zero Mission source-backed animation memory family

The [metadata receipt](evidence.json) records an actual bounded copy-on-write
expansion of background animation descriptor 18 from four to five 128-byte frames.
The fifth frame duplicates the first retained frame; no new artwork is claimed.
It changes the descriptor's data count and pointer, appends exactly 640 bytes at
the original 8 MiB image end, and preserves every other original byte. Four actual
original bytes differ; the six-byte authorized descriptor fields include unchanged
bytes. The original identity property serialization also reproduces the ROM exactly.

`tools.memory_ontology.mzm.extract_mzm(source_tree, rom_path, elf_path, private_dir)`
captures typed properties, source hashes and exact ELF `STT_OBJECT` witnesses.
`shared_manifest(snapshot, private_dir, rom_size)` feeds the guarded common
`tools.roundtrip.memory_ontology.compile_edit` API. Repeat compilation reads the
captured manifest and retained ROM, without a pristine source tree or toolchain.
Private pixel rows, generated C, property IR and cartridges remain in
`local/memory-ontology-20261016/mzm/`; public evidence contains no pixel payload.

The family includes 38 eight-byte descriptors, the 384-byte selector matrix
(eight tilesets × sixteen slots × three bytes), and the three source-declared
graphics objects. The source load routine reads the first selector byte, then
copies descriptor properties and pointer to sixteen twelve-byte IWRAM states.
Update uses the descriptor's frame count and a fixed 128-byte frame stride;
DMA transfers 64 halfwords per selected frame. The expansion retains the selector
identity and the runtime state size. Its count limit is 127 because the live
frame counter is signed eight-bit. The selected NORMAL descriptor avoids the
distinct negative-index traversal used by alternate animations.

The copy-on-write dependency scope is explicit: only descriptor 18 receives the
new pointer/count; shared original tile bytes and neighboring animations remain
retained. The allocation is a new bounded ROM extension within the GBA's 32 MiB
address window, not an inferred unused `FF` range. This establishes guarded data
generation and preservation, not native execution or full game compatibility.
Room selector authority, scheduling, interrupts and all native callers remain
open dependencies. Existing MZM behavior IR receives zero new byte credit.

Source `src/data/animated_tiles_data.c` declares pixel arrays but includes
`extracted/data/animated_tiles/*.gfx.inc`, absent in this retained source tree.
The exact pixel payload is therefore ELF-captured opaque bytes with a source
declaration, not freshly source-regenerated graphics. Descriptor interpretation
comes from pinned structs and consumers plus matching ELF/ROM object extents.
The generated output is typed data-layout IR; it is not a generated ELF or
behavior IR. Pixel bit-depth is delegated to the graphics contract rather than
inferred from byte size alone.

Extraction plus compilation took 0.780325375 s; compilation was nested within
that at 0.009920708 s. Three targeted tests passed in the runner-reported 0.242 s,
checking identity, exact retained-host delta, copied frame contents, stale binding
rejection and unsupported count/type rejection. No build, emulator, model or CI
ran; those durations and queue time are unavailable. No comparable earlier
baseline was measured and no turnaround speedup is claimed.
