# Shared decision providers

Both the game environment harness (Vishal) and ontology/improvement harness
(Shishir) can call this package. It has no dependencies outside Python 3.10+'s
standard library and no imports from capture or ontology tools. It does not
choose either harness's routing rules or thresholds.

`d1` is the default. Cloud calls require the explicit `openai` provider. Failed
calls never switch providers or retry. The providers use their native Decisions
endpoints, with different payload and response formats; OpenAI calls do not use
Chat Completions or Responses.

## Configuration and credentials

Inject credentials through the process environment or a secret store. The
package does **not** load `.env.local` automatically, accept keys in JSON or CLI
flags, or persist them. A LiteLLM key is separate from an OpenAI key.

| Provider | Credential | Base URL | Model |
| --- | --- | --- | --- |
| `d1` (default) | `LITELLM_API_KEY` | `LITELLM_BASE`, default `http://rrh-llm-1:4000` | Recorded alias `ramblerun/Decision-AI`; existing proxy selects its route, so no model field is sent |
| `openai` | `OPENAI_API_KEY` | `OPENAI_DECISIONS_BASE_URL`, default `https://api.openai.com` | `gpt-6-luna` |

Base URLs may end with `/v1`; the client appends `/decisions` exactly once.
An explicit `--base` overrides only the selected provider's base. OpenAI bases
must use HTTPS. Redirects are refused so credentials are not forwarded.

The configured socket timeout is 75 seconds by default, adjustable with
`--timeout` to a positive value no greater than 300 seconds. This is a socket
timeout, not a full campaign deadline. Each invocation makes at most **one**
request. The caller owns concurrency, total time/budget limits, and explicit
retry policies. `--model` changes the d1 *recorded alias* only; changing the
proxy's actual d1 routing requires proxy configuration. OpenAI currently accepts
only `gpt-6-luna` in this adapter.

## CLI: ready for either harness

Run from the repository root, with the selected credential already in the
environment:

```sh
# Offline: validate a versioned portable request. No key or network needed.
python3 -m tools.decisions --request tools/decisions/examples/text.json --check-request

# Local d1, one request asking three independent questions.
python3 -m tools.decisions --provider d1 --request tools/decisions/examples/text.json --records local/re/decisions.jsonl

# Native OpenAI Decisions; requires OPENAI_API_KEY and funded API access.
python3 -m tools.decisions --provider openai --request tools/decisions/examples/text.json --records local/re/decisions-openai.jsonl

# Append a local image without embedding base64 in a request file.
python3 -m tools.decisions --provider d1 --request tools/decisions/examples/gameplay.json --image /absolute/path/frame.png
```

`--request -` reads JSON from stdin. `--image` can repeat. The process prints one
JSON report to stdout. `--records` appends that same report as JSONL, including
failed and cancelled calls. Exit codes: 0 for success/offline validation, 1 for
failure or any refusal, 130 for cancellation. A refusal is preserved as an
answer with `type: "refusal"`; it never becomes a zero probability.

For bounded capture scoring, the existing command now uses the shared client:

```sh
python3 tools/re/gameplay_gate.py --provider d1 --ids metroid-zero-mission,pokemon-emerald-version --jobs 4 --max-frames 20 --timeout 45
python3 tools/re/gameplay_gate.py --provider openai --ids metroid-zero-mission --jobs 1 --max-frames 2 --timeout 45
```

Unbounded default d1 output remains `local/captures/<id>/gameplay_d1.jsonl`, with the same
`phase`, `frame`, `p_gameplay` fields. OpenAI writes `gameplay_openai.jsonl`.
When `--max-frames` is set, rows go to `gameplay_<provider>.sample-<run-id>.jsonl` so a pilot cannot erase full prior labels. Only a worker-sized request window is scheduled; cancellation prevents queued calls while already running requests may finish within their timeout.
Per-frame normalized reports append to `gameplay_<provider>_requests.jsonl`;
the existing aggregate `local/captures/gameplay_runs.jsonl` gains provider and
outcome metadata. The old d1 helper signature `score(path, key)` is retained.
Requests now make one attempt instead of three hidden retries; callers can
rerun a deliberately bounded selection after inspecting errors.

## Portable JSON contract, version 1

The [text example](examples/text.json) and [screenshot example](examples/gameplay.json)
are complete request fixtures. Required fields are `schema_version: 1` and
`questions`. Evidence is `state` (text or null) and optional `images` (base64 data
URLs); at least one must be nonempty. `--image` reads local PNG/JPEG/WebP/GIF
files by signature. The portable contract does not fetch image URLs, accept
file IDs, or accept audio. Images are capped at 8 MiB each and the whole JSON
request at 16 MiB, with at most 128 images and 200 questions.

Every question requires a unique nonempty `name`, `instructions`, and one of:

