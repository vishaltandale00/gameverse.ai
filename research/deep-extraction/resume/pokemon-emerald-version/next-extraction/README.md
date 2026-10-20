# Emerald source-system extraction

[system.json](system.json) is the source-backed L2 contract for turn initialization, priority/speed comparison, shared turn-roll/RNG and paired action scheduling. [result-manifest.json](result-manifest.json) pins the actual automatic L1 artifacts and remaining conversion failures. The full subsystem remains unqualified.

Three leased, exact-target exports recovered **28 HighFunctions**. Runs EX027/EX039/EX042 took **3.928434 / 3.590116 / 3.583520 seconds**, including nested copy/export/validation stages. All original saved-project manifests remained unchanged. No broad discovery, 800-function inventory rerun or global queue/catalog edit occurred.

Seven distinct automatic L1 units passed finite native parity, **7,296 comparisons** total:

| Recovered function | Address | Native comparisons | Scope |
| --- | --- | ---: | --- |
| Main RNG state/counter update | `0806f5cc` | 1,088 | Includes 12 explicit expected overflow/counter/return cases |
| Battler-side lookup | `080a6a30` | 1,024 | Four-record handle domain |
| Item-ID clamp | `080d745c` | 1,024 | Return-valued clamp |
| Paired action/battler-order swap | `0803cedc` | 1,088 | Includes all 16 ordered handle pairs, same-position alias and canaries |
| Twelve-word XOR transform | `0806a228` | 1,024 | Generic source-bounded CFG expansion |
| Reverse XOR transform | `0806a24c` | 1,024 | Generic source-bounded CFG expansion |
| Divide-zero return-support leaf | `082e75d4` | 1,024 | Supporting leaf; not an additional gameplay mechanic |

All behavior was generated from own-ROM HighFunction p-code. Expected-state fixtures are verification inputs only. The two XOR loops reused `bounded_cfg.expand` with 16 visits/2,048 operations, preserving source operations and original exports. No hand-written behavior C, service stub or authored L2 wrapper was substituted.

The coherent source system exposes why weather handling is a substantive dependency: its ability dispatch accesses party records through a getter that selects four substructure views by personality modulo 24, decrypts shared storage, verifies the checksum, can mutate corruption flags and restores encryption. These views must alias the same record; a pure weather predicate or independent decrypted copies would lose behavior. The contract preserves the shared RNG, one shared turn roll, paired order arrays and original nested comparator invocation order.

Current backend blockers are pinned by exact attempts: remainder expansion exceeds the existing operation budget; checksum induction is unproved; party getter switch remapping is unproved; item-table reads need callee return-range propagation; scheduler collections need bounded index domains. The interior dispatcher epilogue also lacks an independent balanced-stack return proof. These failures were sent to the shared compiler owner. No further broad export pass is necessary for the identified dependency set.

Timing and retained failures are in the manifest. Compile/link/oracle/native stages are nested within per-target and batch totals and must not be summed again. The first boundary-script invocation failed to parse before any native execution; the corrected run is separately retained. Total interactive analysis and queue time were not instrumented. No CI, game build, game generation, paid model call or dependency installation occurred. Existing qualification artifacts should be reused while the compiler repairs the remaining exact blockers.
