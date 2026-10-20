# Emerald confirmed turn-order exchange prefab

[delivery.json](delivery.json) supplies one primary confirmed-pair exchange transaction, `emerald.turn-order.confirmed-pair-exchange`, with its [allowlist](prefab-allowlist.json), actual [assembly](confirmed-order-exchange.assembly.json) and [validation](confirmed-order-exchange.validation.json).

The caller delivers a confirmed pair-exchange event and two positions within 0..3. The recovered source transaction swaps both action-code and battler-handle entries in the same shared battle-session backing. Both changed arrays are public outputs. Defaults exchange positions 0/1 in a four-battler order with opaque action-code defaults. Same-position aliasing is retained by the source routine and covered by the existing strengthened receipt.

The comparison decision is external. This prefab does not compute priority/speed, resolve ties, select a command or execute an action. Source scheduler evidence shows it calls the swap only after a nonzero comparator result. The wrapper does not discard an unrelated lookup result or pretend to supply that decision.

Generic assembly validation passed in 0.002909 seconds. Existing source-function qualification is reused: 1,024 comparisons plus 64 strengthened cases covering all 16 position pairs and canaries. No new ROM, game, native run, compiler invocation, exporter or JVM was needed. Full interactive duration is unavailable. [delivery-check.json](delivery-check.json) checks exact graph/receipt pins, actual admission and every keyword of the supplied delivery schema without adding dependencies.

The source reconstruction keeps one battle-session module across command/turn-order/resolve/continuation/party facets. Persistent party records remain references to their original shared record store. Menu/controller callbacks, encrypted record getter closure, badge acquisition/commit, full action effects, turn/battle end and save/return remain explicit source-only or missing phases. A source-backed party/progression bundle is described without marking it reusable.

Publication intake admitted the existing side lookup's sourced return contract in wave07 without changing behavior/native proof. The internal support phase `emerald.turn-order.selected-battler-side` captures the actual u8 side-bit return into `selected_side`. Its narrow actual assembly validation passed in 0.002134 seconds. A host query event selects a battler handle within0..3; returned0/1 is observable to an external consumer. It does not choose a swap or implement a permission/targeting policy. The side query is not an additional primary gameplay module and is excluded from the prefab allowlist. The paired exchange is the sole primary prefab.

The final registered delivery path is frozen. Further improvements require a versioned candidate directory and lead notification before replacement. No proof was rerun for the product eligibility filter.
