# Generation, native QA and model operations

The human player and creation loop share versioned artifacts, not one running session. Vishal owns neighborhood/Play navigation and the browser adapter. The creation loop builds candidates and runs isolated native experiments. Start with [the parallel contract](contracts/PARALLEL_DEVELOPMENT.md).

## Run the application

```sh
npm ci --ignore-scripts
npm run dev
```

The local server binds `127.0.0.1:4173` unless `PORT` is exported. `/` and `/v1` open Alder District and its FireRed arcade. `/v0?view=workshop` opens the component builder; `/v0?view=play` is the normal game collection. Restart the server after changing server modules. A static `npm run build` output contains the shell and public research snapshot, with no compiler server, credentials or ROMs.

Vishal's latest integrated main is `b58ae3e`: live/background voice feedback plus arcade-route and geometry changes. Its pinned `ws` dependency supports the existing server-side voice relay. The research map, Mashup, collection, research refresh and cartridge/core/profile save identity remain separate from neighborhood policy. Lean source and the pinned generated geometry kernel are retained under `verification/`; `npm run verify:geometry` is an explicitly invoked developer check requiring its documented Lean toolchain, not a prerequisite for every local launch.

The Node server loads ignored `.env.local`, then `.env`. Python research/model commands generally require variables exported into their calling process; `tools.gba_playtest.run` also supports its explicit `--env-file`. Never put keys in request JSON, browser storage, package metadata or Git. Copy `.env.example` to an ignored local file and fill only the workflows you intend to use. The template contains placeholders only.

## Assemble an executable mix

The Workshop reads real `generate.py --options` and `ontology/executable-components` records. Selectors refer to concrete executable packages; their panels expose typed state ports, units, dependencies, provenance and local availability. A source world must contribute a selected executable package. An unsupported game or an unqualified adapter blocks submission instead of producing a nominal mashup.

Currently qualified selectors include Sonic/Zero Mission, Aria/Zero Mission or Mario World/Sonic/Zero Mission movement, Zero Mission impact damage, and either Zero Mission acquisition or Minish persistent inventory/skill derivation. The compiler owns the authoritative, evolving option list:

```sh
python3 tools/behavior_ir/generate.py --options
```

Changing progression to Minish changes the actual L2: packed persistent inventory mutation and skill derivation replace the equipment acquisition component. The compiler supplies bindings and explicit unit conversions. Optional story/style notes are retained as context; there is no implemented natural-language-to-game planner and those notes are not secretly converted into C changes.

Click **Build & qualify GBA**. The application persists a `gameverse.ir.ui-submission/0.1` envelope containing a `gameverse.ir.generation-request/0.1`, exact package/behavior hashes and parent context. It runs the real compiler and native route qualifier. Status labels are read from worker receipts; there is no simulated progress bar. Failures, diagnostics and intermediate artifacts remain available.

The current clean-ROM world, jump/input policy, projectile/gate orchestration and presentation are authored IR around recovered executable mechanics. This is a bounded connected game slice, not an automatically recovered full campaign. The native route proves its declared movement, combat, acquisition, gate and exit behavior. It does not qualify every mechanic from its source games.

Successful native QA enables **Add to Play**. That separate action verifies the cartridge hash, copies the immutable ROM into ignored local storage and selects it for the configured `ir-workshop` entry in the v0 collection. The existing GBA adapter plays it. A new cartridge hash has separate browser progress; earlier artifacts and progress are retained. Browsing all older accepted IR versions in the UI is not implemented yet. The v1 arcade remains FireRed-bound.

### CLI and on-disk artifacts

```sh
python3 tools/behavior_ir/generate.py \
  --request research/automatic-ir/minish-skills.request.json \
  --out local/ir-runs/my-fresh-request
```

Use a fresh output directory. Direct CLI generation does not itself register an accepted Play version. The request schema is `tools/behavior_ir/generation-request.schema.json`. The underlying advanced entry points are `compose.py <composition.json> <fresh-build-dir>` and `qualify_composition.py <build-dir> <fresh-native-dir>`.

Application runs live under ignored `local-data/ir-runs/<request-uuid>/`:

| Artifact | Purpose |
| --- | --- |
| `submission.json` | Exact UI choices, source context and server-resolved package identities |
| `request.json` | Versioned compiler request |
| `job.json` | Actual worker lifecycle, bounded deadline, outcome and timing |
| `output/resolved.composition.json` | Concrete L2 graph, state bindings and authored/recovered boundaries |
| `output/status.json` | Compiler phase/outcome, immutable request/ROM identity and artifact references |
| `output/build/build-receipt.json` | Packages, conversions, stages and clean build result |
| `output/native/route-receipt.json` | Native expectations, observed state, screenshots, video and failures |

