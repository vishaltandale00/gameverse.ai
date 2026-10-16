# Automatic executable IR: connected clean-ROM slice

This is the automatic compiler path, separate from the complete Sonic campaign workstream. Its input is the user's ROM plus Ghidra HighFunction SSA/CFG. Hand-recovered C and community decomps are **not compiler inputs**. Composition consumes symbolic JSON behavior, never parent-ROM bytes, machine layouts or opaque recovered C.

## What exists

Nine automatically lifted behaviors are native-qualified: five Sonic Advance movement behaviors and four Zero Mission movement/combat/progression behaviors. Their exact executable records, typed ports, ownership, dependencies, qualification identities and known gaps are discoverable in [`ontology/executable-components/index.json`](../../ontology/executable-components/index.json). The records distinguish typed public ports from still-private state with unknown semantic meaning. Three alternative Sonic surface behaviors have qualified storage behavior but still need semantic port annotation before cross-game binding.

The connected composition is [`asterion-relay.composition.json`](asterion-relay.composition.json). It selects MZM directional acceleration, Sonic gravity/integration, MZM damage/death and MZM acquisition/event behavior. Its actual native cartridge demonstrates traversal, three enemies requiring repeated hits, native lethal transitions, native equipment acquisition and an acquired capability opening a world route to the exit. The world, input/jump/projectile rules, collision response, gate and visual presentation are explicitly **authored L2 behavior**, not falsely labeled ROM extraction. Acquisition changes ownership; the original MZM equip/active refresh is not claimed.

This is a connected compiler qualification game, **not the full Sonic mashup or an automatic complete-game decompiler**. Current art uses authored Mode4 primitives; no original renderer, enemy AI, audio or campaign was smuggled into a parent ROM. Runtime work is intentionally separate from the user's full campaign deliverable.

## Measured evidence

See [`status.json`](status.json) for exact artifact identities, timing context, failures and limits.

| Check | Actual result |
|---|---|
| Sonic candidate denominator | 1,929 existing candidate function entries; not ROM instruction coverage |
| L0 HighFunction export | 1,926 initially in24.559s; three unlabeled-switch exporter failures retained, then all three recovered in0.367s |
| Static address-free L1 census | 57 candidates in1.829s; only five are native-qualified, other52 remain unqualified |
| Native differential qualification | 184,320 original/generated pairs across nine packages |
| Captured RAM contexts | Ten more paired calls from actual Sonic attract/gameplay phase-end snapshots; these are not function-entry traces |
| Clean-ROM build | 65,536bytes,0.111s in retained build04; no parent-ROM input |
| Connected route | Pass,417 game updates,three enemy defeats,capability1,gate open,exit complete;0.557s including native recording/encoding |
| Composition-only variant | Impact argument2→4; same route completes with11 shots instead of16,0.430s; unchanged compiler/runtime |

Raw p-code, ROM-derived tables, cartridges, private states, images and videos remain in ignored `local/`. The base cartridge identity is `88e608f9cd44adb4b3bfcbd11183670233a7b89e0af7a935855c531e4c2e231a`. The stronger-beam composition is `8b62a5f2edece30a6fdc8b809a1e4d519cabfdd9a23c68e9808032a44ad8c09a`.

The initial route hit its frame budget after defeating enemies and acquiring the capability, before the exit. It remains a failed receipt. DMA clearing and32bit row writes reduced render work; the route cap was also raised, so those total route durations are **not comparable before/after throughput measurements**. Comparable clean build02/03 times were0.101s/0.107s. No prior whole-census automatic compiler baseline exists. Export times exclude JVM startup; nested qualification stages are not added again to inclusive totals. Direct-local queue times are unavailable.

## Pipeline and contracts

