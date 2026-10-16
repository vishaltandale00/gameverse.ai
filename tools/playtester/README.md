# General playtester

This is an executable, bounded controller for isolated game experiments. It
observes a game, selects a short target/action, executes only supported inputs,
observes the result, and retains a transition graph and possible barriers.
Local d1 is the default **model** provider; OpenAI Decisions is an explicit
alternative. The default CLI policy is the offline reference baseline, so an
example command cannot unexpectedly incur model charges.

The implementation reads and carries forward ideas from
`~/Projects/siddarth_pokemon/dev_scripts/sid/sidbot.py`: structured observations
when available, deterministic navigation below target selection, decisions at
junctions, slower reasoning over the same finite options when uncertain, and
retained stops. It does not assume that every game has Pokémon's decoded ELF
symbols, coordinate system, objectives, collision grid or battle state.

## Run the reference game

Python 3.10+ and the standard library are sufficient. No install, CI job or
model account is needed:

```sh
python3 -m tools.playtester --game tools/playtester/examples/key-door.json \
  --policy frontier --output local/playtests/reference-001
```

The adapter consumes an external, data-only game manifest. It collects a key
by entering its cell, opens an adjacent door with `interact:<door-id>` when its
key is held, and succeeds by entering the goal cell. Keys are reusable. Every
action advances one simulation tick (reported as a reference frame, **not** a
GBA frame). `navigate:<target>` uses BFS but executes one hop before observing
again. Target macros continue deterministically while adapter-supplied structured
progress advances, the target action remains available, the scene stays the same,
and the adapter does not request another decision. The baseline prioritizes available objective/key/door routes, then
unvisited adapter-predicted neighboring states. This reference adapter has
complete map knowledge from the manifest; it is not a visual discovery result.

```json
{
  "schema_version": 1,
  "game_id": "candidate-001",
  "title": "A data-only candidate",
  "width": 9,
  "height": 5,
  "start": [1, 2],
  "goal": [7, 2],
  "walls": [[4, 0], [4, 1], [4, 3], [4, 4]],
  "keys": [{"id": "key", "position": [2, 1]}],
  "doors": [{"id": "door", "position": [4, 2], "requires": "key"}],
  "max_episode_steps": 80,
  "source_components": [],
  "notes": "Synthetic mechanics; source attribution does not prove portability."
}
```

Dimensions are 2–64 cells per axis; coordinates are zero-based. Objects, walls,
start and goal cannot overlap. A door must reference a declared key. At most 32
keys and 32 doors are supported. The parser rejects unknown fields and never
executes candidate code. `source_components` holds the generator's evidence
references; it does not change runtime behavior or verify component compatibility.
The canonical manifest SHA-256 is the immutable `game_version`. Schema validity
does not establish solvability; the actual playthrough can fail or stop.

## Decision and LLM primitives

```sh
# Keys are process environment variables, never CLI flags or JSON content.
# LITELLM_API_KEY and LITELLM_BASE configure local d1 via tools.decisions.
python3 -m tools.playtester --game tools/playtester/examples/key-door.json \
  --policy d1 --max-decisions 8 --max-steps 20 --max-seconds 60 \
  --output local/playtests/reference-d1-001

# Native OpenAI Decisions: explicit selection, OPENAI_API_KEY required.
python3 -m tools.playtester --game tools/playtester/examples/key-door.json \
  --policy openai --max-decisions 8 --max-seconds 60 \
  --output local/playtests/reference-openai-001
```

The shared [decision client](../decisions/README.md) owns native request/response
protocols and safe request reports. The bot asks for a valid action plus optional
initial view/control classification in one request. Baseline awareness belongs
in a profile: perspective (`top_down`, `side_view`, etc.), locomotion (`grid`,
`platform`, `vehicle`, `tactical_turns`, etc.), source references and their basis.
Unknowns stay unknown. A model classification is explicitly a hypothesis;
confidence is not evidence that a mechanic exists or a command succeeded.

The controller accepts a model action only if its confidence and distribution
margin both meet the configured thresholds, and the selected option has the
highest reported probability. These thresholds are configurable starting
policies, not calibrated accuracy guarantees. A refusal, invalid response,
STOP recommendation, or insufficient confidence escalates explicitly. A network
failure never changes providers or retries behind the caller's back.

