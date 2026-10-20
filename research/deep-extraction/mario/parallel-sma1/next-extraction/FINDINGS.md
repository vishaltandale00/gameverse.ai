# SMA1 grounded controller and real input services

The source-backed system contract is `l2-contract.json`. It is explicitly non-executable: one source member is now finite-native-qualified, while the complete grounded controller remains blocked. No game, generated ROM, composition, demo, global registry or shared compiler was created or changed by this lane.

## Newly qualified source member

Original function `080a7e80` automatically lifts from the retained HighFunction into executable L1. It applies horizontal deceleration only when airborne byte player`+29` is zero. The bitwise condition `(native_frame_phase & player+31)==0` gates the velocity update. Character0/3 in ordinary mode uses magnitude 98304; other character/mode combinations use 196608. The original sign/XOR test clamps a zero crossing to zero. When crouch is zero, action is not 8 and velocity is zero, it clears action, gait, cadence and animation phase.

This function is a real controller dependency called by `080a7774` on selected no-direction/crouch paths. It does not implement held-direction acceleration, jump legality, terrain, speed caps, carried release or a full controller by itself. Animation `080a7c7c` remains an animation/action dependency.

Stable executable artifacts are under `local/ir/fleet-next/sma1/friction-expected-cases/`. The native oracle passed 1,024 original/emitted pairs, including 16 source-derived full expected-state cases. Cases cover positive/negative deceleration, both zero crossings, exact positive threshold and one raw unit above it, character 0..3 and alternate mode, airborne/frame-mask admission, stopped cleanup, and action 8/crouch preservation. Qualification took 0.245608958 s, including compilation, linking, emitted code extraction, native harness compilation and 0.120814333 s native comparison (read the exact stage receipt for its measured value). The earlier no-fixture 1,024-pair pass is retained separately; it is not counted as an additional behavior.

Generated behavior C remains byte-identical between the initial lift and the expected-case run. Source labels/units were added only to serialized L1 metadata. Expected cases validate behavior; they were never compiler behavior input. Velocity units reuse the independently retained SMA1 integrator calibration: one raw unit is 1/1,048,576 pixel per native update. No new gameplay trace was recorded.

## Bounded automatic attempts and blockers

- `080a7774`: lift fails in dependency `080a7c7c`, LOAD op43 at`080a7d56`. A signed8 absolute-velocity phi, arithmetic shift and sign extension give an unbounded ROM index into`08367d40`. In particular abs(-128) remains a signed8 exceptional value. Do not replace the animation dependency with an ignored callback or clamp the index without source proof.
- `080012fc`: actual input sampler reads original KEYINPUT halfword at`04000130` once, complements it, writes pressed=`newheld & (newheld ^ oldheld)`, then held=`newheld`. Its original HighFunction is retained, but LOAD op0 at`08001306` rejects the MMIO pointer. A source-derived read-only sample port/service is required. No authored replacement implements this behavior in the packet.
- `080a8008`: the default lift fails on an unbounded carried index. An isolated explicit invocation contract (slot 0..12, direction 0..1, character 0..3, crouch 0..1, original ROM-backed character profiles) passes that access and reaches dependency `080ab60c`. LOAD op37 at`080ab674` is a retained 16-bit p-code read but original Thumb instruction`7808` is LDRB. The byte-status collection index is bounded 1472..1484, yet the retained halfword width creates an alignment rejection. The exact mismatch and domain attempt are retained; no width or behavior was manually patched.

Backend owner `/root/compiler_shared_state` received these exact repros. Existing HighFunctions were reused for every attempt; zero Ghidra JVMs or queue mutations were needed. The isolated driver calls underlying lift/lower/qualify APIs and never invokes global `depth.work()`.

## L2 ownership and ordering

The input sampler owns hardware sampling and edge derivation; its held/pressed globals are shared with jump and carried-release consumers. The controller, animation, friction, speed cap and jump functions borrow the same player state. They cannot be copied into independent state instances. Profile and entity roots remain distinct roles, with the carried actor referring into the shared actor world and status/type arrays. Cleanup's 13 records do not expand the separate 12-slot pluck allocator.

Parent `080a7570` orders decay→gravity→ground control→terrain; on a zero terrain return it continues edge response→Y integration→X integration. Ground control orders animation first, then its actual jump/crouch/directional branches, optional friction and final speed-cap/release. Services `080b1640` (indexed effects/pool callback), `080b1358` (character-dependent audio request) and `080b551c` remain genuine dependencies. Their mechanical relevance and lifecycle are not replaced by renderer assumptions.

## Stable packet

- `targets.json`: four new target records with exact ROM/export/L0 pins; one record identifies the finite-qualified L1 subset.
- `l2-contract.json`: owned/shared state, true ordering, units, input/output roles, aliases, services, provenance and explicit blockers; parent remains `executable:false`.
- `qualification-index.json`: SHA256 pins for executable L1, adapter, generated C, expected fixtures, native receipt and retained failure reports.
- `evidence-receipt.json`: actual attempt/metadata/native timings. The native stage timings are nested in the qualification wall time and must not be added twice. Queue and game/simulation timing are unavailable because those operations were not run.
- Repros: `local/ir/fleet-next/sma1/probe.py`, `probe_input.py`, `probe_domains.py`, `qualify_friction.py`; successful and failed results remain under the same owned local directory.

The next bounded work is an explicit MMIO read-only input binding and original-byte/demand proof for the dynamic carried-status load, followed by a safe source index proof for animation. Until then, publish only the reviewed friction L1 subset through the compiler owner; keep the full grounded input system source-backed and non-executable.
