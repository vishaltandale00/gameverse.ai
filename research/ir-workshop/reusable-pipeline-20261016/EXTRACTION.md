# Reusable extraction checkpoint

The dependency-free extraction reader consumes the authoritative prefab allowlist, immutable delivery snapshots, package contracts, L1 bodies, qualification receipts and assembly validations. It groups variants by declared module ownership. It preserves original source edges, canonical state, field mappings, domains and service obligations rather than treating nearby functions as a recovered system.

`tools/prefab_pipeline/extraction.py` provides `extract(root, game_ids, cache_dir, limits=None, source_receipts=None)`. The CLI accepts repeated `--game` and `--source-receipt`. It emits canonical capsules plus exact input pins, dependency gaps and bounded semantic requests. Content-addressed entries include reader implementation, limits and all read input identities; every invocation rehashes inputs, including previously missing files. The cache avoids duplicate retained outputs, not the integrity scan. This checkpoint does not claim reduced native or agent latency.

The actual FireRed/Emerald/Minish demonstration is `extraction-demo.json`, with measured first/repeat runs in `extraction-timing.json`. Seven canonical capsules validate. Separate currentpair build receipts are transitional paired-runtime snapshots, explicitly unverified source tree/artifact claims, not single-ROM evidence. The newer blocked single-ROM merge receipt is outside this demo's explicit input set and is not superseded by it.

The generic `native_package.py` adapter handles existing `component_package` records through backend `native-rom-patch`. It retains historical `self_decompilation` provenance, exact host cartridge identity, fixed native service ABIs, source pins, allowed export argument choices and qualification scope. It does not relabel manually recovered source as automatic HighFunction IR. `aria-native-extraction.json` records the real reward package. Its historical receipt has stale parity/double-XP plan pins, so the adapter refuses historical qualification reuse. The separate fresh result `local/prefab-mods/aria-double-xp-20261016-01/report.json` supplies current bounded modification evidence; that evidence must be consumed by the modification result reader, not silently substituted into the historical capsule.

## Capability gaps and repair routes

These are extraction request routing categories, not a new global ontology or readiness score. Text routing is a hint; exact source evidence determines a repair.

| Gap | Reusable mechanism / evidence needed | Promotion boundary |
| --- | --- | --- |
| Source identity or missing cache entry | Pin package/behavior/source and use existing cached-frontier resolver | Missing evidence is explicit, never inferred from function name |
| Source entry domain / bounded expansion | Shared compiler source-proved immutable load or argument specialization | Preserve original conditional effects and actual native domain |
| Source target boundary / ARM-Thumb mode | Proposed `private_source_target_boundary_audit` inputs: ROM, guard/table, ordered targets, saved listing/context, frame witnesses | Private repair proposal only; conflicting ARM, interior or unrelated ownership rejected; no auto-promotion |
| Shared state, nested references, scalar/collection aliases | Canonical owner and source effect graph; retain actual pointer/cursor identity | UI selection/configuration cannot initialize or advance gameplay |
| Scheduling and lifecycle | Source entry/exit, eligibility, phase event and call-return records | A later eligible update is not an immediate callback |
| Assets, maps, audio, BIOS/MMIO | Typed service and immutable resource windows | A source-identical function body does not establish host ABI equivalence |
| Progression/save | Original owner, commit/restore and continuation evidence | Reward request is not acquisition; source storage allocation is not save proof |
| Variant domain | Exact domains and legal source branches | Do not fill missing producer state with zero defaults |
| Native checkpoints | Pinned original/emitted fixtures and actual lifecycle witnesses | Original-only execution is not executable IR; leaf equivalence is not whole-game closure |
| Native backend | Exact original ROM + native hook ABI + declared edit domain | A bounded modification can preserve full original gameplay without full L2 reconstruction |

The shared immutable-ROM-window repair is a concrete successful route: MZM retained 41,500 source-byte comparisons while canonicalization reduced copied resources to 8,308 bytes under the unchanged 16KiB cap. Existing receipts are under `local/ir/shared-readonly-assets-20261016`; this extraction task did not rerun native checks. The next missing source return export remains a separate gap.

Minish's source-derived refresh is the sole writer of its canonical inventory/cache backing. Operand views are distinct and health is external; its registration handoff forbids initialization, acquisition, refresh or invocation on UI selection. Kirby occupancy/classification banks remain distinct, with missing policy between them. Those examples prohibit automatically wiring semantically convenient leaf outputs.

## Verification and limits

Seven extraction unit tests cover content change, missing-to-present input, traversal/symlink rejection, behavior/receipt mismatch, declared module grouping, canonical validation and resource budgets. A focused regression additionally verifies that failed native receipts disable both L1 qualification and L2 binding maturity. Four native-package tests cover retained-service scope, changed source, host-ROM mismatch and bounded/contained inputs. No new CI, dependency, build or native execution was added.

Semantic requests are non-executable, capped inventory worklists. They require pinned source evidence and explicit unsupported dependencies; they cannot promote packages. A scheduler must narrow each request to a concrete failing frontier and apply its own explicit attempt/time/cost limits before invoking a semantic worker. Current extraction does not itself automate semantic recovery, source execution, native replay or central publication.
