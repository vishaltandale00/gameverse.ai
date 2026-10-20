# Independent playable validation

Scope: two new browser/WASM authored games with meaningful recovered C mechanics. This is neither ROM qualification nor accepted FireRed/session integration. Source/input ownership stays with candidate workers; this lane writes validation evidence only.

Initial harness review: existing `tools.playtester` JSONL v1 supports isolated sessions, bounded action frames, decision/step/wall limits and retained actual-call logs. Current process has no configured `LITELLM_API_KEY`, `LITELLM_BASE`, `PLAYTEST_LLM_BASE_URL`, `PLAYTEST_LLM_MODEL`, `PLAYTEST_LLM_API_KEY`, or `OPENAI_API_KEY` (presence-only inspection). No credential search and no model calls. A new generic adapter is not needed for direct bounded input validation; model control remains untested.

Required checkpoints:

- Fresh deterministic state, visible instructions, actual controls, distinct world/rendering.
- Compiled C→WASM artifact and exported calls actually consumed by the game, with source/output hashes and separation from authored world/lifecycle/graphics.
- Action: real movement/jump/attack→contact→damage→protection aging→one death settlement/reward, player failure/respawn, eventual victory, restart.
- Tactics: progression changes future action availability; canonical refresh precedes action; duplicate confirmed input cannot exchange twice; terminal actors cannot act/receive consequences; defeat, victory, restart.
- Phase list, bounded ticks, per-event source vs authored boundary, no held edge accidentally repeating a command.
- Actual browser screenshot inspection and interaction. Diagnostic teleports or state mutation, if used, are labeled and cannot substitute for a play segment.

Budget: initial ~30 seconds deterministic simulation per game; no new dependencies, CI or broad campaign. Retain failed assertions and corrected attempts. Build/simulation/evaluation wall times separate; queue/provider billing/cache state and before/after baseline unavailable unless measured. Durable resume/migration and automatic update eligibility unsupported.
