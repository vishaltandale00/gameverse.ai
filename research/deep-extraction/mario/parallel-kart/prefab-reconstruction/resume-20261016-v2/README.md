# Kart driver steering continuation

This pass advances beyond the earlier recovery helper to the original driver steering accumulator `08038afc`. It uses original HighFunction plus own-ROM bytes as compiler inputs. The routine reads encoded steering demand, action/vehicle flags and copied handling coefficients, updates signed steering accumulation, responds differently to reversed input and recenters on release. It preserves state-gated suppression and reset branches.

The explicit qualified precondition selects source handling lane 0. The original producer can select lanes 0/1/2; complete runtime lane selection remains a compiler closure gap. Character coefficients come from all eight original ROM rows copied by `0803c1bc`, without assigning character names or physical angular units.

## Actual qualification

- Initial automatic lift: 0.011087416 seconds; initial 4,096-vector original/native comparison: 0.226435833 seconds, passed.
- Strengthened source-profile check: 4,096 vectors, including 3,008 exact expected cases and 768 chained held/reversed/released input steps across eight character profiles. Passed in 0.251631333 seconds, including compile/link and native stages.
- The first strengthened run failed in 0.274470041 seconds because its fixture generator reused a mutable expected-state dictionary across steps. The failed receipt remains in `steer-profile0-source-fixtures/`; corrected immutable snapshots are in `steer-profile0-source-fixtures-v2/`. No behavior/compiler change was made to obtain the pass.

A retained character-0 scenario starts at zero, accumulates by 115 for encoded demand `0x100`, reaches 2415, briefly reaches 2530 and then settles to the original 2453 limit. Reversing to `0x200` first changes 2453→2298 with the reversal coefficient 155, crosses 128→-27, then accumulates in the negative direction. Releasing input recenters -1867→-1743 using 124 and eventually reaches zero. Every chained entry/expected result was compared with the original routine and emitted code; this is a bounded synthetic causal scenario, not a natural race or a recovered scheduler.

`result.json` pins the source contract, publication candidate and retained failures. `publication-candidates.json` requests one new component with ten sourced semantic ports and eight original character configurations. Publication is pending; this worker has not changed the shared registry.

## Required connected closure

The original driver caller `08037fd8` selects a handling lane, invokes steering-state handling, then steering accumulation and acceleration policy. The racer frame routine `0803c4c0` calls heading consumer `08038a08` before that driver caller; do not invent a same-frame accumulation→heading sequence without preserving the original latency/order.

Concrete blockers sent to the shared compiler owner:

1. `08038afc` with lane domain 0..2 produces four strided u16 coefficient lanes. Current collection bounding windows overlap; canonical row backing must preserve them rather than duplicate storage. Lane 0 qualifies without that unsupported alias representation.
2. Heading consumer `08038a08` has an absolute-speed SSA/phi bound feeding a ROM lookup; current range proof fails even with the evidenced low positive speed domain. Source-predicate-aware signed/absolute range propagation is needed.
3. The CPU/full steering path `0803bc00→0803bb48` reads a nested immutable ROM profile through racer state. Current entity references support bounded RAM targets, not this source-derived ROM profile. Profile stride `0x148` is not a safe complete target extent: an unrestricted source selector nibble can access through `0x19f`. Producer and consumer bounds must be preserved explicitly.

No new export/JVM process, game, ROM or browser run was performed. Existing eight-native-target/16,384-vector/30-second stage caps remain; one new source root was qualified. Queue time and end-to-end build improvement measurements remain unavailable. Broader vehicle movement, road contact, drift/hop behavior, input hardware mapping, race rules and persistence remain incomplete.
