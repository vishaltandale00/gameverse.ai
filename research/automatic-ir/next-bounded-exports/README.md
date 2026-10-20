# Eight dependency HighFunction exports

All eight requested own-ROM exports are available and structurally valid. No L1, native qualification, typed ports, mechanics closure or catalog promotion was attempted. Existing ABI, alias, callback, service and scheduler blockers remain explicit in the game packets.

The append-only integration packet is `append-index-packet.json`. Its `items[].append_attempts[].artifacts` paths contain ordinary `l0/ENTRY.json` files, compatible with the compiler's existing depth-pool loader. Only the compiler owner may apply global queue updates; existing attempts and qualification counts must remain intact. `export_index` pins each exact game/entry, ROM hash, copied source-project manifest hash, exporter hash and output hash. Both batch reports retain full project file manifests, exact commands, source functions/evidence packet hashes and per-stage timing.

| Batch | Game | Entries | Process time |
| --- | --- | --- | ---: |
| 1 | Minish | 08077f24 | 3.662198 s |
| 1 | Aria | 0802d284, 0802d2bc, 0802d208 | 2.688580 s |
| 2 | Dragon Ball | 080289c8, 08028df0 | 3.291819 s |
| 2 | Shaman | 0805d590, 0805d788 | 2.687429 s |

Batch totals were 6.590463 and 6.228516 seconds (12.818979 seconds summed invocation wall time). Additional first-batch retained-artifact validation took 0.000489 seconds. Exporter script time is nested in process time. Hashing/copy/check overhead is included in invocation totals; queue time and interactive analysis duration are unavailable. No builds, simulation, static census, paid API calls or new dependencies were needed. These targeted exports do not establish a comparable before/after performance improvement.

An exact-name recursive local cache search found no same-game retained target exports. Same-address files from other games were excluded. All four queue projects already contained their expected saved program names, so no alternative project or fresh analysis was necessary. Each was copied into a unique `local/re/next-bounded-exports/target-export-batch*/GAME/ghidra_project`; only copies were opened, sequentially with `-readOnly -noanalysis`. Original project manifests remained byte-identical. The parent granted exclusive game leases; all four leases are released.

The first batch exported successfully but its initial validator assumed every pcode op had an `output` key. GSON omits null-valued keys. Initial failure reports remain under the first batch's `initial-validator-failure-*` filenames. The validator now accepts a missing output as null; existing exports were revalidated without another Ghidra launch. Second-batch validation passed directly. Structural checks cover exact entry/format, block-edge membership and varnode references, without claiming semantic or ABI correctness.

Shaman `0805d590` serializes a two-operation `CALLOTHER` service path, rather than the BIOS implementation. Its exact sqrt semantics still need an explicit service/oracle contract. Aria/Dragon Ball return/callback artifacts are preserved unchanged for the compiler owner. Bounds remained two ROMs per invocation, 900 seconds total, 45 seconds exporter script, 75 seconds process and at most 800 candidates; actual selections were only one, three, two and two entries. No full-ROM analysis or broader export campaign ran.