1. `ExportBehavior.java` writes exact-width HighFunction varnodes, p-code operations, predecessor-ordered phi inputs, true/false successors and jump-table/guard evidence. Addresses remain L0 internal. A bounded batch retains per-function export failures.
2. `lift.py` recovers nonoverlapping symbolic storage views, bounded typed collections and read-only extracted tables. Loads are snapshots at their original sequence positions; phi values use actual predecessor ordering. Acyclic CFGs become structured `if`/`switch`. Callee closure linking in `inline.py` preserves typed expression trees. Unresolved aliases, calls, loops or unbounded collections fail promotion.
3. `l1.schema.json` and `contract.py` define/check `gameverse.l1.behavior/0.2`. Integer arithmetic wraps at explicit storage width; sign extensions, logical/arithmetic shifts, extraction and comparison remain distinct operations. Lowering consumes serialized L1 alone. Body operation provenance is opaque; memory layouts are confined to validation adapters.
4. `qualify.py` generates one adapter-driven original Thumb versus generated Thumb oracle. It checks exact owned state, canaries, typed collections, qualified return widths, callee-saved registers and stack balance. Finite cases establish evidence, not universal equivalence. Selected MZM packages include mixed scalar/entity ABIs and the20-way acquisition switch with its original event-bank callee.
5. `compose.py` resolves qualified, hash-pinned packages, rejects stale receipts and unannotated public ports, binds state and invokes behaviors in explicit graph order. Adapters are synthesized from quantity/unit/frame metadata; current MZM→Sonic velocity conversion is exactly×8 with a declared safe source domain. Frame mismatches, quantizing conversions without rounding contracts and overflowing declared conversion domains reject rather than guess. Semantic metadata still uses existing own-ROM analysis; fully automatic unit inference is incomplete.
6. `runtime/` owns startup, frame timing, input, Mode4 graphics and geometry queries. Game transitions are generated from L2 JSON. Clean linking includes no parent game engine; the standard cartridge header is protocol data. Initialized `.data` is explicitly rejected until startup copy support is added.

The L2 graph currently supports bounded loops, ordered component invocation, exact expressions and explicit runtime capabilities. It is not yet a universal engine schema. Original callback phase recovery, generalized loop structuring, arbitrary pointer aliases, ARM/Thumb interworking, hardware service recognition and automatic L2 clustering remain open. Census diagnostics identify these gaps rather than count them as components.

## Reproduce narrowly

Existing tools: Python stdlib, Ghidra12.1.4/JDK21, system Clang, ARM binutils, libmgba and the repository native session worker. No new dependency or CI job was introduced.

```sh
# Existing saved Ghidra project; read-only selected export.
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
JAVA_TOOL_OPTIONS=-Duser.home="$PWD/local/re/ghidra-user" \
/opt/homebrew/opt/ghidra/libexec/support/analyzeHeadless \
  local/re/experiments/20261016-sonic-self-decompile/sonic-advance/ghidra_project gba \
  -process 'Sonic Advance (USA) (En,Ja).gba' -noanalysis -readOnly \
  -scriptPath tools/behavior_ir -postScript ExportBehavior.java \
  local/re/experiments/automatic-ir-m1-01 080470b4 08047100 08047078 08046f78 080471a0

# Publish the selected ROM→L1 packages and bounded native receipts.
# Requires the retained MZM L0 exports in the experiment directory as well.
python3 tools/behavior_ir/publish.py
python3 tools/behavior_ir/catalog.py --export
python3 tools/behavior_ir/catalog.py --role combat

# Outputs must be fresh; prior builds/receipts are not overwritten.
python3 tools/behavior_ir/compose.py \
  research/automatic-ir/asterion-relay.composition.json local/ir/builds/my-new-run
python3 tools/behavior_ir/qualify_composition.py \
  local/ir/builds/my-new-run local/ir/qualification/my-new-run
```

For the bounded compiler census, pass `ALL 45 1929` to `ExportBehavior.java`, then run `census.py` on its output. This is a separately invoked static qualification step, not a routine CI campaign. The L0 selection profile belongs below composition; users assembling a game select symbolic packages and ports.

Next depth target: Minish inventory getter/setter→derived skill refresh→sword charge/action gate, using the combat agent's native evidence solely as an oracle. It has not entered this automatic L1 inventory yet. FFVI's threaded combat VM needs a distinct live-register/continuation ABI profile; ordinary four-register assumptions are explicitly unsuitable.