The local HTTP seams are `GET /api/ir/catalog`, `POST /api/ir/runs`, `GET /api/ir/runs/<uuid>`, artifact downloads under that run and `POST /api/ir/runs/<uuid>/activate`. Mutations require the same local browser origin; request bodies are capped at 32 KiB. Only one application build runs at a time. `IR_BUILD_TIMEOUT_MS` defaults to 60,000 and accepts 1,000–300,000. Server restart leaves unfinished runs visibly interrupted; it does not invent a resumed worker. Package originals under ignored `local/ir/packages` must exist and match the executable catalog; a fresh clone needs those extracted/lifted packages before generation can succeed.

The application integration receipt is [research/ir-workshop/integration-qualification.json](research/ir-workshop/integration-qualification.json). Its real three-game output passed 3 enemy defeats → persistent learning → derived skill 1 → gate → exit. Compiler wall time was 0.591 s; complete application submission/qualification/registration/catalog verification was 0.861 s. The compiler is nested in the application total. These are one representative local integration run, not a comparable before/after benchmark; the earlier application path did not exist. No browser gameplay or paid model call was part of that check.

## Native ROM sessions and save states

```sh
make -C tools/re/session
python3 tools/re/session/bridge.py \
  --rom /absolute/path/game.gba --game-id my-game \
  --initial-state /absolute/path/private-state.ss \
  --out local/bot-sessions/fresh-session
```

The existing Homebrew libmgba, ARM toolchain and ffmpeg are used; there is no added emulator service. The persistent worker offers bounded legal GBA inputs, actual 240×160 observations, session checkpoints/restore, read-only RAM and recording. It opens no accepted human save. Native and browser-WASM state formats are not assumed interchangeable. A supplied state must be a valid mGBA state for that ROM; historical zero-filled capture `state.ss` files are not usable checkpoints. Native restore advances one frame to reconstruct pixels and records the checkpoint hash. Frame zero/provenance beyond that require an external run record.

Read-only semantic profiles must pin the exact ROM SHA-256. A profile can decode HP, position, actor state and objective flags only where those fields were actually recovered. Unknown coordinates, objectives and collision remain unknown. The general worker has no arbitrary RAM-write or code-execution tool. Research-only fixed event fixtures, such as original-API XP delivery, are separately marked and are not bot capabilities.

For a concrete semantic scenario:

```sh
python3 -m tools.gba_playtest.scenario \
  --scenario /absolute/path/scenario.json \
  --rom /absolute/path/game.gba --rom-sha256 EXACT_ROM_SHA256 \
  --memory-profile /absolute/path/pinned-profile.json \
  --initial-state /absolute/path/private-state.ss \
  --out local/gba-playtests/fresh-scenario
```

Scenarios declare a feature, finite frame/wall limits, inputs, marks, semantic expectations and captures. Suites require every declared feature to have an executing passing case. Successful process exit or a visible screen alone is not a gameplay pass. Failed/cancelled runs and unsuccessful routes are retained. The connected IR qualifier uses these same native-session primitives, with its own exact route evidence.

Recording samples actual emulator frames, normally every second frame at 29.86375 fps to preserve game speed. MP4s contain no interpolated frames or audio. Encoding time is nested inside run totals and temporary raw frames are removed only after successful encoding. The UI serves actual PNG/MP4 artifacts from the run directory. See [native session details](tools/re/session/README.md), [source-aware ROM episodes](tools/gba_playtest/README.md), and [general controller](tools/playtester/README.md).

## Bots: cheap actions and slower escalation

Baseline awareness belongs to a versioned game profile: perspective, locomotion, supported controls and the basis for those claims. The Sidbot-inspired controller chooses among finite adapter-supported targets/actions, executes short inputs, then observes actual progress. Structured navigation runs below decisions when a profile supports it. Stalls and suspected barriers are hypotheses until witnessed.

The general playtester defaults to its offline reference policy; native `gba_playtest.run` defaults to `--decision-provider none`. Model use is explicit. Local d1 remains the default decision-model provider when selected. OpenAI Decisions is a separate explicit selection; failure never silently changes provider or incurs hidden retries.

```sh
# Offline request validation: no credential, network or model charge.
python3 -m tools.decisions --request tools/decisions/examples/text.json --check-request

# Each selected command makes one native Decisions request.
python3 -m tools.decisions --provider d1 \
  --request tools/decisions/examples/gameplay.json --image /absolute/frame.png
python3 -m tools.decisions --provider openai \
  --request tools/decisions/examples/gameplay.json --image /absolute/frame.png
```

The general bot enables System 2 with `--system2 chat`, plus explicit `PLAYTEST_LLM_BASE_URL`, `PLAYTEST_LLM_MODEL`, `PLAYTEST_LLM_API_KEY` and a finite escalation budget. The native episode runner uses `--max-llm-calls` (default zero) and `--max-decision-calls`; keep total action/frame/wall budgets too. Both primitives choose among the same finite legal actions. A model cannot invent native state, send arbitrary shell commands or modify RAM. Confidence thresholds and fallback policies belong to the caller and are recorded; a decision is model judgment, not mechanical proof.

## Credentials and provider protocols

