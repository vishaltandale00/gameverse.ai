# Composition pipeline: first executable contract

2026-10-16 · v0.1 research checkpoint · Owner: Shishir's creation/improvement loop.

The output remains a native GBA cartridge containing a whole playable game. The
missing middle is an executable component contract between recovered ROM behavior
and native assembly. A searchable description is a discovery index; it is not yet
a component that can be instantiated safely. This checkpoint adds that middle's
initial schema and a small static checker, **not an automatic ROM generator**.

## What exists, and the gap

`tools/gba_mashup/component_lookup.py` resolves ontology records to imported-source
symbols, definitions and hashes. `extract_emerald.py` extracts selected functions,
constants and indexed pixels. `build_mzm.py` compiles a whole native campaign and
records inputs, source changes and output identity. Its `install_native()` still
uses fixed string replacement to insert handwritten bridge code. Existing recipes
mostly explain decisions in prose. They cannot derive component dependencies,
prove state ownership, or generate another game from a graph.

Those are useful native experiments, but they are not the architectural endpoint.
The next builder must consume a resolved component graph and explicit lowering
recipes. The generated C, assembly, link sections and host hooks are **outputs** of
that graph. An LLM may propose a missing bridge; that proposal must become a
versioned package with inspectable contracts and qualification evidence before it
can be reused. An arbitrary source diff cannot quietly stand in for composition.

**Latest provenance decision:** our own decompilation of the indexed ROM is the
authoritative substrate for the Sonic request. Downloaded community source does
not establish that we recovered a component. Prior source-based motion formulas
are comparative hypotheses until independently checked against our recovered ROM
instructions and traces. A Europe-source/USA-ROM mismatch is not a prerequisite
for this self-decompilation path. Existing native experiments retain their actual
origin; their provenance must not be relabeled retroactively.

The prior corpus snapshot contains 33 ROM portraits and 222 broad pieces, with 84
source-linked pieces and 305 granular references. That is uneven descriptive
coverage, not 33 complete decompilations or 222 reusable implementations. The older
Sonic export has 383 generated pseudo-C functions, 321 with C warnings, and no
verified I/O direction. Function discovery, boundary correctness, ABI recovery,
semantic names, transitive dependencies and campaign coverage remain separate
problems. The direct-ROM example here deliberately stays `unverified_lift`.

## The representation

[`ir.schema.json`](../../tools/composition/ir.schema.json) distinguishes two records:

| Record | Purpose |
| --- | --- |
| `component_package` | Reusable behavior/data/entity bundle with native recovery, typed interface, state, dependency closure, extraction and lowering recipes, and qualification obligations. |
| `composition_plan` | Immutable selected instances, bindings, shared state, finite authority modes, transforms, budget declarations, campaign obligations and human decisions. |

The UI's up-to-eight choices are **editorial bundles** pointing to many packages.
"Traversal", "ecology" or "discovery" remains understandable to the user without
making it one indivisible code function. Conversely, a bare palette or damage
function is not offered as a complete autonomous system. Packages expose required
companions; prefabs instantiate the appropriate hierarchy and wiring.

Important package layers:

- **Concept and role:** player motion, roaming opponent, typed lock, resource flow,
  or encounter strategy. This enables retrieval across games without pretending
  every native implementation shares an ABI.
- **Recovered implementation:** ROM SHA1/SHA256, address/range/ARM-or-Thumb mode,
  raw instruction hash, candidate/verified boundary, inferred-name status,
  lift-file hash and tool/run reference. A pseudo-C success is not verification.
  Dependency closure records calls, indirect targets, code/data pointers, tables,
  RAM ownership, hardware effects and relocations. Unknown closure blocks lowering.
- **Typed state and ports:** scalar storage, semantic quantity, units, coordinate
  frame/anchor and lifetime. Similar numeric types cannot hide incompatible
  velocity/displacement or world/surface frames. Overflow, arithmetic shift,
  signed casts, quantization and update order are behavioral obligations.
- **Behavior and authority:** tick/phase ordering, reads, writes, guards, invariants
  and exclusive owners. World position, health, camera, input, display and save
  serialization each need an explicit owner in every reachable mode.
- **Prefab/lifecycle:** entity identity, parent/child hierarchy, spawn, stream-out,
  despawn, defeat, rewards and persistent identity. Stream-out is not death. A
  creature's art, AI, collision shape, drops and encounter payload are separate
  component slots with explicit couplings.
- **Strategies and skills:** policies over observed state and legal actions, with
  objective, preconditions, memory, resource cost, termination and failure cases.
  "Switch to a resistant party member" is a policy; type effectiveness is a rule.
  A playtester navigation skill references world/contact/action capabilities and
  must not assume a top-down grid in a surface-following platformer.
