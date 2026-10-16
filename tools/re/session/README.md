# Headless GBA bot sessions

This is an isolated bot worker using the same mGBA emulator family as Vishal's
browser player. The browser player already supports ROM load, input, pause,
resume and checkpoints. This worker adds a persistent, bounded input/observation
loop for automated experiments without driving that human session or its saves.

Build against the existing Homebrew libmgba installation:

```sh
make -C tools/re/session
```

No SDK or Python dependencies are added. The native process has private in-memory
cartridge save data and a fresh output directory per run. An optional battery
seed is copied into that private directory before the emulator opens it; the
emulator never opens the source save. ROMs and generated binaries/artifacts stay outside Git. The implementation
uses mGBA's public core API; sidbot's persistent `bootshot` pipe was the design
reference, while game-specific RAM readers and policies remain separate.

Run the JSONL worker directly, or pass this argv after the playtester's
`--adapter-command` option:

```sh
python3 tools/re/session/bridge.py --rom /absolute/game.gba \
  --game-id metroid-zero-mission --out local/bot-sessions/new-session
```

`--out` must not already exist. `--initial-state /absolute/state.ss` loads a private
copy of an explicitly supplied native mGBA state. The worker then advances one
frame to reconstruct pixels; relative frame accounting starts at one. Native and
browser WASM state formats are not assumed interchangeable. The source state
hash is retained, but its original frame/provenance is unknown unless the caller
supplies those through a separate run record.

Each input line has a caller ID and an operation; each response repeats that ID.

```json
{"id":"1","op":"hello"}
{"id":"2","op":"observe"}
{"id":"3","op":"act","action":{"id":"right","keys":["RIGHT"],"frames":12},"max_frames":120}
{"id":"4","op":"checkpoint"}
{"id":"5","op":"close"}
```

`hello` declares isolation, adapter/source/native hashes, ROM SHA-256 and supported
operations. `observe` writes a 240×160 PNG and returns its reference/hash, relative
frame count, and a quantized screen state key. `act` supports the ten GBA buttons,
including combinations, and advances at most 120 frames before releasing them.
The command timeout defaults to ten seconds. The parent playtester owns episode,
model-call and total frame/wall limits and process-group cleanup.

`checkpoint` returns an opaque session-local token and frame. Send
`{"id":"6","op":"restore","checkpoint":"TOKEN"}` to restore it. At most 31
checkpoints are retained. The first observation after restore is the exact saved
image; subsequent actions render new frames. A raw state does not contain the
external video buffer, so this avoids silently presenting stale pixels.

The screen state key is weak novelty evidence. Animation can change it, and an
unchanged image can hide state changes. No position, objective, collision,
progress, success or gameplay phase is invented: those fields stay empty/unknown
until a game-specific reader is implemented. The generic bot records action
probes and barrier hypotheses rather than declaring a ROM playthrough complete.

## Verification recorded 2026-10-16

Two real-ROM smoke checks (Zero Mission and Emerald) loaded, advanced inputs,
captured observations and replayed the same input from a private checkpoint.
Replayed image hashes matched in both cases and ROM hashes remained unchanged.
The checks took 0.154476 and 0.050911 seconds on this machine; they are bounded
120-frame native checks, not game completion or gameplay speed benchmarks.
Incremental native builds took 0.065229 seconds for this worker and 0.239934 seconds
for the corrected capture tool. There is no comparable prior interactive-worker
baseline. Queue timing was unavailable.

The first checkpoint check failed because `mCoreSaveStateNamed` maps raw state
files read/write; opening them with `O_WRONLY` cannot satisfy that operation.
Both tools now use `O_RDWR`. Historical capture records with `savestate: false`
and zero-filled state files are not valid checkpoints and are not repaired in
place. RAM dumps, frame observations and coverage from those runs are separate
artifacts. The failed check is retained beside the successful checks under
`local/re/experiments/playtester-session/`.

