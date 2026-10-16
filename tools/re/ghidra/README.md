# Headless Ghidra pipeline for GBA ROMs

Ghidra handles the mechanical reverse-engineering steps for each ROM: separating
code from data, ARM/Thumb modes, function boundaries, xrefs and pseudo-C. Each
ROM produces one JSON record per function, which later LLM passes read.
ROMs come from `local/roms/*.gba`. Stable IDs come from `local/re/roms.json`, which
`tools/re/rom_index.py` generates. All outputs are written under `local/`, which
is gitignored.

## Requirements

- Ghidra 12.1.4 (Homebrew: `/opt/homebrew/opt/ghidra/libexec`, override with `--ghidra` or `GHIDRA_HOME`).
- JDK 21. The runner sets `JAVA_HOME` to Homebrew's `openjdk@21` when it is unset.
- Python 3.9+ (stdlib only).

## Usage

```sh
# one or more ROMs (full import + analysis + export)
python3 tools/re/ghidra/run_ghidra.py pokemon-emerald-version driv3r

# separately triggered corpus qualification, only after discovery is validated;
# defaults: 5 JVMs, --xmx 4G --max-cpu 3 --decomp-threads 3
python3 tools/re/ghidra/run_ghidra.py --all --jobs 5

# re-export (e.g. after changing GbaExport.java) from the saved project, no reanalysis
python3 tools/re/ghidra/run_ghidra.py driv3r --export-only

# score function discovery against pret/pokeemerald symbols
curl -sSfL -o local/re/groundtruth/pokeemerald.sym \
  https://raw.githubusercontent.com/pret/pokeemerald/symbols/pokeemerald.sym
python3 tools/re/ghidra/eval_groundtruth.py local/re/pokemon-emerald-version/functions.jsonl
```

Other flags are `--no-decompile` (facts only, no final pseudo-C export),
`--no-discover`, `--gap-arm`, `--seed-oddptr off|push|valid`, `--seed-file`,
`--opt "Analyzer Name=value"`, `--repair-returns` (optional heuristic described below),
`--decomp-timeout`, `--rom-timeout` and `--out-root`
(put experiments outside `local/re`). Run `--help` for the full list.

For a bounded capture-seeded first pass, `--no-auto-analysis --no-discover`
skips all default auto-analyzers while retaining explicit seed disassembly and
the final pseudo-C exporter. `--capture-root` selects an isolated capture tree;
`--max-capture-seeds 1000` caps automatically merged phase call targets by summed
observed calls. Explicit/consolidated seed files are not truncated. Selected and
available counts plus capture hashes remain in `capture_seeds.json`. This is
partial observed-code extraction, not full function discovery or matching source.

An opt-in static expansion with better calibrated entry coverage uses
`--seed-oddptr push --no-auto-analysis --discover-no-analysis --discover-mode calls`
instead of `--no-discover`. It scans ROM-wide odd Thumb pointers beginning with
push-LR, then creates functions at direct call targets already decoded. It does
not run default auto-analysis or `analyzeChanges`, and does not scan arbitrary
undefined-data gaps in calls mode. Keep explicit `--discover-rounds`,
`--discover-candidate-limit`, `--discover-scan-timeout` and `--rom-timeout` bounds.
The scan timeout is cooperative between candidates; the runner timeout is the
hard process cap. Indirect calls, ARM-only pointer tables, unreferenced code and
incorrect existing disassembly remain gaps. This path is opt-in, not the default.

Emerald calibration (same indexed USA ROM, unchanged 770 capture seeds, one JVM,
2 GiB/2 analysis CPUs, no final pseudo-C) is retained under
`local/re/experiments/static-discovery/`:

| Configuration | Wall | Found entries | Known-function recall | Entry precision over ROM | Unexplained text entries / beyond text |
| --- | --- | --- | --- | --- | --- |
| Odd-pointer push-LR only | 13.3 s | 7,583 | 47.76% | 99.97% | 0 / 2 |
| Odd-pointer push-LR plus validated leaves | 39.8 s | 10,881 | 50.36% | 73.45% | 1,765 / 1,124 |
| Push-LR plus direct calls, 2 rounds, 10,000 candidate limit, 30 s scan budget | 14.7 s | 12,966 | 81.38% | 99.57% | 54 / 2 |

