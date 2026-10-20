> 2026-10-20: this document describes the developer-managed voice pilot. Ordinary API-key players use the separate [fully hosted route](HOSTED_VOICE.md) without pairing or a local manager. Browser controls/Stop and the remote voice protocol are shared; execution admission and credential custody are distinct.

# Browser game, Daytona voice agent

Issue #21, N0–N2. The player game and its existing `AgentHost`/`SimulatedUser` remain in the browser. A fixed `VoiceAgent` runs in a separate manager-created Daytona sandbox. It uses the authenticated backend broker for transcription, planning, gameplay decisions and reflection. It does not execute arbitrary model-written code.

## Enable deliberately

This implementation is opt-in and has not been deployed by this task.

1. Use the same committed source revision for the website/backend and the manually started manager. Worker files are read from that immutable Git commit; uncommitted edits never enter an admitted job. Build/deploy through the normal separately authorized process. Existing Cloudflare identity, `DEV_MANAGERS`, private `ARTIFACTS` and `AGENT_CREDENTIAL_KEY` bindings are required.
2. Configure backend `OPENAI_API_KEY` and `VOICE_AGENT_ENABLED=1`. The key stays at the backend. The existing `agentConfiguration` supplies planner/decisions/reflection models; `TRANSCRIPTION_MODEL` defaults to `gpt-4o-mini-transcribe`. A personal Codex/Claude login does not supply these services. No fallback provider is selected.
3. Start the macOS manager manually with its existing Daytona credential and `GAMEVERSE_VOICE_ENABLED=1`, for example `GAMEVERSE_VOICE_ENABLED=1 npm run manager -- --env-file /private/path/manager.env`. Pair with the ordinary developer account flow. Pairing survives restart; enabling voice is an explicit startup choice. No startup service or sleep prevention is added.
4. Sign in to that developer account, open soccer in `/v1`, and start a match. Press Voice feedback/R3, allow the microphone, speak, and send the request. Recording is bounded to 15 seconds/2 MiB. Hosted character-name dictation is outside this slice; type the name instead.
5. The manager admits a private 1 CPU/1 GiB/3 GiB voice worker only after audio submission. Merely loading voice configuration or recording does not allocate a sandbox. The worker has a 120-second task/job ceiling and a separately confirmed hard sandbox TTL of three minutes. At most four transcriptions, four plans, eighty decisions and eight reflections are admitted, under the shared 100-attempt limit. These are configurable-code safety ceilings, not measured latency guarantees.
6. Stop voice request is available during planning; Stop on the player row releases its controls immediately. Backend cancellation, output retention and sandbox deletion follow asynchronously. A hidden/closed page or a five-second expired browser lease also releases remote grants. Reconnection never redispatches an uncertain ASR/model call or a claimed voice request.

Only the current soccer session is supported by this bridge. New games/sessions, requester TTS, checkpoint updates, candidate construction, B′/B″, personal Codex and GitHub publication are later work. Existing local developer-server voice remains available on its original path.

## Boundaries

- Browser recordings go to private R2, keyed by task and digest. Actual bytes/digest are checked before transcription. Accounts cannot read another developer's voice record.
- The worker receives one HMAC capability bound to task, owner, session and deadline. It receives no Daytona management key, backend provider key, browser session cookie or personal model login.
- Source, profile, game version/artifact, session, epoch, command sequence and expiry are checked before browser tools run. Repeated delivery returns the same acknowledgment. Fresh model results still pass the existing harness freshness checks.
- Local Stop revokes first and does not await network. Late starts are stopped before a frame can use them. Control/progress locks use the existing host release path.
- The existing manager journal persists launch intent and never repeats uncertain execution. It checks the fixed source package and worker identity/bounds, retains available results, and confirms deletion before releasing admission. This structural verifier does not certify game success.
- `GAMEVERSE_VOICE_TEST_BROKER=1` permits an HTTPS port-scoped Daytona proxy only for explicit qualification; it is not the production configuration. The scripted provider and synthetic login exist only in `tests/hosting/fixtures/dev-manager-worker.js`, never the deployed entrypoint.

## Verification

No dependency or CI job was added. Reuse Node tests, existing workerd/R2 fixtures, build tooling and Chromium in Daytona. The new focused checks cover bounded recording upload/cancellation, exact browser grant/replay/late-start/Stop behavior, signed manager admission, scoped worker authentication, actual stored-audio validation, provider reservation and account/epoch/terminal fences. Paid speech recognition quality and production macOS/browser deployment remain separate evidence gates.

A private browser qualification uses an explicitly scripted provider (zero external model calls) and a separately manager-created voice sandbox. Retain the actual result before calling it passed; see the task's qualification report. Test-browser graphics cost does not size the product voice-only worker. No build, CI or voice latency SLA is inferred from this run.

### Network prerequisite and repeatable browser proof

The direct worker must reach the configured backend over HTTPS. `networkBlockAll:false` does not override an organization restriction. This task observed GitHub/npm succeeding while `gameverse.build` and its private test broker reset connections; Daytona explicitly rejected a sandbox allow-list override. An organization administrator must permit the backend destination using Daytona's supported network policy before separate-sandbox E2E can pass. This task does not change billing, tier or organization policy. See [Daytona network limits](https://www.daytona.io/docs/en/network-limits/).

For a provider-free functional proof, run inside Daytona, from the repo:

```sh
GAMEVERSE_VOICE_EVIDENCE_DIR=/home/daytona/voice-process-evidence node --expose-gc tests/dev-manager/manual/browser-voice.mjs
```

This separately triggered test uses installed Chromium/OpenSSL, synthetic sign-in/provider answers, actual recorded bytes and SQLite/R2, a signed synthetic manager and the actual VoiceAgent in a sibling Node process. It uses the real soccer engine and ordinary voice/Stop controls, then real keyboard movement after handback. It deliberately avoids another cloud allocation and the unrelated neighborhood renderer. It cannot qualify cross-sandbox networking or recognition of real human speech. It takes tens of seconds, writes evidence to the chosen directory, and is excluded from routine CI. Keep the directory private; share only reports/screenshots and fixed source/result artifacts, excluding device keys, launch capabilities, cookie state and TLS private keys.

The browser renderer is heavier than the voice worker. On the 1 GiB coding sandbox, rendered engine frames stalled while focus remained valid, and the existing game-health watchdog paused the game before takeover. Preserve these failures. `GAMEVERSE_VOICE_CHROME_DIR` can explicitly reuse a private Chrome profile for a warm-cache functional check; cache reuse did not consistently resolve the frame stall. Record that cache state and do not treat it as cold-start or renderer-sizing qualification. Run browser qualification without concurrent build/test jobs.

A failed game immediately revokes the browser binding. Remote starts and model results cannot revive it. The retained browser qualification contains one successful functional run and repeated later frame-stall failures; it is not a reliable passing acceptance gate. Resolve the renderer/harness issue before marking N0–N2 fully qualified.
