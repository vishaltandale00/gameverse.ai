# Fusion generic Mashup admission

Both published Fusion components now have actual single-component graph receipts. A third graph connects acceleration/clamp to transition snapshot/reset through the same horizontal-velocity slot. All three passed generic `assembly.py`, actual Composer and lowering with status `binding_valid_obligations_unproven`.

The connected graph pins both published behavior hashes, uses an external-owned shared signed u16 velocity slot, invokes acceleration with literals4/160 and then snapshot, and leaves unknown packed state private. This order is an assembly choice; original frame scheduling remains unresolved. Facing fields retain their distinct published semantic frames, so they are not silently unified.

[result-manifest.json](result-manifest.json) pins exact graph/receipt paths, hashes, real validation durations and warnings. Graph validity covers binding, ownership, domains, ordering and lowering. It establishes no native parity of the graph, full source-player alias closure or complete L2 subsystem. No native rerun, ROM generation or extraction occurred.
