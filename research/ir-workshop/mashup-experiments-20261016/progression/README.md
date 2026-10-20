# Progression experiments: learned tactical exchange

Two experiments execute unchanged recovered acquisition/availability functions through actual Composer bindings, then explicitly authored permission scheduling calls recovered Emerald paired order exchange. Aria and Minish ownership therefore change an observable tactical result: both action and battler lanes swap together. Neither experiment is a playable game or composed native-parity proof.

| Experiment | Source-derived chain | Authored gameplay policy | Observed |
| --- | --- | --- | --- |
| Aria → Emerald | category3 pre-count → enable on new branch → acquire → post-count | category3 index 0 owned and enabled permits confirmed positions 0/1 exchange | 8 passing causal host scenarios;5 rejected domain/alias/meaning graphs |
| Minish → Emerald | script inventory write → canonical 64-byte bank → skill refresh | derived skill bit 0 permits confirmed positions 0/1 exchange | 10 passing causal host scenarios;4 rejected domain/alias graphs |

Aria count reads both aliased source banks: one acquisition produces observed count 2, duplicate produces 4. This is retained source behavior, not a fabricated collection count or separate banks. Minish acquisition writes item 72 state 1; states 2/3 remove the derived skill and item 115 alone does not satisfy this policy. Neither source skill identity is claimed equivalent to Emerald action or battler identity.

`graph.json` is the admitted component inventory and ordered straight-line availability trace. The conditional source branch and novel tactical policy live in `scenario-driver.c`, separate from graph admission. The actual generated source bodies and Composer copy-in/copy-out wrappers are in `generated.core.c`. The confirmed battle pair is an external supplied event; this is an order exchange, not Pokémon trade or reward acquisition.

Two intentionally incorrect schedules also ran and failed their invariant: Aria enable-only permission before acquisition swaps without ownership; a stale Minish cache after revocation swaps without current availability. The binding validator accepts reordered consumer-first component calls, which exposes its missing temporal policy proof. These failures and exact generated fault probes are retained per experiment, beside the successful boundary policy.

The independent probe under `../playtest/progression-temporal.json` confirms Minish refresh behavior and shows that delivering the same confirmation twice swaps twice, restoring original order. A runtime needs a once-per-confirmation/event identity policy; the source swap primitive should remain unchanged.

Initial build/sequence/validation totals were 0.1633 s for Aria and 0.1414 s for Minish; separate temporal fault probes took 0.1160 s and 0.1054 s. Full per-stage durations, environment, source and compiler hashes, queue unavailable state, and inherited finite original-function proof scope are in each `result.json`. No comparable baseline existed and no performance improvement is claimed.

The next reusable seam is explicit availability-and-confirmed-event scheduling, followed by an actual Emerald action scheduler. Original Aria cast/MP/pool and Minish sword-skill consumers, admission/claim events, persistence, input, renderer and assets remain missing. No playtest handoff is labeled game playability.

Reproduce only the bounded host checks:

```sh
python3 research/ir-workshop/mashup-experiments-20261016/progression/run_experiments.py
python3 research/ir-workshop/mashup-experiments-20261016/progression/probe_temporal_failures.py
```

`world-semantic-review.json` records a read-only cross-review of the world experiments' positive-domain numeric bridges and explicit stale fixed8 restoration boundary.
