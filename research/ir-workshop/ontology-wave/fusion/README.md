# Fusion bounded source-backed table expansion

`python3 -B research/ir-workshop/ontology-wave/fusion/run.py`

This recipe uses the existing local USA Fusion ROM, pinned clean decomp source,
compiler, libmgba, and a private snapshot of the two ontology compiler modules.
No dependencies or CI jobs are added. The bounded run compiles two source data
objects, three generated patch-C objects, and one native harness. The native
campaign is limited to 780 calls with a 256-instruction per-call cap; each external
stage has a 20-second timeout. The observed campaign lasts under one second on
this machine; this observation is not a full-build budget or SLA.

The original `sSamusDrawDistanceOffsets` has eight rows, four signed halfwords
per row. The recipe captures its single source reader and single aligned ROM
literal reference, appends a ninth row, moves the backing to an explicit 80-byte
ROM extension, and rewrites the original ARM consumer's data literal at ROM
`0xc1d0`. Capacity becomes ten rows, with nine initialized semantic rows and an
explicit unused final row. Original backing is retained and classified unknown.

Pose zero remains an existing source pose. Its descriptor's byte-zero index is
changed to eight, reaching the appended row through unchanged original native
instructions. Pose values remain in `0..64`. The source consumer loads a `u8`
index then multiplies by eight; `fixed_consumer_capacity:256` records this finite
index addressability, not 256 backed rows or a count loop. The reference-field
constraint rejects indices beyond the actual nine captured rows.

Fresh ARM object symbols for both the 64-byte draw table and 325-byte pose
metadata exactly match the pinned ROM. This provides actual object/ROM mapping
for those symbols; there is no full matching linked ELF or whole-game ownership
claim. Only byte zero of each five-byte descriptor is editable, preserving the
other four bytes. Other descriptor consumers include SA-X threshold comparisons.
Their behavior for the changed pose-zero index is outside this qualification.

The identity edit reproduces every ROM byte. The append emits typed data-layout
IR and generated C for table, descriptor, and dependent-pointer writes. A repeat
edit changes the appended row's top distance through the captured candidate and
manifest in a fresh process that denies source-tree reads. No shared compiler
files are modified.

The actual original `SamusUpdateDrawDistanceAndStandingStatus` runs in libmgba
for every source pose crossed with four initial standing states, for identity,
append, and repeat candidates. Every call compares the whole 64-byte Samus state
window and checks preserved registers and stack balance. Each variant passes
260 calls. Restoring the stale original pointer makes the appended-row native
case fail, demonstrating that the consumer reaches the new backing. Additional
negative requests reject stale identity, unknown closure, absent backing indices,
and signed-halfword overflow.

`result.json` records pins, private manifest hashes, source mapping, negative
results, stage timings and scope limits. Extracted tables, ROMs, IR with data
bytes, manifests, patch C and native fixtures remain in
`local/roundtrip/ontology-wave-fusion`. Public files contain recipes, source
reference evidence and result metadata only. Measured identity/append/repeat
compile and simulation stages use comparable inputs on the same machine, but
cache state varies; they do not establish a performance improvement. Full-source
build, remote CI, boot/gameplay/lifecycle, rendered output and whole-game closure
remain unavailable.

Both captured tables and their data allocations join the existing
`fusion.player.contact_profile` package through the pinned v2 capability's
`source-indexed-immutable-table-read` dependency relation. This is a read
asset dependency; no new module ownership is assigned to the tables. The
`--metadata-only` recipe mode regenerates the manifests, requests, typed IR and
compiled patch C, then retains earlier native evidence only after verifying all
three candidate ROM hashes are unchanged. Its current timings exclude native
execution; `native_prior_timing` retains the earlier native campaign separately.
