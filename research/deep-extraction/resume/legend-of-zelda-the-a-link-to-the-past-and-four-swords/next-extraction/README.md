# Active extraction: indexed actor timed toggle and event lifecycle

[system.json](system.json) is the source-backed L2 subsystem contract; [manifest.json](manifest.json) pins private automatic L1, qualification receipts, failures, exact remaining dependencies and timings. The timed-toggle controller remains incomplete. Its event enqueue service now has automatically lifted executable L1 and finite original/generated native parity.

The compiler consumes only existing own-ROM HighFunction. No authored C mechanics, runtime wrappers, games, ROMs, templates, new dependencies, catalog changes or JVM/export processes were used. All new outputs are confined to this directory and `local/ir/fleet-next/legend-of-zelda-the-a-link-to-the-past-and-four-swords/`.

`0x08003dfc` initially failed with `collection/field alias unresolved`: unconstrained byte-count indexing inferred an array overlapping its separate count cell. An explicit private count domain **0..8** bounds the array and permits automatic lifting without compiler edits. This domain is a qualified subset, not an asserted whole-game invariant. Generated L1 preserves capacity-eight append/full-drop behavior. The adapter's conservative ninth lane is a validation sentinel, not a ninth queue slot.

Two separate native receipts pass:

- 1,024 deterministic boundary/random synthetic comparisons; total qualification 0.218631 s (receipt is authoritative if revised). The enclosing lift/qualification attempt measured 0.222090 s.
- 64 comparisons including 36 explicit cases: counts 0..8 crossed with events 0, 0x69, 0x8000, 0xffff; expected count and all queue lanes, unchanged ninth sentinel, and 16-byte external collection canaries. Total qualification 0.209506 s. Expected values are a test oracle, never compiler input.

These checks qualify the service's explicit domain only. They do not establish controller/gameplay closure or whole-game qualification. Receipt stage times are nested within total qualification and must not be added again. Queue delay/interactive analysis time is unavailable; no CI or generated-game build ran. There is no comparable turnaround before/after benchmark.

Automatic root attempts retain actionable failures: `0x08001d5c` fails on paired-pointer `PIECE` return; `0x0800bba0` fails on hardware pointer v4; `0x080042cc` and `0x08001ec0` wait on the shared accessor, and `0x080012fc` first waits on `0x080012b4`. Exact reproducible failures were sent to compiler_shared_state. Do not clone indexed state per actor/function to bypass this dependency.

Further own-ROM tracing identified the queue drain: `0x08003688` snapshots count then clears it **before** actor/global eligibility gates. Rejected gates discard pending events. Accepted paths deliver snapshot entries FIFO through `0x0800d1c0`, which can add 200 to event codes below 200 for a nonlocal type-one actor, then calls `0x0800d24c`. These are source observations; drain/dispatch are not executable qualified. Direct lifts retain missing-closure failures for `0x08003704` and `0x0800d24c`; both have existing cached HighFunction. Consumer identity is now concrete, while downstream effect semantics and mechanical dispensability remain unproven.

Next work is paired-return/shared-state compiler support, the hardware sampler boundary, then the identified drain/dispatch dependency closure and actual timed-toggle qualification. Source JSON preserves inputs, shared aliases, eligible-invocation timer units, mode transitions, event order, preconditions and source pins. No sampling/timer wrapper substitutes for the source controller gates.
