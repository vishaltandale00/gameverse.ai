# Executable phase/request actor application — partial

[manifest.json](manifest.json) records actual automatic lift, targeted export and native qualification outcomes. [source-l2-contract.json](source-l2-contract.json) gives source-backed inputs, shared state, lifecycle, transitions, services and observed call order. It is a coherent partial subsystem contract, not an authored executable wrapper or a complete recovered L2.

Six automatically lifted functions passed **4,352 total finite native comparisons**:

| Entry | Function role | Cases | Qualification wall time |
| --- | --- | ---: | ---: |
| `08000760` | Input direction ROM-table lookup | 256 | 0.207215375 s |
| `080231a8` | Capability bit 6 query | 256 | 0.185652542 s |
| `080231c0` | Capability bit 7 query | 256 | 0.173631542 s |
| `080231b0` | Capability bit 5 query | 256 | 0.184378792 s |
| `0800b6d0` | Actor payload apply including scalar reset | 1,536 | 0.219252250 s |
| `0800b6a0` | Actor payload apply preserving scalar | 1,792 | 0.272163250 s |

The first four cover every input low-byte/capability-byte value. Apply methods cover every actor flag byte with bounded signed/wrap payload triples; the alternate includes all three actual phase payloads. Receipts retain original-vs-generated native comparisons, expected results, memory canaries, ABI checks, private generated code and stage timing. These are finite method qualifications, not a connected controller or gameplay qualification. An additional reset leaf `08011b90` lifted but was not qualified.

This advances the previous static packet: scene setup `08023750` creates the normal controller, installs descriptor `087e23fc`, passes mapping `0816b46c` through setter `0800b69c`, links the actor back-reference, and binds the **same** global actor through descriptor method `080155a8`. Constructor `0801588c` installs the descriptor after base initialization. The mapping root points to `0816b054`; requests 24/25/26 resolve to payload indices 29/30/31, containing `(8,18,1280)`, `(8,14,1280)`, `(8,6,1280)`.

Descriptor slots `30/34` and `40/44` resolve to the two qualified apply methods with zero receiver displacement. They write actor fields `54/58/5c`, negating payload channels 0 and 2 under actor flag bit 5. The first also writes `64`; the alternate leaves it untouched. Units remain unverified. Their actor and payload arguments have source-evidenced distinct accessed views: actor storage versus the caller's local stack triple. This does **not** license independent copies of the controller's nested actor reference.

Targeted exports added `0803a8c0`, `0803a8c4`, and `0800b6a0` from private project copies under granted and released permits. Both successful exports confirmed the original project unchanged. Real `BX r2/r3` trampoline lifts fail correctly as unresolved indirect calls; they were not misclassified as returns. The first export failed before decompilation because private Java home did not exist; the failure and fresh permitted retry remain retained.

The automatic producer `080151c8` and consumer `08012af4` still fail on nested actor/reference pointers. The exact reproducer and source alias evidence were sent to `/root/compiler_shared_state`. The consumer also needs nested ROM mapping/descriptor resolution and typed callback linking. No hand-authored behavior, copied actor state or synthetic source-order wrapper substitutes for those roots. Rearm, initialization completeness and scheduler/native transaction qualification remain open.

Next: use the shared nested-reference compiler repair to lift the producer, then the source-observed application/rearm closure. Qualify the connected transaction only after the real roots and call order can be represented. No games, playable ROMs, templates, demos, catalog changes, queue edits, shared compiler changes or dependencies were created.

Timing is measured in per-attempt/per-target receipts. Native target wall times total 1.242293751 s; their nested compile/link/oracle durations must not be added again. Successful targeted export invocation walls were 3.201998958 s and 3.426925875 s. Queue/interactive total and CI before/after timings are unavailable; no implementation affecting turnaround was changed.
