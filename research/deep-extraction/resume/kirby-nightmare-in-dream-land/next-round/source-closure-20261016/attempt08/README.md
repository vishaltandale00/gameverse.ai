# Common source map profile

The four-corner classifier08021564 and its080218f8 callee were automatically re-lifted for **width1,height2**, preserving top-cell geometry and query bounds. The publishing sampler080216d8 already qualifies that exact map domain; its5036 cases were reused without rerunning them.

Only the NEW classifier profile was qualified: **1024 original-ROM/emitted-native comparisons**, all256 shape selectors times four rectangle boundary profiles. Expected reset/OR output and unchanged accessed inputs passed. Root+callee lift took0.009624s and0.009927s. Fixture creation plus qualification took0.261739s; nested qualifier0.256517s includes compile/link/oracle. Earlier4096 cases were not repeated. Different fixture populations mean these are not a comparable performance before/after measurement.

`publication-candidates.json` requests central review of this new source-state specialization. The old1x1 classifier package is preserved. `common-map-source-contract.json` establishes one eight-byte map backing: both source queries read cell0's same shape byte, while the publishing sampler also reads cell1's attribute/shape. Occupancy and classification banks remain distinct immutable banks pinned to the same source ROM and shape namespace.

The source call-order graph deliberately retains missing intermediate work. Source0802136c begins with080216d8 but also performs08021634 foot/top queries and writes5537/5538 before returning to the parent, which then calls08021564. Classifier08021564 does not consume the sampler's returned occupancy or probe scratch. Therefore no sampler-output→classifier dependency is claimed. The sampler probe is an intermediate phase-boundary observation; original later probes can overwrite it. Actual actor pose correction and writeback remain open.

Central review/publication must provide the exact new package identity before an actual graph is submitted. Registered delivery and old proof artifacts remain unchanged; no private promotion, whole-game work or new service was introduced.
