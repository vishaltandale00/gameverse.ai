# FireRed map semantics in a staged Emerald tree

`stage_map_semantics(emerald_source, firered_source, output_tree, report_dir=None)` runs after map runtime preparation. It only edits the supplied isolated staged tree. Canonical donor and host source files remain read-only.

The stage preserves the donor behavior ID and imports the original donor predicate bodies, constants and surfability table under a private prefix. Every admitted host predicate dispatches to that source implementation on layouts with FireRed attribute storage; native Emerald maps retain their original bodies. Source identity follows the map layout, including when warp state changes.

Terrain uses the original 32-entry FireRed bit lookup over attribute field 1. Encounter selection uses attribute field 4. These fields are independent of behavior: grass appearance cannot substitute for encounter admission. Battle environment uses the original FireRed function, including its indoor/cave/water/mountain policy and absence of Emerald's weather override. Surf eligibility checks donor terrain and elevation 3. Normal Cut uses the donor 3x3 elevation-matched terrain scan and all nine original replacement pairs, without Emerald's Hyper Cutter expansion.

The complete original attribute inventory contains 68 files and 10,903 records, all pinned by hashes in the ledger. Its maximum behavior ID is 227, so byte-sized object movement storage is lossless for this pinned inventory. The raw attribute accessor still preserves nine-bit behavior values. A future donor inventory containing values at or above 256 creates a visible admission blocker.

The stage dispatches Dotted Hole Cut to the exact donor field natives supplied by native services. Full donor wild encounters are supplied by the encounter stage, including their own cooldown, RNG and rate policy. The ledger explicitly blocks unported forced-movement consumers and host predicates without an admitted donor equivalent. Returning from the staging function is not gameplay certification. Other composition stages may supply these implementations; they must reconcile the corresponding gates with their own evidence.

Validation uses generated native C with platform types and map-grid stubs, including exhaustive admitted predicate dispatch and every original Cut replacement pair. This is a small local check; it does not build or run a ROM. See `validation.json` for measured duration and unavailable baseline/build/queue measurements.
