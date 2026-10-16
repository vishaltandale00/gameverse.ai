# Observed compressed asset evidence

The capture harness observes BIOS LZ77 SWIs `0x11` and `0x12` before calling
mGBA's original HLE handler. It reads r0/r1 and native ROM header bytes without
bus accesses, then optionally copies the destination bytes immediately after
the synchronous HLE handler returns. No new dependency or CI stage is required.

```sh
make -C tools/re/capture
python3 tools/re/capture/run_captures.py --ids pokemon-emerald-version \
  --jobs 1 --timeout 30 --asset-trace-limit 64 \
  --asset-snapshot-max-bytes 65536 --out local/captures-experiments/assets-example
python3 tools/re/assets/decode_loaded.py \
  --capture-root local/captures-experiments/assets-example \
  --out-root local/re/experiments/assets-example --write-output
python3 -B -m unittest discover -s tools/re/assets -p 'test_*.py'
```

Each phase's `loaded_assets.jsonl` retains source, destination, SWI, native
header, advertised output size, first/last frame and call count. First/last
contexts contain raw PC/LR and ARM/Thumb mode before HLE. Prefetch and return
address normalization is unverified: these registers are evidence for later
disassembly checks, not asserted callsite addresses. Deduplication is by
SWI/source/destination, so intermediate callers are not retained.

Trace defaults to 64 unique records per phase (maximum 4096); `0` disables it.
Calls for new tuples beyond the cap remain counted as omitted calls. Trace-off
counters describe observations collected, not the game's actual LZ77 use.
Snapshots default to off and have a configurable per-entry limit up to 1 MiB.
Only canonical EWRAM, IWRAM and VRAM destinations are supported; palette memory,
mirrors and out-of-range writes retain an unsupported status. Snapshot bytes
and decoded bytes stay in ignored `local/` output, along with ROM material.

The stdlib decoder reads only observed sources, validates the capture/index ROM
SHA-1, applies input/output/record/total-output budgets, hashes compressed and
decoded content, and compares optional snapshots byte for byte. The default
budgets are 1024 use records, 64 KiB decoded per source, 1 MiB compressed input
per source, and 16 MiB total unique decoded bytes. Repeated sources are cached.
Keep output under `local/`; do not commit ROM or decoded payload bytes.

A validated decompression is an observed loaded payload. It does not by itself
prove tile, map, audio, story or code semantics. RAM staging may precede later
transforms; VRAM use alone does not establish visible rendering. Source mapping
or additional format/use evidence must justify those classifications. Repeated
calls have counts, but snapshots validate only the first recorded use. RLE,
Huffman, software decompression and raw/DMA transfers remain outside this channel.

The hook was checked against the original
[mGBA 0.10.5 BIOS implementation](https://github.com/mgba-emu/mgba/blob/0.10.5/src/gba/bios.c).
Its LZ77 stream uses a `0x10` header, a 24-bit decoded size, MSB-first flags and
overlapping backward copies. Three offline tests cover literal/backreference
decoding, overlap and malformed/budget-limited streams.

The local pilot is recorded in
`local/re/experiments/20261016-loaded-assets/comparison.json`. Identical scripts,
ROMs, harness binary and context ran serially: tracing off took 17.83 s; tracing
plus 64 KiB snapshots took 18.49 s for three games (+0.66 s, 3.7%). This is one
ordered pair with uncontrolled cache/concurrent work, not a stable latency
budget. Incremental build took 0.296 s. The independent decode took 0.275 s:
378 use records, 213 source streams, 371 snapshot matches, zero mismatches and
seven unsupported palette destinations. Raw-context fields were added after
that pair and verified separately on Emerald: 135 snapshot matches, zero
mismatches; rebuild 0.293 s. Exact provenance, measured durations and source
links remain in the local reports. No corpus campaign was triggered.
