# Wario Land 4: protection lifetime closure

Static causal map only; executable closure remains blocked. All games remain partial and Mario retains depth priority. This bounded review reused the pinned own-ROM function export and HighFunction cache. No Ghidra, compiler, build, native run, dependency, queue or catalog mutation was performed.

Normal-form hurt entry `0x0801318c` action `0x13` conditionally reduces health and sets the shared protection byte to 1. Recovery `0x08012e5c` from prior action `0x13/0x14` seeds it to `0x60`. The timer ages inside animation/palette function `0x08015218`: states `0x13/0x14` pause aging, otherwise a nonzero byte decrements once per callback and sets a separate aged flag. The last decrement reaches zero while that flag remains one.

This prefix is gameplay behavior. Terrain hazard dispatcher `0x0806f9d8` gates calls to `0x0806fba4` on the same byte being zero. The pinned ROM proves form-zero callback links: `0x082ded30[0] = 0x08015219` reaches the age function via `0x08010154`; `0x082deca0[0] = 0x08012bad` reaches the normal action dispatcher from the hazard function. Exact intra-frame hazard/age order remains unresolved. Rendering `0x0801c5d8` also clears the shared byte and flag for forms above one. Separate renderer/player copies would change behavior.

The packet records precise addresses, hashes, original record line numbers, callback bytes, symbolic ownership, ordering, service boundaries and prioritized targets. Decompiled C is analysis/oracle evidence only; it is never compiler input. Missing HighFunction for the late terrain routines and unresolved callback ABI, table domains and return-like indirects block automatic closure. Existing static attempts rejected the age and hurt routines for unbounded asset indices. The queue records zero Wario native qualifications; no new native or whole-game qualification is claimed.

Cache audit compared all 800 census rows with the directory. The 801st JSON is `export-summary.json`, not extra function coverage. Recursive cached-entry inspection found no second age-function L0 root; late terrain source records exist beyond the bounded census.

Actual historical stages: export 6.317967125 s; static census 0.383867583 s. Packet assembly/hash timing is in `packet.json`; it excludes earlier interactive evidence review. Queue/build/native timing is unavailable or unrun, recorded as null. No implementation changed turnaround, so no before/after comparison exists.

Next action: preserve the mechanical timer prefix and shared state while resolving form-zero callback ABI/order; export only missing terrain dependencies in a separately authorized bounded batch, then qualify timer 0/1/0x60, action boundaries, form switches and hazard re-entry. Do not claim a 96-frame duration until callback cadence is witnessed.
