# Original event consumer witness

[closure-result-v003.json](closure-result-v003.json) adds a passing original-ROM witness to the earlier source and automatic-lift attempts. [original-consumer-fixtures-v001.json](original-consumer-fixtures-v001.json) records exact fixtures and limits. This is original-only evidence, never emitted-code parity or a new portable component.

Four small fixtures execute the original enqueue and drain routines over the same canonical queue. Accepted local event105 and nonlocal-remapped305 select their original player records, two-track headers and command pointers. Eight queued commands produce eight driver invocations and sixteen track cleanup calls. A rejected actor clears the pending queue without invoking the driver or cleanup.

The harness restores retained initialized source EWRAM/IWRAM per case and checks original driver pointers, lock magic and callback identity. It explicitly supplies actor eligibility and one channel-to-track attachment as synthetic boundary fixtures. The original cleanup invokes the real PSG stop callback08135185 through the original BXr3 trampoline; there are no stub callbacks or replacement audio services. Channel status/owner and track head clear; both source tracks initialize from the selected original header.

All four cases pass, with 2,156 original instructions. Compile took0.065003s; original execution took0.079921s; enclosing receipt total0.164043s. Nested stages must not be added again. No audio/frame clock advances, rendered sound quality, natural gameplay reachability, complete timed-toggle controller, mixed-tag FIFO order or emitted L1 parity is claimed.

The validation harness is manual C only as an emulator oracle, never recovered compiler input. Prior failures and successes remain unchanged. The actual outputs are now ready to check a later generic snapshot-loop/mutable-reference repair; unchanged failures were not retried.
