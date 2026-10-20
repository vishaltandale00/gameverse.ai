# Modern mashup UX review — final

Final status: **PASS for the tested recovered-prefab operations, role-specific source boundaries, and unwanted-section removal.** Actual browser checks and inspected previews support the verdict. Whole character/combat/exploration systems remain incomplete; no game or native gameplay qualification is claimed. The history below retains superseded interfaces and faults so earlier screenshots cannot be mistaken for final evidence.

Review uses the actual local app at `http://localhost:4173/v0?view=workshop` in an isolated temporary headless Chrome profile on port 9232, using installed Chrome and the existing `ws` dependency. No new dependency, broad CI, generated game, ROM, or native gameplay run. CUA inventory was inspected first and exposed no managed browser surfaces; the previously failed IAB/declined Safari route was not repeated. Existing headless infrastructure supplied the working browser path. Chrome review state is separate from other reviewers' storage.

## Actual findings and repairs so far

1. **Blocking geometry/CSP defect found through actual rendering and hit tests.** Initially nodes carried distinct HTML `style` position attributes but every node rendered at identical coordinates after rerender. Clicking an intended minimum2 port physically hit minimum3 instead. Server `style-src 'self'` rejects HTML inline style attributes. Owner removed those attributes and initializes geometry/colors through CSSOM, preserving the security policy. Actual reload shows distinct native bounds (example gravity x551 vs jump x881) and matching visible port hit targets. Old `ports.json`/initial screenshots retain the failure; they are not passing evidence.
2. Initial full rerender lost open inspector details and unapplied JSON drafts. Owner added exact focus preservation and per-instance drafts. Actual browser test retained `{ "draft_retain": 42 }` across node switches and kept details open.
3. Global click-to-top source was BODY captured by the navigation `[data-view]` selector. Scroll owner scoped navigation; independent canvas node-selection check keeps page y363 unchanged. Wheel zoom leaves page y548 unchanged. Scroll owner's separate 13-check evidence is at `research/ir-workshop/scroll-position-20261016/verification.json`; this review does not claim to have rerun all of it.
4. Source patterns use recorded wiring plus explicit revalidation/runtime-unqualified copy; six actual cards were inspected in browser DOM. The source-only ownership/acquisition pattern has no graph-load action and offers Add only for the explicitly published acquire role, not its unmapped count role. The new blueprint revision must preserve these distinctions.

## Focused browser evidence retained

- `regression.json`: actual CDP pointer drag moves node x0→60/y0→32; keyboard ArrowRight adds ten; Delete 2→1 nodes and Undo 1→2; selecting a node preserves page y363; dirty inspector arguments survive switching; search retains focus, returns four gravity matches, leaves the graph intact.
- `connections.json`: background pan changes scene translation; wheel zoom changes scale to 113% without page scrolling. CDP drag/drop carrying the actual published mechanic MIME adds one published package. This checks browser drop handling; it does **not** establish the entire physical dragstart gesture from the palette card. Real Composer response accurately reports symbolic binding acceptance plus private/default-state warnings. No game is created.
- `typed-port-check.json`: after the geometry repair, actual click on an incompatible input on a different visible node shows “Declared quantity or coordinate frame differs” and leaves canonical graph JSON unchanged. The first pattern has an adapter-required vertical-velocity pairing, not an exact candidate pairing; no candidate success is inferred from it.
- `final-ports.json`: actual six-pattern inventory, explicit role package IDs and revalidation copy; recorded wiring loads with separate node bounds; actual Composer response is truthful. Earlier naive first-input selection and same-node mismatch attempts are retained as test-target limitations, not successful connection evidence.
- `actual-wired.png` and `actual-empty.png` are preliminary rendered screenshots, before the final blueprint-first revision; neither is the final user preview.

## User-directed acceptance still to verify

Start with a goal/blueprint rather than an unrestricted parts dump. Show required/optional roles and cardinality, make missing roles and completion progress visible, provide only contextual candidates with honest fit/adapter/missing reasons, allow replace/extend, and send the actual resulting graph to the real Composer. Remove parts-bin sections throughout the interface. Preserve polished canvas interaction, drafts/focus/state, useful validation errors and no click-to-top behavior. Final actual screenshot must show the completed new flow and a meaningful graph.

No visual or usability approval is issued for the new flow until that current implementation is rendered and inspected. No fresh human study, touch-device review or screen-reader session has been performed. Timing evidence so far is scope-specific command wall time (focused regression about 2.56 s, connection scenario about 2.28 s); no comparable UX latency baseline or total authoring/review duration is claimed.

## Blueprint-first technical checks (superseded content, not final acceptance)

Actual fresh-browser evidence in `blueprint-novice.json`: six initial goals, zero pieces/candidates until a goal is selected, no visible parts-bin label; wait initialization/poll blueprint starts 0/2, then 1/2 with next role, then 2/2 with “review state and connect” rather than game-complete language. Applying recorded wiring is a separate enabled action only after exact roles are filled. Real Composer accepts the resulting symbolic graph with explicit unbound/default-state and lifecycle/domain warnings. Swap preserves two nodes and clears that role's bindings, with an explicit revalidation message. Page y529 remains stable across initial selection and both fills.

