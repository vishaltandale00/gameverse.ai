# Retained program decompiler configuration

MZM initializer `08012d14` provides an options-only extraction comparison. The owner retained the baseline, private exporter variant, option snapshot, candidate and measured receipt under `local/ir/fleet-next/metroid-zero-mission/death-drop-v2/export-pickup-options01/`. The measured run took 3.999600 seconds and preserved the original saved project. This is extraction evidence, not native qualification.

The old `GbaExport.java` setup calls `DecompileOptions.grabFromProgram(currentProgram)` and `DecompInterface.setOptions(options)` before opening the program. The shared `ExportBehavior.java` setup did not. In the installed API, `grabFromProgram` retrieves compiler-spec prototype evaluation and display language. The constructor already defaults to decompile simplification, syntax tree and C output; explicitly setting those defaults alone does not explain this comparison.

The options-only candidate recorded stored/effective prototype `__stdcall`, increased the CFG from 3 to 13 blocks and recovered the source 28-case computed jump at `08012d80`. CALLIND count decreased from 2 to 1. No source flow or signature override was applied. The next automatic lift remains blocked by saved-return SP/PC proof, so switch recovery is not a complete initializer qualification.

For an isolated configuration comparison, safely enumerate `currentProgram.getOptions("Decompiler").getOptionNames()` and call `getValueAsString(name)` (one argument). Record effective `options.getProtoEvalModel()` and `options.getDisplayLanguage()` after `grabFromProgram`. Preserve exact source/config/variant hashes and baseline identity. A new run must gate success on the option snapshot, complete exporter receipt and original-project manifest equality. The initial measured probe added some gates retrospectively; its retained old wrapper hash distinguishes it from the corrected future wrapper. No repeat was required to manufacture prospective validation.

This finding supports a separately reviewed exporter configuration change. It does not grant arbitrary flow repairs or authorize a shared exporter edit.
