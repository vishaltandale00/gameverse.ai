# Native Route 5 daycare

`stage_daycare(base, donor, out, report_dir=None)` runs after state and native UI,
before the native-services registry. It extracts the five Route 5 public services
and native nickname, deposit/mail, withdrawal/level-up/move-learning, cost and
level helpers from pinned FireRed `src/daycare.c`. The exact Route 5 step clause
runs from the existing native host `ShouldEggHatch` path across both regions.

Route 5 uses a separate private donor-shaped record in the Kanto PC extension.
Actual agbcc assertions verify BoxPokemon80, Pokemon100, Mail36, DayCareMail56,
DaycareMon140 and step-counter offset136. Host compiler struct layout must not be
used to infer the ARM ABI. Existing sizeof-based new-game clearing and snapshot
serialization include the appended record. The retained build context plus Route
5 produces a 52584-byte main snapshot within its 53092-byte capacity. The 508-byte
headroom excludes later VS Seeker/Fame additions; the final integrated compiler
capacity guard remains authoritative.

Hoenn and Four Island intentionally use one actual native host breeding facility
and two-parent state, following the explicit unified-source-system ownership
policy. Script services bind to that shared system through typed entry points.
Route 5 never swaps, clears or aliases the breeding deposits. Donor mail reporting
retains native FR string comparisons on that shared state with the typed host
`otName` field spelling. Selection uses the actual native party UI and its field
return callback, not an authored replacement menu.

Two focused tests pass, including compiled native deposit/withdraw/levels/cost,
mail restoration, maximum level, unsigned step overflow and private-state checks.
The runtime harness uses typed doubles for shared Pokemon/mail APIs; it does not
qualify the rendered UI or encrypted Pokemon engine. Actual CPP/preproc/agbcc
compilation passes for the provider, host daycare consumer and save ABI witness.
Commands, timing, corrected failed-assertion attempt and exact sizes are retained
in `agbcc-check.json`. No full ROM build, UI traversal, cross-region save/load or
emulator qualification was performed; the ledger keeps that gate open. Source
inputs and retained build outputs were not modified.
