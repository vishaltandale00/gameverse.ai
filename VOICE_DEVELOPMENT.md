# Live voice input

Implemented local streaming path, 2026-10-16. OpenAI transcribes while the player speaks. Gameplay continues throughout capture. The second R3 sends the request and closes the panel immediately; finalization and the durable local request save finish in the background. No game improvement worker is connected yet. Shishir retains ownership of interpretation and the improvement loop.

## Setup

Copy `.env.example` to `.env`, set `OPENAI_API_KEY`, then restart `npm run dev`. A server-only key is already configured on the current local preview. The server reads `.env`; existing process environment settings take precedence. This file is Git-ignored and is not served by the host. The static `dist/` package needs the local backend for voice input.

| Setting | Default | Meaning |
| --- | --- | --- |
| `TRANSCRIPTION_PROVIDER` | `openai` | Selects an installed streaming adapter. Only OpenAI is shipped; unknown providers fail visibly. |
| `TRANSCRIPTION_REALTIME_MODEL` | `gpt-live-transcribe` | Live model used by the recording UI. Existing `.env` files may omit this and use the default. |
| `TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe` | Retained file-upload endpoint only; changing this does not change the live model. |
| `VOICE_MAX_SECONDS` | `120` | Capture bound; configurable up to 600 seconds. |
| `VOICE_MAX_BYTES` | `10485760` | Stream/upload byte bound; configurable up to 24 MiB. Streaming also cannot exceed `maxSeconds * 48000` PCM bytes. |
| `VOICE_TIMEOUT_MS` | `30000` | Separate connection/finalization bounds; configurable up to 120 seconds. |
| `VOICE_MAX_STREAMS` | `2` | Concurrent local streaming sessions; configurable up to 8. |
| `VOICE_RECORD_BUTTON` | `11` | Standard gamepad index 11 is right-stick click / R3. B / Circle is index 1. |

Use Chrome, Edge or another browser with AudioWorklet, WebSocket and microphone support at `http://127.0.0.1:4173` or `http://localhost:4173`. The active preview uses port 4175. First use requires browser microphone permission, which may require a mouse or keyboard. Audio is verified as 24 kHz mono PCM16 before transmission; unsupported rates fail rather than silently sending audio at the wrong speed. Physical microphone and Safari behavior remain unqualified.

## Controls and background behavior

- **R3 / Voice feedback:** capture the original game/version/profile/progress context, open a small nonmodal live transcript panel, and start the microphone. Movement, camera and ordinary game actions continue; voice does not pause the world or emulator.
- **B / Circle / Cancel, before sending:** discard the recording and provisional text, close the stream and microphone, and ignore late events. The held cancelling B cannot leak into FireRed as a game action.
- **Second R3 / Send request:** close the panel immediately, flush the final audio frame, commit the turn, await the final transcript, and automatically save its request in the background. B now belongs to normal gameplay. A subtle saving state and then a brief receipt/error notice report the result. There is no additional Submit or Return-to-game action on success.
- Focus loss, tab hiding or controller disconnection cancels active capture. Once submitted, transcription/saving can finish in the background. Existing gameplay focus/recovery behavior remains independent.
- Provisional text is display-only. Only the final transcript is submitted. Navigation does not retarget a recording already in progress. Empty finals, timeout, provider failure and disconnection cannot silently submit partial text.

Audio goes to OpenAI while recording. Gameverse does not save raw audio. Final transcripts and captured context are retained under ignored `local-data/voice-requests/`, including cancelled request records. Do not publish this directory. The provider sees audio, not the captured game/save context; that context stays on the local backend.

## Backend and provider boundary

`GET /api/voice/config` returns safe active provider/model/binding/resource settings, the retained file-model setting, and availability. No credentials are returned.

`WS /api/voice/stream?requestId=<UUID>` uses a provider-independent browser protocol:

- Browser sends binary PCM16 audio frames, and JSON `{ type: "stop" }` or `{ type: "cancel" }` commands.
- Backend sends `ready`, incremental `transcript` events with item IDs/deltas, one `final` transcript, or an actionable sanitized `error`.
- Origin/host/UUID validation, maximum sessions, payload/duration/byte limits, connection/finalization deadlines and send-buffer limits bound the work. Disconnect/cancel closes the upstream provider connection.

The browser captures 100 ms frames through `src/voice-worklet.js`. Flush acknowledgements share the same ordered MessagePort as the audio; the stop command shares the ordered WebSocket with the frames. The backend commits only after those frames. The final transcript is reconciled against the committed item ID. Microphone tracks and the AudioContext close after capture, and the provider connection closes after finalization/cancellation/failure.

