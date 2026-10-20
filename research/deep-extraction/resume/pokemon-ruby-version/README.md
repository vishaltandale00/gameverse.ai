# Pokémon Ruby: bounded input-repeat closure

Partial static evidence only. The own-ROM initializer at `0x08000400` supplies a 40-call initial delay and 5-call repeat interval. Sampler `0x08000428` derives raw edges, held repeats, logical L-as-A input and a sticky watched-key latch. Its order matters: raw current buttons are compared to previous logical held buttons before remapping; repeat output remains raw. A consumer may run twice per main-loop iteration, so repeat units are sampler calls until native scheduling is qualified.

The downstream menu controller `0x080e77e8` uses repeat input for row/column wrap, clamping and scroll transitions; `0x080e7ab8` clamps the column against an indexed row limit. The indexed limit at base `0x020011aa` aliases direct byte `0x020011ab`; preserve that relation. Screen identity, valid bounds, zero-length rows and full region transitions remain unverified. These are dependency targets, not promoted components.

Compiler finding: cached HighFunction reports a CALLIND to lr at `0x080004ba`, while the original ROM has `pop {r0}; bx r0` at `0x080004b8`. Menu helper tails likewise have pop/bx return shapes. Verify stack provenance and normalize returns before treating these as unresolved gameplay callbacks. Exact bytes and SHA256 are in `packet.json`.

Cache check found 9,806 own-ROM function records and 800 cached HighFunction L0 files (801 JSON files total, including one export-run metadata summary), beyond the queue census of 800. The initializer and sampler have cached HighFunctions; the two menu functions do not. No downloaded decompilation or manual C was consulted or supplied to a compiler. No Ghidra, build, native execution, compiler, catalog or queue changes were made. Historical queue readiness is zero native-qualified/port-ready/closure-ready Ruby behaviors. All games remain partial; Mario retains priority.

Next action: validate return normalization, lift the initializer/sampler using shared symbolic input/config state, then qualify press/hold/release, L-as-A ordering and latch lifecycle. Export the missing menu HighFunctions only after higher-priority work. See packet timing for the actual bounded read/hash audit duration; total session time, queue, builds and native timings are unavailable or unrun, with no invented before/after measurement.

Measured read/hash/cache-entry audit: 0.636461 s. Artifact consistency checks passed in 0.000667 s (JSON, queue pins, available target HighFunction hashes and CALLIND node); these checks execute no game behavior.

Focused cache-count correction classified JSON by `format`: 800 `gameverse.l0.highfunction/0.2` records plus one `gameverse.l0.export-run/0.2` summary; metadata has no function entry. No native checks were rerun.