- **World, assets and story:** projection/topology, collision materials, streaming,
  ability-consumer routes, animation anchors, hitboxes and resource leases. Asset
  recipes preserve palette/index/format transformations and VRAM/OAM/DMA peaks.
  Narrative is a beat/event graph with guards, effects, precedence, persistence
  and alternate outcomes. Setting/vibe/style records are editorial constraints
  with review status, not executable compatibility guarantees.

The v0 schema leaves prefab, policy, world, asset, narrative and lowering-detail
objects extensible. They are explicit extraction requirements, **not yet a
fully specified behavior language**. Each native extension needs its own version
and validator before a generator can rely on it. The static checker only supports
the bounded subset listed below; it does not silently evaluate prose invariants.

## The assembly path

1. **Recover from ROM.** Identify code/data using existing Ghidra/binutils and real
   execution. Retain raw ranges and tool settings. Infer behavior from multiple
   observations; unknown functions keep address-based names. Resolve direct and
   indirect calls, literals, tables, memory-mapped effects and shared RAM. Preserve
   original ARM/Thumb or opaque routines explicitly where lifting is incomplete.
2. **Extract and normalize.** Produce packages with a closure manifest and typed
   ports. Use ROM-to-pseudocode-to-trace links for each claim. Differential probes
   compare recovered operators to native execution with the same inputs, including
   negative values, boundary states and timing-sensitive cases. Never infer
   complete semantics from a title, one screenshot or a name borrowed from source.
3. **Resolve the graph.** Expand editorial bundles to package instances, select one
   whole-game foundation, close dependencies, bind ports and assign state owners.
   Return concrete conflicts and missing evidence. Retrieval similarity proposes
   candidates; it cannot certify interchangeability.
4. **Select explicit bridges.** Bridges are packages: input/output types, guarded
   authority transfer, preserved and deliberately changed semantics, pre/post
   conditions, resource budget, supported host versions and qualification cases.
   A new bridge can require code wrangling once; subsequent compositions reuse its
   interface and lowering recipe rather than repeating ad hoc edits.
5. **Lower deterministically.** Instantiate recovered code/retained assembly/data,
   generated state structs, host calls, adapters, event/spawn tables and save
   extensions. A host hook specifies exact ROM/source/backend identity, expected
   preimage, phase/order and cardinality. Reject missing/ambiguous hooks or unknown
   relocation targets. Keep unchanged campaign sections; do not reconstruct a tiny
   substitute world. Emit a lockfile and graph-to-output provenance map.
6. **Build and qualify.** Build a native ROM in isolation. Pin toolchain, inputs,
   extraction/lowering versions and artifact hash. Run bounded real-emulator
   scenarios with source/recovery-qualified RAM observations, raw inputs,
   screenshots and MP4. Boot, control, route, lifecycle, save and campaign evidence
   are different gates. A smoke run cannot prove a whole campaign.
7. **Submit and iterate.** Pass the immutable candidate envelope, independent save
   identity, adapter requirements, run evidence and known limits to Vishal's host.
   Registration and activation remain host responsibilities. The loop searches and
   repairs within explicit attempt/frame/time/model budgets. Failed and cancelled
   candidates remain inspectable and cannot replace accepted player progress.

This is a set of artifact contracts, not a mandatory central service. Vishal's
new navigation/controller infrastructure and the GBA player need no knowledge of
the loop's internal graph algorithm. The submission and isolated adapter contracts
in `contracts/PARALLEL_DEVELOPMENT.md` remain the integration seam.

## Executable examples

[`resolve.py`](../../tools/composition/resolve.py) uses only Python's standard
library. It checks selected dependency closure, exact versioned capabilities,
single writers per declared mode/phase, required authority coverage, persistence
ownership, port cardinality/direction, storage/quantity/unit/frame signatures,
declared additive peak budgets and route capability prerequisites. It emits
structured conflicts and obligations. It never builds or edits a game.

| Example | Result and reason |
| --- | --- |
| `sonic-mzm-unadapted.json` | Rejected: simultaneous position integrators, velocity/displacement and coordinate mismatch, missing surface-momentum capability for a retained loop. |
| `sonic-mzm-hybrid-proposal.json` | Declared type and single-writer conflicts resolved; still unresolved. Ordinary, surface and inherited-launch modes need recovered implementation, guard/transfer evidence and actual route witnesses. |
| `mzm-pokemon-wild-lifecycle-audit.json` | Rejected when cartridge party persistence is required: existing full-emulator checkpoint support does not implement a cartridge-save serializer. It also exposes ledger eviction and art/allocation obligations. |
| `sonic-own-recovery-partial.json` | Package of an actual own-export candidate at 0x080000c0 with raw instruction/ROM/lift hashes. Intentionally unclassified and not lowerable; no motion semantics claimed. |

