# Repository publication preparation

Date: 2026-10-15 · Status: planning baseline published and verified in a private repository.

## Intended publication

Publish the Gameverse planning baseline: product requirements, domain language, base/subgame/improvement contracts, separate delivery tasks and existing research evidence. This is repository publication, not a game deployment.

Approved destination: `vishaltandale00/gameverse.ai`, private, for the reviewed planning baseline. No repository license has been chosen; do not add a license or imply third-party redistribution rights without that decision.

## Included file set

- Root Markdown: README, PRD, engineering handoff, domain glossary, delivery tasks, this publication note, MVP contract and earlier research/design documents.
- `contracts/*.md`: base game, subgame hosting interface and improvement loop.
- `design/*.json`: illustrative proposal and clearly identified historical examples.
- `research/pokemon/`: existing audit JSON, scenario JSON, textual tool logs and the forest source patch, preserving provenance and failed/unexecuted status.
- `.gitignore`: local, private and generated-file exclusions.

No application package, ROM, executable game, save, recording, credential file or vendored source checkout is in this intended set. Future additions need their own content review; ignore rules alone do not establish publication safety.

## Preparation checks

- [x] Inspect current workspace: no commits, no remote and no runnable application at the beginning of this task.
- [x] Add README, contracts, shared terms and separate task specifications.
- [x] Label historical configuration examples and preserve evidence limitations.
- [x] Inspect existing textual logs/patch and scan intended text for credential-like values and local/private content. No credential value was identified; the retained temporary audit path is provenance, not a portable prerequisite.
- [x] Verify local Markdown links, JSON parsing and whitespace: 26 intended text files, 16 Markdown documents, 5 JSON files and 57 local links checked successfully.
- [x] Settle GitHub owner/name, visibility and initial publication scope: private `vishaltandale00/gameverse.ai`, approved by the user on 2026-10-15.
- [x] Review and commit the 26-file included set; exclude local state and generated/third-party artifacts.
- [x] Create/push the approved repository; verify remote URL, private visibility, main branch and commit. Compare every published file's path, mode and content hash with the local baseline.

There is no app test/build command to execute yet. Checks on these files validate the planning baseline, not product behavior.

## Publication receipt

- Repository: [vishaltandale00/gameverse.ai](https://github.com/vishaltandale00/gameverse.ai).
- Verified visibility: private; default branch: `main`.
- Initial baseline commit: `5ac86a78d989105c411cdfee2d3b52cf1b7b8fba`.
- Initial baseline tree: `abfeb3add47d957c4e367b7388645ae7657dafe6`.
- Verification: all 26 published files matched local paths, modes and Git content hashes. This receipt and the P0 completion status are recorded in a subsequent documentation commit.

There is still no runnable game, game deployment or selected repository license. T1–T3 remain unimplemented; the published baseline contains their contracts and acceptance gates.

Keep P0/T1/T2/T3 as local task specs unless issue creation is requested. Creating separate Codex implementation chats is a separate action from documenting these tasks.
