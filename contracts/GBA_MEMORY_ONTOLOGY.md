# GBA captured memory ontology and property compiler

`tools.roundtrip.memory_ontology` is an additive, dependency-free typed data
backend. It connects source/ELF evidence, ROM allocations, semantic table
properties and explicit dependent writes. Existing roundtrip component/package
identities remain canonical byte ownership; `component_id`, `package_ids`,
`module_id` and `prefab_ids` are optional joins, not new readiness claims.

Hardware address spaces, linker allocations and game objects are distinct.
`HARDWARE_SPACES` describes the GBA's fixed physical capacities; it never grants
permission to grow EWRAM/IWRAM, palette RAM, VRAM, OAM or memory-mapped registers.
ROM input and extension are bounded to the 32 MiB primary cartridge window.
Game-owned pointers, capacities, lifetime, aliases and transfer constraints live
in captured consumer evidence. Hardware sizes can be cross-checked against the
original project headers (FireRed `include/gba/io_reg.h` and
`include/gba/defines.h`, MZM `include/gba/memory.h` and `include/gba/display.h`).

## Captured format

Schema: `gameverse.gba-memory-ontology/1`.

- `rom`: exact `sha256` and `size`; `game_id`, `source_revision`: source/ELF pins.
- `allocations`: `{id,rom_offset,size,kind,source,...}`. `kind` is `code`, `data`,
  `mixed` or `unclassified`. Writable tables and binding locations must be
  classified `data`. Allocation overlap is rejected; uncovered ROM is reported
  as unclassified by `partition()`. RAM allocations and semantic objects can be
  separate metadata nodes without invented ROM offsets.
- `tables`: `{id,symbol,allocation_id,rom_offset,stride,capacity,rows,fields,
  bindings,expansion}`. Each field has `name`, byte `offset`, a fixed-width
  little-endian integer `type` (`u8/s8/u16/s16/u32/s32`) and optional `min`, `max`,
  `allowed_values` (a finite nonempty scalar domain), or `references_table`.
  Capture and candidate edits must satisfy these constraints. Rows capture every
  editable field. Unmodeled padding
  remains byte-exact. `snapshot_hex`, when present, must match the pinned ROM.
  Optional `backing_prefix_size` captures a header immediately before the first
  row (for example OAM's u16 object count). The data allocation includes this
  prefix; `rom_offset` still identifies the first record.

- `bindings`: `{role,rom_offset,type,expected}`; roles are `count`, `pointer`,
  `capacity`, `length_bytes`. Pointer bindings support `target_addend` and require
  u32 encoding. `target_addend` may address an explicitly captured backing
  prefix, never bytes before it. A binding with `table_relative_offset` must
  resolve to its recorded `rom_offset` inside this backing; relocation moves
  it with the table. Prefix count writes are merged into the guarded backing
  write. Conflicting writes into typed record properties fail. Every original
  value is checked. A `count` binding must equal the captured logical record
  count. Pointer identity is semantic:
  an equal numeric value in another alias domain is not automatically rewritten.
- `expansion`: `status:closed`, `reference_closure:complete`, and nonempty
  `closure_evidence` are required for appends. A `count` consumer is required,
  unless `fixed_consumer_capacity` explicitly captures a source consumer bound,
  including a documented index type addressability limit,
  or `sentinel_termination` captures a source-proven flag-terminated record
  chain. The latter names `field`, positive `mask`, `continuation_value` and
  distinct `terminal_value`; every nonfinal row must carry the continuation
  bits and the last row the terminal bits. Appending must change the old final
  flag and append a new terminal row in the same request. This does not invent
  an engine count or bound. An index addressability limit does not establish
  that all such rows exist or are reachable: `references_table` validates actual
  initialized rows, the relocation span limits storage, and qualification must
  retain its narrower exercised domain. Other consumers of selector bytes remain
  separate semantic dependencies even when every pointer to this table is closed.

  Evidence must explain source indexing, size/stride, ownership/lifetime,
  aliases, transfer limits and known unsupported consumers. This declaration is
  producer evidence, not a machine proof of complete source discovery or play.
- Relocation uses `free_region:{rom_offset,size,expected_sha256}` disjoint from
  all owned allocations, or `mode:rom_extension` exactly at the original ROM
  end, with explicit size, `fill` and SHA-256 of the empty original span. A hash
  of FF bytes alone does not establish that the region is safely unowned.

A pointer beyond the old backing can be captured only within an explicitly
recorded fixed consumer capacity (the FireRed palette defect is such a case).
Every emitted pointer must land within the new backing. Growing a table updates
the declared count, length, capacity and pointer consumers. Immediate operands
inside ARM/Thumb instructions are unsupported; they cannot masquerade as scalar
count fields. Compression, arbitrary native-code regeneration, banked ROM,
interior pointer discovery and automatic save migrations remain unsupported.

## Executable path

```sh
python3 -B -m tools.roundtrip.memory_ontology --manifest CAPTURE.json --rom BASE.gba --request EDIT.json --output NEW_DIRECTORY
```

Request format:

```json
{"manifest_sha256":"SHA256_OF_CANONICAL_JSON","operations":[
  {"op":"set","table":"table-id","index":0,"field":"property","value":3},
  {"op":"append","table":"another-table","row":{"property":12}}
]}
```

Canonical JSON uses sorted keys and compact separators; use `sha(canonical(m))`.
`compile_edit(manifest, rom_bytes, request)` returns a candidate ROM, new captured
manifest, typed data-layout IR and standalone generated C byte arrays. The IR
lists every guarded original/target byte range and its reason, including dependent
pointer/count updates. Table IR retains typed field names, widths, constraints,
rows, stride, count, capacity, original/new placement and symbolic target/addend
expressions. C contains complete offset/size/byte records for all dependent
writes as well as the table array. C is an inspectable patch representation;
the emitted ROM write plan performs integration, without claiming a rebuilt
original source tree or behavioral IR. A subsequent request uses the new manifest
and candidate ROM; original source is never reopened. Unchanged host ROM remains
an explicit input. The CLI retains failure receipts as well as successful ones;
no compiler, emulator, model or remote CI is launched.

`graphics_contracts.py` supplies codecs and structural consumer validators for
4/8bpp tiles, BGR555 palettes, text map entries, OBJ 1D frames and tile transfers.
`graphics_contracts` on a manifest wires each consumer contract to named assets
using `{rom_offset,size}` or `{table,row_start,row_count}` references. The
compiler resolves these against the candidate before returning it. A
`gba-palette/1` contract validates a standalone palette. These checks distinguish
pixel/index encoding from palette banks, map/OAM references,
VRAM destinations and copy lengths. They reject unsupported formats. Their
structural acceptance does not prove visual appearance or native gameplay;
a new graphics family requires a captured consumer contract and bounded native
rendering evidence before promotion. No unknown area is silently classified as
a supported asset.

## Scope and checks

`python3 -B -m unittest tools.roundtrip.test_memory_ontology` exercises guarded
scalar edits, source-independent repeated edits, padding preservation, actual
append relocation, count/pointer updates, fixed-capacity aliases, semantic
bounds, stale identities, code-binding/header rejection and ownership overlap.
It adds no CI job, dependency or broad matrix. Local before/after full-source
build and remote CI timing comparisons are unavailable; this backend avoids
build/source setup entirely and records its own bounded execution time.