`realtimeTranscriptionProviders` in `scripts/voice-stream.mjs` owns vendor connection, session configuration, audio encoding, commit commands and event normalization. Add another adapter there and select it with `TRANSCRIPTION_PROVIDER`; browser controls, capture and backend request consumers remain independent of that vendor. The OpenAI adapter uses a server-only key and a dedicated transcription session with manual turn commit, not a spoken assistant.

`POST /api/voice/requests` accepts `{ requestId, text, context, transcriptionMs, transcriptionMode: "realtime" }`. It writes an atomic `schemaVersion: 1` receipt with `status: "received"`, `processing: "not-connected"`, captured context, provider/model/mode and timing provenance. Repeated identical submissions are idempotent; conflicting reuse is rejected. This is a local input seam, not a claimed agreed interface with Shishir's harness.

`DELETE /api/voice/requests/:requestId` remains available for explicit local request cancellation, including cancellation before a late submission arrives. Request updates are serialized per ID within this server process. After the second R3, B is a gameplay action and does not invoke this endpoint. Future consumers must skip cancelled records; cancelling an already-running external worker requires its own contract.

The previous `POST /api/voice/transcriptions` file endpoint remains available for compatibility and tests. The recording UI does not use it and does not silently fall back to batch transcription.

## Verification and evidence

Focused tests use the existing Node runner and local fake providers, with no billable calls. They cover live text before stop, final-over-partial handling, final-item reconciliation, worklet clipping/final-frame flush order, backpressure, sample-rate mismatch, cancellation/late events, lost connections, provider errors, limits/deadlines, idempotent receipts, frozen targets and R3/B ownership. Local HTTP/WebSocket integration tests need loopback permission in a restricted sandbox. The only added dependency is pinned `ws`; there is no new build stage or CI job.

Live OpenAI proof: a macOS-generated 3.4465-second test sentence was streamed in real time. Deltas arrived before Stop and the final text matched the sentence. First text was observed 2,078.0 ms after connection began in one Node stream; this includes startup and speech time and is not a microphone-latency SLA. The full stream/turn wall time was 7,056.3 ms, including paced audio and a deliberate 1.5-second pre-commit wait. `local-data/voice-qa/openai-live-stream.json` retains the event evidence.

An isolated Chrome 154 check exercised the real AudioWorklet, local relay and OpenAI using generated audio, with live text before Stop and actual world movement during capture. Subsequent browser cases used a stub socket with real capture, real FireRed and real local receipts. FireRed remained running and advanced from frame 12 to 38 to 91 across capture/submission/background completion; no voice pause command was issued. B cancelled an open stream without submitting and returned to the GBA after sending. A separate final browser check verified that choosing Voice feedback from the pause menu resumes the real emulator before capture, and cancellation leaves it running; this check used a stub stream and made no OpenAI call. Desktop/phone layout checks observed no overflow or page errors. `local-data/voice-qa/live-browser.json` and `live-recording-{world,firered,mobile}.png` retain this proof. Synthetic test requests are tagged by their recorded request IDs; no actual game changes were run.

Real microphone acoustics, physical controller behavior, Safari/mobile-device capture, multi-server writers, power-loss durability and real improvement-loop integration remain unqualified. The screenshots are implementation proof, not user acceptance of the visual design.

## Timing context

Representative before/after: the full Node suite passed 44 tests in 1,242.8 ms before, and 56 tests in 1,161.2 ms after. The shell-copy build passed in 37.4 ms before and 31.9 ms after. These small differences are run-to-run observations, not an optimization claim. After the final pause-menu entry fix, the 23 affected controller/voice/relay tests also passed in 93.9 ms; the remaining suite was unchanged. Both ran on the same Apple Silicon machine, Node 22.23.2, existing dependency/runtime caches, dirty HEAD `0d98de68e0f6664b65022a0a53763d0a25b1b716`. Installing the single `ws` dependency took 437 ms of npm-reported installation time and is separate from build/test time. The build deletes/recreates `dist/` but performs no game compile or dependency setup. These are representative single runs, not budgets or statistically meaningful regressions.

Live server reports include request ID, provider/model, outcome, total stream wall time, first-text time, audio bytes, timestamp and explicit unavailable queue time. `transcriptionMs` in a streaming receipt includes connection, capture and finalization: it is not isolated model inference time. These stages are nested and must not be added to total journey time. Failed/cancelled streams retain outcomes in the same server report channel. CI queue/job/critical-path measurements and improvement-loop build/simulation/evaluation timings are unavailable because no such run was performed.