`blueprint-missing.json`: the source-only count role shows no Add, explicit unavailability and cannot-claim-complete language. Adding its published acquire role yields 1/2, still points to the missing count role and keeps recorded wiring disabled. Switching back preserves prior role work. This demonstrates truthful incompleteness, not full system capability.

Remaining layout finding reported to owner: default newly filled nodes x741/x831 at width280 overlap by190 pixels. Automatic usable blueprint placement is required; a novice should not have to manually separate every part just to inspect it. Also requested a near-canvas current validation stage so successful Composer response is visible without searching below the editor.

**The user then rejected these blueprint contents as meaningless low-level screws. Technical success above does not resolve that request.** Wait/poll, codecs and counters are not accepted as recognizable gameplay-system starting points. Final review is held for the `game_system_experience` lead's system-level revision: player-understandable character/traversal/combat/exploration assemblies, plain explanation of each contribution, coherent subsystem completion steps, and honest separation of available capabilities from unresolved game-system gaps. Renaming low-level primitives alone will not pass this review.

## Immediate assembly-basket removal — verified

After the removal checkpoint, hard-reloaded the actual served app and checked both Workshop and Discover. `basket-removal.json` records zero basket/tray elements, zero selection/export controls, and no visible “assembly basket” or parts-bin labels in either view. Research search, detail inspection and 831 browsable source records remain. This is removal, not relabeling the old tray. The meaningful game-system flow remains under review separately.

## Whole source-library section removal — final removal scope verified

The user clarified that removing the basket alone was insufficient. Fresh actual-browser `section-removal.json` now checks Workshop and Discover: `#ontology-library`, `#ontology-workbench`, `.ontology-browser` are absent, as are basket elements, the unwanted section title and old browse-library anchor. The studio and original game collection remain. This supersedes the earlier basket-only finding and does not claim the research browser remains mounted.

## Coherent-system experience — current review

The primary UI now presents Character control & traversal, Combat & enemies, and Exploration & progression. Independently inspected `actual-system-review.png`: the combat canvas shows attack creation, contact eligibility, health/reaction update, and defeat/cleanup responsibilities, with one chosen recovered module and explicit remaining roles. This is materially different from renaming primitive function cards. Required design progress is labeled as design progress; dashed relationships explicitly do not establish functioning integration. Source-only contact admission is distinguished from the bounded damage/reaction core.

The first actual coherent-system checkpoint correctly disabled execution when current source packages/bindings were not ready. It was not treated as working recovered behavior. Another critical review finding was that choosing a module merely added unbound primitive packages. The lead replaced that with an actual recorded-prefab graph import helper; final actual add/configure/validate/run checks are pending its stable UI checkpoint. New state-consistency risks reported: undo must restore/reconcile both module choice and actual graph; clearing a module must have an honest relation to retained internal components. No prefab acceptance until verified in the current browser.

## Final verdict — pass for the two supported prefab workflows

**The final actual UI supports meaningful, ready-to-add recovered prefabs rather than an unfiltered primitive parts bin.** I inspected the final rendered screenshots myself: `final-prefab-combat.png` (primary preview) and `final-prefab-progression.png`. They show coherent responsibilities, a selected wired module, honest surrounding gaps, readable configuration, and an actual HP/reaction result. The primary view no longer exposes primitive function nodes as the user's starting building blocks. The removed source-library section remains absent. No blocking issue remains in these two reviewed workflows.

This is a bounded interface verdict, not certification of complete character/traversal/combat/exploration systems. The final screenshot deliberately remains at **1/4 modules chosen, Design progress**. Open attack creation, contact admission, defeat, discovery, reward consumers and persistence are not fabricated. Traversal/controller closure remains a source/integration task, not a completed character created by choosing cards.

### Actual functional evidence

`final-prefabs.json` records the fresh browser's two paths (5.521 seconds scenario wall time):

- **MZM Add ready prefab:** imports two real pinned packages, thirteen typed/namespaced states, two invocations, the canonical shared enemy fields, initialization and result binding. This replaces the rejected behavior of adding two loose unbound functions.
- **Editable recovered behavior:** HP 10→20 and damage 3→5 are reflected in the actual added graph (`enemy_hp` initialization 20, source damage constant 5). Run executes the real generated C core: HP **20→15**, accepted-hit reaction **17**, then eligible updates **16→15**. The UI explicitly limits this to an already admitted contact and later source invocations; no frame/seconds or rendered-combat claim.
- **Inspect/return:** actual bound internal graph shows two nodes and three shared-state wires, with a working Return to game system action.
- **Remove/Undo:** removes the owned components, all unused state and calls, and returns design progress to 0/4. Undo restores both the exact graph and module choice, back to 1/4. This fixes the reported choice/graph consistency risk.
- **Minish Add ready prefab:** imports three more pinned packages and five ordered invocations, including repeated write→refresh steps and the held-input result. Combined graph has five components, twenty typed states and seven calls. The canonical inventory backing and namespaced owners are retained.
- **Minish configuration:** turning off faster-charge learning changes the real technique-115 source write from one to zero, while technique-72 remains one. Source charge constants stay fixed. This checks actual configuration, not just checkbox appearance.
- **Current real Composer admission:** `prefab-receipt.json` retains the actual response for the edited combined graph: `valid: true`, `binding_valid_obligations_unproven`, no errors, invocation count seven, with the explicit runtime/lifecycle/domain warning. Validation wall time recorded by that response is about 0.007545 seconds. The report is intentionally separate from whole-system runtime qualification.
- **Unavailable role:** world pickup eligibility displays a disabled “Implementation needed” action. Choosing other modules never silently supplies this missing behavior.