The last route added 5,383 functions in 1.106 s of discovery. Compared with the
same-input push-only route, it adds 33.62 recall percentage points and 1.4 s of
process wall time. These are entry-address metrics against the retained Emerald
symbol heuristic (15,853 functions); they do not verify source equivalence,
instruction modes or function boundaries. Exact size agreement was 21.91% in
the call-expanded result, but symbol sizes can include padding/literal pools
that Ghidra bodies exclude, so size disagreement is a diagnostic rather than a
direct boundary-error rate. All found entries, modes, body sizes and endpoints
are in each run's `functions.jsonl`; full body ranges are not exported, and exact
code-byte coverage remains unknown. Valid-leaf seeding is not recommended from
this calibration. No broad final pseudo-C campaign is justified by recall alone.

Two final pseudo-C pilots (`20261016T011639-3982ea`) used this expansion with
current three-phase captures, one JVM/2 GiB/2 CPUs/one decompiler worker,
3 seconds per function, a 120-second ROM cap and return repair off. Crash
completed 1,448/1,448 functions in 11.6 s, retaining all 751 capture-only entries
and adding 697. Setup took 1.864 s, discovery 0.130 s and decompile 6.091 s.
Warnings remained in 1,146 functions, `unaff_` in 32, and `halt_baddata` in 3;
generation is not semantic validation. Its capture-only baseline took 7.2 s
for 751 functions, with the same capture inputs but the earlier recorded harness.
Driv3r created 3,236 candidate functions (3,069 direct-call additions in 2.032 s)
but hit the 120-second process cap during decompilation. It produced no completed
function export, so final generated count, target retention and quality counts
are unavailable. There was no retry. The combined sequential process wall was
131.7 s. Do not extrapolate Emerald precision or Crash throughput to Driv3r.
Detailed hashes, stages, baseline records and Crash entry comparisons are under
`local/re/experiments/static-discovery/report.json` and `corpus-pilot/`.


```sh
JAVA_TOOL_OPTIONS="-Duser.home=$PWD/local/re/ghidra-user" \
  python3 tools/re/ghidra/run_ghidra.py driv3r \
  --jobs 1 --xmx 2G --max-cpu 2 --decomp-threads 1 --decomp-timeout 3 \
  --seed-oddptr off --no-discover --no-auto-analysis \
  --capture-root local/captures-experiments/20261016-current-scripts \
  --max-capture-seeds 1000 --rom-timeout 90 \
  --out-root local/re/experiments/capture-seeded-first-pass
```

`decomp_ok` means pseudo-C generation completed; it does not verify function
boundaries, register conventions or semantics. Summary diagnostics count functions
with `WARNING` comments and `unaff_` registers. These are observable defects/hints,
not a complete quality score. IO access directions are currently unverified:
`io_read` and `io_write` are empty, candidate register names are in `io_ref`, and
the initial heuristic classifications are retained in `io_direction_hints`.
Inspect instructions/runtime evidence before assigning a read/write direction.

`--no-decompile` skips the final pseudo-C export, but Ghidra's auto-analyzers may
still invoke its decompiler. It does not guarantee a short run. `--rom-timeout`
defaults to 10,800 seconds; set an explicit, smaller scope and limit for probes.
The runner terminates the experiment's process group at timeout so the Java child
cannot continue after its launcher is stopped. New output roots are created.

On a sandboxed macOS installation, Ghidra's launcher may be unable to write
`~/Library/ghidra/.../java_home.save`. A workspace-local Java settings directory
avoids that write without changing the user's home directory:

