# SMA1 published-package admission coverage

Both real Composer graphs passed `tools/behavior_ir/assembly.py` with status `binding_valid_obligations_unproven`. They use only the already published `sma.motion.sma1_gravity_hover` and `sma.motion.sma1_jump_onset`, with exact behavior identities and the observed Peach `source_profile_1`. `source-identities.json` pins each manifest, serialized L1, adapter, retained native receipt and extracted configuration.

- `gravity-jump.graph.json` preserves the source parent order: gravity runs before the admitted jump inside the controller. It does not reproduce the controller's admission gates.
- `jump-next-gravity.graph.json` exposes a direct connection: jump's vertical velocity and remaining-hover outputs feed the next eligible gravity invocation's inputs. This cross-phase sequence leaves intervening scheduling, frame advancement, terrain and integration as explicit obligations.

Four symbolic slots are shared: vertical velocity, air mode, remaining hover and initial hover. Both source adapters map each pair to the same original root, offset and storage width. Public field meanings and units are copied unchanged from published manifests. The six-entry jump velocity profile is also bound using its published collection meaning and exact retained Peach values. No source semantics or conversion was invented.

Validation took 0.011753917 s and 0.012569333 s respectively (0.024323250 s total). Receipts live under `local/ir/mashup-coverage/sma1/`; exact graph, receipt, package and source proof hashes are indexed by `coverage.json`. Validation lowers package behavior and ordered symbolic calls in memory; it does not execute the graph or qualify its runtime schedule.

The published friction and Y integrator still have unknown public field semantics, and no published SMA1 horizontal integrator is available in this snapshot. Those cannot support an honest friction→horizontal-integration binding. They remain visible in the inventory and semantic-gap list, and the missing semantics were reported to the compiler owner.

The source-backed L2 association is `l2-contract.json`, with `executable:false`. Fresh-A-edge/grounded admission, future domain preservation, source frame scheduling, world/terrain lifecycle and composed native behavior remain unproven. No native qualification, JVM, mining, generated ROM, game build or demo was run in this wave; existing per-package proofs were reused without counting them as new proof. Shared registries and composition indexes were untouched.