`final-view.json` confirms the current coherent system cards still respond to actual pointer drag and keyboard nudge. CSSOM geometry and fit reserve keep cards separate and the bottom controls clear of card footers in the final screenshots. The earlier CSP and overlapping-default-placement blockers are resolved. The final combat preview includes one bounded rerun of the unchanged source action solely to display its actual result after returning between views; it is not an additional qualification campaign.

### Limits and remaining polish

Fit-all text on the canvas is small at 73–80% zoom; the selected module's primary controls, outcome and trace remain readable. Zoom and focus inspection are useful for detailed source work. No touch-device, screen-reader, Safari, or fresh-human comprehension study was run. The review did not execute native game/ROM gameplay, qualify a complete encounter, or prove all source-design candidates ready to add. Explicit same-bundle reuse was independently checked later; see the final bundle addition below.

No new dependency or broad CI was added. Actual scenario timings are retained in `verification-summary.json`; they are not an end-to-end turnaround baseline or improvement claim. Source commit and current relevant source-file hashes are pinned there. No further unchanged broad suite was run.

## Final capability-bundle addition — narrow actual-browser check

`bundle-facets.json` verifies Mario's terrain/contact dependency is visible under the traversal responsibility: its card says source recovered / implementation not assembled, explains that terrain producer `0x080a821c` lies outside the closed motion/controller parts and landing/contact resolution remains host owned, and offers **Use source design**, not Add ready prefab. Browsing it leaves the canonical implementation graph unchanged. The displayed movement and ground responsibilities can therefore reference one source bundle without pretending the missing terrain service was recovered.

`bundle-reuse.json` verifies the explicit **Use existing bundle** action against the already added MZM prefab: both roles reference the exact same two instance IDs and state mapping; the entire canonical graph remains byte-for-byte unchanged. The contact role continues to show **Source recovered · implementation not assembled** and **Source design · integration open**. Reusing a known damage/reaction implementation does not promote missing contact admission to a working role. No second enemy/state backing is created. These two focused checks took approximately 0.679 and 0.306 seconds command wall time; the broad earlier checks were not repeated.

The primary final combat screenshot was refreshed and visually re-inspected after these changes. It now shows **2/4 design modules chosen**: one wired recovered damage/reaction prefab and one source-only contact facet sharing that bundle. Both attack creation and defeat remain visibly open. This replaces the earlier 1/4 screenshot state; neither design count means a complete combat system. The Minish progression screenshot remains the reviewed second-prefab preview.

## Final Aria specialization and retained-result checks

`aria-variant.json` records the actual chooser defaulting to `aria.soul.acquire.category3`. Adding it creates one category3 acquire component and receives actual Composer admission. Selecting category1 changes the action to **Replace with selected category**; applying it leaves exactly one Aria component, `aria.progress.category1_acquire`, and updates the chosen prefab identity. The previous category3 component is gone. Categories are variants of one source module, not four automatically cloned actors/banks. Only this category3→category1 UI path was reviewed; no UI assertion is made for every possible category input.

That first specialization check also retained old, unreferenced Minish internals when switching module families. The owner repaired cleanup. The final fresh `ownership-replacement.json` verifies Minish's three components are replaced by one Aria category3 acquire component, **no Minish components remain**, only the canonical soul-bank state remains, and actual Composer admission passes. The earlier intermediate artifact remains retained; it is superseded by this final cleanup proof. The scoped regression took 1.374 seconds command wall time.

`retained-run.json` verifies the final result-preservation fix. An actual source run is saved with its inputs and receipt; forcing the same role's interface rerender retains the exact same receipt and HP20→15 result. The ready probe no longer replaces it with an empty “ready” state. The UI explicitly labels **Retained actual source-core run: damage 5, HP 20, 2 eligible updates**. This is a real retained response, not a fabricated result for edited inputs. The final combat screenshot was captured in that same browser session immediately after the forced rerender and visually inspected. This test exercises the same component remount that catalog refresh uses; it did not wait for or claim a separate full timed catalog-refresh campaign.

Final deliverables: `final-prefab-combat.png` is the primary user preview; `final-prefab-progression.png` is the inspected Minish preview. `verification-summary.json` pins the current relevant source hashes, source commit, evidence paths, actual bounded timings and limits. No blocking issue remains in the reviewed current operations. Broader system recovery, surrounding runtime integration and full-game behavior remain explicitly outside this UI verdict.
