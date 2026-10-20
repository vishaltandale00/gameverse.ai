# Original dungeon command-preparation oracle

`0805ec4c` passed four original-ROM-only cases on the first execution. Two successful cases used directions 2/6 and published held-input masks 0/2. The oracle asserted both actionId=2 records, selected input-dependent flag, both status flags, retained selected facing/opposite target facing, target position history, world pending-action byte, original return, ABI preservation, and EWRAM canaries. Two rejection cases asserted return zero and no EWRAM changes.

The fixture uses canonical entity→info references and actual tile-occupant pointers. It runs original `0808cdc0` to load the real `monspara` ROM archive asset, original `080495e4` to construct and verify all 56×32 tile pointers, and original `08049bb0` to compute terrain permission masks. No permission function, map service, callback or instruction path was replaced. The root uses its actual `r1==0` branch to bypass optional confirmation.

[oracle-result.json](oracle-result.json) pins the actual receipt, manual verification harness, native probe binary, exact source/ROM evidence, qualification limits and next compiler action. [fixtures.json](fixtures.json) records state layout, input/output assertions and initializer ownership. The harness C is verification code only; it must never become recovered behavior/compiler input.

The inactive type-0 occupant case tests the original defensive filter. It does not establish that this stale/inactive occupancy occurs in a valid generated dungeon. All cases use controlled source-layout RAM rather than a retained gameplay ancestry. The two positive cases are limited to species 1, original mobility class 0, and the supplied open terrain neighborhood.

Oracle compilation took 0.081603417 s; original execution, including setup and four root calls, took 0.130475541 s. Total driver time was 0.212117500 s; the nested stages must not be added again. The probe executed 93,448 instructions including original setup, below the per-call 65,536-instruction and per-stage 30-second limits. A report-helper syntax failure was retained and fixed without rerunning the oracle.

This is **not emitted parity, a compiler fix, full control, movement execution, or dungeon-turn qualification**. The mutable actor-info/callee/world-reference blocker remains. The retained oracle is ready for the sole compiler reference fix; no more cases or retries were run. Existing registered delivery and proofs remain unchanged.
