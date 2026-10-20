# Sonic Advance: actual generic assembly admission

The final [graph](integrate-gravity-air.graph.json) passed the real
`tools/behavior_ir/assembly.py` validator. Its receipt is
`local/ir/mashup-coverage/sonic-advance/integrate-gravity-air-catalog2.validation.json`.
The exact status is **`binding_valid_obligations_unproven`**, not gameplay or
full-controller acceptance. [proof.json](proof.json) pins inputs, package
identities, all attempts and source obligations.

The admitted pair is **integration → gravity**, preserving original air-mode
ordering from source scheduler `08047378`: move using stored velocity, then
update that velocity with gravity. It binds eight source ports to seven slots.
The two bodies intentionally share the same externally owned vertical-velocity
slot: `u16`, velocity, Q8, `world.y.down`. Both can write it. Integration owns
its single-writer X/Y position slots. Horizontal velocity and actor/world flags
come from explicit external providers; current and prior stage flags remain
separate state slots. Every type, rational unit and frame comes directly from
the existing published package contract. No conversion or new signed-encoding
claim was introduced.

The final initializer uses actor flags `0x102`, consistent with source air
mode `(flags & 6)==2`. The caller must still invoke this fragment once per
source player update in the correct phase, supply truthful actor/world history,
and preserve the same actor identity. The validator does not prove these
runtime obligations. No fixed rendering frequency is assumed.

Only two of the five currently published Sonic packages expose typed ports.
Actual negative graphs demonstrate the remaining admission gaps:

- `projection-opaque-owned.graph.json` is rejected because the proposed
  vertical-velocity field is still private/opaque in the published source port.
- `rotation-unpublished-owned.graph.json` is rejected because the new isolated
  rotation-recovery subset is not a qualified package in the published catalog.
- The original position-slot ownership failure is retained alongside corrected
  attempts; declaring a single-writer position slot external without sharing
  was rejected. Its corrected owner is integration.

The final validator took **0.008625084 seconds**. All eight retained admission
attempts consumed **0.021034834 seconds of aggregate validator work**; this is
not elapsed critical-path time. Queue time is unavailable. No ROM build,
native rerun, simulation, new extraction, shared compiler/catalog edit or
campaign work ran. There is no comparable before/after performance claim.

Source gravity/integration do not close movement. Air steering, release and
abilities, world bounds/wrap, rotation, directional landing, attached contact
and the remaining scheduler are mandatory open obligations. The broader source
L2 remains partial. Existing source facts and the decisive six-argument terrain
callback instruction evidence are directly pinned in the proof.

The old Sonic×Metroid campaign remains permanently stopped. This graph is an
original-ROM-derived IR admission artifact, not a new or repaired game.

Reproduce the accepted admission without ROM/native execution:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/behavior_ir/assembly.py \
  --request research/deep-extraction/resume/sonic-advance/mashup-coverage/integrate-gravity-air.graph.json \
  --out local/ir/mashup-coverage/sonic-advance/integrate-gravity-air-next.validation.json
```

A concurrent global catalog update was detected after the first admission.
Its receipt is preserved; one narrow readmission matched the stable updated
catalog before and after validation. Exact catalog/contracts/validator/source
metadata snapshots are retained under the local input-snapshots directory.
