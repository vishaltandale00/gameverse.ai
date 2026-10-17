# Local conversational game creation

Run `npm run local`, then open the printed `/v1` URL and choose **Create a game** in the neighborhood shell. This command resolves the local runtime, checks prerequisites without inference requests, checks the supported local Codex account interface, and starts the server. Sign in through **Connect local Codex with ChatGPT** if needed. Existing supported ChatGPT Codex sessions work through the CLI; the application never reads credential files or receives tokens in the browser.

The V1 neighborhood shell owns creation: its visible **Create a game** control and world menu open the same local studio without leaving `/v1`. Opening creation suspends the neighborhood; returning closes the player and opens the world menu before exploration resumes. Existing request history and immutable native receipts are reused. Legacy `/create?play=…` links redirect into `/v1?create=1&play=…`.

`npm run local` checks `/api/local/instance` before startup. An occupied port must identify this checkout and advertise creation capability; a different or older server is reported explicitly. An HTTP 200 from the old shell does not establish that the creation API is running. The instance response includes a hashed checkout identity and source commit, with no credential or private runtime path.

This MVP is a local application with an installed research runtime. The public checkout alone cannot compile these native mashups on another machine. The importer brings both unpublished compiler/bot code and privately supplied ROM/assets into ignored `local-data/`; it does not download them or claim the public source contains them.

## First setup in a new checkout

1. Use Node.js 22+ and run `npm ci` with the committed lockfile.
2. Supply Python 3.10+, Git, Clang `cc` with ARM Thumb support, `arm-none-eabi-ld`, `arm-none-eabi-objcopy`, `arm-none-eabi-nm`, and `ffmpeg` on `PATH`. `GAMEVERSE_PYTHON` can select Python explicitly.
3. Install the native mGBA library compatible with this machine. The reviewed macOS ARM bridge links `/opt/homebrew/lib/libmgba.0.10.dylib`. A copied executable does not install this dependency. If necessary, rebuild the bridge in the authorized source checkout with `make -C tools/re/session` before importing it.
4. Import the exact reviewed runtime from an authorized local checkout:

   ```sh
   node scripts/import-mashup-runtime.mjs --source /absolute/authorized-checkout
   ```

5. Configure the existing native bot service through `SID_LLM_KEY` and, where needed, `SID_LLM_URL`; alternatively set `GAMEVERSE_SID_ENV_FILE` to an authorized local environment file. Never commit credentials. For repeated use, an ignored `.env.local` can hold only `GAMEVERSE_SID_ENV_FILE=/absolute/authorized/service/.env`; raw keys need not be copied. Startup reads only that explicitly selected file and checks required name/value presence without showing values or calling the service.
6. Run `npm run local` and open the printed URL. Missing prerequisites produce actionable startup messages. Native runtime inputs and bot credential configuration also appear in capability readiness; machine toolchain failures can still occur during an actual build. Readiness does not prove bot endpoint reachability or successful model access; actual bounded runs establish those results.

The importer refuses an existing destination and validates candidate25 source/package identities before publishing the install directory. To replace an installation, first move the existing ignored `local-data/mashup-runtime` aside. It rejects the wrong runtime source digest instead of assuming a matching branch or Git commit identifies uncommitted research code. No dependencies or native libraries are installed automatically.

## Runtime resolution

`npm run local` selects the first applicable runtime and exports it to the server:

1. Explicit `GAMEVERSE_MASHUP_RUNTIME_ROOT` (including an invalid path, so its errors remain visible).
2. Installed `local-data/mashup-runtime` in this checkout.
3. This checkout when it contains the reviewed candidate25 capture.
4. The Git common directory's primary checkout when that checkout contains the capture.

`npm run dev` starts the server directly; set `GAMEVERSE_MASHUP_RUNTIME_ROOT` yourself when using that command. Runtime resolution does not silently fetch missing code or assets.

## Source routing and Pokémon source prerequisites

Creation resolves the requested game identities before capturing a workspace or starting an agent turn. `Build Pokemon Leaf Green but with Pokemon Emerald overworld sprites` selects the LeafGreen/Emerald backend. It never enters the Sonic/Metroid prefab compiler. Conflicting selected games, unresolved source identities and source pairs without an installed backend return a retained blocked receipt.

The receipt keeps the submitted `source_games` unchanged and records the resolved compiler and source identities in `routing`. Decomposition availability does not establish support for every transformation. `/api/mashup/capabilities` reports each backend's prerequisites, supported operations and remaining qualification gaps separately.

`GAMEVERSE_POKEMON_RUNTIME_ROOT` selects an existing authorized research checkout containing `local/decomps/pokefirered`, `local/decomps/pokeemerald`, the local ARM toolchain and the pinned LeafGreen Rev1 cartridge. The local development fallback is `/Users/shishirtandale/Projects/gameverse.ai`; set the variable explicitly on another machine. This backend retains LeafGreen USA/Europe Rev1 (`BPGE`, SHA-1 `7862c67bdecbe21d1d69ce082ce34327e1c6ed5e`) as the base. Emerald overworld object graphics, animation frames and palette dependencies require their own coverage and native verification; battle sprites and tilesets are separate transformations. The current transfer covers 38 mapped graphics consumers across 39 dependency families, including the player and common NPCs. It retains 115 unmatched LeafGreen identities and records animation aliases and palette adaptation in the coverage manifest; NPC shape/transparency are transferred using existing LeafGreen shared palette colors. This is a partial conversion, not a claim that every overworld sprite or exact Emerald NPC color was imported. Native graphics fixtures verify the mapped consumers; natural gameplay and model playtesting remain unqualified. Missing inputs or unqualified transfers remain blocked. No ROMs or donor graphics are distributed with the application.

