# Aria soul-claim prefab pass

The canonical `delivery.json` maps original exploration → casting/contact → lethal reward → pickup admission → inventory/ability activation → equip/cast → persistence. Source call relationships, state aliasing and host dependencies remain distinct. Whole-game readiness is false.

Two useful prefab phases are prepared: acquisition followed by an explicit owned-count observation; and the original admitted new-category-3 branch, count query → enable bit → acquisition, followed by a host observation. The original pickup root is not replaced by an authored branch. The caller must establish legal category/index, collision/claimed-marker eligibility and actual zero preownership before selecting the new-ability phase. Progress/notification/autoequip and real casting remain external.

`core-loop-map.json` is the stable early source map. `source-contract.json` pins original pickup callsites. `publication-candidates.json` hands the already-qualified count query and new enable-bit routine to the central publisher. Count uses the existing full-u32-return proof and 512-vector receipt without rerunning. Enable (`08032adc`) was automatically recovered from existing own-ROM L0 and passed 512 native comparisons, including 256 explicit expected scalar-byte cases covering eight legal indices, two enable modes and sixteen representative original-byte patterns. Its corrected run took 0.203824 seconds. An earlier 0.246515-second run passed parity but used empty collection expectations; it remains private and is not claimed as expected scalar-state coverage.

`build_prefabs.py` calls the real assembly validator and Composer/lowerer, emits phase adapters around the recovered components, and checks only the newly connected host state. It never invokes the ROM/game builder. It currently waits on central publication of `aria.progress.category3_count` and `aria.progress.category3_enable`; the intermediate allowlist is empty, with both requested prefab plans marked blocked. `deliver.py` creates the ready delivery/allowlist only from actual validation receipts. Source intermediates are preserved separately.

Category 3's two native bank views alias. Both count reads observe the same nibble, so nibble quantity one reports owned count two. The source enable byte is adjacent distinct state, not another copy of the bank. The two prefab facets must share one campaign module.

Known open source consumers are full pickup switch/marker callback `080441f8`, progress `08032dbc`, notification `0800e708`, autoequip `08049e64`, legal casting `08034624` and bone/contact-partner pool lifetime `08026008`/`08025f70`. Existing cast helper failures remain pointer-return, context/index and bounded-slot proof obligations. No new Ghidra/export/JVM, broad native matrix, dependency, game or ROM was added.

The optional `jsonschema` runtime is unavailable; no dependency was installed. `intermediate-schema-check.json` records that gap. The semantic lead owns central delivery-schema ingestion and review.

## Ready prefab handoff

Central wave08 published count/enable. The current `delivery.json` and `prefab-allowlist.json` now contain two actual validated prefabs: `aria.category3.acquire_observe` and `aria.category3.new_ability_grant`. Intermediate source-only delivery and empty allowlist remain preserved. Both graphs use current package/behavior pins, real assembly.py/Composer/lower output and narrow compiled host checks. Their generated C is an explicit phase adapter around recovered components, not an automatically recovered replacement for original pickup root `080441f8`.

The acquisition result is stored as the published exact L1 `u8` count result, range0..30; original native r0 zero-extension is separately proven. An initial assumed-u32 graph was rejected and retained under `initial-result-width-failure/`; correcting the result slot required no native rerun. Host observations are `owned_after=2 bank0=1` and, for the admitted new-ability phase, `owned_before=0 ability_flags=1`. Source branch admission remains a host precondition; post-transaction count is an explicit host observation.

`resolver-snapshot.json` pins current selected catalog/package/L1/native receipt identities. Byte-for-byte selected package snapshots are under the private prefab output root. No mutable latest alias substitutes for those identities. The descriptor's actual build receipt contains graph/lowering/host timings, with nested stages identified. No composed native-parity or full-game readiness claim follows from these connection checks.
