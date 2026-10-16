# Candidate game attempt scaffold

This creates a small playable **reference grid game**, runs it through the shared
playtester, and keeps the request, ontology anchors, candidate, observations and
failures together. It is an executable starting point for later natural-language
mashup requests to Codex. It does not reconstruct ROMs, reproduce complete GBA
games, compile ontology descriptions into recovered rules, or copy game assets.

The default generator is a deterministic, hand-authored mechanic template:
four-direction tile movement, collecting a key, returning to a locked gate,
opening it and reaching an exit. Selected source components are design analogies
whose simplifications are recorded explicitly in the request. Changing the
selected ontology IDs alone does not create a new implementation of those rules.

## Run the complete offline demonstration

From the repository root, with Python 3.10+:

```sh
python3 -m tools.game_attempt
```

This requires no model key, network, dependencies or build. The default
[request](examples/key_gate.json) selects Emerald's `grid_step_locomotion` and
Zero Mission's `ability_gating_graph`, including adaptation notes and bounds.
It generates a candidate manifest and plays it using the same
`tools.playtester.core.Playtester` / `GridAdapter` / `FrontierPolicy` used by
the standalone tester. The reference adapter knows the complete candidate map;
this is not blind visual discovery or a ROM playthrough.

The first retained demonstration, `20261016T052513Z-a27bac26`, reached the goal
after **9 actions / 9 reference simulation frames**, observing the acquired key
and opened gate. Its measured total was **0.030702 s**, including source pinning
and persistence; generation 0.000013 s, validation 0.001384 s, playthrough
0.011147 s. These stages are nested inside total time. This new scaffold has no
comparable pre-change latency baseline. Times are for this tiny reference game,
not GBA emulation, game generation quality or a general success rate.

## Ask Codex for a candidate

A request such as “Try an abstract exploration game with Emerald-style tile
movement and an equipment-gated route, maximum 12 by 8 cells” can be translated
into the same versioned request JSON. `intent` preserves the natural-language
goal; `components` names the selected ontology game/component IDs and describes
each intended adaptation; `constraints` limits dimensions and episode length.
Cross-dimensional ideas can use other source components, but this first runtime
only supports the documented grid mechanics. Art, sound, physics, story and
other systems require additional implementations/adapters before evaluation.

```sh
python3 -m tools.game_attempt --request /absolute/path/request.json --output-root local/game-attempts
```

Each selected component is resolved to its exact top-level ID in the canonical
`ontology/games/<game-id>.yaml`. The scaffold stores its component block hash,
whole-file hash, source line range, original evidence-reference lines and a local
snapshot of the abstraction. This scanner locates canonical component blocks;
it does not parse arbitrary YAML, resolve every cited decompiled symbol, or
revalidate the source claim's truth. Later revisions can refer back to these
snapshots and the tested candidate hash.

## Optional bounded model generation and decision control

Model generation and playtest control are separate selections. The default
`--generator template --policy frontier` makes no provider calls. Explicit
`--generator local` or `--generator openai` makes **one** Chat Completions request
for JSON data, with no retries, tools, generated code or fallback. The generated
object may change only title, dimensions, start/goal, walls, keys, doors and
episode length. Identity, source anchors, runtime selection and explanatory
limitations remain controlled by the scaffold. JSON mode does not establish
schema validity or solvability: both are checked locally and by actual play.
This reference attempt requires nonempty keys and doors. The first manifest
door is the required gate; actual observations must show its required key
collected and that gate opened before entering the goal. A bypassed gate is
recorded as `objective_unmet` even if the generic adapter reports a goal win.

| Generation provider | Key | Model | Base |
| --- | --- | --- | --- |
| `local` | `LITELLM_API_KEY` | `--model`, `LITELLM_GENERATION_MODEL`, or `ramblerun/Multimodal-AI` | `LITELLM_BASE`, default `http://rrh-llm-1:4000` |
| `openai` | `OPENAI_API_KEY` | Explicit `--model` or `OPENAI_GENERATION_MODEL` required | `OPENAI_GENERATION_BASE_URL`, default `https://api.openai.com` |

