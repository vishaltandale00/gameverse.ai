# Versioned model prompts

Edit prompts here, separately from policy code. `registry.json` selects the defaults for **new** creation runs. Each entry has a stable ID, explicit version, repository reference and SHA-256 of the complete referenced UTF-8 JSON file. Templates use `{{name}}` variables; substitution is literal, single-pass and requires every referenced variable. Provider credentials never belong here.

Current templates preserve the previous inline text: Codex creation and evidence-based source repair; S1 action, perspective and locomotion questions; S2 visual reasoning and malformed-response repair; shared current-observation precedence. The Pokémon deterministic compilation route does not call an agent. Action descriptions, objectives, observations and model repair errors are dynamic game/run inputs, not new template versions.

To update a prompt:

1. Copy its JSON file to a new version filename and change `version` and `template`. Keep the stable `id` and retain the old file.
2. Update that entry's `version`, `ref`, and `sha256` in `registry.json`; increment the registry version. Compute the digest with `shasum -a 256 prompts/<id>/<version>.json`.
3. Run `node --test tests/prompt-registry.test.js` and `python3 -B -m unittest tools.prompts.test_prompts tools.playtester.test_context_payload tools.playtester.test_calibration`. These use fake transports and no model calls, builds, campaigns or new dependencies.
4. Start a new run (or explicit new refinement) to select the revision. Resume never upgrades prompts.

Each new creation workspace retains `prompt-lock.json`: exact template file contents, versions and verified hashes. `prompt-provenance.json` pins this lock. Codex call receipts retain the exact rendered text and its separate digest before calling the agent, including failed attempts. Pipeline results identify that lock; resume validates it and uses captured runner/model policy files. Testing model call records retain the template provenance, exact resolved textual instructions and context, and a separate full request hash. Images are already bound through the observation and request hashes; base64 image bodies are not duplicated in the text snapshot. A template digest identifies a template file, **not** the dynamic resolved prompt. The S1 calibration scope includes prompt identities along with the existing game/action/provider scope.

Legacy runs remain `legacy_unversioned`. A retained old runner may continue using its original captured code; missing historical prompt versions are not invented, and old evidence is never rewritten. A versioned run with a missing/corrupt lock fails visibly. Do not copy new prompt files into an existing run to upgrade it; start a new run instead. Model-learning checkpoint records bind the retained prompt provenance, checked before continuation.

Runtime preparation overlays this reviewed prompt/policy closure into each newly captured workspace; imports include the same files and their digests. This prevents private research runtime copies from silently dropping or replacing the reviewed prompts. No central orchestration service or new CI stage is required.

Standalone `experiment.py` and `rpg_experiment.py` also bind the registry/template provenance and loader digest in their existing checkpoint runtime identity. They share one frozen prompt lock between S1 and S2 during a run. A checkpoint whose prompt identity is missing or differs is refused before native execution; use a new explicit run to adopt the current registry. Their legacy checkpoints are not silently upgraded.

Registry `1.1.0` adds `codex-source-transform@1.0.0` for an actual isolated source/adapter/build attempt when a pair has no registered recipe. Its required variables are `requestJson`, `contextJson` and `outputContractJson`; the pipeline supplies the structured output contract. This addition changes defaults for new runs only. Existing locks need no new entry and retain their original registry hash and prompt bodies.

Registry `1.2.0` selects source-transform `1.1.0`: inspect relevant installed metadata first and promptly hand off a faithful adapter as `ready-for-adapter`; the host performs the actual build/native verification. Detailed source edits/build investigation remain the fallback when no faithful adapter exists. The older `1.0.0` template and retained locks are unchanged. `codex-source-transform-resume@1.0.0` uses `requestJson`, `continuationJson`, and `outputContractJson` to finalize retained same-thread receipts without repeating completed work. A continuation records its own selected template lock/version/rendered receipt separately; it does not rewrite the original attempt prompt or history.
