# Active terrain/contact extraction

`system.json` is the stable source-backed L2 subsystem contract. `manifest.json` identifies private executable artifacts and exact open dependencies. No generated game, ROM, template or wrapper was produced.

Three original HighFunctions (`080219b0`, `080219d0`, `080219f0`) automatically lifted and lowered with source shape selector fixed to1 and the shared sample index bounded to0..255. Native original-ROM versus emitted-code qualification passed all256 sample offsets for each target: **768 comparison pairs**, including return and ABI checks. The private runs took0.210197s,0.206833s and0.210012s respectively, including nested compile/link/oracle stages. These cover one shape's displacement rows; they do not qualify arbitrary shapes, sampling, actor ownership or full contact resolution.

All original attempts and failures are retained in the private root. Initial unbounded lift failures identified shape indexing; initial state-domain keys were incorrectly aligned to the global owner and produced overly wide65536-byte assets. Those lowered artifacts were not qualified. The corrected state contract uses `global:0:50353416`, as the adapter stores the physical global binding as base0 plus offset. Only `*-shape1-bounded` artifacts carry successful qualification.

The corrected general selector0..255 attempt still fails `not constant v10`, with the preceding traceback cause `dynamic or nested object reference unresolved`. `general-domain-repro.json` captures that exact failure and0.002770s wall time. It was sent to compiler_shared_state. Required fix: bounded immutable ROM pointer-table row dereferencing. The generic source leaf uses a256-entry pointer table with14 distinct256-byte rows; source row identity must be preserved.

Samplers additionally fail `unbounded or unaligned state collection`; root contact correction fails `unresolved callee closure08021634`. Canonical terrain map extents, current/below row bounds, shared scratch aliases, metadata tables and actor load/writeback remain open. The compiler-owner return-boundary investigation remains required at sampler/root stack-return sites; no shared compiler edits were made.

Native bounds: three targets,256 vectors each, existing per-stage30s timeout, existing instruction bounds. No exporter/JVM or new dependency was used. No CI before/after benchmark is available; this run measured private native code compilation and comparison only. Qualification times contain their stage times and must not be added twice.

Next action: compiler-owner row-pointer fix, then reattempt the fully bounded dynamic leaves. Link sampled shape and index through one shared state view, close map domains and metadata dependencies, then qualify the source contact CFG. Actor scheduler/reachability must be resolved before publishing this as player terrain behavior. All games remain incomplete; Mario keeps priority.
