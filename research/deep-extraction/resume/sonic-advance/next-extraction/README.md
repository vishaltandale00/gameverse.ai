# Original Sonic Advance ground/air and terrain-contact recovery

The old Sonic×Metroid campaign is **permanently stopped and superseded**, by
explicit user instruction. No further campaign repair, replacement or gameplay
route is part of this work. Historical source/research remains retained. This
packet uses only the original Sonic Advance USA cartridge, SHA256
`afc29e3325baf68a1822e88b25fcb59c8bdc29b8cdc48fa21c56defbd60ca020`.

[l2-contract.json](l2-contract.json) describes one cohesive original system:
task/player scheduling → input → character mode dispatch → ground or air
controller → world bounds/wrap → position integration → terrain response →
landing/detach. It preserves source call order, early exits, shared actor/world
state, Q8 positions/velocities and byte rotation. The full system remains
`executable:false`; gravity/integration or this round's one leaf are insufficient
to claim the controller is recovered.

[source-facts.json](source-facts.json) preserves 35 original Ghidra function
records, exact own-ROM spans and cached HighFunction pins. This is a narrow
source closure, not a repeated ROM inventory. Declared function size and actual
HighFunction PC envelope are distinct; neither alone proves complete boundaries.
[abi-evidence.json](abi-evidence.json) pins the most actionable missing edge.

The original `08047378` source selects `actor.flags & 6`:

- Air mode 2 executes camera bookkeeping → jump release/ability gate → air
  steering → world bounds/wrap → integration → gravity → rotation recovery →
  direction-selected collision/landing. Mode 6 adds a conditional character action.
- Attached mode 0 with action state zero tries jump and two ground gates, each
  with an early return, then slope acceleration and ground control. Nonzero
  action state instead runs slope first, then a conditional jump whose return
  is ignored. Both use the attached collision/detach tail.
- A separate attached special flag delegates to `08047284` and returns.
  Rolling mode 4 has its own slope/control path before the shared ground tail.

These branches must not be flattened into a generic movement chain. Integration
uses stored velocity before gravity updates it; attached collision updates
contact/rotation before steep-detach checks. Source world wrap can change camera
and secondary-player state, so it is more than a position clamp.

The static automatic probe took **0.048994 s**, retaining these blockers:

1. Attached contact `04386C→043764→03FA40→099858`: the scanner has **six**
   arguments. After a 40-byte prologue stack delta, `03FA54` reads the fifth
   (angle-output reference) and `03FA68` reads the sixth (callback into `r5`).
   `099858` is genuinely `BX r5`; it must not be normalized as a return.
   Caller `043764` supplies exact Thumb callback `03FE11` at two sites and
   aliases its outputs to actor bytes +24/+25. This gives a narrow static
   callback closure once stack arguments and by-reference effects are supported.
2. Air collision `042E08→0997D8`: the native SWI `0x0A` angle service is needed
   to select four landing orientations. Its `CALLOTHER` remains unsupported.
3. World stage limits and ability/audio descriptors need source-derived index,
   pointer and path domains. The attempted exact flags domain does not eliminate
   state-load branches in the current lifter; that failure remains retained.

One additional body, `080471F0`, now has **automatic L1 and 1,024 passing
original/emitted Thumb pairs**: every rotation byte × source poses 0/23 ×
facing bits 0/1. Native qualification took **0.220294 s**, including compile,
link and parity; these nested stages are not added again. This angle recovery
step belongs after integration/gravity and before landing collision. It is a
local proposal at
`local/ir/fleet-next/sonic-advance/closure-probe-01/080471f0/package.json`, not a
published catalog component or full controller. No manually recovered C enters
the lifter, generated behavior, fixtures or native oracle.

No JVM/export was launched: the missing jump gate `08047634` was found in the
retained repair cache; permit EX014 was returned unused. No campaign ROM,
site/catalog or shared compiler/global status was changed. Queue and total
analysis time are unavailable; no before/after speedup is claimed. Exact local
reports and timing context are in [timing.json](timing.json).

Next work is the source-proven sixth-argument callback/by-reference scanner
closure and mandatory landing-angle service, coordinated with the compiler
owner. Keep the original actor, world/camera and angle-output aliases intact.
Do not replace failed automatic lifting with hand-written behavior C.
