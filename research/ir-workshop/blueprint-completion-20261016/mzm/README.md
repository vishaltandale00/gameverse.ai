# MZM deferred encounter gate

`build.py` assembles five existing, automatically lifted and finite-native-qualified
source functions through the actual assembly validator and Composer. It validates
three ordered branch graphs: accepted damage, protected minimum 2 and protected
minimum 3, each followed by the separately eligible enemy prepass and Ripper gate.
The emitted core has separate calls for all five source functions.
These calls share one enemy state record. The gate's pose and packed reaction
are aliases of the same staged enemy's source offsets `+0x24` and `+0x2b`; its
world mode is separate context. The caller must retain the original enemy
update before projectile-contact schedule and invoke the prepass later than the
hit. The demonstration calls phases explicitly; it does not invent a scheduler.

The source chain is `08050424` accepted damage (or `080504ac`/`080504cc`
protected response), `08010cf0` later reaction, `08011280` Ripper update gate,
and `0801befc` as the source consumer of gate result. The compiled scenarios
cover nonlethal suppression, lethal pose request, protected hit, packed-marker
preservation, source thresholds, and a pose boundary. Source function receipts
already cover 16,384 synthetic original/native pairs per package; the connected
graph reuses those proofs and is not an original-ROM connected parity claim.

Contact admission (`0804fd9c`/`080505ac`) remains unlifted. Descriptor bank
`08050370` still fails on pointer phi `v16`/`v26`; the contact/effect pools
need typed loop-carried pointer views. After a lethal pose, the source Ripper
consumer may call `08011084`, but drop selector `08010eec` fails on pointer
`v66`; audio, effect allocation, DMA staging and native type dispatch are also
open. This packet consequently stops at the source-qualified gate result. It
does not claim defeat, drops, projectile retirement, renderer, full enemy AI,
or a playable MZM encounter.

Run `python3 -B research/ir-workshop/blueprint-completion-20261016/mzm/build.py`
to regenerate the exact graph, Composer C core, validation and compiled
scenarios. This run performs no JVM export, ROM build or new native campaign.
