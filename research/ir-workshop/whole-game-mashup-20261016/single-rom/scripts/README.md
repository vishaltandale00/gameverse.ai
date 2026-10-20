# FireRed campaign source compiler

`tools/whole_game/single_rom/scripts.py` imports the complete assembly include
closure of FireRed's campaign root. It namespaces labels and source identifiers
without changing quoted dialogue or comments, preserves all map script/text
files, and registers the imported root in the staged Emerald script object.
The canonical decompositions remain read only.

The generated `asm/macros/fr_event.inc` recompiles donor source macro bodies
using Emerald's actual handler opcode positions. Standard-script operations
lower to direct donor standard-script labels, including conditional dispatch.
This avoids dispatching donor item messages through Emerald's different standard
script table. Native specials consume the separately generated
`data/firered/native_special_ids.inc`; direct native calls target `FR_` functions.
Missing native command handlers produce assembler errors on use.

Matching command encoding is not evidence of equivalent runtime semantics.
Trainer battles, text placeholders, constant/resource aliases, and native C
services require their respective runtime ports. `PORTABILITY_GATE.h` records the
source-import marker; qualification remains fail-closed in the report validator,
and concrete missing command/constant providers fail during assembly. No service is replaced
with a no-op, unconditional success, or an unrelated shared-name implementation.

`script_constants.py` emits the audited generic operand header from actual used
source definitions and exact generated JSON indices. It preserves expression,
source location, donor value, host value, emitted value and resolution evidence.
Movement actions, field effects and bag pockets use their host service domains.
Map, item, trainer, flag, variable and audio constants retain their respective
owners. Missing slower-walk actions, early-rival battle mode and heal destinations
produce individual explicit preprocessing errors until the actual native provider
defines them. `refresh_constants` can run after those providers without replacing
campaign edits. `constant-coverage.json` records the initial unqualified import.

`coverage.json` records a representative local source import, including machine
and Python context. No ROM build or campaign execution was run for this stage.
There is no predecessor importer measurement; before/after build comparison and
queue time are unavailable. `command-coverage.json` retains every used command,
its transitive macro dependencies, source references, opcode mapping, and charmap
differences. `native-dependencies.json` distinguishes the complete registered
native inventory from dependencies reached by campaign source and convenience
macros; the native-services stage owns C dependency closure and implementations.

Focused checks: `python3 -m unittest tools.whole_game.single_rom.test_scripts tools.whole_game.single_rom.test_script_constants`.
These cover identifier/literal safety, include boundaries, deterministic source
staging, reachable native dependencies, command re-encoding, and explicit failure
for missing command implementations. They do not certify campaign playability.
The existing ARM assembler additionally accepted all 465 generated macro
definitions. This is a syntax check, not executable game qualification.

`full-script-assembly.json` records the stronger, targeted check of the complete
Emerald plus FireRed script translation unit: both upstream preprocessor passes,
clang CPP and ARM assembly completed successfully. It used an isolated copy of
the retained integration source with the current script fixes and actual
provider constants. This exposed and fixed omitted top-level standard-script
constants, macro defaults, missing state-provider includes, variable-domain
bounds, generated map helper functions and source version/revision conditions.
The resulting object defines the donor Pallet map, reset script and standard item
script witnesses. No native C link, ROM build or gameplay qualification follows
from that object-level check.

`full-map-event-assembly.json` separately records the complete map event
translation unit. Its generic operand inventory also scans all donor map JSON
values. The exact current map-event source macros and native movement-type
provider assembled successfully after regenerating all 425 donor map events.
Every one of the 183 compiled hidden-item records was compared byte for byte
against the source coordinates, item, packed flag, quantity and underfoot bit.
This catches the five-versus-seven argument event format difference and the
otherwise silent donor NPC movement-type80 collision with Emerald's unrelated
type80. The native donor wander provider supplies distinct type84.

`special-registry-proof.json` uses a real GNU assembler macro-expansion listing
as the root oracle, including CPP source line and nested macro lineage. It finds
223 distinct static specials across 1,063 encoded calls. All 118 Fame Checker
invocations bind: 101 default to `SetFlavorTextFlagFromSpecialVars`, and 17 select
`UpdatePickStateFromSpecialVar8005`. The previous lexical 221-root inventory
missed those two parameterized targets. The donor registry has 444 source slots,
272 unique functions, and 49 functions unreferenced by this static script bank.

No registry compaction is performed or authorized by this report. External RAM
script dispatch is a separate protocol capability: the staged receiver calls
native `RunScriptImmediately`, which uses native `gScriptCmdTable` and
`gSpecials`. Native Emerald protocol inputs must keep their original native ABI;
unknown raw FireRed bytecode needs explicit compatibility validation/remapping.
The optional `special_registry.py` records this obligation and a deterministic
static-only proposed map without deleting any slot or replacing a service.

The linker also exposed a header-ownership mistake: NPC text colors live in
`vars.h` and cry modes live in `sound.h`, but their meanings are not delegated to
the state or song-table providers. Family-scoped ownership now emits their exact
source values. `color-cry-symbol-verification.json` verifies the six unresolved
constants disappear from the actual reassembled script object.
