# Captured behavioral adapter compiler

`behavior_adapter.py` lowers one source-captured, closed dispatcher L1 module
with explicit host storage and native-service mappings. The donor IR body is
unchanged. Game addresses, script bytecode, semantic mappings and source pins
are recipe data. This is a bounded loop-side backend, not a whole-game
compatibility result or an accepted-version activation mechanism.

The initiating artifact is `gameverse.behavior-adapter-request/1`. Its pinned
`gameverse.behavior-adapter-recipe/1` must agree with the request's canonical
recipe hash and host/donor node identities. Contradictory requests fail before
generation; open native-service obligations remain open.

```sh
python3 -m tools.roundtrip.behavior_adapter capture-request REQUEST ROOT BUNDLE
python3 BUNDLE/behavior_adapter.py build BUNDLE OUTPUT
python3 BUNDLE/behavior_adapter.py build BUNDLE REPEAT --deny-source-reads
```

Capture retains the exact request, original and rewritten recipes, donor IR and
validation adapter, source evidence, opaque host ROM, compiler snapshots and
generator. Replay uses those captured inputs. The optional Python open audit
hook denies reads under the original workspace except the bundle and output,
and verifies a rejected read. Native compiler subprocesses are not OS confined.

Source resource-reference fields retain address-free symbolic tokens. A host
may persist those tokens privately, without dereferencing them as host graphics.
An original-game identity qualification can use `resource-ram` to map only null
and the source-pinned native resource address to/from null and its token; unknown
values and foreign ROM/resource pins are rejected. The source resource store is
retained in both paths.

Mappings cover every donor field. RAM mappings require aligned canonical cells,
identical widths and disjoint stores. A monotonic flag-bit mapping calls an
explicitly declared native authority. Native services require exact host byte
pins, source ABI/effect evidence, Thumb/AAPCS32 declarations and bounded typed
signatures. ROM/RAM pointer arguments must be fixed captured references.
Source native-call inputs are classified and may have explicit runtime checks;
semantic correctness of those mappings remains a native qualification gate.

The callback enforces pre-initialization assertions, initializes leased state,
loads host inputs, invokes generated donor code and writes mapped outputs. Its
completion predicate and cleanup are explicit recipe declarations. Appended
script objects use linker symbols checked against their actual final placement.
Only exact preimage-matched, nonoverlapping host script operands are replaced.
Mutable linked `.data`/`.bss`, unresolved symbols and resource-limit violations
fail the build. No ordinary provider's entry-veneer ABI guards are weakened.

Each build retains successful or failed stage outcomes and wall times, toolchain,
machine, request/input identities and separate native-code and installed-payload
hashes. Queue time is unavailable. Compilation is clean; no existing latency
baseline is implied. Native play, downstream consumers, lifecycle/save effects
and whole-game closure are separate proofs; the build report never promotes
them from a successful compiler exit.
