# Dungeon command consumer — source closure attempt 01

The actual source frontier is `0805ec4c`, a bilateral adjacent-actor command preparation transaction. It reads published held-input B, actor facing/status, tile occupancy and movement-permission results; on success it initializes both actors' action records, writes opposite facing/position history, sets a world pending-action flag, and returns success. Movement and dungeon-turn execution remain downstream. The corpus's `0805d980` begins with BL inside the `0805d8c8` continuation family; it is not promoted as an ordinary portable root.

[closure-result.json](closure-result.json) is the authoritative current machine result. [source-phase.json](source-phase.json) retains the earlier source-analysis snapshot, including its historical export-pending status. The result overlays actual exports, compiler attempts, newly qualified dependencies and the next frontier. No registered delivery was modified.

EX064 exported all 20 exact requested functions from a private saved-project copy, using existing-function export mode without forced creation, splitting or ABI changes. Setup took 0.016345750 s; exporter process 4.255463333 s; total including setup 4.271916875 s. The script's nested 0.949373375 s and 17,685,619-byte output stayed within its 45 s/128 MiB bounds. Permit and original-project lease were released immediately.

Two dependencies now have actual automatic L1 and finite original/emitted native proof:

- `08046cb0`: actor-info flag/key predicate, used by the real terrain-permission callers. A canonical readonly entity→info reference is retained. 32 pairs passed, including 24 captured expected returns and unchanged-state cases; qualification took 0.214733125 s.
- `08044c94`: source action-record initializer called twice by the bilateral preparation root. 32 pairs passed, including eight expected actionId=2 cases with required byte resets; qualification took 0.263959125 s.

These 64 comparisons qualify dependencies only. They do not establish that the primary command consumer or dungeon control works. Exact artifacts, fixture pins, source/module identities and native stage timings are retained in the private paths referenced by the result and [publication-candidates.json](publication-candidates.json).

The primary automatic lift stops at `op2 LOAD @0805ec5e`, loading the mutable actor-info pointer from entity `r0+0x70`: `dynamic or nested object reference unresolved`. Existing readonly reference support cannot truthfully cover the root's writes, mutable subviews passed to `08044c94`, a second actor-info record and shared world/tile references. A single-root reproducer and exact source-domain/module evidence were routed once to compiler ownership. No pointer was replaced with independent copied state or an invented service.

The bounded next path is mutable actor-info reference/callee-subview import, then the exact 56×32 world tile resolver and occupied-tile predicate, with the predicate's actual return gating bilateral action writes. After that, follow the original action dispatcher into movement/turn/world state. The alternative cached menu direction consumer is now past its missing export but remains blocked by the source memcpy loop's induction/byref boundary; it is not presented as dungeon control.

Failed automatic attempts remain retained, including the initial fixture-helper syntax failure before native execution and corrected execution. Report-helper parsing failures were also retained as private source files; they did not execute native work. No whole-game session, browser, ROM/game generation, shared compiler edit, global index change or broad native campaign occurred. Overall interactive/queue time is unavailable; nested timings must not be added.