For Sonic/Metroid, the hybrid proposal preserves the human decision: Sonic tangent
momentum, slope gravity, loop contact and authored impulses remain authoritative
on those routes. MZM-style controls apply in compatible ordinary traversal. The
comparative vertical transform declares **shift first, scale, then reverse sign**;
directly scaling velocity and integrating changes quantization. Leaving a loop
must preserve inherited speed rather than clamp it immediately. A checked local
origin prevents narrowing global Sonic positions to MZM's local representation.
Contact guards, jump normal, slope-edge hysteresis, horizontal motion, reversed
gravity, springs and route coverage remain obligations. The checker does not
pretend a mode name proves the implementation or that an ordinary speed cap can
traverse every authored loop.

For Metroid/Pokémon, a prefab binds native field identity/AI, mapped art and the
single-wild encounter payload. Mode transitions transfer input/display leases,
pause field state, retain the player's party and resolve the exact actor outcome.
Retreat, victory, full-party defeat, camera unload and reload have separate
effects. The current 128-entry defeat ledger and missing native save serializer
are visible semantic limits; labels such as "persistent" cannot conceal them.

CLI exit codes: 0 means no declared conflicts/obligations,2 rejected, 3 unresolved.
Even 0 means only static consistency of the supported declarations. Every report
sets `ready_for_lowering:false`; source closure, arithmetic proofs, lowering
implementation and exact-ROM qualification are outside this v0 checker. JSON
Schema validation is a separate structural pass; the CLI is not a general schema
validator. The transform operation list is retained, not executed or proven.

## Migration and acceptance gates

| Stage | Concrete work | Acceptance gate |
| --- | --- | --- |
| A: direct recovery | Corpus agents publish own-ROM recoveries; prioritize motion/contact, spawn/despawn, render allocation, damage/resources, progression/save and event seams. | Every promoted package links raw instructions/data and witnesses; unknown boundaries/ABI/closure remain explicit. |
| B: closed packages | Recover one motion operator plus host contact contract, one entity prefab and one resource/rule policy. Make extraction closure machine-readable. | Re-extract from pinned ROM without hand editing outputs; raw/native differential cases agree or documented adaptation is selected. |
| C: reusable backend | Convert current handwritten bridge and string hooks into named lowering operations with exact preimage checks and graph-to-file provenance. | Two distinct composition plans instantiate the same packages/backend without editing the builder or native bridge by hand. |
| D: resolved hybrid | Implement verified mode transfers and actual route/upgrade placement records. | Flat movement, reversal, jump release, slope, loop, spring, landing, gates and recovery witnesses against the candidate ROM. Unknown campaign routes prevent completion claims. |
| E: whole-game delivery | Expand route/lifecycle/save coverage across the retained campaign; register through normal Play. | Independent progress, return/resume, bounded campaign evidence, screenshots/video and inspectable limits; no browser-game surrogate. |

Next extraction work should deepen the sparse games and common semantic seams,
not inflate keyword counts. Across the corpus we still need verified gameplay
phase/state layouts, collision/material/topology schemas, entity lifetimes and
interactions, resource transitions, progression prerequisites/consumers, AI
policies, event/plot causes and asset ownership/format closures. A high-level
"vibe" can be useful before native closure, but it must carry a different evidence
status from an executable component. One corpus matrix should track description,
own code recovery, semantics, closure, lowering and native qualification separately.

LLMs propose semantic interpretations, graph changes, bridges and repairs. Local
d1 or OpenAI Decisions can cheaply classify observed phases, select among legal
actions or rank suspicious interactions. Neither model substitutes for type checks,
arithmetic/native parity, resource ownership or route evidence. Calibrate judgments
on labeled trajectories before using thresholds for acceptance; current native
experiments already show why valid transport is not correct judgment.

## Cost and measurements

This checkpoint adds no dependency, CI job, matrix, ROM build or paid call. The
nine narrow resolver checks cover actual conflict classes and were expected to
cost well under a second of execution. `python3 -m unittest
tools.composition.test_resolve -v` passed all 9 and reported 0.001s; that is runner
test time, not a ROM build or before/after throughput comparison. The retained
`validation.json` records a separate schema/example/checker pass and its context.
No previous IR resolver exists, so a comparable before measurement is unavailable.
Queue, build, simulation and model-evaluation duration for this research checkpoint
are unavailable, not zero. They must be measured separately when those stages run.
Full campaigns and expensive model evaluation remain separately scoped work.
