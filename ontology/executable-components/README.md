# Executable component ontology

`index.json` groups the currently qualified automatic behavior subset into movement, combat and progression. Each record links an actual serialized L1 package, exact behavior/qualification identities, typed public ports, owned private state, lifecycle and unresolved constraints. These are usable implementation records, not keyword-only component suggestions.

Use `python3 tools/behavior_ir/catalog.py --role movement` or `--id mzm.progress.acquire` to inspect records. A package with unknown semantic ports remains `qualified_storage_behavior_semantic_ports_pending`; native parity alone does not establish semantic compatibility. Machine evidence references resolve only into internal L0 artifacts. Composition consumes symbolic `package_ref`/ports and never imports their validation adapters.

Current connected clean-ROM composition and qualification: `research/automatic-ir/README.md`. This subset does not replace the broader game descriptions in `ontology/games`, and unqualified static census candidates are deliberately excluded.
