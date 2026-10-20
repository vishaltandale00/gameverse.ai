# FireRed native field movement source stage

`stage_field_movement(base, donor, out, report_dir)` patches an already isolated
Emerald tree after map semantics and map runtime, before campaign integration.
It reads the canonical source checkouts without changing them.

The stage extracts FireRed spinner direction retention and forced-tile dispatch,
Cycling Road bicycle state/transition handlers, directional stair warp setup and
entry/exit tasks, and boulder fall/reveal and Victory Road switch callbacks. It
adds the missing object movement handlers and exact standing-frame spin animation
sequences to the host player animation table. The avatar's last-spin field is
appended, preserving existing host field offsets. Source hashes and individual
provider functions are retained in the ledger.

The movement action header allocates native WALK_SLOWER, SPIN, slow-run and
WALK_SLOW IDs beyond the host's existing actions. WALK_SLOW requires a native
provider even though both engines use that name: FireRed advances on two of every
three frames, whereas Emerald advances every other frame. Script translation must
include `constants/whole_game_fr_movement.h` before generic donor constants.

Three focused tests pass, including an executable C harness built from staged
native functions. See source-check.json for exact scope and timing. The new source
transform has no comparable prior-stage baseline. Build/queue durations are
unavailable; no ROM build or emulator campaign was performed.

This remains an incomplete admission ledger. The native FireRed forest-map-preview
fade gate is unavailable. Its exact conjunction with weather readiness remains
in source and requires `FR_ForestMapPreviewScreenIsRunning`; no readiness fallback
is supplied. Full compiled ROM/rendered spinner and stair qualification
also remains unrun. Native quest-log, encounter, region-map suppression-state and
script-bank dependencies must be satisfied by their respective stages.

The first keep-going native build exposed C89 declaration-order errors that host
syntax checks missed. Regional dispatch now encloses the original function body
in a block so declarations remain first and host initializer timing is preserved.
Donor camera reset functions map to audited host reset/freeze operations with the
same camera states and callbacks. Targeted compilation of bike, field control,
player avatar and screen effects with the retained build's actual CPP, preproc
and agbcc flags now passes. `agbcc-check.json` retains commands, per-TU timing and
results; no retained build output or canonical checkout was edited.

VS Seeker responses now append native raise-hand stop/jump/swim movement types
81–83 and actions174–176, X/double-exclamation actions177–178, and effect IDs67–68.
The original emote PNG, 2-by-2 conversion recipe, image/animation tables and sprite
follow/despawn callbacks are preserved. Effect scripts use host macro spellings
with the same native command bytes3/4. Source-native slower wandering is type84;
its raw donor80 would collide with Emerald's slow in-place-right type. Range,
initial-facing and callback dispatch tables include the new types (NUM85).

Four focused tests pass, including124-frame jump,64-frame swim, stop completion
and emote identity/position/lifecycle checks. `vs-movement-agbcc-check.json` covers
the new movement source closure against actual typed engine APIs, the complete
emote provider TU with actual converted graphics, and native field-effect ARM
assembly. The follow-up `vs-movement-combined-agbcc-check.json` uses the map-runtime
owner's corrected private source: the complete combined object-engine TU passes
actual agbcc and ARM assembly, alongside native icon/provider symbols verified
with nm. Inputs remain unchanged. This does not qualify a linked ROM or rendered
animation.
