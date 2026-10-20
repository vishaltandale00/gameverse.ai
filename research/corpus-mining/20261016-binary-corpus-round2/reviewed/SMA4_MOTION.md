# Super Mario Advance 4: recovered player motion

The binary campaign produced 4,640 candidate C records. The separate semantic
review now promotes two complete player-record integration operators from the
indexed USA ROM (`69e81f41394f02d64cad206adb26b3cd43690770`). No downloaded
decompilation source was used.

- `0x080a0f68`: signed horizontal speed cap, additive auxiliary motion, optional
  eight-direction displacement projection, and conditional left-boundary clamp.
- `0x080a1040`: one-sided downward speed cap, ordinary vertical integration, and
  optional displacement projection through a second exact signed coefficient table.

The source, exact ROM/code/table hashes, caller leads, original generated lifts,
and disassembly are retained beside this note. The linear disassembly also prints
literal words as instructions; those words were identified from PC-relative loads.
Both generated-C apparent indirect final jumps are ordinary saved-LR returns.

The isolated native oracle executes the actual Thumb instructions with private
synthetic records, then compares the entire 264-byte record against recovered C.
49,152 calls and 2,820,430 original instructions passed. This samples every signed
velocity byte, sixteen orientation selectors, and six mixed cap/carrier/boundary
cases. It is a finite comparison, not exhaustive state equivalence. Build took
0.077922 seconds and execution 0.194523 seconds; the receipt records 0.295657
seconds total including its bookkeeping. No comparable previous baseline exists;
queue time is unavailable. No model calls or new dependencies were added.

A separate private native session navigated the stock menus into SMB3 stage one.
RIGHT increased actual Mario's position and speed. From the same private state,
holding A for 24 frames placed Mario 16,192 raw position units higher than tapping
A for one frame and releasing for 23. Actual screenshots and a short native-frame
video are linked by `sma4-jump-native-receipt.json`; the two branch screenshots
were visually inspected. That experiment took 0.104739 seconds including video
encoding, not the earlier exploratory menu navigation. An earlier probe sampled
the death animation and is explicitly retained as an unsuccessful control probe.
No player/browser save was read or written.

The canonical ontology and portrait now expose these two motion operators and
their state dependencies. They do **not** claim a complete controller, recovered
acceleration/jump policy, terrain/contact solver, natural reachability of rotated
states, power-up system, stage/entity/assets catalogue, or ready-made transplant.
Both operators write the same world coordinates: any assembly must explicitly
provide update order, coordinate ownership, and adapters for another controller.

Reproduce the native leaf comparison using the existing compiler and libmgba:

```sh
cc -std=c11 -O1 -Wall -Wextra -I/opt/homebrew/include \
  research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma4_motion_differential.c \
  -L/opt/homebrew/lib -Wl,-rpath,/opt/homebrew/lib -lmgba \
  -o /tmp/sma4-motion-differential
/tmp/sma4-motion-differential \
  'local/roms/Super Mario Advance 4 - Super Mario Bros. 3 (USA).gba'
```

## Native composition milestones

The later review closes the local buffered jump/gravity/boost policy and sampled
wall response as executable packet operators. The standalone native backend
`sma4_lower_component.py` emitted 1,720 bytes of ARM7TDMI code. Original Thumb,
recovered C and emitted Thumb agreed for 32,768 jump, 49,152 integration and
65,536 sampled-wall scenarios. Its final build/qualification took 1.138534 seconds.
This is local component qualification; the whole controller is still incomplete.

The complete local enemy-stomp rule now has a reviewed native context adapter.
It retains real species trait tables, original scoring/audio services and the
original contact dispatcher. It bounces the player, changes enemy health/form,
and extends a score chain. The shared IR backend assembles it using:

```sh
python3 -m tools.composition.native_build \
  --plan tools/composition/plans/sma4-stomp-parity.json \
  --rom 'local/roms/Super Mario Advance 4 - Super Mario Bros. 3 (USA).gba' \
  --out local/re/experiments/NEW-STOMP-BUILD
```

That real cartridge build took 0.124526 seconds, with a 984-byte appended payload
and one declared eight-byte handler hook. A stock stage-one Goomba stomp was
replayed from the same private checkpoint against stock and generated ROMs. Both
had the same bounce, enemy state change and score chain; all sampled player,
enemy and world record hashes and rendered observations matched. The native
comparison took 0.476077 seconds, including both actual emulator recordings.
See `sma4-stomp-gameplay-receipt.json`. No frontend game was added.

Three accepted-item pickup rules now expose growth, fire-form and leaf/form
transitions as typed components. They distinguish a new form from a duplicate,
schedule a pending native transformation, consume the actor and emit ordered
score/audio events. Each sound event carries its own context; the special growth
branch changes spatial context midway through its effect sequence. The shared
IR plan is `tools/composition/plans/sma4-powerup-parity.json`.

The final pickup cartridge build took 0.132575 seconds with a 1,112-byte payload
and three declared handler hooks. The first build failure is retained: its tiny
runtime lacked the two-byte-aligned EABI memory-clear alias. A separate versioned
power-up runtime supplies that alias without modifying the qualified stomp
runtime. No broad tests or model calls were added.

A natural stage-one mushroom was released by bumping its question block, chased,
and collected. From the same private pre-collection checkpoint, stock and
generated pickup ROMs matched all sampled player/item/world record hashes and
images through the visible small-to-large form change. This comparison took
0.892506 seconds including both native recordings; see
`sma4-powerup-gameplay-receipt.json`. Fire/leaf effects have local operator
qualification; their natural collection and resulting abilities remain open.

These timing totals are separate experiments with different inputs and cannot
be treated as before/after speed improvements. Per-stage times are nested in
their report totals, and queue measurements are unavailable.
