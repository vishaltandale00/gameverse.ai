# Resumed-session artifact inventory audit

Audit time: 2026-10-16 10:38:00 UTC  
Repository HEAD: `85e2139614e26e198b87bb92dadbd22de49da871`  
Final manifest: `/Users/shishirtandale/Projects/gameverse.ai/research/deep-extraction/resume/dispatch-summary.json` (2026-10-16-resume-fleet-final-v1; SHA256 `d211cd5a2c8734b6e957e92481acc365c881168bfd27b612f01638b9f43ad2c0`)

This lightweight inventory parsed JSON, checked manifest-pinned packet hashes and IDs, checked named artifact existence, and inspected receipt/timing fields. It did not review mechanics, run native/build/Ghidra work, compute ROM hashes, or treat static packets as qualified.

## Cross-game packets

The final manifest lists 24 games and 24 `packet_ready` entries (0 active, 0 awaiting slot, 0 new native qualifications; 19 packets have explicit missing HighFunction target sets). Its pinned README SHA256 is `674e89f1e3eac1511322b3d2ab3159b8adb380846880e78efbed3f3dda1ca727`. All 24 `packet.json` files exist, parse, match game IDs and manifest SHA256 pins; all 24 corresponding README files exist. Final metadata recheck confirms Minish lists 9 absent HighFunction targets, including 0x08077f24. Ruby now distinguishes 800 HighFunction records from 801 JSON files (the extra file is one export summary). Both formerly unpinned packet source commits now match checkout HEAD. There are 19 packets with explicit missing HighFunction target sets; all 24 packets include root and missing-entry metadata.

Timing records are heterogeneous. Narrow packet assembly, hashing or checks are often measured; full analysis and queue time are commonly unavailable. Build, simulation and evaluation are generally null or explicitly unrun. Historical queue timings remain separate from current packet work, and nested stages are not additive. These are static evidence packets, not native qualification.

## Mario parallel evidence

All five directories exist: `parallel-sma1` (8 top-level files, 5 JSON), `parallel-sma2` (14, 5 JSON), `parallel-sma4` (8, 6 JSON), `parallel-superstar` (6, 4 JSON), and `parallel-kart` (4, 3 JSON). None has a consolidated `packet.json`; they contain individual evidence/extraction artifacts and are not counted as native qualification.

## Discovery repair

The report, queue-patch packet and README exist and parse. Run `discovery-repair-20261016T103136Z` at source commit `85e2139614e26e198b87bb92dadbd22de49da871` reports `bounded_invocation_complete`, 24.001935833 s total, and unavailable queue/build/simulation times. The packet records 714 L0 functions, 80 static candidates and zero native qualifications added. The initial startup failure, two Driv3r per-function decompile timeouts and GTA's existing 128 MiB output cap (547 of 800 selected functions) remain documented.

## Shared-pool receipts

All three receipts pass with clean builds, no cache, queue time unavailable and source commit `85e2139614e26e198b87bb92dadbd22de49da871`. Check: 0.205735458 s total, 1,024 vectors, parity stage 0.069700875 s. Legacy baseline: 0.206342917 s total, parity 0.089685250 s. r2 regression: 0.221452125 s total, parity 0.091292291 s. Parity stages are nested in totals. Receipts include stage outcomes/times, machine/compiler, ROM and harness identities, and configured limits. The comparison marks this a single qualification-only sample, not a general speedup claim.

## Sonic candidate26

The reports identify ROM SHA256 `ef7d653159328e9ab4ac0d67eb63dd212e9c6c8f7382eaf7b683627cb0396605`. Existing build receipt outcome is `built`, wall time 0.827131 s, source commit `85e2139614e26e198b87bb92dadbd22de49da871`; this is reused receipt data, not a fresh build. Habitat witness passes with 0.378829083 s including stepping, observation and encoding; queue time is unavailable. Factory2-later, speed-route and replay reports are present and parse. Two omit source commit. The intended resumed-session ledger is `/Users/shishirtandale/Projects/gameverse.ai/research/HANDOFF-2026-10-16-RESUMED.md` (19,517 bytes; SHA256 `5cd97da1a8a466944fe999156f816c7a24fa477c67975b9da7dd5bed64efbe19`). The optional JSON ledger was never claimed.

## JSON and paths

All 86 scoped JSON files parsed without errors. No confirmed broken local artifact references were found after treating explicitly absent HighFunction/L0 targets as documented evidence gaps. The first snapshot had 13 packet absences explicitly marked active. They are all present in the final manifest and are no longer missing.
