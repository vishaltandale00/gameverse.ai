# Learned sword charge/release extraction

Actual automatic extraction advanced the held-input boundary needed by the learned sword controller. New own-ROM HighFunctions for `08077f24` and `08077efc` now produce executable symbolic L1 with **full u32 return values**. Each passes 4,096 original/generated native comparisons, including 42 explicit expected-result cases covering A/B matches, duplicate-equipment A precedence, no match, zero/both-button masks and upper mask bits. These are finite function-level witnesses; full action/lifecycle integration remains open.

`result.json` is the result manifest. `system.json` is the source-backed L2 subsystem contract: inputs, persistent/derived/item state, aliases, eight source CFG operation-order views, transitions, mandatory services, provenance and exact open dependencies. It is a recovered contract with executable input and historical inventory components, not an executable closed sword subsystem or authored behavior wrapper.

The original wrapper export incorrectly described its return as void. The first automatic void-wrapper comparison passed but did not test the required result; it remains explicitly retained as insufficient evidence. Original instructions show the helper fully returns 0/1 in r0, the wrapper immediately returns after BL without overwriting r0, and its caller immediately compares r0. Source-proven signature overrides in an isolated read-only project copy restored the CALL output and RETURN payload. Old and new L0, instruction spans, disassembly, qualification receipts and the temporary private fixture-script syntax failure are retained. No recovered C was used as compiler input.

Two permitted targeted export processes produced 13 action/service exports and two ABI exports. Both original project manifests remained unchanged. Charge/countdown/ready/release/spin/cleanup automatic lifting was actually attempted; the next failures are deeper than the prior missing-export list:

- `08075580 → 08077df4 → 080042ac → 08004260`: unbounded ROM animation table index. Sprite descriptor and animation ID domains must preserve event data.
- `080755f0 → 080759b8 → 08077e78 → 0801d630 → 0801d610`: unresolved pointer reaches actual DMA3 zero-fill. Its 28-byte item-context effect is mandatory.
- `08075738 → 08077e24 → 080042b8 → 08004276`: live animation sequence pointer, loop and callback semantics remain unresolved.

These exact reproducers were sent to the shared compiler owner. Animation is mechanically required for charge entry and spin completion. Neither service stubs nor independent copies of sword/player state can establish closure.

Source events are kept distinct: script setter `0807f078` writes inventory without invoking refresh; player initialization `08070698` calls terrain refresh then skill refresh. The prior controlled native setter→refresh sequence does not prove ordinary trainer acquisition scheduling or persistence through save/reload. Historical automatic inventory read/write/skill derivation receipts are reused, not rerun or relabeled as new.

The export invocations took 3.7497495 s and 3.29087375 s, including isolated copies and verification; their processes took 3.623382292 s and 3.17431675 s. New full-return qualifications took 0.205053041 s and 0.193005875 s, including nested compile/link/native stages. Contract/manifest construction took 0.03742675 s. Interactive analysis and queue timing are unavailable. No CI or comparable before/after build benchmark ran. No game, ROM, template, composition demo, dependency or shared queue/compiler/catalog/UI change was produced.

Next: close the exact animation domain/stream and DMA item-lifetime contracts in the shared compiler, then rerun the blocked action roots using the qualified input gate. All Minish and whole-game coverage remain partial.
