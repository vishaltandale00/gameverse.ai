# Issue tracker: GitHub

Issues and specs live in `vishaltandale00/gameverse.ai` on GitHub. Use the `gh` CLI from this checkout; infer the repository from `git remote -v`.

## Conventions

- Read: `gh issue view <number> --comments`.
- List: `gh issue list` with appropriate state and label filters. Fetch labels and comments when triaging.
- Create: `gh issue create --title "..." --body-file <file>`.
- Comment: `gh issue comment <number> --body-file <file>`.
- Labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`. Use the mapping in `triage-labels.md` for triage roles.
- Close: `gh issue close <number>`.

Use temporary files for multiline bodies.

When a skill says "publish to the issue tracker", create a GitHub issue. When it says "fetch the relevant ticket", read the issue and its comments.

## Game factory issues

Use the vocabulary in root `CONTEXT.md`. Factory-related issues should identify:

- The problem, affected domain concepts and scope.
- The intended behavior and acceptance evidence, including applicable game laws, decision circuits or gameplay evaluations.
- Unresolved decisions, dependencies and gaps in current evidence. Keep proposals distinct from accepted requirements and implemented behavior.
- Ownership: Vishal's environment, adapters, player progress and host application/recovery responsibilities; Shishir's construction/improvement harness, algorithms and experiments. Name both sides of a shared contract when relevant.

For work affecting turnaround time, follow `AGENTS.md`: state the coverage and expected cost of added checks, and retain comparable measurements or explicitly identify missing baselines.

## Pull requests as a triage surface

**PRs as a request surface: no.**

Issue and PR numbers share a namespace; resolve the resource type before operating on a bare number.

## Wayfinding

A map is one issue labelled `wayfinder:map`, holding Notes, Decisions-so-far and Fog. Child tickets use `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling` or `wayfinder:task`.

Prefer native GitHub sub-issues and issue dependencies. If unavailable, use a task list on the map, `Part of #<map>` on each child, and `Blocked by: #<number>` for dependencies.

The frontier is the first open, unassigned child in map order whose blockers are closed. Claim it by assigning the driving developer. Retain findings on the ticket and add a concise linked decision to the map before closing resolved work.
