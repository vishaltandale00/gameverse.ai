# Pokémon Mystery Dungeon: Red Rescue Team — bounded resume evidence

This game remains partial. This packet proposes one static input-event lifecycle closure: hardware sample → held/pressed/repeat/short-release state → accumulation → publication/reset. It does not claim dungeon movement, turn logic, combat, or whole-game extraction. Mario remains the global depth priority.

[packet.json](packet.json) pins the own-ROM SHA256, source-export SHA256, eight exact-address dependency targets, each cached HighFunction SHA256, symbolic state, overlapping fields, ordering, services, blockers and continuation action. Only own-ROM functions/HighFunction and existing own-ROM research were used. Pseudo-C is analysis evidence, never compiler input.

The key targets are `0x0800cb74` (sample), `0x08004954` (stateful producer), `0x0800485c` (publish and clear), `0x080048d0` (repeat/short-release suppression reset), `0x080048f8` (pressed reset), `0x080047e8` (initialization), `0x0800bab8` (frame guard), and `0x0800ba5c` (scheduler context). Their complete provenance is in the packet.

Compiler-relevant findings:

- Current state at native adapter `0x02025648` has overlapping 32-bit and halfword views. Copy all four words to previous state before sampling. Accumulated/published state shares the same held/pressed/repeat/short-release halfword structure; independent copies break call aliases and reset order.
- Direction-repeat timing uses accepted input samples: count 1 emits, count 48 emits and rewrites to 43, yielding a five-sample repeat cadence. Other counts emit zero; do not independently emit every pressed bit.
- Masks `0x2` and `0x100` produce short-release events only when the unsigned 16-bit previous counter minus 2 is below 10. The reset helper writes 999 to suppress this event. Signed hold-counter comparison and unsigned release comparison must remain distinct.
- Cached L0 classifies several conventional Thumb returns as `CALLIND(lr)` plus `RETURN`. Own-ROM epilogues restore saved registers, `POP {r0}`, then `BX r0`, paired with saved-LR prologues. Normalize only those proven return idioms. This is static byte inspection, not an executed ABI qualification.
- ROM literals at `0x0800cc38/3c/40` pin `KEYINPUT`, `0x3ff`, and raw-sample storage. Cached L0 represents these literal locations as RAM-space input varnodes; bind pinned ROM bytes before symbolic lifting.

The original source export contains 2,896 functions. Checked all 801 JSON files in this game's cached L0 directory: 800 HighFunctions plus an export summary, including every proposed target. Searched additional target cache copies under `local/ir` and `local/re`; none found. The cached L0 only covers the first 800 source-export records. The 119 historical static candidates do not describe all cached dependencies or usable mechanics.

Verification performed: ROM SHA256 matches the durable queue; functions-export SHA256 matches the durable queue; all eight targets have cached HighFunctions; the return instruction bytes and literal words were read directly from the pinned ROM. Packet construction plus static hash/cache checks took **0.305322291 s**, with 0.218547708 s tool-reported command wall time; these measure different scopes and must not be added. Broader analysis elapsed was not instrumented. Historical discovery attempt wall time was **5.869756750 s**, containing export **5.596978458 s** and census **0.258894083 s**; do not sum these nested totals. CI queue/build/simulation/evaluation times are unavailable. No turnaround before/after baseline exists for this documentation-only work.

No Ghidra process, build, emulator, native qualification, dependency install, compiler change, queue change, catalog change, or UI change was performed. Historical native-qualified and composable counts remain zero. No executable package was published.

Next action: when scheduled after Mario, automatically lift the sampler and producer with pinned literals, proven return normalization, and a shared symbolic input context. Qualify held/change/release sequences across repeat ticks 1/43/48/50 and hold counters 1/2/11/12/99/100/999, then publication and both reset paths. Unresolved producers of publication's extra words and initial BSS/reset preconditions remain explicit blockers to extending the closure.
