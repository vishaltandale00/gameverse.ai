# Sonic Advance USA: independent component recovery

This is direct recovery from ROM SHA1 `d842afa7dd1e84de08addb94a51506f1bcafd551`, not imported community game code. The earlier Europe-source investigation is historical and does not gate this work. A real native movement-composition candidate now runs the retained Sonic campaign. **The complete Metroid × Sonic ecology/combat/progression game is not finished.**

## Actual native composition milestone

The same [native component builder](../../tools/composition/native_build.py), package and graph mechanism produced four local ROMs without hand-editing C between variants. The expanded cartridge retains Sonic's original campaign/graphics and unresolved native assembly, while replacing pinned, independently recovered components. This is partial component integration, not a full decompilation/rebuild claim.

| Graph variant | Native result from the same bounded input sequence |
| --- | --- |
| Recovered Sonic five-leaf arithmetic | All 794 sampled motion records match original. Captured MP4 is byte-identical. |
| Metroid ordinary-air gravity/displacement only | Actual gravity changes from 42 to 80 native units, but the traversal fails and respawns. Failed artifact/media are retained. |
| Recovered Sonic full jump + five leaves | All 794 samples and captured MP4 still match original. |
| Metroid jump impulse + ordinary-air gravity/displacement | Initial jump velocity is −1536, then increments by 80. Traverses 720 frames to world X 2125.03 pixels with zero observed death-flag frames. |

The failed gravity-only version exposed an assembly dependency: jump initiation, release, gravity, caps and terrain capability must be considered as an ability bundle. Adding the independently recovered jump initializer and the actual MZM ordinary impulse removes this particular failure. It does not establish route completeness. The ordinary-air guard is conservative and stateless; all-campaign ownership transfer, complete loops, MZM air steering/release, weapons, ecology and progression remain unqualified.

The successful partial candidate is `local/composition-builds/sonic-metroid-jump-airborne-01/game.gba`. Its actual [emulator video](../../local/re/experiments/20261016-sonic-self-decompile/composition-play-sonic-metroid-jump-airborne-01/playthrough.mp4) contains rendered GBA frames, no interpolation, and no audio. Local clean C/D builds took 0.144/0.142 seconds. Identical-scope original/C/D probes took 1.050/1.067/1.102 seconds; these single local samples are scope/timing records, not a reliable performance regression estimate. See the tracked [evidence manifest](sonic-self-decomp-evidence.json) for hashes, failures and stage reports.

## Recovered gameplay bundles

[Jump initiation](sonic-recovered-jump.package.json) is the complete native jump entry, including fresh input, headroom gate, character-specific impulse, inherited velocity, pose/hitbox and sound. Its reconstructed Thumb matches the original across 1,000 finite vectors, with 300 successful jumps and 700 blocked/no-input cases. The actual native clearance, pose and sound services run in these comparisons. All four characters, water, rolling, gravity inversion and Amy's separate down+jump branch are covered. Only 144 actor bytes and the return value are compared; sound/task side-effect parity is not claimed.

[Air control and release](sonic-recovered-air-control.package.json) includes directional acceleration, inherited overspeed protection, upward drag, early jump release, and once-per-flight character ability dispatch. Original-versus-emitted Thumb passes 12,096 steering and 12,120 release vectors, including 24 invocations of the actual native character ability services. Their full spawned-task state and ability bodies remain outside this recovery.

[Terrain contact](sonic-recovered-contact.package.json) closes scanner → profile → tile descriptor → ROM geometry, paired headroom sensors, attached contact orientation, penetration correction, snap/detach threshold and surface-angle update. The complete recovered dependency chain passes 9,216 scanner vectors, 9,216 headroom vectors and 9,216 attached-response vectors over all 18 geometry definitions. This deliberately excludes airborne landing/penetration response. Native quotient-cache writes and unused stack scratch are not preserved.

The first emitted terrain runtime used general software division. On the same 9,216 scanner inputs, adding exact bounded reciprocals for compiler-emitted division by 12/96 reduces the combined original+emitted instruction count from 56.63 million to 13.98 million. Retained per-qualification wall times are 0.306/0.077 seconds on this machine. These are instruction counts and emulator wall time, not hardware cycle measurements; BIOS division is emulated.