`--system2 chat` enables the slower JSON-constrained LLM primitive. Configure all
three variables explicitly: `PLAYTEST_LLM_BASE_URL`, `PLAYTEST_LLM_MODEL`, and
`PLAYTEST_LLM_API_KEY`. This is a Chat Completions compatible interface, separate
from either Decisions API. For the local `ramblerun/Multimodal-AI` proxy set
`PLAYTEST_LLM_ENABLE_THINKING=false`; this sends the same
`chat_template_kwargs.enable_thinking=false` used by sidbot. Omitting that
variable omits the provider-specific field. The default output budget is 256
tokens. `PLAYTEST_LLM_JSON_MODE=json_object` explicitly requests provider JSON
mode; leave it unset for endpoints that do not support `response_format`.
The LLM receives evidence, recent transitions, the objective and the same
available actions; it cannot create button commands, run code, write RAM or
access tools. A valid JSON `action_id` or STOP is required. A single JSON code
fence is accepted; arbitrary surrounding prose is rejected. A long reason is
truncated to 240 characters after parsing, rather than discarding a valid action.
Failed/invalid LLM
output stops the bot; no silently chosen fallback action.

## Adapter seam and ROM sessions

Vishal's demo already plays real ROMs through a browser GBA adapter with
load/input/resume/pause/checkpoint/dispose operations. This package consumes
isolated experiments; it does not take over that player session or prescribe
the environment's navigation policy. The [parallel contract](../../contracts/PARALLEL_DEVELOPMENT.md)
remains authoritative. The following JSONL v1 is a small local experimental
integration seam, not a replacement for the joint environment contract.

`GridAdapter` and `SubprocessAdapter` expose `hello()`, `observe()`,
`act(action, max_frames=...)`, `close()`. `hello` must declare `isolated: true`,
`schema_version: 1`, a game ID, immutable game version, adapter version and the
`observe`/`act` capabilities. Optional capabilities are not assumed. Profiles
can pin the exact game version and mismatches fail before any action.

The [headless mGBA session worker](../re/session/README.md) provides the ROM
implementation. For example, with an appropriately prepared private state:

```sh
python3 -m tools.playtester \
  --profile tools/playtester/profiles/metroid-zero-mission.json \
  --policy d1 --system2 chat --max-steps 8 --max-decisions 8 \
  --max-escalations 1 --max-frames 192 --max-seconds 60 \
  --model-timeout 15 --output local/playtests/mzm-001 \
  --adapter-command python3 tools/re/session/bridge.py \
    --rom /absolute/path/to/rom.gba --game-id metroid-zero-mission \
    --out local/playtests/mzm-session-001 --initial-state /absolute/path/to/state.ss
```

`--adapter-command` must come last because its remaining arguments are passed
directly as an argv list, never interpreted by a shell. Both output directories
must be new. A session without decoded coordinates may offer screenshots and
button probes; it cannot claim known passability, successful walking, or an
observed game objective. A screen hash is weak novelty evidence, not game-state
equivalence. The MZM profile marks side-view/platform awareness and button
meanings as configured hypotheses. For another game, supply another profile or
an adapter that exposes truthful contextual action options. The generic profile
shows the unknown-awareness case; change its game ID to match the session.

Wire examples (one request and response per line, matching `id`):

```json
{"id":"1","op":"hello"}
{"id":"1","ok":true,"result":{"schema_version":1,"adapter_version":"example/1","session_id":"private-1","isolated":true,"game_id":"g","game_version":"sha256","capabilities":["observe","act"],"max_action_frames":120}}
{"id":"2","op":"observe"}
{"id":"2","ok":true,"result":{"frame":0,"state_key":"state-hash","image":"/absolute/frame.png","phase":"unknown","facts":{},"progress":{},"terminal":false,"success":false}}
{"id":"3","op":"act","action":{"id":"right","keys":["RIGHT"],"frames":12},"max_frames":120}
{"id":"3","ok":true,"result":{"frames":12}}
{"id":"4","op":"close"}
{"id":"4","ok":true,"result":{}}
```