```sh
mkdir -p local/re/ghidra-user
JAVA_TOOL_OPTIONS="-Duser.home=$PWD/local/re/ghidra-user" \
  python3 tools/re/ghidra/run_ghidra.py pokemon-emerald-version \
  --jobs 1 --xmx 2G --max-cpu 2 --no-decompile --no-discover \
  --seed-oddptr off --rom-timeout 120 --out-root local/re/experiments/seed-probe
```

This is a bounded diagnostic command, not a configuration established to finish
within 120 seconds; the measured probe below timed out at that limit.

## Pipeline

`run_ghidra.py` calls `analyzeHeadless` once per ROM:

1. Import: `-loader BinaryLoader -loader-baseAddr 0x08000000 -processor ARM:LE:32:v4t -cspec default`.
2. `GbaSetup.java` (pre-script) does the following before analysis starts:
   - Builds the memory map: BIOS 0x00000000 (16 KB), EWRAM 0x02000000 (256 KB),
     IWRAM 0x03000000 (32 KB), IO 0x04000000 (1 KB, volatile), palette 0x05000000,
     VRAM 0x06000000 (96 KB), OAM 0x07000000, and SRAM/flash 0x0E000000 (64 KB). All
     of these blocks are uninitialised.
   - Labels and types every IO register as `REG_<name>`, covering display, BG, affine,
     window, mosaic, blend, sound, DMA0-3, timers, serial, KEYINPUT/KEYCNT, IE/IF/IME,
     WAITCNT and POSTFLG/HALTCNT. It also labels `INTR_CHECK`, `INTR_VECTOR` and the
     cartridge header.
   - Marks the ARM branch at 0x08000000 as the entry point (`rom_entry`, TMode=0).
   - Adds Thumb seeds from 4-byte-aligned ROM words with the low bit set (Thumb
     function pointers in pointer tables and literal pools). A target is accepted
     when it starts with `push {..,lr}` or, in `valid` mode, when Ghidra's
     pseudo-disassembler accepts it as a terminating subroutine.
   - Adds seeds from an optional seed file (see below).
   - Applies the analysis-option overrides from `opt:` arguments.
3. Ghidra auto-analysis runs. The runner disables `Non-Returning Functions - Discovered`
   by default because it ran for more than 20 minutes on Emerald (see Timings).
4. `GbaDiscover.java` (post-script) scans the ROM bytes that analysis left undefined
   for Thumb `push {..,lr}` prologues, and optionally for ARM `stmdb sp!,{..,lr}`. It
   validates each candidate with the pseudo-disassembler, creates the function and
   re-analyses the changes, for up to 3 rounds.
5. If explicitly requested, `GbaReturns.java` applies the narrow heuristic return
   aid documented below. This stage is skipped by default.
6. `GbaExport.java` (post-script) writes the outputs listed below.

The Ghidra project is kept at `local/re/<id>/ghidra_project/gba.gpr`, with the
program named after the ROM file. Later scripts can query it or decompile more
functions without reanalysis:

```sh
analyzeHeadless local/re/<id>/ghidra_project gba -process "<rom file>.gba" -noanalysis -readOnly \
  -scriptPath tools/re/ghidra -postScript YourScript.java
```

## Outputs (`local/re/<id>/`)

| file | contents |
|---|---|
| `functions.jsonl` | One record per function with: `entry`, `mode` (arm/thumb), `size` (body bytes), `end`, `name`, `is_thunk`, `instructions`, `callers` and `callees` (entry addresses), `function_pointers` (functions referenced as data), `strings` (`{addr,value}`), `io_read`/`io_write`/`io_ref` (register names; `io_ref` means the base was loaded but the access type is unknown), `swi` (BIOS call numbers; ARM `swi` imm24>>16), `rom_data` (non-code ROM addresses referenced, after following literal-pool words), `ram_refs` (EWRAM/IWRAM addresses), `decomp_ok`, `decomp_ms`, `c` (pseudo-C), and `decomp_error`/`decomp_timeout` on failure. Each list is capped at 256 entries. |
| `strings.json` | Every string Ghidra defined in ROM, as `{addr, length, value, functions}`. This only covers ASCII; most games use custom text encodings that Ghidra does not detect. |
| `summary.json` | Function, Thumb/ARM, decompiled and failure counts, the decompile failure list, timings (setup, auto-analysis, discover, analysis total, export static, decompile, export total), Ghidra version, script hash, run id, timestamps, and the setup/discover stats including seed counts. |
| `setup.json`, `discover.json` | Raw stats from the setup and discover scripts. |
| `returns.json` | Only with `--repair-returns`: exact candidates, accepted instruction addresses, saved-LR criteria, heuristic limitations, script hash and timing. |
| `headless.log`, `ghidra.log`, `script.log` | Logs. |

