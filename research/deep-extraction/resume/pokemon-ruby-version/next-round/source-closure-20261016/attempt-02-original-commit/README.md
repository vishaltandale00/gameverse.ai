# Ruby original-only caller-owned commit

The unmodified original ROM routine `080e7dbc` passed all five source counts (1,2,4,6,9): exact external halfwords, eight neighbor bytes before/after, unchanged source context, SP and r4–r11 preservation. It executed 307 instructions across five cases. Harness compilation plus native execution took 0.150333125 s.

This is ORIGINAL-only evidence, not recovered L1 parity. The harness contains validation/setup only and executes the original ROM; no synthesized game behavior or service stubs were used. The blocked automatic commit loop was not retried.

Separate pinned source/disassembly assertions show the original final-cancel callback has no direct commit call, sets result zero and schedules fade/exit; final-confirm calls commit then schedules the same exit. Cancellation, dialog result handling and fade/caller continuation were not natively executed here. Source-local buffers/counts are explicit preconditions, not whole-scene reachability proof.
