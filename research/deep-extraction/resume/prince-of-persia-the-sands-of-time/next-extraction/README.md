# Prince of Persia hazard and protection system

This pass advanced the source subsystem and actual executable dependencies. [system.json](system.json) describes terrain detection → shared resource hit → temporary protection → expiry → renewed hit eligibility, with history restoration and the mechanical clock. [result.json](result.json) pins the exports, automatic L1 artifacts, native receipts, failures and next action. The full system and game remain incomplete.

Six previously missing HighFunctions were exported from the exact own-ROM project: world gate `0806bbf0`, pulse query `08091504`, remainder `08094d64`, audio/event dispatcher `08091634`, pulse initialization `080914c0`, and pulse increment `080914d0`. HighFunctions were the only compiler behavior inputs. Decompiled C served only as an analysis oracle.

Four dependencies automatically lifted and passed original-ROM versus emitted native comparisons, 256 cases each:

| Function | Recovered behavior | Native receipt |
| --- | --- | --- |
| `0806bbf0` | Read world gate bits through a caller mask | `local/ir/fleet-next/prince-of-persia-the-sands-of-time/dependency-lift-corrected/0806bbf0/receipt.json` |
| `08091504` | Read the shared pulse word | `local/ir/fleet-next/prince-of-persia-the-sands-of-time/dependency-lift-corrected/08091504/receipt.json` |
| `080914c0` | Initialize pulse and stop word to zero | `local/ir/fleet-next/prince-of-persia-the-sands-of-time/clock-lift/080914c0/receipt.json` |
| `080914d0` | Increment the pulse when its stop byte is clear | `local/ir/fleet-next/prince-of-persia-the-sands-of-time/clock-lift/080914d0/receipt.json` |

These 1,024 finite synthetic boundary/random comparisons qualify those functions, not play reachability or the complete hazard system. Source owner `0808fd18` calls the pulse increment after the current world's update callback. The clock therefore belongs in the mechanical dependency graph; native frame frequency and the complete callback lifecycle remain open.

The original owner updates protection before querying the hazard. At timer 120, expiry may allow a new hit in that same owner invocation. Accepted hits saturate the shared resource after subtracting five, set protection bit `0x0200`, and start timer 110; expiry occurs at 121. Actor byte/halfword flag aliases, the distinct shared resource object, sprite references and packed history records must retain their original backing and order.

Actual remaining failures are precise:

- Damage `080134d8`: nested actor-to-sprite reference unsupported, reported as pointer `v97`.
- Hazard `080133b4`: nested terrain references unsupported, reported as pointer `v76`.
- Timer/drain: specializing the remainder dependency to its source-observed divisor 15 removes the impossible zero-divisor branch, then fails at **loop CFG not yet structured**. No arithmetic replacement was authored.
- Number-effect service: instruction proof shows that `08027940` forwards four register arguments and supplies zero as a fifth stack argument to `08027578`. Both consume the saved return address through `pop r0; bx r0`, proving a void native return. Export attempt EX044 rejected five arguments because the exporter supports at most four register arguments. Its failure, disassembly and ROM-span hashes are retained; no argument was dropped.
- Effects still require actor reuse/enumeration, pool aliases and dispatch closure. Audio/event state writes and history restoration remain unqualified.

Actual timing and outcomes:

- EX032: four-function export completed in **3.405808292 s**.
- Corrected automatic lift pass: **0.015078167 s**; gate and query native qualification receipts took **0.239789875 s** and **0.189529208 s** respectively.
- Exact-divisor remainder attempt: blocked in **0.004171209 s**.
- EX044: retained unsupported-stack-ABI export failure in **3.137280167 s**. The process returned zero, but no exports were emitted; this is recorded as failure.
- EX046: two clock functions exported in **3.307083625 s**. Clock lift/native work took **0.434631709 s** in total.
- Final contract/manifest structural validation: **0.025741417 s**.

Export and native stages are nested in their invocation/receipt totals and must not be added again. Queue time and full interactive investigation time are unavailable. No CI or build-system changes were made, so no comparable before/after build measurement exists. Both completed exports and the failed export verified that the original saved project was unchanged. An initial private loader path mistake is retained separately from actual source/compiler failures.

The next compiler work is evidenced nested-reference handling, source-preserving remainder loop lowering, fifth stack-argument ABI support, and shared actor-pool dispatch. Reuse the pinned exports and qualified dependencies, then qualify the full hit/expiry/history path. This pass made no compiler, catalog, global queue, generated-game or UI changes.
