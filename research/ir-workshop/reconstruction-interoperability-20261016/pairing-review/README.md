# Independently vetted crossgame shortlist

Four scoped opportunities survive this review. None closes a whole role or is ready to add. The remaining flat diagnostic rows are not product approvals.

1. **Held/new-press input adapter — dragon-ball-advanced-adventure → driv3r** (`input-capture`): `host-adapter-proved-consumer-unclosed`. Target08004d08 normalizes active-low KEYINPUT and writes held0203ab3e/pressed0203ab3c before08004dd4. Recovered DB function computes held and rising edges using prior held; suppression/repeat are additional private state.

   Bridge: Dimensionlessu16 low-ten bits; selected=(~raw)&0x3ff. DB suppression0x400 cleared; repeat never substitutes pressed. Read old canonical held into field2; after synchronous call publish fields2/3 to same target backing. Retain countdown/released/repeat privately. Exactly each original input-service invocation before target08004dd4, not arbitrary animation ticks. Pause/resample policy remains unknown.

   Next acceptance: Existing host proof covers1048641 cases; retain its exact scope. Execute target consumer with canonical pair, verify held/press/release sequences and pause/resampling boundaries before runtime claim.

   Preference: Target source sampler is small; reuse DB only as explicit source-behavior experiment, not required replacement.

2. **Creature secure-payload codec — pokemon-leafgreen-version → pokemon-emerald-version** (`party_records`): `exact-support-candidate-adapter-unimplemented`. Emerald source contract requires same live creature record with keys+0/+4 and payload+0x20..0x4f, checksum+0x1c. Two finite-qualified XOR leaves transform twelveu32 payload words with both key XOR store steps preserved.

   Bridge: u32 bitpatterns, not HP/items or physical units; endian/layout must remain original. Header keys and twelve words map record-relative offsets exactly. One shared creature record across decrypt, getter/setter and encode; explicit plaintext/ciphertext phase prevents double decrypt and detached copies. Decode→validate checksum/shuffled accessor→mutate→recompute checksum→encode. Codec alone does not save or commit party progress.

   Next acceptance: Prove target offset/layout equality from source pins. Unchanged round-trip and modified-field checksum tests must use same live record and detect invalid representation phase. Expose as internal codec support, never complete party persistence.

   Preference: Prefer Emerald own equivalent when exported; cross-source reuse is plausible only after exact representation pin comparison.

3. **Held-button supply to equipped-item query — dragon-ball-advanced-adventure → legend-of-zelda-the-the-minish-cap** (`heldEquippedInput`): `narrow-input-supply-candidate-adapter-unimplemented`. Target equipped-item query reads same-session held maskfield3, compares itemIDfield0 to equippedAfield1 then Bfield2; chooses targetmask1 or2 with A precedence. DB publishes current heldfield2 from selectedfield6; only held sampling is offered. It does not implement item identity, equipment priority or legal sword action.

   Bridge: Dimensionlessu16 bitmask; translate actual source button identities explicitly to target A=1/B=2. Do not use source pressed/repeat as held or assume same bit names. Persistent DB previous-held/repeat owner supplies a read snapshot to same Minish player held context; item/equipment stay target-owned readonly views. Invoke once at chosen target input sample before held_equipped_item; preserve target A-before-B query and charge scheduler. DB suppression must explicitly match target input suppression policy.

   Next acceptance: Prove button identity table and suppression behavior. Test none/A/B/both held, duplicate equipped item choosesA, unmatched item false; no acquired-skill/action permission inferred. Label input-supply only, not replaced held-equipped predicate or full role.

   Preference: Keep native Minish predicate; DB is only optional upstream input provider, and its repeat feature offers no proved benefit to this held-only consumer.

4. **Directional acceleration alternative — metroid-zero-mission → metroid-fusion** (`steering`): `source-policy-alternative-units-unclosed`. Fusion directional accelerator updates canonical signedu16 velocity at current+26 from facingbit0x10 and acceleration/cap arguments. MZM bounded acceleration/clamp operation modifies velocity; no full steering/input/terrain integration is supplied.

   Bridge: MZM metadata1/32world.x.right vs Fusion1/8native-coordinate.x/invocation. Numerically4x only after proving same physical coordinate base and cadence; currently not proved. Fusion cap ABIu32 differs sourceu16. Use one persistent Fusion actor velocity and facing; preserve signed wrap/clamp/extreme behavior and explicit previous44-byte snapshot responsibilities. Source function invocation before true integration consumer; target driver cadence still unqualified. This is a proposed changed control policy, not source-faithful replacement.

   Next acceptance: Close physical frame/cadence before writing numeric conversion. Compare facing branches, negative/positive clamp, u16 extrema and cap domain; then connect true target integration. No ready/addable or same-engine equivalence claim.

   Preference: Own Fusion directional acceleration already exists and should be default; cross-source candidate useful only to intentionally explore changed movement policy.

## Withheld claims

- pokemon-firered-version → pokemon-leafgreen-version: Timed page acknowledgement supplies neither navigation nor slot selection/legal command. A LeafGreen-specific TextContext wait/continuation mapping must be sourced before promoting a narrower text-wait card. Rename support to move-learning text wait only; cite exact target text-context layout, counter/automatic event and actual resume/page-clear caller.
- pokemon-emerald-version → pokemon-ruby-version: Paired four-lane swap is not turn selection, comparator, command admission or battle. No reviewed Ruby four-lane action/battler layout is supplied by this pair row. Cite Ruby exact paired-array layout/domains and real comparator caller, then show only order-lane internal transaction; tie RNG/priority/speed remain original responsibilities.
- metroid-zero-mission → metroid-fusion: MZM enemy HP/reaction has not been mapped to Fusion species/weapon policy and defeat→X emergence→absorb/reinfection. Generic shared genre and integerHP do not establish accepted-hit semantics. Identify exact target enemy record/accepted-hit caller, HP units and death/X continuation before listing a target-preserving adapter.
- castlevania-aria-of-sorrow → diagnostic target: The lead flagged copied NFS language on an Aria inventory diagnostic row; current inspected shards no longer contain that Aria/NFS text. Any such row must be withheld because target-specific source proof is absent; source soul categories alone do not establish target inventory. Prune unless exact target requirement and source category/claim/benefit mapping are evidenced; do not substitute generic item nouns.

The inventory spans all games; the shortlist spans input, creature representation, equipped-item input and movement. Ranking follows actionable contracts and retained evidence, not vehicle genre preference. Detailed candidate evidence, services and immutable reviewed shard pins are retained in review.json. No new native/build work ran.
