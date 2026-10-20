# FFVI HP continuation extraction

Advanced beyond the prior missing-export packet: eight exact own-ROM HighFunctions are now retained (HP entry, signed-effect preparation, continuation call helper, five arithmetic/flag helpers). All eight automatic lift attempts failed closed, with exact input/compiler hashes and reproducible private script in result.json. No manual C entered the compiler.

The first ten-target export failed in Ghidra’s eager TMode setup for a missing continuation entry; its log and failure receipt remain preserved. Two subsequent existing-only exports succeeded (3/3 and 5/5), preserving both saved projects. Permits EX015, EX022 and EX025 are released.

The blocker is explicit VM control/state: r4 operand pointer, r5 continuation stack, r6 scratch, r7 byte stack, r8 NZ and r9 carry outputs. Current ordinary decompilation merges continuation tails and exposes helper flags as caller live-ins. Admission of extra pointer registers alone cannot correct the return flow. Exact pending-status and KO continuation boundaries remain missing. Failures and evidence were sent to compiler_shared_state and discovery_path_repair.

system.json is the source-backed L2 subsystem contract sent to ontology_systems: inputs, canonical actor/world/VM references, conditional HP/KO transitions, event meaning, observed calls/order, output state and services. It is not an executable-qualified component or authored wrapper.

Total export attempt wall time was 10.461018334 seconds, including the retained failure; nested process durations must not be added. Automatic lift and validation timings are recorded in result.json. Native/build/CI/queue and total interactive analysis measurements are unavailable. No generated games, ROMs, templates, dependencies or shared compiler/catalog changes were made.

Next is the compiler-owned continuation ABI/boundary repair and two exact continuation exports, followed by affected-target lifting and a custom-ABI original/recovered/emitted qualifier. Historical finite semantic-oracle success remains separate from this round’s zero executable qualifications. FFVI remains incomplete.
