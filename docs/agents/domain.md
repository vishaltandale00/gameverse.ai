# Domain docs

How engineering skills should consume this repository's domain documentation.

## Layout and reading rules

This is a single-context repository:

- Root `CONTEXT.md` contains domain vocabulary, including the game factory and verification terms.
- `docs/adr/` holds architecture decisions.

Read `CONTEXT.md` and relevant ADRs before exploring an area. Follow `AGENTS.md`'s integration reading order, starting with `contracts/PARALLEL_DEVELOPMENT.md`, and consult the relevant contracts and plans.

If domain files or directories are absent, proceed silently. Create them lazily when terms or decisions are resolved.

## Vocabulary

Use the terms defined in `CONTEXT.md` in issues, proposals, tests and code discussions. Respect its explicitly discouraged synonyms.

Keep `CONTEXT.md` a glossary. Requirements, verification policies, implementation choices and progress reports belong in their relevant contracts, plans, issues or ADRs. A glossary definition does not establish that a component is implemented or qualified.

If a needed concept is missing, reconsider the terminology or note the gap for `domain-modeling`.

## Decision conflicts

Explicitly identify any proposal that contradicts an existing ADR, including the reason for reopening that decision.
