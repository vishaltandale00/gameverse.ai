# SOUL LOOM local Play registration

[Open SOUL LOOM in Play](http://127.0.0.1:4173/v0?view=play&game=ir-workshop). The existing single IR Workshop slot now selects this reviewed clean ROM. Other game entries and old ROM/progress files remain unchanged.

Keyboard: arrows move, **X** jumps, **Z** fires. After collecting the pickup, **S** sends GBA R shoulder to charge; **DOWN** spends one; **UP** weaves into the neighboring slot. Release between actions. Keyboard A is GBA L shoulder, not jump. Standard gamepad A jumps, B fires, and right shoulder charges. The existing Play descriptor has fixed generic notes and no per-registration notes override; these precise controls are documented here without adding a UI feature.

The authored gate requires low nibble 4 / high nibble 1 in the real packed inventory. To demonstrate rollback: pickup → press S → release and press S again → DOWN → UP, releasing between actions. The byte follows 00→04→05→05→04→14. Charging twice exercises recovered rollback but is optional: UP immediately after pickup also reaches the gate balance. Holding UP does not repeat.

This uses six instances of five distinct qualified automatic L1 packages, including Aria category 3 acquisition, in explicitly authored L2. Native acceptance proves the bounded balancing interaction and route. Original Aria gameplay closure, automatic L2 recovery and whole-game completeness remain open. [Production scope and native proof](../../requests/l2-production-next-20261016/README.md) retain exact conditions and limits.

LIFE RELAY's previous selection is preserved at `local-data/games/registration-history/ir-workshop-20261016T125025Z-972062a39cee.json`; copying that receipt back to `local-data/games/ir-workshop.json` restores it. The earlier SKILL RELAY backup and all old cartridge/progress/run files remain intact.

[Verification](verification.json), [activation](activation.json), [ready catalog entry](catalog-entry.json) and [final live research data/source hashes](research-http-progress.json) document exact identities. Existing activation API was called once; reviewed artifacts were imported without rebuilding or rerunning native QA. Browser inventory was empty; HTTP 200 Play shell, catalog readiness, exact served ROM hash and reviewed native evidence were verified without browser gameplay.

Final research: all 33 games partial, 46 finite native-qualified subsets / 21 typed,658,887 fixture pairs,22,850 bounded L0 / 2,351 static candidates; nine generated composition receipts include SOUL LOOM. The six added L0 entries were previously retained SMA2 records reconciled into the index, not new exports. Mario remains 120 targets / 45 unfinished families; 24 fleet packets are static evidence. Existing server source-only refresh took 1.590 s; clean shell build 36.8 ms (npm command 0.15 s); five frontend tests passed in 45.27 ms. Prior/current comparable observations and measurement limits are retained in the verification receipt.
