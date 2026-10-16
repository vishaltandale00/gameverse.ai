# GBA capture harness

Headless capture of GBA ROMs against Homebrew libmgba 0.10.5. It records the
evidence used by the component ontology and builds a hot-code map to guide
Ghidra. Outputs go to `local/captures/` (git-ignored).

## Build and run

```sh
make -C tools/re/capture                       # ~1 s; produces tools/re/capture/build/gba-capture
python3 tools/re/capture/run_captures.py       # all ROMs in local/re/roms.json, 8 at a time
python3 tools/re/capture/run_captures.py --ids mario-kart-super-circuit,driv3r --jobs 2
python3 tools/re/capture/run_captures.py --harness-args "--mp4"   # also encode one mp4 per phase
```

You can also call the harness directly:

```sh
tools/re/capture/build/gba-capture --rom local/roms/X.gba --out local/captures/x \
  --phase attract --frames 3600 \
  --phase frontend --frames 5400 --inputs "180:6:START,270:6:A"
```

The flags are `--no-coverage`, `--no-png`, `--no-wav`, `--mp4`,
`--keyframe-interval N` (default 120), `--scene-threshold X` (default 18) and
`--version`.

## Input scripts

`scripts/default.json` defines the phases. Each phase starts from a fresh core:
a cold boot with mGBA's HLE BIOS and skip-BIOS, no save file, and the RTC fixed
at 2024-01-01. `scripts/<id>.json` can override phases by name, and fields
replace the default fields. A phase has `frames`, explicit `events`
(`{"frame", "keys", "hold"}`) and an optional `repeat` block
(`from_frame`, `until_frame`, `period_frames`, `events` with `offset`). Key names
are A B SELECT START RIGHT LEFT UP DOWN R L. The default phases are:

- `attract`: 3600 frames (about 60.3 s) with no input.
- `frontend`: 5400 frames (about 90.4 s). START is pressed at frame 180 and every
  180 frames after that, and A is pressed 90 frames after each START. Each press
  lasts 6 frames.

## Outputs per ROM (`local/captures/<id>/`)

| file | content |
|---|---|
| `summary.json` | ID, SHA-1, outcome and errors, wall time per phase, emulated fps, a derived summary (modes, sprites, raster, affine and blend flags, sound, top-10 SWI calls, coverage size) and the run context (commit, harness hashes, libmgba version, machine) |
| `<phase>.wav` | 16 kHz mono s16 WAV, resampled from libmgba's blip output with blip_buf band-limited resampling and an L/R average |
| `<phase>/phase.json` | all per-phase counters, including the HBlank and special-timing DMA configs |
| `<phase>/telemetry.csv` | Run-length-encoded per-frame video registers, sampled at VBlank start. A row is written only when a value changes, and the final `end` row closes the last run. It includes DISPCNT, DISPSTAT, BGxCNT, the BG2 and BG3 affine registers, BLD*, MOSAIC, WIN*, OAM counts and a visible-sprite size histogram in `obj_sizes` (the order matches `phase.json` `obj_size_visible`). It also has the HDMA and CPU-raster group bitmasks (bit order: dispcnt_bgcnt, bg_scroll, bg_affine, window, mosaic, blend, palette, other), the enabled HBlank DMA channels, the HBlank and VCount IRQ enables, and IE. |
| `<phase>/audio_events.csv` | Change events: master enable, DirectSound A/B activity, the FIFO sample rate in Hz inferred from the timer that drives it, PSG channels playing (bitmask) and PSG note triggers in that frame |
| `<phase>/coverage.json` | executed code for ROM, EWRAM and IWRAM. `functions` holds `[addr, mode T/A, hits]` call targets. `blocks` holds `[addr, mode, entry_hits, bytes, max_hits]`. |
| `<phase>/keyframes/fNNNNNN[_scene].png` | One PNG every 120 frames, plus scene changes: a mean absolute luma difference of at least 18 on a 30x20 grid, at least 30 frames after the previous keyframe |
| `<phase>/state.ss`, `ewram.bin`, `iwram.bin` | end-of-phase mGBA savestate and raw RAM dumps |

