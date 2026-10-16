# Initial bot and generation qualification

The partial ontology currently contains 19 games and 676 components. These are
evidence-backed partial extractions, with unresolved gameplay roles and caller
constraints stated where applicable. They are not complete ROM decompilations.

`qualification-2026-10-16.json` records actual bounded transport, native ROM and
generation observations, including a contradictory OpenAI predicate answer.
The rejected abstract-game generator and generated candidate have been removed.
Neither model probabilities nor title-recall embedding distances are calibrated
gameplay truth.

The local LLM generation attempt produced a candidate that acquired its key,
opened the required gate and reached the goal in nine actions. Total wall time
was 4.578014 seconds; generation used one request and 1,368 reported tokens.
This candidate is an abstract grid game, using original geometry and simplified
design analogies linked to Emerald movement and Zero Mission ability gating.
It is not a generated GBA ROM or automatic composition of extracted source code.

The final real-ROM bot pilot performed two actions / 24 frames with three d1
requests and two LLM escalations in 2.062031 seconds, then stopped at its explicit
escalation limit. That verifies the adaptive control plumbing. It does not qualify
autonomous platform control or establish objective completion. Earlier unresolved
and quota failures remain in ignored local experiment records.

Focused checks for the committed integration:

- 39 bot/generation tests: 0.354 seconds.
- 18 decision/gate tests: 0.487 seconds.
- Native public JSONL restore/replay/action-limit integration: 0.105 seconds,
  using an explicit private local ROM.
- All 19 ontology files pass schema/internal-reference validation.
- Earlier unchanged Ghidra and asset checks retain their separate measurements
  in the research handoff; no new CI job or broad model campaign was added.

Queue time, billing and exact serving revisions are unavailable. Timing stages
are nested within total wall time. Small offline fixture durations do not predict
paid model or full game performance.

See [play tester](../../tools/playtester/README.md),
[native sessions](../../tools/re/session/README.md) and
[research handoff](../../ontology/RESEARCH_HANDOFF.md).
