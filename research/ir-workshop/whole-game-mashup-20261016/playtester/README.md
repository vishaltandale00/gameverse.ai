# Native whole-source model playtester

Status update: the user rejected the paired-ROM host and now requires one standalone mashup `.gba`. Paired-run evidence below is retained engineering history, not an accepted game deliverable. No further paired model calls are planned. The decision loop, read-only source observations and native stepping will be reused against the actual single-ROM build once available.

The integration uses the existing `tools.playtester` controller, Decision-AI
System1, and Multimodal-AI System2. `tools.whole_game.pilot --full-scenario`
returns a System2 hypothesis to the next System1 context and permits repeated
System2 rounds under overall wall/frame/action/decision limits. A round count
never certifies a scenario. Any stop without an observed objective is partial
and retains a final native/composed checkpoint before replay verification.

The explicit `--sid-env-file` option reuses sidbot's existing `SID_LLM_URL` and
`SID_LLM_KEY` references in memory. Environment settings take precedence. No
secret is printed, persisted, or included in game evidence. The model service
and native screenshot/RAM payload were explicitly authorized by the user after
an automatic review initially rejected a later network replay. The failed
sandbox transport run is retained separately; credential absence was not the
cause.

`adapter.py` verifies the full-source candidate bundle and exact ROM/ELF hashes.
Native mailbox writes require the source `gWholeGameBridge` symbol's actual
ELF address and size. The native process accepts writes only in that span;
there is no public bot JSONL memory-write operation. A per-frame source export
READY breakpoint interrupts longer batches. Both native states and source
transaction lifecycle are owned by `CompositionSession`, with portable
exact-bundle checkpoints accepted through `--resume-checkpoint`.

## Recorded original-engine control

`baseline-loop-evidence.json` records actual 12 System1 + 12 System2 calls,
12 chosen inputs, and 1,324 native frames. Wall time was 15.960649 seconds;
policy time was 15.558618 seconds and native action time 0.372983 seconds.
Checkpoint replay matched all 13 observations (frame, state key, image hash,
and facts), with no new model requests. It stopped at the configured step
budget and is explicitly `partial_requires_resume`. This is a boot/menu
control fragment, not field, cross-region, capture, or campaign qualification.

`native-speed-baseline.json` records 3,600 native frames in 0.790070 seconds,
about 75.943 nominal 60 Hz simulation seconds per native wall second.
The illustrative 40x figure is not a requirement. Native simulation speed is
separate from model latency. No comparable full-source candidate measurement
was available when that baseline was collected. Provider queue time and dollar
billing are unavailable; token counts are not a bill.

The narrow controller regression suite passed 30 tests, including repeatable
System2 rounds and counting native integration frames against global limits.
A real original Emerald checkpoint/input regression also passed. No browser,
CUA, Puppeteer, manual browser play, or scripted policy substituted for model
choice was used.
