# Superstar Saga retained-artifact inventory

This packet adds ten discovery targets, eight with existing HighFunction L0. None is native-qualified or a usable game mechanic closure. All five Mario games remain partial. Source is the exact 16 MiB A88E revision-0 ROM, SHA256 `af9066e7eacdab919e92987db8856d038e4b75d4ed011259c893702085a886be`, SHA1 `7c303cdde5061ee329296948060b875cb50ba410`. Community decompilations were not read or used for these rules.

`targets.json` follows the existing mechanics-discovery target layout for append review. `reviewed-export-records.json` retains only the ten own-ROM function records used for the stated rules. Instruction spans are hashes of the contiguous exported size, with candidate-boundary uncertainty explicit. These byte hashes establish identity, not correctness of a function boundary or mechanics label.

## Concrete causal chain

The strongest bounded transaction is `080401f0 → 080402c4 → 08047eb8`. The initializer sets acceleration/default parameter fields and the update integrates actor+18 from+258, decreases+258 by+248 and terminates against zero or the saved baseline. Reset clears active motion fields and restores saved+23e. `08046a10` repeats the reset under contact bit+2b5:8 and restores a temporary parameter; `08046980` clears the other contact flags and rounds coordinates to a 0x100 boundary. This supports a candidate vertical-motion/contact lifecycle. Calling it a recovered jump, a complete character controller, or calibrated gravity would overstate the evidence.

`0802c390` adjusts signed actor+244 by eight under actor/global flags; it is called near the start of `0802476c`, which also invokes the vertical update. The scheduler keeps live r10 and nested actor pointers at+200/+204; independent copies would discard potential alias relationships. Physical quantities, actor roles, terrain flags and tick cadence need native calibration.

Main input `08018920` has ten-key masking, press/release edges and a fixed eight-counter repeat loop. The retained census rejected it for an unbounded/unaligned collection. Slot index range, stride0x14 and eight mask entries at0839ec6c are explicit next contracts; neither a controller closure nor a battle timed-action system follows from this service alone.

## Separate embedded engine

The ROM contains an embedded header at `08f500a0`: title `SUPER MARIOD`, code `AX4E`, separate from the outer `MARIO&LUIGIU` / `A88E`. The high-ROM code has its own held/pressed inputs at03001774/776, boot entry `08f505e8`, frame schedulers `08f5b9e8` / `08f5c2dc`, four-slot input pool030054cc/ce and callback tables08f9f984/08f9fa58. These are independent evidence for an embedded engine candidate, consistent with the bundled Mario Bros investigation. Title launch reachability, exact engine equivalence, player controller, terrain, enemies, waves, resources and persistence have not been qualified.

The 800-function census stops below0806670c and exports no HighFunction for this high-ROM island. Therefore its 46 static lifts and zero qualified behaviors say nothing about bundled-engine mechanic coverage. The existing frontier's consumer list also omits the high-ROM consumers even though it lists input root08f50bc0. Reuse the retained binary export; do not infer absent input consumers from that frontier.

## Bounded next dispatches

1. Reuse `08047eb8` L0 and static candidate316 as the leaf, then reuse `080401f0` candidate249 and `080402c4` L0 for the three-entry transaction. Bind a symbolic actor with alias-preserving byte/halfword views. Inspect original native return instructions first; the pseudo-C often reports spurious unresolved tail calls. Compare original/emitted state and untouched bytes for -1/0/positive tick, both+20d modes, signed defaults and termination boundaries. These are proposed fixtures, not executed results.
2. Extend to contact reset `08046a10` candidate284 and coordinate quantization `08046980` candidate283 only after contact flag producers and units are identified. Main input and scheduler remain dependencies outside this narrow transaction.
3. For the embedded engine, request only `08f50bc0`, `08f5b8f4`, `08f5c170`, `08f5b9e8`, `08f5c2dc`, and selected callback targets after the tables are decoded. Keep within retained limits:45s total,1s/function census; exporter per-function2s and existing output caps. Exporting these is future work. Input polling, link synchronization, callback ABI and shared four-player pools must have explicit contracts before native parity or composition.

The broad scheduler and animation/setup `080403c4` are poor first automatic targets: they pull unresolved services, pointer tables and live registers into a narrow motion test. Audio/render routines must be assessed for causal state effects, rather than all being removed as presentation.

## Verification and timing

`run.json` pins exact ROM and source-export digests and checks ten byte spans plus eight retained L0 artifacts. Packet generation/checks took0.15537275s, measured with Python perf_counter; this excludes static review and prior export. Retained prior attempt20261016T091004 reports11.336882417s outer total, including10.880096375s export process and0.44573925s static census. Internal export8.253259542s is nested and must not be added. Queue, build, simulation and new qualification time are unavailable. No new CI, dependency, compiler, build, simulation or expensive export was added. A comparable before/after latency measurement is unavailable because this is an inventory-only task.
