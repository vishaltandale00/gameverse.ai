# Native improvement API v1

Implemented seam for Vishal's R3 voice agent and Shishir's native worker. This additive local transport implements a bounded subset of [PARALLEL_DEVELOPMENT.md](PARALLEL_DEVELOPMENT.md); it does not close slice 3. Vishal owns base/subgame hosting, navigation, saves, acceptance and activation. The worker only returns isolated candidate artifacts and evidence.

Run `node scripts/serve-improvement.mjs` (Node >=22, Python 3) for the API alone on localhost:4175. The minimal handoff does not require the frontend. No new dependency or model credential is needed. `PORT` and `IMPROVEMENT_TIMEOUT_MS` (1,000–300,000; default 90,000) configure transport/outer worker bounds. Recipe-specific bounds remain in their registered loop requests. Only one job runs; busy requests receive 409 rather than entering an unbounded queue. Native builds need ARM-capable Clang as `cc` plus GNU ARM binutils (`arm-none-eabi-ld`, `arm-none-eabi-objcopy`, `arm-none-eabi-nm`) on PATH. Double-XP native qualification additionally needs the existing mGBA session bridge/toolchain; its standard setup is in `tools/re/session/README.md`.

Input ROMs are user-supplied local files and never distributed. Registered request JSON uses repository-relative paths under `local/roms/`; capability discovery reports missing or stale input paths. Provision the exact named local ROM inside the checkout; digest validation remains mandatory. A matching descriptor inventory alone does not establish an executable backend. Backend admission independently checks source/plan/package/qualification pins. When `contracts/improvement-provider-pack.json` is installed, capability admission verifies the reviewed per-recipe runtime readset and its recipe digest; historical capture references are not runtime prerequisites. Historical provenance warnings remain separate. The manifest digest contributes to `loop_version`. Without that manifest, development fixtures use recursive declared pins. `installed` reports recursively declared file-pin availability, not a guarantee that its toolchain, undeclared dependencies or runtime checks pass. A fresh checkout without private inputs can serve capabilities and return a visible missing-input error.

| Method/path | Result |
| --- | --- |
| GET `/api/improvement/capabilities` | Versioned adapter, loop code revision, registered recipe requests/digests, missing pinned inputs and supported capabilities |
| POST `/api/improvement/runs` | 202 after durable request receipt and native worker dispatch; retry identical ID/input to recover same job |
| GET `/api/improvement/runs/{uuid}` | Durable running/completed/failed/cancelled/interrupted status, input pins, backend evidence and timing |
| DELETE `/api/improvement/runs/{uuid}` | Request cancellation of current worker/process group; poll for retained terminal status |
| GET `/api/improvement/runs/{uuid}/artifacts/result` | Retained backend result JSON |
| GET `/api/improvement/runs/{uuid}/artifacts/rom` | Candidate standalone native `.gba`, digest checked on download |

Loopback Host is required, supplied Origin must match it and cross-site requests fail. Non-browser local agents may omit Origin. This uses the current app's local-origin trust model; remote authenticated hosting is not implemented. Receipts persist under ignored `local-data/improvement-runs/`. They are local durable files, not a distributed multi-server queue. A restart marks an orphan running receipt interrupted and never replays work silently. Cancellation or failure cannot activate a candidate or overwrite player progress. Same ID with different input returns 409, missing/stale inputs return 422/409, unsupported operation/recipe/target returns 422. Error bodies contain `{error:{code,message}}`.

The current native recipes are `aria-double-xp` (`mod-rom`) and `aria-soulstride` (`build-mod`). Double-XP repeats the explicitly bounded 14,720-vector comparison and original/parity/modified 6,400-frame corridor; it is suitable for a deliberate qualification request, not automatic transcription or routine CI. Soulstride builds a substantial connected bone-birth/lunge, moving-defeat MP refund and soul progression candidate, but this endpoint does not run model gameplay or establish objective completion. Both preserve the original cartridge outside explicit native hooks; neither reconstructs the full game into IR. Reconstruction operations, arbitrary game generation, arbitrary natural-language edits, FireRed modification, automatic model repair, migration and host activation are unsupported. There is no fallback demo generator.

The voice agent reviews the captured transcript, freezes the game/host target, chooses a supported structured plan, and submits it. Text is retained intent/context; it is never silently treated as executable code. If text cannot map to a supported recipe, the agent must surface unsupported/needs-plan locally instead of pretending the request ran. No manual IR assembly is required for these registered recipes. Existing `/api/voice/requests` receipts can be linked with `voice_request_id`; the server checks the frozen transcript plus `context.gameId`, `role`, `gameVersion`, `artifactSha256` and rejects cancellation or retargeting. Submitting voice text alone does not enqueue an improvement.

Example agent integration (the same values fit the POST JSON schema):

```js
import { submitImprovement } from './scripts/improvement-client.mjs';
const job = await submitImprovement({
  server: 'http://127.0.0.1:4175',
  recipeId: 'aria-soulstride',
  intent: reviewedTranscript,
  requestId: durableRequestUuid, // retain this AND job.request for network retries
  target: {
    role: 'subgame', game_id: 'castlevania-aria-of-sorrow',
    game_version: capturedGameVersion, artifact_sha256: capturedArtifactSha256,
    base_game_version: capturedBaseVersion, base_artifact_sha256: capturedBaseSha256,
  },
  environment: { version: environmentHarnessVersion, config_sha256: environmentConfigSha256 },
  // voiceRequestId: previouslySavedVoiceReceiptId,
});
const run = await job.status(); // poll while running; download run.artifacts.rom only when present
```

The client fetches capabilities and sends `schema: gameverse.improvement-request/1`, operation `native-mod`, exact `loop_version` and `plan: {recipe_id, request_sha256}`. Captured baseline ROM hash must match the selected recipe. Game/host/environment version pins are supplied by the environment and recorded as caller assertions; this API cannot check Vishal's accepted baseline remotely. `loop_version` fingerprints the adapter and its listed native dispatch implementation files; it is not a complete toolchain lock. Exact recipe refs, native source/package/build locks, toolchain/platform/source commit and timing are retained by the existing backend result. Host activation must recheck its own expected baseline and compatibility; `completed` means the registered backend produced its scoped result and a digest-verified candidate, not accepted/activated or fully qualified game.

Run quality has independent `scope`, `coverage`, `witnesses`, `gaps`, `save_compatibility` and `reconstruction_qc`. A missing independent `gameverse.reconstruction-qc/1` receipt is reported unavailable. `whole_game_equivalent` remains null. Native-build/ABI preservation, bounded observed behavior and full-game equivalence are different claims. Stages come from existing runner reports: build, simulation and evaluation remain separate and nested within backend/worker totals. Queue and unsupported stages are null, never invented zero. Failed/cancelled attempts retain receipts; diagnostics from a killed subprocess may be partial.

Validation evidence: [native API smoke](../research/requests/improvement-api-20261016/smoke.json) and [HTTP route smoke](../research/requests/improvement-api-20261016/http-smoke.json) records actual Soulstride native build and Double-XP native qualification. Focused tests: `node --test tests/improvement-api.test.js`; no CI job, new dependency or qualification campaign is added. There was no prior API transport baseline; measured native backend vs wrapper times from the same dispatch are nested overhead observations, not a controlled before/after speedup claim.

For an isolated checkout, follow [the provider bootstrap and validation guide](IMPROVEMENT_HANDOFF.md). Provider input availability and successful native toolchain execution are separate checks.
