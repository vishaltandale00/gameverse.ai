# SMA4 wrapper callee ABI re-export

One isolated, read-only/no-analysis export of wrapper `080479e8` now carries its native actor pointer into callee `080479c0`. Proven override: `arguments:["u32"]`, `return:"void"`. `u32` describes the native r0 pointer; the derived symbolic pool handle belongs to the compiler adapter and was not substituted as a native scalar.

Caller first eight ROM bytes retain r0 before BL. The callee's 32-byte own-ROM body immediately uses r0, updates actor position, then returns through LR. Both ROM spans and current ordinary/shared qualified adapter snapshots are pinned in the private `evidence/abi.json`. No return value was inferred. The override uses the exporter's existing `signature_overrides` schema and exists only in the copied project's ephemeral metadata.

Original wrapper SHA256: `7054e0e52cd1c186029483be7916ba6c8de923a7801a0bce31652d01c320f276`.

Re-exported wrapper SHA256: `a65b235452f6372088b8dfbc157c4949327525663424a76159924d0003216fee`.

At PC `080479ec`, old op9 CALL had target-only inputs `[v27]`; new op10 has `[v29,v0]`. Thus native argument count increased from zero to one. New op0 is `CAST v0 <- v1`, where v1 is input register r0. The call has no output, matching the proven void ABI. Six blocks remain six; operations changed from 92 to 93. Original leaf L0 hash `09ea6b994db95b172be67876f0b163fa5da6bbfad576e7dd8c5ccbcc7163764a` remains retained unchanged. Only the requested wrapper was re-exported.

Run `sma4-wrapper-abi-20261016T104832Z`: process 3.118057 seconds, nested exporter script 0.031694 seconds, call/structure validation 0.000736 seconds, copied project 0.010996 seconds, invocation total 3.248361 seconds. Hashing/evidence work is included in total; queue time is unavailable. Ghidra 12.1.4/JDK21 used the saved queue project copied into `local/re/next-bounded-exports/sma4-abi/`. Original project manifests before/after match exactly. Existing 45-second script/75-second process/900-second invocation limits were retained. No fresh broad analysis, native run or performance improvement comparison was performed.

`report.json` pins commands, evidence, project files, limits and diff. `append-packet.json` is for the sole compiler/global queue owner. Append the attempt after the original wrapper attempt so the existing depth pool reads the ABI-evidenced L0. No global files or existing caches were edited. No qualification or mechanic closure is claimed. The SMA4 project lease is released.
