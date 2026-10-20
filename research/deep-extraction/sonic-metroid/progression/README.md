# Source-derived progression candidate

`progression.c` replaces the existing composition progression module. Compile it
with `progress_adapter.c` and the two emitted `generated/mzm_progress/*/component.c`
files; include this directory and the original Sonic+MZM component directory.
Packaging provides `GvProgressState *gv_progress_state(GvState *)`, returning a
4-byte-aligned, zero-initialized, persistent 36-byte suballocation. The agreed
packaging allocation is1600bytes with this suballocation at1536. Existing
`GvState` fields are unchanged. Stage transitions retain it; a fresh game clears
it with the owning task. Loading older snapshots is unsupported.

The portable emitted code comes from `tools/behavior_ir/emit.py`, lowering the
existing serialized qualified L1, not a handwritten substitute. Both emission
receipts pin L1/package/qualification/emitter/lowerer identities. Existing
original-instruction qualification is retained; this task did not run a ROM.

| GV reward index | Emitted acquisition argument | Source equipment lane/mask | Source event queried |
|---|---|---|---|
| Morph0 | authored event set | no source acquisition lane | private64 |
| Missile1 | authored event set | no source acquisition lane | private65 |
| Bomb2 | 0x29 | beamBombs0x80 | 9 |
| High jump3 | 0x2d | suitMisc0x01 | 18 |
| Ice4 | 0x25 | beamBombs0x02 | 10 |
| Varia5 | 0x31 | suitMisc0x10 | 19 |
| Speed6 | 0x2b | suitMisc0x02 | 11 |
| Screw7 | 0x2f | suitMisc0x08 | 21 |

`080138d8.c` directly supports the six acquisition arguments and field/event
writes. Names are corroborated against the local own-source baseline:
`local/game-builds/mzm-us-baseline/include/constants/samus.h`,
`include/constants/event.h` and `src/sprites_ai/chozo_statue.c`. The exact hashes
are in `host-receipt.json`. The baseline names annotate the recovered behavior;
they do not replace it. Morph writes elsewhere in the original source are outside
this recovered acquisition function. Missile capacity is not an equipment bit in
this recovered function. Thus morph/missile use two explicitly authored private
campaign event meanings, implemented using the emitted source event module.
Original MZM campaign meanings of IDs64/65 are not claimed here.

Acquiring a source reward invokes the emitted acquisition function, which writes
both equipment and its original events (including the additional high/varia/screw
statue events). The emitted event function then reads the SAME persistent bank.
The adapter projects these outputs into existing GV bits, so movement, weapons,
return variants, heat and gate checks consume recovered outputs. Equipment bits
without their source acquisition event do not grant the projected reward.
Repeated event acquisition does not increment relic counts or reapply capacity
bonuses. Existing spatial pickup triggers, picked/opened ledgers, gate geometry,
messages, missile capacity10 and Varia bonus50 remain authored game policies.
Return caches and gates retain their existing authored requirements, now driven
by the source projection.

Run `python3 research/deep-extraction/sonic-metroid/progression/verify.py` for the
bounded host adapter check. Its10256 synthetic vectors cover event low-byte
bounds and aliases, read/set/clear/toggle operations, preservation of other bank
words, all eight reward projections in forward/reverse order, invalid rewards,
deduplication, and equipment/event disagreement. These are host API tests, not
controller input, rendered play, ROM parity, save migration or end-to-end gameplay.
The emitted lowerer currently includes unused scope labels; the host compile
uses a scoped clang diagnostic wrapper for only that warning; Wall/Wextra/Werror remain enabled. Each emission receipt records the exact pre-wrapper hash and transformation. No dependencies
or CI stages were added. Actual host/syntax timings and unavailable queue/full
build measurements are retained in the receipt. Full native build and gameplay
latency comparison is the integrating task's responsibility.