`local/re/index.json` collects run records and is append-only, keyed by `run_id`.
Each record holds the start and end times, total wall time, the summed per-ROM wall
time, the config, the script hash, the source commit and dirty flag, the machine
(CPU, RAM, Java, Ghidra, load average) and one entry per ROM. A ROM entry has its
status, process wall time, analysis/discover/decompile ms, function and decompile
counts, and an error with a log tail when the ROM failed. Failed and timed-out ROMs
are kept in the record.

Timing semantics: `wall_s` is the whole `analyzeHeadless` process, including JVM
start, import, analysis, export and the project save. `analysis_total_ms` covers
setup, auto-analysis, discover and any explicitly requested return aid. The aid's
own timing is nested within that total on imports. `export_total_ms` includes `decompile_ms`. The
stages do not overlap except where noted. The run's `total_wall_s` is the critical
path, and `aggregate_rom_wall_s` is the summed runner work.
When auto-analysis is skipped, its duration is null and a separately named
`setup_to_export_gap_ms` records script-boundary overhead. For `--export-only`,
historical setup/discover metadata is retained but current analysis stage timings
are null; elapsed time since the original import is not reported as analysis.

## Seed file (capture coverage)

When `local/captures/<id>/coverage*.json` (or `seeds*.json`) exists, the runner passes
the first matching consolidated file to the pre-script. Otherwise it merges
`local/captures/<id>/*/coverage.json` across phases, taking only
`regions.rom.functions`. Basic-block starts and RAM code are not used as function
entries. The generated `<out-root>/<id>/capture_seeds.json` deduplicates address
and ARM/Thumb mode and records every source path, SHA-256 and call-target count.
`--seed-file` overrides automatic discovery for single-ROM runs. Accepted shapes:

```json
[{"addr": "0x08001234", "mode": "thumb"}, {"addr": 134218240, "mode": "arm"}, "0x08004567"]
{"entries": [...]}   // or "seeds" / "executed" / "blocks" / "functions"
[["0x08001234", "T", 52], ["0x08002000", "A", 9]]
{"regions": {"rom": {"functions": [["0x08001234", "T", 52]]}}}
```

A bare address with the low bit set is treated as Thumb. Compact array modes may
be `T`/`A` or `thumb`/`arm` (case-insensitive); addresses are aligned by mode.
Non-ROM addresses (for example IWRAM-resident code) are counted and skipped.
Direct capture JSON selects ROM call targets, not its numeric `blocks` summary or
basic-block arrays. Unknown modes, malformed input and missing configured files
raise errors instead of silently dropping the requested seeds.
The runner also requires successful seed counts in `setup.json`; a later export
cannot hide a failed seed setup.

Offline contract checks (no ROM analysis or network):

```sh
python3 -m unittest discover -s tools/re/ghidra -p 'test_*.py' -v
```

The optional Java parser checks use the existing JDK and Ghidra-bundled Gson;
they skip when those tools are unavailable. Local-capture checks also skip if the
ignored corpus is absent. No additional dependency or CI job is required.

## Measured integration limits (2026-10-16)

On Apple M5 Pro / macOS 27.0.1, Ghidra 12.1.4, OpenJDK 21.0.12.1, Emerald USA
SHA-1 `f3ae088181bf583e55daf962a92bb46f4f1d07b7`, source commit
`d431b8183f1001722d7bc9a326da28088930c344` with dirty tools:

