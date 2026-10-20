# FFVI resume packet

FFVI remains partial. The concrete dependency specification covers resolved target HP change through a pending KO request, beginning at `0x0807e7c0`. It does not claim a portable executable closure or full combat.

The exact queue item is recorded in `packet.json` with its JSON pointer and content. The queue has 90 HighFunctions, zero static candidates and zero automatic qualified closures. None of the ten required target/helper entries is in those HighFunctions. Existing targeted own-ROM decompilation records cover HP and effect preparation, but disagree with reviewed continuation-region boundaries and warn about removed blocks/indirect dispatch. These records support analysis only.

The immediate compiler blocker is FFVI's continuation VM: r5 stack control, r6 shared scratch, r7 byte stack, r8 raw NZ state and r9 carry history. A normal function ABI loses causal state. Effect flags also read overlapping u16 windows over three shared bytes; independent copies are incorrect. The packet gives exact addresses, verified ROM region hashes, helper record hashes, state/alias/order/service requirements and lift priority. Manual C is solely the historical semantic oracle, never compiler input.

Historical evidence includes 2,704 original-CPU HP cases and 100 acknowledged-currency cases, plus a prior native battle witness. The former took 0.206526459 s total, including 0.065985375 s clean build and 0.112430917 s combined simulation/evaluation. These are retained results, not new tests or automatic original/recovered/emitted equivalence. No native execution, build, Ghidra process or compiler invocation ran for this packet.

Current checks rehashed the ROM, six reviewed regions, six helper export records and four native trace artifacts, and checked exact target absence in the existing L0 set. Actual bounded hash/packet-stage timing is in packet.json; interactive analysis total and CI/build/simulation/evaluation timings are unavailable. No performance change or comparable before/after run exists.

Next: compiler owner, after Mario priority, acquires exact target HighFunctions with reviewed continuation boundaries and implements/confirms the explicit VM ABI under its lease. Then qualify the helper-to-HP closure against retained bounded cases through original/recovered/emitted execution. Status realization and rewards stay explicit downstream obligations. No global queue, compiler, catalog, UI or prior artifact was changed.