API reference: [mGBA 0.10.5 serialization implementation](https://github.com/mgba-emu/mgba/blob/0.10.5/src/core/serialize.c).

## Source RAM and actual video, version 2

`--memory-profile PATH` accepts a ROM-SHA-256-pinned source observation profile.
Read-only `read_memory` is restricted to IWRAM/EWRAM, at most 256 bytes per
request; no memory writes or I/O register reads are exposed. `hello` additionally
reports the actual linked libmgba version, clock frequency and frame cycle count.

```json
{"id":"7","op":"read_memory","address":50336724,"length":32}
{"id":"8","op":"record_start","stride":2}
{"id":"9","op":"record_stop"}
```

Recording retains actual emulated frames, then encodes H.264 with the existing
ffmpeg installation. It records no audio and removes temporary raw frames only
after successful encoding. Explicitly stop recording to obtain its MP4 metadata.
See `tools/gba_playtest/README.md` for the bounded source-aware episode runner,
retained baseline failures and actual compiled-candidate screenshots/video.

## Bounded native options and source boundaries

The direct Python session API supports `configure_watches([{name,address,bytes,mask}])`
for up to 32 read-only RAM fields (1, 2 or 4 bytes). Only version-pinned game adapters
choose these addresses. C samples every watched field after every emulated frame
and ends the selected action at the first changed masked value, including a
change on its final requested frame. This is a frame-boundary observation, not
an instruction-level trace; changes that occur and revert within one frame are
outside this guarantee. Existing callback/export breakpoints remain active.

Sonic's adapter additionally accepts `max_option_frames` (default 120, bounded 3600)
and `motion_sample_frames` (default 120, at most 120). Extended options require
currently discovered task-owned source state. Stage, equipment, health, deaths,
gates, relics, active state and attachment changes return control to the existing
S1/confidence-to-S2 decision path. Unchanged position at a periodic motion sample
also ends the option. No model decision is inferred from a cached confidence.
A fresh A release remains inside the selected budget; B retains its source
charge/release behavior. Profiles and configured limits must explicitly offer
longer options; defaults remain short.

`python3 -B -m tools.playtester.benchmark_native_options --help` exposes an opt-in,
no-model paired replay benchmark. It uses an explicit baseline Git ref, private
ROM/state, a fresh private output directory, at most 3600 frames and three paired
repetitions. It adds no CI stage or dependency. Its source-watch/frame checks and
synthetic integrity tests cost under one second locally. The retained
[paired receipt](../../../verification/native-option-throughput-20261016.json)
compares identical held RIGHT inputs and exact end pixels/progress. The warm pair
reduced total wall from 0.164217s to 0.131485s; observation work fell 0.040554s to
0.007819s while action work remained 0.088597s versus 0.088548s. These are replay
measurements with zero model calls, not campaign or end-to-end model speed.
Command timings include native execution and IPC; PNG/read timings overlap
observations and must not be added again to parent totals. Model, queue and
build timings are unavailable for the replay; actual experiment reports now
separate S1/S2 wall, frames per action/call and playtest end-to-end speed from
native action speed.


`NativeSession(..., initial_save=path, expected_initial_save_sha256=sha256)`
starts from a private battery-save copy loaded through mGBA before reset.
`initial_save` and `initial_state` are mutually exclusive. A mismatched supplied
SHA-256 fails before session allocation. The save must contain between one byte
and one MiB; a game's provider remains responsible for its format and exact ROM
compatibility. Initial-save provenance records the source identity, size and
hash without copying any payload into reports. JSONL CLI equivalents are
`--initial-save` and `--initial-save-sha256`. Native checkpoints still include
isolated cartridge save data and can restore subsequent progress normally.

The focused 2026-10-16 battery test booted 600 native frames from the explicitly
supplied private SID Emerald save and replayed the same input from a native
checkpoint with matching final pixels (0.123976 seconds total). Source ROM/save
hashes remained unchanged. This checks startup/isolation/checkpoint behavior;
RPG navigation and model timing require their separate scenario qualification.