Credentials remain external. `.env.local` is not loaded automatically. d1 is a
decision model and is used for action selection rather than JSON generation.
For local generation, `LITELLM_GENERATION_ENABLE_THINKING=false` explicitly sends
`chat_template_kwargs: {"enable_thinking": false}` to the proxy. `true` is also
supported; an absent variable omits the argument. OpenAI never receives it.

```sh
# One local JSON-generation call, then offline control.
python3 -m tools.game_attempt --generator local --generation-tokens 1024 --generation-timeout 30

# Template candidate, explicit local d1 action selection.
python3 -m tools.game_attempt --policy d1 --max-decisions 20 --max-seconds 30

# Explicit OpenAI generation requires a chat model available to your key.
python3 -m tools.game_attempt --generator openai --model "$OPENAI_GENERATION_MODEL" --generation-tokens 1024
```

The generation socket timeout defaults to 30 s (maximum 60); output cap defaults
to 1024 tokens (maximum 4096). Native OpenAI uses `max_completion_tokens`, while
the existing local proxy uses `max_tokens`. Playtesting defaults to 80 steps,
4800 frames, 10 s, at most 20 decision calls and zero LLM escalations. Override
these bounds explicitly via `--max-steps`, `--max-frames`, `--max-seconds` and
`--max-decisions`. Socket limits and tester deadlines are checked at operation
boundaries; they are not a guarantee of zero wall-time overshoot.

Generation providers are optional primitives tested with offline response
fixtures. Their successful live generation has **not** been measured here.
The separate decision-provider live smokes do not establish generation quality.

## Retained results and revision seam

Every attempt gets a new directory under `local/game-attempts/<attempt-id>/`:

- `request.json`: intent, component selection, adaptations and constraints.
- `sources.json` and `components/*.yaml`: exact abstraction snapshots and source anchors.
- `proposal.json`: bounded untrusted model text, when a model returned content; saved as data only.
- `candidate.json`: generated manifest, including invalid data proposals when available.
- `playthrough/events.jsonl` and `playthrough/report.json`: observations, actions, transitions, provisional barriers and actual terminal result.
- `attempt.json`: outcome, hashes, configuration, stage timing, failure reason and artifact links.

`local/game-attempts/attempts.jsonl` appends successes, failures and cancellations.
A schema-valid candidate which fails to reach the goal remains a failed
playthrough; it is never promoted or registered automatically. The scaffold
neither edits accepted player saves nor changes Vishal's runtime/host contracts.
To revise an attempt, supply a new request and compare its immutable snapshots,
candidate and playthrough evidence with the previous run.

Total, generation, validation and playthrough wall times are retained.
Queue/build/cost measurements are explicitly unavailable; no build occurs for
this data-only runtime. Source commit, generator-code hash, provider/model,
limits, attempts and repair count are recorded. Generation, validation and
playthrough are sequential stages nested inside total, not additional elapsed
time. Failed calls never include raw exception messages or credentials in the
report; known environment-key echoes are scrubbed before JSON persistence.

## Narrow checks

```sh
python3 -m unittest tools.game_attempt.test_attempt -v
```

Offline checks cover exact provenance,
path/anchor validation, the observed successful playthrough, constraint failure,
rejection of model code/provenance fields, a schema-valid but unreachable goal,
native/local generation wire differences, missing credentials, failure
retention, the local thinking flag, required key/gate qualification, bypassed
goal rejection and no implicit retries. They add no CI job or dependencies.

Generation transport follows the
[official OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
(checked 2026-10-16). Shared decision control is documented in
[tools/decisions](../decisions/README.md); the reusable playtester is in
[tools/playtester](../playtester/README.md).
