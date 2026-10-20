# Application-provided hosted voice, 2026-10-20

The owner changed the voice UX to application-provided credentials. This supersedes the personal-key prerequisite for voice in the earlier H0–H3 qualification. Personal coding connections remain separate. Implementation: `9066178b47c7be7b76a85863c3ca3b67c5aeaa25`.

A dedicated `VOICE_OPENAI_API_KEY` Cloudflare secret funds transcription, voice planning, simulated-player Decisions and reflection. Funding is explicit and pinned to each root; no generic operator/personal key fallback exists. App secret rotation/removal or switching funding revokes pending roots. Editing a personal connection does not revoke application-funded voice. Existing per-root, account, platform and rolling daily limits are retained. Credentials stay out of the browser, Daytona worker launch/package and artifacts.

All application edits, checks, browser execution and bundling ran in private Daytona sandbox `cb515908-6c19-489c-a07e-cec2e11cef9d`, 2 CPU / 4 GiB / 8 GiB, Node 25.9.0, finite 60-minute TTL. Only explicitly synthetic keys reached the qualification sandbox. No external model calls were made by these checks.

- Manager/hosted/funding: 73/73 passed, 33.243 seconds. Includes real workerd restart paths for both explicit account-funded and application-funded modes, ordinary accounts without keys, owner isolation, grant changes and unchanged daily admission.
- Hosting/account/vault: 30/30 passed, 12.651 seconds.
- Browser/voice/agent/Stop: 74/74 passed, 1.646 seconds.
- Build passed, clean dist with installed dependencies, 59.6 ms; Worker dry-run and diff check passed. No new dependency or routine CI job. A matched turnaround baseline was not captured for this change; do not infer a performance improvement from earlier runs.
- Rendered application-funded journey passed in 18.826 seconds, task `3aa38feb-1476-4f47-bdf2-676672a80ca6`. The ordinary account had no developer manager or personal OpenAI key, and the account page exposed no personal OpenAI setup for voice. Real recorded audio, the actual cloud dispatcher and VoiceAgent process produced acknowledged takeover and two controller actions including a Decisions-backed action. Stop completed in 1.3 ms with backend fetches blocked and a decision pending. Late actions were rejected, human controls moved the player, receipts were retained and fixture cleanup was confirmed.

The rendered test uses scripted providers and synthetic Daytona HTTP transport in one real implementation sandbox; it does not prove real ASR/Decisions access or a separate voice container. Live preview key configuration is an operator step after export. The preview keeps its prior isolated account/encryption/admin keys and storage so existing sign-in/pairing survives. Only the preview is updated; the live site's deployment is unchanged. Record any live service qualification separately from this synthetic evidence.
