# Mashup topology baseline observations

Date: 2026-10-16
Target: `http://127.0.0.1:4173/v0?view=workshop`
Browser: isolated Codex in-app browser tab; no account login or external writes.

## Viewports

- Desktop CUA screenshot observed at 1280×720. The intro and studio title consume most of the initial viewport; the builder begins at the bottom edge, so the user must scroll before choosing a goal.
- Small viewport observed at 390×844 after selecting `Character control & traversal` and adding one prefab. The left responsibility cards stack into narrow columns. The canvas retains a desktop-width layout: role cards extend past the right viewport edge, and the fixed canvas header/toolbar consumes a large middle band, leaving only a slice of one role visible.

## Representative flow

1. Initial page offers a select plus nine long experience cards (one prompt, short description, and Build action per card). The first responsibility cards only appear below this catalog.
2. Choose `Character control & traversal`: progress shows `0 / 4` with four ordered responsibilities. The candidate list for Movement & jump controller contains many source records with long scope, qualification, and missing-work text. There are separate cards for source-derived modules and ready prefabs.
3. Add the Mega Man Zero `Source actor command response` prefab. Progress changes to `1 / 4`; its card becomes the chosen module. The system canvas has four responsibility cards and three dashed dependency links. The chosen card says it has five behavior/integration gaps and runtime gaps remain.
4. Open `Configure recovered behavior`: this leaves the system blueprint for a separate `Actual source mechanics` canvas with a single node. Five typed ports are shown on the node; detailed state/settings are farther down the page.
5. Open the state/settings inspector: one invocation-order item, five binding selectors, a configuration selector (only `No source configuration` available), an empty parameter-arguments JSON editor, and a second JSON editor for binding metadata. A separate shared-state panel lists six state slots with owner, shared toggle, and initial value controls. The completion banner reads `Bindings accepted · obligations remain unproven` and explains that it proves symbolic bindings/lowering only, not native execution or whole subsystem closure.

## Usability observations

- Goal selection is duplicated as a dropdown and nine full cards, delaying access to the responsibilities.
- The per-role source catalog is a long, dense second list beside the canvas. Candidate cards repeat status, source game, evidence, scope, gaps, and action controls; the user must scan substantial text before finding a compatible prefab.
- The canvas exposes four role cards and dependency edges, while edge semantics are available as hover/accessibility descriptions. The cards themselves have no direct port controls; “choose module” navigation returns attention to the long list.
- Positive binding acceptance sits alongside explicit unqualified gameplay/runtime caveats, but the two statuses are visually separated. A quick scan could overread the accepted state.
- Tuning is exposed through JSON and per-port dropdowns. State ownership/initialization is a separate panel. These are discoverable only after entering the advanced mechanic screen.
- The shared-role contract exists in source: a capability bundle can expose role-specific facets under one `moduleId`, and the UI should reuse one instance/shared backing. The current screen lists a candidate under each compatible responsibility and only surfaces shared ownership details in the advanced inspector, making this relationship hard to see while planning.

## Timing and evidence limitation

The CUA session returned each click/AX refresh in roughly 0.1–0.6 seconds; screenshot captures returned in under 0.2 seconds. These are tool round-trip times, not app render or user task-duration measurements. A selected-goal screen took one selection action; one ready prefab took one add action; tuning required opening the source-mechanics view and then the state/settings disclosure.

CUA emitted desktop and small-viewport screenshots inline for inspection, but its screenshot API in this subagent returns image bytes without a file export method. IAB visibility is unsupported in this subagent. An attempt to capture with the installed Chrome headless executable aborted with exit 134 before writing an image. Therefore this folder currently contains observations only; PNG/JPEG screenshot files could not be persisted through the available harness.