- Run `20261016T003721-a02713`: one JVM, 2 GiB heap, 2 analysis CPUs, no final
  decompile or gap discovery; odd-pointer seeding `valid`. Setup completed in
  37.980 s, consuming 767 Thumb and 3 ARM capture seeds. The whole process timed
  out at 180.0 s during auto-analysis, so no function export or recall result
  exists. This run preceded the documented nonreturning-analyzer default fix.
- Run `20261016T004028-63ecf4`: same resource envelope, capture-only seeding
  (`--seed-oddptr off`) and `Non-Returning Functions - Discovered=false`. Setup
  completed in 1.166 s, creating 770 functions; auto-analysis still timed out at
  120.0 s before export. Different inputs and caps prevent a comparable
  before/after throughput measurement. No successful full-ROM baseline exists.
- The 770 unique capture addresses match 761 known Emerald function entries and
  9 explained assembly labels in the retained symbol-file heuristic, with zero
  unexplained addresses. This is only 4.80% of its 15,853 known functions. These
  numbers score capture seeds, not Ghidra discovery, whole-game coverage or
  ontology completeness.
- Eight offline seed/parser/process-cleanup tests passed in 1.701 s. They check
  real native capture parsing, all-phase merge, mode handling, source hashes and
  timeout cleanup, including rejecting an export after failed seed setup. They
  do not establish discovery precision.

Later bounded no-auto-analysis probes on the same machine/toolchain produced
actual pseudo-C for two games without a local decomp candidate:

| Pilot | Selected / available gameplay call targets | Process wall | Setup | Final decompile | Generated functions |
| --- | --- | --- | --- | --- | --- |
| Driv3r `20261016T004925-f78a5b` | 16 / 182 | 3.6 s | 107 ms | 306 ms | 18 / 18 |
| Crash `20261016T004944-a9605f` | 64 / 748 | 3.7 s | 387 ms | 711 ms | 66 / 66 |

These used one JVM, 2 GiB heap, 2 analysis CPUs, one decompiler worker, a
3-second per-function limit and a 120-second process cap. Seeds prioritized
gameplay-phase-new targets then high-call-count targets. Additional functions
include entry/startup code. Raw outputs and input hashes are under
`local/re/experiments/20261016-noanalysis-pilot/`. There were no generation
timeouts; however, 1/18 Driv3r and 48/66 Crash functions contained C warning
comments, and 7/18 and 2/66 respectively used `unaff_` registers. The pilots
preceded the IO-direction quarantine, so their old direction fields must not be
treated as verified facts. Their pseudo-C remains useful for targeted review.
Different games/seeds from the failed Emerald runs prevent a comparable
before/after throughput measurement; no whole-ROM performance claim is made.
The updated offline checks passed 13 tests in 1.623 s, including actual Java
helper compilation; the complete exporter also compiled successfully separately.

Attempt records (including launcher failures) are in
`local/re/experiments/20261016-capture-seed-smoke/index.json`; the second run and
`pokemon-emerald-version/capture_seed_truth.json` are under
`local/re/experiments/20261016-capture-seed-isolation/`. These retain script hashes,
machine/toolchain context and capture hashes. Queue time is unavailable for these
direct local invocations. Do not start the 33-ROM campaign based on setup success.

## Ground truth (Emerald)

`eval_groundtruth.py` scores entries against `pokeemerald.sym` from the `symbols`
branch of pret/pokeemerald. That file has no symbol-type column, and Thumb functions
appear at even addresses; odd addresses in it are script/data labels. Functions are
therefore taken to be the ROM symbols below the first `.rodata` marker that have an
even address and a non-zero size and are not pret `s`/`g` data names. That gives
15,853 functions. Size-0 labels in the hand-written asm areas are counted as
"explained" rather than as false positives, and they are excluded from recall.

## Caveats

- ARM routines that are copied to IWRAM/EWRAM at runtime are analysed at their ROM
  location, not their execution address. Their absolute IWRAM self-references
  therefore do not resolve to code.