[MZM ordinary motion](metroid-recovered-motion.package.json) is independently recovered from the indexed Zero Mission USA ROM, not source imported from another project. Directional acceleration and the ordinary airborne integration block match 5,220 original-Thumb vectors. The block clamps **old-velocity displacement before gravity updates stored velocity**; Metroid velocity has +Y upward and units of 1/32 px/frame. The [bridge](metroid-sonic-native-bridge.package.json) explicitly converts sign and units to Sonic's 1/256 px/frame, preserves the finer fractional remainder, and is separately checked against both immutable carts over 57,344 finite vectors. The bridge is new glue, not an original recovered game function.

## What now executes

Five small native movement functions have been independently reconstructed into [sonic-recovered-motion.c](sonic-recovered-motion.c). A bounded differential harness executes the **original Thumb instructions** in mGBA with private register/RAM inputs, then compares both the reconstructed host C and the newly emitted ARM7TDMI Thumb code. The current package emits 220 bytes and passes 18,774 finite vectors across all 256 surface angles, signed velocity extremes, gravity inversion, water-bit branches and steep-surface detachment/control-lock states. The clean compiler/link/qualification invocation took 0.235 seconds locally. These finite checks do not establish exhaustive equivalence or correctness of the whole player controller.

| Recovered operation | Original USA ROM address | Verified native details |
| --- | --- | --- |
| Attached slope acceleration | `0x08046F78` | Angle-gated signed sine contribution to scalar ground speed; preserve ordered shifts and 16-bit stores. |
| Surface tangent projection | `0x08047078` | Scalar ground speed becomes X/Y velocity through signed table values, with quantization before multiplication. |
| Position integration | `0x080470B4` | Adds signed velocity to 32-bit positions, handles gravity-flag transition/sign and native wrap. |
| Gravity | `0x08047100` | Adds 42 or 12 native velocity units according to actor flag bit `0x40`; halfword wrap preserved. |
| Steep-surface detach | `0x080471A0` | Low speed on angled contact sets airborne state and a 30-frame lock; preserves special-state exclusion and countdown. |

The human-selected hybrid retains Sonic momentum on loops and ramps. These recovered operations establish actual Sonic authority primitives for the composition pipeline. They do not justify clamping inherited momentum to Metroid's ordinary running cap. Contact-transfer guards, external impulses, complete jump/air control and the full loop route still need explicit integration evidence.

## World geometry and collision queries

Own camera/terrain instructions and a read-only live pointer independently identify the native geometry-header table at `0x084A6DA4`. It has 18 valid ROM pointers before the next word stops being a pointer. All 18 definitions have been extracted into bounded, individually hashed local assets: front/back maps, metatile descriptors, height profiles, surface angles and packed flags. Dimensions independently agree with 96-pixel metatiles, each containing 12 × 12 eight-pixel cells. The first live header is `0x084BF1F8`; its world is 13,056 × 1,344 pixels. Stage names and campaign edges are not inferred just from array order.

[sonic-recovered-terrain.c](sonic-recovered-terrain.c) reconstructs the descriptor lookup (`0x08040080`) and both profile/angle probes (`0x0803FE10`, `0x0803FF50`). Original-Thumb comparison passes **23,040 vectors over all 18 definitions and both layers**, including negative/out-of-range probe coordinates, tile flips, signed nibbles and the packed-flag suppression branch. The oracle executes 6,292,531 original instructions. The lookup's private quotient caches are intentionally removed in the pure adapter; return-value agreement does not claim identical cache writes or cycle timing. Higher-level material names and airborne collision response remain partial; the attached/headroom closure described above is now independently reconstructed.

Asset extraction took 0.041 seconds. The final host compile plus terrain comparison took approximately 0.13 seconds. These are separately scoped stages with different inputs from the motion qualification, not a before/after performance claim. No CI matrix, broad simulation campaign or paid-model batch was added.

## Observed game behavior