Observation `options` can override the profile's static action macros. Each
option has an ID, description, frame count, optional keys and target metadata.
A structured adapter can expose walk-to-target, use-item, attack-target or
tactical-action options without a universal coordinate/physics representation.
The adapter performs game-specific navigation and reports actual elapsed
frames; the controller verifies the next observed frame count. An adapter error,
timeout or invalid receipt fails the run and disposes the private worker.

## Evidence, limits and verification

Every run gets a fresh directory with `events.jsonl` and `report.json`.
Observations, executed actions/receipts, model decision reports, LLM hypotheses,
transitions and stops are retained. A transition records hashes of the before
and after observations. Source commit plus package hash capture uncommitted
implementation content, and the report pins the manifest/profile and adapter.
Failed and cancelled runs are retained after initialization succeeds. The tool
never loads `.env` files automatically or records provider keys/response bodies.

After three repeated no-change attempts by default, an action becomes a
**barrier candidate**, not a verified wall or prerequisite. Structured progress
is used when available, so animated pixels cannot masquerade as progress.
Without it, state-key-only evidence is explicitly weaker. Other actions are
tried; when every available action is stationary the bot escalates. A game
objective is complete only when the adapter reports terminal success.

Target macros may declare `continue_until_target: true`. The bot then reuses the
selected target while structured progress advances, the same phase and action
remain available, and `requires_decision` is absent/false. It replans when these
conditions fail. Pixel changes alone never authorize continuation. This keeps
deterministic navigation below expensive planning and allows an adapter to
interrupt for combat, dialogue or another reaction. The active target and each
selection/replan are retained; unavailable target options do not prove arrival.

Budgets independently bound steps, total emulated frames, per-action frames,
decision calls, LLM escalations, model socket timeout and wall time. A full wall
deadline is checked between operations, not an operating-system hard kill;
individual adapter/model timeouts bound blocking operations, and any deadline
overshoot is reported. Timing stages are nested in total experiment time;
provider queue/execution timing and billing are unavailable unless separately
reported. These are resource limits, not a performance SLA.

The narrow offline suite adds no dependencies or CI and is expected to run in
under one second. It checks meaningful behavior: an actual key/door/goal
playthrough, invalid/unreachable games, session isolation and version checks,
resource bounds, stationary evidence under animation, constrained model
escalation, protocol errors/timeouts and worker cleanup:

```sh
python3 -m unittest tools.playtester.test_playtester -v
```

On this workspace's Python 3.9.6, the 27-test run passed in 0.211 s. After a
final diagnostic-only correction and one additional regression fixture, the
9 affected model checks passed in 0.001 s; unchanged adapter checks were not repeated.
The reference example completed in 9 actions, 0 model calls and 0.003052 s of
experiment wall time (`local/re/experiments/playtester-reference/initial`).
These are tiny reference-fixture measurements, not ROM exploration performance.
There was no comparable generic controller before this implementation, so a
before/after latency baseline is unavailable. ROM exploration accuracy and
cross-game skill transfer require separately bounded, retained qualification.

A controlled reference comparison retained in
`local/re/experiments/playtester-reference/continuation-comparison/summary.json`
uses the same 9-action playthrough and a deterministic simulated selector:
replanning each hop required 9 selections; continuing known targets required
4. Three runs per mode had median experiment times of 0.003689 s and 0.003121 s,
respectively. This measures controller work and decision junctions with **zero
network/model calls**; real provider latency/cost savings remain unmeasured.

LLM failures retain safe diagnostic codes, HTTP status when available, numeric
usage even after a failed choice parse, an allowlisted `finish_reason`, text
length/fingerprint and JSON parse position. They never retain the provider body
or exception message. `finish_reason: length` distinguishes a truncated answer
from a syntactically complete unsupported action, without requiring raw output.

The bounded native-ROM integration pilot retained at
`local/re/experiments/playtester-session/live-json-mode-ref.json` exercised
2 actions/24 real mGBA frames, 3 d1 decisions and 2 LLM escalations in
2.062031 s before the configured escalation budget stopped it. Local d1's
uncertain choices escalated visibly, and the LLM returned valid structured
actions with thinking disabled and JSON mode enabled. This verifies integration
and honest stopping, not autonomous platform control or a completed ROM objective.
