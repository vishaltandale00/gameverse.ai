# FireRed: dialogue page acknowledgement candidate

FireRed remains partial. This packet isolates one causal mechanic: token `0xfb` enters page-wait state 2; an A/B edge (including configured L-to-A mapping) or the alternate timed gate permits window clear, cursor restoration, and resumed token decoding. This is static evidence, not a publishable or native-qualified closure.

The own-ROM `0x080057a4` HighFunction calls the gate `0x08005648` at `0x08005c82` and window clear `0x08004470` at `0x08005c9a`. The gate updates the wait indicator before checking input and requests sound 5 on manual acknowledgement. Timed mode counts text invocations, with thresholds 50/120 according to the session byte; video-frame equivalence is unproved.

The compiler must preserve one shared TextContext: byte `+0x15` overlaps packed word `+0x14`. Window descriptors index shared backing buffers. Input repeat uses raw held state before L-to-A mapping. The outer loop can invoke callback dispatch twice and clears mapped new presses before its second pass. Splitting these fields into copied objects or treating every callback as one frame changes behavior.

A concrete compiler blocker is now narrowed: cached HighFunction encodes stack-restored Thumb return idioms as indirect calls. Own-ROM bytes show `POP {r0}; BX r0` at the input routine's return (`0x08000690`) and `POP {r1}; BX r1` at the gate's return (`0x0800568c`), with three further confirmed sites in the packet. These are return-address paths, not evidence of gameplay callbacks. Complete stack/return-ABI validation is still required. Input HighFunction also represents ROM literal-pool addresses as RAM-space varnodes; pinned ROM resolution supplies KEYINPUT, masks, and canonical state pointers.

`packet.json` contains 14 prioritized targets, exact addresses, own-ROM window fingerprints, export-C hashes, available HighFunction SHA256s, literal/epilogue bytes, symbolic ownership, ordering, services, blockers, and the next action. C was inspected as analysis evidence only; no downloaded source or manual C oracle was used as compiler input.

Actual cache inspection found 800 HighFunction files (maximum entry `0x0802a484`) versus 9,786 own-ROM function records. The bounded census alone does not represent the remaining functions. A search of the actual own-game cache found no HighFunction for `0x080722e0` or `0x08005694`; other-game same-address files were excluded. Window memory, rendering, callback scheduling, and sound-service dependencies remain open.

Historical queue discovery took 7.756285165999984 s total, including a 7.372295582999996 s export stage and 0.37328899999999976 s static census; these are nested stages, not additive to the total. The queue records 66 static candidates and zero native-qualified/port-ready/closure-ready FireRed behaviors. Existing navigation captures are not mechanic-equivalence evidence. This run performed no build, CI, Ghidra export, or native scenario.

Packet generation/cache validation took 0.38425 s; final JSON/hash/cache validation took 0.07434 s on the recorded machine. Queue time and before/after build timings are unavailable. Checks verified source/ROM/target hashes and the historical queue ROM identity. No dependency or timing infrastructure was added.

Next: verify and normalize these exact epilogues and ROM literals in the compiler, then lift the state-2 acknowledgement region with canonical TextContext/window backing; close service contracts before bounded native differential and generated-ROM causal qualification. Mario retains active depth priority. No shared queue/compiler/catalog/UI file was edited.
