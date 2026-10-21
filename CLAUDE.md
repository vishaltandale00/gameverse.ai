# Instructions for Claude in this repository

Also follow `AGENTS.md` (turnaround, timing and workstream rules).

## v2 game engine work

Before touching v2, read `v2/ARCHITECTURE.md` in full, then `v2/HANDOFF.md` and `v2/KERNEL_API.md`. The
architecture is the specification: when code disagrees with it, change the code. Every rule below comes from it.

### What the user needs

Any idea, including mashups, becomes the game asked for and is playable through real controls, or the build
fails saying exactly what is missing. Our own mismatches between stages must never reach the user.

### How to work

- **Fix classes, not instances.** A failing game is evidence of a defect in a pipeline stage, a schema, a
  declaration or a check. Find every site of that class across the whole catalogue and pipeline, fix it at the
  root, and add a catalogue-wide conformance test that fails if it comes back. Generated games are test cases;
  never fix one game, one idea or one card.
- **Cards are the single source of truth.** Forms, repair, preflight and the composition check all derive from
  card declarations. If a validator enforces something the card doesn't declare, declare it on the card from
  the same constant; never paper over it in a form, a prompt or a retry.
- **Templates are the fast path.** Declared, pre-verified templates chosen by the idea and composed through
  adapters give structure in seconds; step-by-step selection is only for what no template covers. Never stamp one
  default template onto every idea.
- **No workarounds.** No fallbacks, no defaults standing in for decisions, no isolating or
  dropping primitives, no swapping the world, no guessing from the idea's words, no text-overlap cut-offs, no
  loosened checks, no weakened or deleted tests. If the right fix is in another layer (including the kernel),
  fix that layer.
- **Iterative, checked generation.** Small model choices among options code has proven valid; checks after every
  step; retries redo only what changed.
- **Verification is the checks and the playtest bot,** playing through the same controls a person uses. Never
  hand-play games in a browser. Don't run the user's ideas through the pipeline as a way to find defects; use the
  static and conformance checks. Live runs only confirm.
- **The basic pipeline comes first.** No features, AI behaviour, art, benchmarks or side projects while ideas
  don't reliably become playable games.
- **Integrate as you go.** Work isn't done until it's merged into the working branch, called from the live path,
  proven by the checks, and the server on port 4181 is restarted on it.
- **Subagents:** small, checked pieces with disjoint files, each integrated and verified before the next. Never
  leave long unsupervised agents running on the user's asks.
- **Repository hygiene:** remove worktrees and branches once merged; never leave work unmerged without saying
  where it is.
- **Don't invent** policies, caps, gates or defaults. Ask once if a decision is genuinely the user's.

### How to report

- Short and direct. State what was done, what the checks showed, and what still fails, with evidence.
- Never say something works, is ready or is fixed without proof from the checks or the playtest bot.
- No apologies and no reassurance. Say plainly what is wrong and what you are doing about it.
