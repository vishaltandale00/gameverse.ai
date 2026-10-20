# Aria native movement projection

`tools/prefab_pipeline/soulstride_movement.py` verifies this pinned own-ROM
instruction evidence and emits a guarded native actor snapshot/velocity adapter.
The substantial-mod strategy consumes the adapter from its generated package.
The authored rule decides the impulse; the original engine still integrates
position, resolves contact and controls animation and entity lifetime.

The source audit found an important existing boundary: ordinary Soma's callback
is `0x0801B0D8`, selected by dispatch table `0x084F10B4`. Its original cast
transaction is `0x08019478` (`actor`, `skip_pose`); it admits MP equal to cost.
The previously recovered cast hook `0x08034624` belongs to the alternate player
dispatcher and has different MP and pose rules. Its successful instruction
differential does not prove ordinary Soma invokes it.

The chosen reachable movement seam is therefore successful starter-bone birth
at the existing `0x08026008` hook, after the real Soma transaction has allocated
the effect, paid MP, published the slot and set its parent. The native Skeleton
descriptor selects `0x08026009`. An authored lunge may project velocity into the
matching original player only after the bone's partner allocation succeeds and
initialization transitions state 0 to 1. This scopes movement to Skeleton casts.
The original bone initialization and terrain/culling/cleanup remain intact.

The adapter reads actor velocity at `+0x48/+0x4c` and facing at byte `+0x58`,
mask `0x40`. It writes velocity only, after an aligned RAM bound, Soma character
and original player-pointer check. It creates no RAM state. The next original
Soma tick integrates these velocities before native contact resolution.
No grounded predicate or general portable controller was recovered.

`source-check.json` retains the actual clean Thumb compilation and source checks.
`probe_native.py` is a short read-only native-input witness caller, with an
optional isolated snapshot or the existing bounded boot recipe. It records
per-frame actor/MP/projectile data and cast-to-next-tick deltas; failed probes
remain diagnostic, with no campaign or contact-parity claim. The original-ROM
boot probe at `local/prefab-mods/aria-movement-original-probe-002/report.json`
took 1.733897 s for 5,912 frames but observed no cast and a static player.
The earlier `-001` diagnostic loaded an explicit candidate snapshot into the
original ROM and likewise supplies no valid movement witness. Neither result
qualifies lunge reachability. The separate native tracing owner subsequently
observed original casts at fixture-relative frames 225/273/321: the Castle
Corridor banner outlasted the early 112-frame probe. The caller now settles
200 frames before its 112 active frames. Actual candidate lunge witnesses
remain separate. No before/after build-latency
measurement is available for this new adapter.
