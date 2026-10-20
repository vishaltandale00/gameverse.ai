# Utility source checkpoint — stopped, not admitted

The user changed the primary objective to lossless component extraction, original-game reconstruction and evidence-backed interchangeability. New mashup work stopped immediately. The already-running bounded compiler check had completed; no repair, further build or popup/floor implementation followed.

The unfinished generator is `tools/whole_game/single_rom/utility_services.py::stage_utility_services(base, donor, out, report_dir=None)`. Its emitted source is **not an admitted implementation**. The authoritative receipt is `checkpoint.json`, rather than the generator's preliminary source-provider labels.

The single scoped make run targeted 13 translation units and required assets, using the existing agbcc flags in a private copy-on-write clone of failed build `20261016T171250Z-eb5bd6a023b8`. It took **3.191569 seconds**: seven units compiled and six failed. Its total includes building the original donor font converter and converting the required font planes. Individual compiler/asset times and a comparable prior baseline are unavailable; no speedup is claimed.

| Target | Result | Evidence limit |
| --- | --- | --- |
| Original donor Help glyph provider | Compiled | Original glyph planes and width arrays retained; rendering and native equivalence unrun. |
| Original donor berry-powder provider | Compiled | Preserves shared vendor window state and encrypted powder backing; screen/gameplay unrun. |
| Original script message-state helpers | Compiled | Original setters retained, but the sign-walkaway consumer hook is absent. |
| Native save/Help-context adapter | Compiled | Calls the real unified native save engine; whole Help subsystem is not yet compilable. |
| Modified native `main.c`, `text.c`, `start_menu.c` | Compiled | Callback suspension, exact color-state accessor and terminal-save hook only; integrated lifecycle unrun. |
| Complete Help context/menu source | Failed | Save-status enum, Quest Log header provenance, ListMenuItem field ABI, Town Map item and Kanto Pokédex provider remain unresolved. |
| Complete Help renderer/lifecycle source | Failed | DMA enum, text control symbol, keypad icon declaration and ListMenuItem ABI remain unresolved. |
| Battle-record screen source closure | Failed | Initial closure follows calls but misses callback names passed as values, leaving its setup callback undefined. |
| Original Easy Chat dictionary/model source | Failed | Group-name declarations, flag-operation constant classification and `additionalPhrases` save backing differ. |
| Original Easy Chat control source | Failed | Link-state predicate and allocator ABI remain unresolved. |
| Original Easy Chat graphics source | Failed | Keyboard header, copied-font selection and window-frame provider remain unresolved. |

The exact diagnostics, commands and per-target hashes are retained in `utility-compile-01.log`, `utility-compile-01.json` and `checkpoint.json`. A private archive preserves 126 generated source, header, asset and converter-source files at `local/whole-game-mashup/emerald-firered/single-rom/utility-services-checkpoint-20261016/staged-source.tar.gz`. Canonical decompositions and the frozen failed-build source were unchanged.

Reusable findings for the new objective:

- Original Help needs its complete context state, callback suspension/resume, video backup, text renderer, fonts, topic/menu data and original script text labels. Six isolated setters do not reconstruct that behavior.
- Original Easy Chat requires its actual group/index dictionary and save-backed additional phrases. Emerald's same-named screen is not a proven substitute; the shared resolver rejected that inference.
- Original glyph formats `.hwlatfont` and `.fwlatfont` need the donor converter. Importing raw bytes or substituting another font format would lose source meaning. The bounded run successfully built that original converter and compiled the resulting glyph provider.
- Function-pointer references are source dependencies even when they are not call expressions. The battle-record closure failure demonstrates why a call-only extraction graph is incomplete.
- The shared resolver separately proved native party save/load and money helpers. Parent-authorized common bag capacity42 preserves FireRed's larger items pocket; its 48-byte save-structure growth still requires the final combined `sizeof`/streamed-save bound. No capacity-fit claim was made.
- Successful compilation is weaker than original reconstruction, behavioral equivalence or interchangeability. No component was published or qualified by this checkpoint.

The earlier map/runtime and region-map compiler receipts remain separate historical evidence. The requested popup/floor follow-up was not started. No full ROM build, browser, gameplay or model call was run for this utility checkpoint, and no new generic UI was added.