`local/captures/index.json` holds the latest run record and every ROM summary.
`local/captures/runs.jsonl` appends one record per run, failures included.

## Method notes

- **Coverage.** The harness steps the CPU one instruction at a time with
  `ARMRun` instead of `runFrame`. It increments a direct-mapped hit counter for
  every 16-bit ROM, EWRAM and IWRAM slot, so there is no hashing. A block start
  is a non-sequential PC or a mode switch. A call target is a block start where
  LR was rewritten by one of the previous two instructions, LR points just past
  one of the last three executed instructions, and the PC is not LR (which would
  be a return). This catches BL/BLX, `mov lr,pc; bx`, and `bl` to a `bx rN`
  veneer. ROM mirrors fold to 0x08000000. Code in RAM can be overlaid, so a RAM
  address can mix routines. mGBA's idle-loop detection is left at its default,
  so some busy-wait loops are skipped while the CPU halts.
- **Raster.** The harness wraps libmgba's `store8/16/32/storeMultiple`. A write
  to the video registers (0x04000000-0x57) or to palette RAM is classified by
  scanline (VCOUNT). A write made while `performingDMA` is set by a channel with
  HBlank timing counts as HDMA. A CPU write on a visible line (0-159) counts as
  a mid-frame raster write, as from an HBlank or VCount IRQ handler. A derived
  `hdma_*` flag needs at least 10 frames with at least 32 rewritten lines. A
  `cpu_raster_*` flag needs at least 10 frames with at least 4 lines.
- **SWI.** The harness wraps `irqh.swi16/swi32` around mGBA's HLE BIOS. SWI 0xF0
  is mGBA's internal HLE stall hook. It is reported as `mgba_hle_internal` and
  left out of the totals.
- **Sound.** DirectSound is active in a frame when the master enable is on, the
  FIFO is routed, and the FIFO was written or a special-timing DMA1/2 targets
  it. Its rate is 2^24 / prescale / (0x10000 - reload) of the selected timer. A
  PSG channel counts as playing from libmgba's `playingChN` flag plus its L/R
  routing. Triggers are writes with bit 15 set to NR14, NR24, NR34 or NR44.
- **Sprites.** OBJ entries that are fully zero (attributes 0-2), or identical to
  the previous entry, are treated as cleared fill patterns. "Visible"
  means not disabled, not an OBJ-window sprite, and on screen.
- **ABI coupling.** The harness reads internal structs (`struct GBA`,
  `ARMCore`) through libmgba's installed internal headers, with `mgba/flags.h`
  included first. Rebuild and re-validate if libmgba changes.

## Measured cost

These numbers come from an Apple M5 Pro (18 cores, 64 GB) running macOS 27.0.1,
with Homebrew libmgba 0.10.5 and harness 0.1.0. They were taken on 2026-10-15
with the default script of 9000 frames per ROM.

- Build: a clean `make` takes about 0.8 s (one C file).
- Full set: 33 ROMs with 8 jobs took 21.2 s and 21.9 s
  (runs `20261015T234348-d22b42` and `20261015T234415-8f46cf`). Per-ROM wall
  time was 1.6-6.8 s, and aggregate ROM wall time was about 140 s. An earlier run
  of 40.7 s happened while the machine was busy with other work (load average
  above 15).
- Coverage overhead: the harness was run with `--no-png --no-wav`, serially,
  with 3 repetitions. Emulation time rose from 3.40 to 4.30 s for
  mario-kart-super-circuit (+26%), from 2.42 to 3.70 s for pokemon-emerald-version
  (+53%) and from 2.32 to 3.38 s for driv3r (+46%).
- WAV output (16 kHz drain, mix and write) costs about 6-8 ms per 9000 frames,
  which is under 1%. libmgba synthesises audio either way, and its public API
  cannot turn that off, so that part of the cost is not separable.
- PNG keyframes cost about 0.3-0.9 s per ROM at the default rate.
- `--mp4` costs about +1-2 s per ROM (+20-50%) because of the pipe to ffmpeg
  libx264 ultrafast, so it is off by default.
