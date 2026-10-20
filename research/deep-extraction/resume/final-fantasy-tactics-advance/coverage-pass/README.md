# FFTA admission coverage

Both published terrain helpers passed actual `assembly.py` validation, Composer invocation and source lowering. [gap-manifest.json](gap-manifest.json) pins exact packages, requests and receipts.

| Published component | Actual receipt status | Binding/lowering time |
| --- | --- | --- |
| `ffta.terrain.bounds_snapshot` | `binding_valid_obligations_unproven` | 0.011665833 s |
| `ffta.terrain.cell_flags_stride16` | `binding_valid_obligations_unproven` | 0.011010750 s |

The earlier missing graph evidence meant **untested**, not rejected. These new receipts prove binding and lowering admission only. Native qualification receipts were reused without rerunning them.

A multi-member connection was not submitted: bounds returns rectangle dimensions/origin, while flags accepts coordinates and terrain stride. Width→stride would assert an unproved identity. The original query instead conditionally calls validity (including bounds) before flag access; its missing executable validity/guard member prevents faithful wiring. The gap manifest also records that the published flag interface lacks a return meaning for result binding.

The graph uses caller-owned rectangle/grid inputs and distinct bounds outputs. No source clock or allocation lifetime was invented. The flag request explicitly uses coordinates 0/0 in its qualified 0–15 domain and stride16. Its 511-byte collection is an accessed adapter window, not a proven original allocation extent. Synthetic initial values are admission fixtures only.

No mining, JVM, native rerun, new game, ROM or demo occurred. Full terrain admission and the game remain incomplete.