| Workflow | Required credential/config | Behavior |
| --- | --- | --- |
| Deterministic IR generation/native QA | No model key | Requires matching local executable packages and native toolchain |
| Human ROM Play | No model key | Source-built/accepted artifact and browser runtime |
| Local d1 Decisions | `LITELLM_API_KEY`; optional `LITELLM_BASE` | Default base `http://rrh-llm-1:4000`; native proxy `/v1/decisions` |
| OpenAI Decisions | `OPENAI_API_KEY`; optional `OPENAI_DECISIONS_BASE_URL` | HTTPS; explicit provider; adapter selects `gpt-6-luna` |
| Optional slow bot LLM | All three `PLAYTEST_LLM_BASE_URL`, `PLAYTEST_LLM_MODEL`, `PLAYTEST_LLM_API_KEY` | Chat Completions-compatible endpoint; independent of Decisions |
| Embedding research | `LITELLM_API_KEY`; optional `LITELLM_BASE` | `/v1/embeddings`, repository alias `ramblerun/TextEmbedding-AI` |
| Optional voice feedback | Server `OPENAI_API_KEY` | Server-side transcription/relay; key never sent to browser |
| Legacy model-assisted generation tooling | `LITELLM_GENERATION_MODEL` or explicit `OPENAI_GENERATION_MODEL` plus provider key | Separate tooling, not used by the deterministic IR Workshop |

The shared Decisions client translates a portable version-1 request into two distinct native protocols. d1 uses `state`, `questions`, `images`; predicate becomes `noul`, choice is a named criteria map, and scores use an ordered criteria list. This LiteLLM front end routes the model itself, so the d1 request deliberately has **no `model` field**. The recorded alias is `ramblerun/Decision-AI`.

OpenAI uses `POST /v1/decisions` with `model`, shared `input` and named `questions`, returning `answers`. Its current official guide specifies `gpt-6-luna` and predicate/choice/score types; this adapter validates those protocols and requires explicit selection. See [official OpenAI Decisions documentation](https://developers.openai.com/api/docs/guides/decisions) and the repository's [shared provider contract](tools/decisions/README.md). Available quota is an API-project property; a present key is not evidence of funded access.

For the local slow model alias `ramblerun/Multimodal-AI`, `PLAYTEST_LLM_ENABLE_THINKING=false` sends `chat_template_kwargs.enable_thinking=false`. Set `PLAYTEST_LLM_JSON_MODE=json_object` only when the endpoint supports JSON response format. Both settings are proxy-specific and separate from Decisions.

The existing bounded `tools/re/probe_models.py --frame /absolute/frame.png --timeout 45` probes model discovery, Decisions and embeddings with recorded failures/timings. It makes service calls; invoke deliberately. Alias discovery uses `/v1/models`; an embedding-capable alias does not establish its native model revision. Do not substitute a generic provider's request format for this front end without probing it.

## Embeddings and retrieval

`tools/ontology/game_space.py` stores normalized vectors in ignored `local/embeddings/cache.npz` and derived JSON, keyed by exact input content. The current corpus uses that local cache; a vector database is not required. The public UI map contains derived coordinates/neighbors, not private raw vectors or ROMs. Per-view distances in the original embedding space determine neighbors; 2D projection and model-recalled text do not establish executable compatibility.

The repository's embedding proxy expects media objects `{"image": "data:..."}` and `{"audio": "data:..."}`. OpenAI-style `image_url`/`input_audio` content parts previously returned HTTP 200 while being ignored; distinct identical vectors are rejected by the existing implementation. Text clustering uses the prefix `task: clustering | query: `. These are observed local integration requirements, not claims about every Gemma deployment.

`uv run tools/ontology/game_space.py embed` is an explicitly invoked embedding campaign with cached inputs; `analyze` derives the map. It is not run by the web refresh loop, IR generation or routine CI. Source-only publication uses `python3 scripts/export-research.py . --source-only` and retains embedding coordinates. Executable lookup separately uses qualified component IDs, package hashes, typed ports and dependency closure. A nearby embedding neighbor or a granular source keyword is not an executable component adapter.

## Qualification and timing policy

Keep original-ROM evidence, automatically lifted behavior, semantic annotations, authored IR and host services distinct. C recovered by manual analysis is an oracle/reference in the new automatic pipeline, not secretly its generator input. Existing native-host composition recipes and the new clean-ROM L1/L2 compiler are distinct paths; their receipts should say which was used.

Run affected contract/build checks first. Broad ROM matrices, expensive model evaluation and long campaigns stay explicitly triggered with scope and finite limits. No new CI job or automatic paid model run accompanies this UI. Reports should pin request/source/ROM/package/profile/adapter identity, outcomes and failed attempts. Record clean/incremental mode, queue availability, separate build/simulation/evaluation/encoding costs where measurable and nested stages without double counting. Missing measurements are null/unavailable, not zero. The [development instructions](AGENTS.md) govern this requirement.
