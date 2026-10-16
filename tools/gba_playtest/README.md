# Source-aware real GBA playtesting

This worker runs the full compiled `.gba` artifact through persistent native
libmgba. It is independent of the human browser session. The browser continues
using `GbaAdapter`; this tool adds inexpensive bot observations and recordings.
It never substitutes the earlier JavaScript prototype for a GBA result.

No Python packages, SDKs or CI jobs are added. Existing libmgba and ffmpeg are
used. Each episode has a fresh private directory, RAM-only reads, private saves,
short input durations and explicit frame/policy-iteration/model/wall limits. Model
keys come from the runtime environment or an explicitly named ignored env file;
no keys appear in reports. No automatic provider fallback or retries occur.

Build the worker, derive a ROM-hash-pinned observation profile from the **same
candidate's** linked ELF, then record one bounded encounter-return episode:

```sh
make -C tools/re/session
python3 tools/gba_playtest/mzm_profile.py \
  --rom local/game-builds/mzm-emerald-encounters-v1/mzm_us.gba \
  --elf local/game-builds/mzm-emerald-encounters-v1/mzm_us.elf \
  --source-root local/game-builds/mzm-emerald-encounters-v1 \
  --source-commit 9caaefc0ee570f3399d86acf140fdeada9692836 \
  --out local/gba-playtests/my-profile.json
python3 -m tools.gba_playtest.run \
  --rom local/game-builds/mzm-emerald-encounters-v1/mzm_us.gba \
  --profile local/gba-playtests/my-profile.json \
  --build-receipt local/game-builds/mzm-emerald-encounters-v1-receipt.json \
  --source-commit 9caaefc0ee570f3399d86acf140fdeada9692836 \
  --kind candidate --game-id mzm-emerald-encounters-v1 \
  --qualification-scope encounter-return \
  --out local/gba-playtests/my-new-episode --max-actions 18 --max-frames 6000
```

`--out` must be new. `--kind baseline` labels the indexed/original ROM separately.
`--max-actions` bounds outer policy iterations, not the number of native commands:
boot uses at most 60 bounded iterations, and a menu action may issue several short
taps with feedback. All inputs also obey the total frame and wall-time budgets;
individual native action duration is at most 120 frames. Reports retain the full
native command list, so this distinction remains observable.
A supplied initial native state is identified by hash; its prior frame must be
obtained from its source run, not inferred from the state file. Browser WASM and
native checkpoints are not assumed interchangeable.

The profile records source and ELF hashes, actual linked symbols, fixed-width
struct offsets and units. ROM-hash mismatch fails closed. A gameplay mode alone
is insufficient: the landing sequence uses the same mode. The boot policy checks
pose, movement-lock timer and standing status; a later action-conditioned source
position change witnesses actual control. Screen hashes remain novelty hints.

Candidate native combat observations include active/result, party indices,
HP/PP, selected move, turn, menu selection and source world position. Every menu
tap is followed by reading native selection; predicted tap counts were found
unreliable. The encounter-return scope demonstrates movement, jumping, native
party switch, actual attack and restoration of exploration after retreat. It
makes **no victory or full-campaign completion claim**. `--qualification-scope
battle-victory` is a separate, bounded attempt that may fail.

## System 1 and System 2

The configured short-probe policy is disclosed as a source-aware hypothesis.
`--decision-provider d1 --max-decision-calls 4` uses the existing local Decisions
client with `LITELLM_API_KEY`. `--decision-provider openai` explicitly selects
OpenAI with `OPENAI_API_KEY`. The initial control and coupling probes remain
fixed; models choose among the same bounded legal inputs after those probes.
Low confidence is recorded and rejected rather than mistaken for certainty.

Optional slow reasoning uses the existing `ChatPolicy` when a decision is unclear
or repeated source-state transitions stall. Enable it with `--max-llm-calls 1`
and explicit `PLAYTEST_LLM_BASE_URL`, `PLAYTEST_LLM_MODEL`, and
`PLAYTEST_LLM_API_KEY`; the default zero budget makes no LLM calls. The caller
chooses provider and credentials independently. The configured local policy is
retained when models decline and the slow budget is disabled or exhausted; this
fallback is logged as such. Models cannot issue arbitrary commands or RAM writes.

## Retained evidence, 2026-10-16

- `local/gba-playtests/baseline-worker-qualification-1792130966030515000/`:
  first old navigation script remained in the prologue; retained as an observed
  navigation failure, with an actual video, rather than claimed player control.
- `local/gba-playtests/baseline-bounded-native-1/`: cold boot and 14 short probes,
  real right/left/jump source-state witnesses, 0.636 s total on this machine.
- `local/gba-playtests/candidate-native-v1/`: actual encounter, combat and defeat
  followed by restored native exploration; failed to win. One-frame menu taps
  sometimes missed their intended selection and were replaced with bounded
  feedback from source RAM.
- `local/gba-playtests/candidate-native-d1-v3/`: one local d1 call returned a valid
  response but confidence 0.318 was rejected. The explicit source-table fallback
  completed encounter-return. 1.310 s total, no slow LLM calls. This is not
  evidence that the model successfully played the encounter by itself.
- `local/gba-playtests/candidate-native-final-v4/`: native candidate ROM SHA-256
  `937786e9019d3f46ba58a0da7c06012f1244a49204da844e1c095a22c8c09994`;
  cold boot, actual movement/jump, party Bulbasaur→Squirtle, Surf move 57,
  PP 15→14, opponent HP 51→41, frozen world during combat, SELECT retreat and
  source-world movement restored. All nine declared coupling/control witnesses
  passed. 0.696 s total including 0.046 s video encoding; victory was not observed.

Every run stores `run.json`, `trace.jsonl`, actual 240×160 PNGs and an MP4.
Video samples every second real emulated frame at 29.86375 fps, preserving game
speed; no interpolation or audio. Temporary raw frames are deleted after
successful encoding. The final recording is 214 frames / approximately 7.17 s,
331844 bytes. Queue time is unavailable. Total wall time contains boot, emulator,
model and encoding work; nested timings must not be added. These runs have
different scope and are not a before/after throughput benchmark.
