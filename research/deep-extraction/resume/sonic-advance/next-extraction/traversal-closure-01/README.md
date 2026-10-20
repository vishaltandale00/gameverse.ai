# Original Sonic traversal: next source consumer

The original `08043E8C` world boundary now has a new automatically lifted,
native-qualified dependency for **stage-table selector `0300514C == 0`**.
It passed 1,024 original/emitted Thumb pairs, including 12 source-derived
expected-state cases. This is an advance beyond the already published steering
and integrate/gravity phases. It is not a completed traversal controller,
reconstructed source game, or qualified gameplay route.

`source-contract.json` pins the same actor's exact position, velocity and flags
aliases, all 23 actor/global source cells, four ROM table halfwords, original
call order, and the landing dependency graph. Known actor semantics inherit
the existing published motion contracts. Other camera/context cells retain
raw source addresses and unknown physical units rather than guessed portable
interfaces. The qualified oracle actor is distinct from fixed source globals;
actual source-host alias reachability remains an explicit obligation.

In this source table context, horizontal wrap threshold is 12848, its shift is
-384, vertical wrap threshold is -1 (disabled), and its shift is zero. Tests
cover ordinary/water defeat velocity, camera-offset updates, mode-2 secondary
actor updates, disabled/suppressed wrap, boundary clamps and the already-dead
actor's early return. The source can update global wrap state before its early
return without committing actor coordinates. The source span pin includes the
function and its literal pool through the next function entry; it is not a
claim that every byte in that extent is an instruction.

The required source order remains release/ability → steering → world boundary
→ integration → gravity → rotation → directional landing. Publication intake
has the exact standard `records[]` packet in `publication-candidates.json`.
The existing canonical two-phase prefab delivery remains frozen until this new
dependency is published and a separate actual Composer admission succeeds.
Non-inverted current/prior gravity flags must both have bit `0x80` clear when
connecting the existing `world.y.down` ports. The new machine body itself was
not edited or simplified around those flags.

Landing is still blocked, with the actual next dependencies now explicit:

- `08042E08` derives a direction from source BIOS SWI `0x0A` angle output,
  selecting `080428CC`, `08042B5C`, `08042A34`, or `08042CB8`.
- All four handlers reach scanner `0803FA40`. Its six-argument stack ABI,
  angle-output alias and true callback through `08099858`/`BX r5` remain
  mandatory. No callback was reclassified as a return.
- Source callsites also identify proximity/contact helpers `08046DB4` and
  `08046E00`, and accepted-landing transition helper `08042814`. They are
  dependencies to close, not synthesized services or a landing event producer.

Static checks cost 0.095837375 s across seven bounded attempts, including the
unrestricted world-root failure and all landing failures. Native qualification
cost 0.227720625 s including compilation/linking/oracle work; native emulation
inside it cost 0.073957875 s. These stages are nested, not additive. All limits,
source commit, compiler hashes, environment and ROM identity are in `probe.json`
and the native receipt under
`local/ir/fleet-next/sonic-advance/traversal-closure-01/`. Queue/analysis totals
and comparable before/after latency are unavailable. No existing native proof
was rerun. One packaging syntax failure before packaging/native work is retained
in `packaging-preparation-failure.json`; it did not change the behavior artifact.

`probe.py` and `qualify_world.py` preserve the bounded procedure; the probe
refuses to overwrite its existing output. Use a new versioned output directory
for any authorized future qualification. Immediate next work is publication and
exact-pin graph admission; landing requires central genuine callback/BIOS service
support. No JVM export, browser, authored game, new ROM, or retired Sonic×Metroid
campaign was used.