## Subscription creation and native bot service

ChatGPT subscription usage powers the local Codex construction agent. The bridge checks `account/read` and refuses API-key and other provider authentication. It strips API-key environment overrides and uses the supported Codex stdio transport. `CODEX_BIN` selects an executable explicitly; on macOS it can use the CLI bundled with the installed ChatGPT application. Otherwise, install a working Codex CLI on `PATH`.

The Sonic/Metroid backend combines retained Sonic campaign/momentum with recovered MZM motion arithmetic, combat/projectile/impact logic and Ripper/assets. Acquisition and event progression in candidate25 are authored bridges; they are not automatically emitted MZM IR. New authored campaign placements and other glue remain separate from recovered behavior.

The S1/S2 native playtesting bot uses the existing separately authorized SID/rrh service. Its calls are not included in the application's ChatGPT subscription connection. Missing bot credentials block model gameplay verification. A native-boot-only candidate can still remain playable with model verification explicitly unqualified; there is no automatic paid OpenAI API fallback. Readiness sends neither construction inference nor bot inference requests.

The managed Codex authentication route is for local/open-source applications. Hosted/commercial integrations require the appropriate Sign in with ChatGPT offering. See [official app-server authentication](https://learn.chatgpt.com/docs/app-server#auth-endpoints) and [Sign in with ChatGPT scope and eligibility](https://developers.openai.com/siwc/quickstart). The subscription plan-usage preview excludes transcription/audio input; [official limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) apply. Browser dictation depends on the browser/OS speech service and its microphone permissions; text entry remains available.

## Limits, retries and retained evidence

Construction turns default to 900,000 ms via `MASHUP_AGENT_TIMEOUT_MS` (maximum 1,800,000 ms); the overall creation request has its own `MASHUP_TIMEOUT_MS` limit (default 1,800,000 ms). The server rejects concurrent creation runs. Native bot calls, frames, wall time and repairs retain separate bounded policies. Cancellation interrupts the active agent turn and waits for completion or stops its transport before another turn can begin.

Operators can set finite per-chunk resource policies in the environment or ignored `.env.local`:

| Setting | Development smoke default | Meaning |
| --- | ---: | --- |
| `MASHUP_MODEL_CALLS` | 24 | Maximum model calls |
| `MASHUP_NATIVE_FRAMES` | 960 | Maximum native frames |
| `MASHUP_BOT_SECONDS` | 60 | Bot wall-time limit in seconds |
| `MASHUP_REPAIRS` | 1 | Maximum automatic repair attempts; zero disables repairs |

Use positive integers for calls, frames and seconds, and a nonnegative integer for repairs. These defaults provide partial development checks; they are not campaign-completion budgets. Larger explicit limits remain bounded by the overall request timeout and do not imply success. The current product uses manual **Continue bot test** from the exact retained native checkpoint. It does not automatically schedule or run a long campaign.

A finished request without a playable artifact offers **Retry this request**, which submits the exact saved intent under a fresh UUID and records `retry_of`. Updating a failed request also starts fresh with retry provenance; it does not feed a failed source workspace into another compiler. Qualified playable parents retain strict artifact refinement lineage. The original failed receipt remains unchanged.

A failed construction request retains its isolated workspace and any recorded Codex thread/turn identifiers for diagnosis. Retrying construction starts a new creation request. **Continue bot test** resumes an existing verified native playtesting checkpoint after a built candidate; it does not resume an interrupted Codex construction session. Partial native results remain partial, and no full-campaign qualification is implied.

## Reviewed runtime inventory

The tested import contains **431 code/configuration/evidence/native-executable files (4,297,014 bytes)** and **5 private asset files (16,784,989 bytes)**. Private assets are two original 8 MiB ROMs and recovered MZM flyer asset C/header/receipt files. Code count includes source, JSON contracts, captured source/package snapshots, retained textual evidence, and the native bridge; it is not a measure of original game code recovered. Machine toolchain/library dependencies remain external.

The importer emits ignored `installation.json` with every installed file's SHA-256 and size, the source commit, baseline/lock identities, and the source-code closure digest. The reviewed source checkout reported commit `85e2139614e26e198b87bb92dadbd22de49da871`, with research source outside that commit; the exact closure digest is authoritative:

- Runtime code/config/evidence digest (excluding native machine build outputs): `e4fa1a913e6486b7594cafbbc4e5bf758f02f1f9e2767e903c5bc2917177bf6f`.
- Candidate25 cartridge baseline: `f1faa36558ae5d7ccacfc94292201b63c7a870803464a2f4d2699c6654bf6bf1`.
- Captured composition lock: `9ed30351d391c4c5d15a946a8ab2735c9fbbe0d146c27e945d3082e43c257403`.

Actual import plus capture validation took **0.327 s** on this macOS ARM machine, with no compilation or inference. A separate clean native build from the imported closure took **1.067 s**, no cache, and produced the exact baseline cartridge hash. These are initial measurements, not a before/after improvement comparison; queue time, other-machine performance and CI timing remain unavailable. The build verifies import closure and cartridge identity, not gameplay quality.
