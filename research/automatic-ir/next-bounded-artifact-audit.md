# Next-bounded artifact audit

Audit time: 2026-10-16 10:55:49 UTC  
Checkout HEAD: `85e2139614e26e198b87bb92dadbd22de49da871`  
Scope: focused final path, JSON, hash-pin, and count checks. No semantic revalidation, ROM rehash, native/build/Ghidra execution, or repeated browser tests.

## Fleet v2 and exports

Final fleet manifest `/Users/shishirtandale/Projects/gameverse.ai/research/deep-extraction/resume/dispatch-summary.json` is `2026-10-16-resume-fleet-final-v2`, finalized at 10:50:58 UTC, SHA256 `c61c2b2527af7c4715dc062911872ea9a950585b55fff94819825126b3b31d50`. Counts are 24 packet-ready, 0 active, 0 awaiting-slot, 0 new native qualifications, 17 packets with explicit missing HighFunction targets, 8 newly available serialized HighFunctions, and 4 availability-updated packets. The four updated packet IDs and pins all match: Minish, Aria, Dragon Ball Advanced Adventure, and Shaman King. Their explicit missing-target entry counts are 8, 0, 4 and 0 respectively.

The append index `/Users/shishirtandale/Projects/gameverse.ai/research/automatic-ir/next-bounded-exports/append-index-packet.json` contains eight exports. Every referenced L0 path exists and its SHA256 matches the index. The SMA4 ABI report records one export, `080479e8`; its output and report paths exist, and the recorded original project is unchanged.

## Compiler snapshot and dependent proofs

Final status `/Users/shishirtandale/Projects/gameverse.ai/research/automatic-ir/status.json` SHA256 `c874dcbb22197fb0705c1f9709b344f75bc6f06d8bd2963b895507114093466e` and source manifest `/Users/shishirtandale/Projects/gameverse.ai/local/ir/returnproof-round-20261016/source-manifest.json` SHA256 `61eea3ce2284be9102518f737a6cb2d9517ea02b098cd59cf50743f65eb7e84a` both parse. The source manifest is `FINAL`; all 25 listed compiler-source and evidence path hashes match. Its final snapshot and status agree: 22,844 L0 exports, 2,351 static candidates, 44 qualified packages, 19 typed-port subsets and 651,719 fixture pairs.

The Aria next-round packet is explicitly `blocked_before_native`, promotion false, and reports zero native vectors. All 11 pinned paths match. The Sonic candidate26 trigger proof has 19 referenced paths with matching hashes; its candidate ROM exists, but this audit did not hash the ROM. No proof reference is missing or stale by the recorded hash pins.

## Website proof

The owner marked `/Users/shishirtandale/Projects/gameverse.ai/research/ir-workshop/next-bounded-progress/verification.json` FINAL after both compiler final and fleet v2. The final verification file SHA256 is `786e17707ba579198ef7407b8ba33fb9b088466c0fe3c0c32d1cab4520a28b34`; `http-progress.json` SHA256 is `741bb6eb6e16f87e765fb5c2d77b5a8dfe5d28ad17de7dd5829e9d8a673e6914`. Its four source pins match compiler status, Mario coverage, target registry and fleet v2. Pipeline counts match the compiler final snapshot, and the fleet timestamp and 24 packet rows match manifest v2. The stale 43-native/18-typed wording was corrected to 44/19. HTTP catalog status is non-stale with no error. Browser/test outcomes are taken from the website owner's final report; this inventory did not rerun them.

The intended ledger remains `/Users/shishirtandale/Projects/gameverse.ai/research/HANDOFF-2026-10-16-RESUMED.md`. The optional JSON ledger was never claimed.