- Function sizes are Ghidra body sizes. Literal pools and switch tables after a function
  are not counted.
- Only ASCII strings are detected.

## Optional saved-LR return aid (`--repair-returns`, default off)

Observed-code exports often call ordinary Thumb return epilogues "unrecovered
jumptables" when auto-analysis is disabled. `GbaReturns.java` is an explicitly
requested CFG aid. It accepts only a singleton `POP {rN}; BX rN`, with a Thumb
entry `PUSH` including LR, constant-SP propagation through the bounded function
CFG, consistent stack depth at merges, original saved LR at entry SP-4, and a
sole POP predecessor to the BX. Unsupported SP writes, direct SP-relative writes
to that saved slot, mixed instruction modes and functions over 512 instructions
are rejected. Arbitrary BX, MOV-PC dispatch and software-stack returns are left
alone. Callee stack balance and absence of indirect alias writes remain assumptions.

The script records candidates, accepted sites and exact criteria in `returns.json`
and sets `FlowOverride.RETURN` only at accepted instructions. It does not infer
correct argument/return types: `in_lr`, `CONCAT44(in_lr, ...)` and spurious
64-bit return signatures can appear after the CFG repair. Keep those artifacts
visible when mining claims. A reduction in warning count is not ABI recovery.

Use a separate experiment root. For an existing project, first copy its entire
`<id>/ghidra_project` into that root, then run, for example:

```sh
JAVA_TOOL_OPTIONS="-Duser.home=$PWD/local/re/ghidra-user" \
  python3 tools/re/ghidra/run_ghidra.py final-fantasy-tactics-advance \
  --export-only --repair-returns --jobs 1 --xmx 2G --max-cpu 2 \
  --decomp-threads 1 --decomp-timeout 3 --rom-timeout 90 \
  --out-root local/re/experiments/abi-return-pilot/source-control
```

Export-only processes the project read-only and discards program changes. When
an opt-in run would replace an existing export, the runner first copies the old
JSON exports into `<id>/prior-exports/<run_id>/`, recording bytes and copy time.
That prior export may itself be repaired; inspect its summary. No extra baseline
export or analysis campaign runs automatically. Imports can save overrides in
their selected project, so keep that project separate as well.

The summary identifies heuristic repair and its script hash, candidate/override
counts, timing and evidence file. `return_repair_ms` is nested in import
`analysis_total_ms`; it must not be added again. For a reused project, prior
analysis timings remain unavailable while current repair/export timing is recorded.
Requested repair without valid current-run metadata fails visibly even if a
later exporter succeeds.

Measured bounded controls on 2026-10-16, Ghidra 12.1.4 / OpenJDK 21 / Apple M5 Pro:

- Crash, same 751 functions: 523 overrides; warning-bearing functions 540→23,
  `unaff_` 13→0. All 42 recovered switch expressions and 347 case labels survived;
  four nonmatching indirect/large-switch controls were unchanged. Process wall
  time was 6.278 s; proof/override stage 238 ms. `in_lr` functions increased 3→503
  and `CONCAT44(in_lr,...)` 0→136, exposing remaining return-type artifacts.
- FFTA, same 1159 functions: 967 overrides from 980 candidates; warning-bearing
  functions 1015→53 and `unaff_` 21→9. Run elapsed was 8.9 s and process wall 8.8 s;
  repair stage 612 ms. Six ROM/source-mapped controls were checked: four leaf
  functions stayed unchanged; allocator and inventory epilogues lost false
  indirect calls, while incorrect 64-bit return inference remained. Inventory
  byte addition still wraps before its 99 cap. No full source equivalence or
  generated-C recompilation was established. One function outside the override
  owner list also changed because its generated CFG traverses repaired shared
  epilogues; per-function body lists do not bound all decompiler effects.

The baselines and comparisons remain under `local/re/experiments/abi-return-pilot/`.
Total-wall before/after speed comparisons are unavailable because the baseline
included import while controls reused projects. These controls do not authorize
or establish a repaired whole-corpus campaign.
