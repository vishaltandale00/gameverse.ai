# Mario mechanics coverage and compiler evidence

This lane maps missing mechanic families and their actual own-ROM dependency chains for the automatic L0 → executable L1/L2 compiler. It does not supply hand-recovered C as generation input. The existing manual recovery packets remain independent analysis/oracle evidence.

[The coverage inventory](../../automatic-ir/mario-mechanic-coverage.json) tracks 44 game-specific family obligations across Super Mario Advance, Mario World, Mario 3, Mario & Luigi and Mario Kart. Every game remains incomplete. Families are open to further discovery; a checklist, exported function count or passing integrator does not prove that every mechanic has been found.

| File | Actual scope |
| --- | --- |
| `mechanics-targets.json` | 57 causal gameplay targets, own-ROM instruction/export hashes, callers, dependencies, state roles, acceptance obligations and two bounded indirect dispatch maps |
| `l0-context-evidence.json` | Three hash-pinned L0 context/domain profiles used to resolve original player/character/engine references; no behavior implementation |
| `context-observations.json` | Read-only roots from three retained checkpoints (0.0923 s), plus a separate stock Mario 3 actor-view snapshot (0.03095 s); one rendered restore frame each |
| `sma4-collision-service-contracts.json` | Local collision-frame domain, conditional scratch outputs and stateful tile-query service requirements |
| `sma4-pair-reaction-semantics.json` | Eight typed pair-contact state fields plus relative-position argument, pinned to original machine dataflow and consumers |
| `sma4-actor-dispatch.json` | Actor collection/handle ownership, walking/hopping AI phase closure and instruction-confirmed pair-reaction ABI; other actor types remain discovery targets |
| `sma1-character-profile-selection.json` | Own-ROM selector-to-parameter constructor and four source configurations, with only two character identities natively witnessed |
| `sma1-unit-calibration.json` | Six retained original-ROM adjacent-frame witnesses, establishing velocity units independently of storage names; no new gameplay run |

## What is already recovered, and what still needs closure

SMA1 has finite manual native evidence for character jump/hover, running/charge and clearance-tested release. The automatic pipeline now additionally qualifies gravity/hover and jump after explicit separate object bindings and bounded selector domains. The full terrain→interaction→carry→throw-hit→hurt/death→room/persistence chain is still unfinished.

Mario World has manual controller/spin transaction evidence, automatic pixel/subpixel integration with typed ports, and newly automatic gravity parity. The missing parent systems include contact eligibility, other attacks/projectiles, enemy/boss AI, form ownership, life/retry logic, terrain producers and persistent world progression. A few typed integration ports in a new clean-ROM composition are useful building blocks, but do not reproduce the whole controller.

Mario 3 has finite manual jump/wall, accepted stomp and item-pickup effects. Automatic packages currently close only smaller storage behaviors. Its pending pickup command at player+0x50 is distinct from active form at+0x37; the player tick commits it, refreshes animation/palette and publishes per-character ownership. Weapons and flight must consume the active state through their real legality/update phases. Treating pickup alone as an assembled ability would omit those dependencies.

Mario & Luigi and Mario Kart have independent ROM exports and observed presentation, but no qualified automatic mechanic closure in the current inventory. Their obligations are RPG battle/party/progression and racing controller/items/laps respectively. Unverified gameplay priors are investigation questions rather than recovered rules. The bundled Mario Bros engines in the Advance cartridges are separate unfinished engines; the main games' evidence does not cover them.

## High-value causal closures handed to the compiler

- **SMA1 carry, damage and death:** grounded interaction → 12-slot plucked-object creation → held attachment → clearance-tested release → collision/hurt → carried-reference release on death → timer → life decrement → retry selector. Original functions identify real state ownership; thrown-hit and retry consumer/persistence remain to be closed.
- **Mario World contact, form and lives:** contact dispatch chooses top/side response → powered downgrade or small-form death → native state table chooses hurt recovery/death → death countdown decrements lives and selects retry/game-over events. Reserve-item drops and carried release are additional dependencies, not optional discarded visual effects.
- **Mario 3 contact and forms:** eligibility → top/side policy → accepted stomp or damage → pending form downgrade → next player-tick commit → actual ability update. Death has its own state dispatch and stage-event consumer. Normal allocation uses 15 slots, while the actual actor scheduler updates 18 records including three reserved slots. Visual rewards have a separate 15-slot pool. Failure and retirement behavior are explicit.

The packet separates notifications from services that affect mechanics. For example, Mario 3's score service changes a world-owned reward accumulator before allocating a visual reward; its persistence/resource meaning remains unqualified, while its death phase waits for audio completion. Neither can be replaced by an ignored renderer callback without preserving those causal effects.

## Context and unit constraints

Observed SMA1 player and parameter objects occupy different RAM/ROM regions. Mario World's broad padded analysis buffers are not safe ownership contracts: a former `engine[0x1200]` range overlaps the following map object, and a former `scene[0x1000]` range includes player storage. The compiler must preserve accessed sparse windows and physical aliases, or reject overlapping relocated objects; arbitrary buffer copies can invent independence.

SMA1 world position uses 1/65,536 pixel per raw unit. Integration adds arithmetic-shift-right-four of velocity plus carrier, so velocity uses 1/1,048,576 pixel per native update per raw unit. A `-96 << 16` velocity therefore moves six pixels per update. “16 fractional bits” alone does not specify the semantic velocity unit. Carrier consumption, wrap, contacts, frame orientation and scheduler invocation remain explicit contracts.

## Evidence limits and continuation

New discovery targets are static causal analysis until automatic lifting, original/emitted native parity and meaningful connected input witnesses qualify them. Saved native contexts support particular observed states, not universal pointer separation or reachability. Source state/ROM hashes and instruction ranges are retained; private ROMs, checkpoints, packages and recordings remain ignored. No browser gameplay, repeated broad suite or paid model campaign was run for this investigation.

Continue the connected closures above, then enumerate actor/species dispatches, ability modes, terrain interactions, bosses, stage flags and persistence services. Keep unresolved dependencies visible. No Mario game or complete mechanic family is currently declared finished.
