# Pending templates

Written and won by their bots, but blocked by defects in the static checks (compose-check / loop-check). Discovery
(`../registry.js`) reads only `v2/templates/*.js`, so these are not offered until the check defects are fixed at the
root and each passes `checkTemplate`; then they move up one directory. Blockers (exact messages in each file's header
and in the merge commits of `tpl-boards` / `tpl-puzzles`):

- card-battle: compose-check throws on a mode played `via` another card; a stage-sequence-owned win is reported as the
  inner loops' unwired wins; stage-spawned sides are not seen; `sides` read on gameplay.cards instead of its via host.
- falling-blocks, slide-merge: content coverage counts only generators, so a board that fills its own cells is
  `content_missing: cells`.
- launcher: a typed-count ending (`destroyed:target`) does not fill the declared `destroyed` win template; the loop check
  ignores the events `reads.by` declares (contact, explosion).
