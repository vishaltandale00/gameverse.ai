# L1/L2 next-round artifact audit

Audit duration: 0.009925 s. Scope: one final bounded path/hash/count/recorded-identity pass; no semantic review, native/build/Ghidra run, or ROM-byte hashing.

The final compiler manifest pins 39 files; all recorded pins match: **True**. The final catalog reports 46 native-qualified packages, 21 typed subsets, 658,887 pairs, 22,850 L0 exports, and 33 games, all partial.

New L1 package: `sma2.actor_reinitialize`. The reviewed `candidate02` summary is local/ir/sma2-reinitialize-20261016/candidate02/summary.json; `candidate01` remains retained at local/ir/sma2-reinitialize-20261016/candidate01/summary.json. Compiler records 6,144 total root candidate pairs and publishes the root only. The status count change is +6,144 pairs (+1,024 after the prior 45/20/652,743 / 22,844 L0 final checkpoint); the +6 L0 count is recorded as reconciliation, not new exports.

SOUL LOOM request/registration `64ae4662-6688-4224-929a-dfc9b4ec5503` is indexed at `local/ir/generated/64ae4662-6688-4224-929a-dfc9b4ec5503/status.json`. Producer, generation, and Play proof record the same ROM identity `353c55f3987ba1e3d8dc2c8d7fc569ae18b0cae9aaab899f9b5545a5b9b641da`; served-ROM proof says it matches. I did not read or rehash the ROM. SOUL LOOM is 6 component instances over 5 unique qualified L1 package IDs in authored L2; automatic L2 recovery remains `open`.

Play proof records catalog ready, activation HTTP 200, shell HTTP 200, and research refresh after compiler FINAL. Website proof files checked: 7/7. Prior Life Relay registration backup remains linked at `local-data/games/registration-history/ir-workshop-20261016T125025Z-972062a39cee.json`.

Descriptor field/channel labels are reported from the source evidence without assigning new meanings; unmapped semantics remain unknown. The 21 typed subsets are typed L1 packages, not a recovered-L2 count.

## Unavailable or open fields

- Total interactive generation elapsed and queue time are unavailable: `None` and `None`.
- Automatic L2 recovery and original game mechanics remain open; the newly authored SOUL LOOM substrate is distinct from automatic L2 recovery.
- Browser listing/gameplay was unavailable: Unavailable: fresh browser inventory returned browsers=[]; no retries or browser gameplay.

All expected file pins match: **True**. Recorded consistency checks match: **True**. See JSON for per-file expected and actual hashes. Handoff references include the compact latest-round counts (`46finite`, `21typed`), package ID, SOUL LOOM UUID/ROM identity, and the preserved Life Relay backup path.
