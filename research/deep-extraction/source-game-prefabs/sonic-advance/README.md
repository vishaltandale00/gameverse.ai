# Original Sonic source-game prefab phases

This delivery reconstructs selected pieces of the original Sonic Advance loop,
using exact published executable roots. It creates no game or ROM. The old
Sonic×Metroid campaign remains permanently retired.

The canonical module is `sonic.usa.character_traversal.air_phase`, sharing the
existing character-traversal source-system identity and actor across its role
facets. One bundle lists both recovered assemblies; air advancement is its
default assembly. [delivery.json](delivery.json) maps the whole core loop, required host
services and precise missing phases. [prefab-allowlist.json](prefab-allowlist.json)
contains only actual admitted graph entries.

The immediately reusable phase is **air position advance and gravity**:
`integrate → gravity`, preserving the original adjacent call order. It exposes
updated world position and vertical velocity through one explicitly shared
actor state. Two ready input configurations select original ordinary-air and water contexts.
A third lowering-admitted inversion configuration is retained as source-only
because its conditional velocity-frame contract is unresolved. These are one
prefab, not three recovered systems; their output behavior was not newly
native-qualified as an assembly.

A new automatic extraction advances beyond that old pair. The exact original
`0804456C` airborne steering/upward-drag body lifted without recovered C input.
It passed 1,024 original/emitted Thumb pairs, including 16 source-derived
expected-state cases for direction, cap crossing, inherited overspeed, special
poses, input locking and signed upward drag. The final local proposal and
receipt are under `local/ir/fleet-next/sonic-advance/air-steering-prefab-02/`;
[steering-intake.json](steering-intake.json) pins its seven meaningful ports.
Compiler-owned wave08 publication is complete, and a separate airborne-steering
prefab now passes actual Composer admission with its published package/behavior
pins. The builder uses that published package, never the private proposal.

Steering and advance must remain **separate source phases**. The mandatory
original world-wrap/bounds transaction `043E8C` executes between them and can
change camera, secondary actor and defeat state. The delivery names this host
boundary explicitly; no service stub or uninterrupted three-call controller
was fabricated. Native release/ability handling precedes steering; rotation and
four-direction collision/landing follow integration/gravity.

The smallest remaining ground-side admission work is also precise:
[semantic-port-intake.json](semantic-port-intake.json) proposes source-backed
meanings for already qualified slope, projection and detach roots. Existing
published behavior/manifest/adapter/receipt pins are retained. It requests
compiler-owner metadata refinement with unchanged native proof reuse, not new
behavior C or duplicate native runs. Detach needs freshly updated terrain
contact; a chain of arithmetic leaves is not a grounded controller.

Whole Sonic remains partial: input/task capture, jump admission, ability bodies,
ground control, world wrap, the six-argument terrain callback with aliased angle
outputs, the landing angle service, scene/death/retry and persistence are open
or host-required. Source-derived manually transcribed traversal scaffolding is
historical analysis, not a recovered portable whole controller.

Reproduce metadata/graph delivery only:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 research/deep-extraction/source-game-prefabs/sonic-advance/build_delivery.py
```

The builder reuses unchanged graph receipts. No ROM, native campaign, central
catalog, frontend or allowlist is modified. The local allowlist is an intake
proposal for the site owner. `readyToAdd` means valid graph reuse in the declared non-inverted context;
runtime and whole-game qualification remain false. See the delivery timing fields for
separate native-leaf and graph-validation costs; their nested stages must not
be counted twice.

The conservative source-frame restriction is pinned in
[source-frame-limitation.json](source-frame-limitation.json): current and prior
stage gravity flags must have 0x80 clear for the declared `world.y.down`
velocity frame. Original integration subtracts stored vy when gravity is
inverted. No conditional frame adapter was guessed.