A fresh actual-ROM play session branches from one private checkpoint. Held jump reaches world Y 375.43 pixels; early release reaches 411.78 pixels, showing a shorter jump from the same state. These are sampled world coordinates, not universal jump-height constants. The release branch changes upward velocity before gravity. A 720-frame traversal reaches world X 2666.95 pixels, visits 19 distinct surface-angle values and has no observed death flag. This is early-stage traversal, not campaign or full-loop qualification. The complete branch/trace/video run took 1.083 seconds.

The recorded [MP4](../../local/re/experiments/20261016-sonic-self-decompile/native-motion-branch-03/playthrough.mp4) and PNGs show **baseline Sonic**, not a generated mashup. The runtime is real GBA emulation throughout.

## Larger recovery and remaining work

The bounded direct-call Ghidra pass expands the retained 383-function extraction to **1,929 candidate functions with generated pseudo-C in 26.8 seconds**. 1,815 functions have warnings and 66 contain unaffiliated-register diagnostics. Those outputs are useful discovery material, not 1,929 verified source functions. Neither code-byte coverage nor a matching whole-ROM rebuild has been established.

Directly recovered higher-level anchors include input processing (`0x08001224`), task dispatch (`0x080016AC`), actor input (`0x08045CC8`), player dispatch (`0x080454D8`), mode dispatch (`0x08047378`), camera initialization (`0x0803E0B0`) and camera follow (`0x0803E3DC`). The player base `0x03005A20` comes from an actual USA call literal and is independently exercised by native observations. These larger functions retain ABI/control-flow proof obligations.

The immediate composition work is to close controller/contact and world-entity dependencies, provide tested ownership-transfer hooks to the typed IR, recover the Metroid-side operations under the same ROM-first standard, and lower the integrated world/physics/ecology into a whole playable ROM. Rendering, entity ecology, upgrades, bosses and campaign completion cannot be claimed from the small arithmetic/terrain packages.

## Reproduce the bounded work

```sh
python3 research/requests/sonic_lower_motion.py --out local/re/experiments/sonic-motion-NEW
python3 research/requests/sonic_extract_terrain.py --out local/re/experiments/sonic-terrain-NEW
python3 research/requests/sonic_rom_probe.py --out local/re/experiments/sonic-native-NEW
```

Each command requires a fresh output directory. Generated binary/game assets stay ignored under `local/`. [sonic-self-decomp-evidence.json](sonic-self-decomp-evidence.json) pins the actual ROM, instruction/data ranges, C, native reports and media. [sonic-recovered-motion.package.json](sonic-recovered-motion.package.json) conforms to the composition package schema; its lowering status describes this small component backend, not a complete game generator.

One invalid older capture checkpoint failed to load; the failed attempt remains under `native-input-motion-01/failure.json`. The successful probes use fresh coldboot and newly created native checkpoints. The earlier source-compiler bootstrap finished before the stop instruction, in 31.725 seconds; no community Sonic game build was attempted or used in this recovery.


The newer gameplay bundles have a separate bounded qualification runner. It compiles and links the recovered component, then executes both original and emitted Thumb using the checked-in instruction-oracle drivers. A private fresh Sonic checkpoint from the probe is required; the runner records exact ROM, checkpoint, source, compiler command and stage outcomes. Current contact and air runner invocations took 1.053 and 0.545 seconds. These runs stay separate from routine CI.

```sh
python3 research/requests/sonic_qualify_recovered.py --component contact --checkpoint local/re/experiments/20261016-sonic-self-decompile/composition-play-original-01/checkpoint-1.ss --out local/re/experiments/sonic-contact-NEW
python3 research/requests/sonic_qualify_recovered.py --component air --checkpoint local/re/experiments/20261016-sonic-self-decompile/composition-play-original-01/checkpoint-1.ss --out local/re/experiments/sonic-air-NEW
python3 -m tools.composition.native_build --plan tools/composition/plans/sonic-metroid-jump-airborne.json --rom 'local/roms/Sonic Advance (USA) (En,Ja).gba' --out local/composition-builds/sonic-metroid-NEW
```

`--component jump` selects the complete initializer qualification. Old local qualification reports did not all collect a source commit at execution time; they retain input file hashes and ROM identity instead. The newer runner records Git HEAD plus hashes of the actual dirty source inputs. Timing for older queue stages is unavailable, not zero.