| Type | Additional fields | Normalized answer |
| --- | --- | --- |
| `predicate` | Optional `true_description`, `false_description` | `probability` in [0,1] |
| `choice` | 2–255 `choices`, each with a unique typed string/bool `value` and optional `description` | Typed `choice`, `confidence`, and `probabilities: [{value, probability}]` |
| `score` | 2–10 ordered `levels`, each with unique string `label` and optional `description` | Zero-based expected `score`, `confidence`, and `probabilities: [{value: index, label, probability}]` |

For d1, predicate maps to `noul`; choice options map to its named criteria map;
score levels map to its ordered criteria list. If a choice contains booleans,
all d1 keys become `option_0`, `option_1`, etc., then decode back to their exact
typed values. Boolean `true` and string `"true"` remain separate options.
OpenAI receives typed values directly and text/image evidence as native input
parts. Scores keep zero-based indices in both providers.

Responses reject missing/extra/reordered OpenAI names, missing/extra d1 names,
unknown types/choices, duplicated distribution entries, nonfinite or out of
range probabilities/confidence, and incompatible score indices/means. A
distribution may differ from 1 by at most 0.02 for rounding; score mean tolerance
scales with the number of levels. Confidence is kept separately from option
probability; applications must calibrate their own thresholds.

Optional `context` is caller-owned JSON: include game/ROM identity and version,
evidence hash/reference, environment/adapter version and loop configuration
reference when available. This package never infers a pinned game version from
a filename. Context does not go to the provider. Treat decisions as model
judgments over the supplied evidence, not new source/runtime verification.

## Python and JavaScript integration

```python
import json
from tools.decisions import DecisionClient, ProviderConfig, image_data_url

client = DecisionClient(ProviderConfig.from_env("d1", timeout_s=45))
request = json.load(open("tools/decisions/examples/gameplay.json"))
request["images"] = [image_data_url("/absolute/path/frame.png")]
request["context"]["evidence_ref"] = "capture-or-source-id"
report = client.decide(request, run_id="parent-run-id:classification-1")
# Persist report even when status != "success". Never treat refusal/error as false.
```

Reuse a client across frames; machine/source metadata is collected once per
instance. To opt into OpenAI, explicitly construct a separate client with
`ProviderConfig.from_env("openai")`. There is no automatic provider selection
based on which keys happen to be present.

JavaScript agents can use stdin/stdout without a new dependency or shell:

```javascript
import { spawn } from "node:child_process";
const child = spawn("python3", ["-m", "tools.decisions", "--provider", "d1", "--request", "-"], {
  cwd: "/absolute/path/to/gameverse.ai", env: process.env, stdio: ["pipe", "pipe", "inherit"]
});
let output = "";
child.stdout.on("data", bytes => { output += bytes; });
child.on("close", code => {
  const report = JSON.parse(output);
  // Inspect report.status before using report.answers, including on nonzero exits.
});
child.stdin.end(JSON.stringify(portableRequest));
```

The `tools/decisions` folder is self-contained: copying it under another
project's `tools/` preserves the same import/CLI. Alternatively put its parent
on `PYTHONPATH` and use `python3 -m decisions`. Neither integration requires a
central orchestration service or changes to the shared game contracts.

## Observability and verification

Reports include provider/configured model, optional reported model and provider
request ID, correlation ID, request SHA-256, source commit/client hash and
machine/toolchain context, attempts/retries, outcome, available token usage,
total wall time and request wall time. Request wall time is nested within total
wall time; do not add them. Queue time, provider execution time, cost and serving
revision are explicitly unavailable, not zero. Caller context supplies game,
adapter and loop versions. Raw requests, images, provider bodies and error
messages are not logged. Only allowlisted provider error codes/types are kept;
for example `insufficient_quota`/`credit_balance_exhausted` is distinguishable
from `rate_limit_exceeded`. Returned selected-key echoes are redacted.

The narrow offline fixture suite adds no CI job, SDK, network calls or provider
charges. It covers both wire protocols, typed booleans, predicate/choice/score,
refusals, validation, request/response limits, timeout/cancellation/no retry,
safe error handling, image conversion and capture output compatibility:

```sh
python3 -m unittest tools.decisions.test_client -v
```

There was no shared provider adapter before this change, so a comparable
before/after latency baseline is unavailable. Provider latency/accuracy claims
must come from retained live runs against fixed evidence, rather than these
offline fixtures. See `local/re/experiments/decision-providers/` for this
session's local reports (not committed). Both providers completed text/image
smokes after OpenAI credits were refreshed; earlier quota failures were retained.
The text quality control showed a material error: OpenAI estimated runtime
observation at 0.93 on evidence explicitly lacking a trace, while its choice
classified that same packet as source-only. Local d1 estimated 0.018. Those tiny
smokes verify transport only; do not transfer thresholds or assume equal quality
between providers without labeled evaluation.

Protocol references checked 2026-10-16:
[OpenAI guide](https://developers.openai.com/api/docs/guides/decisions),
[OpenAI API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create),
[LiquidAI model card](https://huggingface.co/LiquidAI/d1-3B),
[LiquidAI native answer implementation](https://huggingface.co/LiquidAI/d1-3B/blob/main/api.py).
